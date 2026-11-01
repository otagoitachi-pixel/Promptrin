// Local admin panel: add, edit and publish prompts and their AI images without touching JSON by hand.
//
//   npm run admin                          http://127.0.0.1:4174
//   ADMIN_PASSWORD=secret npm run admin    asks for a password (user name: admin)
//
// What it does
//   - Writes to data/prompts/<category>.json and images/originals/<slug>.<ext>, the same files the
//     site build already reads. Nothing else changes, and there is no database.
//   - Runs the SAME validation as the build before saving a published prompt. If validation fails,
//     the files are rolled back and the errors are shown.
//   - Drafts live in data/drafts/ and are never built into the site.
//   - Backs up a category file to .admin-backups/ before each change (last 30 kept).
//
// Security model: this is a local tool. It only listens on 127.0.0.1, checks the Host and Origin
// headers, and requires a custom header on every change. It is NOT meant to be deployed or exposed to
// the internet. The public site stays fully static.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { ROOT, loadConfig } from './lib/config.mjs';
import { loadData } from './lib/data.mjs';
import { loadGuides } from './lib/guides.mjs';
import { CUSTOMIZE_KEYS, CUSTOMIZE_LABELS, SLUG, IMAGE_EXTS, UserError, today, str, sniffImage as sniffBytes, nextIdFrom, normalisePrompt, renderMarkdown, parseGuideFile, serializeGuide } from './lib/shared.mjs';

const PORT = Number(process.env.ADMIN_PORT) || 4174;
const HOST = '127.0.0.1';
const PASSWORD = process.env.ADMIN_PASSWORD || '';
const MAX_BODY = 48 * 1024 * 1024;
const MAX_IMAGE = 10 * 1024 * 1024;
const PROMPTS_DIR = path.join(ROOT, 'data/prompts');
const DRAFTS_DIR = path.join(ROOT, 'data/drafts');
const IMAGES_DIR = path.join(ROOT, 'images/originals');
const BACKUP_DIR = path.join(ROOT, '.admin-backups');

const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const writeJson = (f, v) => {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(v, null, 2) + '\n');
};

// ---------------------------------------------------------------- helpers

const sniffImage = (buf) => sniffBytes(new Uint8Array(buf));

function decodeDataUrl(dataUrl) {
  const m = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl || '');
  if (!m) throw new UserError(['The image must be a JPG, PNG or WebP file.']);
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > MAX_IMAGE) throw new UserError([`The image is ${(buf.length / 1048576).toFixed(1)} MB. The limit is ${MAX_IMAGE / 1048576} MB.`]);
  const ext = sniffImage(buf);
  if (!ext) throw new UserError(['That file is not a valid JPG, PNG or WebP image.']);
  return { buf, ext };
}

function findImage(slug) {
  if (!SLUG.test(slug || '')) return null;
  for (const ext of IMAGE_EXTS) {
    const f = path.join(IMAGES_DIR, `${slug}.${ext}`);
    if (fs.existsSync(f)) return { file: f, ext };
  }
  return null;
}

function removeImages(slug) {
  for (const ext of IMAGE_EXTS) fs.rmSync(path.join(IMAGES_DIR, `${slug}.${ext}`), { force: true });
}

function backup(file) {
  if (!fs.existsSync(file)) return;
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.copyFileSync(file, path.join(BACKUP_DIR, `${stamp}__${path.basename(file)}`));
  const all = fs.readdirSync(BACKUP_DIR).sort();
  for (const old of all.slice(0, Math.max(0, all.length - 30))) fs.rmSync(path.join(BACKUP_DIR, old), { force: true });
}

/** All published prompts with the file they live in. */
function readAllPrompts() {
  const out = [];
  for (const f of fs.readdirSync(PROMPTS_DIR).filter((x) => x.endsWith('.json')).sort()) {
    for (const p of readJson(path.join(PROMPTS_DIR, f))) out.push({ ...p, _file: f });
  }
  return out;
}

function readDrafts() {
  if (!fs.existsSync(DRAFTS_DIR)) return [];
  return fs.readdirSync(DRAFTS_DIR).filter((f) => f.endsWith('.json')).sort().map((f) => ({ ...readJson(path.join(DRAFTS_DIR, f)), _draft: true }));
}

function nextId() {
  return nextIdFrom([...readAllPrompts(), ...readDrafts()]);
}

const normalise = (input, previous) => normalisePrompt(input, previous, { id: nextId() });

/** Runs the build's own validation. Returns a list of error strings (empty when fine). */
function validateContent() {
  try {
    const { warnings } = loadData(loadConfig());
    return { errors: [], warnings };
  } catch (e) {
    const lines = String(e.message).split('\n').map((l) => l.replace(/^\s*-\s*/, '').trim()).filter((l) => l && !/^Content validation failed/.test(l));
    return { errors: lines.length ? lines : [e.message], warnings: [] };
  }
}

// ---------------------------------------------------------------- actions

function savePublished(input) {
  const all = readAllPrompts();
  const previous = input.id ? all.find((p) => p.id === input.id) : null;
  if (input.id && !previous && !readDrafts().some((d) => d.id === input.id)) throw new UserError(['That prompt no longer exists. Reload the page.'], 404);
  const prompt = normalise(input, previous);

  // Image: required for a published prompt unless one already exists (or the slug is unchanged).
  let image = null;
  if (input.imageData) image = decodeDataUrl(input.imageData);
  const oldSlug = previous?.slug;
  const hasExisting = !!(findImage(prompt.slug) || (oldSlug && findImage(oldSlug)));
  const draftWithImage = readDrafts().find((d) => d.id === prompt.id)?.imageData;
  if (!image && !hasExisting && draftWithImage) image = decodeDataUrl(draftWithImage);

  const targetFile = path.join(PROMPTS_DIR, `${prompt.category}.json`);
  const sourceFile = previous ? path.join(PROMPTS_DIR, previous._file) : null;
  const touched = new Set([targetFile, ...(sourceFile ? [sourceFile] : [])]);
  const snapshots = new Map([...touched].map((f) => [f, fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null]));
  const rollback = () => {
    for (const [f, content] of snapshots) content === null ? fs.rmSync(f, { force: true }) : fs.writeFileSync(f, content);
  };

  try {
    for (const f of touched) backup(f);
    if (sourceFile) {
      const rest = readJson(sourceFile).filter((p) => p.id !== prompt.id);
      writeJson(sourceFile, rest);
    }
    const target = fs.existsSync(targetFile) ? readJson(targetFile) : [];
    const idx = target.findIndex((p) => p.id === prompt.id);
    if (idx >= 0) target[idx] = prompt;
    else target.push(prompt);
    writeJson(targetFile, target);
  } catch (e) {
    rollback();
    throw e;
  }

  const { errors, warnings } = validateContent();
  if (errors.length) {
    rollback();
    throw new UserError(errors);
  }

  // Data is valid, so now move or write the image.
  if (oldSlug && oldSlug !== prompt.slug && !image) {
    const old = findImage(oldSlug);
    if (old) fs.renameSync(old.file, path.join(IMAGES_DIR, `${prompt.slug}.${old.ext}`));
  }
  if (image) {
    fs.mkdirSync(IMAGES_DIR, { recursive: true });
    removeImages(prompt.slug);
    if (oldSlug && oldSlug !== prompt.slug) removeImages(oldSlug);
    fs.writeFileSync(path.join(IMAGES_DIR, `${prompt.slug}.${image.ext}`), image.buf);
  }
  // A published prompt replaces its draft.
  fs.rmSync(path.join(DRAFTS_DIR, `${prompt.id}.json`), { force: true });
  return { prompt, warnings, hasImage: !!findImage(prompt.slug) };
}

function saveDraft(input) {
  const prompt = { ...normalise(input, null), id: str(input.id) || nextId() };
  if (!prompt.title && !prompt.slug && !prompt.promptText) throw new UserError(['Add at least a title or a prompt before saving a draft.']);
  if (input.imageData) decodeDataUrl(input.imageData); // reject bad files early
  writeJson(path.join(DRAFTS_DIR, `${prompt.id}.json`), { ...prompt, imageData: input.imageData || undefined });
  return { prompt };
}

function deletePrompt(id, kind) {
  if (!/^pp-\d+$/.test(id)) throw new UserError(['Invalid id.'], 400);
  if (kind === 'draft') {
    fs.rmSync(path.join(DRAFTS_DIR, `${id}.json`), { force: true });
    return { ok: true };
  }
  const p = readAllPrompts().find((x) => x.id === id);
  if (!p) throw new UserError(['Prompt not found.'], 404);
  const file = path.join(PROMPTS_DIR, p._file);
  backup(file);
  const before = fs.readFileSync(file, 'utf8');
  writeJson(file, readJson(file).filter((x) => x.id !== id));
  const { errors } = validateContent();
  if (errors.length) {
    fs.writeFileSync(file, before);
    throw new UserError(errors);
  }
  removeImages(p.slug);
  return { ok: true };
}


/**
 * Adds many NEW prompts at once. The whole batch is validated together and rolled back if anything
 * is wrong, so the site data never ends up half-updated.
 */
function publishBatch(items) {
  if (!Array.isArray(items) || !items.length) throw new UserError(['Nothing to publish.']);
  if (items.length > 20) throw new UserError(['Send at most 20 prompts per request.']);
  const prepared = items.map((it, n) => {
    if (!it.imageData) throw new UserError([`Row ${n + 1} (${it.title || 'untitled'}): add an image.`]);
    const prompt = normalise({ ...it, id: undefined }, null);
    return { prompt, image: decodeDataUrl(it.imageData), n };
  });
  // Ids must be unique inside the batch.
  const all = [...readAllPrompts(), ...readDrafts()];
  let max = Math.max(0, ...all.map((p) => Number(/^pp-(\d+)$/.exec(p.id || '')?.[1] || 0)));
  for (const x of prepared) x.prompt.id = `pp-${String(++max).padStart(3, '0')}`;

  const files = new Set(prepared.map((x) => path.join(PROMPTS_DIR, `${x.prompt.category}.json`)));
  const snapshots = new Map([...files].map((f) => [f, fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null]));
  const rollback = () => { for (const [f, c] of snapshots) c === null ? fs.rmSync(f, { force: true }) : fs.writeFileSync(f, c); };
  try {
    for (const f of files) backup(f);
    for (const x of prepared) {
      const f = path.join(PROMPTS_DIR, `${x.prompt.category}.json`);
      const list = fs.existsSync(f) ? readJson(f) : [];
      list.push(x.prompt);
      writeJson(f, list);
    }
  } catch (e) { rollback(); throw e; }
  const { errors, warnings } = validateContent();
  if (errors.length) {
    rollback();
    throw new UserError(errors);
  }
  fs.mkdirSync(IMAGES_DIR, { recursive: true });
  for (const x of prepared) {
    removeImages(x.prompt.slug);
    fs.writeFileSync(path.join(IMAGES_DIR, `${x.prompt.slug}.${x.image.ext}`), x.image.buf);
  }
  return { added: prepared.map((x) => ({ id: x.prompt.id, slug: x.prompt.slug, title: x.prompt.title })), warnings };
}

// ---- guides (content/guides/*.md)
const GUIDES_DIR = path.join(ROOT, 'content/guides');

function readGuides() {
  if (!fs.existsSync(GUIDES_DIR)) return [];
  return fs.readdirSync(GUIDES_DIR).filter((f) => f.endsWith('.md')).sort().map((f) => parseGuideFile(f.replace(/\.md$/, ''), fs.readFileSync(path.join(GUIDES_DIR, f), 'utf8')));
}

function saveGuide(input) {
  const slug = str(input.slug);
  if (!SLUG.test(slug)) throw new UserError(['The URL slug must be lowercase words with hyphens.']);
  const originalSlug = str(input.originalSlug);
  const file = path.join(GUIDES_DIR, `${slug}.md`);
  if (fs.existsSync(file) && originalSlug !== slug) throw new UserError([`A guide with the slug "${slug}" already exists.`]);
  const existing = originalSlug ? readGuides().find((g) => g.slug === originalSlug) : null;
  const text = serializeGuide(input, existing);
  const oldFile = originalSlug ? path.join(GUIDES_DIR, `${originalSlug}.md`) : null;
  const before = new Map([[file, fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null], ...(oldFile && oldFile !== file ? [[oldFile, fs.existsSync(oldFile) ? fs.readFileSync(oldFile, 'utf8') : null]] : [])]);
  const rollback = () => { for (const [f, c] of before) c === null ? fs.rmSync(f, { force: true }) : fs.writeFileSync(f, c); };
  fs.mkdirSync(GUIDES_DIR, { recursive: true });
  for (const f of before.keys()) backup(f);
  fs.writeFileSync(file, text);
  if (oldFile && oldFile !== file) fs.rmSync(oldFile, { force: true });
  try {
    const data = loadData(loadConfig());
    const { warnings } = loadGuides(data);
    return { slug, warnings: warnings.filter((w) => w.includes(`"${slug}"`)) };
  } catch (e) {
    rollback();
    const lines = String(e.message).split('\n').map((l) => l.replace(/^\s*-\s*/, '').trim()).filter((l) => l && !/^Content validation failed/.test(l));
    throw new UserError(lines.length ? lines : [e.message]);
  }
}

function deleteGuide(slug) {
  if (!SLUG.test(slug)) throw new UserError(['Invalid slug.'], 400);
  const file = path.join(GUIDES_DIR, `${slug}.md`);
  backup(file);
  fs.rmSync(file, { force: true });
  return { ok: true };
}

let running = false;
function runNode(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: ROOT, env: process.env });
    let out = '';
    const timer = setTimeout(() => child.kill(), 120000);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, out: out.replace(/\x1b\[[0-9;]*m/g, '') });
    });
  });
}
async function buildSite() {
  if (running) throw new UserError(['A build is already running.'], 409);
  running = true;
  try {
    const build = await runNode(['scripts/build.mjs']);
    if (build.code !== 0) return { ok: false, step: 'build', log: build.out };
    const verify = await runNode(['scripts/verify.mjs']);
    return { ok: verify.code === 0, step: verify.code === 0 ? 'done' : 'verify', log: build.out + '\n' + verify.out };
  } finally {
    running = false;
  }
}

function meta() {
  const data = loadData(loadConfig());
  return {
    brand: loadConfig().brand?.name || 'Promptrin',
    taxonomy: data.taxonomy,
    categories: data.categories.map((c) => ({ slug: c.slug, name: c.name })),
    customizeKeys: CUSTOMIZE_KEYS,
    customizeLabels: CUSTOMIZE_LABELS,
    passwordProtected: !!PASSWORD,
  };
}

function library() {
  const published = readAllPrompts().map((p) => {
    const img = findImage(p.slug);
    const { _file, ...rest } = p;
    return { ...rest, _file, hasImage: !!img, imageVersion: img ? Math.round(fs.statSync(img.file).mtimeMs) : 0 };
  });
  const drafts = readDrafts().map((d) => ({ ...d, hasImage: !!d.imageData, imageData: d.imageData }));
  return { published, drafts };
}

// ---------------------------------------------------------------- server

const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', avif: 'image/avif' };
const INDEX = () => fs.readFileSync(path.join(ROOT, 'admin/panel.html'));

function send(res, status, body, type = 'application/json; charset=utf-8', extra = {}) {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    ...extra,
  });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new UserError(['That upload is too large.'], 413));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(new UserError(['Invalid JSON.'], 400));
      }
    });
    req.on('error', reject);
  });
}

function authorised(req) {
  if (!PASSWORD) return true;
  const m = /^Basic (.+)$/.exec(req.headers.authorization || '');
  if (!m) return false;
  const [, pass = ''] = Buffer.from(m[1], 'base64').toString().split(/:(.*)/s);
  const a = crypto.createHash('sha256').update(pass).digest();
  const b = crypto.createHash('sha256').update(PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}

const server = http.createServer(async (req, res) => {
  try {
    const hostOk = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
    if (!hostOk.has(req.headers.host)) return send(res, 403, { errors: ['Unexpected host.'] });
    if (!authorised(req)) return send(res, 401, 'Password required', 'text/plain', { 'WWW-Authenticate': 'Basic realm="Promptrin admin", charset="UTF-8"' });

    const url = new URL(req.url, `http://${req.headers.host}`);
    const route = url.pathname;
    const mutating = req.method !== 'GET' && req.method !== 'HEAD';
    if (mutating) {
      const origin = req.headers.origin;
      if (origin && !hostOk.has(new URL(origin).host)) return send(res, 403, { errors: ['Cross-origin request blocked.'] });
      if (req.headers['x-admin-request'] !== '1') return send(res, 403, { errors: ['Missing admin header.'] });
    }

    if (req.method === 'GET' && (route === '/' || route === '/index.html')) {
      return send(res, 200, INDEX(), 'text/html; charset=utf-8', {
        'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      });
    }
    if (req.method === 'GET' && route === '/api/meta') return send(res, 200, meta());
    if (req.method === 'GET' && route === '/api/library') return send(res, 200, library());
    if (req.method === 'GET' && route.startsWith('/api/image/')) {
      const img = findImage(decodeURIComponent(route.slice('/api/image/'.length)));
      if (!img) return send(res, 404, 'No image', 'text/plain');
      return send(res, 200, fs.readFileSync(img.file), MIME[img.ext], { 'Cache-Control': 'no-cache' });
    }
    if (req.method === 'POST' && route === '/api/prompts') {
      const body = await readBody(req);
      return send(res, 200, body.asDraft ? saveDraft(body) : savePublished(body));
    }
    if (req.method === 'DELETE' && route.startsWith('/api/prompts/')) {
      return send(res, 200, deletePrompt(decodeURIComponent(route.slice('/api/prompts/'.length)), url.searchParams.get('kind')));
    }
    if (req.method === 'POST' && route === '/api/bulk') {
      const body = await readBody(req);
      return send(res, 200, body.asDraft ? { drafts: body.items.map((it) => saveDraft(it).prompt.id) } : publishBatch(body.items));
    }
    if (req.method === 'GET' && route === '/api/guides') return send(res, 200, { guides: readGuides() });
    if (req.method === 'POST' && route === '/api/guides') return send(res, 200, saveGuide(await readBody(req)));
    if (req.method === 'DELETE' && route.startsWith('/api/guides/')) return send(res, 200, deleteGuide(decodeURIComponent(route.slice('/api/guides/'.length))));
    if (req.method === 'POST' && route === '/api/preview-md') {
      const b = await readBody(req);
      const r = renderMarkdown(String(b.body || ''));
      return send(res, 200, { words: r.words, headings: r.headings.length, promptSlugs: r.promptSlugs });
    }
    if (req.method === 'POST' && route === '/api/build') return send(res, 200, await buildSite());
    return send(res, 404, { errors: ['Not found'] });
  } catch (e) {
    if (e instanceof UserError) return send(res, e.status, { errors: e.errors });
    console.error(e);
    return send(res, 500, { errors: ['Unexpected server error. See the terminal for details.'] });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`\nPromptrin admin: http://${HOST}:${PORT}${PASSWORD ? '  (password protected)' : '  (no password; local use only)'}`);
  console.log('Writes to data/prompts/ and images/originals/. Press Ctrl+C to stop.\n');
});
