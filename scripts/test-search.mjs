// Unit tests for the search/filter logic (the same module the browser bundle uses).
import assert from 'node:assert/strict';
import { loadConfig } from './lib/config.mjs';
import { loadData } from './lib/data.mjs';
import { normalize, tokenize, filterEntries } from '../src/search-core.js';

const config = loadConfig();
const { prompts } = loadData(config);
const entries = prompts.map((p) => ({
  slug: p.slug, title: p.title, description: p.description, promptText: p.promptText, category: p.category,
  categoryName: p.categoryName, tags: p.tags, style: p.style, styleLabel: p.styleLabel, uses: p.uses,
  useLabels: p.useLabels, tools: p.supportedTools, publishedAt: p.publishedAt, featured: !!p.featured,
}));

let passed = 0;
const test = (name, fn) => {
  try { fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
};
const slugs = (opts) => filterEntries(entries, opts).map((e) => e.slug);

test('normalize handles case, accents and punctuation', () => {
  assert.equal(normalize('  CinemátIC—Portrait! '), 'cinematic portrait');
});
test('plural tokens also match singular', () => {
  assert.deepEqual(tokenize('headshots'), [['headshots', 'headshot']]);
  assert.ok(slugs({ q: 'headshots' }).includes('professional-studio-headshot'));
});
test('search is case-insensitive', () => {
  assert.deepEqual(slugs({ q: 'CINEMATIC' }), slugs({ q: 'cinematic' }));
});
test('empty query returns every prompt', () => {
  assert.equal(slugs({}).length, prompts.length);
});
test('gibberish returns nothing', () => {
  assert.equal(slugs({ q: 'zzzqqqxxx' }).length, 0);
});
test('all tokens must match (AND semantics)', () => {
  const r = slugs({ q: 'rain umbrella' });
  assert.equal(r[0], 'rainy-evening-couple-portrait');
  assert.equal(slugs({ q: 'rain umbrella nonexistentword' }).length, 0);
});
test('title matches rank above description-only matches', () => {
  const r = slugs({ q: 'golden hour' });
  assert.ok(r.includes('golden-hour-rooftop-portrait'));
  assert.equal(r[0], 'golden-hour-rooftop-portrait');
});
test('tags are searchable', () => {
  assert.ok(slugs({ q: 'streetwear' }).includes('streetwear-fashion-portrait'));
  assert.ok(slugs({ q: 'bokeh' }).length >= 2);
});
test('category names are searchable', () => {
  assert.ok(slugs({ q: 'landscapes' }).includes('dramatic-mountain-landscape'));
});
test('category filter restricts results', () => {
  const r = filterEntries(entries, { category: 'product-photography' });
  assert.equal(r.length, 3);
  assert.ok(r.every((e) => e.category === 'product-photography'));
});
test('style, use and tool filters combine', () => {
  const r = filterEntries(entries, { style: 'natural-light', use: 'social-media' });
  assert.ok(r.length >= 1 && r.every((e) => e.style === 'natural-light' && e.uses.includes('social-media')));
  const t = filterEntries(entries, { tool: 'midjourney' });
  assert.ok(t.length >= 1 && t.every((e) => e.tools.includes('midjourney')));
});
test('filters and query combine', () => {
  const r = filterEntries(entries, { q: 'portrait', category: 'cinematic-portraits' });
  assert.ok(r.length >= 1 && r.every((e) => e.category === 'cinematic-portraits'));
});
test('sort: recent is newest first', () => {
  const r = filterEntries(entries, { sort: 'recent' });
  for (let i = 1; i < r.length; i++) assert.ok(r[i - 1].publishedAt >= r[i].publishedAt);
});
test('sort: az is alphabetical', () => {
  const r = filterEntries(entries, { sort: 'az' });
  for (let i = 1; i < r.length; i++) assert.ok(r[i - 1].title.localeCompare(r[i].title) <= 0);
});
test('default sort puts featured prompts first', () => {
  const r = filterEntries(entries, {});
  const firstNonFeatured = r.findIndex((e) => !e.featured);
  assert.ok(r.slice(firstNonFeatured).every((e) => !e.featured));
});

console.log(process.exitCode ? '\n✗ Some search tests failed.' : `\n✓ ${passed} search tests passed.`);
