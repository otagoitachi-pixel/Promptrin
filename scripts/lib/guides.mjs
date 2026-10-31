// Guides: long-form articles written in Markdown (content/guides/<slug>.md).
//
// File format
//   ---
//   title: Couple AI Photo Prompts to Copy and Paste      (page H1, required)
//   seoTitle: Couple Prompt: AI Photo Prompts to Copy & Paste   (optional <title>)
//   description: Meta description, about 120-155 characters   (required)
//   publishedAt: 2026-10-30                                (required)
//   updatedAt: 2026-11-05                                  (optional)
//   category: ai-couple-photography                        (optional, adds a breadcrumb + related link)
//   ---
//   Markdown body. Supported: ## and ### headings, paragraphs, - and 1. lists, > quotes,
//   **bold**, *italic*, `code`, [links](https://...), and the directive
//   {{prompts: slug-one, slug-two}}       inserts those prompts as small image cards.
//   {{full-prompts: slug-one, slug-two}}  inserts each prompt in full, numbered, with its image and a
//                                         Copy Prompt button (the PromptPin-style list page).
//   topLevel: true   in the front matter publishes at /<slug>/ instead of /guides/<slug>/.
//   featured: true   shows the guide on the homepage.
//
// A table of contents is built from the "##" headings. Nothing here emits FAQ markup, because FAQ rich
// results are restricted to a few site types; FAQ sections are plain, visible headings and answers.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.mjs';
import { esc, formatDate, trimText, fitTitle } from './util.mjs';
import { ICON, imgTag, breadcrumbs, gallery, adSlot, renderPage } from './layout.mjs';
import { breadcrumbLd } from './seo.mjs';

const GUIDES_DIR = path.join(ROOT, 'content/guides');
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const RESERVED = new Set(['prompts', 'categories', 'search', 'trending', 'new', 'guides', 'about', 'contact', 'privacy-policy', 'terms-of-service', 'disclaimer', 'content-guidelines', 'assets', 'images', 'admin', '404']);

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

/** Loads and validates every guide. Throws a readable error list for bad files. */
export function loadGuides(data) {
  if (!fs.existsSync(GUIDES_DIR)) return { guides: [], warnings: [] };
  const errors = [];
  const warnings = [];
  const guides = [];
  const bySlug = new Map(data.prompts.map((p) => [p.slug, p]));
  for (const f of fs.readdirSync(GUIDES_DIR).filter((x) => x.endsWith('.md')).sort()) {
    const slug = f.replace(/\.md$/, '');
    const where = `guide "${slug}"`;
    const { meta, body, hasFront } = parseFrontMatter(fs.readFileSync(path.join(GUIDES_DIR, f), 'utf8'));
    if (!SLUG.test(slug)) errors.push(`${where}: file name must be lowercase words with hyphens`);
    if (!hasFront) { errors.push(`${where}: missing front matter (--- block) at the top`); continue; }
    for (const k of ['title', 'description', 'publishedAt']) if (!meta[k]) errors.push(`${where}: missing "${k}"`);
    for (const k of ['publishedAt', 'updatedAt']) if (meta[k] && !ISO.test(meta[k])) errors.push(`${where}: ${k} must be YYYY-MM-DD`);
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
  if (errors.length) throw new Error('Content validation failed:\n  - ' + errors.join('\n  - '));
  return { guides, warnings };
}

const lastmod = (g) => g.updatedAt || g.publishedAt;

export function guidePage(ctx, g) {
  const { config } = ctx;
  const byS = new Map(ctx.data.prompts.map((p) => [p.slug, p]));
  let n = 0;
  const full = (p) => {
    n += 1;
    const img = ctx.images.get(p.slug);
    const tools = p.supportedTools.map((t) => ctx.data.taxonomy.tools[t].name);
    const caption = img.demo ? 'Placeholder artwork, not generated from this prompt.' : 'AI-generated image.';
    return `<section class="gp" aria-labelledby="gp-${esc(p.slug)}-h">
<h3 id="gp-${esc(p.slug)}-h" class="gp-title">${n}. ${esc(p.title)}</h3>
<figure class="gp-fig"><div class="gp-media" style="aspect-ratio:${img.width}/${img.height}">${imgTag(ctx, p, { priority: false, sizes: '(min-width:900px) 520px, 100vw' })}</div><figcaption>${esc(caption)}</figcaption></figure>
<p class="gp-desc">${esc(p.description)}</p>
<div class="prompt-box gp-box"><div class="gp-bar"><span class="gp-label">Prompt</span><button class="btn btn-accent" type="button" data-copy data-copy-target="#gp-${esc(p.slug)}" aria-label="Copy prompt: ${esc(p.title)}">${ICON.copy}<span data-copy-label>Copy Prompt</span></button></div><pre class="prompt-text" id="gp-${esc(p.slug)}" tabindex="0">${esc(p.promptText)}</pre></div>
<p class="gp-meta">${tools.length ? `Made with ${esc(tools.join(', '))} · ` : ''}Ratio ${esc(p.ratio)} · <a href="${p.url}">Open the prompt page</a></p>
</section>`;
  };
  const r = renderMarkdown(g.body, { renderPrompts: (slugs, kind) => { const list = slugs.map((s) => byS.get(s)).filter(Boolean); return kind === 'full-prompts' ? list.map(full).join('\n') : gallery(ctx, list, { level: 3 }); } });
  const cat = g.category ? ctx.data.catBySlug.get(g.category) : null;
  const trail = [{ name: 'Home', url: '/' }, { name: 'Guides', url: '/guides/' }, { name: g.title, url: g.url }];
  const toc = r.headings.length >= 3
    ? `<nav class="toc" aria-labelledby="toc-h"><h2 class="h3" id="toc-h">In this guide</h2><ol>${r.headings.map((h) => `<li><a href="#${h.id}">${esc(h.text)}</a></li>`).join('')}</ol></nav>`
    : '';
  const author = config.authorName;
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: g.title,
    description: g.description,
    datePublished: g.publishedAt,
    dateModified: lastmod(g),
    inLanguage: config.language,
    mainEntityOfPage: `${config.siteUrl}${g.url}`,
    publisher: { '@type': 'Organization', name: config.brand.name, url: `${config.siteUrl}/` },
  };
  if (author) ld.author = { '@type': 'Person', name: author };
  const firstImg = r.promptSlugs.map((s) => ctx.images.get(s)).find((im) => im && !im.demo && im.ogSrc);
  if (firstImg) ld.image = `${config.siteUrl}${firstImg.ogSrc}`;
  const more = cat ? `<p class="note">More in <a href="${cat.url}">${esc(cat.name)}</a>.</p>` : '';
  const body = `<div class="container page-top guide-page">
${breadcrumbs(trail)}
<article>
<header class="guide-head"><p class="eyebrow">Guide</p><h1 class="h1">${esc(g.title)}</h1>
<p class="lede-sm">${esc(g.description)}</p>
<p class="meta-line">Published <time datetime="${g.publishedAt}">${formatDate(g.publishedAt)}</time>${g.updatedAt ? ` · Updated <time datetime="${g.updatedAt}">${formatDate(g.updatedAt)}</time>` : ''} · ${Math.max(1, Math.round(r.words / 220))} min read</p></header>
${toc}
<div class="prose guide-body">
${r.html}
</div>
${more}
${adSlot(ctx, 'prompt')}
</article>
</div>`;
  return {
    path: g.url,
    indexable: true,
    lastmod: lastmod(g),
    html: renderPage(ctx, {
      path: g.url,
      title: g.seoTitle || fitTitle([`${g.title} | ${config.brand.name}`, g.title]),
      description: trimText(g.description, 160),
      ld: [ld, breadcrumbLd(ctx, trail)],
      body,
      ogImage: firstImg ? `${config.siteUrl}${firstImg.ogSrc}` : undefined,
    }),
  };
}

export function guidesIndexPage(ctx) {
  const list = [...ctx.guides].sort((a, b) => lastmod(b).localeCompare(lastmod(a)));
  const trail = [{ name: 'Home', url: '/' }, { name: 'Guides', url: '/guides/' }];
  const body = `<div class="container page-top">
${breadcrumbs(trail)}
<header class="page-head"><h1 class="h1">AI Image Prompt Guides</h1>
<p class="lede-sm">Practical guides with copy-ready prompts, example images and tips for getting better results.</p></header>
${list.length ? `<ul class="guide-list">${list.map((g) => `<li class="guide-card"><h2 class="h3"><a href="${g.url}">${esc(g.title)}</a></h2><p>${esc(trimText(g.description, 170))}</p><p class="meta-line">Updated <time datetime="${lastmod(g)}">${formatDate(lastmod(g))}</time></p></li>`).join('')}</ul>` : '<p>No guides yet.</p>'}
</div>`;
  return {
    path: '/guides/',
    indexable: list.length > 0,
    lastmod: list[0] ? lastmod(list[0]) : undefined,
    html: renderPage(ctx, {
      path: '/guides/',
      title: `AI Image Prompt Guides | ${ctx.config.brand.name}`,
      description: 'Practical guides to AI image prompts: copy-ready prompts, example images and tips for better results.',
      ld: [breadcrumbLd(ctx, trail)],
      body,
      robots: list.length ? undefined : 'noindex,follow',
    }),
  };
}
