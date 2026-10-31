// Shared HTML building blocks: document shell, header, footer, cards, pagination, ad slots.
import { esc, jsonForScript, blurb, formatDate } from './util.mjs';

// ---------- icons (inline SVG, decorative unless labelled by their button) ----------
const svg = (body, size = 20) =>
  `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
export const ICON = {
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  menu: svg('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  copy: svg('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>', 16),
  share: svg('<path d="M12 3v12M8 7l4-4 4 4"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>', 16),
  moon: svg('<path d="M20 14.5A8 8 0 1 1 9.5 4 6.5 6.5 0 0 0 20 14.5Z"/>'),
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  chevron: svg('<path d="m6 9 6 6 6-6"/>', 16),
  external: svg('<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>', 14),
  arrow: svg('<path d="M5 12h14M13 6l6 6-6 6"/>', 18),
};

// ---------- images ----------
export function imgTag(ctx, p, { priority = false, sizes = '(min-width:1100px) 25vw, (min-width:700px) 33vw, 50vw', cls = '' } = {}) {
  const img = ctx.images.get(p.slug);
  const attrs = [
    `src="${esc(img.src)}"`,
    img.srcset ? `srcset="${esc(img.srcset)}" sizes="${esc(sizes)}"` : '',
    `width="${img.width}"`,
    `height="${img.height}"`,
    `alt="${esc(img.alt)}"`,
    priority ? 'fetchpriority="high"' : 'loading="lazy"',
    'decoding="async"',
    cls ? `class="${cls}"` : '',
    'data-fallback',
  ].filter(Boolean);
  return `<img ${attrs.join(' ')}>`;
}

// ---------- cards ----------
/** Gallery card. The same markup is stored in search-index.json so client-side results match exactly. */
export function cardHtml(ctx, p, { priority = false, level = 3 } = {}) {
  const img = ctx.images.get(p.slug);
  const cat = ctx.data.catBySlug.get(p.category);
  const [c0, c1] = cat.palette;
  return `<article class="card" data-slug="${esc(p.slug)}">
<div class="card-media" style="aspect-ratio:${img.width}/${img.height};--c0:${c0};--c1:${c1}">${imgTag(ctx, p, { priority })}</div>
<div class="card-body">
<p class="card-cat">${esc(p.categoryName)}</p>
<h${level} class="card-title"><a class="card-link" href="${p.url}">${esc(p.title)}</a></h${level}>
<p class="card-desc">${esc(blurb(p.description, 110))}</p>
<button class="btn btn-copy" type="button" data-copy data-prompt="${esc(p.promptText)}" aria-label="Copy prompt: ${esc(p.title)}">${ICON.copy}<span data-copy-label>Copy prompt</span></button>
</div>
</article>`;
}

/** Compact thumbnail row used for Trending and Recently added lists. */
export function rowHtml(ctx, p, { showDate = false, level = 3 } = {}) {
  const img = ctx.images.get(p.slug);
  const cat = ctx.data.catBySlug.get(p.category);
  const [c0, c1] = cat.palette;
  return `<li class="row">
<div class="row-media" style="--c0:${c0};--c1:${c1}">${imgTag(ctx, p, { sizes: '96px' })}</div>
<div class="row-body">
<p class="card-cat">${esc(p.categoryName)}${showDate ? ` · <time datetime="${p.publishedAt}">${formatDate(p.publishedAt)}</time>` : ''}</p>
<h${level} class="row-title"><a class="card-link" href="${p.url}">${esc(p.title)}</a></h${level}>
</div>
</li>`;
}

export const gallery = (ctx, list, opts = {}) =>
  `<div class="masonry" data-results>${list.map((p, i) => cardHtml(ctx, p, { priority: opts.priorityFirst && i < 2, level: opts.level || 3 })).join('\n')}</div>`;

// ---------- breadcrumbs & pagination ----------
export function breadcrumbs(trail) {
  const items = trail
    .map((t, i) =>
      i === trail.length - 1
        ? `<li aria-current="page">${esc(t.name)}</li>`
        : `<li><a href="${t.url}">${esc(t.name)}</a></li>`,
    )
    .join('');
  return `<nav class="breadcrumbs" aria-label="Breadcrumb"><ol>${items}</ol></nav>`;
}

export function pagination(basePath, page, totalPages) {
  if (totalPages <= 1) return '';
  const href = (n) => (n === 1 ? basePath : `${basePath}page/${n}/`);
  const parts = [];
  parts.push(page > 1 ? `<a class="page-link" rel="prev" href="${href(page - 1)}">Previous</a>` : `<span class="page-link is-disabled" aria-disabled="true">Previous</span>`);
  for (let n = 1; n <= totalPages; n++) {
    parts.push(n === page ? `<span class="page-link is-current" aria-current="page">${n}</span>` : `<a class="page-link" href="${href(n)}" aria-label="Page ${n}">${n}</a>`);
  }
  parts.push(page < totalPages ? `<a class="page-link" rel="next" href="${href(page + 1)}">Next</a>` : `<span class="page-link is-disabled" aria-disabled="true">Next</span>`);
  return `<nav class="pagination" aria-label="Pagination" data-pagination>${parts.join('')}</nav>`;
}

// ---------- filters (progressively enhanced by app.js) ----------
export function filterBar(ctx, { fixedCategory = '', showCategory = true, id = 'f' } = {}) {
  const { taxonomy, categories } = ctx.data;
  const opt = (map, any) => `<option value="">${any}</option>` + Object.entries(map).map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join('');
  const toolMap = Object.fromEntries(Object.entries(taxonomy.tools).map(([k, v]) => [k, v.name]));
  const catMap = Object.fromEntries(categories.map((c) => [c.slug, c.name]));
  const select = (name, label, map, any) =>
    `<div class="field"><label for="${id}-${name}">${label}</label><select id="${id}-${name}" name="${name}" data-filter="${name}">${opt(map, any)}</select></div>`;
  return `<form class="filters" action="/search/" method="get" role="search" data-filters${fixedCategory ? ` data-fixed-category="${esc(fixedCategory)}"` : ''}>
<div class="searchbox">
<label class="sr-only" for="${id}-q">Search prompts</label>
<input id="${id}-q" type="search" name="q" placeholder="Search prompts, styles or tags" autocomplete="off" data-filter="q">
<button class="clear-btn" type="button" data-clear hidden aria-label="Clear search">${ICON.close}</button>
<button class="btn btn-ink" type="submit">${ICON.search}<span>Search</span></button>
</div>
<div class="filter-row filters-js">
${showCategory ? select('category', 'Category', catMap, 'All categories') : ''}
${select('style', 'Visual style', taxonomy.styles, 'Any style')}
${select('use', 'Intended use', taxonomy.uses, 'Any use')}
${select('tool', 'AI tool', toolMap, 'Any tool')}
<div class="field"><label for="${id}-sort">Sort by</label><select id="${id}-sort" name="sort" data-filter="sort">
<option value="">Recommended</option><option value="featured">Editorially featured</option><option value="recent">Recently published</option><option value="az">Alphabetical (A–Z)</option>
</select></div>
<button class="btn btn-quiet" type="button" data-reset hidden>Reset filters</button>
</div>
</form>
<p class="results-status" role="status" aria-live="polite" data-status></p>`;
}

// ---------- advertising ----------
/** Returns '' unless ads are configured AND this placement has a valid slot ID. Never invents IDs. */
export function adSlot(ctx, placement) {
  const { ads } = ctx.config;
  if (!ads.enabled || !ads.slots[placement]) return '';
  return `<aside class="ad-slot" aria-label="Advertisement" data-ad-slot>
<p class="ad-label">Advertisement</p>
<ins class="adsbygoogle" style="display:block" data-ad-client="${esc(ads.clientId)}" data-ad-slot="${esc(ads.slots[placement])}" data-ad-format="auto" data-full-width-responsive="true"></ins>
</aside>`;
}

// ---------- document shell ----------
const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('pp-theme');if(t==='dark'||t==='light')document.documentElement.setAttribute('data-theme',t)}catch(e){}document.documentElement.classList.add('js')})();`;
export { THEME_SCRIPT };

function header(ctx, currentPath) {
  const { config, data } = ctx;
  const brand = esc(config.brand.name);
  const cur = (p, exact = false) => ((exact ? currentPath === p : currentPath.startsWith(p)) ? ' aria-current="page"' : '');
  const catLinks = data.categories.map((c) => `<li><a href="${c.url}"${cur(c.url)}>${esc(c.name)}</a></li>`).join('');
  return `<a class="skip-link" href="#main">Skip to content</a>
<header class="site-header">
<div class="container header-inner">
<a class="logo" href="/" aria-label="${brand} home"><span class="logo-mark" aria-hidden="true"></span><span class="logo-text">${brand}</span></a>
<div class="header-actions">
<button class="icon-btn theme-toggle" type="button" data-theme-toggle aria-label="Switch colour theme"><span class="when-light">${ICON.moon}</span><span class="when-dark">${ICON.sun}</span></button>
<button class="icon-btn nav-toggle" type="button" data-nav-toggle aria-expanded="false" aria-controls="site-nav" aria-label="Open menu">${ICON.menu}</button>
</div>
<nav id="site-nav" class="site-nav" aria-label="Main" data-nav>
<ul class="nav-list">
<li><a href="/prompts/"${cur('/prompts/')}>Explore</a></li>
<li class="has-menu"><a href="/categories/"${cur('/categories/', true)}>Categories</a><button class="menu-toggle" type="button" data-menu-toggle aria-expanded="false" aria-controls="cat-menu" aria-label="Show category list">${ICON.chevron}</button>
<ul id="cat-menu" class="submenu">${catLinks}</ul></li>
<li><a href="/trending/"${cur('/trending/')}>Trending</a></li>
<li><a href="/new/"${cur('/new/')}>New Prompts</a></li>
<li><a href="/guides/"${cur('/guides/')}>Guides</a></li>
</ul>
<form class="nav-search" action="/search/" method="get" role="search">
<label class="sr-only" for="nav-q">Search prompts</label>
<input id="nav-q" type="search" name="q" placeholder="Search prompts" autocomplete="off">
<button class="icon-btn" type="submit" aria-label="Search">${ICON.search}</button>
</form>
</nav>
</div>
</header>`;
}

function footer(ctx) {
  const { config, data } = ctx;
  const brand = esc(config.brand.name);
  const cats = data.categories.map((c) => `<li><a href="${c.url}">${esc(c.name)}</a></li>`).join('');
  const social = config.social.length
    ? `<ul class="social" aria-label="Social links">${config.social.map((s) => `<li><a href="${esc(s.url)}" rel="noopener noreferrer me" target="_blank">${esc(s.label)}<span class="sr-only"> (opens external site)</span></a></li>`).join('')}</ul>`
    : '';
  const demoNote = ctx.hasDemoImages
    ? `<p class="footer-note">Some images on this site are labelled placeholder artwork while original images are being prepared. Placeholders are not outputs of the prompts they appear with.</p>`
    : '';
  return `<footer class="site-footer">
<div class="container">
<div class="footer-grid">
<div class="footer-brand">
<a class="logo" href="/" aria-label="${brand} home"><span class="logo-mark" aria-hidden="true"></span><span class="logo-text">${brand}</span></a>
<p>${esc(config.brand.tagline)}. Copy-ready prompts, written in plain language and explained so you can make them your own.</p>
${social}
</div>
<nav aria-label="Explore"><h2 class="footer-h">Explore</h2><ul><li><a href="/prompts/">All prompts</a></li><li><a href="/categories/">Categories</a></li><li><a href="/trending/">Trending</a></li><li><a href="/new/">New prompts</a></li><li><a href="/guides/">Guides</a></li><li><a href="/search/">Search</a></li></ul></nav>
<nav aria-label="Categories"><h2 class="footer-h">Categories</h2><ul class="two-col">${cats}</ul></nav>
<nav aria-label="About and legal"><h2 class="footer-h">${brand}</h2><ul><li><a href="/about/">About</a></li><li><a href="/contact/">Contact</a></li><li><a href="/content-guidelines/">Content guidelines</a></li><li><a href="/privacy-policy/">Privacy Policy</a></li><li><a href="/terms-of-service/">Terms of Service</a></li><li><a href="/disclaimer/">Disclaimer</a></li><li><a href="/sitemap.xml">Sitemap</a></li>${config.ads.enabled ? '<li><button class="link-btn" type="button" data-consent-open>Ad settings</button></li>' : ''}</ul></nav>
</div>
${demoNote}
<p class="footer-legal">© ${new Date().getUTCFullYear()} ${brand}. ${brand} is not affiliated with any AI tool mentioned on this site; product names belong to their owners.</p>
</div>
</footer>`;
}

function consentBanner(ctx) {
  if (!ctx.config.ads.enabled) return '';
  return `<div class="consent" role="dialog" aria-labelledby="consent-title" aria-modal="false" data-consent hidden>
<p id="consent-title" class="consent-title">Ads on this site</p>
<p>${esc(ctx.config.brand.name)} is free to use and can show ads from Google AdSense. Ads load only if you agree, and may use cookies. You can change this at any time from the footer. See the <a href="/privacy-policy/">Privacy Policy</a>.</p>
<div class="consent-actions"><button class="btn btn-ink" type="button" data-consent-accept>Allow ads</button><button class="btn btn-quiet" type="button" data-consent-decline>No thanks</button></div>
</div>`;
}

/**
 * Wraps page content in the full HTML document.
 * @param {object} o  { path, title, description, robots, ogType, ogImage, ld[], body, extraHead }
 */
export function renderPage(ctx, o) {
  const { config } = ctx;
  const url = `${config.siteUrl}${o.path}`;
  const robots = o.robots || 'index,follow,max-image-preview:large';
  const ogImage = o.ogImage || `${config.siteUrl}/og-default.png`;
  const ldBlocks = (o.ld || []).map((obj) => `<script type="application/ld+json">${jsonForScript(obj)}</script>`).join('\n');
  const canonical = o.canonical === false ? '' : `<link rel="canonical" href="${esc(o.canonical || url)}">`;
  return `<!doctype html>
<html lang="${esc(config.language)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(o.title)}</title>
<meta name="description" content="${esc(o.description)}">
<meta name="robots" content="${robots}">
${canonical}
<meta name="theme-color" content="#F8F7F4" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#121211" media="(prefers-color-scheme: dark)">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<meta property="og:site_name" content="${esc(config.brand.name)}">
<meta property="og:type" content="${o.ogType || 'website'}">
<meta property="og:title" content="${esc(o.title)}">
<meta property="og:description" content="${esc(o.description)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:locale" content="${esc(config.locale)}">
<meta property="og:image" content="${esc(ogImage)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(o.title)}">
<meta name="twitter:description" content="${esc(o.description)}">
<meta name="twitter:image" content="${esc(ogImage)}">
<script>${THEME_SCRIPT}</script>
<link rel="stylesheet" href="${ctx.assets.css}">
${o.preloadImage ? `<link rel="preload" as="image" href="${esc(o.preloadImage)}" fetchpriority="high">` : ''}
${ldBlocks}
</head>
<body class="${o.bodyClass || ''}"${config.ads.enabled ? ` data-ads-client="${esc(config.ads.clientId)}"` : ''}>
${header(ctx, o.path)}
<main id="main" tabindex="-1">
${o.body}
</main>
${footer(ctx)}
${consentBanner(ctx)}
<div class="sr-only" id="live" role="status" aria-live="polite"></div>
<script src="${ctx.assets.js}" defer></script>
</body>
</html>
`;
}
