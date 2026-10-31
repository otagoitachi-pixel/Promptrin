// Static verification of dist/: links, metadata, headings, images, JSON-LD, sitemap, robots.
// Exits non-zero on any failure. Run after `npm run build`.
import fs from 'node:fs';
import path from 'node:path';
import { DIST } from './lib/config.mjs';

if (!fs.existsSync(DIST)) { console.error('dist/ not found. Run `npm run build` first.'); process.exit(1); }

const errors = [];
const warns = [];
const fail = (page, msg) => errors.push(`${page}: ${msg}`);
const warn = (page, msg) => warns.push(`${page}: ${msg}`);

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}
const files = walk(DIST);
const htmlFiles = files.filter((f) => f.endsWith('.html'));
const rel = (f) => '/' + path.relative(DIST, f).split(path.sep).join('/');
const urlOf = (f) => rel(f).replace(/index\.html$/, '');

function resolves(href) {
  const clean = decodeURI(href.split('#')[0].split('?')[0]);
  if (!clean) return true;
  const target = path.join(DIST, clean);
  if (clean.endsWith('/')) return fs.existsSync(path.join(target, 'index.html'));
  return fs.existsSync(target) && fs.statSync(target).isFile();
}

const titles = new Map();
const descs = new Map();
const indexable = new Set();
let linkCount = 0, imgCount = 0, ldCount = 0;

for (const f of htmlFiles) {
  const page = urlOf(f);
  const html = fs.readFileSync(f, 'utf8');
  const grab = (re) => (html.match(re) || [])[1];

  const title = grab(/<title>([^<]*)<\/title>/);
  const desc = grab(/<meta name="description" content="([^"]*)"/);
  const robots = grab(/<meta name="robots" content="([^"]*)"/);
  const canonical = grab(/<link rel="canonical" href="([^"]*)"/);
  const isIndexable = robots && !robots.includes('noindex');

  if (!title) fail(page, 'missing <title>');
  if (!desc) fail(page, 'missing meta description');
  if (!robots) fail(page, 'missing meta robots');
  if (!/<html lang="[a-z]{2}/.test(html)) fail(page, 'missing html lang');
  if (!/<meta name="viewport"/.test(html)) fail(page, 'missing viewport meta');
  if (!/<meta property="og:title"/.test(html) || !/<meta property="og:image"/.test(html)) fail(page, 'missing Open Graph tags');

  if (isIndexable) {
    indexable.add(page);
    if (!canonical) fail(page, 'indexable page without canonical');
    else if (!canonical.endsWith(page)) fail(page, `canonical ${canonical} does not match path`);
    if (titles.has(title)) fail(page, `duplicate title also on ${titles.get(title)}`); else titles.set(title, page);
    if (descs.has(desc)) fail(page, `duplicate description also on ${descs.get(desc)}`); else descs.set(desc, page);
    if (title && title.length > 72) warn(page, `long title (${title.length} chars)`);
    if (desc && (desc.length < 60 || desc.length > 175)) warn(page, `description length ${desc.length}`);
  }

  // exactly one h1 and no skipped heading levels inside <main>
  const main = (html.match(/<main[\s\S]*?<\/main>/) || [html])[0];
  const h1s = (main.match(/<h1[\s>]/g) || []).length;
  if (h1s !== 1) fail(page, `expected 1 <h1>, found ${h1s}`);
  let prev = 0;
  for (const m of main.matchAll(/<h([1-6])[\s>]/g)) {
    const lvl = Number(m[1]);
    if (prev && lvl > prev + 1) fail(page, `heading level jumps from h${prev} to h${lvl}`);
    prev = lvl;
  }

  // links
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  for (const m of html.matchAll(/<(?:a|link)\s[^>]*?href="([^"]*)"/g)) {
    const href = m[1];
    if (!href || /^(https?:|mailto:|tel:)/.test(href)) continue;
    linkCount++;
    if (href.startsWith('#')) { if (!ids.has(href.slice(1))) fail(page, `broken fragment ${href}`); continue; }
    if (!href.startsWith('/')) { fail(page, `relative link ${href}`); continue; }
    if (!resolves(href)) fail(page, `broken internal link ${href}`);
  }
  // external links must be safe
  for (const m of html.matchAll(/<a\s[^>]*target="_blank"[^>]*>/g)) if (!/rel="[^"]*noopener/.test(m[0])) fail(page, 'target=_blank without rel=noopener');

  // images
  for (const m of html.matchAll(/<img\s[^>]*>/g)) {
    const tag = m[0];
    imgCount++;
    const src = (tag.match(/\ssrc="([^"]*)"/) || [])[1];
    if (!src) { fail(page, 'img without src'); continue; }
    if (src.startsWith('/') && !resolves(src)) fail(page, `missing image file ${src}`);
    if (!/\salt="[^"]+"/.test(tag)) fail(page, `img without alt text: ${src}`);
    if (!/\swidth="\d+"/.test(tag) || !/\sheight="\d+"/.test(tag)) fail(page, `img without width/height: ${src}`);
  }

  // JSON-LD
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    ldCount++;
    try {
      const j = JSON.parse(m[1]);
      if (!j['@context'] || !j['@type']) fail(page, 'JSON-LD without @context/@type');
    } catch (e) { fail(page, 'invalid JSON-LD: ' + e.message); }
  }

  if (/undefined|\[object Object\]|NaN/.test(main.replace(/<script[\s\S]*?<\/script>/g, ''))) fail(page, 'page contains "undefined", "NaN" or "[object Object]"');
  if (/<button(?![^>]*aria-label)[^>]*>\s*<\/button>/.test(html)) fail(page, 'empty button without accessible name');
}

// sitemap
const sm = fs.existsSync(path.join(DIST, 'sitemap.xml')) ? fs.readFileSync(path.join(DIST, 'sitemap.xml'), 'utf8') : '';
if (!sm) fail('sitemap.xml', 'missing');
const locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
const locSet = new Set(locs);
if (locs.length !== locSet.size) fail('sitemap.xml', 'duplicate URLs');
for (const p of locs) {
  if (!resolves(p)) fail('sitemap.xml', `lists missing page ${p}`);
  else if (!indexable.has(p)) fail('sitemap.xml', `lists non-indexable page ${p}`);
}
for (const p of indexable) if (!locSet.has(p)) fail('sitemap.xml', `indexable page missing from sitemap: ${p}`);

// robots
const robots = fs.existsSync(path.join(DIST, 'robots.txt')) ? fs.readFileSync(path.join(DIST, 'robots.txt'), 'utf8') : '';
if (!/^Sitemap: https?:\/\/\S+\/sitemap\.xml$/m.test(robots)) fail('robots.txt', 'missing Sitemap line');
if (!/^User-agent: \*/m.test(robots)) fail('robots.txt', 'missing User-agent');

// search index
try {
  const idx = JSON.parse(fs.readFileSync(path.join(DIST, 'search-index.json'), 'utf8'));
  if (!Array.isArray(idx.prompts) || !idx.prompts.length) fail('search-index.json', 'empty');
  for (const e of idx.prompts) if (!resolves(`/prompts/${e.slug}/`)) fail('search-index.json', `entry ${e.slug} has no page`);
} catch (e) { fail('search-index.json', e.message); }

// ads must be absent when not configured
const homeHtml = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
if (!/data-ads-client/.test(homeHtml) && /adsbygoogle|googlesyndication|ca-pub-/.test(files.filter((f) => /\.(html|js)$/.test(f)).map((f) => fs.readFileSync(f, 'utf8')).join('').replace(/pagead2\.googlesyndication\.com\/pagead\/js\/adsbygoogle\.js\?client=|adsbygoogle/g, ''))) {
  fail('ads', 'ad identifiers present although ads are not configured');
}

// Cloudflare Pages limits (free plan): 20,000 files, 25 MiB per file, 100 header rules, 2,000 redirects,
// 2,000 characters per _headers line.
{
  if (files.length > 20000) fail('cloudflare', `${files.length} files; Pages allows 20,000`);
  for (const f of files) { const size = fs.statSync(f).size; if (size > 25 * 1024 * 1024) fail('cloudflare', `${path.relative(DIST, f)} is ${(size / 1048576).toFixed(1)} MiB; Pages allows 25 MiB per file`); }
  const hp = path.join(DIST, '_headers');
  if (fs.existsSync(hp)) {
    const lines = fs.readFileSync(hp, 'utf8').split('\n');
    if (lines.some((l) => l.length > 2000)) fail('_headers', 'a line is longer than 2,000 characters');
    if (lines.filter((l) => l && !/^\s/.test(l)).length > 100) fail('_headers', 'more than 100 rules');
  }
  const rp = path.join(DIST, '_redirects');
  if (fs.existsSync(rp) && fs.readFileSync(rp, 'utf8').split('\n').filter(Boolean).length > 2000) fail('_redirects', 'more than 2,000 redirects');
  if (!fs.existsSync(path.join(DIST, '404.html'))) fail('cloudflare', '404.html is missing');
  if (!fs.existsSync(path.join(DIST, 'index.html'))) fail('cloudflare', 'index.html is missing at the top of dist/');
}

console.log(`Checked ${htmlFiles.length} HTML pages, ${linkCount} internal links, ${imgCount} images, ${ldCount} JSON-LD blocks, ${locs.length} sitemap URLs.`);
for (const w of warns) console.log('⚠ ' + w);
if (errors.length) {
  console.error(`\n✗ ${errors.length} problem(s):\n  - ` + errors.join('\n  - '));
  process.exit(1);
}
console.log('✓ All static checks passed.');
