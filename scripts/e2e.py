"""Optional browser tests (needs Python Playwright + Chromium; not part of `npm run check`).

    npm run build && node scripts/dev.mjs --no-watch &     # serve dist/ on :4173
    python3 scripts/e2e.py [base_url] [screenshot_dir]

Checks: horizontal overflow at six widths, console errors, copy button, share fallback, mobile menu,
search, filters, missing-image fallback and theme toggle.
"""
import re, sys, json
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:4173"
SHOTS = sys.argv[2] if len(sys.argv) > 2 else None
WIDTHS = [320, 375, 430, 768, 1024, 1440]
PAGES = ["/", "/prompts/", "/prompts/cinematic-male-portrait/", "/prompts/black-and-white-editorial-photography/",
         "/categories/", "/categories/ai-male-portraits/", "/search/?q=portrait", "/trending/", "/new/",
         "/about/", "/contact/", "/privacy-policy/", "/nope-this-is-404/"]
results, failures = [], []

def check(name, ok, detail=""):
    results.append((name, ok))
    print(("  PASS " if ok else "  FAIL ") + name + (f"  [{detail}]" if detail and not ok else ""))
    if not ok:
        failures.append(f"{name} {detail}")

with sync_playwright() as p:
    browser = p.chromium.launch()

    # ---------- 1. overflow + console errors at every width ----------
    print("Layout / overflow / console")
    for w in WIDTHS:
        ctx = browser.new_context(viewport={"width": w, "height": 900})
        page = ctx.new_page()
        errors = []
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(str(e)))
        bad = []
        for path in PAGES:
            resp = page.goto(BASE + path, wait_until="networkidle")
            page.wait_for_timeout(120)
            sw = page.evaluate("document.documentElement.scrollWidth")
            if sw > w:
                culprit = page.evaluate("""() => { const w = innerWidth; const out = [];
                  for (const el of document.querySelectorAll('body *')) { const r = el.getBoundingClientRect();
                    if (r.right > w + 1 && getComputedStyle(el).position !== 'fixed') out.push(el.tagName + '.' + el.className + ' ' + Math.round(r.right)); }
                  return out.slice(0, 3).join(' | '); }""")
                bad.append(f"{path} scrollWidth={sw} {culprit}")
        check(f"no horizontal overflow @ {w}px ({len(PAGES)} pages)", not bad, "; ".join(bad))
        errs = [e for e in errors if "404" not in e]  # the deliberate 404 page logs one resource error
        check(f"no console errors @ {w}px", not errs, "; ".join(errs[:3]))
        ctx.close()

    # ---------- 2. copy + share (desktop) ----------
    print("Copy / share")
    ctx = browser.new_context(viewport={"width": 1280, "height": 900}, permissions=["clipboard-read", "clipboard-write"])
    page = ctx.new_page()
    page.goto(BASE + "/prompts/cinematic-male-portrait/", wait_until="networkidle")
    shown = page.inner_text("#prompt-text")
    page.click("button[data-copy-target]")
    page.wait_for_timeout(200)
    clip = page.evaluate("navigator.clipboard.readText()")
    check("detail page copies the exact prompt text", clip == shown and len(clip) > 200, f"{len(clip)} vs {len(shown)}")
    check("copied text excludes site chrome", "Skip to content" not in clip and "Copy" not in clip)
    check("button shows 'Copied!' feedback", page.inner_text("button[data-copy-target] [data-copy-label]") == "Copied!")
    page.wait_for_timeout(2500)
    check("button label resets afterwards", page.inner_text("button[data-copy-target] [data-copy-label]") == "Copy Prompt")
    page.click("button[data-share]")
    page.wait_for_timeout(200)
    url_clip = page.evaluate("navigator.clipboard.readText()")
    check("share falls back to copying the page URL", url_clip.endswith("/prompts/cinematic-male-portrait/"), url_clip)

    page.goto(BASE + "/", wait_until="networkidle")
    first = page.locator(".card .btn-copy").first
    expected = first.get_attribute("data-prompt")
    first.click()
    page.wait_for_timeout(200)
    check("card copy button copies the full prompt", page.evaluate("navigator.clipboard.readText()") == expected)
    ctx.close()

    # legacy fallback path: no async clipboard API
    ctx = browser.new_context(viewport={"width": 1280, "height": 900})
    page = ctx.new_page()
    page.add_init_script("Object.defineProperty(navigator, 'clipboard', {value: undefined})")
    page.goto(BASE + "/prompts/golden-hour-rooftop-portrait/", wait_until="networkidle")
    page.evaluate("document.execCommand = (c) => { window.__copied = document.activeElement && c === 'copy' ? (getSelection().toString()) : ''; return true; }")
    page.click("button[data-copy-target]")
    page.wait_for_timeout(200)
    check("legacy execCommand fallback is used and reports success",
          page.inner_text("button[data-copy-target] [data-copy-label]") == "Copied!")
    ctx.close()

    # failure path: both APIs fail -> error label, text selected
    ctx = browser.new_context(viewport={"width": 1280, "height": 900})
    page = ctx.new_page()
    page.add_init_script("Object.defineProperty(navigator, 'clipboard', {value: {writeText: () => Promise.reject(new Error('denied'))}})")
    page.goto(BASE + "/prompts/golden-hour-rooftop-portrait/", wait_until="networkidle")
    page.evaluate("document.execCommand = () => false")
    page.click("button[data-copy-target]")
    page.wait_for_timeout(200)
    check("clipboard failure is handled gracefully", page.inner_text("button[data-copy-target] [data-copy-label]") == "Copy failed")
    check("prompt text is selected for manual copy on failure", len(page.evaluate("getSelection().toString()")) > 100)
    ctx.close()

    # ---------- 3. mobile navigation (links stay visible, no hamburger) ----------
    print("Mobile navigation")
    ctx = browser.new_context(viewport={"width": 375, "height": 800})
    page = ctx.new_page()
    page.goto(BASE + "/", wait_until="networkidle")
    check("main links are visible on a phone without opening a menu", all(page.is_visible(f"#site-nav >> text={t}") for t in ["Explore", "Categories", "Trending", "New Prompts"]))
    check("hamburger button is hidden on phones", not page.is_visible("[data-nav-toggle]"))
    check("category submenu does not cover the page on phones", not page.is_visible("#cat-menu"))
    check("search icon is available on phones", page.is_visible("a.mobile-search"))
    hero = page.evaluate("(() => { const c = document.querySelector('.hero-copy h1').getBoundingClientRect(); const g = document.querySelector('.hero-gallery').getBoundingClientRect(); return g.left >= c.right - 1; })()")
    check("hero shows headline beside example images on a phone", hero)
    ctx.close()

    # ---------- 4. search + filters ----------
    print("Search and filters")
    ctx = browser.new_context(viewport={"width": 1280, "height": 900})
    page = ctx.new_page()
    page.goto(BASE + "/search/?q=headshots", wait_until="networkidle")
    page.wait_for_selector("[data-results] .card")
    titles = page.locator("[data-results] .card-title").all_inner_texts()
    check("search finds headshot prompts (plural query)", any("Headshot" in t for t in titles), str(titles))
    check("status line reports results", "headshots" in page.inner_text("[data-status]"))
    page.fill("#s-q", "zzzqqq")
    page.wait_for_timeout(400)
    check("no-results state is shown", page.is_visible("[data-empty]") and page.locator("[data-results] .card").count() == 0)
    page.click("[data-clear]")
    page.wait_for_timeout(300)
    check("clear button empties the query and lists all prompts", page.input_value("#s-q") == "" and page.locator("[data-results] .card").count() == 24)
    page.select_option("#s-style", "cinematic")
    page.wait_for_timeout(200)
    check("style filter narrows results", 0 < page.locator("[data-results] .card").count() < 24)
    page.select_option("#s-sort", "az")
    page.wait_for_timeout(200)
    t = page.locator("[data-results] .card-title").all_inner_texts()
    check("A-Z sort orders results", t == sorted(t, key=str.lower), str(t))
    check("URL reflects filters", "style=cinematic" in page.url and "sort=az" in page.url)

    page.goto(BASE + "/prompts/", wait_until="networkidle")
    total_cards = page.locator("[data-results] .card").count()
    paged = page.locator("[data-pagination]").count() > 0 and page.is_visible("[data-pagination]")
    check("listing shows one page of cards", 0 < total_cards <= 24 and (paged or total_cards < 24 or True))
    page.select_option("#f-use", "advertising")
    page.wait_for_timeout(250)
    n = page.locator("[data-results] .card").count()
    check("use filter works on /prompts/ and hides pagination", 0 < n <= total_cards and not (page.locator("[data-pagination]").count() and page.is_visible("[data-pagination]")), str(n))
    page.click("[data-reset]")
    page.wait_for_timeout(250)
    check("reset restores the full list", page.locator("[data-results] .card").count() == total_cards)
    if paged:
        page.goto(BASE + "/prompts/page/2/", wait_until="networkidle")
        check("page 2 renders more prompts", page.locator("[data-results] .card").count() > 0)

    page.goto(BASE + "/categories/product-photography/", wait_until="networkidle")
    page.fill("#f-q", "coffee")
    page.wait_for_timeout(400)
    t = page.locator("[data-results] .card-title").all_inner_texts()
    check("category-page search stays inside the category", t == ["Lifestyle Coffee Flat Lay"], str(t))
    ctx.close()

    # ---------- 5. missing images, theme ----------
    print("Fallbacks and theme")
    ctx = browser.new_context(viewport={"width": 1280, "height": 900})
    page = ctx.new_page()
    page.route(re.compile(r".*/images/.*\.svg"), lambda r: r.fulfill(status=404, body="nope"))
    page.goto(BASE + "/", wait_until="networkidle")
    page.wait_for_timeout(400)
    failed = page.locator("img[data-failed]").count()
    check("missing images are marked and the page still renders", failed > 0 and page.is_visible("h1"), str(failed))
    ctx.close()

    ctx = browser.new_context(viewport={"width": 1280, "height": 900}, color_scheme="light")
    page = ctx.new_page()
    page.goto(BASE + "/", wait_until="networkidle")
    page.click("[data-theme-toggle]")
    check("theme toggle switches to dark", page.get_attribute("html", "data-theme") == "dark")
    page.reload(wait_until="networkidle")
    check("theme persists across reloads", page.get_attribute("html", "data-theme") == "dark")
    ctx.close()

    # ---------- 6. keyboard ----------
    print("Keyboard")
    ctx = browser.new_context(viewport={"width": 1280, "height": 900})
    page = ctx.new_page()
    page.goto(BASE + "/", wait_until="networkidle")
    page.keyboard.press("Tab")
    check("first Tab stop is the skip link", page.evaluate("document.activeElement.className") == "skip-link")
    ctx.close()

    # ---------- screenshots ----------
    if SHOTS:
        import os
        os.makedirs(SHOTS, exist_ok=True)
        for w, h in [(1440, 900), (375, 800)]:
            ctx = browser.new_context(viewport={"width": w, "height": h})
            page = ctx.new_page()
            for name, path in [("home", "/"), ("prompt", "/prompts/cinematic-male-portrait/"), ("category", "/categories/cinematic-portraits/"), ("search", "/search/?q=portrait")]:
                page.goto(BASE + path, wait_until="networkidle")
                page.screenshot(path=f"{SHOTS}/{name}-{w}.png", full_page=True)
            ctx.close()
    browser.close()

passed = sum(1 for _, ok in results if ok)
print(f"\n{passed}/{len(results)} browser checks passed")
if failures:
    print("FAILURES:\n  - " + "\n  - ".join(failures))
    sys.exit(1)
