/* ==========================================================================
   server.js — Gerenciador do site LA Software House
   Node puro + SQLite nativo (node:sqlite) — ZERO dependências externas.

   · Serve o site estático            → http://localhost:5181/
   · Painel administrativo            → http://localhost:5181/admin/
   · API REST (auth por sessão)       → /api/*
   · "Publicar" regenera os arquivos estáticos a partir do banco:
       index.html (marcadores <!--#KEY-->), assets/data/projects.json,
       assets/js/config.js e roda build.js (cases + sitemap).

   Rodar:  node server.js        Senha inicial: la-admin  (troque no painel)
   ========================================================================== */

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");

const ROOT = __dirname;
const PORT = 5180;
const UPLOAD_DIR = path.join(ROOT, "assets", "img", "uploads");
fs.mkdirSync(path.join(ROOT, "data"), { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/* ------------------------------- Banco ---------------------------------- */
const db = new DatabaseSync(path.join(ROOT, "data", "site.db"));
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, category TEXT, categoryLabel TEXT,
    year TEXT, badge TEXT, client TEXT, summary TEXT, challenge TEXT, solution TEXT,
    results TEXT, features TEXT, stack TEXT, image TEXT, sort INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, text TEXT, tags TEXT, sort INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS testimonials (
    id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL, name TEXT, role TEXT, initials TEXT, sort INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS faq (
    id INTEGER PRIMARY KEY AUTOINCREMENT, question TEXT NOT NULL, answer TEXT NOT NULL, sort INTEGER DEFAULT 0
  );
`);

const sha = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const getSetting = (k) => db.prepare("SELECT value FROM settings WHERE key=?").get(k)?.value;
const setSetting = (k, v) =>
  db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(k, String(v));

/* ------------------------------ Seed inicial ----------------------------- */
function seed() {
  if (getSetting("hero_title")) return;
  const S = {
    admin_password_hash: sha("la-admin"),
    hero_badge: `<span class="dot" aria-hidden="true"></span> Disponível para novos projetos · <b>2026</b>`,
    hero_title: `Ideias viram <span class="gradient-text">software</span><br>que gera resultado.`,
    hero_lead: `Somos a <b>LA Software House</b>. Há 15 anos transformamos briefings em sites, portais, aplicativos e plataformas SaaS sob medida — do primeiro rascunho ao deploy em produção.`,
    stats: JSON.stringify([
      { num: "15+", label: "anos de mercado" },
      { num: "+120", label: "projetos entregues" },
      { num: "BR+", label: "Brasil & exterior" },
      { num: "100", label: "/100 em performance" },
    ]),
    about_title: "15 anos transformando código em resultado.",
    about_lead: "Tempo de mercado não se improvisa. Nesses 15 anos aprendemos a entregar software que funciona, escala e não vira dor de cabeça depois.",
    about_bullets: JSON.stringify([
      "Código próprio e documentado — sem amarras de no-code",
      "Performance, segurança e SEO como padrão, não como extra",
      "Do brief ao deploy com uma equipe só — sem terceirizar o núcleo",
      "Atendimento para Brasil e exterior, em português e inglês",
    ]),
    contact_email: "contato@luizaugust.me",
    contact_response: "Até 24h úteis",
    contact_area: "Brasil & exterior · PT / EN",
    footer_tagline: "Software house com 15 anos de mercado. Sites, portais, aplicativos e SaaS sob medida — do brief ao deploy.",
  };
  for (const [k, v] of Object.entries(S)) setSetting(k, v);

  const svc = [
    ["Sites & Landing Pages", "Institucionais e páginas de alta conversão, com SEO técnico e performance de sobra.", ["SEO", "Core Web Vitals", "CMS"]],
    ["Portais & Intranets", "Áreas logadas, multiperfil, SSO e integrações com os sistemas que a empresa já usa.", ["SSO", "Multiperfil", "APIs"]],
    ["Aplicativos", "Apps iOS e Android (nativos ou multiplataforma), publicados e prontos para escalar.", ["iOS", "Android", "Push"]],
    ["Plataformas SaaS", "Produtos multi-tenant com billing recorrente, dashboards e API pública. Do MVP à escala.", ["Multi-tenant", "Billing", "API"]],
    ["Sob demanda", "Sistemas específicos, automações e integrações que resolvem exatamente o seu gargalo.", ["Automação", "Integração", "ERP"]],
  ];
  svc.forEach((s, i) => db.prepare("INSERT INTO services(title,text,tags,sort) VALUES(?,?,?,?)").run(s[0], s[1], JSON.stringify(s[2]), i));

  const dep = [
    ["Entregaram nosso portal no prazo e com uma qualidade acima do que esperávamos. Virou referência interna.", "Marcos R.", "Diretor de TI · Indústria", "MR"],
    ["Do MVP à primeira leva de clientes pagantes em poucos meses. Time técnico de verdade.", "Carla F.", "Founder · Startup SaaS", "CF"],
    ["O app subiu nas duas lojas sem dor de cabeça e o suporte continua presente. Recomendo demais.", "João P.", "CEO · Varejo", "JP"],
  ];
  dep.forEach((d, i) => db.prepare("INSERT INTO testimonials(text,name,role,initials,sort) VALUES(?,?,?,?,?)").run(d[0], d[1], d[2], d[3], i));

  const faqs = [
    ["Quanto custa desenvolver um site, app ou sistema?", "Depende do escopo: um site institucional custa muito menos que um SaaS multi-tenant. Por isso trabalhamos com orçamento sob medida — você conta o que precisa e devolvemos uma proposta clara, com valores e prazos, em até 24h úteis. Sem compromisso."],
    ["Quanto tempo leva um projeto?", "Sites e landing pages ficam prontos em 2 a 6 semanas. Aplicativos, portais e plataformas SaaS variam de 2 a 6 meses conforme a complexidade. Definimos o cronograma na proposta e você acompanha as entregas em ciclos curtos."],
    ["Vocês atendem empresas fora do Brasil?", "Sim. Trabalhamos 100% remoto, atendemos em português e inglês e já entregamos projetos para clientes no Brasil e no exterior."],
    ["Como funciona o processo de desenvolvimento?", "Em 4 etapas: Descoberta (escopo e orçamento), Arquitetura & Design (você aprova antes do código), Desenvolvimento (entregas em ciclos curtos com ambiente de teste) e Deploy & Evolução (publicação, monitoramento e suporte contínuo)."],
    ["O código-fonte fica com quem?", "Com você. Entregamos código próprio, documentado e versionado — sem dependência de plataformas fechadas e sem aprisionamento. Seu produto é seu."],
  ];
  faqs.forEach((f, i) => db.prepare("INSERT INTO faq(question,answer,sort) VALUES(?,?,?)").run(f[0], f[1], i));

  // Importa o portfólio existente
  try {
    const pj = JSON.parse(fs.readFileSync(path.join(ROOT, "assets/data/projects.json"), "utf8"));
    pj.forEach((p, i) =>
      db.prepare("INSERT OR IGNORE INTO projects(id,title,category,categoryLabel,year,badge,client,summary,challenge,solution,results,features,stack,image,sort) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .run(p.id, p.title, p.category, p.categoryLabel, p.year, p.badge, p.client || "", p.summary, p.challenge || "", p.solution || "",
          JSON.stringify(p.results || []), JSON.stringify(p.features || []), JSON.stringify(p.stack || []), p.image || "", i)
    );
  } catch (e) { console.error("Seed de projetos falhou:", e.message); }
  console.log("· Banco inicializado (seed). Senha do painel: la-admin");
}
seed();

/* ------------------------------- Sessões --------------------------------- */
const sessions = new Map();
const newToken = () => crypto.randomBytes(24).toString("hex");
function authed(req) {
  const m = /(?:^|;\s*)sid=([a-f0-9]+)/.exec(req.headers.cookie || "");
  return m && sessions.has(m[1]);
}

/* --------------------------- Render (publicação) ------------------------- */
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const SERVICE_ICONS = [
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M3 9h18M8 21h8"/></svg>',
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16v12H4z"/><path d="M2 20h20M9 8h6M9 12h6"/></svg>',
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/></svg>',
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a10 10 0 1 0 10 10"/><path d="M12 6v6l4 2"/><path d="M16 2h6v6"/></svg>',
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 2 7l10 5 10-5-10-5Z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/></svg>',
];
const CHECK_SVG = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';

function renderAll() {
  const S = {};
  for (const row of db.prepare("SELECT key,value FROM settings").all()) S[row.key] = row.value;
  const services = db.prepare("SELECT * FROM services ORDER BY sort,id").all();
  const testimonials = db.prepare("SELECT * FROM testimonials ORDER BY sort,id").all();
  const faq = db.prepare("SELECT * FROM faq ORDER BY sort,id").all();

  const stats = JSON.parse(S.stats || "[]")
    .map((s) => `<div class="stat"><dd class="stat__num gradient-text">${esc(s.num)}</dd><dt class="stat__label">${esc(s.label)}</dt></div>`)
    .join("\n            ");

  const servicesHtml = services.map((s, i) => {
    const tags = JSON.parse(s.tags || "[]").map((t) => `<span class="tag">${esc(t)}</span>`).join("");
    const delay = i % 3 ? ` data-reveal-delay="${i % 3}"` : "";
    return `<article class="card" data-reveal${delay}>
            <div class="service__icon">${SERVICE_ICONS[i % SERVICE_ICONS.length]}</div>
            <h3 class="service__title">${esc(s.title)}</h3>
            <p class="service__text">${esc(s.text)}</p>
            <div class="service__tags">${tags}</div>
          </article>`;
  }).join("\n          ") + `\n          <article class="card" data-reveal data-reveal-delay="2" style="background:linear-gradient(150deg,rgba(124,92,255,.16),rgba(36,227,214,.1));display:flex;flex-direction:column;justify-content:center">
            <h3 class="service__title">Não sabe por onde começar?</h3>
            <p class="service__text">A gente ajuda a definir o escopo, o melhor caminho técnico e o orçamento.</p>
            <a class="link-arrow mt-xl" href="#contato">Conversar com um especialista
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a>
          </article>`;

  const bullets = JSON.parse(S.about_bullets || "[]")
    .map((b) => `<li>${CHECK_SVG} ${esc(b)}</li>`)
    .join("\n            ");

  const testimonialsHtml = testimonials.map((t, i) => {
    const delay = i % 3 ? ` data-reveal-delay="${i % 3}"` : "";
    return `<figure class="quote" data-reveal${delay}>
            <blockquote class="quote__text">“${esc(t.text)}”</blockquote>
            <figcaption class="quote__author"><span class="avatar" aria-hidden="true">${esc(t.initials)}</span><span><span class="quote__name">${esc(t.name)}</span><br><span class="quote__role">${esc(t.role)}</span></span></figcaption>
          </figure>`;
  }).join("\n          ");

  const faqHtml = faq.map((f) => `<details>
            <summary>${esc(f.question)}</summary>
            <p>${esc(f.answer)}</p>
          </details>`).join("\n          ");

  const contactSide = `<a class="contact-tile" href="mailto:${esc(S.contact_email)}">
              <span class="contact-tile__icon"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg></span>
              <span><span class="contact-tile__label">E-mail</span><br><span class="contact-tile__value">${esc(S.contact_email)}</span></span>
            </a>
            <div class="contact-tile">
              <span class="contact-tile__icon"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 6v6l4 2"/><circle cx="12" cy="12" r="9"/></svg></span>
              <span><span class="contact-tile__label">Tempo de resposta</span><br><span class="contact-tile__value">${esc(S.contact_response)}</span></span>
            </div>
            <div class="contact-tile">
              <span class="contact-tile__icon"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M2 12h20M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18Z"/></svg></span>
              <span><span class="contact-tile__label">Atuação</span><br><span class="contact-tile__value">${esc(S.contact_area)}</span></span>
            </div>
            <div class="contact-tile" style="flex-direction:column;gap:.5rem;align-items:flex-start">
              <span class="contact-tile__label">Prefere ir direto ao ponto?</span>
              <p class="service__text">Manda o briefing pelo formulário que a gente já volta com um plano e uma estimativa.</p>
            </div>`;

  const footerContact = `<li><a href="mailto:${esc(S.contact_email)}">${esc(S.contact_email)}</a></li>
            <li><span style="color:var(--text-dim)">${esc(S.contact_area)}</span></li>
            <li><a href="#contato">Iniciar um projeto →</a></li>`;

  const jsonld = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Organization", "@id": "https://luizaugust.me/#org", name: "LA Software House", url: "https://luizaugust.me/",
        logo: "https://luizaugust.me/assets/img/logo-horizontal.svg", email: S.contact_email, foundingDate: "2011",
        description: "Software house especializada em sites, portais, aplicativos e plataformas SaaS sob medida." },
      { "@type": "ProfessionalService", "@id": "https://luizaugust.me/#service", name: "LA Software House",
        image: "https://luizaugust.me/assets/img/logo-horizontal.svg", url: "https://luizaugust.me/",
        areaServed: ["BR", "Worldwide"], serviceType: services.map((s) => s.title),
        parentOrganization: { "@id": "https://luizaugust.me/#org" } },
      { "@type": "WebSite", url: "https://luizaugust.me/", name: "LA Software House", inLanguage: "pt-BR",
        publisher: { "@id": "https://luizaugust.me/#org" } },
      { "@type": "FAQPage", "@id": "https://luizaugust.me/#faq",
        mainEntity: faq.map((f) => ({ "@type": "Question", name: f.question, acceptedAnswer: { "@type": "Answer", text: f.answer } })) },
    ],
  };
  const jsonldHtml = `<script type="application/ld+json">\n  ${JSON.stringify(jsonld, null, 2).replace(/\n/g, "\n  ")}\n  </script>`;

  return { S, stats, servicesHtml, bullets, testimonialsHtml, faqHtml, contactSide, footerContact, jsonldHtml };
}

function setMarker(html, key, content) {
  const re = new RegExp(`(<!--#${key}-->)[\\s\\S]*?(<!--\\/${key}-->)`);
  if (!re.test(html)) throw new Error(`Marcador ${key} não encontrado no index.html`);
  return html.replace(re, `$1\n${content}\n$2`);
}

function publish() {
  const r = renderAll();
  const idx = path.join(ROOT, "index.html");
  let html = fs.readFileSync(idx, "utf8");
  html = setMarker(html, "JSONLD", "  " + r.jsonldHtml);
  html = setMarker(html, "HERO_BADGE", r.S.hero_badge);
  html = setMarker(html, "HERO_TITLE", "            " + r.S.hero_title);
  html = setMarker(html, "HERO_LEAD", "            " + r.S.hero_lead);
  html = setMarker(html, "STATS", "            " + r.stats);
  html = setMarker(html, "SERVICES", "          " + r.servicesHtml);
  html = setMarker(html, "ABOUT_TITLE", r.S.about_title);
  html = setMarker(html, "ABOUT_LEAD", r.S.about_lead);
  html = setMarker(html, "ABOUT_BULLETS", "            " + r.bullets);
  html = setMarker(html, "TESTIMONIALS", "          " + r.testimonialsHtml);
  html = setMarker(html, "FAQ_ITEMS", "          " + r.faqHtml);
  html = setMarker(html, "CONTACT_SIDE", "            " + r.contactSide);
  html = setMarker(html, "FOOTER_TAGLINE", r.S.footer_tagline);
  html = setMarker(html, "FOOTER_CONTACT", "            " + r.footerContact);
  fs.writeFileSync(idx, html);

  // projects.json
  const projects = db.prepare("SELECT * FROM projects ORDER BY sort,id").all().map((p) => ({
    id: p.id, title: p.title, category: p.category, categoryLabel: p.categoryLabel, year: p.year,
    badge: p.badge, client: p.client, summary: p.summary, challenge: p.challenge, solution: p.solution,
    results: JSON.parse(p.results || "[]"), features: JSON.parse(p.features || "[]"),
    stack: JSON.parse(p.stack || "[]"), image: p.image,
  }));
  fs.writeFileSync(path.join(ROOT, "assets/data/projects.json"), JSON.stringify(projects, null, 2));

  // config.js (e-mail de contato)
  const cfgPath = path.join(ROOT, "assets/js/config.js");
  let cfg = fs.readFileSync(cfgPath, "utf8");
  cfg = cfg.replace(/export const CONTACT_EMAIL = "[^"]*";/, `export const CONTACT_EMAIL = "${r.S.contact_email}";`);
  fs.writeFileSync(cfgPath, cfg);

  // cases + sitemap
  const out = execSync("node build.js", { cwd: ROOT }).toString();
  return { pages: projects.length, buildLog: out.trim().split("\n").pop() };
}

/* ------------------------------ Utilidades HTTP -------------------------- */
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".webmanifest": "application/manifest+json", ".xml": "application/xml", ".txt": "text/plain", ".ico": "image/x-icon" };

const json = (res, code, obj) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(obj)); };
const readBody = (req) => new Promise((resolve, reject) => {
  let data = ""; let size = 0;
  req.on("data", (c) => { size += c.length; if (size > 25e6) { reject(new Error("payload muito grande")); req.destroy(); } data += c; });
  req.on("end", () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error("JSON inválido")); } });
});

const TABLES = {
  services: ["title", "text", "tags", "sort"],
  testimonials: ["text", "name", "role", "initials", "sort"],
  faq: ["question", "answer", "sort"],
};
const SETTING_KEYS = ["hero_badge", "hero_title", "hero_lead", "stats", "about_title", "about_lead", "about_bullets",
  "contact_email", "contact_response", "contact_area", "footer_tagline"];
const PROJECT_COLS = ["id", "title", "category", "categoryLabel", "year", "badge", "client", "summary", "challenge",
  "solution", "results", "features", "stack", "image", "sort"];

const slugify = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/* -------------------------------- Servidor ------------------------------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;

  try {
    /* ------------------------------ API ---------------------------------- */
    if (p.startsWith("/api/")) {
      if (p === "/api/login" && req.method === "POST") {
        const { password } = await readBody(req);
        if (sha(password) !== getSetting("admin_password_hash")) return json(res, 401, { error: "Senha incorreta" });
        const token = newToken();
        sessions.set(token, Date.now());
        res.setHeader("Set-Cookie", `sid=${token}; HttpOnly; Path=/; SameSite=Lax`);
        return json(res, 200, { ok: true });
      }
      if (!authed(req)) return json(res, 401, { error: "Não autenticado" });

      if (p === "/api/me") return json(res, 200, { ok: true });
      if (p === "/api/logout" && req.method === "POST") {
        const m = /sid=([a-f0-9]+)/.exec(req.headers.cookie || ""); if (m) sessions.delete(m[1]);
        return json(res, 200, { ok: true });
      }
      if (p === "/api/password" && req.method === "POST") {
        const { current, next } = await readBody(req);
        if (sha(current) !== getSetting("admin_password_hash")) return json(res, 400, { error: "Senha atual incorreta" });
        if (!next || String(next).length < 6) return json(res, 400, { error: "Nova senha deve ter 6+ caracteres" });
        setSetting("admin_password_hash", sha(next));
        return json(res, 200, { ok: true });
      }
      if (p === "/api/content" && req.method === "GET") {
        const S = {}; for (const k of SETTING_KEYS) S[k] = getSetting(k) || "";
        return json(res, 200, {
          settings: S,
          services: db.prepare("SELECT * FROM services ORDER BY sort,id").all(),
          testimonials: db.prepare("SELECT * FROM testimonials ORDER BY sort,id").all(),
          faq: db.prepare("SELECT * FROM faq ORDER BY sort,id").all(),
        });
      }
      if (p === "/api/settings" && req.method === "PUT") {
        const body = await readBody(req);
        for (const [k, v] of Object.entries(body)) if (SETTING_KEYS.includes(k)) setSetting(k, v);
        return json(res, 200, { ok: true });
      }
      if (p === "/api/projects" && req.method === "GET") {
        const rows = db.prepare("SELECT * FROM projects ORDER BY sort,id").all()
          .map((r) => ({ ...r, results: JSON.parse(r.results || "[]"), features: JSON.parse(r.features || "[]"), stack: JSON.parse(r.stack || "[]") }));
        return json(res, 200, rows);
      }
      if (p === "/api/projects" && req.method === "POST") {
        const b = await readBody(req);
        const id = slugify(b.id || b.title || "projeto");
        if (!id || db.prepare("SELECT 1 FROM projects WHERE id=?").get(id)) return json(res, 400, { error: "id vazio ou já existe" });
        db.prepare("INSERT INTO projects(id,title,category,categoryLabel,year,badge,client,summary,challenge,solution,results,features,stack,image,sort) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
          .run(id, b.title || "", b.category || "sites", b.categoryLabel || "", b.year || "", b.badge || "", b.client || "",
            b.summary || "", b.challenge || "", b.solution || "", JSON.stringify(b.results || []),
            JSON.stringify(b.features || []), JSON.stringify(b.stack || []), b.image || "", b.sort ?? 99);
        return json(res, 200, { ok: true, id });
      }
      const pm = p.match(/^\/api\/projects\/([a-z0-9-]+)$/);
      if (pm && req.method === "PUT") {
        const b = await readBody(req);
        const sets = []; const vals = [];
        for (const c of PROJECT_COLS) if (c !== "id" && c in b) {
          sets.push(`${c}=?`);
          vals.push(["results", "features", "stack"].includes(c) ? JSON.stringify(b[c]) : b[c]);
        }
        if (sets.length) db.prepare(`UPDATE projects SET ${sets.join(",")} WHERE id=?`).run(...vals, pm[1]);
        return json(res, 200, { ok: true });
      }
      if (pm && req.method === "DELETE") {
        db.prepare("DELETE FROM projects WHERE id=?").run(pm[1]);
        return json(res, 200, { ok: true });
      }
      const tm = p.match(/^\/api\/(services|testimonials|faq)(?:\/(\d+))?$/);
      if (tm) {
        const table = tm[1], id = tm[2], cols = TABLES[table];
        if (req.method === "POST" && !id) {
          const b = await readBody(req);
          const use = cols.filter((c) => c in b);
          db.prepare(`INSERT INTO ${table}(${use.join(",")}) VALUES(${use.map(() => "?").join(",")})`)
            .run(...use.map((c) => (c === "tags" ? JSON.stringify(b[c]) : b[c])));
          return json(res, 200, { ok: true });
        }
        if (req.method === "PUT" && id) {
          const b = await readBody(req);
          const use = cols.filter((c) => c in b);
          if (use.length) db.prepare(`UPDATE ${table} SET ${use.map((c) => c + "=?").join(",")} WHERE id=?`)
            .run(...use.map((c) => (c === "tags" ? JSON.stringify(b[c]) : b[c])), id);
          return json(res, 200, { ok: true });
        }
        if (req.method === "DELETE" && id) {
          db.prepare(`DELETE FROM ${table} WHERE id=?`).run(id);
          return json(res, 200, { ok: true });
        }
      }
      if (p === "/api/upload" && req.method === "POST") {
        const { name, dataUrl } = await readBody(req);
        const m = /^data:(image\/(?:png|jpe?g|webp|svg\+xml|gif));base64,(.+)$/.exec(dataUrl || "");
        if (!m) return json(res, 400, { error: "Envie uma imagem (png, jpg, webp, svg ou gif)" });
        const safe = slugify(path.parse(name || "foto").name).slice(0, 40) || "foto";
        const ext = m[1] === "image/svg+xml" ? ".svg" : "." + m[1].split("/")[1].replace("jpeg", "jpg");
        const file = `${Date.now().toString(36)}-${safe}${ext}`;
        fs.writeFileSync(path.join(UPLOAD_DIR, file), Buffer.from(m[2], "base64"));
        return json(res, 200, { ok: true, path: `/assets/img/uploads/${file}` });
      }
      if (p === "/api/publish" && req.method === "POST") {
        const r = publish();
        return json(res, 200, { ok: true, ...r });
      }
      return json(res, 404, { error: "Rota não encontrada" });
    }

    /* --------------------------- Arquivos estáticos ----------------------- */
    if (p === "/admin" || p === "/admin/") {
      res.writeHead(200, { "Content-Type": MIME[".html"] });
      return res.end(fs.readFileSync(path.join(ROOT, "admin", "index.html")));
    }
    // nunca servir o banco, o servidor ou as fontes
    if (/^\/(data|server\.js|src)(\/|$)/.test(p)) { res.writeHead(404); return res.end("404"); }

    let file = path.normalize(path.join(ROOT, decodeURIComponent(p)));
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end("403"); }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    if (p === "/") file = path.join(ROOT, "index.html");
    if (!fs.existsSync(file)) {
      res.writeHead(404, { "Content-Type": MIME[".html"] });
      return res.end(fs.readFileSync(path.join(ROOT, "404.html")));
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(fs.readFileSync(file));
  } catch (e) {
    json(res, 500, { error: e.message });
  }
});

server.listen(PORT, () => {
  console.log(`\n  LA Software House — site + gerenciador`);
  console.log(`  · Site:   http://localhost:${PORT}/`);
  console.log(`  · Painel: http://localhost:${PORT}/admin/  (senha inicial: la-admin)\n`);
});
