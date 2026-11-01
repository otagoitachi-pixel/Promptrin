// Login and session handling for the online admin. Runs in a Cloudflare Worker (Web Crypto only).
//
// How it protects the admin:
//   1. Fails closed: if the secrets are missing or too weak, the admin refuses to start.
//   2. Password check is constant-time (both sides are HMAC'd first, then compared).
//   3. Optional second factor: a 6-digit authenticator-app code (TOTP_SECRET).
//   4. Sessions are signed (HMAC-SHA256) cookies: __Host- prefix, HttpOnly, Secure, SameSite=Strict, 8 hours.
//      Changing SESSION_SECRET or ADMIN_PASSWORD signs everyone out.
//   5. Every change needs the cookie AND a custom header AND a same-origin Origin header (CSRF).
const enc = new TextEncoder();
export const COOKIE = '__Host-promptrin_admin';
export const SESSION_SECONDS = 8 * 60 * 60;

const b64u = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function hmac(key, data, hash = 'SHA-256') {
  const k = await crypto.subtle.importKey('raw', typeof key === 'string' ? enc.encode(key) : key, { name: 'HMAC', hash }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, typeof data === 'string' ? enc.encode(data) : data));
}

export function equalBytes(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Returns a list of problems with the Worker's configuration (empty when it is safe to run). */
export function configProblems(env) {
  const out = [];
  if (!env.ADMIN_PASSWORD || env.ADMIN_PASSWORD.length < 14) out.push('ADMIN_PASSWORD must be set and at least 14 characters.');
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) out.push('SESSION_SECRET must be set and at least 32 characters.');
  if (env.ADMIN_PASSWORD && env.SESSION_SECRET && env.ADMIN_PASSWORD === env.SESSION_SECRET) out.push('SESSION_SECRET must be different from ADMIN_PASSWORD.');
  if (!env.GITHUB_TOKEN) out.push('GITHUB_TOKEN is not set.');
  if (!/^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPO || '')) out.push('GITHUB_REPO must look like "username/repository".');
  if (env.TOTP_SECRET && !/^[A-Z2-7]{16,}$/i.test(env.TOTP_SECRET.replace(/\s|=/g, ''))) out.push('TOTP_SECRET must be a base32 string (letters A-Z and digits 2-7).');
  return out;
}

export async function checkPassword(given, env) {
  const key = `check|${env.SESSION_SECRET}`;
  const a = await hmac(key, String(given ?? ''));
  const b = await hmac(key, env.ADMIN_PASSWORD);
  return equalBytes(a, b);
}

// ---- TOTP (RFC 6238: 30-second steps, 6 digits, HMAC-SHA1), as used by Google Authenticator and others.
export function base32Decode(input) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = input.toUpperCase().replace(/[\s=]/g, '');
  let bits = '';
  for (const ch of clean) {
    const v = alphabet.indexOf(ch);
    if (v < 0) throw new Error('Invalid base32');
    bits += v.toString(2).padStart(5, '0');
  }
  const out = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Uint8Array.from(out);
}

export async function totpAt(secretBase32, counter) {
  const buf = new ArrayBuffer(8);
  new DataView(buf).setBigUint64(0, BigInt(counter));
  const mac = await hmac(base32Decode(secretBase32), new Uint8Array(buf), 'SHA-1');
  const o = mac[mac.length - 1] & 0x0f;
  const bin = ((mac[o] & 0x7f) << 24) | (mac[o + 1] << 16) | (mac[o + 2] << 8) | mac[o + 3];
  return String(bin % 1_000_000).padStart(6, '0');
}

/** Accepts the current code and one step either side (clock drift). */
export async function verifyTotp(secretBase32, code, nowMs = Date.now()) {
  const given = String(code ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(given)) return false;
  const step = Math.floor(nowMs / 30000);
  let ok = false;
  for (const c of [step - 1, step, step + 1]) {
    const expected = await totpAt(secretBase32, c);
    if (equalBytes(enc.encode(expected), enc.encode(given))) ok = true;
  }
  return ok;
}

// ---- sessions
const sessionKey = (env) => `session|${env.SESSION_SECRET}|${env.ADMIN_PASSWORD}`;

export async function makeSession(env, nowMs = Date.now()) {
  const payload = b64u(enc.encode(JSON.stringify({ exp: Math.floor(nowMs / 1000) + SESSION_SECONDS, n: b64u(crypto.getRandomValues(new Uint8Array(12))) })));
  const sig = b64u(await hmac(sessionKey(env), payload));
  return `${payload}.${sig}`;
}

export async function readSession(env, request, nowMs = Date.now()) {
  const header = request.headers.get('Cookie') || '';
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([\\w.-]+)`).exec(header);
  if (!m) return false;
  const [payload, sig] = m[1].split('.');
  if (!payload || !sig) return false;
  try {
    const expected = await hmac(sessionKey(env), payload);
    if (!equalBytes(expected, unb64u(sig))) return false;
    const { exp } = JSON.parse(new TextDecoder().decode(unb64u(payload)));
    return typeof exp === 'number' && exp > nowMs / 1000;
  } catch {
    return false;
  }
}

export const sessionCookie = (value, maxAge = SESSION_SECONDS) => `${COOKIE}=${value}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Strict`;
export const clearCookie = () => `${COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict`;
