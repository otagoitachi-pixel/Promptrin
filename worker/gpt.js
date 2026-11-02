// The ChatGPT (Custom GPT Action) publishing API.
//
//   GET  /api/gpt/health          liveness (public) and configuration checks (with the secret)
//   GET  /api/gpt/categories      categories and the allowed styles, uses, tools and ratios
//   GET  /api/gpt/tags            tags already in use
//   GET  /api/gpt/status/{slug}   whether a published prompt is already live on the site
//   POST /api/gpt/publish         1 to 10 prompts at once (all-or-nothing by default)
//   POST /api/gpt/publish/single  one prompt, flat body
//   GET  /api/gpt/openapi.json    the OpenAPI 3.1 file for the GPT editor (public, contains no secrets)
//
// This has its OWN secret (PROMPTRIN_GPT_SECRET) and never accepts the admin login cookie.
// It uses the same content rules and the same GitHub commit code as the admin panel, so there is only one
// content system.
import { SNAPSHOT } from './generated.js';
import { SLUG, RATIO, UserError, validateContent, sniffImage } from '../scripts/lib/shared.mjs';
import { hmac, equalBytes } from './auth.js';
import { createRepo } from './github.js';
import * as content from './content.js';
import { imageSize, nearestRatio, toBase64 } from './imageinfo.js';
import { createLimiter } from './ratelimit.js';
import { openapi } from './openapi.js';

export const LIMITS = { maxBodyBytes: 12 * 1024 * 1024, maxImageBytes: 8 * 1024 * 1024, minImageBytes: 1024, minSide: 256 };
const HEAD_BYTES = 48 * 1024; // enough to read the type and pixel size of any image

const failLimiter = createLimiter({ limit: 9, windowMs: 60_000 });
const callLimiter = createLimiter({ limit: 60, windowMs: 60_000 });
const publishLimiter = createLimiter({ limit: 8, windowMs: 60_000 });
export const resetGptLimiters = () => [failLimiter, callLimiter, publishLimiter].forEach((l) => l.reset());

const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' };
const json = (status, body, extra = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers, ...extra } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function gptConfigProblems(env) {
  const out = [];
  if (!env.PROMPTRIN_GPT_SECRET || env.PROMPTRIN_GPT_SECRET.length < 32) out.push('PROMPTRIN_GPT_SECRET must be set and at least 32 characters.');
  if (!env.GITHUB_TOKEN) out.push('GITHUB_TOKEN is not set.');
  if (!/^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPO || '')) out.push('GITHUB_REPO must look like "username/repository".');
  return out;
}

async function bearerOk(request, env) {
  const m = /^Bearer\s+(\S+)$/i.exec(request.headers.get('Authorization') || '');
  if (!m) return false;
  const key = `gpt|${env.PROMPTRIN_GPT_SECRET}`;
  return equalBytes(await hmac(key, m[1]), await hmac(key, env.PROMPTRIN_GPT_SECRET));
}

// ---------------------------------------------------------------- text helpers

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩﻿]/g;
const oneLine = (v) => String(v).replace(CONTROL, '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const block = (v) => String(v).replace(/\r\n?/g, '\n').replace(CONTROL, '').replace(/\n{3,}/g, '\n\n').trim();
export const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
export const slugify = (s) => norm(s).replace(/ /g, '-').slice(0, 70).replace(/-+$/, '');
const shingles = (s) => { const w = norm(s).split(' ').filter(Boolean); const out = new Set(); for (let i = 0; i + 3 <= w.length; i++) out.add(w.slice(i, i + 3).join(' ')); return out; };
const jaccard = (a, b) => { if (!a.size || !b.size) return 0; let n = 0; for (const x of a) if (b.has(x)) n++; return n / (a.size + b.size - n); };
const SEARCH_INTENTS = ['informational', 'commercial', 'transactional', 'navigational'];
const TAG_RE = /^[a-z0-9][a-z0-9 '&-]{1,29}$/;

function readStr(raw, key, errors, { max, min = 0, required = true, multiline = false, alias } = {}) {
  const v = raw[key] ?? (alias ? raw[alias] : undefined);
  if (v === undefined || v === null || v === '') { if (required) errors.push(`${key}: required.`); return ''; }
  if (typeof v !== 'string') { errors.push(`${key}: must be text.`); return ''; }
  const t = multiline ? block(v) : oneLine(v);
  if (t.length < min) errors.push(`${key}: too short (${t.length} characters, minimum ${min}).`);
  if (t.length > max) errors.push(`${key}: too long (${t.length} characters, maximum ${max}).`);
  return t;
}
function readList(raw, key, errors, { min = 0, max, itemMax, required = false } = {}) {
  const v = raw[key];
  if (v === undefined || v === null) { if (required) errors.push(`${key}: required.`); return []; }
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) { errors.push(`${key}: must be a list of text values.`); return []; }
  const out = [...new Set(v.map(oneLine).filter(Boolean))];
  if (out.length < min) errors.push(`${key}: add at least ${min}.`);
  if (out.length > max) errors.push(`${key}: at most ${max} allowed.`);
  for (const x of out) if (x.length > itemMax) errors.push(`${key}: "${x.slice(0, 20)}…" is too long (maximum ${itemMax} characters).`);
  return out;
}

/** Checks one incoming entry (no network). Returns { errors, warnings, item, imageSource }. */
export function parseItem(raw, n, { single = false, taxonomy = SNAPSHOT.taxonomy, categories = SNAPSHOT.categories, language = SNAPSHOT.language } = {}) {
  const errors = [];
  const warnings = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { errors: ['Each entry must be an object.'], warnings, item: null };
  const title = readStr(raw, 'title', errors, { min: 8, max: 90 });
  const description = readStr(raw, 'description', errors, { min: 60, max: 400 });
  const promptText = readStr(raw, 'prompt', errors, { min: 80, max: 4000, multiline: true, alias: 'promptText' });
  const seoTitle = readStr(raw, 'seo_title', errors, { min: 15, max: 70 });
  const seoDescription = readStr(raw, 'meta_description', errors, { min: 70, max: 170 });
  const imageAlt = readStr(raw, 'image_alt', errors, { min: 10, max: 160 });
  const primaryKeyword = readStr(raw, 'primary_keyword', errors, { min: 2, max: 80 });
  if (seoTitle && seoTitle.length > 60) warnings.push('seo_title is over 60 characters; Google may cut it off.');
  if (seoDescription && seoDescription.length > 155) warnings.push('meta_description is over 155 characters; Google may cut it off.');

  let slug = raw.slug === undefined || raw.slug === '' ? slugify(title) : String(raw.slug).trim();
  if (!slug || slug.length < 3 || slug.length > 70 || !SLUG.test(slug)) errors.push('slug: use 3 to 70 lowercase letters, numbers and single hyphens (or leave it out to create one from the title).');

  const category = typeof raw.category === 'string' ? raw.category.trim() : '';
  if (!categories.some((c) => c.slug === category)) errors.push(`category: "${category || ''}" is not a category. Use one of: ${categories.map((c) => c.slug).join(', ')}.`);

  const tags = readList(raw, 'tags', errors, { min: 2, max: 10, itemMax: 30, required: true }).map((t) => t.toLowerCase());
  for (const t of tags) if (!TAG_RE.test(t)) errors.push(`tags: "${t}" is not a valid tag (2 to 30 letters, numbers, spaces or hyphens).`);

  const style = typeof raw.style === 'string' ? raw.style.trim() : '';
  if (!taxonomy.styles[style]) errors.push(`style: "${style}" is not valid. Use one of: ${Object.keys(taxonomy.styles).join(', ')}.`);
  let uses = readList(raw, 'uses', errors, { max: 6, itemMax: 40 });
  if (!uses.length) { uses = ['social-media']; warnings.push('uses was not given, so "social-media" was used. Pick the real uses next time.'); }
  for (const u of uses) if (!taxonomy.uses[u]) errors.push(`uses: "${u}" is not valid. Use: ${Object.keys(taxonomy.uses).join(', ')}.`);
  const supportedTools = readList(raw, 'supported_tools', errors, { max: 6, itemMax: 30 });
  for (const t of supportedTools) if (!taxonomy.tools[t]) errors.push(`supported_tools: "${t}" is not valid. Use: ${Object.keys(taxonomy.tools).join(', ')}.`);
  const secondaryKeywords = readList(raw, 'secondary_keywords', errors, { max: 10, itemMax: 80 });

  const searchIntent = raw.search_intent ? String(raw.search_intent).trim().toLowerCase() : '';
  if (searchIntent && !SEARCH_INTENTS.includes(searchIntent)) errors.push(`search_intent: use one of ${SEARCH_INTENTS.join(', ')}.`);
  const targetCountry = raw.target_country ? oneLine(raw.target_country).slice(0, 40) : '';
  const lang = raw.target_language ? String(raw.target_language).trim().toLowerCase() : language;
  if (lang !== language) errors.push(`target_language: this site is built in "${language}" only, so "${lang}" entries would not appear.`);
  const status = raw.status === undefined ? 'published' : raw.status;
  if (status !== 'published') errors.push('status: only "published" is supported. Drafts are not available through the API.');

  let ratio = '';
  if (raw.ratio) { ratio = String(raw.ratio).trim(); if (!RATIO.test(ratio)) errors.push('ratio: use a value like "4:5" or "2:3".'); }

  // The one-prompt endpoint takes its image from the first attached file unless told otherwise.
  if (single && raw.image_index === undefined && !raw.image_base64) raw = { ...raw, image_index: 0 };
  const hasIndex = raw.image_index !== undefined && raw.image_index !== null;
  const hasB64 = typeof raw.image_base64 === 'string' && raw.image_base64;
  if (hasIndex && hasB64) errors.push('image: give image_index OR image_base64, not both.');
  else if (!hasIndex && !hasB64) errors.push('image: required. Give image_index (the position of the generated image in openaiFileIdRefs) or image_base64.');
  else if (hasIndex && (!Number.isInteger(raw.image_index) || raw.image_index < 0)) errors.push('image_index: must be a whole number starting at 0.');

  const item = {
    title, slug, description, promptText, category, tags, style, uses, ratio, imageAlt, supportedTools,
    tested: false, language: lang, seoTitle, seoDescription, primaryKeyword, secondaryKeywords, searchIntent, targetCountry,
  };
  return { errors: errors.map((e) => e), warnings, item, imageSource: hasIndex ? { index: raw.image_index } : hasB64 ? { dataUrl: raw.image_base64 } : null, allowSimilarKeyword: raw.allow_similar_keyword === true, n };
}

/** Duplicate and keyword-overlap checks against what is published and against earlier entries in the batch. */
export function duplicateChecks(item, existing, { allowSimilarKeyword = false, imageSlugs = new Set() } = {}) {
  const errors = [];
  const warnings = [];
  const kw = norm(item.primaryKeyword);
  const title = norm(item.title);
  const shing = shingles(item.promptText);
  for (const p of existing) {
    const label = `"${p.title}" (/prompts/${p.slug}/)`;
    if (p.slug === item.slug) errors.push(`slug: "${item.slug}" is already used by ${label}. Choose a different slug.`);
    if (title && norm(p.title) === title) errors.push(`title: the same title already exists on ${label}.`);
    else if (title && jaccard(new Set(title.split(' ')), new Set(norm(p.title).split(' '))) >= 0.85) warnings.push(`title: very similar to ${label}.`);
    const sim = jaccard(shing, shingles(p.promptText));
    if (sim >= 0.8) errors.push(`prompt: nearly identical (${Math.round(sim * 100)}% overlap) to the prompt on ${label}.`);
    else if (sim >= 0.6) warnings.push(`prompt: ${Math.round(sim * 100)}% similar to the prompt on ${label}.`);
    if (kw && (norm(p.primaryKeyword) === kw || norm(p.title) === kw)) {
      const msg = `primary_keyword: "${item.primaryKeyword}" is already targeted by ${label}. Pick a different keyword or angle (or set allow_similar_keyword to true if this is deliberate).`;
      (allowSimilarKeyword ? warnings : errors).push(msg);
    }
    if (item.seoTitle && p.seoTitle && norm(p.seoTitle) === norm(item.seoTitle)) errors.push(`seo_title: identical to the SEO title of ${label}. Titles must be unique.`);
    if (item.seoDescription && p.seoDescription && norm(p.seoDescription) === norm(item.seoDescription)) errors.push(`meta_description: identical to the one on ${label}. Descriptions must be unique.`);
    if (p.imageAlt && norm(p.imageAlt) === norm(item.imageAlt)) warnings.push(`image_alt: identical to the alt text on ${label}.`);
  }
  if (imageSlugs.has(item.slug)) errors.push(`slug: an image named "${item.slug}" already exists, and existing images are never overwritten.`);
  return { errors, warnings };
}

// ---------------------------------------------------------------- images

const hostAllowed = (host, env) => (env.GPT_FILE_HOSTS || 'oaiusercontent.com,openai.com,chatgpt.com').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean).some((h) => host === h || host.endsWith('.' + h));

/** Downloads a file ChatGPT attached to the request. Only https links on OpenAI hosts are followed. */
async function downloadRef(ref, env, fetchFile) {
  if (!ref || typeof ref !== 'object' || typeof ref.download_link !== 'string') throw new UserError(['image: that file reference is missing a download link.']);
  let u;
  try { u = new URL(ref.download_link); } catch { throw new UserError(['image: the download link is not a valid address.']); }
  if (u.protocol !== 'https:' || u.username || u.password || !hostAllowed(u.hostname.toLowerCase(), env)) throw new UserError(['image: the download link is not on an allowed host, so it was not fetched.']);
  let res;
  try { res = await fetchFile(u.toString(), { redirect: 'error', headers: { Accept: 'image/*' } }); } catch { throw new UserError(['image: the generated image could not be downloaded (the link may have expired after 5 minutes). Generate and send it again.']); }
  if (!res.ok) throw new UserError([`image: download failed (${res.status}). The link may have expired; send the image again.`]);
  const len = Number(res.headers.get('Content-Length') || 0);
  if (len > LIMITS.maxImageBytes) throw new UserError([`image: ${(len / 1048576).toFixed(1)} MB is over the ${LIMITS.maxImageBytes / 1048576} MB limit.`]);
  const bytes = new Uint8Array(await res.arrayBuffer());
  return bytes;
}

function inspectBytes(bytes) {
  if (bytes.length > LIMITS.maxImageBytes) throw new UserError([`image: ${(bytes.length / 1048576).toFixed(1)} MB is over the ${LIMITS.maxImageBytes / 1048576} MB limit.`]);
  if (bytes.length < LIMITS.minImageBytes) throw new UserError(['image: the file is too small to be a real image.']);
  const ext = sniffImage(bytes);
  if (!ext) throw new UserError(['image: not a valid JPEG, PNG or WebP file (the file contents were checked, not just the name).']);
  const size = imageSize(bytes, ext);
  if (!size || size.width < LIMITS.minSide || size.height < LIMITS.minSide) throw new UserError([`image: could not read a usable size (at least ${LIMITS.minSide}px on each side is needed).`]);
  return { ext, ...size };
}

async function loadImage(source, refs, env, fetchFile) {
  if (source.index !== undefined) {
    const ref = refs[source.index];
    if (!ref) throw new UserError([`image_index ${source.index}: no file at that position in openaiFileIdRefs (${refs.length} attached).`]);
    const bytes = await downloadRef(ref, env, fetchFile);
    const info = inspectBytes(bytes);
    return { ...info, bytes, b64: null };
  }
  const m = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(source.dataUrl);
  if (!m) throw new UserError(['image_base64: must be a data URL such as data:image/png;base64,... (JPEG, PNG or WebP).']);
  const b64 = m[1];
  const size = Math.floor((b64.length * 3) / 4) - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);
  if (size > LIMITS.maxImageBytes) throw new UserError([`image: ${(size / 1048576).toFixed(1)} MB is over the ${LIMITS.maxImageBytes / 1048576} MB limit.`]);
  const headLen = Math.min(b64.length - (b64.length % 4), Math.ceil(HEAD_BYTES / 3) * 4);
  const head = Uint8Array.from(atob(b64.slice(0, headLen)), (c) => c.charCodeAt(0));
  const type = sniffImage(head);
  if (!type) throw new UserError(['image: not a valid JPEG, PNG or WebP file.']);
  const dims = imageSize(head, type);
  if (!dims || dims.width < LIMITS.minSide || dims.height < LIMITS.minSide) throw new UserError([`image: could not read a usable size (at least ${LIMITS.minSide}px on each side is needed).`]);
  return { ext: type, ...dims, bytes: { length: size }, b64 };
}

// ---------------------------------------------------------------- publish

const maxItems = (env) => Math.min(20, Math.max(1, Number(env.GPT_MAX_ITEMS) || 10));
const subrequestLimit = (env) => Number(env.GPT_SUBREQUEST_LIMIT) || 45; // Workers Free allows 50 per request

async function readBody(request) {
  const len = Number(request.headers.get('Content-Length') || 0);
  if (len > LIMITS.maxBodyBytes) throw new UserError([`The request is too large (limit ${LIMITS.maxBodyBytes / 1048576} MB). Send images as ChatGPT file references (openaiFileIdRefs), not inline.`], 413);
  const text = await request.text();
  if (text.length > LIMITS.maxBodyBytes) throw new UserError(['The request is too large.'], 413);
  try { const v = text ? JSON.parse(text) : {}; if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(); return v; } catch { throw new UserError(['The body must be a JSON object.'], 400); }
}

async function publish(request, env, deps, { single }) {
  const body = await readBody(request);
  const refs = Array.isArray(body.openaiFileIdRefs) ? body.openaiFileIdRefs : [];
  if (body.openaiFileIdRefs !== undefined && !Array.isArray(body.openaiFileIdRefs)) throw new UserError(['openaiFileIdRefs must be a list.'], 400);
  let rawItems;
  if (single) { const { openaiFileIdRefs, dry_run, ...rest } = body; rawItems = [rest.item && typeof rest.item === 'object' ? rest.item : rest]; }
  else rawItems = body.items;
  if (!Array.isArray(rawItems) || !rawItems.length) throw new UserError(['items: send a list with at least one prompt.'], 400);
  const cap = maxItems(env);
  if (rawItems.length > cap) throw new UserError([`items: at most ${cap} prompts per request (ChatGPT can attach 10 files per call). Send the rest in another request.`], 413);
  const dryRun = body.dry_run === true;
  const allowPartial = body.allow_partial === true;

  const repo = deps.repo ? deps.repo(env) : createRepo(env);
  const state = await content.loadState(repo);
  const ctx = { taxonomy: SNAPSHOT.taxonomy, categories: SNAPSHOT.categories, redirects: SNAPSHOT.redirects };
  const existing = content.flatten(state.files);

  // Budget check before any download: each entry needs one download and one blob upload, plus the final commit.
  const need = repo.calls + rawItems.length * 2 + 3;
  if (need > subrequestLimit(env)) {
    const fit = Math.max(1, Math.floor((subrequestLimit(env) - repo.calls - 3) / 2));
    throw new UserError([`This request would make about ${need} calls to GitHub, over the limit of ${subrequestLimit(env)} for one request on your Cloudflare plan. Send at most ${fit} prompts per request, or move the Worker to the Paid plan and set GPT_SUBREQUEST_LIMIT.`], 413);
  }

  // 1. Text checks (no network).
  const results = rawItems.map((raw, i) => ({ index: i, title: typeof raw?.title === 'string' ? oneLine(raw.title).slice(0, 90) : '', slug: '', status: 'pending', errors: [], warnings: [] }));
  const parsed = rawItems.map((raw, i) => parseItem(raw, i, { single }));
  const accepted = [];
  const imageSlugs = new Set([...state.images.keys()]);
  const usedIndexes = new Map();
  parsed.forEach((p, i) => {
    const r = results[i];
    r.errors.push(...p.errors);
    r.warnings.push(...p.warnings);
    if (p.item) {
      r.slug = p.item.slug;
      r.title = p.item.title || r.title;
      const dup = duplicateChecks(p.item, [...existing, ...accepted.map((a) => ({ ...a.item, id: 'batch' }))], { allowSimilarKeyword: p.allowSimilarKeyword, imageSlugs });
      r.errors.push(...dup.errors);
      r.warnings.push(...dup.warnings);
      if (p.imageSource?.index !== undefined) {
        if (usedIndexes.has(p.imageSource.index)) r.errors.push(`image_index ${p.imageSource.index} is already used by entry ${usedIndexes.get(p.imageSource.index) + 1}. Each prompt needs its own image.`);
        else usedIndexes.set(p.imageSource.index, i);
      }
    }
    if (!r.errors.length) accepted.push({ ...p, i });
  });

  // 2. Download and inspect the images of entries that passed (saves requests on bad batches).
  const fetchFile = deps.fetchFile || ((u, o) => fetch(u, o));
  await Promise.all(accepted.map(async (a) => {
    const r = results[a.i];
    try {
      a.image = await loadImage(a.imageSource, refs, env, fetchFile);
      if (!a.item.ratio) a.item.ratio = nearestRatio(a.image);
      r.image = { type: a.image.ext, width: a.image.width, height: a.image.height, bytes: a.image.bytes.length, ratio: a.item.ratio };
    } catch (e) {
      if (!(e instanceof UserError)) throw e;
      r.errors.push(...e.errors);
    }
  }));
  const good = accepted.filter((a) => !results[a.i].errors.length);

  const anyRejected = results.some((r) => r.errors.length);
  const finish = (status, extra = {}) => {
    for (const r of results) if (r.status === 'pending') r.status = r.errors.length ? 'rejected' : status === 'dry_run' ? 'valid' : 'not_published';
    return { status, published: results.filter((r) => r.status === 'published').length, total: results.length, results, ...extra };
  };
  const origin = new URL(request.url).origin;

  if ((anyRejected && !allowPartial) || !good.length) {
    for (const r of results) if (!r.errors.length) r.warnings.push('This entry is fine but was not published because another entry in the request failed. Nothing was changed. Fix the failed entries and send the whole request again (or set allow_partial to true).');
    return json(422, finish('rejected', { message: 'Nothing was published. See the errors for each entry.' }));
  }
  if (dryRun) return json(200, finish('dry_run', { message: 'Checks passed for the valid entries. Nothing was saved.' }));

  // 3. Upload images. Nothing is part of the site until the single commit below succeeds.
  const uploaded = [];
  for (const a of good) {
    const r = results[a.i];
    try {
      const b64 = a.image.b64 || toBase64(a.image.bytes);
      a.imageBlob = { sha: await repo.createBlob(b64), ext: a.image.ext };
      a.image.bytes = { length: a.image.bytes.length };
      uploaded.push(a);
    } catch (e) {
      if (!(e instanceof UserError)) throw e;
      r.errors.push(`image upload failed: ${e.errors[0]}`);
    }
  }
  if (uploaded.length !== good.length && !allowPartial) {
    for (const r of results) if (!r.errors.length) r.warnings.push('Not published because an image upload failed. Nothing was changed.');
    return json(502, finish('rejected', { message: 'An image upload failed, so nothing was published.' }));
  }
  if (!uploaded.length) return json(502, finish('rejected', { message: 'No image could be uploaded, so nothing was published.' }));

  // 4. One commit for all entries (the admin panel's own validation runs again here).
  let out;
  try {
    out = await content.bulkPublishLoaded(repo, state, ctx, uploaded.map((a) => ({ ...a.item, imageBlob: a.imageBlob })));
  } catch (e) {
    if (!(e instanceof UserError)) throw e;
    for (const a of uploaded) results[a.i].errors.push(...e.errors);
    return json(e.status >= 500 || e.status === 409 ? e.status : 422, finish('rejected', { message: e.status === 409 ? 'The site changed while publishing. Nothing was saved; try again.' : 'Final validation failed, so nothing was published.' }));
  }
  uploaded.forEach((a, k) => {
    const r = results[a.i];
    const added = out.result.added[k];
    r.status = 'published';
    r.id = added.id;
    r.slug = added.slug;
    r.url = `${origin}/prompts/${added.slug}/`;
    r.imagePath = `images/originals/${added.slug}.${a.imageBlob.ext}`;
  });
  const warnings = out.result.warnings || [];
  return json(200, finish(results.some((r) => r.errors.length) ? 'partial' : 'published', {
    commit: out.commit,
    commitUrl: out.commitUrl,
    deployment: { triggered: true, verified: false, note: 'The commit is saved on GitHub and Cloudflare is building it now. This usually takes 1 to 3 minutes. Use GET /api/gpt/status/{slug} to check when a page is live.' },
    siteWarnings: warnings.slice(0, 10),
  }));
}

// ---------------------------------------------------------------- router

export async function handleGpt(request, env, deps = {}) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  const route = path.slice('/api/gpt'.length) || '/';
  const m = request.method;

  if (route === '/openapi.json' && m === 'GET') return json(200, openapi(url.origin), { 'Cache-Control': 'no-cache' });
  if (route === '/health' && m === 'GET' && !request.headers.get('Authorization')) return json(200, { status: 'ok', service: 'promptrin-gpt-api' });

  try {
    const problems = gptConfigProblems(env);
    if (problems.length) return json(503, { errors: ['The publishing API is not configured yet. Set the secrets listed in the setup guide.'] });
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (failLimiter.blocked(ip)) return json(429, { errors: ['Too many failed attempts. Wait a minute.'] }, { 'Retry-After': '60' });
    if (!(await bearerOk(request, env))) {
      failLimiter.hit(ip);
      await sleep(deps.failDelay ?? 400);
      return json(401, { errors: ['Missing or invalid API secret.'] }, { 'WWW-Authenticate': 'Bearer realm="promptrin-gpt"' });
    }
    const rl = callLimiter.hit(ip, Date.now(), Number(env.GPT_CALLS_PER_MINUTE) || 60);
    const bound = env.GPT_LIMIT ? (await env.GPT_LIMIT.limit({ key: 'gpt' })).success : true;
    if (!rl.ok || !bound) return json(429, { errors: ['Rate limit reached. Wait a minute and try again.'] }, { 'Retry-After': String(rl.retryAfter || 60) });

    const repo = () => (deps.repo ? deps.repo(env) : createRepo(env));
    if (route === '/health' && m === 'GET') {
      const head = await repo().head();
      return json(200, { status: 'ok', service: 'promptrin-gpt-api', authenticated: true, repo: env.GITHUB_REPO, branch: env.GITHUB_BRANCH || 'main', latestCommit: head.commit, maxPromptsPerRequest: maxItems(env), maxImageMegabytes: LIMITS.maxImageBytes / 1048576 });
    }
    if (route === '/categories' && m === 'GET') {
      const t = SNAPSHOT.taxonomy;
      return json(200, {
        categories: SNAPSHOT.categories.map((c) => ({ slug: c.slug, name: c.name, description: c.short })),
        styles: Object.entries(t.styles).map(([slug, name]) => ({ slug, name })),
        uses: Object.entries(t.uses).map(([slug, name]) => ({ slug, name })),
        tools: Object.entries(t.tools).map(([slug, v]) => ({ slug, name: v.name || slug })),
        ratios: ['1:1', '4:5', '3:4', '2:3', '9:16', '3:2', '4:3', '16:9'],
        language: SNAPSHOT.language,
      });
    }
    if (route === '/tags' && m === 'GET') {
      const state = await content.loadState(repo());
      const counts = new Map();
      for (const p of content.flatten(state.files)) for (const t of p.tags || []) counts.set(t, (counts.get(t) || 0) + 1);
      return json(200, { tags: [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([tag, count]) => ({ tag, count })), note: 'New tags are allowed (2 to 30 letters, numbers, spaces or hyphens). Reuse an existing tag when it fits.' });
    }
    let sm;
    if ((sm = /^\/status\/([a-z0-9-]{1,70})$/.exec(route)) && m === 'GET') {
      const state = await content.loadState(repo());
      const inRepo = content.flatten(state.files).some((p) => p.slug === sm[1]);
      let live = false;
      if (env.ASSETS) live = (await env.ASSETS.fetch(new Request(`${url.origin}/prompts/${sm[1]}/`, { method: 'HEAD' }))).status === 200;
      return json(200, { slug: sm[1], savedOnGitHub: inRepo, live, url: `${url.origin}/prompts/${sm[1]}/`, note: inRepo && !live ? 'Saved, but the new site version is not live yet. Check again in a minute.' : undefined });
    }
    if ((route === '/publish' || route === '/publish/single') && m === 'POST') {
      if (!publishLimiter.hit(ip, Date.now(), Number(env.GPT_PUBLISH_PER_MINUTE) || 8).ok) return json(429, { errors: ['Too many publish requests. Wait a minute.'] }, { 'Retry-After': '60' });
      return await publish(request, env, deps, { single: route === '/publish/single' });
    }
    return json(404, { errors: ['Not found'] });
  } catch (e) {
    if (e instanceof UserError) return json(e.status, { errors: e.errors });
    console.error('gpt api error', e && e.message);
    return json(500, { errors: ['Unexpected server error. Try again; if it keeps happening, check the Worker logs in Cloudflare.'] });
  }
}
