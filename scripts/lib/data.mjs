// Loads and validates all content. The build fails with a readable list of problems
// instead of silently shipping broken pages.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.mjs';
import { CUSTOMIZE_KEYS, CUSTOMIZE_LABELS, validateContent } from './shared.mjs';

const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
export { CUSTOMIZE_KEYS, CUSTOMIZE_LABELS };

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

  const { errors, warnings, catBySlug } = validateContent({ taxonomy, categories, prompts, redirects });

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
