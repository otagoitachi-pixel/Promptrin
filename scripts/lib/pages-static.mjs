// About, Contact, legal pages and content guidelines.
// Legal text is a reasonable starting point written for the service as it actually works
// (no accounts, no analytics, optional ads). It is NOT legal advice: have it reviewed before launch.
import { esc, formatDate } from './util.mjs';
import { breadcrumbs, renderPage } from './layout.mjs';
import { breadcrumbLd } from './seo.mjs';

function proseShell(ctx, { path, title, description, h1, body, updated }) {
  const trail = [{ name: 'Home', url: '/' }, { name: h1, url: path }];
  const html = `<div class="container page-top">
${breadcrumbs(trail)}
<article class="prose-page">
<h1 class="h1">${esc(h1)}</h1>
${updated ? `<p class="meta-line">Last updated <time datetime="${updated}">${formatDate(updated)}</time></p>` : ''}
<div class="prose">${body}</div>
</article>
</div>`;
  return {
    path,
    indexable: true,
    lastmod: updated || ctx.config.legal.updated,
    html: renderPage(ctx, { path, title: `${title} | ${ctx.config.brand.name}`, description, ld: [breadcrumbLd(ctx, trail)], body: html }),
  };
}

export function staticPages(ctx) {
  const { config } = ctx;
  const brand = esc(config.brand.name);
  const updated = config.legal.updated;
  const adsOn = config.ads.enabled;
  const contactRef = `<a href="/contact/">Contact page</a>`;
  const pages = [];

  pages.push(
    proseShell(ctx, {
      path: '/about/',
      title: 'About',
      h1: `About ${config.brand.name}`,
      description: `${config.brand.name} is a free library of AI image prompts, each explained so you can adapt it to your own ideas.`,
      body: `
<p>${brand} is a free library of AI image prompts. Each prompt is written in plain language, explained, and paired with a customisation guide, so you learn <em>why</em> a look works instead of only copying text.</p>
<h2>What you will find here</h2>
<ul>
<li>Prompts grouped into ten categories, from portraits and product shots to landscapes and seasonal scenes.</li>
<li>A short explanation of the lighting, lens and composition choices behind every prompt.</li>
<li>A guide to changing light, camera angle, background, clothing, mood, composition and aspect ratio.</li>
<li>Links to the official sites of image tools that accept text prompts.</li>
</ul>
<h2>How we write prompts</h2>
<p>Prompts are written from scratch and describe scenes in photographic terms. They avoid real people's names, living artists and brand names. Read the full <a href="/content-guidelines/">content guidelines</a> for what we publish and how we label it.</p>
<h2>An honest note about images and testing</h2>
<p>Prompts are marked as <strong>editorial drafts</strong> until they have been verified on specific tools. Where an original example image is not yet available, the page shows clearly labelled placeholder artwork rather than a stand-in that pretends to be a real result.</p>
<h2>Independence</h2>
<p>${brand} is an independent project. It is not affiliated with, endorsed by or sponsored by any AI tool provider mentioned on the site.</p>
<p>Questions or corrections? Use the ${contactRef}.</p>`,
    }),
  );

  // ---- Contact ----
  const { email, formAction } = config.contact;
  const form = formAction
    ? `<form class="contact-form" action="${esc(formAction)}" method="post" novalidate data-contact-form>
<p class="field"><label for="c-name">Your name</label><input id="c-name" name="name" type="text" required maxlength="100" autocomplete="name"></p>
<p class="field"><label for="c-email">Email address</label><input id="c-email" name="email" type="email" required maxlength="200" autocomplete="email"></p>
<p class="field"><label for="c-msg">Message</label><textarea id="c-msg" name="message" rows="6" required minlength="10" maxlength="3000"></textarea></p>
<p class="hp" aria-hidden="true"><label>Leave this empty<input type="text" name="website" tabindex="-1" autocomplete="off"></label></p>
<p class="form-status" role="alert" data-form-status hidden></p>
<p><button class="btn btn-ink btn-lg" type="submit">Send message</button></p>
<p class="note">Your message goes to our form provider and is used only to reply. See the <a href="/privacy-policy/">Privacy Policy</a>.</p>
</form>`
    : '';
  const mail = email ? `<p>You can also email <a href="mailto:${esc(email)}">${esc(email)}</a>.</p>` : '';
  const unset =
    !email && !formAction
      ? `<div class="notice"><p><strong>Contact details are not set up yet.</strong> The site owner has not added a contact email or form. Please check back soon.</p></div>`
      : '';
  pages.push(
    proseShell(ctx, {
      path: '/contact/',
      title: 'Contact',
      h1: 'Contact',
      description: `Contact ${config.brand.name} with questions, corrections or content requests.`,
      body: `<p>Questions, corrections, or a prompt idea? We read every message. Please do not send passwords, payment details or other sensitive information.</p>${unset}${form}${mail}`,
    }),
  );

  pages.push(
    proseShell(ctx, {
      path: '/content-guidelines/',
      title: 'Content Guidelines',
      h1: 'Content guidelines',
      description: `How ${config.brand.name} writes, labels and reviews AI image prompts.`,
      body: `
<p>These are the editorial rules behind every prompt on ${brand}.</p>
<h2>What we publish</h2>
<ul>
<li><strong>Original prompts.</strong> Each prompt is written for this site and explained in its own words.</li>
<li><strong>Useful detail.</strong> A prompt must come with the reasoning behind it and a customisation guide specific to that prompt.</li>
<li><strong>Fictional, generic subjects.</strong> No prompts that name real people, request a likeness of a real person, or imitate a living artist or a specific brand.</li>
</ul>
<h2>What we do not publish</h2>
<ul>
<li>Sexual content, or content involving minors in any sensitive context.</li>
<li>Images meant to deceive, such as fake documents, fake news imagery or impersonation.</li>
<li>Hateful, violent or harassing content.</li>
<li>Mass-produced near-duplicate prompts. We would rather publish fewer, better entries.</li>
</ul>
<h2>Labels you will see</h2>
<ul>
<li><strong>Editorial draft:</strong> written and reviewed, but not yet verified on specific tools.</li>
<li><strong>Tested:</strong> checked by the editors on the tools listed on the prompt page.</li>
<li><strong>Placeholder artwork:</strong> a stand-in image that is <em>not</em> a result of the prompt.</li>
<li><strong>Trending:</strong> an editorial selection, not a live ranking.</li>
</ul>
<h2>Corrections</h2>
<p>If something is wrong, unclear or inappropriate, tell us through the ${contactRef}. Updated pages show an “Updated” date.</p>`,
    }),
  );

  pages.push(
    proseShell(ctx, {
      path: '/privacy-policy/',
      title: 'Privacy Policy',
      h1: 'Privacy Policy',
      updated,
      description: `How ${config.brand.name} handles data: no accounts, no tracking by default, and optional advertising only with consent.`,
      body: `
<p>This policy explains what happens to information when you use ${brand}. We aim to collect as little as possible.</p>
<h2>What we do not do</h2>
<ul><li>You do not need an account to browse or copy prompts.</li><li>We do not ask for your name or email to use the site.</li><li>We do not sell personal information.</li></ul>
<h2>What stays on your device</h2>
<p>The site stores small preferences in your browser's local storage: your light/dark theme choice${adsOn ? ' and your advertising choice' : ''}. This data never leaves your device through our code, and you can clear it in your browser settings.</p>
<h2>Search and copying</h2>
<p>Search, filters and the copy button run in your browser. The text you search for is not sent to a server by the site's own code, and copying a prompt does not record anything.</p>
<h2>Hosting and server logs</h2>
<p>Like any website, our hosting provider processes technical data such as your IP address, browser type and the pages requested in order to deliver the site and keep it secure. We do not control this processing beyond choosing the provider.</p>
<h2>Advertising</h2>
${
  adsOn
    ? `<p>${brand} may show ads from Google AdSense. Ads are loaded <strong>only after you choose “Allow ads”</strong> in the banner. If you agree, Google and its partners may set or read cookies and similar identifiers to serve and measure ads. You can withdraw consent at any time with the “Ad settings” link in the footer. To learn how Google uses data, see <a href="https://policies.google.com/technologies/partner-sites" target="_blank" rel="noopener noreferrer">Google's partner-sites page</a>.</p>`
    : `<p>This site does not currently show advertising and does not load advertising scripts. If advertising is added in future, this policy will be updated and ads will load only with your consent.</p>`
}
<h2>Contact messages</h2>
<p>${formAction ? 'If you use the contact form, the details you enter are sent to our form provider so we can reply.' : 'If you email us, we keep your message only as long as needed to respond.'} Please do not include sensitive information.</p>
<h2>External links</h2>
<p>Links to AI tools and other sites lead to third parties with their own privacy practices. Please review their policies.</p>
<h2>Children</h2>
<p>${brand} is a general-audience site and is not directed at children under 13.</p>
<h2>Your choices and rights</h2>
<p>Depending on where you live you may have rights to access, correct or delete personal data. Because we hold almost none, most requests can be answered quickly: use the ${contactRef}.</p>
<h2>Changes</h2>
<p>We will update this page when practices change and revise the date above.</p>`,
    }),
  );

  pages.push(
    proseShell(ctx, {
      path: '/terms-of-service/',
      title: 'Terms of Service',
      h1: 'Terms of Service',
      updated,
      description: `The terms for using ${config.brand.name}, including how prompts may be used.`,
      body: `
<p>By using ${brand} you agree to these terms. If you do not agree, please do not use the site.</p>
<h2>Using the site</h2>
<p>You may browse the site and copy prompts for personal or commercial use. You agree not to misuse the site, attempt to disrupt it, or scrape it at a rate that harms its availability.</p>
<h2>Prompts and your outputs</h2>
<p>Prompt text is provided as inspiration. You may use it to generate images with any compatible tool. You are responsible for the images you create, for following the terms and content rules of the tool you use, and for checking that your use of an image is lawful, including any rights of people who may appear similar to generated subjects.</p>
<h2>Site content</h2>
<p>The site's design, written explanations, guides and compilation are protected. Please do not republish them in bulk or present them as your own. Short quotations with a link back are welcome.</p>
<h2>No guarantees</h2>
<p>AI tools produce different results at different times. We do not guarantee that any prompt will give a particular result, or that the site will always be available or error-free.</p>
<h2>Third-party tools and links</h2>
<p>Mentions of third-party tools are for convenience. We do not control them and are not responsible for their content, availability or terms.</p>
<h2>Limitation of liability</h2>
<p>To the extent permitted by law, ${brand} is provided “as is”, and we are not liable for indirect or consequential losses arising from your use of the site.</p>
<h2>Changes</h2>
<p>We may update these terms. Continued use after an update means you accept the revised terms.</p>
<h2>Contact</h2>
<p>Questions about these terms: use the ${contactRef}.</p>`,
    }),
  );

  pages.push(
    proseShell(ctx, {
      path: '/disclaimer/',
      title: 'Disclaimer',
      h1: 'Disclaimer',
      updated,
      description: `Important notes about AI image results, third-party tools and sample images on ${config.brand.name}.`,
      body: `
<h2>Results vary</h2>
<p>Prompts describe an intended look. AI image tools interpret them differently and change over time, so the images you get may differ from what you expect. We make no promise about quality, accuracy or suitability for a particular purpose.</p>
<h2>Prompts are drafts until marked tested</h2>
<p>Unless a prompt is marked <strong>Tested</strong>, it is an editorial draft that has not been verified on specific tools.</p>
<h2>Sample and placeholder images</h2>
<p>Where an image is labelled as placeholder artwork, it is not an output of the prompt shown. Original example images replace placeholders as they become available.</p>
<h2>Third-party tools and trademarks</h2>
<p>Names such as ChatGPT, Google Gemini, Adobe Firefly, Midjourney, Leonardo.Ai and Microsoft Copilot belong to their owners. ${brand} is not affiliated with or endorsed by them. Links lead to their official sites.</p>
<h2>Responsible use</h2>
<p>Do not use generated images to deceive, impersonate real people, or infringe others' rights. Follow the rules of the tool you use and the laws that apply to you. If you use a generated face as an identity photo, check the platform's rules first.</p>
<h2>No professional advice</h2>
<p>Content on this site is general information, not legal, business or professional advice.</p>
${adsOn ? '<h2>Advertising</h2><p>Ads are labelled “Advertisement” and are separate from editorial content. We do not endorse advertised products.</p>' : ''}`,
    }),
  );

  return pages;
}
