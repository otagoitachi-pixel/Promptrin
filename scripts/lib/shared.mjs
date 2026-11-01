// Pure helpers shared by the build, the local admin server and the online (Cloudflare Worker) admin.
// Nothing in this file touches the file system, so it also runs inside a Worker.
// Rule: if validation or formatting changes, change it HERE so every tool agrees with the build.

export const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const RATIO = /^(\d{1,2}):(\d{1,2})$/;
export const ID_RE = /^pp-(\d+)$/;
export const IMAGE_EXTS = ['avif', 'webp', 'jpg', 'jpeg', 'png'];
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
export const RESERVED = new Set(['prompts', 'categories', 'search', 'trending', 'new', 'guides', 'about', 'contact', 'privacy-policy', 'terms-of-service', 'disclaimer', 'content-guidelines', 'assets', 'images', 'admin', 'api', '404']);

export class UserError extends Error {
  constructor(errors, status = 422) {
    super(errors.join('; '));
    this.errors = errors;
    this.status = status;
  }
}

export const today = () => new Date().toISOString().slice(0, 10);
export const list = (v) => (Array.isArray(v) ? v : []).map((x) => String(x).trim()).filter(Boolean);
export const str = (v) => (typeof v === 'string' ? v.trim() : '');
export const oneLine = (v) => String(v ?? '').replace(/[\r\n]+/g, ' ').trim();

export function aspectFor(ratio) {
  const [w, h] = String(ratio).split(':').map(Number);
  return w > h ? 'landscape' : w < h ? 'portrait' : 'square';
}

/** Image type from the first bytes (a Uint8Array). Returns 'jpg' | 'png' | 'webp' | null. */
export function sniffImage(b) {
  if (b.length > 12 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length > 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v)) return 'png';
  if (b.length > 12 && String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP') return 'webp';
  return null;
}

export const nextIdFrom = (prompts) => {
  const nums = prompts.map((p) => Number(ID_RE.exec(p.id || '')?.[1] || 0));
  return `pp-${String(Math.max(0, ...nums) + 1).padStart(3, '0')}`;
};

/** Keeps only known fields and fixes types, so the JSON files stay clean. `id` is supplied by the caller. */
export function normalisePrompt(input, previous, { id, today: day = today() } = {}) {
  const customize = {};
  for (const k of CUSTOMIZE_KEYS) customize[k] = str(input.customize?.[k]);
  const hasCustomize = CUSTOMIZE_KEYS.some((k) => customize[k]);
  const ratio = str(input.ratio);
  const p = {
    ...(previous || {}),
    id: previous?.id || str(input.id) || id,
    slug: str(input.slug),
    title: str(input.title),
    description: str(input.description),
    promptText: str(input.promptText).replace(/\r\n/g, '\n'),
    category: str(input.category),
    tags: [...new Set(list(input.tags).map((t) => t.toLowerCase()))],
    style: str(input.style),
    uses: list(input.uses),
    aspect: RATIO.test(ratio) ? aspectFor(ratio) : '',
    ratio,
    imageAlt: str(input.imageAlt),
    supportedTools: list(input.supportedTools),
    tested: input.tested === true,
    publishedAt: previous?.publishedAt || str(input.publishedAt) || day,
    featured: input.featured === true,
    language: str(input.language) || previous?.language || 'en',
    visualNotes: str(input.visualNotes),
    seoTitle: str(input.seoTitle),
    seoDescription: str(input.seoDescription),
    customize: hasCustomize ? customize : undefined,
  };
  if (previous && p.publishedAt !== day) p.updatedAt = day;
  delete p._file;
  delete p._draft;
  delete p.imageData;
  delete p.imageBlob;
  // Stable key order so diffs stay readable.
  const order = ['id', 'slug', 'title', 'description', 'promptText', 'category', 'tags', 'style', 'uses', 'aspect', 'ratio', 'imageAlt', 'supportedTools', 'tested', 'publishedAt', 'updatedAt', 'featured', 'trendingRank', 'language', 'seoTitle', 'seoDescription', 'visualNotes', 'customize'];
  const sorted = {};
  for (const k of order) if (p[k] !== undefined && p[k] !== '') sorted[k] = p[k];
  for (const k of Object.keys(p)) if (!(k in sorted) && p[k] !== undefined) sorted[k] = p[k];
  if (p.featured === false) delete sorted.featured;
  return sorted;
}

/**
 * Validates every published prompt, category and redirect. Returns { errors, warnings, catBySlug }.
 * The build, the local admin and the online admin all call this one function.
 */
export function validateContent({ taxonomy, categories, prompts, redirects = [], today: day = today() }) {
  const errors = [];
  const warnings = [];
  const catBySlug = new Map();

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
    if (p.publishedAt && p.publishedAt > day) warnings.push(`${where}: publishedAt is in the future; it is still built, but check the date.`);
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
  return { errors, warnings, catBySlug };
}

// ---------------------------------------------------------------- guides (Markdown)

export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function parseFrontMatter(raw) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!m) return { meta: {}, body: raw, hasFront: false };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (kv) meta[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '');
  }
  return { meta, body: m[2], hasFront: true };
}

const slugify = (s) => s.toLowerCase().replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'section';

function safeUrl(u) {
  const url = u.trim();
  return /^(https?:\/\/|\/(?!\/)|#)/.test(url) ? url : '';
}

function inline(text) {
  let s = esc(text);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (all, label, url) => {
    const href = safeUrl(url.replace(/&amp;/g, '&'));
    if (!href) return label;
    const external = /^https?:/.test(href);
    return `<a href="${esc(href)}"${external ? ' rel="noopener noreferrer"' : ''}>${label}</a>`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  return s;
}

/** Minimal, safe Markdown renderer. Returns { html, headings: [{id,text}], words, promptSlugs }. */
export function renderMarkdown(body, { renderPrompts } = {}) {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  const headings = [];
  const used = new Set();
  const promptSlugs = [];
  let words = 0;
  let i = 0;
  const idFor = (text) => {
    let id = slugify(text), n = 2;
    while (used.has(id)) id = `${slugify(text)}-${n++}`;
    used.add(id);
    return id;
  };
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    let m;
    if ((m = /^(#{2,3})\s+(.+?)\s*#*$/.exec(line))) {
      const level = m[1].length;
      const id = idFor(m[2]);
      if (level === 2) headings.push({ id, text: m[2] });
      out.push(`<h${level} id="${id}">${inline(m[2])}</h${level}>`);
      words += m[2].split(/\s+/).length;
      i++;
    } else if ((m = /^\{\{(prompts|full-prompts):\s*([^}]+)\}\}\s*$/.exec(line))) {
      const slugs = m[2].split(',').map((x) => x.trim()).filter(Boolean);
      promptSlugs.push(...slugs);
      out.push(renderPrompts ? renderPrompts(slugs, m[1]) : '');
      i++;
    } else if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
      words += buf.join(' ').split(/\s+/).length;
      out.push(`<blockquote><p>${inline(buf.join(' '))}</p></blockquote>`);
    } else if (/^[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) items.push(lines[i++].replace(/^[-*]\s+/, ''));
      words += items.join(' ').split(/\s+/).length;
      out.push(`<ul>${items.map((t) => `<li>${inline(t)}</li>`).join('')}</ul>`);
    } else if (/^\d+[.)]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+[.)]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\d+[.)]\s+/, ''));
      words += items.join(' ').split(/\s+/).length;
      out.push(`<ol>${items.map((t) => `<li>${inline(t)}</li>`).join('')}</ol>`);
    } else if (/^---+\s*$/.test(line)) {
      out.push('<hr>');
      i++;
    } else {
      const buf = [];
      while (i < lines.length && lines[i].trim() && !/^(#{2,3}\s|>|[-*]\s|\d+[.)]\s|\{\{(?:full-)?prompts:|---+\s*$)/.test(lines[i])) buf.push(lines[i++]);
      words += buf.join(' ').split(/\s+/).length;
      out.push(`<p>${inline(buf.join(' '))}</p>`);
    }
  }
  return { html: out.join('\n'), headings, words, promptSlugs };
}

/** Summary of one guide file for the admin lists. */
export function parseGuideFile(slug, text) {
  const { meta, body } = parseFrontMatter(text);
  return { slug, title: meta.title || '', seoTitle: meta.seoTitle || '', description: meta.description || '', publishedAt: meta.publishedAt || '', updatedAt: meta.updatedAt || '', category: meta.category || '', draft: meta.draft === 'true', topLevel: meta.topLevel === 'true', featured: meta.featured === 'true', body: body.trim() };
}

/** Builds the Markdown file text for a guide from the admin form. */
export function serializeGuide(input, existing, day = today()) {
  const meta = [
    ['title', oneLine(input.title)], ['seoTitle', oneLine(input.seoTitle)], ['description', oneLine(input.description)],
    ['publishedAt', oneLine(input.publishedAt) || existing?.publishedAt || day],
    ['updatedAt', existing && !input.draft ? day : oneLine(input.updatedAt)], ['category', oneLine(input.category)],
    ['topLevel', input.topLevel ? 'true' : ''], ['featured', input.featured ? 'true' : ''],
    ['draft', input.draft ? 'true' : ''],
  ];
  if (meta[4][1] && meta[4][1] === meta[3][1]) meta[4][1] = '';
  return `---\n${meta.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n${String(input.body || '').replace(/\r\n/g, '\n').trim()}\n`;
}

/**
 * Validates guide files ([{ slug, text }]) against the prompt data.
 * Returns { guides, warnings, errors } (errors is empty when everything is fine).
 */
export function validateGuideFiles(files, data) {
  const errors = [];
  const warnings = [];
  const guides = [];
  const bySlug = new Map(data.prompts.map((p) => [p.slug, p]));
  for (const { slug, text } of files) {
    const where = `guide "${slug}"`;
    const { meta, body, hasFront } = parseFrontMatter(text);
    if (!SLUG.test(slug)) errors.push(`${where}: file name must be lowercase words with hyphens`);
    if (!hasFront) { errors.push(`${where}: missing front matter (--- block) at the top`); continue; }
    for (const k of ['title', 'description', 'publishedAt']) if (!meta[k]) errors.push(`${where}: missing "${k}"`);
    for (const k of ['publishedAt', 'updatedAt']) if (meta[k] && !ISO_DATE.test(meta[k])) errors.push(`${where}: ${k} must be YYYY-MM-DD`);
    if (meta.category && !data.catBySlug.has(meta.category)) errors.push(`${where}: unknown category "${meta.category}"`);
    if (meta.draft === 'true') { warnings.push(`${where}: marked draft, not built.`); continue; }
    const embedded = [];
    const r = renderMarkdown(body, { renderPrompts: (slugs, kind) => { if (kind === 'full-prompts') embedded.push(...slugs); return ''; } });
    // Prompts shown in full on the page count as page content.
    for (const s of embedded) { const p = bySlug.get(s); if (p) r.words += `${p.title} ${p.description} ${p.promptText}`.split(/\s+/).length; }
    for (const s of r.promptSlugs) if (!bySlug.has(s)) errors.push(`${where}: {{prompts}} refers to unknown prompt "${s}"`);
    if (meta.description && (meta.description.length < 70 || meta.description.length > 175)) warnings.push(`${where}: description is ${meta.description.length} characters; aim for about 120-155.`);
    if (r.words < 300) warnings.push(`${where}: only about ${r.words} words. Thin pages rarely help; add useful detail.`);
    if (!r.headings.length) warnings.push(`${where}: no "##" headings, so no table of contents.`);
    const topLevel = meta.topLevel === 'true';
    if (topLevel && RESERVED.has(slug)) errors.push(`${where}: "${slug}" is a reserved address; choose another slug or turn off top-level.`);
    if (topLevel && data.prompts.some((p) => p.slug === slug)) warnings.push(`${where}: shares a name with a prompt (that is fine, they live at different addresses).`);
    guides.push({ slug, ...meta, topLevel, featured: meta.featured === 'true', body, promptSlugs: r.promptSlugs, url: topLevel ? `/${slug}/` : `/guides/${slug}/`, words: r.words });
  }
  const seen = new Set();
  for (const g of guides) { if (seen.has(g.title)) errors.push(`guide "${g.slug}": duplicate title`); seen.add(g.title); }
  return { guides, warnings, errors };
}
