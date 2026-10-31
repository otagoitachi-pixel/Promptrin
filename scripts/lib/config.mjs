// Loads site.config.json and merges environment overrides.
// Nothing secret lives in the repo: ad IDs, contact details and the production URL
// all come from environment variables (or a local .env file that is git-ignored).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const DIST = path.join(ROOT, 'dist');

/** Minimal .env reader (KEY=VALUE per line). Real environment variables win. */
function loadDotEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!(key in process.env)) process.env[key] = value;
  }
}

const isHttpUrl = (v) => {
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
};

export function loadConfig({ strict = false } = {}) {
  loadDotEnv();
  const env = process.env;
  const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'site.config.json'), 'utf8'));
  const warnings = [];

  // ---- Site URL (needed for canonicals, sitemap and Open Graph) ----
  let siteUrl = (env.SITE_URL || base.siteUrl || '').trim().replace(/\/+$/, '');
  let siteUrlIsPlaceholder = false;
  // Cloudflare Pages sets CF_PAGES_URL during its own builds. If SITE_URL was forgotten, use it so the
  // build still succeeds, and warn loudly because it is a deployment address, not your final domain.
  if (!siteUrl && env.CF_PAGES === '1' && /^https:\/\/[^\s/]+$/.test(env.CF_PAGES_URL || '')) {
    siteUrl = env.CF_PAGES_URL.trim();
    warnings.push(`SITE_URL is not set, so Cloudflare's address ${siteUrl} is used for canonical URLs and the sitemap. Add SITE_URL (your real domain) in Pages, Settings, Variables, then redeploy.`);
  }
  if (!siteUrl) {
    if (strict) throw new Error('SITE_URL is required for a strict (production) build, e.g. SITE_URL=https://www.yourdomain.com');
    siteUrl = 'https://promptrin.example'; // reserved ".example" TLD: obviously not a real site
    siteUrlIsPlaceholder = true;
    warnings.push('SITE_URL is not set. Canonical URLs and the sitemap use the placeholder https://promptrin.example. Set SITE_URL before deploying.');
  } else if (!isHttpUrl(siteUrl)) {
    throw new Error(`SITE_URL is not a valid URL: ${siteUrl}`);
  }

  // ---- Brand ----
  const brand = { ...base.brand };
  if (env.BRAND_NAME) brand.name = env.BRAND_NAME.trim();

  // ---- Contact ----
  const email = (env.CONTACT_EMAIL || '').trim();
  const contact = { email: '', formAction: '' };
  if (email) {
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) contact.email = email;
    else warnings.push('CONTACT_EMAIL is not a valid address and was ignored.');
  }
  const formAction = (env.CONTACT_FORM_ACTION || '').trim();
  if (formAction) {
    if (/^https:\/\//.test(formAction) && isHttpUrl(formAction)) contact.formAction = formAction;
    else warnings.push('CONTACT_FORM_ACTION must be an https URL and was ignored.');
  }
  if (!contact.email && !contact.formAction) {
    warnings.push('No CONTACT_EMAIL or CONTACT_FORM_ACTION set: the Contact page will say contact details are not configured yet.');
  }

  // ---- Social links (only real, configured URLs are ever rendered) ----
  const social = [];
  for (const [key, label] of [
    ['SOCIAL_INSTAGRAM', 'Instagram'],
    ['SOCIAL_PINTEREST', 'Pinterest'],
    ['SOCIAL_YOUTUBE', 'YouTube'],
    ['SOCIAL_X', 'X'],
    ['SOCIAL_FACEBOOK', 'Facebook'],
  ]) {
    const v = (env[key] || '').trim();
    if (!v) continue;
    if (/^https:\/\//.test(v) && isHttpUrl(v)) social.push({ label, url: v });
    else warnings.push(`${key} must be an https URL and was ignored.`);
  }

  // ---- AdSense (disabled unless a syntactically valid ID is supplied) ----
  const ads = { enabled: false, clientId: '', slots: { home: '', category: '', prompt: '' } };
  const clientId = (env.ADSENSE_CLIENT_ID || '').trim();
  if (clientId) {
    if (/^ca-pub-\d{10,20}$/.test(clientId) && env.ADS_ENABLED !== 'false') {
      ads.enabled = true;
      ads.clientId = clientId;
      for (const [k, v] of [['home', env.ADSENSE_SLOT_HOME], ['category', env.ADSENSE_SLOT_CATEGORY], ['prompt', env.ADSENSE_SLOT_PROMPT]]) {
        const slot = (v || '').trim();
        if (slot && /^\d{6,20}$/.test(slot)) ads.slots[k] = slot;
        else if (slot) warnings.push(`ADSENSE_SLOT_${k.toUpperCase()} is not a valid slot ID and was ignored.`);
      }
    } else if (env.ADS_ENABLED !== 'false') {
      warnings.push('ADSENSE_CLIENT_ID does not look like ca-pub-XXXXXXXXXXXXXXXX. Ads stay disabled.');
    }
  }

  return {
    ...base,
    brand,
    siteUrl,
    siteUrlIsPlaceholder,
    contact,
    social,
    ads,
    authorName: (env.AUTHOR_NAME || '').trim(),
    warnings,
  };
}
