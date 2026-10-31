// Page renderers for dynamic (data-driven) routes. Each returns { path, html, indexable, lastmod }.
import { esc, formatDate, trimText, fitTitle, pluralize } from './util.mjs';
import { relatedPrompts, CUSTOMIZE_KEYS, CUSTOMIZE_LABELS, hasGuide } from './data.mjs';
import {
  ICON, imgTag, cardHtml, rowHtml, gallery, breadcrumbs, pagination, filterBar, adSlot, renderPage,
} from './layout.mjs';
import { websiteLd, organizationLd, breadcrumbLd, promptArticleLd, collectionLd } from './seo.mjs';

const newest = (list) => [...list].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.slug.localeCompare(b.slug));
const featuredFirst = (list) =>
  [...list].sort((a, b) => Number(!!b.featured) - Number(!!a.featured) || b.publishedAt.localeCompare(a.publishedAt) || a.slug.localeCompare(b.slug));
const maxDate = (list) => list.reduce((m, p) => (p.lastModified > m ? p.lastModified : m), '0000-00-00');
const sectionHead = (title, lead, link) =>
  `<div class="section-head"><div><h2 class="h2">${title}</h2>${lead ? `<p class="section-lead">${lead}</p>` : ''}</div>${link ? `<a class="link-arrow" href="${link.href}">${link.text} ${ICON.arrow}</a>` : ''}</div>`;

function categoryCards(ctx) {
  return `<ul class="cat-grid">${ctx.data.categories
    .map((c, i) => {
      const [c0, c1, c2] = c.palette;
      return `<li class="cat-card" style="--c0:${c0};--c1:${c1};--c2:${c2}">
<a class="card-link" href="${c.url}"><span class="cat-index" aria-hidden="true">${String(i + 1).padStart(2, '0')}</span><span class="cat-name">${esc(c.name)}</span></a>
<p class="cat-short">${esc(c.short)}</p>
<p class="cat-count">${pluralize(c.count, 'prompt')}</p>
</li>`;
    })
    .join('')}</ul>`;
}

// ------------------------------------------------------------------ Home
export function homePage(ctx) {
  const { prompts } = ctx.data;
  const { homepage } = ctx.config;
  const featured = featuredFirst(prompts.filter((p) => p.featured)).slice(0, homepage.featuredCount);
  const trending = prompts.filter((p) => p.trendingRank).sort((a, b) => a.trendingRank - b.trendingRank).slice(0, homepage.trendingCount);
  const recent = newest(prompts).slice(0, homepage.recentCount);
  const rank = (a, b) => (a.trendingRank || 99) - (b.trendingRank || 99) || b.publishedAt.localeCompare(a.publishedAt);
  const pool = [...prompts.filter((p) => p.featured && p.aspect === 'portrait').sort(rank), ...prompts.filter((p) => p.aspect === 'portrait').sort(rank), ...[...prompts].sort(rank)];
  const heroPool = [...new Map(pool.map((p) => [p.slug, p])).values()].slice(0, 4);
  while (heroPool.length && heroPool.length < 4) heroPool.push(heroPool[heroPool.length % heroPool.length]);
  const heroImg = ctx.images.get(heroPool[0].slug);
  const shown = new Set(featured.map((f) => f.slug));
  const library = newest(prompts).filter((x) => !shown.has(x.slug)).slice(0, homepage.libraryCount || 24);
  const libTabs = ctx.data.categories.filter((c) => c.count).map((c) => `<li><a class="chip" href="${c.url}">${esc(c.name)} <span class="chip-n">${c.count}</span></a></li>`).join('');

  const tile = (p, cls, i) => {
    const img = ctx.images.get(p.slug);
    const cat = ctx.data.catBySlug.get(p.category);
    return `<a class="tile ${cls}" href="${p.url}" style="--c0:${cat.palette[0]};--c1:${cat.palette[1]}"><span class="tile-media">${imgTag(ctx, p, { priority: i < 2, sizes: '(min-width:960px) 22vw, 44vw' })}</span><span class="tile-cap"><span class="tile-cat">${esc(p.categoryName)}</span><span class="tile-title">${esc(p.title)}</span></span></a>`;
  };
  const chips = ['cinematic', 'golden hour', 'headshot', 'streetwear', 'product', 'anime']
    .map((q) => `<a class="chip" href="/search/?q=${encodeURIComponent(q)}">${esc(q)}</a>`)
    .join('');

  const body = `
<section class="hero">
<div class="container hero-grid">
<div class="hero-copy">
<p class="eyebrow">AI image prompt library</p>
<h1 class="display">Your Next Great Image Starts With <em>a&nbsp;Prompt.</em></h1>
<p class="lede">Discover creative AI prompts, explore inspiring visual styles, and turn your ideas into extraordinary images.</p>
<form class="hero-search" action="/search/" method="get" role="search">
<label class="sr-only" for="hero-q">Search prompts</label>
<input id="hero-q" type="search" name="q" placeholder="Search styles, moods, subjects" autocomplete="off">
<button class="btn btn-ink" type="submit">${ICON.search}<span>Search</span></button>
</form>
<div class="hero-cta"><a class="btn btn-accent btn-lg" href="/prompts/">Explore Prompts</a><a class="link-arrow" href="/categories/">Browse Categories ${ICON.arrow}</a></div>
<p class="try"><span>Popular searches</span>${chips}</p>
</div>
<div class="hero-gallery" role="group" aria-label="Preview of featured prompts">
<div class="hero-col">${tile(heroPool[0], 't1', 0)}${tile(heroPool[1], 't2', 1)}</div>
<div class="hero-col is-offset">${tile(heroPool[2], 't3', 2)}${tile(heroPool[3], 't4', 3)}</div>
</div>
</div>
</section>

<section class="section" aria-labelledby="featured-h">
<div class="container">
${sectionHead('<span id="featured-h">Featured prompts</span>', 'Hand-picked starting points. Copy one, then change a single detail at a time.', { href: '/prompts/', text: 'View all prompts' })}
${gallery(ctx, featured)}
${adSlot(ctx, 'home')}
</div>
</section>

${(ctx.guides || []).filter((x) => x.featured).length ? `<section class="section" aria-labelledby="guides-h"><div class="container">${sectionHead('<span id="guides-h">Popular guides</span>', 'Collections of copy-ready prompts with example images.', { href: '/guides/', text: 'All guides' })}<ul class="guide-list">${ctx.guides.filter((x) => x.featured).slice(0, 3).map((x) => `<li class="guide-card"><h3 class="h3"><a href="${x.url}">${esc(x.title)}</a></h3><p>${esc(trimText(x.description, 160))}</p></li>`).join('')}</ul></div></section>` : ''}

${library.length ? `<section class="section" aria-labelledby="lib-h">
<div class="container">
${sectionHead('<span id="lib-h">Prompt library</span>', `Open any prompt to see its image and copy the full text. ${pluralize(prompts.length, 'prompt')} in total.`, { href: '/prompts/', text: `Browse all ${prompts.length}` })}
<ul class="tabs" aria-label="Browse the library by category"><li><a class="chip is-on" href="/prompts/" aria-current="page">All</a></li>${libTabs}</ul>
${gallery(ctx, library)}
<p class="center-cta"><a class="btn btn-ink btn-lg" href="/prompts/">View the full library</a></p>
</div>
</section>` : ''}

<section class="section section-tint" aria-labelledby="cats-h">
<div class="container">
${sectionHead('<span id="cats-h">Explore by category</span>', 'Ten collections, from portraits and product shots to landscapes and seasonal scenes.', { href: '/categories/', text: 'All categories' })}
${categoryCards(ctx)}
</div>
</section>

<section class="section" aria-label="Trending and recently added prompts">
<div class="container two-up">
<div aria-labelledby="trend-h">
${sectionHead('<span id="trend-h">Trending</span>', 'An editorial selection, not a live ranking.', { href: '/trending/', text: 'See all' })}
<ul class="rows">${trending.map((p) => rowHtml(ctx, p)).join('')}</ul>
</div>
<div aria-labelledby="new-h">
${sectionHead('<span id="new-h">Recently added</span>', 'Newest prompts, by publication date.', { href: '/new/', text: 'See all' })}
<ul class="rows">${recent.map((p) => rowHtml(ctx, p, { showDate: true })).join('')}</ul>
</div>
</div>
</section>

<section class="section section-tint" aria-labelledby="how-h">
<div class="container">
${sectionHead('<span id="how-h">How it works</span>', 'Three steps from idea to image.')}
<ol class="steps">
<li><span class="step-n" aria-hidden="true">1</span><h3>Discover an image style</h3><p>Browse categories or search by mood, lighting or use. Every prompt page explains why the look works.</p></li>
<li><span class="step-n" aria-hidden="true">2</span><h3>Copy the prompt</h3><p>One click copies the full prompt text, with nothing extra attached, ready to paste.</p></li>
<li><span class="step-n" aria-hidden="true">3</span><h3>Paste and customise</h3><p>Paste it into a compatible AI image tool, then use the customisation guide to change light, angle, clothing or mood.</p></li>
</ol>
</div>
</section>`;

  return {
    path: '/',
    indexable: true,
    lastmod: maxDate(prompts),
    html: renderPage(ctx, {
      path: '/',
      title: `${ctx.config.brand.name} — Discover Creative AI Image Prompts`,
      description: ctx.config.brand.description,
      ld: [websiteLd(ctx), organizationLd(ctx)],
      body,
      bodyClass: 'is-home',
      preloadImage: heroImg.src,
    }),
  };
}

// ------------------------------------------------------------------ All prompts (paginated)
export function promptsListPages(ctx) {
  const { prompts } = ctx.data;
  const size = ctx.config.pageSize;
  const sorted = featuredFirst(prompts);
  const total = Math.max(1, Math.ceil(sorted.length / size));
  const pages = [];
  for (let page = 1; page <= total; page++) {
    const slice = sorted.slice((page - 1) * size, page * size);
    const path = page === 1 ? '/prompts/' : `/prompts/page/${page}/`;
    const trail = [{ name: 'Home', url: '/' }, { name: 'All prompts', url: '/prompts/' }, ...(page > 1 ? [{ name: `Page ${page}`, url: path }] : [])];
    const body = `<div class="container page-top">
${breadcrumbs(trail)}
<h1 class="h1">All AI image prompts${page > 1 ? ` <span class="h1-page">Page ${page}</span>` : ''}</h1>
<p class="lede-sm">${pluralize(sorted.length, 'prompt')} across ${ctx.data.categories.length} categories. Search, filter by style, use or tool, and copy anything with one click.</p>
${filterBar(ctx)}
${gallery(ctx, slice, { priorityFirst: true, level: 2 })}
${pagination('/prompts/', page, total)}
</div>`;
    pages.push({
      path,
      indexable: true,
      lastmod: maxDate(slice),
      html: renderPage(ctx, {
        path,
        title: page === 1 ? `All AI Image Prompts | ${ctx.config.brand.name}` : `All AI Image Prompts, Page ${page} | ${ctx.config.brand.name}`,
        description: page === 1
          ? `Browse ${sorted.length} copy-ready AI image prompts for portraits, fashion, product shots, landscapes and more, each with customisation tips.`
          : `Page ${page} of ${total} of the ${ctx.config.brand.name} prompt library: more copy-ready AI image prompts with customisation tips.`,
        ld: [breadcrumbLd(ctx, trail), collectionLd(ctx, { name: 'All AI image prompts', description: 'Browse the full prompt library.', url: path, prompts: slice })],
        body,
      }),
    });
  }
  return pages;
}

// ------------------------------------------------------------------ Prompt detail
export function promptPage(ctx, p) {
  const { taxonomy, prompts, catBySlug } = ctx.data;
  const cat = catBySlug.get(p.category);
  const img = ctx.images.get(p.slug);
  const related = relatedPrompts(p, prompts, 4);
  const trail = [{ name: 'Home', url: '/' }, { name: cat.name, url: cat.url }, { name: p.title, url: p.url }];
  const toolNames = p.supportedTools.map((t) => taxonomy.tools[t].name);
  const toolList = toolNames.length ? toolNames.join(', ').replace(/, ([^,]*)$/, ' or $1') : 'an AI image tool';
  const statusNote = p.tested
    ? 'Marked as tested by our editors on the tools listed below. Results still vary between tool versions and settings.'
    : 'Editorial draft. This prompt is written to suit tools that accept free-text image prompts, but we have not yet verified results on specific tools. Outputs differ between tools and versions.';

  const customize = hasGuide(p) ? CUSTOMIZE_KEYS.map((k) => `<div class="guide-item"><dt>${CUSTOMIZE_LABELS[k]}</dt><dd>${esc(p.customize[k])}</dd></div>`).join('') : '';
  const tools = p.supportedTools.length
    ? `<ul class="tool-list">${p.supportedTools
        .map((t) => `<li><a class="tool" href="${esc(taxonomy.tools[t].url)}" target="_blank" rel="noopener noreferrer">${esc(taxonomy.tools[t].name)} ${ICON.external}<span class="sr-only"> (opens the official site in a new tab)</span></a></li>`)
        .join('')}</ul><p class="note">These links leave ${esc(ctx.config.brand.name)} and open each tool's official site. ${esc(statusNote)}</p>`
    : `<p class="note">${esc(statusNote)}</p>`;

  const caption = img.demo
    ? `Placeholder artwork. This is not an image generated from this prompt; an original example is planned.`
    : esc(p.imageCredit || 'Example image for this prompt.');
  const ratioLabel = `${p.ratio} (${p.aspect})`;

  const body = `<div class="container page-top prompt-page">
${breadcrumbs(trail)}
<div class="prompt-layout">
<div class="prompt-media">
<figure class="prompt-figure">
<div class="media" style="aspect-ratio:${img.width}/${img.height};--c0:${cat.palette[0]};--c1:${cat.palette[1]}">${imgTag(ctx, p, { priority: true, sizes: '(min-width:960px) 48vw, 100vw' })}</div>
<figcaption>${caption}</figcaption>
</figure>
</div>
<div class="prompt-main">
<p class="eyebrow"><a href="${cat.url}">${esc(cat.name)}</a></p>
<h1 class="h1">${esc(p.title)}</h1>
<p class="lede-sm">${esc(p.description)}</p>
<p class="meta-line">Published <time datetime="${p.publishedAt}">${formatDate(p.publishedAt)}</time>${p.updatedAt ? ` · Updated <time datetime="${p.updatedAt}">${formatDate(p.updatedAt)}</time>` : ''}</p>

<section class="prompt-box" aria-labelledby="prompt-h">
<h2 class="h3" id="prompt-h">The prompt</h2>
<pre class="prompt-text" id="prompt-text" tabindex="0">${esc(p.promptText)}</pre>
<div class="prompt-actions">
<button class="btn btn-accent btn-lg" type="button" data-copy data-copy-target="#prompt-text" aria-label="Copy prompt: ${esc(p.title)}">${ICON.copy}<span data-copy-label>Copy Prompt</span></button>
<button class="btn btn-quiet" type="button" data-share data-title="${esc(p.title)}">${ICON.share}<span data-share-label>Share</span></button>
</div>
</section>

<dl class="facts">
<div><dt>Visual style</dt><dd>${esc(p.styleLabel)}</dd></div>
<div><dt>Intended use</dt><dd>${esc(p.useLabels.join(', '))}</dd></div>
<div><dt>Suggested ratio</dt><dd>${esc(ratioLabel)}</dd></div>
<div><dt>Status</dt><dd>${p.tested ? 'Tested' : 'Editorial draft'}</dd></div>
</dl>
<ul class="tags" aria-label="Tags">${p.tags.map((t) => `<li><a class="chip" href="/search/?q=${encodeURIComponent(t)}">${esc(t)}</a></li>`).join('')}</ul>
</div>
</div>

<div class="prose-wrap">
${p.visualNotes ? `<section class="block" aria-labelledby="why-h"><h2 class="h2" id="why-h">Why this prompt works</h2><p>${esc(p.visualNotes)}</p></section>` : ''}

<section class="block" aria-labelledby="use-h"><h2 class="h2" id="use-h">How to use it</h2>
<ol class="plain-steps">
<li>Copy the prompt with the button above.</li>
<li>Paste it into ${esc(toolList)}, or another image tool that accepts text prompts.</li>
<li>Set the aspect ratio to ${esc(p.ratio)} if the tool allows it, generate, then change one detail at a time${customize ? ' using the guide below' : ''}.</li>
</ol></section>

${customize ? `<section class="block" aria-labelledby="guide-h"><h2 class="h2" id="guide-h">Customisation guide</h2>
<dl class="guide">${customize}</dl></section>` : ''}

${(ctx.guides || []).filter((x) => (x.promptSlugs || []).includes(p.slug)).slice(0, 2).map((x) => `<p class="note guide-link">Featured in the guide: <a href="${x.url}">${esc(x.title)}</a></p>`).join('')}
${adSlot(ctx, 'prompt')}

<section class="block" aria-labelledby="tools-h"><h2 class="h2" id="tools-h">Tools to try it with</h2>${tools}</section>
</div>

<section class="block related" aria-labelledby="rel-h">
<h2 class="h2" id="rel-h">Related prompts</h2>
${gallery(ctx, related)}
</section>
</div>`;

  return {
    path: p.url,
    indexable: true,
    lastmod: p.lastModified,
    html: renderPage(ctx, {
      path: p.url,
      title: p.seoTitle || fitTitle([`${p.title}: AI Image Prompt | ${ctx.config.brand.name}`, `${p.title} | ${ctx.config.brand.name}`, p.title]),
      description: p.seoDescription || trimText(p.description, 155),
      ogType: 'article',
      ogImage: img.ogSrc ? `${ctx.config.siteUrl}${img.ogSrc}` : undefined,
      ld: [promptArticleLd(ctx, p, img), breadcrumbLd(ctx, trail)],
      body,
      preloadImage: img.src,
      bodyClass: 'is-prompt',
    }),
  };
}

// ------------------------------------------------------------------ Categories
export function categoriesIndexPage(ctx) {
  const trail = [{ name: 'Home', url: '/' }, { name: 'Categories', url: '/categories/' }];
  const body = `<div class="container page-top">
${breadcrumbs(trail)}
<h1 class="h1">Prompt categories</h1>
<p class="lede-sm">Pick a collection to see its prompts, or <a href="/prompts/">browse everything</a>. Each category explains what makes its images work.</p>
${categoryCards(ctx)}
</div>`;
  return {
    path: '/categories/',
    indexable: true,
    lastmod: maxDate(ctx.data.prompts),
    html: renderPage(ctx, {
      path: '/categories/',
      title: `AI Image Prompt Categories | ${ctx.config.brand.name}`,
      description: 'Explore AI image prompt categories: portraits, couples, headshots, fashion, cinematic looks, illustration, product, landscapes and seasonal images.',
      ld: [breadcrumbLd(ctx, trail)],
      body,
    }),
  };
}

export function categoryPages(ctx, cat) {
  const { prompts, catBySlug } = ctx.data;
  const items = featuredFirst(prompts.filter((p) => p.category === cat.slug));
  const size = ctx.config.pageSize;
  const total = Math.max(1, Math.ceil(items.length / size));
  const related = (cat.related || []).map((s) => catBySlug.get(s)).filter(Boolean);
  const out = [];
  for (let page = 1; page <= total; page++) {
    const slice = items.slice((page - 1) * size, page * size);
    const path = page === 1 ? cat.url : `${cat.url}page/${page}/`;
    const trail = [{ name: 'Home', url: '/' }, { name: 'Categories', url: '/categories/' }, { name: cat.name, url: cat.url }, ...(page > 1 ? [{ name: `Page ${page}`, url: path }] : [])];
    const intro = page === 1 ? cat.intro.map((t) => `<p>${esc(t)}</p>`).join('') : '';
    const empty = items.length === 0 ? `<p class="empty">No prompts in this category yet. Check back soon, or <a href="/prompts/">browse all prompts</a>.</p>` : '';
    const body = `<div class="container page-top">
${breadcrumbs(trail)}
<header class="cat-head" style="--c0:${cat.palette[0]};--c1:${cat.palette[1]};--c2:${cat.palette[2]}">
<h1 class="h1">${esc(cat.name)}${page > 1 ? ` <span class="h1-page">Page ${page}</span>` : ''}</h1>
<div class="cat-intro prose">${intro || `<p>${esc(cat.short)}</p>`}</div>
</header>
${(ctx.guides || []).filter((x) => x.category === cat.slug).map((x) => `<p class="note guide-link">Read the guide: <a href="${x.url}">${esc(x.title)}</a></p>`).join('')}
${filterBar(ctx, { fixedCategory: cat.slug, showCategory: false })}
${items.length ? gallery(ctx, slice, { priorityFirst: true, level: 2 }) : `<div class="masonry" data-results></div>${empty}`}
${pagination(cat.url, page, total)}
${adSlot(ctx, 'category')}
<section class="block" aria-labelledby="more-cats-h">
<h2 class="h2" id="more-cats-h">Related categories</h2>
<ul class="chip-row">${related.map((c) => `<li><a class="chip chip-lg" href="${c.url}">${esc(c.name)}</a></li>`).join('')}</ul>
</section>
</div>`;
    out.push({
      path,
      indexable: true,
      lastmod: maxDate(slice.length ? slice : prompts),
      html: renderPage(ctx, {
        path,
        title: fitTitle([
          page > 1 ? `${cat.name} Prompts, Page ${page} | ${ctx.config.brand.name}` : `${cat.name} Prompts | ${ctx.config.brand.name}`,
          `${cat.name} Prompts`,
        ]),
        description: trimText(page === 1
          ? `${cat.short} Browse ${pluralize(items.length, 'copy-ready prompt')} with customisation tips.`
          : `Page ${page} of ${total}: more ${cat.name} prompts. ${cat.short}`, 158),
        ld: [breadcrumbLd(ctx, trail), collectionLd(ctx, { name: cat.name, description: cat.short, url: path, prompts: slice })],
        body,
      }),
    });
  }
  return out;
}

// ------------------------------------------------------------------ Search
export function searchPage(ctx) {
  const noscriptList = `<noscript><div class="notice"><p>Search needs JavaScript. Meanwhile, here is every prompt:</p><ul class="plain-list">${newest(ctx.data.prompts)
    .map((p) => `<li><a href="${p.url}">${esc(p.title)}</a> <span class="muted">· ${esc(p.categoryName)}</span></li>`)
    .join('')}</ul></div></noscript>`;
  const body = `<div class="container page-top" data-search-page>
<h1 class="h1">Search prompts</h1>
<p class="lede-sm">Search titles, descriptions, categories and tags, then narrow by style, use or tool.</p>
${filterBar(ctx, { id: 's' })}
<p class="loading" data-loading hidden>Loading prompts…</p>
<div class="masonry" data-results data-mode="search"></div>
<div class="empty-state" data-empty hidden>
<h2 class="h3">No prompts found</h2>
<p>Try fewer words, check the spelling, or browse a category instead.</p>
<p><a class="btn btn-ink" href="/categories/">Browse categories</a></p>
</div>
<p class="error-state" data-error hidden>Search could not load. Check your connection and <a href="" data-retry>try again</a>, or <a href="/prompts/">browse all prompts</a>.</p>
${noscriptList}
</div>`;
  return {
    path: '/search/',
    indexable: false,
    html: renderPage(ctx, {
      path: '/search/',
      title: `Search AI Image Prompts | ${ctx.config.brand.name}`,
      description: 'Search the prompt library by title, category, tag or style.',
      robots: 'noindex,follow',
      ld: [],
      body,
    }),
  };
}

// ------------------------------------------------------------------ Trending / New
export function trendingPage(ctx) {
  const list = ctx.data.prompts.filter((p) => p.trendingRank).sort((a, b) => a.trendingRank - b.trendingRank);
  const trail = [{ name: 'Home', url: '/' }, { name: 'Trending', url: '/trending/' }];
  const body = `<div class="container page-top">
${breadcrumbs(trail)}
<h1 class="h1">Trending prompts</h1>
<p class="lede-sm">A hand-picked editorial selection of prompts worth trying first. This is not a live popularity ranking; we do not publish usage statistics we do not have.</p>
${gallery(ctx, list, { priorityFirst: true, level: 2 })}
</div>`;
  return {
    path: '/trending/',
    indexable: true,
    lastmod: maxDate(list),
    html: renderPage(ctx, {
      path: '/trending/',
      title: `Trending AI Image Prompts | ${ctx.config.brand.name}`,
      description: 'An editorial selection of AI image prompts to try first: portraits, fashion, product shots and cinematic scenes.',
      ld: [breadcrumbLd(ctx, trail), collectionLd(ctx, { name: 'Trending prompts', description: 'Editorial selection of prompts.', url: '/trending/', prompts: list })],
      body,
    }),
  };
}

export function newPage(ctx) {
  const list = newest(ctx.data.prompts).slice(0, 24);
  const trail = [{ name: 'Home', url: '/' }, { name: 'New prompts', url: '/new/' }];
  const body = `<div class="container page-top">
${breadcrumbs(trail)}
<h1 class="h1">New prompts</h1>
<p class="lede-sm">The ${list.length} most recently published prompts, newest first, ordered by their real publication dates.</p>
<ul class="rows rows-wide">${list.map((p) => rowHtml(ctx, p, { showDate: true, level: 2 })).join('')}</ul>
</div>`;
  return {
    path: '/new/',
    indexable: true,
    lastmod: maxDate(list),
    html: renderPage(ctx, {
      path: '/new/',
      title: `New AI Image Prompts | ${ctx.config.brand.name}`,
      description: 'The newest AI image prompts, ordered by their publication date, with copy-ready text and customisation tips for each one.',
      ld: [breadcrumbLd(ctx, trail), collectionLd(ctx, { name: 'New prompts', description: 'Recently published prompts.', url: '/new/', prompts: list })],
      body,
    }),
  };
}

// ------------------------------------------------------------------ 404
export function notFoundPage(ctx) {
  const body = `<div class="container page-top not-found">
<p class="eyebrow">Error 404</p>
<h1 class="display display-sm">That page <em>isn’t here.</em></h1>
<p class="lede">The link may be old or mistyped. Try a search, or head back to the library.</p>
<form class="hero-search" action="/search/" method="get" role="search">
<label class="sr-only" for="nf-q">Search prompts</label>
<input id="nf-q" type="search" name="q" placeholder="Search prompts" autocomplete="off">
<button class="btn btn-ink" type="submit">${ICON.search}<span>Search</span></button>
</form>
<div class="hero-cta"><a class="btn btn-accent btn-lg" href="/">Back to home</a><a class="link-arrow" href="/categories/">Browse categories ${ICON.arrow}</a></div>
</div>`;
  return {
    path: '/404.html',
    indexable: false,
    html: renderPage(ctx, {
      path: '/404.html',
      title: `Page not found | ${ctx.config.brand.name}`,
      description: 'This page could not be found.',
      robots: 'noindex,follow',
      canonical: false,
      body,
    }),
  };
}
