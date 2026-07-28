/* ==========================================================================
   main.js — Interações (ponto de entrada) · LA Software House
   - Header no scroll · menu mobile acessível
   - Reveal on scroll (Intersection Observer)
   - Render de projetos + filtro por tipo
   - Formulário de contato (lead) mock
   ========================================================================== */

import { CONTACT_EMAIL, WHATSAPP_NUMBER, META_PIXEL_ID, LINKEDIN_PARTNER_ID } from "./config.js";

const $ = (s, c = document) => c.querySelector(s);
const $$ = (s, c = document) => [...c.querySelectorAll(s)];

/* ------------------------------ Header ---------------------------------- */
function initHeader() {
  const header = $(".site-header");
  if (!header) return;
  const onScroll = () => header.classList.toggle("is-scrolled", window.scrollY > 8);
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });
}

/* --------------------------- Menu mobile -------------------------------- */
function initMobileNav() {
  const toggle = $(".nav-toggle");
  const nav = $("#primary-nav");
  if (!toggle || !nav) return;
  const setOpen = (open) => {
    nav.classList.toggle("is-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    document.body.style.overflow = open ? "hidden" : "";
  };
  toggle.addEventListener("click", () => setOpen(toggle.getAttribute("aria-expanded") !== "true"));
  $$("a", nav).forEach((a) => a.addEventListener("click", () => setOpen(false)));
  window.addEventListener("keydown", (e) => e.key === "Escape" && setOpen(false));
}

/* --------------------------- Reveal ------------------------------------- */
function initReveal() {
  const els = $$("[data-reveal]");
  if (!els.length) return;
  if (!("IntersectionObserver" in window)) {
    els.forEach((el) => el.classList.add("is-visible"));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add("is-visible");
          io.unobserve(e.target);
        }
      });
    },
    { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
  );
  els.forEach((el) => io.observe(el));
}

/* ----------------------------- Toast ------------------------------------ */
let toastTimer;
function toast(msg) {
  let el = $(".toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    el.setAttribute("role", "status");
    document.body.appendChild(el);
  }
  el.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg><span>${msg}</span>`;
  requestAnimationFrame(() => el.classList.add("is-visible"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("is-visible"), 2800);
}

/* --------------------------- Projetos ----------------------------------- */
function projectCard(p) {
  const stack = p.stack.map((s) => `<span class="tag">${s}</span>`).join("");
  const href = `/projeto/${p.id}/`;
  return `
    <article class="project" data-reveal>
      <a class="project__media" href="${href}" aria-label="Ver case: ${p.title}">
        <span class="project__badge">${p.badge}</span>
        <img src="${p.image}" alt="${p.title}" loading="lazy" decoding="async">
      </a>
      <div class="project__body">
        <span class="project__cat">${p.categoryLabel} · ${p.year}</span>
        <h3 class="project__title"><a href="${href}">${p.title}</a></h3>
        <p class="project__text">${p.summary}</p>
        <div class="project__stack">${stack}</div>
        <a class="link-arrow" href="${href}" style="margin-top:0.8rem">Ver case completo
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a>
      </div>
    </article>`;
}

async function initProjects() {
  const grid = $("#projects-grid");
  if (!grid) return;
  let projects = [];
  try {
    const res = await fetch(new URL("../data/projects.json", import.meta.url));
    projects = await res.json();
  } catch (err) {
    console.error("Falha ao carregar projetos:", err);
    grid.innerHTML = `<p class="text-center" style="color:var(--text-muted)">Não foi possível carregar os projetos.</p>`;
    return;
  }

  const render = (list) => {
    grid.innerHTML = list.map(projectCard).join("");
    initReveal();
  };
  render(projects);

  $$(".filter-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      $$(".filter-chip").forEach((c) => c.setAttribute("aria-pressed", "false"));
      chip.setAttribute("aria-pressed", "true");
      const cat = chip.dataset.filter;
      render(cat === "all" ? projects : projects.filter((p) => p.category === cat));
    });
  });
}

/* ----------------------- Formulário de contato -------------------------- */
function initContactForm() {
  const form = $("#lead-form");
  if (!form) return;
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    const d = Object.fromEntries(new FormData(form).entries());
    const limpo = (v) => String(v || "").trim();

    /* O WhatsApp entende uma marcação própria: *negrito*, _itálico_ e
       ```monoespaçado```. Usar isso deixa o briefing legível no celular, em vez
       de um bloco de texto corrido — que era o que chegava antes.
       Campo vazio SOME da mensagem: melhor não ter a linha do que receber
       "Empresa: -", que ocupa espaço e não informa nada. */
    // cada bloco é um grupo de linhas; as vazias são descartadas DENTRO do
    // bloco, e os blocos são separados por uma linha em branco só
    const bloco = (...linhas) => linhas.filter(Boolean).join("\n");
    const quem = bloco(
      `*Nome:* ${limpo(d.nome)}`,
      limpo(d.empresa) ? `*Empresa:* ${limpo(d.empresa)}` : "",
      `*E-mail:* ${limpo(d.email)}`,
    );
    const projeto = bloco(
      `*Tipo de projeto:* ${limpo(d.tipo)}`,
      limpo(d.orcamento) ? `*Orçamento previsto:* ${limpo(d.orcamento)}` : "",
    );
    const quando = new Date().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

    const texto = [
      "*Novo briefing — luizaugust.me*",
      quem,
      projeto,
      bloco("*Sobre o projeto*", limpo(d.mensagem)),
      `_Enviado pelo site em ${quando}_`,
    ].filter(Boolean).join("\n\n");
    const url = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(texto)}`;

    /* No celular o window.open costuma ser barrado ou abre uma aba órfã que
       fica para trás depois de o app assumir. Navegar na própria aba leva
       direto ao WhatsApp e não deixa lixo aberto. No desktop, aba nova
       preserva o site — a pessoa volta e o formulário ainda está lá. */
    const noCelular = window.matchMedia("(hover: none)").matches;
    if (noCelular) { window.location.href = url; return; }

    const aba = window.open(url, "_blank", "noopener");
    if (!aba) { window.location.href = url; return; }   // bloqueador de pop-up
    toast("Abrindo o WhatsApp para enviar o briefing…");
    form.reset();
  });
}

/* -------------------- Spotlight que segue o cursor ---------------------- */
function initCursorGlow() {
  if (window.matchMedia("(hover: none)").matches) return;
  const glow = document.createElement("div");
  glow.className = "cursor-glow";
  document.body.appendChild(glow);
  window.addEventListener(
    "mousemove",
    (e) => {
      glow.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
      if (!glow.classList.contains("is-active")) glow.classList.add("is-active");
    },
    { passive: true }
  );
}

/* --------------------------- Botões magnéticos -------------------------- */
function initMagnetic() {
  if (window.matchMedia("(hover: none)").matches) return;
  $$("[data-magnetic]").forEach((el) => {
    const strength = 0.35;
    el.addEventListener("mousemove", (e) => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left - r.width / 2) * strength;
      const y = (e.clientY - r.top - r.height / 2) * strength;
      el.style.transform = `translate(${x}px, ${y}px)`;
    });
    el.addEventListener("mouseleave", () => (el.style.transform = ""));
  });
}

/* ==========================================================================
   CONSENTIMENTO DE COOKIES (LGPD)
   O site não grava cookie nenhum por conta própria — o único é o que guarda
   ESTA escolha. O aviso existe para controlar os scripts de medição (Meta
   Pixel, LinkedIn Insight): eles só são carregados depois do "Aceitar".
   É o consentimento PRÉVIO que a lei exige, não o aviso decorativo que carrega
   tudo antes de você clicar.
   ========================================================================== */
const CONSENT_COOKIE = "lash_consent";
const CONSENT_DIAS = 180;

const lerConsent = () =>
  (new RegExp(`(?:^|;\\s*)${CONSENT_COOKIE}=(aceito|essenciais)`).exec(document.cookie) || [])[1] || null;

function gravarConsent(valor) {
  const seguro = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${CONSENT_COOKIE}=${valor}; Max-Age=${CONSENT_DIAS * 86400}; Path=/; SameSite=Lax${seguro}`;
}

/* As IDs no config.js nascem como placeholder ("000000000000000"). Carregar um
   script com ID falso não mede nada e ainda faz o navegador buscar recurso de
   terceiro à toa — então só vale ID que tenha algum dígito diferente de zero. */
const idValido = (v) => !!v && /[1-9]/.test(String(v));

let medicaoCarregada = false;
function carregarMedicao() {
  if (medicaoCarregada) return;
  medicaoCarregada = true;
  const inline = (code) => {
    const s = document.createElement("script");
    s.textContent = code;
    document.head.appendChild(s);
  };

  if (idValido(META_PIXEL_ID)) {
    inline(`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
      n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
      n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
      t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script',
      'https://connect.facebook.net/en_US/fbevents.js');fbq('init','${META_PIXEL_ID}');fbq('track','PageView');`);
  }
  if (idValido(LINKEDIN_PARTNER_ID)) {
    inline(`_linkedin_partner_id="${LINKEDIN_PARTNER_ID}";window._linkedin_data_partner_ids=
      window._linkedin_data_partner_ids||[];window._linkedin_data_partner_ids.push(_linkedin_partner_id);
      (function(l){if(!l){window.lintrk=function(a,b){window.lintrk.q.push([a,b])};window.lintrk.q=[]}
      var s=document.getElementsByTagName("script")[0];var b=document.createElement("script");
      b.type="text/javascript";b.async=true;b.src="https://snap.licdn.com/li.lms-analytics/insight.min.js";
      s.parentNode.insertBefore(b,s);})(window.lintrk);`);
  }
}

function montarBannerCookies() {
  if ($(".cookie-bar")) return;
  const bar = document.createElement("div");
  bar.className = "cookie-bar";
  bar.setAttribute("role", "dialog");
  bar.setAttribute("aria-live", "polite");
  bar.setAttribute("aria-label", "Aviso sobre cookies");
  bar.innerHTML = `
    <div class="cookie-bar__text">
      <b>Cookies, sem enrolação. 🍪</b>
      <p>Este site não grava cookies para funcionar. Com a sua autorização, usamos cookies de
         medição — só para entender como as pessoas chegam até aqui. Nada além disso.
         <a href="/privacidade/">Ler a Política de Privacidade</a>.</p>
    </div>
    <div class="cookie-bar__acoes">
      <button type="button" class="btn btn--ghost btn--sm" data-consent="essenciais">Só os essenciais</button>
      <button type="button" class="btn btn--gradient btn--sm" data-consent="aceito">Aceitar</button>
    </div>`;
  document.body.appendChild(bar);

  /* O mascote LAo anda pelo rodapé em posição fixa e ficaria atrás do aviso.
     Publicamos a altura real da barra numa variável para o CSS subir o mascote
     exatamente o necessário — altura fixa quebraria quando o texto quebra em
     mais linhas no celular. */
  const marcarAltura = () => {
    document.body.classList.add("has-cookie-bar");
    document.body.style.setProperty("--cookie-bar-h", `${Math.ceil(bar.getBoundingClientRect().height)}px`);
  };
  marcarAltura();
  window.addEventListener("resize", marcarAltura);
  requestAnimationFrame(() => bar.classList.add("is-open"));

  bar.addEventListener("click", (e) => {
    const escolha = e.target.closest("[data-consent]")?.dataset.consent;
    if (!escolha) return;
    gravarConsent(escolha);
    if (escolha === "aceito") carregarMedicao();
    bar.classList.remove("is-open");
    document.body.classList.remove("has-cookie-bar");
    window.removeEventListener("resize", marcarAltura);
    setTimeout(() => bar.remove(), 350);
    toast(escolha === "aceito" ? "Preferência salva. Valeu!" : "Certo — só os essenciais.");
  });
}

/* Links legais no rodapé. "Privacidade" e "LGPD" já existem no HTML apontando
   para a página; aqui entra o botão de REVER a escolha, que a lei exige ser tão
   fácil quanto fazê-la. Injetado por JS para não repetir em cada template. */
function linksRodape() {
  const alvo = $(".footer__legal");
  if (!alvo || $(".cookie-prefs")) return;
  const b = document.createElement("button");
  b.type = "button";
  b.className = "cookie-prefs";
  b.textContent = "Preferências de cookies";
  b.addEventListener("click", () => {
    document.cookie = `${CONSENT_COOKIE}=; Max-Age=0; Path=/`;
    montarBannerCookies();
  });
  // antes do crédito "Feito em casa", que fecha a linha
  const credito = alvo.querySelector(".dev-credit");
  if (credito) alvo.insertBefore(b, credito); else alvo.appendChild(b);
}

function initConsent() {
  linksRodape();
  const escolha = lerConsent();
  if (!escolha) montarBannerCookies();
  else if (escolha === "aceito") carregarMedicao();
}

/* ------------------------------ Ano ------------------------------------- */
function initYear() {
  const el = $("#year");
  if (el) el.textContent = new Date().getFullYear();
}

/* -------------------------------- Boot ---------------------------------- */
function boot() {
  initHeader();
  initMobileNav();
  initProjects();
  initContactForm();
  initCursorGlow();
  initMagnetic();
  initReveal();
  initYear();
  initConsent();
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
