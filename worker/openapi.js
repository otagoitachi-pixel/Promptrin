// OpenAPI 3.1 description of the GPT publishing API, for a Custom GPT Action.
// Served at /api/gpt/openapi.json (no secrets in it) and saved to docs/promptrin-gpt-openapi.json by `npm run build:cloudflare`.
import { SNAPSHOT } from './generated.js';

export function openapi(serverUrl = 'https://YOUR-SITE.example') {
  const cats = SNAPSHOT.categories.map((c) => c.slug);
  const styles = Object.keys(SNAPSHOT.taxonomy.styles);
  const uses = Object.keys(SNAPSHOT.taxonomy.uses);
  const tools = Object.keys(SNAPSHOT.taxonomy.tools);
  const itemProps = {
    title: { type: 'string', minLength: 8, maxLength: 90, description: 'Unique page title (H1). Natural wording, no keyword stuffing.' },
    slug: { type: 'string', pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$', maxLength: 70, description: 'Optional URL slug. Omit to create it from the title. Must be unique.' },
    description: { type: 'string', minLength: 60, maxLength: 400, description: 'Short original description of the image and what the prompt is for.' },
    prompt: { type: 'string', minLength: 80, maxLength: 4000, description: 'The complete prompt exactly as used to generate the attached image.' },
    category: { type: 'string', enum: cats, description: 'One existing category slug.' },
    tags: { type: 'array', minItems: 2, maxItems: 10, items: { type: 'string', maxLength: 30 }, description: 'Relevant lowercase tags. Reuse tags from getTags when they fit.' },
    style: { type: 'string', enum: styles, description: 'Visual style.' },
    uses: { type: 'array', items: { type: 'string', enum: uses }, description: 'What the image is used for.' },
    supported_tools: { type: 'array', items: { type: 'string', enum: tools }, description: 'Only the tools really used to make the image.' },
    ratio: { type: 'string', pattern: '^\\d{1,2}:\\d{1,2}$', description: 'Aspect ratio such as 2:3. Omit to detect it from the image.' },
    primary_keyword: { type: 'string', minLength: 2, maxLength: 80, description: 'The one search phrase this page targets. Must not already be targeted by another prompt.' },
    secondary_keywords: { type: 'array', maxItems: 10, items: { type: 'string', maxLength: 80 }, description: 'Related phrases to use naturally.' },
    search_intent: { type: 'string', enum: ['informational', 'commercial', 'transactional', 'navigational'] },
    target_country: { type: 'string', maxLength: 40, description: 'For example United States.' },
    target_language: { type: 'string', description: `Language code. This site publishes "${SNAPSHOT.language}" only.` },
    seo_title: { type: 'string', minLength: 15, maxLength: 70, description: 'Unique <title>. Aim for 60 characters or fewer.' },
    meta_description: { type: 'string', minLength: 70, maxLength: 170, description: 'Unique meta description. Aim for 155 characters or fewer.' },
    image_alt: { type: 'string', minLength: 10, maxLength: 160, description: 'Plain description of what the image shows.' },
    image_index: { type: 'integer', minimum: 0, description: 'Position (starting at 0) of this entry\'s generated image in openaiFileIdRefs.' },
    image_base64: { type: 'string', description: 'Alternative to image_index: a data URL (JPEG, PNG or WebP). Normally not used from ChatGPT.' },
    image_filename: { type: 'string', description: 'Ignored hint. The image is saved as images/originals/<slug>.<ext>.' },
    status: { type: 'string', enum: ['published'], default: 'published' },
    allow_similar_keyword: { type: 'boolean', description: 'Only set true when the user deliberately wants a second page for a keyword already used.' },
  };
  const required = ['title', 'description', 'prompt', 'category', 'tags', 'style', 'primary_keyword', 'seo_title', 'meta_description', 'image_alt'];
  const fileRefs = { type: 'array', maxItems: 10, items: { type: 'string' }, description: 'The generated images, attached by ChatGPT. Entry N uses image_index.' };
  const resultSchema = { $ref: '#/components/schemas/PublishResult' };
  const err = (d) => ({ description: d, content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } });
  const publishErrors = { 401: err('Missing or invalid secret.'), 413: err('Too many prompts or too large.'), 422: { description: 'Nothing published. Per-entry errors are in the body.', content: { 'application/json': { schema: resultSchema } } }, 429: err('Rate limited. Wait and retry.') };
  const single = { type: 'object', required: [...required, 'openaiFileIdRefs'], properties: { ...itemProps, openaiFileIdRefs: fileRefs, dry_run: { type: 'boolean', description: 'Check only; save nothing.' } } };
  return {
    openapi: '3.1.0',
    info: { title: 'Promptrin publishing API', version: '1.0.0', description: 'Lets a Custom GPT publish AI image prompts to Promptrin. Each save is one GitHub commit; Cloudflare then rebuilds the site.' },
    servers: [{ url: serverUrl }],
    security: [{ bearerAuth: [] }],
    paths: {
      '/api/gpt/health': { get: { operationId: 'getHealth', summary: 'Check the API', description: 'Confirms the secret works and shows limits.', responses: { 200: { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { status: { type: 'string' }, maxPromptsPerRequest: { type: 'integer' }, maxImageMegabytes: { type: 'number' }, latestCommit: { type: 'string' } } } } } }, 401: err('Invalid secret.') } } },
      '/api/gpt/categories': { get: { operationId: 'getCategories', summary: 'List categories and allowed values', description: 'Categories plus the allowed styles, uses, tools and ratios. Call before publishing.', responses: { 200: { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { categories: { type: 'array', items: { type: 'object', properties: { slug: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' } } } }, styles: { type: 'array', items: { type: 'object' } }, uses: { type: 'array', items: { type: 'object' } }, tools: { type: 'array', items: { type: 'object' } }, ratios: { type: 'array', items: { type: 'string' } } } } } } }, 401: err('Invalid secret.') } } },
      '/api/gpt/tags': { get: { operationId: 'getTags', summary: 'List tags in use', description: 'Existing tags with counts, so tags can be reused.', responses: { 200: { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { tags: { type: 'array', items: { type: 'object', properties: { tag: { type: 'string' }, count: { type: 'integer' } } } } } } } } }, 401: err('Invalid secret.') } } },
      '/api/gpt/status/{slug}': { get: { operationId: 'getPromptStatus', summary: 'Is a published prompt live?', description: 'Tells whether a prompt is saved on GitHub and whether its page is live yet.', parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string', pattern: '^[a-z0-9-]{1,70}$' } }], responses: { 200: { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { slug: { type: 'string' }, savedOnGitHub: { type: 'boolean' }, live: { type: 'boolean' }, url: { type: 'string' } } } } } }, 401: err('Invalid secret.') } } },
      '/api/gpt/publish': { post: { operationId: 'publishPrompts', summary: 'Publish 1 to 10 prompts', description: 'All-or-nothing by default. Each entry needs its generated image via image_index. Use dry_run first for large batches.', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['items', 'openaiFileIdRefs'], properties: { items: { type: 'array', minItems: 1, maxItems: 10, items: { $ref: '#/components/schemas/PromptItem' } }, openaiFileIdRefs: fileRefs, dry_run: { type: 'boolean' }, allow_partial: { type: 'boolean', description: 'Publish the valid entries even if others fail.' } } } } } }, responses: { 200: { description: 'Published (or dry run).', content: { 'application/json': { schema: resultSchema } } }, ...publishErrors } } },
      '/api/gpt/publish/single': { post: { operationId: 'publishPrompt', summary: 'Publish one prompt', description: 'One prompt in a flat body. The image is openaiFileIdRefs[0] (image_index 0).', requestBody: { required: true, content: { 'application/json': { schema: single } } }, responses: { 200: { description: 'Published (or dry run).', content: { 'application/json': { schema: resultSchema } } }, ...publishErrors } } },
    },
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', description: 'The PROMPTRIN_GPT_SECRET value.' } },
      schemas: {
        PromptItem: { type: 'object', required: [...required, 'image_index'], properties: itemProps },
        PublishResult: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['published', 'partial', 'rejected', 'dry_run'] },
            message: { type: 'string' }, published: { type: 'integer' }, total: { type: 'integer' }, commitUrl: { type: 'string' },
            deployment: { type: 'object', properties: { triggered: { type: 'boolean' }, verified: { type: 'boolean' }, note: { type: 'string' } } },
            results: { type: 'array', items: { type: 'object', properties: { index: { type: 'integer' }, title: { type: 'string' }, slug: { type: 'string' }, status: { type: 'string' }, url: { type: 'string' }, errors: { type: 'array', items: { type: 'string' } }, warnings: { type: 'array', items: { type: 'string' } } } } },
          },
        },
        Error: { type: 'object', properties: { errors: { type: 'array', items: { type: 'string' } } } },
      },
    },
  };
}
