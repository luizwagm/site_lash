/* ==========================================================================
   build.js — Gera as páginas de case com URL amigável (Node, sem deps)
   Lê assets/data/projects.json + src/case.html e escreve:
     projeto/<id>/index.html   (SEO próprio: title, desc, canonical, JSON-LD)
   Também regenera o sitemap.xml com as URLs dos cases.
   Rode:  node build.js
   ========================================================================== */

const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const SITE = "https://luizaugust.me";
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const writeInto = (rel, html) => {
  const full = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, html);
  console.log("· escrito", rel);
};
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

const projects = JSON.parse(read("assets/data/projects.json"));
const tpl = read("src/case.html");

projects.forEach((p, i) => {
  const next = projects[(i + 1) % projects.length];
  const url = `${SITE}/projeto/${p.id}/`;

  const jsonld = JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CreativeWork",
        name: p.title,
        description: p.summary,
        image: p.image,
        dateCreated: p.year,
        genre: p.categoryLabel,
        url,
        creator: { "@type": "Organization", name: "LA Software House", url: `${SITE}/` },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Início", item: `${SITE}/` },
          { "@type": "ListItem", position: 2, name: "Projetos", item: `${SITE}/#projetos` },
          { "@type": "ListItem", position: 3, name: p.title, item: url },
        ],
      },
    ],
  });

  const results = p.results
    .map(
      (r) => `<div class="stat" data-reveal><dd class="stat__num gradient-text">${esc(r.num)}</dd><dt class="stat__label">${esc(r.label)}</dt></div>`
    )
    .join("\n          ");

  const features = p.features
    .map(
      (f) => `<li data-reveal><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg> ${esc(f)}</li>`
    )
    .join("\n          ");

  const stack = p.stack.map((s) => `<span class="tag">${esc(s)}</span>`).join("");

  const html = tpl
    .replaceAll("{{TITLE}}", esc(p.title))
    .replaceAll("{{SUMMARY}}", esc(p.summary))
    .replaceAll("{{ID}}", p.id)
    .replaceAll("{{CATEGORY_LABEL}}", esc(p.categoryLabel))
    .replaceAll("{{YEAR}}", esc(p.year))
    .replaceAll("{{BADGE}}", esc(p.badge))
    .replaceAll("{{CLIENT}}", esc(p.client || "Confidencial"))
    .replaceAll("{{IMAGE}}", esc(p.image))
    .replaceAll("{{CHALLENGE}}", esc(p.challenge))
    .replaceAll("{{SOLUTION}}", esc(p.solution))
    .replaceAll("{{RESULTS}}", results)
    .replaceAll("{{FEATURES}}", features)
    .replaceAll("{{STACK}}", stack)
    .replaceAll("{{NEXT_TITLE}}", esc(next.title))
    .replaceAll("{{NEXT_URL}}", `/projeto/${next.id}/`)
    .replaceAll("{{JSONLD}}", jsonld);

  writeInto(`projeto/${p.id}/index.html`, html);
});

/* ------------------------------ Sitemap ---------------------------------- */
const today = new Date().toISOString().slice(0, 10);
const urls = [
  { loc: `${SITE}/`, freq: "weekly", pri: "1.0" },
  ...projects.map((p) => ({ loc: `${SITE}/projeto/${p.id}/`, freq: "monthly", pri: "0.8" })),
];
const sitemap =
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  urls
    .map(
      (u) =>
        `  <url>\n    <loc>${u.loc}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>${u.freq}</changefreq>\n    <priority>${u.pri}</priority>\n  </url>`
    )
    .join("\n") +
  `\n</urlset>\n`;
writeInto("sitemap.xml", sitemap);

console.log(`\n✓ Build concluído: ${projects.length} cases + sitemap.`);
