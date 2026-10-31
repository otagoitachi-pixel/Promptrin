// Small shared helpers: escaping, text trimming, dates, hashing, file output.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escape text for HTML text nodes and attribute values. All dynamic content goes through this. */
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

/** Safe JSON for embedding inside <script type="application/ld+json">. */
export const jsonForScript = (obj) =>
  JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');

/** Trim to a maximum length at a word boundary, adding an ellipsis when cut. */
export function trimText(text, max) {
  const t = String(text).replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.\-–—]+$/, '') + '…';
}

/** First sentence (or trimmed text) for compact card blurbs. */
export function blurb(text, max = 120) {
  const first = String(text).split(/(?<=[.!?])\s+/)[0];
  return trimText(first.length >= 40 ? first : text, max);
}

export const formatDate = (iso) =>
  new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

export const sha256 = (s, enc = 'hex') => crypto.createHash('sha256').update(s).digest(enc);

export function writeFile(root, relPath, content) {
  const target = path.join(root, relPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

export function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

export const pluralize = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

/** Pick the longest title that fits a character budget (search snippets truncate ~60 chars). */
export function fitTitle(options, max = 60) {
  for (const o of options) if (o.length <= max) return o;
  return options[options.length - 1];
}
