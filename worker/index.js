// Cloudflare Worker: the secure online admin for Promptrin.
//
// Only these paths reach this Worker (see "run_worker_first" in wrangler.jsonc):
//   /admin  /admin/*  /api/admin/*
// Every other URL is the static site, served straight from Cloudflare's asset storage.
//
// Saving works by committing to your GitHub repository; Cloudflare then rebuilds the site by itself.
import { ADMIN_HTML, SNAPSHOT } from './generated.js';
import { CUSTOMIZE_KEYS, CUSTOMIZE_LABELS, UserError, renderMarkdown } from '../scripts/lib/shared.mjs';
import { configProblems, checkPassword, verifyTotp, makeSession, readSession, sessionCookie, clearCookie } from './auth.js';
import { createRepo } from './github.js';
import * as content from './content.js';

const MAX_BODY = 16 * 1024 * 1024;
const MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', avif: 'image/avif', jpeg: 'image/jpeg' };
const CSP = "default-src 'none'; img-src 'self' data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

const securityHeaders = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

const json = (status, body, extra = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...securityHeaders, ...extra } });
const html = (status, body) => new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': CSP, ...securityHeaders } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ctxOf = () => ({ taxonomy: SNAPSHOT.taxonomy, categories: SNAPSHOT.categories, redirects: SNAPSHOT.redirects });

const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${title}</title>
<style>:root{color-scheme:light dark}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f5f2;color:#1b1b1f;font:16px/1.5 system-ui,sans-serif;padding:16px}
@media(prefers-color-scheme:dark){body{background:#131316;color:#ececf1}.card{background:#1d1d22!important;border-color:#33333b!important}input{background:#131316!important;color:#ececf1!important;border-color:#44444d!important}}
.card{width:100%;max-width:380px;background:#fff;border:1px solid #dcdad3;border-radius:16px;padding:24px}h1{font-size:1.25rem;margin:0 0 4px}p{margin:0 0 16px;color:#6b6b73;font-size:.9rem}
label{display:block;font-weight:600;font-size:.85rem;margin:12px 0 4px}input{width:100%;box-sizing:border-box;padding:12px;border:1px solid #c9c7bf;border-radius:10px;font:inherit}
button{margin-top:18px;width:100%;padding:12px;border:0;border-radius:10px;background:#6d4aff;color:#fff;font:600 1rem system-ui;cursor:pointer}button:disabled{opacity:.6}
#err{color:#c0262d;font-size:.9rem;margin-top:12px;min-height:1.2em}ul{padding-left:18px;font-size:.9rem}</style></head><body><main class="card">${body}</main></body></html>`;

function loginPage(env) {
  const totp = env.TOTP_SECRET ? '<label for="c">Authenticator code</label><input id="c" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" pattern="[0-9 ]*" required>' : '';
  return page('Sign in', `<h1>${SNAPSHOT.brand} admin</h1><p>Private area. Sign in to continue.</p>
<form id="f"><label for="p">Password</label><input id="p" type="password" autocomplete="current-password" required>${totp}<button id="b" type="submit">Sign in</button><div id="err" role="alert"></div></form>
<script>
const f=document.getElementById('f'),err=document.getElementById('err'),b=document.getElementById('b');
f.addEventListener('submit',async(e)=>{e.preventDefault();b.disabled=true;err.textContent='';
try{const r=await fetch('/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json','X-Admin-Request':'1'},body:JSON.stringify({password:document.getElementById('p').value,code:document.getElementById('c')?.value||''})});
const d=await r.json().catch(()=>({}));if(r.ok){location.replace('/admin');return}err.textContent=(d.errors&&d.errors[0])||'Could not sign in.'}catch{err.textContent='Network problem. Try again.'}b.disabled=false});
</script>`);
}

function problemsPage(problems) {
  return page('Admin not set up', `<h1>Admin is switched off</h1><p>It stays off until it is configured safely. In Cloudflare, open this Worker, then Settings, Variables and Secrets, and fix:</p><ul>${problems.map((p) => `<li>${p.replace(/[<>&]/g, '')}</li>`).join('')}</ul>`);
}

async function readJsonBody(request) {
  const len = Number(request.headers.get('Content-Length') || 0);
  if (len > MAX_BODY) throw new UserError(['That upload is too large.'], 413);
  try {
    const text = await request.text();
    if (text.length > MAX_BODY) throw new UserError(['That upload is too large.'], 413);
    return text ? JSON.parse(text) : {};
  } catch (e) {
    if (e instanceof UserError) throw e;
    throw new UserError(['Invalid JSON.'], 400);
  }
}

/** Reads the repo, runs one operation, and saves its result as a single commit. */
async function mutate(repo, { guides = false, lazyGuides = null }, op) {
  const state = await content.loadState(repo, { guides });
  if (lazyGuides && lazyGuides(state)) await content.loadGuideTexts(repo, state);
  const out = op(state);
  if (!out.changes.length) return out.result;
  const saved = await repo.commit({ parent: state.head.commit, parentTree: state.head.tree, changes: out.changes, message: out.message });
  return { ...out.result, commit: saved.commit, commitUrl: saved.url };
}

export async function handle(request, env, deps = {}) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const isPage = path === '/admin';
  const isApi = path.startsWith('/api/admin/');
  if (!isPage && !isApi && !path.startsWith('/admin/')) {
    return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });
  }

  try {
    const problems = configProblems(env);
    if (problems.length) {
      return isApi ? json(503, { errors: ['The admin is not configured yet.'] }) : html(503, problemsPage(problems));
    }
    if (isPage && request.method === 'GET') {
      return (await readSession(env, request)) ? html(200, ADMIN_HTML) : html(200, loginPage(env));
    }
    if (!isApi) return new Response('Not found', { status: 404, headers: securityHeaders });

    const route = path.slice('/api/admin'.length);
    const mutating = !['GET', 'HEAD'].includes(request.method);
    if (mutating) {
      const origin = request.headers.get('Origin');
      if (!origin || origin !== url.origin) return json(403, { errors: ['Cross-origin request blocked.'] });
      if (request.headers.get('X-Admin-Request') !== '1') return json(403, { errors: ['Missing admin header.'] });
    }

    if (route === '/login' && request.method === 'POST') {
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      if (env.LOGIN_LIMIT) {
        const { success } = await env.LOGIN_LIMIT.limit({ key: ip });
        if (!success) return json(429, { errors: ['Too many attempts. Wait a minute and try again.'] });
      }
      const body = await readJsonBody(request);
      const passOk = await checkPassword(body.password, env);
      const codeOk = env.TOTP_SECRET ? await verifyTotp(env.TOTP_SECRET, body.code) : true;
      if (!passOk || !codeOk) {
        await sleep(deps.failDelay ?? 1500);
        return json(401, { errors: ['Incorrect login details.'] });
      }
      return json(200, { ok: true }, { 'Set-Cookie': sessionCookie(await makeSession(env)) });
    }
    if (route === '/logout' && request.method === 'POST') return json(200, { ok: true }, { 'Set-Cookie': clearCookie() });

    if (!(await readSession(env, request))) return json(401, { errors: ['Please sign in again.'], signedOut: true });

    const repo = deps.repo ? deps.repo(env) : createRepo(env);
    const ctx = ctxOf();

    if (request.method === 'GET' && route === '/meta') {
      return json(200, {
        brand: SNAPSHOT.brand, taxonomy: SNAPSHOT.taxonomy, categories: SNAPSHOT.categories.map((c) => ({ slug: c.slug, name: c.name })),
        customizeKeys: CUSTOMIZE_KEYS, customizeLabels: CUSTOMIZE_LABELS, passwordProtected: true, online: true, repo: repo.repo, branch: repo.branch,
      });
    }
    if (request.method === 'GET' && route === '/library') return json(200, content.libraryOf(await content.loadState(repo)));
    if (request.method === 'GET' && route === '/status') {
      const head = await repo.head();
      return json(200, { repo: repo.repo, branch: repo.branch, commit: head.commit, message: head.message, date: head.date, url: `https://github.com/${repo.repo}/commit/${head.commit}` });
    }
    if (request.method === 'GET' && route.startsWith('/image/')) {
      const v = /^([0-9a-f]{40})\.(jpg|jpeg|png|webp|avif)$/.exec(url.searchParams.get('v') || '');
      if (!v) return new Response('No image', { status: 404, headers: securityHeaders });
      const res = await repo.blobStream(v[1]);
      return new Response(res.body, { headers: { ...securityHeaders, 'Content-Type': MIME[v[2]], 'Cache-Control': 'private, max-age=31536000, immutable' } });
    }
    if (request.method === 'POST' && route === '/blob') {
      const body = await readJsonBody(request);
      const { b64, ext } = content.inspectDataUrl(body.dataUrl);
      return json(200, { sha: await repo.createBlob(b64), ext });
    }
    if (request.method === 'POST' && route === '/prompts') {
      const body = await readJsonBody(request);
      if (body.asDraft) throw new UserError(['Drafts are not available in the online admin. Publish the prompt, or use the local admin for drafts.']);
      const slugChanged = (state) => {
        if (!body.id || !state.guideEntries.length) return false;
        const prev = [...state.files.values()].flat().find((p) => p.id === body.id);
        return !!prev && prev.slug !== String(body.slug || '').trim();
      };
      return json(200, await mutate(repo, { lazyGuides: slugChanged }, (s) => content.savePrompt(s, ctx, body)));
    }
    if (request.method === 'DELETE' && route.startsWith('/prompts/')) {
      return json(200, await mutate(repo, { guides: true }, (s) => content.deletePrompt(s, ctx, decodeURIComponent(route.slice('/prompts/'.length)))));
    }
    if (request.method === 'POST' && route === '/bulk') {
      const body = await readJsonBody(request);
      if (body.asDraft) throw new UserError(['Drafts are not available in the online admin. Publish the prompts, or use the local admin for drafts.']);
      return json(200, await mutate(repo, {}, (s) => content.bulkPublish(s, ctx, body.items)));
    }
    if (request.method === 'GET' && route === '/guides') {
      const state = await content.loadState(repo, { guides: true });
      return json(200, { guides: content.listGuides(state) });
    }
    if (request.method === 'POST' && route === '/guides') {
      const body = await readJsonBody(request);
      return json(200, await mutate(repo, { guides: true }, (s) => content.saveGuide(s, ctx, body)));
    }
    if (request.method === 'DELETE' && route.startsWith('/guides/')) {
      return json(200, await mutate(repo, { guides: true }, (s) => content.deleteGuide(s, decodeURIComponent(route.slice('/guides/'.length)))));
    }
    if (request.method === 'POST' && route === '/preview-md') {
      const b = await readJsonBody(request);
      const r = renderMarkdown(String(b.body || ''));
      return json(200, { words: r.words, headings: r.headings.length, promptSlugs: r.promptSlugs });
    }
    return json(404, { errors: ['Not found'] });
  } catch (e) {
    if (e instanceof UserError) return json(e.status, { errors: e.errors });
    console.error('admin error', e && e.message);
    return json(500, { errors: ['Unexpected server error. Try again; if it keeps happening, check the Worker logs in Cloudflare.'] });
  }
}

export default { fetch: (request, env) => handle(request, env) };
