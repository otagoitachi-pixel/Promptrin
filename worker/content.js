// The online admin's content operations. Each operation takes the repository's current content,
// returns the file changes to commit, and refuses (with readable errors) anything the site build would reject.
import {
  SLUG, IMAGE_EXTS, UserError, today, nextIdFrom, normalisePrompt, validateContent, validateGuideFiles,
  parseGuideFile, serializeGuide, sniffImage, ID_RE,
} from '../scripts/lib/shared.mjs';

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const PROMPT_FILE = /^data\/prompts\/([^/]+\.json)$/;
const IMAGE_FILE = /^images\/originals\/([a-z0-9]+(?:-[a-z0-9]+)*)\.(avif|webp|jpg|jpeg|png)$/;
const GUIDE_FILE = /^content\/guides\/([^/]+)\.md$/;
const jsonText = (v) => JSON.stringify(v, null, 2) + '\n';

/** Reads the prompt files, image list and guide list from the repository at its latest commit. */
export async function loadState(repo, { guides = false } = {}) {
  const head = await repo.head();
  const tree = await repo.tree(head.tree);
  const files = new Map();
  await Promise.all(
    tree.filter((e) => PROMPT_FILE.test(e.path)).map(async (e) => {
      const name = PROMPT_FILE.exec(e.path)[1];
      const data = JSON.parse(await repo.blobText(e.sha));
      if (!Array.isArray(data)) throw new UserError([`data/prompts/${name} must contain a JSON array`], 500);
      files.set(name, data);
    }),
  );
  const images = new Map();
  for (const e of tree) {
    const m = IMAGE_FILE.exec(e.path);
    if (m) images.set(m[1], [...(images.get(m[1]) || []), { path: e.path, ext: m[2], sha: e.sha }]);
  }
  const guideEntries = tree.filter((e) => GUIDE_FILE.test(e.path)).map((e) => ({ slug: GUIDE_FILE.exec(e.path)[1], path: e.path, sha: e.sha }));
  const state = { head, files, images, guideEntries, guideTexts: null };
  if (guides) await loadGuideTexts(repo, state);
  return state;
}

export async function loadGuideTexts(repo, state) {
  if (state.guideTexts) return state.guideTexts;
  if (state.guideEntries.length > 30) throw new UserError(['You have more than 30 guides. Manage guides from GitHub or the local admin.'], 413);
  const texts = await Promise.all(state.guideEntries.map(async (g) => ({ slug: g.slug, text: await repo.blobText(g.sha) })));
  state.guideTexts = new Map(texts.map((g) => [g.slug, g.text]));
  return state.guideTexts;
}

const flatten = (files) => [...files.entries()].sort(([a], [b]) => a.localeCompare(b)).flatMap(([name, list]) => list.map((p) => ({ ...p, _file: name })));
const cloneFiles = (files) => new Map([...files].map(([k, v]) => [k, v.map((p) => ({ ...p }))]));
const imageOf = (state, slug) => state.images.get(slug)?.[0] || null;

export function libraryOf(state) {
  const published = flatten(state.files).map((p) => {
    const img = imageOf(state, p.slug);
    return { ...p, hasImage: !!img, imageVersion: img ? `${img.sha}.${img.ext}` : '' };
  });
  return { published, drafts: [] };
}

function checkBlob(blob) {
  if (!blob || !/^[0-9a-f]{40}$/.test(blob.sha || '') || !['jpg', 'png', 'webp'].includes(blob.ext)) throw new UserError(['The image upload did not finish. Add the image again.']);
  return { sha: blob.sha, ext: blob.ext };
}

function checkAll(data, extra = []) {
  const v = validateContent(data);
  const errors = [...v.errors, ...extra];
  if (errors.length) throw new UserError(errors);
  return v;
}

/** After a change to prompts, every guide must still be valid (a missing prompt would break the build). */
function guideErrors(state, prompts, catBySlug) {
  if (!state.guideTexts) return [];
  const files = [...state.guideTexts].map(([slug, text]) => ({ slug, text }));
  return validateGuideFiles(files, { prompts, catBySlug }).errors.map((e) => `${e} (change the guide first)`);
}

function imageChanges(state, prompt, oldSlug, image) {
  const remove = new Map();
  const add = new Map();
  const dropAll = (slug) => (state.images.get(slug) || []).forEach((i) => remove.set(i.path, { path: i.path, remove: true }));
  if (image) {
    dropAll(prompt.slug);
    if (oldSlug && oldSlug !== prompt.slug) dropAll(oldSlug);
    add.set(`images/originals/${prompt.slug}.${image.ext}`, { path: `images/originals/${prompt.slug}.${image.ext}`, sha: image.sha });
  } else if (oldSlug && oldSlug !== prompt.slug && imageOf(state, oldSlug)) {
    const old = imageOf(state, oldSlug);
    dropAll(oldSlug);
    add.set(`images/originals/${prompt.slug}.${old.ext}`, { path: `images/originals/${prompt.slug}.${old.ext}`, sha: old.sha });
  }
  for (const k of add.keys()) remove.delete(k);
  return [...remove.values(), ...add.values()];
}

export function savePrompt(state, ctx, input, day = today()) {
  const all = flatten(state.files);
  const previous = input.id ? all.find((p) => p.id === input.id) : null;
  if (input.id && !previous) throw new UserError(['That prompt no longer exists. Reload the page.'], 404);
  const prompt = normalisePrompt(input, previous, { id: nextIdFrom(all), today: day });
  const image = input.imageBlob ? checkBlob(input.imageBlob) : null;
  const oldSlug = previous?.slug;
  const hasImage = image || imageOf(state, prompt.slug) || (oldSlug && imageOf(state, oldSlug));
  const imageErrors = hasImage ? [] : ['Add an image for this prompt before publishing.'];

  const files = cloneFiles(state.files);
  if (previous) files.set(previous._file, files.get(previous._file).filter((p) => p.id !== prompt.id));
  const target = `${prompt.category}.json`;
  files.set(target, [...(files.get(target) || []), prompt]);

  const v = checkAll({ ...ctx, prompts: flatten(files), today: day }, imageErrors);
  const gErr = oldSlug && oldSlug !== prompt.slug ? guideErrors(state, flatten(files), v.catBySlug) : [];
  if (gErr.length) throw new UserError(gErr);

  const touched = new Set([target, ...(previous ? [previous._file] : [])]);
  const changes = [...touched].map((name) => ({ path: `data/prompts/${name}`, content: jsonText(files.get(name)) }));
  changes.push(...imageChanges(state, prompt, oldSlug, image));
  return { changes, message: `${previous ? 'Update' : 'Add'} prompt: ${prompt.title}`, result: { prompt, warnings: v.warnings, hasImage: true } };
}

export function deletePrompt(state, ctx, id, day = today()) {
  if (!ID_RE.test(id || '')) throw new UserError(['Invalid id.'], 400);
  const all = flatten(state.files);
  const p = all.find((x) => x.id === id);
  if (!p) throw new UserError(['Prompt not found.'], 404);
  const files = cloneFiles(state.files);
  files.set(p._file, files.get(p._file).filter((x) => x.id !== id));
  const v = checkAll({ ...ctx, prompts: flatten(files), today: day });
  const gErr = guideErrors(state, flatten(files), v.catBySlug);
  if (gErr.length) throw new UserError(gErr);
  const changes = [{ path: `data/prompts/${p._file}`, content: jsonText(files.get(p._file)) }];
  for (const i of state.images.get(p.slug) || []) changes.push({ path: i.path, remove: true });
  return { changes, message: `Delete prompt: ${p.title}`, result: { ok: true } };
}

export function bulkPublish(state, ctx, items, day = today()) {
  if (!Array.isArray(items) || !items.length) throw new UserError(['Nothing to publish.']);
  if (items.length > 100) throw new UserError(['Send at most 100 prompts per request.']);
  const files = cloneFiles(state.files);
  const all = flatten(files);
  let max = Math.max(0, ...all.map((p) => Number(ID_RE.exec(p.id || '')?.[1] || 0)));
  const added = [];
  const changes = [];
  const touched = new Set();
  const errors = [];
  items.forEach((it, n) => {
    if (!it.imageBlob) { errors.push(`Row ${n + 1} (${it.title || 'untitled'}): add an image.`); return; }
    const image = checkBlob(it.imageBlob);
    const prompt = normalisePrompt({ ...it, id: undefined }, null, { id: `pp-${String(++max).padStart(3, '0')}`, today: day });
    const name = `${prompt.category}.json`;
    files.set(name, [...(files.get(name) || []), prompt]);
    touched.add(name);
    added.push({ id: prompt.id, slug: prompt.slug, title: prompt.title });
    changes.push(...imageChanges(state, prompt, null, image));
  });
  if (errors.length) throw new UserError(errors);
  const v = checkAll({ ...ctx, prompts: flatten(files), today: day });
  for (const name of touched) changes.unshift({ path: `data/prompts/${name}`, content: jsonText(files.get(name)) });
  return { changes, message: `Add ${added.length} prompt${added.length === 1 ? '' : 's'}`, result: { added, warnings: v.warnings } };
}

// ---------------------------------------------------------------- guides

export function listGuides(state) {
  return [...state.guideTexts].map(([slug, text]) => parseGuideFile(slug, text));
}

export function saveGuide(state, ctx, input, day = today()) {
  const slug = String(input.slug || '').trim();
  if (!SLUG.test(slug)) throw new UserError(['The URL slug must be lowercase words with hyphens.']);
  const originalSlug = String(input.originalSlug || '').trim();
  if (state.guideTexts.has(slug) && originalSlug !== slug) throw new UserError([`A guide with the slug "${slug}" already exists.`]);
  const existing = originalSlug && state.guideTexts.has(originalSlug) ? parseGuideFile(originalSlug, state.guideTexts.get(originalSlug)) : null;
  const text = serializeGuide(input, existing, day);
  const texts = new Map(state.guideTexts);
  if (originalSlug && originalSlug !== slug) texts.delete(originalSlug);
  texts.set(slug, text);
  const prompts = flatten(state.files);
  const { catBySlug } = validateContent({ ...ctx, prompts, today: day });
  const r = validateGuideFiles([...texts].map(([s, t]) => ({ slug: s, text: t })), { prompts, catBySlug });
  if (r.errors.length) throw new UserError(r.errors.map((e) => e.replace(/^guide "[^"]*": /, (m) => m)));
  const changes = [{ path: `content/guides/${slug}.md`, content: text }];
  if (originalSlug && originalSlug !== slug && state.guideTexts.has(originalSlug)) changes.push({ path: `content/guides/${originalSlug}.md`, remove: true });
  return { changes, message: `${input.draft ? 'Save draft guide' : 'Publish guide'}: ${String(input.title || slug).slice(0, 80)}`, result: { slug, warnings: r.warnings.filter((w) => w.includes(`"${slug}"`)) } };
}

export function deleteGuide(state, slug) {
  if (!SLUG.test(slug || '')) throw new UserError(['Invalid slug.'], 400);
  if (!state.guideTexts.has(slug)) throw new UserError(['Guide not found.'], 404);
  return { changes: [{ path: `content/guides/${slug}.md`, remove: true }], message: `Delete guide: ${slug}`, result: { ok: true } };
}

/** Checks the first bytes of a base64 image without decoding all of it (keeps CPU use tiny). */
export function inspectDataUrl(dataUrl) {
  const m = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl || '');
  if (!m) throw new UserError(['The image must be a JPG, PNG or WebP file.']);
  const b64 = m[1];
  const bytes = Math.floor((b64.length * 3) / 4) - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);
  if (bytes > MAX_IMAGE_BYTES) throw new UserError([`The image is ${(bytes / 1048576).toFixed(1)} MB. The limit is ${MAX_IMAGE_BYTES / 1048576} MB.`]);
  const head = Uint8Array.from(atob(b64.slice(0, 32)), (c) => c.charCodeAt(0));
  const ext = sniffImage(head);
  if (!ext) throw new UserError(['That file is not a valid JPG, PNG or WebP image.']);
  return { b64, ext };
}

export { IMAGE_EXTS };
