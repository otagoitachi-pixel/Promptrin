# Publish to Promptrin from ChatGPT (Custom GPT Action)

You tell ChatGPT: *"Publish 5 prompts targeting luxury perfume photography prompts for the United States."*
It researches the keyword, generates the images, writes the prompts and SEO text, and sends everything to
`POST /api/gpt/publish`. Promptrin checks it all, saves it to GitHub as **one commit**, and Cloudflare rebuilds the site.

> ChatGPT is a separate service. It can only reach the public API described here. It never gets your admin
> login, your GitHub token or any session. It only holds the one API secret you give it (`PROMPTRIN_GPT_SECRET`).

## What exists

| Endpoint | Purpose |
|---|---|
| `GET /api/gpt/health` | Public: `{"status":"ok"}`. With the secret: repo, limits, latest commit. |
| `GET /api/gpt/categories` | Category slugs plus allowed styles, uses, tools and ratios. |
| `GET /api/gpt/tags` | Tags already in use, with counts. |
| `GET /api/gpt/status/{slug}` | Is a prompt saved on GitHub, and is its page live yet? |
| `POST /api/gpt/publish` | 1 to 10 prompts in one request (`items`). |
| `POST /api/gpt/publish/single` | One prompt, flat body. |
| `GET /api/gpt/openapi.json` | The OpenAPI 3.1 file (public, no secrets). A copy is in `docs/promptrin-gpt-openapi.json`. |

Everything except health-without-secret and `openapi.json` needs `Authorization: Bearer <PROMPTRIN_GPT_SECRET>`.

## One-time setup

1. **Deploy** the project as before (Workers Builds; build `npm run build:cloudflare`, deploy `npx wrangler deploy`). `wrangler.jsonc` already routes `/api/gpt/*` to the Worker.
2. **Make the secret** (Termux or any computer with Node): run `node -e "console.log(require('crypto').randomBytes(36).toString('base64url'))"` and copy the output. It must be 32 characters or more. Use a value you have never used anywhere else.
3. **Add it in Cloudflare**: Workers & Pages, your Worker, Settings, Variables and Secrets, Add, type **Secret**, name `PROMPTRIN_GPT_SECRET`.
   The GPT API also needs `GITHUB_TOKEN` and `GITHUB_REPO` (the same ones the online admin uses; see the README). Then retry the build/deployment.
4. **Check** `https://YOUR-SITE.workers.dev/api/gpt/health` shows `{"status":"ok","service":"promptrin-gpt-api"}`.
5. **Create the GPT** (chatgpt.com, Explore GPTs, Create; this needs a paid ChatGPT plan):
   1. Configure tab, **Instructions**: paste the text in the next section.
   2. **Capabilities**: turn on *Web Search* (keyword research) and *Image Generation*.
   3. **Actions**, Create new action:
      - Schema: *Import from URL* and paste `https://YOUR-SITE.workers.dev/api/gpt/openapi.json` (or paste the contents of `docs/promptrin-gpt-openapi.json` and set `servers[0].url` to your site).
      - **Authentication**: *API Key*, Auth Type **Bearer**, paste the same secret.
      - Privacy policy URL: `https://YOUR-SITE.workers.dev/privacy-policy/`.
   4. Save (only you / "Only me").
6. **Test**: ask the GPT to *"Call getHealth"*, then *"Publish 1 prompt for <keyword>"*, then check the page URL it returns after a minute or two.

## Instructions to paste into the GPT

```
You are the publishing assistant for Promptrin, a library of AI image prompts. You publish only through the Promptrin Action.

WORKFLOW for every request
1. Call getCategories and getTags first. Use only the category, style, uses and supported_tools values it returns.
2. Keyword research: use web search to understand what people searching the target keyword want (search intent), for the target country and language. Choose ONE primary_keyword per page. Do not create two pages for the same intent: if two ideas answer the same search, make one page.
3. For each entry generate ONE original image with image generation, then write the exact prompt you used for it. Never reuse an image. Never present AI images as real photographs.
4. Write, per entry: title (natural, unique), description (what the image shows and who the prompt is for, 60 to 400 characters), prompt (complete, exactly what you used), category, 2 to 10 tags (reuse existing tags when they fit), style, uses, seo_title (about 60 characters or fewer, unique, natural, includes the primary keyword once), meta_description (about 120 to 155 characters, unique, useful, no hype), image_alt (plain description), secondary_keywords, search_intent, target_country.
5. Only list a tool in supported_tools if you really used it to make that image (for images you generate yourself that is "chatgpt").
6. Before publishing 3 or more entries, call publishPrompts with dry_run true. If it reports errors, fix them and repeat. Then publish for real.
7. Send the generated images in openaiFileIdRefs and set each entry's image_index to the position of its image. At most 10 entries per request; if asked for more, send several requests.
8. After publishing, report each entry's URL and status. Tell the user the pages go live after Cloudflare finishes building (usually 1 to 3 minutes) and use getPromptStatus to confirm if asked. If anything is rejected, explain the error in plain words and fix it; do not retry blindly.

RULES
- No keyword stuffing. No claims about Google rankings or traffic. No invented statistics.
- Do not publish near-duplicate prompts. If the API says a keyword, slug, title or prompt already exists, change the angle instead of forcing it (use allow_similar_keyword only if the user explicitly asks).
- Never ask for, show or store the API secret.
```

## How a request looks

```json
POST /api/gpt/publish
Authorization: Bearer <secret>

{
  "items": [
    {
      "title": "Luxury perfume bottle on wet stone with rim light",
      "description": "A close product photograph of a luxury perfume bottle on wet dark stone with rim light, made for ecommerce banners.",
      "prompt": "Photograph of a luxury perfume bottle on a wet dark stone surface, soft rim light from the left, tiny water droplets, shallow depth of field, 100mm macro lens, clean negative space.",
      "category": "product-photography",
      "tags": ["perfume", "luxury", "product photography"],
      "style": "studio",
      "uses": ["advertising"],
      "supported_tools": ["chatgpt"],
      "primary_keyword": "luxury perfume photography prompts",
      "secondary_keywords": ["perfume ad prompt"],
      "search_intent": "informational",
      "target_country": "United States",
      "seo_title": "Luxury Perfume Photography Prompt: Wet Stone Rim Light",
      "meta_description": "Copy a ready-made AI prompt for luxury perfume photography with wet stone, rim light and a macro look, plus tips to adapt it.",
      "image_alt": "Luxury perfume bottle on wet dark stone with water droplets",
      "image_index": 0
    }
  ],
  "openaiFileIdRefs": ["(filled in by ChatGPT)"]
}
```

Your original schema maps to the project like this:

| Your field | Saved as | Notes |
|---|---|---|
| `title`, `description` | same | |
| `slug` | `slug` | Optional; created from the title. Must be unique. |
| `prompt` | `promptText` | |
| `category` | `category` | Must be an existing category. |
| `tags` | `tags` | Lowercased and checked. New tags are allowed. |
| `primary_keyword`, `secondary_keywords`, `search_intent`, `target_country` | same (camelCase) | Stored in the prompt JSON and used for duplicate checks. |
| `seo_title`, `meta_description` | `seoTitle`, `seoDescription` | Used for the page title and meta description. Must be unique. |
| `image` | `image_index` (or `image_base64`) | The image bytes come with the request. External image URLs are never fetched. |
| `image_alt` | `imageAlt` | |
| `image_filename` | ignored hint | The site stores `images/originals/<slug>.<ext>`, which is already descriptive, and existing images are never overwritten. |
| `status` | `"published"` only | Drafts are not available through the API. |

Canonical URLs, Open Graph tags and structured data are already generated by the site build for every prompt page,
and related-prompt and category links give internal linking. Nothing here guarantees any Google ranking.

## What is checked before anything is saved

- Secret (constant-time compare); wrong secrets are slowed and then locked out per address after 10 failures a minute.
- Body size (12 MB), item count (10 by default, 20 at most), field lengths, allowed categories, styles, uses and tools.
- Text is cleaned: HTML tags, control characters and direction-override characters are removed.
- Images: the real file bytes must be JPEG, PNG or WebP, at most 8 MB, at least 256 px on each side. The download link must be `https` on an OpenAI host (`oaiusercontent.com`, `openai.com`, `chatgpt.com`; change with `GPT_FILE_HOSTS`) and redirects are refused.
- Duplicates: same slug, same title, a prompt that is 80% or more the same, a primary keyword already used by another prompt, the same SEO title or meta description, an image that already exists. The same keyword can be forced with `allow_similar_keyword: true`.
- The same validation the build uses (`validateContent`), run on the whole result before committing.

**All-or-nothing**: if any entry fails, nothing is saved and every entry gets its own result. Send `allow_partial: true` to
publish the valid ones anyway. Images are uploaded first and are not part of the site until the single commit succeeds,
so a failed upload cannot leave a half-published entry. Re-sending the same request is refused as a duplicate.

## Limits you should know

- **ChatGPT sends at most 10 files per call and each download link lasts 5 minutes**, so 10 prompts per request is the practical maximum (`GPT_MAX_ITEMS`, up to 20, is for other clients using `image_base64`).
- **Workers Free plan**: 50 outbound calls per request. Each prompt uses 2 (download + upload) and about 16 are used for reading and committing, so the API refuses batches that would not fit and tells you the number (about 14 on Free by default, `GPT_SUBREQUEST_LIMIT` = 45). With **Workers Paid ($5/month)** set `GPT_SUBREQUEST_LIMIT=900` for full batches.
- **CPU time**: Free allows 10 ms of CPU per request. Encoding 1 to 2 MB images takes CPU. If Cloudflare shows *error 1102* or the request fails when you send several images, upgrade to Workers Paid (30 s CPU) or publish one or two prompts per request. I could not measure this on real Cloudflare.
- **Rate limits** are best-effort in Worker memory (60 calls and 8 publishes per minute per address; `GPT_CALLS_PER_MINUTE`, `GPT_PUBLISH_PER_MINUTE`). For a hard limit add a Cloudflare WAF rate-limiting rule on `/api/gpt/*`, or the optional `GPT_LIMIT` rate-limit binding.
- **Deployment is not verified by the API.** A commit triggers Cloudflare's build; `deployment.verified` is always `false`. Use `getPromptStatus` to see when the page is live. If a build fails (for example a Cloudflare outage), the old site keeps running and the content stays safely in GitHub.
- ChatGPT's image generation, the Custom GPT feature and the link format are OpenAI's and can change. This was built from OpenAI's documentation and tested here only against simulated services.

## Environment variables

| Name | Type | Required | Meaning |
|---|---|---|---|
| `PROMPTRIN_GPT_SECRET` | Secret | yes | Bearer secret for `/api/gpt/*` (32+ characters). Separate from the admin login. |
| `GITHUB_TOKEN` | Secret | yes | Fine-grained token, this repo only, *Contents: Read and write*. |
| `GITHUB_REPO` | Secret or text | yes | `username/repository`. |
| `GITHUB_BRANCH` | text | no | Defaults to `main`. |
| `GPT_MAX_ITEMS` | text | no | Prompts per request. Default 10, maximum 20. |
| `GPT_SUBREQUEST_LIMIT` | text | no | Default 45 (Free plan). Raise on Paid. |
| `GPT_FILE_HOSTS` | text | no | Comma list of allowed download hosts. |
| `GPT_CALLS_PER_MINUTE`, `GPT_PUBLISH_PER_MINUTE` | text | no | In-memory limits (60, 8). |
| `GPT_LIMIT` | binding | no | Optional Cloudflare rate-limit binding (needs Wrangler 4.36+). |

Never put these values in the repository, in the GPT instructions, or in chat.

## If something goes wrong

- **401** in ChatGPT: the secret in the Action's authentication differs from `PROMPTRIN_GPT_SECRET`, or the Worker was not redeployed after you added it.
- **503**: a secret is missing or shorter than 32 characters.
- **422 with errors**: read the per-entry `errors`; fix and send again. Nothing was saved.
- **413**: too many prompts for one request on your plan; send fewer.
- **409 "changed while publishing"**: two saves overlapped (for example you saved in the admin at the same time). Send again.
- **Image expired / download failed**: ChatGPT links last 5 minutes. Ask the GPT to generate and send again.
- **Page not live after 5 minutes**: open Cloudflare, Workers & Pages, your Worker, Deployments/Builds, and read the build log.
