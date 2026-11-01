# Promptrin

A fast, static AI image prompt library. JSON content goes in; pre-rendered, SEO-ready HTML comes out.
**No framework, no required dependencies, no backend, no database, no accounts.** Needs Node 20+.

> Promptrin is the current brand name. Change it in one place: `brand.name` in `site.config.json` (or `BRAND_NAME` env var).

## Quick start

```bash
npm run dev          # build, serve http://localhost:4173, rebuild on every change
npm run build        # production build into dist/
npm run build:prod   # same, but fails unless SITE_URL is set (use this to deploy)
npm run check        # build + static verification + search unit tests
```

Optional: `npm install` adds `sharp`, which resizes and converts your real images to WebP. The site works without it.

## What you get

| Area | Details |
|---|---|
| Pages | Home, All prompts (paginated), Prompt detail (24), Categories index, Category pages (10), Search, Trending, New, About, Contact, Privacy, Terms, Disclaimer, Content guidelines, custom 404 |
| Search | Client-side over `/search-index.json`: title, description, category, tags, style, use. Plural-tolerant, AND matching, filters for category / style / use / tool, three sorts, loading, empty and error states |
| Copy | Clipboard API, `execCommand` fallback, and a select-for-manual-copy fallback with visible and screen-reader feedback. Copies only the prompt text |
| SEO | Unique titles and descriptions, canonicals, Open Graph/Twitter tags, `sitemap.xml`, `robots.txt`, breadcrumbs, JSON-LD (WebSite, Organization, Article, BreadcrumbList, CollectionPage), real pagination URLs, 301 redirects for renamed slugs |
| Performance | Zero third-party requests, hashed immutable CSS/JS, about 16 KB of JS (5 KB gzipped), `width`/`height` on every image, lazy loading with the first images prioritised, no web-font download |
| Accessibility | Skip link, visible focus, labelled buttons, one `h1` per page with no skipped heading levels (enforced by `verify`), keyboard-operable menus, `aria-live` status messages, reduced-motion support |
| Ads | AdSense-ready, **off by default** (see below) |

## Adding a prompt

1. Open the file for its category in `data/prompts/` (e.g. `ai-male-portraits.json`) and add an object. Copy an existing one; every field below is validated.

```jsonc
{
  "id": "pp-025",                       // unique, stable, never reused
  "slug": "my-new-prompt",              // becomes /prompts/my-new-prompt/
  "title": "My New Prompt",
  "description": "1-3 sentences, original, useful. Becomes the intro and meta description.",
  "promptText": "The full prompt, exactly as users should paste it.",
  "category": "ai-male-portraits",      // must exist in data/categories.json
  "tags": ["tag one", "tag two"],
  "style": "cinematic",                 // key from data/taxonomy.json
  "uses": ["profile-picture"],          // keys from data/taxonomy.json
  "aspect": "portrait", "ratio": "4:5",
  "imageAlt": "Describe the real image (used once an original is added)",
  "supportedTools": ["chatgpt"],        // only tools you have actually tried, see "tested"
  "tested": false,                      // true only after you verified it on those tools
  "publishedAt": "2026-10-30",
  "updatedAt": "2026-11-02",            // optional; shown as "Updated" and used in the sitemap
  "featured": false,
  "trendingRank": 9,                    // optional; position in the editorial Trending list
  "language": "en",
  "visualNotes": "Why the look works (unique per prompt).",
  "customize": { "lighting": "", "camera": "", "background": "", "wardrobe": "", "mood": "", "composition": "", "aspectRatio": "" }
}
```

2. Run `npm run check`. The build stops with a readable list if anything is missing, duplicated or unknown.
3. Add new styles, uses or tools in `data/taxonomy.json`; new categories in `data/categories.json`.

**Renaming a slug?** Add `{"from": "/prompts/old/", "to": "/prompts/new/"}` to `data/redirects.json` (create the file as a JSON array). It becomes a 301 in `_redirects` (Cloudflare Pages / Netlify). The build fails if the target does not exist.

## Replacing demonstration images

Every prompt currently shows **clearly labelled placeholder artwork** (generated SVG, tagged "DEMO ARTWORK"). It is not presented as the output of any prompt, and its alt text and caption say so. No AI image generator was available while building, so no images were generated.

To use a real, original image:

1. Generate or create it with a tool whose terms allow your intended use.
2. Save it as `images/originals/<prompt-slug>.jpg` (`.png`, `.webp`, `.avif` also work), using the aspect ratio set in the prompt's `ratio`.
3. Run `npm install` once (for `sharp`), then build. You get 480/800/1200 px WebP files with `srcset`, plus a 1200x630 JPEG for social sharing. The page switches to the prompt's `imageAlt`, drops the placeholder caption, and adds an `ImageObject` to its structured data.
4. Optionally set `"imageCredit": "..."` on the prompt for the caption. **Only state facts that are true** (e.g. do not name a model you did not use).

Missing or broken images fall back to a coloured block, not a broken icon.

## Configuration (environment variables)

Copy `.env.example` to `.env` locally, or set variables in your host's dashboard. Real values are never committed.

| Variable | Purpose |
|---|---|
| `SITE_URL` | **Required to deploy.** Production URL, e.g. `https://www.yourdomain.com`. Without it the build uses `https://promptrin.example` and warns |
| `BRAND_NAME` | Overrides `brand.name` |
| `CONTACT_EMAIL` / `CONTACT_FORM_ACTION` | Real contact details. If neither is set the Contact page says it is not set up yet. Nothing is invented |
| `SOCIAL_INSTAGRAM`, `_PINTEREST`, `_YOUTUBE`, `_X`, `_FACEBOOK` | Shown in the footer only when set (https URLs) |
| `AUTHOR_NAME` | Adds an Article author to structured data. Leave blank unless real |
| `ADSENSE_CLIENT_ID`, `ADSENSE_SLOT_HOME`, `_CATEGORY`, `_PROMPT` | See below |

## AdSense

Ads are disabled until you supply a valid `ADSENSE_CLIENT_ID` (`ca-pub-...`) **and** a slot ID per placement. No IDs are included and none are invented. Slots exist on the homepage, category pages and prompt pages; each is labelled "Advertisement", sits away from the copy button and navigation, and is hidden until the visitor accepts the consent banner. Without consent the AdSense script is never requested. `ADS_ENABLED=false` switches everything off without deleting IDs.

Things this does **not** do for you:
- AdSense approval is not guaranteed. Google reviews content quality, so add your own original images and keep adding genuinely useful prompts.
- Visitors from the EEA, UK and Switzerland need a Google-certified consent management platform for personalised ads. The built-in banner is a simple opt-in and is not a certified CMP.
- When ads are enabled, `_headers` omits the Content-Security-Policy (AdSense needs a broad one). Add one per Google's documentation if you want it.

## Deployment (Cloudflare Pages or any static host)

The output is plain files in `dist/`; there is no server-side code.

**Cloudflare Pages:** connect the repo, set **Build command** `npm run build:prod`, **Output directory** `dist`, and add `SITE_URL` (plus any other variables) in *Settings > Environment variables*. `_headers` (security headers, caching, CSP) and `_redirects` are picked up automatically; `404.html` is served for unknown URLs.

**Netlify:** same build command and publish directory; `_headers` and `_redirects` use the same format.

**Other hosts:** upload `dist/`, serve `404.html` for missing paths, and add equivalent headers. Make sure `/folder/` serves `/folder/index.html`.

After deploying: submit `https://your-domain/sitemap.xml` in Google Search Console and check the coverage report. Nothing here promises rankings or traffic.

## Tests

| Command | What it checks |
|---|---|
| `npm run verify` | Every internal link and image file resolves, one `h1` per page, no skipped heading levels, unique titles/descriptions, canonicals, JSON-LD parses, sitemap lists exactly the indexable pages, `robots.txt`, no ad code when unconfigured |
| `npm test` | 15 unit tests for search, filters and sorting |
| `python3 scripts/e2e.py` | Optional real-browser run (needs Python Playwright + Chromium and `npm run preview`): overflow at 320/375/430/768/1024/1440 px, console errors, copy and share, mobile menu, search, filters, image fallback, theme |

## Project layout

```
data/            categories.json, taxonomy.json, prompts/*.json, redirects.json (optional)
images/originals/  your real images, named <slug>.jpg
public/          copied as-is (favicon, og-default.png)
src/             styles.css, app.js, search-core.js (shared with tests)
scripts/         build.mjs, dev.mjs, verify.mjs, test-search.mjs, e2e.py, lib/*
site.config.json brand, page size, homepage section sizes
```

Content is separate from presentation: templates in `scripts/lib/` only read the validated data.

## Self-hosting fonts (optional)

The design uses a system font stack, with Bricolage Grotesque / Inter used if installed, so there is no font download. To ship them, download the WOFF2 files, put them in `public/fonts/`, and add `@font-face` rules at the top of `src/styles.css` using `font-display: swap`. Self-hosting avoids sending visitors' IPs to a font CDN.

## German and other languages

Prototype groundwork only. Each prompt has a `language` field and the build builds only prompts matching `language` in `site.config.json`, skipping the rest with a notice. **Not done yet:** translated interface strings, `/de/` routes, `hreflang` tags and a German sitemap. Those need to be added before publishing German content.

## Known limitations

- The legal pages are starter text written for how this site works. They are not legal advice and must be reviewed before launch.
- The search index embeds every prompt. That is fine for hundreds of prompts; for thousands, split it or move to a hosted search.
- "Trending" is an editorial list. Real ranking would need privacy-respecting event data and abuse safeguards, which this version does not collect.
- Prompts are written as editorial drafts (`tested: false`); none have been verified against specific AI tools.

## Admin panel (add prompts, bulk upload, guides)

```bash
npm run admin          # http://127.0.0.1:4174
ADMIN_PASSWORD=secret npm run admin     # optional password (user name: admin)
npm run dev            # in a second terminal, to preview the site on :4173
```

The admin is a **local tool**. It listens only on `127.0.0.1`, writes to `data/prompts/*.json`,
`images/originals/` and `content/guides/*.md`, and is never part of the built site (`dist/`). Do not
deploy it or expose it to the internet. Backups of changed files go to `.admin-backups/` (last 30).

| Screen | What it does |
|---|---|
| Library | Every prompt with thumbnail, status, search, category filter, Copy, Edit, Delete |
| Add prompt | One prompt: image upload (drop, browse or paste), exact prompt text, SEO fields with a Google preview |
| Bulk upload | Drop 60+ images, set shared category/style/tools, paste all prompts in order, fill titles, descriptions and alt text, publish the rows marked Ready (in groups of 6, each group checked as a whole) |
| Drafts | Unfinished prompts; never built into the site |
| Guides | Markdown articles with an SEO checklist and Google preview; `{{prompts: slug-a, slug-b}}` inserts image cards |
| Publish site | Runs the build and the checks |

Publishing a prompt runs the same validation as the build and rolls back if anything is wrong.
Required for each prompt: image, title, prompt text (80+ characters), description (60+), alt text,
category, style, at least one use and one tag. The customisation guide and the "why it works" note are
optional; pages leave those sections out when empty.

**Honesty rules built in:** tick only the tools you really used, describe only what is visible in the alt
text, and do not call an AI image a photograph. Prompt text is stored exactly as pasted.

`npm run admin` needs no install. Install `sharp` (`npm install`) to get resized WebP images when you build.

### Guides

Articles live in `content/guides/<slug>.md` and publish at `/guides/<slug>/` with a table of contents,
Article JSON-LD, breadcrumbs and a sitemap entry. FAQ markup is deliberately not generated.

### PromptPin-style list pages

In a guide, `{{full-prompts: slug-a, slug-b, ...}}` shows each prompt in full: numbered heading, image,
description, the prompt text and a **Copy Prompt** button. In the admin: Guides, New guide, Insert prompts,
choose "Full prompts with Copy button", filter by category and press "Select all shown". Tick "Publish at
the top level" to use `/couple-ai-photo-prompts/` instead of `/guides/couple-ai-photo-prompts/`, and "Show
on the homepage" to link it from the homepage. Setting a related category links the guide from that
category page, and every prompt used in a guide links back to it.

## Deploying on Cloudflare Pages

**Git (recommended):** push the project to GitHub, then in Cloudflare: Workers & Pages, Create, Pages, Connect to Git.

| Setting | Value |
|---|---|
| Build command | `npm run build:cloudflare` (strict build plus all checks) |
| Build output directory | `dist` |
| Environment variable `SITE_URL` | not needed: the site address `https://promptrin.com` is set in `site.config.json` |
| Environment variable `CONTACT_EMAIL` | optional, shown on the Contact page |

Node 22 is selected by `.node-version`. `sharp` installs on Cloudflare's Linux builders, so images are
resized to WebP automatically. If `SITE_URL` is forgotten, the build still succeeds using Cloudflare's own
address and prints a warning; set `SITE_URL` before you rely on the site in Google.

**Direct upload:** `SITE_URL=https://YOURNAME.pages.dev npm run build:cloudflare`, zip the *contents* of
`dist/` (so `index.html` is at the top of the zip) and upload it under Pages, Upload assets.

What the build already handles for Cloudflare: clean URLs with trailing slashes, `404.html`, `_headers`
(security headers, long caching for hashed assets, strict CSP that also allows Cloudflare Web Analytics),
`_redirects`, `X-Robots-Tag: noindex` on `*.pages.dev` addresses when you use a custom domain (so preview
URLs do not compete with your real site), and checks for Pages limits (20,000 files, 25 MiB per file,
100 header rules). In the Cloudflare dashboard leave Rocket Loader and Auto Minify **off**; they rewrite
scripts and can conflict with the strict Content-Security-Policy. Email Address Obfuscation is safe.

After the first deploy: add the custom domain under Pages, Custom domains; then add the site to Google
Search Console and submit `/sitemap.xml`.

### If Cloudflare gave you a `*.workers.dev` address (Workers, not Pages)

Cloudflare now often creates a Worker with static assets instead of a Pages project. That works too, using
`wrangler.jsonc` in this project (it publishes only `dist/`). In the Worker's Settings, Build:

| Setting | Value |
|---|---|
| Build command | `npm run build:cloudflare` |
| Deploy command | `npx wrangler deploy` |
| Root directory | leave empty |

If you see the admin screen ("Prompt Admin ... could not start") on your live address, the wrong folder was
published. Make sure the build command above runs, so `dist/` exists and is what gets deployed. The admin
panel is a local tool and works only with `npm run admin` on your own computer.

## Online admin (private, on Cloudflare)

The same admin panel also runs online at `https://YOUR-SITE/admin`, so you can add prompts, bulk-upload images and edit guides from a phone browser. Saving **commits to your GitHub repository**, and Cloudflare rebuilds the site by itself (about 1 to 3 minutes). Nothing is stored in Cloudflare.

How it is locked down:

- Switched off until configured. If a secret is missing or weak, `/admin` shows a notice and the API answers 503.
- Password (14+ characters), checked in constant time, with a delay after every wrong try.
- Optional authenticator-app code (`TOTP_SECRET`). Strongly recommended: a leaked password is then not enough.
- Sessions are signed, `HttpOnly`, `Secure`, `SameSite=Strict`, last 8 hours, and are cancelled by changing `SESSION_SECRET` or the password.
- Every change also needs a custom header and a same-site `Origin` (CSRF protection). The page is `noindex` and cannot be framed.
- The GitHub token only needs access to this one repository.
- Every save is validated with the same rules as the build. Invalid data (or a guide that would break) is refused and nothing is committed.
- Drafts are local-only (use `npm run admin` on a computer for drafts).

### One-time setup

1. **Deploy as in the Workers section above** (build command `npm run build:cloudflare`, deploy command `npx wrangler deploy`). `wrangler.jsonc` already contains the Worker and the `/admin` routes.
2. **GitHub token**: GitHub, Settings, Developer settings, Personal access tokens, *Fine-grained tokens*, Generate. Repository access: *Only select repositories*, pick this one. Permissions, Repository: **Contents: Read and write** (nothing else). Set a one-year expiry and copy the token.
3. **Make secrets** on any device with Node: `node scripts/make-secrets.mjs`. It prints `SESSION_SECRET` and `TOTP_SECRET`. Add the TOTP key to an authenticator app (Google Authenticator, Authy, 2FAS) with "Enter a setup key".
4. **Add them in Cloudflare**: Workers & Pages, your Worker, Settings, Variables and Secrets, Add. Use type **Secret** for each:

   | Name | Value |
   |---|---|
   | `ADMIN_PASSWORD` | your own password, 14+ characters |
   | `SESSION_SECRET` | from step 3 (32+ characters) |
   | `TOTP_SECRET` | from step 3 (optional but recommended) |
   | `GITHUB_TOKEN` | the token from step 2 |
   | `GITHUB_REPO` | `your-username/your-repository` |
   | `GITHUB_BRANCH` | only if your branch is not `main` |

   Then deploy once more (or "Retry build") so the Worker restarts with the secrets.
5. Open `/admin` and sign in.

### Extra protection (free, recommended)

- **Cloudflare Access**: Zero Trust, Access, Applications, Add, Self-hosted. Application domain = your site, path `admin`; add a second one for path `api/admin`. Policy: Allow, emails = only your email, with One-time PIN. Nobody else even reaches the login page.
- **Rate limit**: your domain, Security, WAF, Rate limiting rules. If URI Path equals `/api/admin/login`, limit 5 requests per 1 minute per IP, action Block.

### Limits to know

- Workers Free allows 10 ms of CPU per request. Saving a few prompts is far below that; if Cloudflare ever shows error 1102 on a large bulk save, publish smaller batches or use the Workers Paid plan ($5/month).
- Up to 100 prompts per bulk save and 30 guides in the online admin. Images are limited to 10 MB each (the panel shrinks big photos for you).
- Edits made at the same moment from two places: the second save is refused with "reload and try again" instead of overwriting.
- Run `npm run check` after changing the admin code; it includes 28 Worker tests against a fake GitHub.
