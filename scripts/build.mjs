// Production build: JSON content in, pre-rendered static site out (dist/).
//   node scripts/build.mjs            normal build (warns about missing config)
//   node scripts/build.mjs --strict   fails if SITE_URL is missing (use for deployment)
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, ROOT, DIST } from './lib/config.mjs';
import { loadData } from './lib/data.mjs';
import { buildImages } from './lib/images.mjs';
import { cardHtml, THEME_SCRIPT } from './lib/layout.mjs';
import { homePage, promptsListPages, promptPage, categoriesIndexPage, categoryPages, searchPage, trendingPage, newPage, notFoundPage } from './lib/pages.mjs';
import { staticPages } from './lib/pages-static.mjs';
import { loadGuides, guidePage, guidesIndexPage } from './lib/guides.mjs';
import { writeFile, copyDir, sha256, esc } from './lib/util.mjs';

const strict = process.argv.includes('--strict') || process.env.STRICT === '1';
const log = (level, msg) => console.log(`${level === 'warn' ? '⚠ ' : level === 'ok' ? '✓ ' : '  '}${msg}`);

/** Light CSS minifier: strips comments and redundant whitespace. */
function minifyCss(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([{};,>])\s*/g, '$1')
    .replace(/;}/g, '}')
    .trim();
}

function buildAssets() {
  const css = minifyCss(fs.readFileSync(path.join(ROOT, 'src/styles.css'), 'utf8'));
  const core = fs.readFileSync(path.join(ROOT, 'src/search-core.js'), 'utf8').replace(/^export /gm, '');
  const app = fs.readFileSync(path.join(ROOT, 'src/app.js'), 'utf8');
  const js = `(function(){'use strict';\n${core}\n${app}\n})();\n`;
  const cssName = `styles.${sha256(css).slice(0, 10)}.css`;
  const jsName = `app.${sha256(js).slice(0, 10)}.js`;
  writeFile(DIST, `assets/${cssName}`, css);
  writeFile(DIST, `assets/${jsName}`, js);
  return { css: `/assets/${cssName}`, js: `/assets/${jsName}` };
}

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function buildHeaders(config) {
  const lines = [
    '/*',
    '  X-Content-Type-Options: nosniff',
    '  Referrer-Policy: strict-origin-when-cross-origin',
    '  X-Frame-Options: SAMEORIGIN',
    '  Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()',
  ];
  // Keep Cloudflare's own *.pages.dev addresses (including per-branch previews) out of Google when the
  // real site lives on a custom domain. Skipped when the site itself is served from *.pages.dev.
  if (!/\.pages\.dev$/.test(new URL(config.siteUrl).hostname)) {
    lines.unshift('https://:project.pages.dev/*', '  X-Robots-Tag: noindex', '');
  }
  if (!config.ads.enabled) {
    // Strict CSP is safe while no third-party scripts load. With ads enabled, AdSense needs a
    // broader policy; see README before adding one.
    const hash = sha256(THEME_SCRIPT, 'base64');
    const formOrigin = config.contact.formAction ? ` ${new URL(config.contact.formAction).origin}` : '';
    lines.push(
      `  Content-Security-Policy: default-src 'self'; script-src 'self' 'sha256-${hash}' https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://cloudflareinsights.com; form-action 'self'${formOrigin}; base-uri 'self'; frame-ancestors 'self'; object-src 'none'`,
    );
  }
  lines.push(
    '/assets/*',
    '  Cache-Control: public, max-age=31536000, immutable',
    '/images/*',
    '  Cache-Control: public, max-age=604800',
    '/search-index.json',
    '  Cache-Control: public, max-age=0, must-revalidate',
  );
  return lines.join('\n') + '\n';
}

async function main() {
  const started = Date.now();
  const config = loadConfig({ strict });
  const data = loadData(config);
  const warnings = [...config.warnings, ...data.warnings, 'Legal pages are starter text, not legal advice: have them reviewed before launch.'];

  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });
  copyDir(path.join(ROOT, 'public'), DIST);

  const assets = buildAssets();
  const images = await buildImages(data.prompts, data.catBySlug, config, DIST, log);
  const demoCount = [...images.values()].filter((i) => i.demo).length;
  if (demoCount) warnings.push(`${demoCount} of ${images.size} prompts use clearly-labelled placeholder artwork. Add originals to images/originals/<slug>.jpg (see README).`);
  const { guides, warnings: guideWarnings } = loadGuides(data);
  warnings.push(...guideWarnings);
  const ctx = { config, data, images, assets, guides, hasDemoImages: demoCount > 0 };

  // ---- pages ----
  const pages = [
    homePage(ctx),
    ...promptsListPages(ctx),
    ...data.prompts.map((p) => promptPage(ctx, p)),
    categoriesIndexPage(ctx),
    ...data.categories.flatMap((c) => categoryPages(ctx, c)),
    trendingPage(ctx),
    guidesIndexPage(ctx),
    ...guides.map((g) => guidePage(ctx, g)),
    newPage(ctx),
    searchPage(ctx),
    ...staticPages(ctx),
    notFoundPage(ctx),
  ];
  const seen = new Set();
  for (const pg of pages) {
    if (seen.has(pg.path)) throw new Error(`Duplicate route generated: ${pg.path}`);
    seen.add(pg.path);
    const file = pg.path.endsWith('.html') ? pg.path.slice(1) : path.posix.join(pg.path.slice(1), 'index.html');
    writeFile(DIST, file, pg.html);
  }

  // ---- search index (card HTML is pre-rendered so client results match server cards) ----
  const index = {
    prompts: data.prompts.map((p) => ({
      slug: p.slug,
      title: p.title,
      description: p.description,
      promptText: p.promptText,
      category: p.category,
      categoryName: p.categoryName,
      tags: p.tags,
      style: p.style,
      styleLabel: p.styleLabel,
      uses: p.uses,
      useLabels: p.useLabels,
      tools: p.supportedTools,
      publishedAt: p.publishedAt,
      featured: !!p.featured,
      html: cardHtml(ctx, p, { level: 2 }),
    })),
  };
  writeFile(DIST, 'search-index.json', JSON.stringify(index));

  // ---- sitemap, robots, headers, redirects ----
  const indexable = pages.filter((p) => p.indexable);
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${indexable
    .map((p) => `  <url><loc>${xml(config.siteUrl + p.path)}</loc>${p.lastmod ? `<lastmod>${p.lastmod}</lastmod>` : ''}</url>`)
    .join('\n')}\n</urlset>\n`;
  writeFile(DIST, 'sitemap.xml', sitemap);
  writeFile(DIST, 'robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${config.siteUrl}/sitemap.xml\n`);
  writeFile(DIST, '_headers', buildHeaders(config));
  if (data.redirects.length) {
    writeFile(DIST, '_redirects', data.redirects.map((r) => `${r.from} ${r.to} 301`).join('\n') + '\n');
  }

  // ---- report ----
  log('ok', `Built ${pages.length} pages (${indexable.length} in sitemap), ${data.prompts.length} prompts, ${data.categories.length} categories in ${Date.now() - started} ms`);
  log('ok', `Assets: ${assets.css}, ${assets.js}`);
  for (const w of warnings) log('warn', w);
}

main().catch((err) => {
  console.error('\n✗ Build failed:\n' + (err.stack?.includes('Content validation') ? err.message : err.stack || err.message));
  process.exit(1);
});
