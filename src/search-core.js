// Search + filter logic shared by the browser bundle and the Node tests.
// The build strips the `export` keywords when it inlines this file into app.js.
// Pure functions only: no DOM, no network.

export function normalize(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Split a query into tokens; each token also matches its singular form ("headshots" -> "headshot"). */
export function tokenize(q) {
  return normalize(q)
    .split(' ')
    .filter(Boolean)
    .map((t) => (t.length > 3 && t.endsWith('s') ? [t, t.slice(0, -1)] : [t]));
}

const fieldCache = new WeakMap();
function fields(e) {
  let f = fieldCache.get(e);
  if (!f) {
    f = {
      title: normalize(e.title),
      tags: (e.tags || []).map(normalize),
      category: normalize(e.categoryName),
      labels: normalize([e.styleLabel, ...(e.useLabels || [])].join(' ')),
      desc: normalize(e.description),
      prompt: normalize(e.promptText),
    };
    fieldCache.set(e, f);
  }
  return f;
}

const hasWordStart = (text, t) => (' ' + text).includes(' ' + t);

/** Relevance score for one token variant list. 0 means no match anywhere. */
function tokenScore(f, variants) {
  let best = 0;
  for (const t of variants) {
    let s = 0;
    if (hasWordStart(f.title, t)) s += 10;
    else if (f.title.includes(t)) s += 6;
    if (f.tags.some((g) => hasWordStart(g, t))) s += 6;
    else if (f.tags.some((g) => g.includes(t))) s += 4;
    if (hasWordStart(f.category, t)) s += 5;
    else if (f.category.includes(t)) s += 3;
    if (hasWordStart(f.labels, t)) s += 4;
    if (f.desc.includes(t)) s += 2;
    if (f.prompt.includes(t)) s += 1;
    if (s > best) best = s;
  }
  return best;
}

/** AND semantics: every token must match something. Returns total score (0 = excluded). */
export function matchScore(entry, tokens) {
  if (!tokens.length) return 1;
  const f = fields(entry);
  let total = 0;
  for (const variants of tokens) {
    const s = tokenScore(f, variants);
    if (s === 0) return 0;
    total += s;
  }
  return total;
}

const byFeatured = (a, b) =>
  Number(!!b.featured) - Number(!!a.featured) || b.publishedAt.localeCompare(a.publishedAt) || a.slug.localeCompare(b.slug);

/**
 * opts: { q, category, style, use, tool, sort }  sort: '' | 'featured' | 'recent' | 'az'
 * '' (recommended) means best match when searching, otherwise editorially featured.
 */
export function filterEntries(entries, opts = {}) {
  const tokens = tokenize(opts.q || '');
  const scored = [];
  for (const e of entries) {
    if (opts.category && e.category !== opts.category) continue;
    if (opts.style && e.style !== opts.style) continue;
    if (opts.use && !(e.uses || []).includes(opts.use)) continue;
    if (opts.tool && !(e.tools || []).includes(opts.tool)) continue;
    const score = matchScore(e, tokens);
    if (score > 0) scored.push({ e, score });
  }
  const sort = opts.sort || (tokens.length ? 'relevance' : 'featured');
  const cmp = {
    relevance: (a, b) => b.score - a.score || byFeatured(a.e, b.e),
    featured: (a, b) => byFeatured(a.e, b.e),
    recent: (a, b) => b.e.publishedAt.localeCompare(a.e.publishedAt) || a.e.slug.localeCompare(b.e.slug),
    az: (a, b) => a.e.title.localeCompare(b.e.title),
  }[sort] || byFeatured;
  return scored.sort(cmp).map((x) => x.e);
}
