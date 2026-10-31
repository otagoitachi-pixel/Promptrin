// Image pipeline.
//
//   images/originals/<prompt-slug>.(jpg|jpeg|png|webp|avif)   <- put real, original images here
//
// With `sharp` installed (optionalDependency) each original becomes responsive WebP files plus a
// JPEG for social sharing. Without sharp the original is copied as-is (still works, just larger).
// Prompts with no original image get a clearly labelled DEMONSTRATION SVG so the site is complete
// and nobody mistakes placeholder art for a real output of the prompt.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.mjs';
import { esc, writeFile } from './util.mjs';

const WIDTHS = [480, 800, 1200];
const EXTS = ['avif', 'webp', 'jpg', 'jpeg', 'png'];

let sharpPromise;
function getSharp() {
  sharpPromise ??= import('sharp').then((m) => m.default).catch(() => null);
  return sharpPromise;
}

function ratioSize(ratio, baseWidth = 1200) {
  const [w, h] = ratio.split(':').map(Number);
  return { width: baseWidth, height: Math.round((baseWidth * h) / w) };
}

// Deterministic PRNG so demo art is stable between builds.
function rng(seedStr) {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

/** Abstract, deliberately non-photographic artwork in the category palette, labelled as a demo. */
function demoSvg(prompt, palette, brand) {
  const { width: W, height: H } = ratioSize(prompt.ratio);
  const r = rng(prompt.slug);
  const [c0, c1, c2] = palette;
  const shapes = [];
  const count = 4 + Math.floor(r() * 3);
  for (let i = 0; i < count; i++) {
    const cx = Math.round(r() * W);
    const cy = Math.round(H * (0.15 + r() * 0.6));
    const rad = Math.round(Math.min(W, H) * (0.18 + r() * 0.32));
    const fill = [c1, c2, c0][i % 3];
    shapes.push(`<circle cx="${cx}" cy="${cy}" r="${rad}" fill="${fill}" opacity="${(0.28 + r() * 0.32).toFixed(2)}"/>`);
  }
  const horizon = Math.round(H * (0.52 + r() * 0.18));
  const titleSize = Math.max(34, Math.round(W * 0.052));
  const label = esc(prompt.title);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Placeholder artwork for ${label}">
<defs><linearGradient id="g" x1="0" y1="0" x2="0.9" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c0}"/></linearGradient></defs>
<rect width="${W}" height="${H}" fill="url(#g)"/>
${shapes.join('\n')}
<rect y="${horizon}" width="${W}" height="${H - horizon}" fill="${c0}" opacity="0.38"/>
<line x1="0" y1="${horizon}" x2="${W}" y2="${horizon}" stroke="${c2}" stroke-width="3" opacity="0.7"/>
<rect x="36" y="36" width="${W - 72}" height="${H - 72}" fill="none" stroke="#fff" stroke-opacity="0.35" stroke-width="2"/>
<rect x="56" y="56" width="${Math.round(titleSize * 7.4)}" height="${Math.round(titleSize * 1.1)}" rx="6" fill="#111" opacity="0.68"/>
<text x="${56 + Math.round(titleSize * 0.4)}" y="${56 + Math.round(titleSize * 0.75)}" font-family="Helvetica, Arial, sans-serif" font-size="${Math.round(titleSize * 0.52)}" font-weight="700" letter-spacing="3" fill="#fff">DEMO ARTWORK</text>
</svg>
`;
}

function findOriginal(slug) {
  for (const ext of EXTS) {
    const f = path.join(ROOT, 'images/originals', `${slug}.${ext}`);
    if (fs.existsSync(f)) return { file: f, ext };
  }
  return null;
}

/**
 * Builds image assets into dist/images and returns a map slug -> image descriptor.
 * descriptor: { src, srcset, width, height, alt, demo, ogSrc }
 */
export async function buildImages(prompts, catBySlug, config, dist, log) {
  const out = new Map();
  const sharp = await getSharp();
  let warnedNoSharp = false;

  for (const p of prompts) {
    const found = findOriginal(p.slug);

    if (!found) {
      const svg = demoSvg(p, catBySlug.get(p.category).palette, config.brand.name);
      writeFile(dist, `images/${p.slug}.svg`, svg);
      const { width, height } = ratioSize(p.ratio);
      out.set(p.slug, {
        src: `/images/${p.slug}.svg`,
        srcset: '',
        width,
        height,
        alt: `Placeholder artwork for “${p.title}”`,
        demo: true,
        ogSrc: '',
      });
      continue;
    }

    if (sharp) {
      const meta = await sharp(found.file).metadata();
      const aspect = meta.height / meta.width;
      const sets = [];
      for (const w of WIDTHS) {
        if (w > meta.width && w !== WIDTHS[0]) continue; // never upscale
        const buf = await sharp(found.file).rotate().resize({ width: Math.min(w, meta.width) }).webp({ quality: 80 }).toBuffer();
        writeFile(dist, `images/${p.slug}-${w}.webp`, buf);
        sets.push(w);
      }
      const maxW = sets[sets.length - 1];
      const og = await sharp(found.file).rotate().resize({ width: 1200, height: 630, fit: 'cover' }).jpeg({ quality: 82 }).toBuffer();
      writeFile(dist, `images/${p.slug}-og.jpg`, og);
      out.set(p.slug, {
        src: `/images/${p.slug}-${maxW}.webp`,
        srcset: sets.map((w) => `/images/${p.slug}-${w}.webp ${w}w`).join(', '),
        width: maxW,
        height: Math.round(maxW * aspect),
        alt: p.imageAlt,
        demo: false,
        ogSrc: `/images/${p.slug}-og.jpg`,
      });
    } else {
      if (!warnedNoSharp) {
        log('warn', 'Original images found but `sharp` is not installed: copying them unoptimised. Run `npm install` to enable resizing and WebP.');
        warnedNoSharp = true;
      }
      const dest = `images/${p.slug}.${found.ext}`;
      writeFile(dist, dest, fs.readFileSync(found.file));
      const size = ratioSize(p.ratio);
      out.set(p.slug, { src: `/${dest}`, srcset: '', ...size, alt: p.imageAlt, demo: false, ogSrc: found.ext === 'webp' || found.ext === 'avif' ? '' : `/${dest}` });
    }
  }
  return out;
}
