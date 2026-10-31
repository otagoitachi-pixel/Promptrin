// Loads and validates all content. The build fails with a readable list of problems
// instead of silently shipping broken pages.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.mjs';

const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const RATIO = /^(\d{1,2}):(\d{1,2})$/;
export const CUSTOMIZE_KEYS = ['lighting', 'camera', 'background', 'wardrobe', 'mood', 'composition', 'aspectRatio'];
export const CUSTOMIZE_LABELS = {
  lighting: 'Lighting',
  camera: 'Camera angle and lens',
  background: 'Background',
  wardrobe: 'Clothing',
  mood: 'Mood',
  composition: 'Composition',
  aspectRatio: 'Aspect ratio',
};

export function loadData(config) {
  const taxonomy = readJson('data/taxonomy.json');
  const categories = readJson('data/categories.json');
  const promptDir = path.join(ROOT, 'data/prompts');
  const files = fs.readdirSync(promptDir).filter((f) => f.endsWith('.json')).sort();
  let prompts = [];
  for (const f of files) {
    const list = JSON.parse(fs.readFileSync(path.join(promptDir, f), 'utf8'));
    if (!Array.isArray(list)) throw new Error(`data/prompts/${f} must contain a JSON array`);
    prompts.push(...list.map((p) => ({ ...p, _file: f })));
  }
  const redirects = fs.existsSync(path.join(ROOT, 'data/redirects.json')) ? readJson('data/redirects.json') : [];

  const errors = [];
  const warnings = [];
  const today = new Date().toISOString().slice(0, 10);
  const catBySlug = new Map();

  // ---- categories ----
  for (const c of categories) {
    const where = `category "${c.slug}"`;
    if (!c.slug || !SLUG.test(c.slug)) errors.push(`${where}: invalid slug`);
    if (catBySlug.has(c.slug)) errors.push(`${where}: duplicate slug`);
    catBySlug.set(c.slug, c);
    for (const k of ['name', 'short']) if (!c[k]) errors.push(`${where}: missing "${k}"`);
    if (!Array.isArray(c.intro) || c.intro.length < 1) errors.push(`${where}: "intro" must be a non-empty array of paragraphs`);
    if (!Array.isArray(c.palette) || c.palette.length !== 3 || !c.palette.every((x) => /^#[0-9a-f]{6}$/i.test(x))) {
      errors.push(`${where}: "palette" must be three #rrggbb colours`);
    }
  }
  for (const c of categories) {
    for (const r of c.related || []) if (!catBySlug.has(r)) errors.push(`category "${c.slug}": unknown related category "${r}"`);
  }

  // ---- prompts ----
  const ids = new Set();
  const slugs = new Set();
  for (const p of prompts) {
    const where = `prompt "${p.slug || p.id || '?'}" (${p._file})`;
    for (const k of ['id', 'slug', 'title', 'description', 'promptText', 'category', 'imageAlt', 'publishedAt', 'language', 'style', 'ratio']) {
      if (p[k] === undefined || p[k] === null || p[k] === '') errors.push(`${where}: missing required field "${k}"`);
    }
    if (p.slug && !SLUG.test(p.slug)) errors.push(`${where}: slug must be lowercase letters, numbers and hyphens`);
    if (ids.has(p.id)) errors.push(`${where}: duplicate id "${p.id}"`);
    if (slugs.has(p.slug)) errors.push(`${where}: duplicate slug`);
    ids.add(p.id);
    slugs.add(p.slug);
    if (!catBySlug.has(p.category)) errors.push(`${where}: unknown category "${p.category}"`);
    if (p.promptText && p.promptText.length < 80) errors.push(`${where}: promptText is too short to be useful`);
    if (p.description && p.description.length < 60) errors.push(`${where}: description is too short`);
    if (!Array.isArray(p.tags) || p.tags.length === 0) errors.push(`${where}: "tags" must be a non-empty array`);
    if (!Array.isArray(p.uses) || p.uses.length === 0) errors.push(`${where}: "uses" must be a non-empty array`);
    if (p.style && !taxonomy.styles[p.style]) errors.push(`${where}: unknown style "${p.style}"`);
    for (const u of p.uses || []) if (!taxonomy.uses[u]) errors.push(`${where}: unknown use "${u}"`);
    if (!Array.isArray(p.supportedTools)) errors.push(`${where}: "supportedTools" must be an array`);
    for (const t of p.supportedTools || []) if (!taxonomy.tools[t]) errors.push(`${where}: unknown tool "${t}"`);
    if (p.ratio && !RATIO.test(p.ratio)) errors.push(`${where}: ratio must look like "4:5"`);
    if (p.publishedAt && !ISO_DATE.test(p.publishedAt)) errors.push(`${where}: publishedAt must be YYYY-MM-DD`);
    if (p.updatedAt) {
      if (!ISO_DATE.test(p.updatedAt)) errors.push(`${where}: updatedAt must be YYYY-MM-DD`);
      else if (p.publishedAt && p.updatedAt < p.publishedAt) errors.push(`${where}: updatedAt is earlier than publishedAt`);
    }
    if (p.publishedAt && p.publishedAt > today) warnings.push(`${where}: publishedAt is in the future; it is still built, but check the date.`);
    if (typeof p.tested !== 'boolean') errors.push(`${where}: "tested" must be true or false`);
    if (p.language && p.language.length !== 2) errors.push(`${where}: language must be a 2-letter code`);
    // The customisation guide and "why it works" note are optional so large batches can be published
    // quickly. Pages simply leave those sections out when they are empty.
    if (p.customize && typeof p.customize === 'object') {
      const missing = CUSTOMIZE_KEYS.filter((k) => !p.customize[k]);
      if (missing.length && missing.length < CUSTOMIZE_KEYS.length) warnings.push(`${where}: customize guide is incomplete (missing ${missing.join(', ')}); it will be hidden.`);
    }
    if (p.seoTitle && p.seoTitle.length > 70) warnings.push(`${where}: seoTitle is ${p.seoTitle.length} characters; Google may cut it off after about 60.`);
    if (p.seoDescription && p.seoDescription.length > 170) warnings.push(`${where}: seoDescription is ${p.seoDescription.length} characters; Google may cut it off after about 155.`);
    if (p.imageAlt && p.imageAlt.length > 160) warnings.push(`${where}: imageAlt is very long (${p.imageAlt.length} characters).`);
  }

  // Customisation text must not be copy-pasted between prompts (thin/duplicate content guard).
  const seenGuide = new Map();
  for (const p of prompts) {
    for (const k of CUSTOMIZE_KEYS) {
      const v = p.customize?.[k];
      if (!v) continue;
      const key = `${k}:${v}`;
      if (seenGuide.has(key)) warnings.push(`prompt "${p.slug}": customize.${k} is identical to "${seenGuide.get(key)}"`);
      else seenGuide.set(key, p.slug);
    }
  }

  // Redirects must point somewhere real.
  const knownPaths = new Set([...prompts.map((p) => `/prompts/${p.slug}/`), ...categories.map((c) => `/categories/${c.slug}/`)]);
  for (const r of redirects) {
    if (!r.from || !r.to) errors.push('redirects.json: each entry needs "from" and "to"');
    else if (!knownPaths.has(r.to)) errors.push(`redirects.json: target ${r.to} does not exist`);
  }

  if (errors.length) {
    throw new Error('Content validation failed:\n  - ' + errors.join('\n  - '));
  }

  // Language filtering: only prompts in the site language are built for now.
  // Other languages are kept in the data and ready for a /{lang}/ build (see README).
  const siteLang = config.language;
  const skipped = prompts.filter((p) => p.language !== siteLang);
  if (skipped.length) warnings.push(`${skipped.length} prompt(s) not in "${siteLang}" were skipped.`);
  prompts = prompts.filter((p) => p.language === siteLang);

  for (const c of categories) {
    if (!prompts.some((p) => p.category === c.slug)) warnings.push(`category "${c.slug}" has no prompts; its page will show an empty state.`);
  }

  // Derived fields.
  for (const p of prompts) {
    const cat = catBySlug.get(p.category);
    p.url = `/prompts/${p.slug}/`;
    p.categoryName = cat.name;
    p.styleLabel = taxonomy.styles[p.style];
    p.useLabels = p.uses.map((u) => taxonomy.uses[u]);
    p.lastModified = p.updatedAt || p.publishedAt;
  }
  for (const c of categories) {
    c.url = `/categories/${c.slug}/`;
    c.count = prompts.filter((p) => p.category === c.slug).length;
  }

  return { taxonomy, categories, prompts, redirects, warnings, catBySlug };
}

/** Related prompts: weighted by category, tags, style, use and tool overlap. */
export function relatedPrompts(prompt, all, limit = 4) {
  const overlap = (a, b) => a.filter((x) => b.includes(x)).length;
  return all
    .filter((p) => p.slug !== prompt.slug)
    .map((p) => ({
      p,
      score:
        (p.category === prompt.category ? 3 : 0) +
        overlap(p.tags, prompt.tags) * 2 +
        (p.style === prompt.style ? 2 : 0) +
        overlap(p.uses, prompt.uses) * 1.5 +
        overlap(p.supportedTools, prompt.supportedTools) * 0.25,
    }))
    .sort((a, b) => b.score - a.score || b.p.publishedAt.localeCompare(a.p.publishedAt) || a.p.slug.localeCompare(b.p.slug))
    .slice(0, limit)
    .map((x) => x.p);
}

/** True when the prompt has a complete customisation guide worth showing. */
export const hasGuide = (p) => !!p.customize && CUSTOMIZE_KEYS.every((k) => p.customize[k]);
