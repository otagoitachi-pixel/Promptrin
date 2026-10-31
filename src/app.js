// Promptrin browser script. Everything here is progressive enhancement:
// pages are fully rendered HTML, and each feature degrades gracefully without JavaScript.
// The build inlines search-core.js above this file and wraps both in an IIFE.

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable: ignore */ } },
};

function announce(msg) {
  const live = $('#live');
  if (!live) return;
  live.textContent = '';
  setTimeout(() => { live.textContent = msg; }, 30);
}

// ---------------------------------------------------------------- theme
function initTheme() {
  const btn = $('[data-theme-toggle]');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const root = document.documentElement;
    const current = root.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = current === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    store.set('pp-theme', next);
  });
}

// ---------------------------------------------------------------- navigation
function initNav() {
  const toggle = $('[data-nav-toggle]');
  const nav = $('[data-nav]');
  if (toggle && nav) {
    const setOpen = (open) => {
      nav.classList.toggle('is-open', open);
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    };
    toggle.addEventListener('click', () => setOpen(toggle.getAttribute('aria-expanded') !== 'true'));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') { setOpen(false); toggle.focus(); }
    });
    matchMedia('(min-width: 900px)').addEventListener('change', (m) => { if (m.matches) setOpen(false); });
  }
  const menu = $('.has-menu');
  const menuBtn = $('[data-menu-toggle]');
  if (menu && menuBtn) {
    const setMenu = (open) => {
      menu.classList.toggle('is-open', open);
      menuBtn.setAttribute('aria-expanded', String(open));
    };
    menuBtn.addEventListener('click', () => setMenu(!menu.classList.contains('is-open')));
    document.addEventListener('click', (e) => { if (!menu.contains(e.target)) setMenu(false); });
    menu.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && menu.classList.contains('is-open')) { setMenu(false); menuBtn.focus(); }
    });
  }
}

// ---------------------------------------------------------------- copy & share
async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through to legacy path */ }
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.setAttribute('aria-hidden', 'true');
  Object.assign(ta.style, { position: 'fixed', top: '0', left: '0', opacity: '0', pointerEvents: 'none' });
  document.body.appendChild(ta);
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

function flash(btn, labelSel, text, cls) {
  const label = $(labelSel, btn);
  if (!label) return;
  if (!label.dataset.orig) label.dataset.orig = label.textContent;
  label.textContent = text;
  btn.classList.add(cls);
  clearTimeout(btn._t);
  btn._t = setTimeout(() => {
    label.textContent = label.dataset.orig;
    btn.classList.remove(cls, 'is-error');
  }, 2200);
}

function selectNode(node) {
  const sel = getSelection();
  const range = document.createRange();
  range.selectNodeContents(node);
  sel.removeAllRanges();
  sel.addRange(range);
}

function initCopyAndShare() {
  document.addEventListener('click', async (e) => {
    const copyBtn = e.target.closest('[data-copy]');
    if (copyBtn) {
      const targetSel = copyBtn.dataset.copyTarget;
      const target = targetSel ? $(targetSel) : null;
      const text = target ? target.textContent : copyBtn.dataset.prompt;
      if (!text) return;
      const ok = await copyText(text);
      if (ok) {
        flash(copyBtn, '[data-copy-label]', 'Copied!', 'is-copied');
        announce('Prompt copied to clipboard');
      } else {
        if (target) selectNode(target);
        flash(copyBtn, '[data-copy-label]', 'Copy failed', 'is-error');
        announce(target ? 'Copy failed. The prompt is selected: press Control or Command plus C to copy.' : 'Copy failed. Open the prompt page to copy it manually.');
      }
      return;
    }
    const shareBtn = e.target.closest('[data-share]');
    if (shareBtn) {
      const url = location.origin + location.pathname;
      if (navigator.share) {
        try { await navigator.share({ title: shareBtn.dataset.title, url }); return; } catch (err) { if (err && err.name === 'AbortError') return; }
      }
      const ok = await copyText(url);
      flash(shareBtn, '[data-share-label]', ok ? 'Link copied!' : 'Copy failed', ok ? 'is-copied' : 'is-error');
      announce(ok ? 'Page link copied to clipboard' : 'Could not copy the link');
    }
  });
}

// ---------------------------------------------------------------- search & filters
const INDEX_URL = '/search-index.json';
let indexPromise;
function loadIndex() {
  indexPromise ??= fetch(INDEX_URL, { credentials: 'omit' })
    .then((r) => { if (!r.ok) throw new Error('index ' + r.status); return r.json(); })
    .then((j) => j.prompts)
    .catch((err) => { indexPromise = null; throw err; });
  return indexPromise;
}

function initFilters() {
  const form = $('[data-filters]');
  const results = $('[data-results]');
  if (!form || !results) return;

  const status = $('[data-status]');
  const pager = $('[data-pagination]');
  const empty = $('[data-empty]');
  const loading = $('[data-loading]');
  const errorBox = $('[data-error]');
  const clearBtn = $('[data-clear]', form);
  const resetBtn = $('[data-reset]', form);
  const isSearchPage = results.dataset.mode === 'search';
  const fixedCategory = form.dataset.fixedCategory || '';
  const ctl = {};
  $$('[data-filter]', form).forEach((el) => { ctl[el.dataset.filter] = el; });
  const initialHtml = results.innerHTML;

  const read = () => ({
    q: (ctl.q?.value || '').trim(),
    category: fixedCategory || ctl.category?.value || '',
    style: ctl.style?.value || '',
    use: ctl.use?.value || '',
    tool: ctl.tool?.value || '',
    sort: ctl.sort?.value || '',
  });
  const isActive = (s) => !!(s.q || s.style || s.use || s.tool || s.sort || (!fixedCategory && s.category));

  // Hydrate controls from the URL (?q=...&style=...).
  const params = new URLSearchParams(location.search);
  for (const [k, el] of Object.entries(ctl)) {
    const v = params.get(k);
    if (v && el && (el.tagName !== 'SELECT' || Array.from(el.options).some((o) => o.value === v))) el.value = v;
  }

  const syncUrl = (s) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(s)) if (v && !(k === 'category' && fixedCategory)) p.set(k, v);
    const qs = p.toString();
    history.replaceState(null, '', location.pathname + (qs ? '?' + qs : ''));
  };

  const setHidden = (el, hide) => { if (el) el.hidden = hide; };
  let seq = 0;

  async function render() {
    const s = read();
    const mySeq = ++seq;
    setHidden(clearBtn, !s.q);
    setHidden(resetBtn, !isActive(s));
    syncUrl(s);
    setHidden(errorBox, true);

    if (!isSearchPage && !isActive(s)) {
      results.innerHTML = initialHtml;
      setHidden(pager, false);
      setHidden(empty, true);
      if (status) status.textContent = '';
      return;
    }

    let entries;
    try {
      if (!indexPromise) setHidden(loading, false); // first load only: show the loading state
      entries = await loadIndex();
    } catch {
      if (mySeq !== seq) return;
      setHidden(loading, true);
      results.innerHTML = '';
      setHidden(errorBox, false);
      if (status) status.textContent = '';
      return;
    }
    if (mySeq !== seq) return; // a newer keystroke superseded this render
    setHidden(loading, true);

    const list = filterEntries(entries, s);
    results.innerHTML = list.map((e) => e.html).join('\n');
    setHidden(pager, true);
    setHidden(empty, list.length > 0);
    const noun = list.length === 1 ? 'prompt' : 'prompts';
    const msg = list.length === 0
      ? 'No prompts match your search.'
      : s.q ? `${list.length} ${noun} for “${s.q}”` : `${list.length} ${noun}`;
    if (status) status.textContent = msg;
  }

  let timer;
  ctl.q?.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(render, 140); });
  $$('select', form).forEach((el) => el.addEventListener('change', render));
  form.addEventListener('submit', (e) => { e.preventDefault(); clearTimeout(timer); render(); });
  clearBtn?.addEventListener('click', () => { ctl.q.value = ''; ctl.q.focus(); render(); });
  resetBtn?.addEventListener('click', () => {
    for (const el of Object.values(ctl)) { if (el === ctl.category && fixedCategory) continue; el.value = ''; }
    render();
  });
  $('[data-retry]')?.addEventListener('click', (e) => { e.preventDefault(); render(); });

  if (isSearchPage || isActive(read())) render();
  else setHidden(clearBtn, true);
}

// ---------------------------------------------------------------- images that fail to load
function initImageFallback() {
  const mark = (img) => img.setAttribute('data-failed', '');
  document.addEventListener('error', (e) => {
    const t = e.target;
    if (t && t.tagName === 'IMG' && t.hasAttribute('data-fallback')) mark(t);
  }, true);
  $$('img[data-fallback]').forEach((img) => { if (img.complete && img.naturalWidth === 0 && img.getAttribute('src')) mark(img); });
}

// ---------------------------------------------------------------- advertising consent (only present when ads are configured)
function initConsent() {
  const banner = $('[data-consent]');
  if (!banner) return;
  const clientId = document.body.dataset.adsClient;
  let loaded = false;
  const loadAds = () => {
    if (loaded || !clientId) return;
    loaded = true;
    document.documentElement.classList.add('ads-on');
    const s = document.createElement('script');
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + encodeURIComponent(clientId);
    s.addEventListener('load', () => {
      $$('ins.adsbygoogle').forEach(() => { try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch { /* ad blocked or already filled */ } });
    });
    document.head.appendChild(s);
  };
  const choice = store.get('pp-consent');
  if (choice === 'granted') loadAds();
  else if (choice !== 'denied') banner.hidden = false;
  $('[data-consent-accept]')?.addEventListener('click', () => { store.set('pp-consent', 'granted'); banner.hidden = true; loadAds(); });
  $('[data-consent-decline]')?.addEventListener('click', () => { store.set('pp-consent', 'denied'); banner.hidden = true; });
  $('[data-consent-open]')?.addEventListener('click', () => { banner.hidden = false; $('[data-consent-accept]')?.focus(); });
}

// ---------------------------------------------------------------- contact form (client-side checks only; the form provider validates too)
function initContactForm() {
  const form = $('[data-contact-form]');
  if (!form) return;
  const status = $('[data-form-status]', form);
  form.addEventListener('submit', (e) => {
    const trap = form.elements.website;
    if (trap && trap.value) { e.preventDefault(); return; } // honeypot filled: silently drop
    if (!form.checkValidity()) {
      e.preventDefault();
      if (status) { status.hidden = false; status.textContent = 'Please complete every field with a valid email address and a message of at least 10 characters.'; }
      form.reportValidity();
    }
  });
}

initTheme();
initNav();
initCopyAndShare();
initFilters();
initImageFallback();
initConsent();
initContactForm();
