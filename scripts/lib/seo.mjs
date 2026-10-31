// Structured data (JSON-LD) builders. Only facts that exist in the data are emitted:
// no ratings, reviews, invented authors or fabricated dates.

export function websiteLd(ctx) {
  const { config } = ctx;
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: config.brand.name,
    url: `${config.siteUrl}/`,
    description: config.brand.description,
    inLanguage: config.language,
    potentialAction: {
      '@type': 'SearchAction',
      target: { '@type': 'EntryPoint', urlTemplate: `${config.siteUrl}/search/?q={search_term_string}` },
      'query-input': 'required name=search_term_string',
    },
  };
}

export function organizationLd(ctx) {
  const { config } = ctx;
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: config.brand.name,
    url: `${config.siteUrl}/`,
  };
  if (config.social.length) ld.sameAs = config.social.map((s) => s.url);
  if (config.contact.email) ld.email = config.contact.email;
  return ld;
}

export function breadcrumbLd(ctx, trail) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: `${ctx.config.siteUrl}${item.url}`,
    })),
  };
}

export function promptArticleLd(ctx, p, img) {
  const { config } = ctx;
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: p.title,
    description: p.description,
    datePublished: p.publishedAt,
    dateModified: p.lastModified,
    inLanguage: p.language,
    mainEntityOfPage: `${config.siteUrl}${p.url}`,
    articleSection: p.categoryName,
    keywords: p.tags.join(', '),
    publisher: { '@type': 'Organization', name: config.brand.name, url: `${config.siteUrl}/` },
  };
  // Only real, original images are described as images of the page.
  if (!img.demo) {
    ld.image = { '@type': 'ImageObject', url: `${config.siteUrl}${img.src}`, width: img.width, height: img.height, caption: p.imageAlt };
  }
  const author = p.author || config.authorName;
  if (author) ld.author = { '@type': 'Person', name: author };
  return ld;
}

export function collectionLd(ctx, { name, description, url, prompts }) {
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name,
    description,
    url: `${ctx.config.siteUrl}${url}`,
    inLanguage: ctx.config.language,
    mainEntity: {
      '@type': 'ItemList',
      itemListElement: prompts.map((p, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        url: `${ctx.config.siteUrl}${p.url}`,
        name: p.title,
      })),
    },
  };
}
