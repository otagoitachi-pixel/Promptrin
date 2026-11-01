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
import { parseFrontMatter, renderMarkdown, validateGuideFiles } from './shared.mjs';

const GUIDES_DIR = path.join(ROOT, 'content/guides');
export { parseFrontMatter, renderMarkdown };

/** Loads and validates every guide. Throws a readable error list for bad files. */
export function loadGuides(data) {
  if (!fs.existsSync(GUIDES_DIR)) return { guides: [], warnings: [] };
  const files = fs.readdirSync(GUIDES_DIR).filter((x) => x.endsWith('.md')).sort()
    .map((f) => ({ slug: f.replace(/\.md$/, ''), text: fs.readFileSync(path.join(GUIDES_DIR, f), 'utf8') }));
  const { guides, warnings, errors } = validateGuideFiles(files, data);
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
