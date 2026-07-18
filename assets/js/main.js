/* ==========================================================================
   main.js — Interações (ponto de entrada) · LA Software House
   - Header no scroll · menu mobile acessível
   - Reveal on scroll (Intersection Observer)
   - Render de projetos + filtro por tipo
   - Formulário de contato (lead) mock
   ========================================================================== */

import { CONTACT_EMAIL } from "./config.js";

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
    // Mock: monta um e-mail com o briefing (o cliente ainda não tem CRM/WhatsApp).
    const subject = encodeURIComponent(`Novo projeto — ${d.nome} (${d.tipo})`);
    const body = encodeURIComponent(
      `Nome: ${d.nome}\nEmpresa: ${d.empresa || "-"}\nE-mail: ${d.email}\nTipo de projeto: ${d.tipo}\nOrçamento: ${d.orcamento || "-"}\n\nBriefing:\n${d.mensagem}`
    );
    window.location.href = `mailto:${CONTACT_EMAIL}?subject=${subject}&body=${body}`;
    toast("Abrindo seu e-mail para enviar o briefing…");
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
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
