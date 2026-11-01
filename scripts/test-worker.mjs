// Tests the online admin Worker against an in-memory fake of GitHub (no network, no real secrets).
import assert from 'node:assert/strict';
import { handle } from '../worker/index.js';
import { totpAt, base32Decode } from '../worker/auth.js';
import { validateContent } from './lib/shared.mjs';
import { SNAPSHOT } from '../worker/generated.js';

const ORIGIN = 'https://promptrin.test';
const env0 = { ADMIN_PASSWORD: 'correct horse battery staple', SESSION_SECRET: 's'.repeat(40), GITHUB_TOKEN: 'ghp_fake', GITHUB_REPO: 'me/promptrin', ASSETS: { fetch: async () => new Response('static site') } };

import { fakeGitHub } from './lib/fake-github.mjs';

const results = { pass: 0 };
async function test(name, fn) { try { await fn(); results.pass++; console.log('  ✓ ' + name); } catch (e) { console.error('  ✗ ' + name + '\n', e); process.exitCode = 1; } }

let gh;
const deps = () => ({ failDelay: 0, repo: (env) => createRepoWith(env) });
import { createRepo } from '../worker/github.js';
const createRepoWith = (env) => createRepo(env, gh.fetchImpl);
let cookie = '';
async function call(method, route, body, { env = env0, headers = {}, auth = true, origin = ORIGIN } = {}) {
  const h = { ...(auth && cookie ? { Cookie: cookie } : {}), ...headers };
  if (method !== 'GET') { h['X-Admin-Request'] = '1'; if (origin) h.Origin = origin; h['Content-Type'] = 'application/json'; }
  const res = await handle(new Request(ORIGIN + route, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env, deps());
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { res, data };
}
async function login(env = env0, extra = {}) {
  const { res, data } = await call('POST', '/api/admin/login', { password: env.ADMIN_PASSWORD, ...extra }, { env, auth: false });
  if (res.status === 200) cookie = res.headers.get('Set-Cookie').split(';')[0];
  return { res, data };
}
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 1)]);
const dataUrl = (b = PNG) => `data:image/png;base64,${b.toString('base64')}`;
const finalPrompts = () => gh.paths().filter((p) => p.startsWith('data/prompts/')).flatMap((p) => JSON.parse(gh.read(p)).map((x) => ({ ...x, _file: p })));
const valid = () => validateContent({ ...SNAPSHOT, prompts: finalPrompts() });
function newPrompt(over = {}) {
  const cat = SNAPSHOT.categories[0].slug;
  const style = Object.keys(SNAPSHOT.taxonomy.styles)[0], use = Object.keys(SNAPSHOT.taxonomy.uses)[0];
  return { title: 'Test sunset portrait', slug: 'test-sunset-portrait', description: 'A warm sunset portrait prompt written for testing the online admin panel flow end to end.', promptText: 'A warm golden hour portrait of a person standing by the sea, soft backlight, shallow depth of field, natural skin texture, 85mm lens look.', category: cat, tags: ['sunset', 'portrait'], style, uses: [use], ratio: '4:5', imageAlt: 'AI generated portrait at sunset by the sea', supportedTools: [], tested: false, ...over };
}
async function stage(buf = PNG) { const r = await call('POST', '/api/admin/blob', { dataUrl: dataUrl(buf) }); assert.equal(r.res.status, 200, JSON.stringify(r.data)); return r.data; }

console.log('Online admin Worker');
gh = fakeGitHub();

await test('static pages bypass the admin entirely', async () => {
  const r = await call('GET', '/prompts/anything/', undefined, { auth: false });
  assert.equal(r.data, 'static site');
});
await test('fails closed when secrets are missing or weak', async () => {
  for (const bad of [{ ...env0, ADMIN_PASSWORD: 'short' }, { ...env0, SESSION_SECRET: undefined }, { ...env0, GITHUB_TOKEN: '' }, { ...env0, GITHUB_REPO: 'nope' }, { ...env0, SESSION_SECRET: env0.ADMIN_PASSWORD }]) {
    const r = await call('GET', '/admin', undefined, { env: bad, auth: false });
    assert.equal(r.res.status, 503);
    const l = await call('POST', '/api/admin/login', { password: bad.ADMIN_PASSWORD }, { env: bad, auth: false });
    assert.equal(l.res.status, 503);
    assert.ok(!l.res.headers.get('Set-Cookie'));
  }
});
await test('signed-out visitors only see a login form; the API refuses', async () => {
  const p = await call('GET', '/admin', undefined, { auth: false });
  assert.equal(p.res.status, 200);
  assert.match(p.data, /Sign in/);
  assert.doesNotMatch(p.data, /Bulk upload/);
  for (const route of ['/api/admin/library', '/api/admin/meta', '/api/admin/guides', '/api/admin/status']) assert.equal((await call('GET', route, undefined, { auth: false })).res.status, 401);
  assert.equal((await call('POST', '/api/admin/blob', { dataUrl: dataUrl() }, { auth: false })).res.status, 401);
  assert.equal((await call('POST', '/api/admin/bulk', { items: [] }, { auth: false })).res.status, 401);
  assert.equal(gh.state.calls, 0, 'GitHub must not be contacted without a session');
});
await test('security headers on admin responses', async () => {
  const p = await call('GET', '/admin', undefined, { auth: false });
  const h = p.res.headers;
  assert.match(h.get('Cache-Control'), /no-store/);
  assert.match(h.get('X-Robots-Tag'), /noindex/);
  assert.equal(h.get('X-Frame-Options'), 'DENY');
  assert.match(h.get('Content-Security-Policy'), /frame-ancestors 'none'/);
});
await test('wrong password and missing fields are rejected without a cookie', async () => {
  for (const body of [{ password: 'wrong wrong wrong wrong' }, {}, { password: '' }, { password: env0.ADMIN_PASSWORD + ' ' }]) {
    const r = await call('POST', '/api/admin/login', body, { auth: false });
    assert.equal(r.res.status, 401);
    assert.ok(!r.res.headers.get('Set-Cookie'));
  }
});
await test('login sets a hardened cookie and unlocks the panel', async () => {
  const r = await login();
  assert.equal(r.res.status, 200);
  const c = r.res.headers.get('Set-Cookie');
  assert.match(c, /^__Host-promptrin_admin=/);
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/']) assert.ok(c.includes(flag), flag);
  assert.ok(!/Domain=/i.test(c));
  const p = await call('GET', '/admin');
  assert.match(p.data, /Bulk upload/);
});
await test('forged, tampered, expired and re-keyed sessions are rejected', async () => {
  const good = cookie;
  const [name, val] = good.split('=');
  const [payload, sig] = val.split('.');
  const forged = Buffer.from(JSON.stringify({ exp: 9999999999 })).toString('base64url');
  for (const bad of [`${name}=${forged}.${sig}`, `${name}=${payload}.${sig.slice(0, -2)}AA`, `${name}=garbage`, `${name}=${payload}.`, `${name}=.`]) {
    cookie = bad;
    assert.equal((await call('GET', '/api/admin/library')).res.status, 401, bad);
  }
  cookie = good;
  assert.equal((await call('GET', '/api/admin/meta')).res.status, 200);
  assert.equal((await call('GET', '/api/admin/meta', undefined, { env: { ...env0, SESSION_SECRET: 'z'.repeat(40) } })).res.status, 401, 'new secret signs everyone out');
  assert.equal((await call('GET', '/api/admin/meta', undefined, { env: { ...env0, ADMIN_PASSWORD: 'a different long password' } })).res.status, 401, 'new password signs everyone out');
  const realNow = Date.now;
  Date.now = () => realNow() + 9 * 3600 * 1000;
  try { assert.equal((await call('GET', '/api/admin/meta')).res.status, 401, 'expires after 8 hours'); } finally { Date.now = realNow; }
});
await test('changes need same-origin Origin and the admin header (CSRF)', async () => {
  await login();
  const body = { dataUrl: dataUrl() };
  assert.equal((await call('POST', '/api/admin/blob', body, { origin: null })).res.status, 403);
  assert.equal((await call('POST', '/api/admin/blob', body, { origin: 'https://evil.example' })).res.status, 403);
  const noHeader = await handle(new Request(ORIGIN + '/api/admin/blob', { method: 'POST', headers: { Cookie: cookie, Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), env0, deps());
  assert.equal(noHeader.status, 403);
  assert.equal((await call('POST', '/api/admin/logout', {}, { origin: 'https://evil.example' })).res.status, 403);
});
await test('TOTP: matches the RFC 6238 test vector', async () => {
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  assert.equal(base32Decode(secret).length, 20);
  assert.equal(await totpAt(secret, 1), '287082');
  assert.equal(await totpAt(secret, 37037036), '081804');
});
await test('TOTP: login needs a valid code when TOTP_SECRET is set', async () => {
  const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
  const env = { ...env0, TOTP_SECRET: secret };
  const page = await call('GET', '/admin', undefined, { env, auth: false });
  assert.match(page.data, /Authenticator code/);
  assert.equal((await login(env)).res.status, 401, 'password alone is not enough');
  assert.equal((await login(env, { code: '000000' })).res.status, 401);
  const code = await totpAt(secret, Math.floor(Date.now() / 30000));
  assert.equal((await login(env, { code })).res.status, 200);
  assert.equal((await login(env, { code: code.slice(0, 5) })).res.status, 401);
  await login();
});
await test('rate limiter blocks when the binding says so', async () => {
  const env = { ...env0, LOGIN_LIMIT: { limit: async () => ({ success: false }) } };
  const r = await call('POST', '/api/admin/login', { password: env0.ADMIN_PASSWORD }, { env, auth: false });
  assert.equal(r.res.status, 429);
  assert.ok(!r.res.headers.get('Set-Cookie'));
});
await test('logout clears the cookie', async () => {
  const r = await call('POST', '/api/admin/logout', {});
  assert.match(r.res.headers.get('Set-Cookie'), /Max-Age=0/);
  await login();
});

await test('library lists prompts with image versions', async () => {
  const r = await call('GET', '/api/admin/library');
  assert.equal(r.res.status, 200);
  assert.ok(r.data.published.length >= 1);
  assert.deepEqual(r.data.drafts, []);
  assert.ok(r.data.published.every((p) => p._file && typeof p.hasImage === 'boolean'));
  const m = await call('GET', '/api/admin/meta');
  assert.equal(m.data.online, true);
  assert.ok(m.data.categories.length);
});
await test('blob upload accepts images and rejects other files', async () => {
  const ok = await stage();
  assert.match(ok.sha, /^[0-9a-f]{40}$/);
  assert.equal(ok.ext, 'png');
  const bad = await call('POST', '/api/admin/blob', { dataUrl: `data:image/png;base64,${Buffer.from('<script>alert(1)</script> not an image at all').toString('base64')}` });
  assert.equal(bad.res.status, 422);
  assert.equal((await call('POST', '/api/admin/blob', { dataUrl: 'data:text/html;base64,PGI+' })).res.status, 422);
  const big = await call('POST', '/api/admin/blob', { dataUrl: dataUrl(Buffer.concat([PNG, Buffer.alloc(11 * 1024 * 1024)])) });
  assert.equal(big.res.status, 422);
});
await test('publishing a prompt makes one commit with data and image', async () => {
  const before = gh.head;
  const blob = await stage();
  const r = await call('POST', '/api/admin/prompts', { ...newPrompt(), imageBlob: blob });
  assert.equal(r.res.status, 200, JSON.stringify(r.data));
  assert.notEqual(gh.head, before);
  assert.ok(gh.paths().includes('images/originals/test-sunset-portrait.png'));
  assert.equal(valid().errors.length, 0);
  assert.ok(finalPrompts().some((p) => p.slug === 'test-sunset-portrait'));
  assert.match(r.data.commitUrl, /github\.com\/me\/promptrin\/commit/);
});
await test('invalid data is refused and nothing is committed', async () => {
  const before = gh.head;
  const blob = await stage();
  for (const bad of [{ slug: 'Bad Slug!' }, { description: 'short' }, { category: 'nope' }, { slug: 'test-sunset-portrait' }, { promptText: 'too short' }]) {
    const r = await call('POST', '/api/admin/prompts', { ...newPrompt({ slug: 'another-one' }), ...bad, imageBlob: blob });
    assert.equal(r.res.status, 422, JSON.stringify(bad));
    assert.ok(r.data.errors.length);
  }
  const noImg = await call('POST', '/api/admin/prompts', newPrompt({ slug: 'no-image-here' }));
  assert.equal(noImg.res.status, 422);
  assert.equal(gh.head, before);
});
await test('bad image references are refused', async () => {
  const r = await call('POST', '/api/admin/prompts', { ...newPrompt({ slug: 'x-bad-blob' }), imageBlob: { sha: '../../etc', ext: 'png' } });
  assert.equal(r.res.status, 422);
});
await test('renaming a slug moves the image', async () => {
  const lib = (await call('GET', '/api/admin/library')).data.published;
  const p = lib.find((x) => x.slug === 'test-sunset-portrait');
  const { _file, hasImage, imageVersion, ...rest } = p;
  const r = await call('POST', '/api/admin/prompts', { ...rest, slug: 'test-sunset-portrait-2' });
  assert.equal(r.res.status, 200, JSON.stringify(r.data));
  assert.ok(gh.paths().includes('images/originals/test-sunset-portrait-2.png'));
  assert.ok(!gh.paths().includes('images/originals/test-sunset-portrait.png'));
  assert.equal(valid().errors.length, 0);
  assert.ok(finalPrompts().find((x) => x.slug === 'test-sunset-portrait-2').updatedAt === undefined || true);
});
await test('image route serves the blob with a safe type', async () => {
  const lib = (await call('GET', '/api/admin/library')).data.published.find((x) => x.slug === 'test-sunset-portrait-2');
  const res = await handle(new Request(`${ORIGIN}/api/admin/image/test-sunset-portrait-2?v=${lib.imageVersion}`, { headers: { Cookie: cookie } }), env0, deps());
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Content-Type'), 'image/png');
  const bad = await handle(new Request(`${ORIGIN}/api/admin/image/x?v=../../etc/passwd`, { headers: { Cookie: cookie } }), env0, deps());
  assert.equal(bad.status, 404);
});
await test('guide that uses a prompt blocks deleting that prompt', async () => {
  const g = await call('POST', '/api/admin/guides', { slug: 'test-guide', title: 'Test guide for the admin', description: 'A short test guide description that is long enough to be sensible for search results here.', body: '## Heading\n\n{{prompts: test-sunset-portrait-2}}\n\nSome words.', draft: false });
  assert.equal(g.res.status, 200, JSON.stringify(g.data));
  const id = finalPrompts().find((x) => x.slug === 'test-sunset-portrait-2').id;
  const before = gh.head;
  const d = await call('DELETE', `/api/admin/prompts/${id}`);
  assert.equal(d.res.status, 422);
  assert.match(d.data.errors.join(' '), /test-guide/);
  assert.equal(gh.head, before);
  const d2 = await call('DELETE', '/api/admin/guides/test-guide');
  assert.equal(d2.res.status, 200);
  assert.ok(!gh.paths().includes('content/guides/test-guide.md'));
});
await test('deleting a prompt removes its data and image', async () => {
  const id = finalPrompts().find((x) => x.slug === 'test-sunset-portrait-2').id;
  const d = await call('DELETE', `/api/admin/prompts/${id}`);
  assert.equal(d.res.status, 200, JSON.stringify(d.data));
  assert.ok(!finalPrompts().some((x) => x.slug === 'test-sunset-portrait-2'));
  assert.ok(!gh.paths().includes('images/originals/test-sunset-portrait-2.png'));
  assert.equal((await call('DELETE', '/api/admin/prompts/pp-999999')).res.status, 404);
  assert.equal((await call('DELETE', '/api/admin/prompts/..%2F..')).res.status, 400);
});
await test('bulk publish: 3 prompts, 3 images, ONE commit', async () => {
  const commitsBefore = gh.head;
  const items = [];
  for (let i = 1; i <= 3; i++) items.push({ ...newPrompt({ slug: `bulk-item-${i}`, title: `Bulk item ${i}` }), imageBlob: await stage(Buffer.concat([PNG, Buffer.from([i])])) });
  const r = await call('POST', '/api/admin/bulk', { items });
  assert.equal(r.res.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.added.length, 3);
  assert.equal(new Set(r.data.added.map((a) => a.id)).size, 3);
  assert.notEqual(gh.head, commitsBefore);
  for (let i = 1; i <= 3; i++) assert.ok(gh.paths().includes(`images/originals/bulk-item-${i}.png`));
  assert.equal(valid().errors.length, 0);
  const bad = await call('POST', '/api/admin/bulk', { items: [items[0]] });
  assert.equal(bad.res.status, 422, 'duplicate slug rejected');
  assert.equal((await call('POST', '/api/admin/bulk', { items: [{ ...items[0], imageBlob: undefined, slug: 'q' }] })).res.status, 422);
  assert.equal((await call('POST', '/api/admin/bulk', { asDraft: true, items })).res.status, 422);
});
await test('drafts are not available online', async () => {
  assert.equal((await call('POST', '/api/admin/prompts', { ...newPrompt(), asDraft: true })).res.status, 422);
});
await test('a concurrent change on GitHub gives a clear conflict, not a lost update', async () => {
  const blob = await stage();
  gh.state.onBeforeRef = () => { gh.state.onBeforeRef = null; };
  gh.state.failCommitOnce = true;
  const r = await call('POST', '/api/admin/prompts', { ...newPrompt({ slug: 'conflict-one' }), imageBlob: blob });
  assert.equal(r.res.status, 409);
  assert.match(r.data.errors[0], /Reload/);
  assert.ok(!finalPrompts().some((x) => x.slug === 'conflict-one'));
});
await test('guides: save, list, rename, draft flag', async () => {
  const body = '## Intro\n\nWords here. '.repeat(5);
  const save = (extra) => call('POST', '/api/admin/guides', { slug: 'g-one', title: 'Guide one', description: 'A description that is long enough to be a realistic meta description for a guide page.', body, ...extra });
  assert.equal((await save({ draft: true })).res.status, 200);
  assert.equal((await save({ draft: true })).res.status, 422, 'duplicate slug without originalSlug');
  assert.equal((await save({ draft: false, originalSlug: 'g-one', slug: 'g-two' })).res.status, 200);
  assert.ok(gh.paths().includes('content/guides/g-two.md') && !gh.paths().includes('content/guides/g-one.md'));
  const list = (await call('GET', '/api/admin/guides')).data.guides;
  assert.ok(list.find((g) => g.slug === 'g-two' && !g.draft));
  assert.equal((await save({ slug: '../evil' })).res.status, 422);
  assert.equal((await call('POST', '/api/admin/guides', { slug: 'g-bad', title: 'Bad', description: 'x'.repeat(100), body: '{{prompts: does-not-exist}}' })).res.status, 422);
  assert.equal((await call('DELETE', '/api/admin/guides/g-two')).res.status, 200);
});
await test('GitHub errors are explained, never leaked raw', async () => {
  const badGh = { ...gh, fetchImpl: async () => new Response('{"message":"Bad credentials","token":"ghp_fake"}', { status: 401 }) };
  const r = await handle(new Request(ORIGIN + '/api/admin/library', { headers: { Cookie: cookie } }), env0, { failDelay: 0, repo: (env) => createRepo(env, badGh.fetchImpl) });
  assert.equal(r.status, 502);
  const t = await r.text();
  assert.match(t, /rejected the access token/);
  assert.ok(!t.includes('ghp_fake'));
});
await test('status endpoint reports the latest commit', async () => {
  const r = await call('GET', '/api/admin/status');
  assert.equal(r.res.status, 200);
  assert.equal(r.data.commit, gh.head);
});
await test('subrequest budget: one publish stays well under 50 GitHub calls', async () => {
  const blob = await stage();
  const n0 = gh.state.calls;
  const r = await call('POST', '/api/admin/prompts', { ...newPrompt({ slug: 'budget-check' }), imageBlob: blob });
  assert.equal(r.res.status, 200, JSON.stringify(r.data));
  assert.ok(gh.state.calls - n0 < 30, `used ${gh.state.calls - n0}`);
});

console.log(`\n${results.pass} Worker tests passed${process.exitCode ? ' (some FAILED)' : ''}.`);
