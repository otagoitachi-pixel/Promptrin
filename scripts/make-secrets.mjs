// Prints fresh random values for the online admin's secrets (run it on your own device; nothing is sent anywhere).
//   node scripts/make-secrets.mjs
import crypto from 'node:crypto';
const b32 = (buf) => { const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = '', out = ''; for (const b of buf) bits += b.toString(2).padStart(8, '0'); for (let i = 0; i + 5 <= bits.length; i += 5) out += a[parseInt(bits.slice(i, i + 5), 2)]; return out; };
const brand = process.argv[2] || 'Promptrin';
const totp = b32(crypto.randomBytes(20));
console.log(`
SESSION_SECRET (paste into Cloudflare as a Secret):
${crypto.randomBytes(36).toString('base64url')}

TOTP_SECRET (optional, recommended; adds a 6-digit authenticator-app code at login):
${totp}

To add it to Google Authenticator / Authy / 2FAS: choose "Enter a setup key", account "${brand} admin",
key = the TOTP_SECRET above, type = time based. Or open this link on the phone that has the app:
otpauth://totp/${encodeURIComponent(brand)}%20admin?secret=${totp}&issuer=${encodeURIComponent(brand)}

ADMIN_PASSWORD: choose your own, at least 14 characters (three or four random words is fine). Do not reuse one.
`);
