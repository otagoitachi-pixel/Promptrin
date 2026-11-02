// Tests for the ChatGPT publishing API (/api/gpt/*) against a fake GitHub and a fake file host.
import assert from 'node:assert/strict';
import { handle } from '../worker/index.js';
import { createRepo } from '../worker/github.js';
import { resetGptLimiters, parseItem, norm } from '../worker/gpt.js';
import { imageSize, nearestRatio } from '../worker/imageinfo.js';
import { openapi } from '../worker/openapi.js';
import { validateContent } from './lib/shared.mjs';
import { fakeGitHub } from './lib/fake-github.mjs';
import { SNAPSHOT } from '../worker/generated.js';

const ORIGIN = 'https://promptrin.test';
const SECRET = 'g'.repeat(48);
const env0 = { PROMPTRIN_GPT_SECRET: SECRET, ADMIN_PASSWORD: 'correct horse battery staple', SESSION_SECRET: 's'.repeat(40), GITHUB_TOKEN: 'ghp_fake', GITHUB_REPO: 'me/promptrin', GPT_CALLS_PER_MINUTE: '100000', GPT_PUBLISH_PER_MINUTE: '100000', ASSETS: { fetch: async (r) => new Response('', { status: new URL(r.url).pathname.includes('live-one') ? 200 : 404 }) } };
let gh, files, fetched;
const results = { pass: 0 };
async function test(name, fn) { resetGptLimiters(); try { await fn(); results.pass++; console.log('  ✓ ' + name); } catch (e) { console.error('  ✗ ' + name + '\n', e); process.exitCode = 1; } }

// ---- image bytes
function png(w = 1024, h = 1536, seed = 1, size = 4096) {
  const b = Buffer.alloc(size, seed);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]).copy(b, 0);
  b.write('IHDR', 12); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
  return b;
}
const HOST = 'https://files.oaiusercontent.com';
let n = 0;
const ref = (buf = png(1024, 1536, ++n), extra = {}) => { const id = `file_${++n}`; files.set(`${HOST}/${id}`, buf); return { name: `img${n}.png`, id, mime_type: 'image/png', download_link: `${HOST}/${id}`, ...extra }; };
const fetchFile = async (url) => { fetched.push(url); const b = files.get(url); if (!b) return new Response('gone', { status: 404 }); return new Response(b, { headers: { 'Content-Length': String(b.length) } }); };

const cats = SNAPSHOT.categories.map((c) => c.slug);
const style = Object.keys(SNAPSHOT.taxonomy.styles)[0];
let counter = 0;
function entry(over = {}) {
  const k = ++counter;
  const words = ['amber', 'velvet', 'crystal', 'marble', 'jasmine', 'saffron', 'cedar', 'opal', 'ivory', 'obsidian', 'coral', 'sage'];
  const w = words[k % words.length] + ' ' + words[(k * 5 + 1) % words.length];
  let seed = k * 7919;
  const pool = 'glacier ember harbor lantern meadow orchid pewter quartz ripple silk thistle umber vapor willow zephyr basalt copper dune fern gilded hazel indigo juniper kelp lilac mosaic nectar onyx pebble quill rustic sienna tundra velour wicker yarrow zinc azure bronze cobalt drift echo flint garnet haze iris jade karma lotus mist nimbus oasis prism quiet rain sable tidal unity verdant wisp xenon yonder zest'.split(' ');
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const unique = Array.from({ length: 14 }, () => pool[Math.floor(rnd() * pool.length)]).join(' ');
  return {
    title: `Luxury ${w} perfume bottle on wet stone ${k}`,
    description: `A close product photograph of a luxury perfume bottle with ${w} tones resting on wet stone, made for ecommerce banners.`,
    prompt: `Photograph of a luxury perfume bottle in ${w} glass on a wet dark stone surface, soft rim light from the left, tiny water droplets, reflective surface, shallow depth of field, 100mm macro lens, clean negative space, variation ${k}, mood ${unique}.`,
    category: 'product-photography', tags: ['perfume', 'luxury', `tone ${w}`], style, uses: ['advertising'],
    primary_keyword: `luxury ${w} perfume photography prompts ${k}`, secondary_keywords: ['perfume ad prompt'], search_intent: 'informational', target_country: 'United States',
    seo_title: `Luxury ${w} Perfume Photography Prompt ${k}`, meta_description: `Copy a ready-made AI prompt for luxury ${w} perfume photography with wet stone, rim light and a macro look. Variation ${k}.`,
    image_alt: `Luxury perfume bottle with ${w} tones on wet dark stone`, image_index: 0, ...over,
  };
}
const prompts = () => gh.paths().filter((p) => p.startsWith('data/prompts/')).flatMap((p) => JSON.parse(gh.read(p)).map((x) => ({ ...x, _file: p })));
const valid = () => validateContent({ ...SNAPSHOT, prompts: prompts() });
async function call(method, route, body, { env = env0, headers = { Authorization: `Bearer ${SECRET}` }, raw } = {}) {
  const h = { ...headers, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) };
  const res = await handle(new Request(ORIGIN + route, { method, headers: h, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) }), env, { failDelay: 0, repo: (e) => createRepo(e, gh.fetchImpl), fetchFile });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { res, data, text };
}
const publish = (items, refs, extra = {}) => call('POST', '/api/gpt/publish', { items, openaiFileIdRefs: refs, ...extra });
const reset = () => { gh = fakeGitHub(); files = new Map(); fetched = []; };

console.log('GPT publishing API');
reset();

await test('public endpoints: minimal health and the OpenAPI file; everything else needs the secret', async () => {
  const h = await call('GET', '/api/gpt/health', undefined, { headers: {} });
  assert.deepEqual(h.data, { status: 'ok', service: 'promptrin-gpt-api' });
  const o = await call('GET', '/api/gpt/openapi.json', undefined, { headers: {} });
  assert.equal(o.res.status, 200);
  assert.equal(o.data.servers[0].url, ORIGIN);
  assert.ok(!o.text.includes(SECRET));
  for (const r of ['/api/gpt/categories', '/api/gpt/tags', '/api/gpt/status/abc']) assert.equal((await call('GET', r, undefined, { headers: {} })).res.status, 401, r);
  assert.equal((await call('POST', '/api/gpt/publish', { items: [] }, { headers: {} })).res.status, 401);
  assert.equal(gh.state.calls, 0);
});
await test('authentication: wrong, malformed, admin password and admin cookie are all refused', async () => {
  for (const headers of [{ Authorization: 'Bearer nope' }, { Authorization: SECRET }, { Authorization: 'Basic ' + SECRET }, { Authorization: `Bearer ${env0.ADMIN_PASSWORD}` }, { Authorization: `Bearer ${SECRET}x` }, { Authorization: 'Bearer ' }, { Cookie: '__Host-promptrin_admin=abc' }, { 'X-Api-Key': SECRET }]) {
    const r = await call('GET', '/api/gpt/categories', undefined, { headers });
    assert.equal(r.res.status, 401, JSON.stringify(headers));
    assert.ok(!r.text.includes(SECRET));
  }
  assert.equal((await call('GET', '/api/gpt/categories')).res.status, 200);
});
await test('the GPT secret does not unlock the admin panel', async () => {
  const r = await handle(new Request(ORIGIN + '/api/admin/library', { headers: { Authorization: `Bearer ${SECRET}` } }), env0, { repo: (e) => createRepo(e, gh.fetchImpl) });
  assert.equal(r.status, 401);
  const l = await handle(new Request(ORIGIN + '/api/admin/login', { method: 'POST', headers: { Origin: ORIGIN, 'X-Admin-Request': '1' }, body: JSON.stringify({ password: SECRET }) }), env0, { failDelay: 0 });
  assert.equal(l.status, 401);
});
await test('fails closed: missing or short secret disables the API', async () => {
  for (const bad of [{ ...env0, PROMPTRIN_GPT_SECRET: undefined }, { ...env0, PROMPTRIN_GPT_SECRET: 'short' }, { ...env0, GITHUB_TOKEN: '' }]) {
    const r = await call('GET', '/api/gpt/categories', undefined, { env: bad });
    assert.equal(r.res.status, 503);
  }
});
await test('brute force: repeated failures lock the address out, even for the right secret', async () => {
  for (let i = 0; i < 10; i++) assert.equal((await call('GET', '/api/gpt/tags', undefined, { headers: { Authorization: 'Bearer wrong' } })).res.status, 401);
  const r = await call('GET', '/api/gpt/categories');
  assert.equal(r.res.status, 429);
  assert.ok(r.res.headers.get('Retry-After'));
});
await test('rate limits: general, publish and the optional binding', async () => {
  const low = { ...env0, GPT_CALLS_PER_MINUTE: undefined, GPT_PUBLISH_PER_MINUTE: undefined };
  for (let i = 0; i < 60; i++) assert.equal((await call('GET', '/api/gpt/categories', undefined, { env: low })).res.status, 200);
  assert.equal((await call('GET', '/api/gpt/categories', undefined, { env: low })).res.status, 429);
  resetGptLimiters();
  for (let i = 0; i < 8; i++) assert.equal((await call('POST', '/api/gpt/publish', { items: [] }, { env: low })).res.status, 400);
  assert.equal((await call('POST', '/api/gpt/publish', { items: [] }, { env: low })).res.status, 429);
  resetGptLimiters();
  const env = { ...env0, GPT_LIMIT: { limit: async () => ({ success: false }) } };
  assert.equal((await call('GET', '/api/gpt/categories', undefined, { env })).res.status, 429);
});
await test('categories and tags endpoints', async () => {
  const c = (await call('GET', '/api/gpt/categories')).data;
  assert.ok(c.categories.some((x) => x.slug === 'product-photography'));
  assert.ok(c.styles.length && c.uses.length && c.tools.length && c.ratios.includes('2:3'));
  const t = (await call('GET', '/api/gpt/tags')).data;
  assert.ok(t.tags.length && t.tags[0].count >= 1);
  const hh = (await call('GET', '/api/gpt/health')).data;
  assert.equal(hh.authenticated, true);
  assert.ok(!JSON.stringify(hh).includes('ghp_'));
});

await test('publish one prompt: image downloaded, one commit, URL returned, ratio detected', async () => {
  const before = gh.head;
  const e = entry();
  const r = await call('POST', '/api/gpt/publish/single', { ...e, image_index: undefined, openaiFileIdRefs: [ref()] });
  assert.equal(r.res.status, 200, r.text);
  assert.equal(r.data.status, 'published');
  const x = r.data.results[0];
  assert.equal(x.status, 'published');
  assert.match(x.url, /^https:\/\/promptrin\.test\/prompts\/luxury-.*\/$/);
  assert.equal(x.image.ratio, '2:3');
  assert.notEqual(gh.head, before);
  assert.ok(gh.paths().includes(x.imagePath));
  const saved = prompts().find((p) => p.slug === x.slug);
  assert.equal(saved.primaryKeyword, e.primary_keyword);
  assert.equal(saved.seoTitle, e.seo_title);
  assert.equal(saved.ratio, '2:3');
  assert.equal(saved.aspect, 'portrait');
  assert.equal(saved.tested, false);
  assert.equal(valid().errors.length, 0, valid().errors.join('; '));
  assert.match(r.data.commitUrl, /github\.com/);
  assert.equal(r.data.deployment.verified, false);
});
await test('bulk publish: 4 prompts, 4 images, exactly ONE commit', async () => {
  fetched.length = 0;
  const items = [0, 1, 2, 3].map((i) => entry({ image_index: i }));
  const refs = items.map(() => ref());
  const commits0 = gh.head;
  const r = await publish(items, refs);
  assert.equal(r.res.status, 200, r.text);
  assert.equal(r.data.published, 4);
  assert.equal(new Set(r.data.results.map((x) => x.slug)).size, 4);
  assert.equal(valid().errors.length, 0);
  assert.notEqual(gh.head, commits0);
  assert.equal(fetched.length, 4);
});
await test('invalid requests are refused with clear messages', async () => {
  const bad = async (body, status, re) => { const r = await call('POST', '/api/gpt/publish', body); assert.equal(r.res.status, status, r.text); assert.match(r.text, re); };
  await bad({}, 400, /items/);
  await bad({ items: 'x' }, 400, /items/);
  await bad({ items: [] }, 400, /items/);
  await bad({ items: [entry()], openaiFileIdRefs: 'x' }, 400, /list/);
  const raw = await call('POST', '/api/gpt/publish', undefined, { raw: '{not json' });
  assert.equal(raw.res.status, 400);
  const arr = await call('POST', '/api/gpt/publish', undefined, { raw: '[1,2]' });
  assert.equal(arr.res.status, 400);
  await bad({ items: Array.from({ length: 11 }, () => entry()), openaiFileIdRefs: [] }, 413, /at most 10/);
  const r = await publish([{}, 5, entry({ category: 'nope', tags: ['a'], style: 'bad', slug: 'Bad Slug', seo_title: 'x', image_index: -1 })], [ref()]);
  assert.equal(r.res.status, 422);
  const text = r.data.results.flatMap((x) => x.errors).join('\n');
  for (const re of [/title: required/, /category: "nope" is not a category/, /tags: add at least 2/, /style: "bad" is not valid/, /slug:/, /seo_title: too short/, /image_index: must be a whole number/, /Each entry must be an object/]) assert.match(text, re);
  assert.equal(valid().errors.length, 0);
});
await test('oversized request body is refused', async () => {
  const r = await call('POST', '/api/gpt/publish', undefined, { raw: JSON.stringify({ items: [], pad: 'x'.repeat(13 * 1024 * 1024) }) });
  assert.equal(r.res.status, 413);
});
await test('unsafe or invalid images are refused and nothing is committed', async () => {
  const before = gh.head;
  const cases = [
    ['text pretending to be png', ref(Buffer.from('<html>'.repeat(300)), {}), /not a valid JPEG, PNG or WebP/],
    ['too small dimensions', ref(png(100, 100, 3)), /usable size/],
    ['tiny file', ref(Buffer.concat([png(1024, 1024, 4).subarray(0, 100)])), /too small/],
    ['over the size limit', ref(png(1024, 1024, 5, 9 * 1024 * 1024)), /over the 8 MB limit/],
  ];
  for (const [name, r0, re] of cases) {
    const r = await publish([entry()], [r0]);
    assert.equal(r.res.status, 422, name);
    assert.match(r.text, re, name);
  }
  const hostile = [{ download_link: 'http://files.oaiusercontent.com/x' }, { download_link: 'https://evil.example/x.png' }, { download_link: 'https://files.oaiusercontent.com.evil.example/x' }, { download_link: 'https://user:pw@files.oaiusercontent.com/x' }, { download_link: 'file:///etc/passwd' }, { download_link: 'https://169.254.169.254/latest' }, {}];
  fetched.length = 0;
  for (const h of hostile) assert.equal((await publish([entry()], [h])).res.status, 422);
  assert.equal(fetched.length, 0, 'no request was made to a disallowed address');
  assert.equal((await publish([entry({ image_index: 3 })], [ref()])).res.status, 422);
  assert.equal((await publish([entry({ image_index: 0, image_base64: 'data:image/png;base64,AAAA' })], [ref()])).res.status, 422);
  assert.equal(gh.head, before);
});
await test('same image reference cannot be used twice in one request', async () => {
  const r = await publish([entry(), entry()], [ref()]);
  assert.equal(r.res.status, 422);
  assert.match(r.text, /already used by entry 1/);
});
await test('expired link (404 from the file host) is explained', async () => {
  const r = await publish([entry()], [{ download_link: `${HOST}/missing` }]);
  assert.equal(r.res.status, 422);
  assert.match(r.text, /expired|download failed/);
});
await test('inline base64 images work and are checked from their real bytes', async () => {
  const good = `data:image/png;base64,${png(1200, 1200, 9).toString('base64')}`;
  const e = entry({ image_index: undefined, image_base64: good });
  const r = await publish([e], []);
  assert.equal(r.res.status, 200, r.text);
  assert.equal(r.data.results[0].image.ratio, '1:1');
  const fake = `data:image/png;base64,${Buffer.from('<?php evil ?>'.repeat(200)).toString('base64')}`;
  assert.equal((await publish([entry({ image_index: undefined, image_base64: fake })], [])).res.status, 422);
});
await test('duplicates: slug, title, prompt text, keyword and SEO text are all caught', async () => {
  const base = entry();
  const first = await publish([base], [ref()]);
  assert.equal(first.res.status, 200, first.text);
  const slug = first.data.results[0].slug;
  const before = gh.head;
  const attempts = [
    ['same slug', entry({ slug }), /slug:.*already used/],
    ['same title', entry({ title: base.title }), /same title already exists/],
    ['same prompt', entry({ prompt: base.prompt }), /nearly identical/],
    ['near-same prompt', entry({ prompt: base.prompt + ' Extra detail.' }), /nearly identical/],
    ['same keyword', entry({ primary_keyword: base.primary_keyword.toUpperCase() }), /already targeted/],
    ['same seo title', entry({ seo_title: base.seo_title }), /seo_title: identical/],
    ['same meta description', entry({ meta_description: base.meta_description }), /meta_description: identical/],
  ];
  for (const [name, e, re] of attempts) {
    const r = await publish([e], [ref()]);
    assert.equal(r.res.status, 422, name);
    assert.match(r.text, re, name);
  }
  const twin = entry({ slug: 'twin-slug-test' });
  const dupBatch = await publish([twin, { ...entry(), slug: 'twin-slug-test' }], [ref(), ref()]);
  assert.equal(dupBatch.res.status, 422);
  assert.match(dupBatch.text, /already used/);
  const kw = await publish([{ ...entry(), primary_keyword: 'shared keyword phrase here' }, { ...entry(), primary_keyword: 'Shared keyword phrase HERE', image_index: 1 }], [ref(), ref()]);
  assert.equal(kw.res.status, 422);
  assert.match(kw.text, /already targeted/);
  assert.equal(gh.head, before);
  const allowed = await publish([entry({ primary_keyword: base.primary_keyword, allow_similar_keyword: true })], [ref()]);
  assert.equal(allowed.res.status, 200, allowed.text);
  assert.match(JSON.stringify(allowed.data.results[0].warnings), /already targeted/);
});
await test('re-sending the exact same request does not publish twice', async () => {
  const items = [entry()];
  const refs = [ref()];
  assert.equal((await publish(items, refs)).res.status, 200);
  const head = gh.head;
  const again = await publish(items, [ref()]);
  assert.equal(again.res.status, 422);
  assert.equal(gh.head, head);
});
await test('all-or-nothing: one bad entry means NOTHING is published', async () => {
  const head = gh.head;
  const items = [entry(), entry({ category: 'nope', image_index: 1 }), entry({ image_index: 2 })];
  const r = await publish(items, [ref(), ref(), ref()]);
  assert.equal(r.res.status, 422);
  assert.equal(r.data.status, 'rejected');
  assert.deepEqual(r.data.results.map((x) => x.status), ['rejected'.replace('rejected', 'not_published'), 'rejected', 'not_published']);
  assert.match(r.data.results[0].warnings.join(' '), /Nothing was changed/);
  assert.equal(gh.head, head);
});
await test('allow_partial publishes only the valid entries and reports each one', async () => {
  const items = [entry(), entry({ category: 'nope', image_index: 1 }), entry({ image_index: 2 })];
  const r = await publish(items, [ref(), ref(), ref()], { allow_partial: true });
  assert.equal(r.res.status, 200, r.text);
  assert.equal(r.data.status, 'partial');
  assert.deepEqual(r.data.results.map((x) => x.status), ['published', 'rejected', 'published']);
  assert.equal(valid().errors.length, 0);
});
await test('dry run checks everything but saves nothing', async () => {
  const head = gh.head, blobs = gh.state.blobCalls;
  const r = await publish([entry(), entry({ image_index: 1 })], [ref(), ref()], { dry_run: true });
  assert.equal(r.res.status, 200, r.text);
  assert.equal(r.data.status, 'dry_run');
  assert.deepEqual(r.data.results.map((x) => x.status), ['valid', 'valid']);
  assert.equal(gh.head, head);
  assert.equal(gh.state.blobCalls, blobs);
  const bad = await publish([entry({ category: 'nope' })], [ref()], { dry_run: true });
  assert.equal(bad.res.status, 422);
});
await test('GitHub failure during image upload: nothing is committed (no broken entries)', async () => {
  const head = gh.head;
  gh.state.failBlobOn = gh.state.blobCalls + 2;
  const r = await publish([entry(), entry({ image_index: 1 }), entry({ image_index: 2 })], [ref(), ref(), ref()]);
  assert.equal(r.res.status, 502);
  assert.equal(r.data.status, 'rejected');
  assert.ok(r.data.results.some((x) => /image upload failed/.test(x.errors.join())));
  assert.ok(!r.text.includes('ghp_fake'), 'token never appears in output');
  assert.equal(gh.head, head);
  assert.equal(valid().errors.length, 0);
});
await test('partial upload failure with allow_partial publishes only the entries whose image uploaded', async () => {
  gh.state.failBlobOn = gh.state.blobCalls + 2;
  const r = await publish([entry(), entry({ image_index: 1 }), entry({ image_index: 2 })], [ref(), ref(), ref()], { allow_partial: true });
  assert.equal(r.res.status, 200, r.text);
  assert.equal(r.data.status, 'partial');
  assert.equal(r.data.published, 2);
  for (const x of r.data.results.filter((y) => y.status === 'published')) assert.ok(gh.paths().includes(x.imagePath));
  assert.equal(valid().errors.length, 0);
});
await test('GitHub failures: conflict, bad token and outage give safe, clear errors', async () => {
  gh.state.failCommitOnce = true;
  const c = await publish([entry()], [ref()]);
  assert.equal(c.res.status, 409);
  assert.match(c.text, /changed while publishing/);
  const badGh = { fetchImpl: async () => new Response('{"message":"Bad credentials ghp_fake"}', { status: 401 }) };
  for (const [status, re] of [[401, /rejected the access token/], [403, /refused/], [404, /could not find/], [500, /GitHub returned an error/]]) {
    badGh.fetchImpl = async () => new Response('{"message":"x ghp_fake"}', { status });
    const r = await handle(new Request(ORIGIN + '/api/gpt/tags', { headers: { Authorization: `Bearer ${SECRET}` } }), env0, { failDelay: 0, repo: (e) => createRepo(e, badGh.fetchImpl) });
    const t = await r.text();
    assert.match(t, re);
    assert.ok(!t.includes('ghp_fake'));
    resetGptLimiters();
  }
  const off = await handle(new Request(ORIGIN + '/api/gpt/tags', { headers: { Authorization: `Bearer ${SECRET}` } }), env0, { failDelay: 0, repo: (e) => createRepo(e, async () => { throw new Error('network ghp_fake'); }) });
  assert.equal(off.status, 502);
  assert.ok(!(await off.text()).includes('ghp_fake'));
});
await test('subrequest budget: oversize batches are refused before any download', async () => {
  fetched.length = 0;
  const env = { ...env0, GPT_SUBREQUEST_LIMIT: '20' };
  const r = await call('POST', '/api/gpt/publish', { items: [0, 1, 2, 3, 4, 5, 6].map((i) => entry({ image_index: i })), openaiFileIdRefs: [0, 1, 2, 3, 4, 5, 6].map(() => ref()) }, { env });
  assert.equal(r.res.status, 413);
  assert.match(r.text, /at most \d+ prompts per request/);
  assert.equal(fetched.length, 0);
  const full = await publish(Array.from({ length: 10 }, (_, i) => entry({ image_index: i })), Array.from({ length: 10 }, () => ref()));
  assert.equal(full.res.status, 200, full.text);
  assert.ok(gh.state.calls > 0);
});
await test('text is cleaned: tags/markup/control characters never reach the data files', async () => {
  const e = entry({ title: 'Luxury <script>alert(1)</script> perfume‮ bottle study 77', image_alt: 'Perfume <b>bottle</b>\u0000 on stone with water droplets' });
  const r = await publish([e], [ref()]);
  assert.equal(r.res.status, 200, r.text);
  const p = prompts().find((x) => x.slug === r.data.results[0].slug);
  assert.ok(!/[<>‮\u0000]/.test(p.title + p.imageAlt), p.title);
  assert.ok(!/[^a-z0-9-]/.test(r.data.results[0].slug));
});
await test('status endpoint reports saved and live', async () => {
  const e = entry({ slug: 'live-one-test-slug' });
  assert.equal((await publish([e], [ref()])).res.status, 200);
  const s = (await call('GET', '/api/gpt/status/live-one-test-slug')).data;
  assert.equal(s.savedOnGitHub, true);
  assert.equal(s.live, true);
  const n2 = (await call('GET', '/api/gpt/status/never-published')).data;
  assert.equal(n2.savedOnGitHub, false);
  assert.equal((await call('GET', '/api/gpt/status/..%2Fetc')).res.status, 404);
});
await test('existing admin API still works next to the GPT API', async () => {
  const r = await handle(new Request(ORIGIN + '/api/admin/login', { method: 'POST', headers: { Origin: ORIGIN, 'X-Admin-Request': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ password: env0.ADMIN_PASSWORD }) }), env0, { failDelay: 0 });
  assert.equal(r.status, 200);
  const page = await handle(new Request(ORIGIN + '/prompts/x/'), env0, {});
  assert.equal(page.status, 404);
});
await test('image helpers: sizes for PNG, JPEG, WebP and nearest ratio', () => {
  assert.deepEqual(imageSize(png(640, 480)), { width: 640, height: 480 });
  const jpg = Buffer.alloc(2000, 0); Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 17, 8, 0x04, 0x00, 0x03, 0x00]).copy(jpg, 0);
  assert.deepEqual(imageSize(new Uint8Array(jpg)), { width: 768, height: 1024 });
  const webp = Buffer.alloc(64, 0); webp.write('RIFF', 0); webp.write('WEBP', 8); webp.write('VP8X', 12); webp.writeUIntLE(1599, 24, 3); webp.writeUIntLE(899, 27, 3);
  assert.deepEqual(imageSize(new Uint8Array(webp)), { width: 1600, height: 900 });
  assert.equal(nearestRatio({ width: 1024, height: 1536 }), '2:3');
  assert.equal(nearestRatio({ width: 1600, height: 900 }), '16:9');
  assert.equal(nearestRatio({ width: 1000, height: 1000 }), '1:1');
  assert.equal(norm('  Luxury  Perfume!! '), 'luxury perfume');
});
await test('parseItem: defaults and language check', () => {
  const p = parseItem({ ...entry(), uses: undefined, target_language: 'de' }, 0);
  assert.match(p.errors.join(), /target_language/);
  assert.match(p.warnings.join(), /uses was not given/);
  assert.match(parseItem({ ...entry(), status: 'draft' }, 0).errors.join(), /only "published"/);
});
await test('OpenAPI 3.1 file is complete and every $ref resolves', () => {
  const spec = openapi('https://x.example');
  assert.equal(spec.openapi, '3.1.0');
  const ops = Object.values(spec.paths).flatMap((p) => Object.values(p)).map((o) => o.operationId);
  assert.deepEqual(ops.sort(), ['getCategories', 'getHealth', 'getPromptStatus', 'getTags', 'publishPrompt', 'publishPrompts']);
  assert.equal(new Set(ops).size, ops.length);
  assert.equal(spec.components.securitySchemes.bearerAuth.scheme, 'bearer');
  const refs = JSON.stringify(spec).match(/#\/components\/schemas\/\w+/g);
  for (const r of refs) assert.ok(spec.components.schemas[r.split('/').pop()], r);
  for (const p of Object.values(spec.paths)) for (const o of Object.values(p)) { assert.ok(o.description.length <= 300, o.operationId); assert.ok(o.summary.length <= 80); }
  assert.deepEqual(spec.paths['/api/gpt/publish'].post.requestBody.content['application/json'].schema.properties.openaiFileIdRefs.items, { type: 'string' });
  assert.deepEqual(spec.components.schemas.PromptItem.properties.category.enum.sort(), cats.slice().sort());
});

console.log(`\n${results.pass} GPT API tests passed${process.exitCode ? ' (some FAILED)' : ''}.`);
