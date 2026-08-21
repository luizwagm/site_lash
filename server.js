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
const { abrirBanco, DRIVER_NOME, DRIVER_AVISO } = require("./db");
const { agendarBackups, rodarBackup, statusBackup } = require("./backup");
/* Gestão da agência (/restrito): leads, funil, prospecção por WhatsApp e IA.
   Módulo separado com banco próprio (data/gestao.db) — ver restrito.js. */
const { handleRestrito, registrarAcesso, iniciarServicos, SISTEMA_VERSION, GESTAO_DB } = require("./restrito");

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 5180;   // PORT por env permite subir cópia de teste
/* Versão do site + gerenciador.
   REGRA: feature nova sobe a 2ª casa (1.3.0, 1.4.0… pode passar de 10);
   correção de bug sobe a 3ª (1.4.1, 1.4.2…, também sem teto).
   A 1ª casa não muda. */
const APP_VERSION = "1.12.1";
const UPLOAD_DIR = path.join(ROOT, "assets", "img", "uploads");
fs.mkdirSync(path.join(ROOT, "data"), { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/* ------------------------------- Banco ---------------------------------- */
const db = abrirBanco(path.join(ROOT, "data", "site.db"));
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, category TEXT, categoryLabel TEXT,
    year TEXT, badge TEXT, client TEXT, summary TEXT, challenge TEXT, solution TEXT,
    results TEXT, features TEXT, stack TEXT, image TEXT, sort INTEGER DEFAULT 0,
    -- endereço do projeto no ar. Vazio = o botão "Visitar o site" simplesmente
    -- não é gerado no case (nem meio-link, nem botão morto).
    url TEXT
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
  CREATE TABLE IF NOT EXISTS process (
    id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, text TEXT, sort INTEGER DEFAULT 0
  );
`);

/* Migração leve para bancos criados antes destas colunas — o CREATE IF NOT
   EXISTS não altera tabela existente. Ignora o erro se a coluna já estiver lá. */
for (const alt of [
  "ALTER TABLE projects ADD COLUMN url TEXT",
]) { try { db.exec(alt); } catch { /* já existe */ } }

/* Senha do painel: scrypt com salt individual. Bancos antigos guardavam sha256
   puro — verifyPass aceita os dois e o login migra o legado para scrypt. */
const sha = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };
function hashPass(senha) {
  const salt = crypto.randomBytes(16);
  const dk = crypto.scryptSync(String(senha), salt, SCRYPT.keylen, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("hex")}$${dk.toString("hex")}`;
}
const bufEq = (a, b) => a.length === b.length && crypto.timingSafeEqual(a, b);

/* Hash descartável, só para GASTAR TEMPO. Quando não há senha configurada — ou
   quando o registro guardado está corrompido —, o verifyPass devolveria `false`
   na hora, em vez dos ~100ms que um scrypt custa. Essa diferença de tempo é
   observável de fora e conta ao atacante em que estado o painel está antes de
   ele tentar qualquer senha. Comparar contra a isca iguala o relógio. */
let HASH_ISCA = null;
function verifyPass(senha, guardado) {
  // sem senha configurada: ainda assim paga o custo de um scrypt, e devolve não
  if (!guardado) {
    if (!HASH_ISCA) HASH_ISCA = hashPass(crypto.randomBytes(16).toString("hex"));
    verifyPass(senha, HASH_ISCA);
    return false;
  }
  if (guardado.startsWith("scrypt$")) {
    const [, N, r, p, saltHex, dkHex] = guardado.split("$");
    const dk = crypto.scryptSync(String(senha), Buffer.from(saltHex, "hex"), dkHex.length / 2, { N: +N, r: +r, p: +p });
    return bufEq(Buffer.from(dkHex, "hex"), dk);
  }
  return /^[a-f0-9]{64}$/.test(guardado) && bufEq(Buffer.from(sha(senha), "hex"), Buffer.from(guardado, "hex"));
}
const getSetting = (k) => db.prepare("SELECT value FROM settings WHERE key=?").get(k)?.value;
const setSetting = (k, v) =>
  db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(k, String(v));

/* ------------------------------ Seed inicial ----------------------------- */
function seed() {
  if (getSetting("hero_title")) return;
  const S = {
    admin_password_hash: hashPass("la-admin"),
    hero_badge: `<span class="dot" aria-hidden="true"></span> Disponível para novos projetos · <b>2026</b>`,
    hero_title: `Ideias viram <span class="gradient-text">software</span><br>que gera resultado.`,
    hero_lead: `Somos a <b>LA Software House</b>. Há 15 anos transformamos briefings em sites, portais, aplicativos e plataformas SaaS sob medida — do primeiro rascunho ao deploy em produção.`,
    stats: JSON.stringify([
      { num: "15+", label: "anos de mercado" },
      { num: "+120", label: "projetos entregues" },
      { num: "BR+", label: "Brasil & exterior" },
      { num: "100", label: "/100 em performance" },
    ]),
    marquee_items: JSON.stringify(["React", "Next.js", "Node", "TypeScript", "React Native", "Laravel", "PostgreSQL", "AWS", "Docker"]),
    serv_eyebrow: "O que fazemos",
    serv_title: "Software sob medida, de ponta a ponta.",
    serv_lead: "Não empurramos template. Cada projeto é arquitetado para o seu objetivo, com código próprio, performance e escala.",
    serv_cta_title: "Não sabe por onde começar?",
    serv_cta_text: "A gente ajuda a definir o escopo, o melhor caminho técnico e o orçamento.",
    serv_cta_label: "Conversar com um especialista",
    proj_eyebrow: "Portfólio",
    proj_title: "Projetos que foram do brief ao deploy.",
    proc_eyebrow: "Como trabalhamos",
    proc_title: "Um processo previsível, sem surpresas.",
    about_eyebrow: "Por que a LA",
    about_bignum: "15",
    about_title: "15 anos transformando código em resultado.",
    about_lead: "Tempo de mercado não se improvisa. Nesses 15 anos aprendemos a entregar software que funciona, escala e não vira dor de cabeça depois.",
    about_bullets: JSON.stringify([
      "Código próprio e documentado — sem amarras de no-code",
      "Performance, segurança e SEO como padrão, não como extra",
      "Do brief ao deploy com uma equipe só — sem terceirizar o núcleo",
      "Atendimento para Brasil e exterior, em português e inglês",
    ]),
    dep_eyebrow: "Confiança",
    dep_title: "Quem contratou, recomenda.",
    faq_eyebrow: "Perguntas frequentes",
    faq_title: "O que todo mundo pergunta antes de começar.",
    contact_title: `Vamos construir o seu <span class="gradient-text">próximo produto?</span>`,
    contact_lead: "Conte o que você precisa. Respondemos em até 24h úteis com os próximos passos — sem compromisso.",
    contact_email: "contato@luizaugust.me",
    contact_response: "Até 24h úteis",
    contact_area: "Brasil & exterior · PT / EN",
    whatsapp: "5581971010607",
    footer_tagline: "Software house com 15 anos de mercado. Sites, portais, aplicativos e SaaS sob medida — do brief ao deploy.",
  };
  for (const [k, v] of Object.entries(S)) setSetting(k, v);

  const steps = [
    ["Descoberta", "Entendemos o objetivo, o público e as regras de negócio. Escopo e orçamento claros."],
    ["Arquitetura & Design", "Definimos a stack, a UX e o design. Você aprova antes de qualquer linha de código."],
    ["Desenvolvimento", "Entregas em ciclos curtos, com ambiente de teste e você acompanhando a evolução."],
    ["Deploy & Evolução", "Publicação, monitoramento e suporte contínuo. O produto vivo e sempre melhorando."],
  ];
  steps.forEach((s, i) => db.prepare("INSERT INTO process(title,text,sort) VALUES(?,?,?)").run(s[0], s[1], i));

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
// migração leve: garante chaves novas em bancos já existentes (não sobrescreve o que existe)
const NOVOS_DEFAULTS = {
  cnpj: "00.000.000/0001-00",
  whatsapp: "5581971010607",
  marquee_items: JSON.stringify(["React", "Next.js", "Node", "TypeScript", "React Native", "Laravel", "PostgreSQL", "AWS", "Docker"]),
  serv_eyebrow: "O que fazemos",
  serv_title: "Software sob medida, de ponta a ponta.",
  serv_lead: "Não empurramos template. Cada projeto é arquitetado para o seu objetivo, com código próprio, performance e escala.",
  serv_cta_title: "Não sabe por onde começar?",
  serv_cta_text: "A gente ajuda a definir o escopo, o melhor caminho técnico e o orçamento.",
  serv_cta_label: "Conversar com um especialista",
  proj_eyebrow: "Portfólio",
  proj_title: "Projetos que foram do brief ao deploy.",
  proc_eyebrow: "Como trabalhamos",
  proc_title: "Um processo previsível, sem surpresas.",
  about_eyebrow: "Por que a LA",
  about_bignum: "15",
  dep_eyebrow: "Confiança",
  dep_title: "Quem contratou, recomenda.",
  faq_eyebrow: "Perguntas frequentes",
  faq_title: "O que todo mundo pergunta antes de começar.",
  contact_title: `Vamos construir o seu <span class="gradient-text">próximo produto?</span>`,
  contact_lead: "Conte o que você precisa. Respondemos em até 24h úteis com os próximos passos — sem compromisso.",
};
for (const [k, v] of Object.entries(NOVOS_DEFAULTS)) if (getSetting(k) === undefined) setSetting(k, v);
// processo: se a tabela estiver vazia, semeia as 4 etapas padrão
if (db.prepare("SELECT COUNT(*) c FROM process").get().c === 0) {
  [["Descoberta", "Entendemos o objetivo, o público e as regras de negócio. Escopo e orçamento claros."],
   ["Arquitetura & Design", "Definimos a stack, a UX e o design. Você aprova antes de qualquer linha de código."],
   ["Desenvolvimento", "Entregas em ciclos curtos, com ambiente de teste e você acompanhando a evolução."],
   ["Deploy & Evolução", "Publicação, monitoramento e suporte contínuo. O produto vivo e sempre melhorando."]]
    .forEach((s, i) => db.prepare("INSERT INTO process(title,text,sort) VALUES(?,?,?)").run(s[0], s[1], i));
}

/* ------------------------------- Sessões --------------------------------- */
const SESSION_HORAS = 12;
const sessions = new Map();   // sid -> timestamp da última atividade
const newToken = () => crypto.randomBytes(24).toString("hex");
const sidDe = (req) => (/(?:^|;\s*)sid=([a-f0-9]+)/.exec(req.headers.cookie || "") || [])[1];
function authed(req) {
  const sid = sidDe(req); if (!sid) return false;
  const ts = sessions.get(sid); if (!ts) return false;
  if (Date.now() - ts > SESSION_HORAS * 3600e3) { sessions.delete(sid); return false; }
  sessions.set(sid, Date.now());   // renova por atividade
  return true;
}
setInterval(() => { const lim = Date.now() - SESSION_HORAS * 3600e3; for (const [k, v] of sessions) if (v < lim) sessions.delete(k); }, 30 * 60e3).unref();
/* Path=/ e não /admin porque a API mora em /api — os dois precisam do cookie.
   (No BemEstar dá para isolar em /restrito porque lá a API fica sob o mesmo
   caminho.) O HttpOnly impede leitura por JavaScript, o SameSite=Lax barra o
   envio em requisição vinda de outro site, e o Secure só entra sob HTTPS —
   sem ele o cookie viajaria em claro num acesso HTTP. */
const cookieSid = (t, req) => `sid=${t}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_HORAS * 3600}` +
  (String(req.headers["x-forwarded-proto"]) === "https" ? "; Secure" : "");

/* Trava de força bruta por IP: 5 tentativas / 15 min */
const TENT_MAX = 5, BLOQ_MIN = 15, tentativas = new Map();
const clientIp = (req) => String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || "";
function bloqueado(ip) { const t = tentativas.get(ip); if (!t) return false; if (Date.now() - t.ts > BLOQ_MIN * 60e3) { tentativas.delete(ip); return false; } return t.n >= TENT_MAX; }
function erroLogin(ip) { const t = tentativas.get(ip) || { n: 0, ts: Date.now() }; t.n++; t.ts = Date.now(); tentativas.set(ip, t); }
/* CSP do painel. `base-uri 'none'` impede que um <base> injetado reescreva o
   destino de TODOS os links e formulários da página; `object-src 'none'` corta
   plugins legados; `frame-ancestors 'none'` proíbe embutir o painel num iframe
   — é a defesa contra clickjacking, e vale mais que o X-Frame-Options porque
   não depende de o navegador ainda respeitar aquele cabeçalho antigo. */
const CSP_PAINEL = "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; " +
  "img-src 'self' data: https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
  "font-src 'self' https://fonts.gstatic.com; script-src 'self' 'unsafe-inline'; " +
  "connect-src 'self'; form-action 'self'";

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
  const steps = db.prepare("SELECT * FROM process ORDER BY sort,id").all();

  const stats = JSON.parse(S.stats || "[]")
    .map((s) => `<div class="stat"><dd class="stat__num gradient-text">${esc(s.num)}</dd><dt class="stat__label">${esc(s.label)}</dt></div>`)
    .join("\n            ");

  // marquee de tecnologias — a linha é duplicada para o loop contínuo do CSS
  const mq = JSON.parse(S.marquee_items || "[]");
  const mqOne = mq.map((t) => `<span class="marquee__item">${esc(t)}</span>`).join("");
  const marqueeHtml = `<div class="marquee__row">\n        ${mqOne}\n        ${mqOne}\n      </div>`;

  const stepsHtml = steps.map((s, i) => {
    const delay = i % 4 ? ` data-reveal-delay="${i % 4}"` : "";
    return `<div class="step" data-reveal${delay}><div class="step__num"></div><h3 class="step__title">${esc(s.title)}</h3><p class="step__text">${esc(s.text)}</p></div>`;
  }).join("\n          ");

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
            <h3 class="service__title">${esc(S.serv_cta_title || "")}</h3>
            <p class="service__text">${esc(S.serv_cta_text || "")}</p>
            <a class="link-arrow mt-xl" href="#contato">${esc(S.serv_cta_label || "")}
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

  return { S, stats, marqueeHtml, servicesHtml, stepsHtml, bullets, testimonialsHtml, faqHtml, contactSide, footerContact, jsonldHtml };
}

function setMarker(html, key, content) {
  const re = new RegExp(`(<!--#${key}-->)[\\s\\S]*?(<!--\\/${key}-->)`);
  if (!re.test(html)) throw new Error(`Marcador ${key} não encontrado no index.html`);
  // replacement em função: evita que "$" no conteúdo seja interpretado ($$, $1…)
  return html.replace(re, (_m, open, close) => `${open}\n${content}\n${close}`);
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
  html = setMarker(html, "MARQUEE", "      " + r.marqueeHtml);
  html = setMarker(html, "SERV_EYEBROW", r.S.serv_eyebrow);
  html = setMarker(html, "SERV_TITLE", r.S.serv_title);
  html = setMarker(html, "SERV_LEAD", r.S.serv_lead);
  html = setMarker(html, "SERVICES", "          " + r.servicesHtml);
  html = setMarker(html, "PROJ_EYEBROW", r.S.proj_eyebrow);
  html = setMarker(html, "PROJ_TITLE", r.S.proj_title);
  html = setMarker(html, "PROC_EYEBROW", r.S.proc_eyebrow);
  html = setMarker(html, "PROC_TITLE", r.S.proc_title);
  html = setMarker(html, "PROC_STEPS", "          " + r.stepsHtml);
  html = setMarker(html, "ABOUT_EYEBROW", r.S.about_eyebrow);
  html = setMarker(html, "ABOUT_BIGNUM", r.S.about_bignum);
  html = setMarker(html, "ABOUT_TITLE", r.S.about_title);
  html = setMarker(html, "ABOUT_LEAD", r.S.about_lead);
  html = setMarker(html, "ABOUT_BULLETS", "            " + r.bullets);
  html = setMarker(html, "DEP_EYEBROW", r.S.dep_eyebrow);
  html = setMarker(html, "DEP_TITLE", r.S.dep_title);
  html = setMarker(html, "TESTIMONIALS", "          " + r.testimonialsHtml);
  html = setMarker(html, "FAQ_EYEBROW", r.S.faq_eyebrow);
  html = setMarker(html, "FAQ_TITLE", r.S.faq_title);
  html = setMarker(html, "FAQ_ITEMS", "          " + r.faqHtml);
  html = setMarker(html, "CONTACT_TITLE", r.S.contact_title);
  html = setMarker(html, "CONTACT_LEAD", r.S.contact_lead);
  html = setMarker(html, "CONTACT_SIDE", "            " + r.contactSide);
  html = setMarker(html, "FOOTER_TAGLINE", r.S.footer_tagline);
  html = setMarker(html, "FOOTER_CONTACT", "            " + r.footerContact);
  html = setMarker(html, "CNPJ", r.S.cnpj);
  fs.writeFileSync(idx, html);

  // projects.json
  const projects = db.prepare("SELECT * FROM projects ORDER BY sort,id").all().map((p) => ({
    id: p.id, title: p.title, category: p.category, categoryLabel: p.categoryLabel, year: p.year,
    badge: p.badge, client: p.client, summary: p.summary, challenge: p.challenge, solution: p.solution,
    results: JSON.parse(p.results || "[]"), features: JSON.parse(p.features || "[]"),
    stack: JSON.parse(p.stack || "[]"), image: p.image,
    // vazio vira "" e não string "null"/"undefined": o build testa por vazio
    url: p.url || "",
  }));
  fs.writeFileSync(path.join(ROOT, "assets/data/projects.json"), JSON.stringify(projects, null, 2));

  // config.js (e-mail de contato + WhatsApp que recebe os briefings)
  const cfgPath = path.join(ROOT, "assets/js/config.js");
  let cfg = fs.readFileSync(cfgPath, "utf8");
  cfg = cfg.replace(/export const CONTACT_EMAIL = "[^"]*";/, `export const CONTACT_EMAIL = "${r.S.contact_email}";`);
  cfg = cfg.replace(/export const WHATSAPP_NUMBER = "[^"]*";/, `export const WHATSAPP_NUMBER = "${(r.S.whatsapp || "").replace(/\D/g, "")}";`);
  fs.writeFileSync(cfgPath, cfg);

  // cases + sitemap
  const out = execSync("node build.js", { cwd: ROOT }).toString();
  return { pages: projects.length, buildLog: out.trim().split("\n").pop() };
}

/* ------------------------------ Utilidades HTTP -------------------------- */
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".webmanifest": "application/manifest+json", ".xml": "application/xml", ".txt": "text/plain", ".ico": "image/x-icon" };

/* Toda resposta da API é privada: `no-store` impede que um proxy no caminho ou
   o próprio navegador guardem conteúdo do painel em cache (e o entreguem depois
   a outra pessoa no mesmo computador); `noindex` mantém a API fora de buscador. */
const json = (res, code, obj) => {
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, nofollow",
  });
  res.end(JSON.stringify(obj));
};
const readBody = (req) => new Promise((resolve, reject) => {
  let data = ""; let size = 0;
  req.on("data", (c) => { size += c.length; if (size > 25e6) { reject(new Error("payload muito grande")); req.destroy(); } data += c; });
  req.on("end", () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error("JSON inválido")); } });
});

const TABLES = {
  services: ["title", "text", "tags", "sort"],
  testimonials: ["text", "name", "role", "initials", "sort"],
  faq: ["question", "answer", "sort"],
  process: ["title", "text", "sort"],
};
const SETTING_KEYS = ["hero_badge", "hero_title", "hero_lead", "stats",
  "marquee_items",
  "serv_eyebrow", "serv_title", "serv_lead", "serv_cta_title", "serv_cta_text", "serv_cta_label",
  "proj_eyebrow", "proj_title",
  "proc_eyebrow", "proc_title",
  "about_eyebrow", "about_bignum", "about_title", "about_lead", "about_bullets",
  "dep_eyebrow", "dep_title",
  "faq_eyebrow", "faq_title",
  "contact_title", "contact_lead", "contact_email", "contact_response", "contact_area", "whatsapp",
  "footer_tagline", "cnpj"];
const PROJECT_COLS = ["id", "title", "category", "categoryLabel", "year", "badge", "client", "summary", "challenge",
  "solution", "results", "features", "stack", "image", "sort", "url"];

const slugify = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/* ==========================================================================
   ENDEREÇO DO PROJETO
   Aceita só http e https. Sem isso, um `javascript:...` gravado aqui viraria
   um link armadilhado em cima do href do case. Quem digita "empresa.com.br"
   (o mais comum) recebe o https na frente em vez de um link quebrado.
   Devolve "" quando não dá para aproveitar — e "" significa "não mostrar".
   ========================================================================== */
function urlSegura(v) {
  const s = String(v || "").trim();
  if (!s) return "";
  const comEsquema = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : "https://" + s;
  try {
    const u = new URL(comEsquema);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    return u.href;
  } catch { return ""; }
}

/* ==========================================================================
   HTML PERMITIDO EM "DESAFIO" E "SOLUÇÃO"
   Estes dois campos aceitam marcação para o texto respirar (parágrafos,
   negrito, listas, links). O que NÃO passa é o que executa código:
   <script>/<iframe>/<object>/<embed>/<form>, atributos on*=... e hrefs
   `javascript:`.

   Por que filtrar se só o dono edita: o conteúdo é publicado em HTML estático
   para todo visitante. Se a senha do painel vazar — e o hash antigo deste
   projeto está no histórico público do GitHub —, um <script> gravado aqui
   viraria código rodando no navegador de quem visita o site, com a URL do
   luizaugust.me na barra. Filtrar custa nada e fecha essa porta.
   ========================================================================== */
function htmlSeguro(v) {
  let s = String(v || "");
  // elementos que executam ou embutem outra página, com ou sem fechamento
  s = s.replace(/<\s*(script|iframe|object|embed|form|link|meta|base|style)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, "");
  s = s.replace(/<\s*\/?\s*(script|iframe|object|embed|form|link|meta|base|style)\b[^>]*>/gi, "");
  // manipuladores inline: onclick=, onerror=, onload=…
  s = s.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  // href/src apontando para pseudo-protocolos executáveis
  s = s.replace(/\s(href|src|xlink:href)\s*=\s*("|')?\s*(javascript|data|vbscript)\s*:[^"'>\s]*("|')?/gi, "");
  return s.trim();
}

/* -------------------------------- Servidor ------------------------------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;

  // cabeçalhos de segurança em toda resposta
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  if (String(req.headers["x-forwarded-proto"]) === "https")
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");

  try {
    /* ----------------------------- /restrito ------------------------------ */
    /* ANTES dos estáticos, de propósito: sem esta interceptação, o
       restrito/app.html seria servido como arquivo comum, sem login. */
    if (handleRestrito(req, res, p)) return;

    /* ------------------------------ API ---------------------------------- */
    if (p.startsWith("/api/")) {
      if (p === "/api/login" && req.method === "POST") {
        const ip = clientIp(req);
        if (bloqueado(ip)) return json(res, 429, { error: "Muitas tentativas. Tente novamente em 15 minutos." });
        const { password } = await readBody(req);
        const guardado = getSetting("admin_password_hash");
        if (!verifyPass(password, guardado)) { erroLogin(ip); return json(res, 401, { error: "Senha incorreta" }); }
        tentativas.delete(ip);
        if (!String(guardado).startsWith("scrypt$")) setSetting("admin_password_hash", hashPass(password)); // migra sha256→scrypt
        const token = newToken();
        sessions.set(token, Date.now());
        res.setHeader("Set-Cookie", cookieSid(token, req));
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
        if (!verifyPass(current, getSetting("admin_password_hash"))) return json(res, 400, { error: "Senha atual incorreta" });
        /* Mínimo de 8, como no /restrito da BemEstarClinic. E a senha padrão
           fica proibida: a deste projeto já vazou no histórico do repositório,
           então "trocar" para ela de novo não seria trocar nada. */
        if (!next || String(next).length < 8) return json(res, 400, { error: "A nova senha precisa de 8 caracteres ou mais." });
        if (String(next).trim().toLowerCase() === "la-admin")
          return json(res, 400, { error: "Essa é a senha padrão e já é pública. Escolha outra." });
        setSetting("admin_password_hash", hashPass(next));
        const atual = sidDe(req);   // troca de senha derruba as outras sessões
        for (const k of [...sessions.keys()]) if (k !== atual) sessions.delete(k);
        return json(res, 200, { ok: true });
      }
      if (p === "/api/content" && req.method === "GET") {
        const S = {}; for (const k of SETTING_KEYS) S[k] = getSetting(k) || "";
        return json(res, 200, {
          settings: S,
          services: db.prepare("SELECT * FROM services ORDER BY sort,id").all(),
          testimonials: db.prepare("SELECT * FROM testimonials ORDER BY sort,id").all(),
          faq: db.prepare("SELECT * FROM faq ORDER BY sort,id").all(),
          process: db.prepare("SELECT * FROM process ORDER BY sort,id").all(),
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
        db.prepare("INSERT INTO projects(id,title,category,categoryLabel,year,badge,client,summary,challenge,solution,results,features,stack,image,sort,url) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
          .run(id, b.title || "", b.category || "sites", b.categoryLabel || "", b.year || "", b.badge || "", b.client || "",
            b.summary || "", htmlSeguro(b.challenge), htmlSeguro(b.solution), JSON.stringify(b.results || []),
            JSON.stringify(b.features || []), JSON.stringify(b.stack || []), b.image || "", b.sort ?? 99,
            urlSegura(b.url));
        return json(res, 200, { ok: true, id });
      }
      const pm = p.match(/^\/api\/projects\/([a-z0-9-]+)$/);
      if (pm && req.method === "PUT") {
        const b = await readBody(req);
        const sets = []; const vals = [];
        for (const c of PROJECT_COLS) if (c !== "id" && c in b) {
          sets.push(`${c}=?`);
          vals.push(
            ["results", "features", "stack"].includes(c) ? JSON.stringify(b[c])
            : c === "url" ? urlSegura(b[c])
            // desafio e solução aceitam marcação, menos o que executa código
            : ["challenge", "solution"].includes(c) ? htmlSeguro(b[c])
            : b[c]);
        }
        if (sets.length) db.prepare(`UPDATE projects SET ${sets.join(",")} WHERE id=?`).run(...vals, pm[1]);
        return json(res, 200, { ok: true });
      }
      if (pm && req.method === "DELETE") {
        db.prepare("DELETE FROM projects WHERE id=?").run(pm[1]);
        return json(res, 200, { ok: true });
      }
      const tm = p.match(/^\/api\/(services|testimonials|faq|process)(?:\/(\d+))?$/);
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
        const m = /^data:(image\/(?:png|jpe?g|webp|gif));base64,(.+)$/.exec(dataUrl || "");   // SVG fora — evita XSS armazenado
        if (!m) return json(res, 400, { error: "Envie uma imagem (png, jpg, webp ou gif)" });
        const safe = slugify(path.parse(name || "foto").name).slice(0, 40) || "foto";
        const ext = "." + m[1].split("/")[1].replace("jpeg", "jpg");
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
      res.writeHead(200, {
        "Content-Type": MIME[".html"],
        "Content-Security-Policy": CSP_PAINEL,
        "Cache-Control": "no-store",
        // painel não entra em buscador: o robots.txt pede, isto obriga
        "X-Robots-Tag": "noindex, nofollow",
      });
      return res.end(fs.readFileSync(path.join(ROOT, "admin", "index.html")));
    }
    /* Nunca servir dados sensíveis, código ou artefatos de deploy.
       A regra do JavaScript é por LOCAL, não por nome: só `/assets/js/` é
       público. Antes a lista citava `server.js` nominalmente e, ao surgirem
       db.js, backup.js e build.js, os três passaram a ser baixáveis — um
       bloqueio que precisa ser lembrado a cada arquivo novo já nasce furado. */
    /* `restrito` na lista é cinto e suspensório: o handleRestrito já
       intercepta tudo que começa com /restrito antes de chegar aqui. */
    const dirProibido = /^\/(data|src|node_modules|nginx|backups|restrito)(\/|$)/.test(p);
    const ocultoProibido = /(^|\/)\.[^/]/.test(p);                       // .git, .env, dotfiles
    const extProibida = /\.(db|sqlite3?|sh|bash|service|env|conf|ini|sql|log|bak|old|orig|swp|tmp|pem|key|crt|lock|md)$/i.test(p);
    const jsDeServidor = /\.js$/i.test(p) && !/^\/assets\/js\//i.test(p); // JS público mora em /assets/js/
    const jsonDeServidor = /\.json$/i.test(p) && !/^\/assets\//i.test(p); // package.json, manifests internos
    if (dirProibido || ocultoProibido || extProibida || jsDeServidor || jsonDeServidor) {
      res.writeHead(404); return res.end("404");
    }

    let file = path.normalize(path.join(ROOT, decodeURIComponent(p)));
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end("403"); }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    if (p === "/") file = path.join(ROOT, "index.html");
    if (!fs.existsSync(file)) {
      res.writeHead(404, { "Content-Type": MIME[".html"] });
      return res.end(fs.readFileSync(path.join(ROOT, "404.html")));
    }
    const tipo = MIME[path.extname(file)] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": tipo });
    res.end(fs.readFileSync(file));
    /* Contador de acessos do site: só PÁGINA (HTML) conta, não CSS/imagem —
       senão uma visita vira trinta. Vai para o gestao.db, que o /restrito lê. */
    if (req.method === "GET" && tipo === MIME[".html"]) registrarAcesso(req, p);
  } catch (e) {
    /* Erro do CLIENTE (corpo malformado, payload gigante) é 400 e pode dizer o
       motivo. Qualquer outra falha é 500 GENÉRICO: a mensagem de exceção
       costuma revelar caminho de arquivo e estrutura interna, e isso é mapa
       para quem estiver sondando. O detalhe vai só para o log do servidor. */
    const doCliente = /JSON inválido|payload muito grande/i.test(e.message || "");
    if (doCliente) return json(res, 400, { error: e.message });
    console.error(`  ✖ erro em ${req.url}:`, e.message);
    json(res, 500, { error: "Erro interno" });
  }
});

/* CLI: `node server.js --publicar` regenera o site sem abrir o painel (usado no deploy) */
if (process.argv.includes("--publicar")) {
  const r = publish();
  console.log("· Site publicado:", JSON.stringify(r));
  process.exit(0);
}

/* Configuração do backup — usada tanto pela rotina automática quanto pelo
   `node server.js --backup`, para que as duas gravem no mesmo lugar. */
const BACKUP_CFG = {
  destino: path.join(ROOT, "backups"),
  // gestao.db é a carteira de leads/conversas do /restrito — mesmo ciclo diário
  bancos: [path.join(ROOT, "data", "site.db"), GESTAO_DB],
  intervaloHoras: Number(process.env.BACKUP_HORAS) || 24,
  manter: Number(process.env.BACKUP_MANTER) || 30,
};
// `--backup` força uma cópia agora (o deploy.sh chama antes de mexer em algo)
if (process.argv.includes("--backup")) {
  process.exit(rodarBackup(BACKUP_CFG, "manual").length ? 0 : 1);
}
// `--backup-status` mostra a situação (usado pelo verificar.sh)
if (process.argv.includes("--backup-status")) {
  console.log(JSON.stringify(statusBackup(BACKUP_CFG), null, 2));
  process.exit(0);
}

server.listen(PORT, process.env.HOST || "127.0.0.1", () => {
  console.log(`\n  LA Software House — site + gerenciador v${APP_VERSION}`);
  console.log(`  · Site:    http://localhost:${PORT}/`);
  console.log(`  · Painel:  http://localhost:${PORT}/admin/`);
  console.log(`  · Gestão:  http://localhost:${PORT}/restrito/  (v${SISTEMA_VERSION} — worker: node prospector.js)`);
  console.log(`  · Banco:  ${DRIVER_NOME}${DRIVER_AVISO ? " ⚠ " + DRIVER_AVISO : ""}`);
  agendarBackups(BACKUP_CFG);
  iniciarServicos();   // geolocalização dos acessos + retenção (só neste processo)

  /* Testa a escrita no boot. Sem isto, um banco somente-leitura só aparece
     quando o cliente tenta salvar algo pelo painel e nada acontece. */
  try {
    setSetting("_teste_escrita", String(Date.now()));
    db.prepare("DELETE FROM settings WHERE key='_teste_escrita'").run();
  } catch (e) {
    const usuario = (() => { try { return require("node:os").userInfo().username; } catch { return "root"; } })();
    console.error(`  ✖ BANCO SEM PERMISSÃO DE ESCRITA: ${e.message}`);
    console.error(`    O painel não vai salvar nada. Corrija: sudo chown -R ${usuario}: "${ROOT}/data" "${ROOT}/assets/img/uploads"`);
  }
  // avisa sem imprimir a senha — este log vai parar no journalctl
  if (verifyPass("la-admin", getSetting("admin_password_hash")))
    console.log("  ⚠ A senha do painel ainda é a padrão. Troque em Painel → Senha antes de divulgar o site.\n");
  else console.log("");
});
