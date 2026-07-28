/* ==========================================================================
   mascot.js — "LAo" 2.0, o mascote inteligente da LA Software House
   Movimento 2D (horizontal, vertical e diagonal) com estados:
   walk (chão) · fly (propulsor) · curious (aproxima do cursor parado)
   dodge (desvia de cursor rápido) · fall (cai se solto no ar) · drag (2D)
   Piscar, olhar o cursor, acenar, pular, comentar seções.
   SVG animado via ATRIBUTO transform (universal); posição via left/top.
   ========================================================================== */

const mascot = document.getElementById("mascot");
if (mascot) {
  const body = document.getElementById("mascot-body");
  const bubble = document.getElementById("mascot-bubble");
  const svg = mascot.querySelector(".mascot__svg");
  const eyes = [...svg.querySelectorAll(".mascot__eye")];
  const pupils = [...svg.querySelectorAll(".mascot__pupil")];
  const arm = svg.querySelector(".mascot__arm");
  const legs = [...svg.querySelectorAll(".mascot__leg")];

  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const noHover = window.matchMedia("(hover: none)").matches;

  /* ------------------------- Espaço / posição ---------------------------- */
  const PAD = 8;
  /* O chão sobe quando o aviso de cookies está aberto — senão o LAo anda por
     trás da barra. A altura vem da variável que o main.js publica, porque a
     barra cresce quando o texto quebra em mais linhas no celular. */
  const alturaCookies = () =>
    parseInt(getComputedStyle(document.body).getPropertyValue("--cookie-bar-h"), 10) || 0;
  const groundY = () =>
    window.innerHeight - mascot.offsetHeight - 12 -
    (document.body.classList.contains("has-cookie-bar") ? alturaCookies() : 0);
  const skyMinY = () => Math.min(90, groundY()); // não invade o header
  const clampX = (x) => Math.max(PAD, Math.min(window.innerWidth - mascot.offsetWidth - PAD, x));
  const clampY = (y) => Math.max(skyMinY(), Math.min(groundY(), y));

  // Posiciona no chão SEM transição (evita deslizar do topo no load)
  const pos = { x: 24, y: groundY() };
  mascot.style.transition = "none";
  mascot.style.left = `${pos.x}px`;
  mascot.style.top = `${pos.y}px`;
  void mascot.offsetWidth; // aplica antes de reativar a transição
  mascot.style.transition = "";

  let dragging = false;
  let busyUntil = 0; // evita decisões atropeladas
  let moveEndT, legTimer, bubbleTimer, legState = 0;

  const isAirborne = () => pos.y < groundY() - 16;
  const now = () => Date.now();

  /* ------------------------------ Fala ---------------------------------- */
  function say(text, ms = 4200) {
    bubble.textContent = text;
    bubble.classList.add("show");
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(() => bubble.classList.remove("show"), ms);
  }

  /* ----------------------------- Piscar --------------------------------- */
  function blink() {
    eyes.forEach((e) => e.setAttribute("transform", "scale(1 0.12)"));
    setTimeout(() => eyes.forEach((e) => e.removeAttribute("transform")), 150);
  }
  if (!reduce) setInterval(() => !document.hidden && blink(), 4200);

  /* ------------------------------ Acenar -------------------------------- */
  function wave() {
    if (reduce || !arm) return;
    [-38, -12, -38, -12, 0].forEach((a, i) =>
      setTimeout(() => arm.setAttribute("transform", `rotate(${a} 87 87)`), i * 140)
    );
  }

  /* ------------------------------ Pernas -------------------------------- */
  function startLegs() {
    if (reduce) return;
    clearInterval(legTimer);
    legTimer = setInterval(() => {
      legState ^= 1;
      legs.forEach((lg) => {
        const hx = lg.dataset.leg === "l" ? 53 : 66;
        const sign = lg.dataset.leg === "l" ? 1 : -1;
        lg.setAttribute("transform", `rotate(${(legState ? 13 : -13) * sign} ${hx} 119)`);
      });
    }, 170);
  }
  function stopLegs() {
    clearInterval(legTimer);
    legs.forEach((lg) => lg.removeAttribute("transform"));
  }
  function tuckLegs() {
    clearInterval(legTimer);
    legs.forEach((lg) => {
      const hx = lg.dataset.leg === "l" ? 53 : 66;
      const sign = lg.dataset.leg === "l" ? 1 : -1;
      lg.setAttribute("transform", `rotate(${8 * sign} ${hx} 119)`);
    });
  }

  /* ------------------- Motor de movimento 2D ----------------------------- */
  function moveTo(x, y, speed = 150) {
    if (dragging || reduce) return;
    x = clampX(x); y = clampY(y);
    const dist = Math.hypot(x - pos.x, y - pos.y);
    if (dist < 18) return;

    const dur = dist / speed; // velocidade constante
    const flying = y < groundY() - 16 || isAirborne();

    mascot.classList.toggle("face-left", x < pos.x);
    mascot.classList.toggle("is-flying", flying);
    mascot.classList.toggle("is-walking", !flying);
    if (flying) tuckLegs(); else startLegs();

    mascot.style.transitionDuration = `${dur}s, ${dur}s`;
    pos.x = x; pos.y = y;
    mascot.style.left = `${x}px`;
    mascot.style.top = `${y}px`;

    busyUntil = now() + dur * 1000;
    clearTimeout(moveEndT);
    moveEndT = setTimeout(settle, dur * 1000 + 80);
  }

  function settle() {
    mascot.classList.remove("is-walking");
    stopLegs();
    if (!isAirborne()) mascot.classList.remove("is-flying");
  }

  function land(speed = 260) {
    moveTo(pos.x, groundY(), speed);
  }

  /* ---------------------- Cérebro: decisões ------------------------------ */
  const mouse = { x: -9999, y: -9999, t: 0, vx: 0 };
  const idleLines = [
    "Tá afim de tirar uma ideia do papel? 💡",
    "15 anos de código nas costas 💪",
    "Posso te mostrar uns projetos 👀",
    "Deploy sem susto é comigo 🚀",
    "Bora automatizar o que te dá trabalho? ⚙️",
  ];
  const flyLines = ["Modo jetpack! 🛸", "Vendo tudo daqui de cima 👀", "Wheee! ✨"];

  function think() {
    if (dragging || reduce || document.hidden || now() < busyUntil) return;
    const r = Math.random();

    // cursor parado há 4s+ e longe → curiosidade: aproxima
    const cursorIdle = mouse.t && now() - mouse.t > 4000;
    const distToMouse = Math.hypot(mouse.x - pos.x, mouse.y - pos.y);
    if (!noHover && cursorIdle && distToMouse > 260 && r < 0.35) {
      moveTo(mouse.x - 60, mouse.y + 90, 190);
      setTimeout(() => say("Achei você! 🔍", 2600), 900);
      return;
    }

    if (isAirborne()) {
      // no ar: 60% pousa, 40% muda de ponto aéreo
      if (r < 0.6) land();
      else moveTo(PAD + Math.random() * (window.innerWidth - 140), skyMinY() + Math.random() * (groundY() - skyMinY()) * 0.6, 180);
      return;
    }

    if (r < 0.5) {
      // passeio no chão
      moveTo(PAD + Math.random() * (window.innerWidth - 140), groundY(), 140);
      if (Math.random() < 0.45) setTimeout(() => say(idleLines[Math.floor(Math.random() * idleLines.length)]), 1200);
    } else if (r < 0.78) {
      // decola em diagonal
      moveTo(PAD + Math.random() * (window.innerWidth - 140), skyMinY() + Math.random() * 160, 200);
      setTimeout(() => say(flyLines[Math.floor(Math.random() * flyLines.length)], 2600), 600);
    }
    // senão: fica parado observando
  }
  if (!reduce) setInterval(think, 9000);

  /* ---------------- Cursor: olhos, esquiva e rastreio -------------------- */
  if (!noHover) {
    let lastX = 0, lastT = 0, dodgeCooldown = 0;
    window.addEventListener("mousemove", (e) => {
      // velocidade aproximada do cursor
      const t = performance.now();
      mouse.vx = lastT ? Math.abs(e.clientX - lastX) / Math.max(1, t - lastT) : 0;
      lastX = e.clientX; lastT = t;
      mouse.x = e.clientX; mouse.y = e.clientY; mouse.t = now();

      // olhos seguem
      const r = mascot.getBoundingClientRect();
      const dx = Math.max(-2.4, Math.min(2.4, (e.clientX - (r.left + r.width / 2)) / 45));
      const dy = Math.max(-2.0, Math.min(2.0, (e.clientY - (r.top + r.height / 2)) / 45));
      pupils.forEach((p) => p.setAttribute("transform", `translate(${dx} ${dy})`));

      // esquiva: cursor rápido chegando perto
      const d = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
      if (!dragging && !reduce && d < 95 && mouse.vx > 0.9 && now() > dodgeCooldown) {
        dodgeCooldown = now() + 4000;
        const away = e.clientX < r.left + r.width / 2 ? 1 : -1;
        moveTo(pos.x + away * (140 + Math.random() * 80), pos.y - 60 - Math.random() * 60, 420);
        say(["Opa! 😅", "Quase! 🙈", "Ei, devagar! 😄"][Math.floor(Math.random() * 3)], 2000);
      }
    });
  }

  /* --------------------- Comenta cada seção ------------------------------ */
  if ("IntersectionObserver" in window) {
    let lastSaid = 0;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (en.isIntersecting && Date.now() - lastSaid > 1200) {
            const t = en.target.dataset.mascotSay;
            if (t) { say(t, 4800); lastSaid = Date.now(); }
          }
        });
      },
      { threshold: 0.25, rootMargin: "-10% 0px -25% 0px" }
    );
    document.querySelectorAll("[data-mascot-say]").forEach((s) => io.observe(s));
  }

  /* ------------------------ Arrastar 2D + clicar ------------------------- */
  let downX = 0, downY = 0, downT = 0, offX = 0, offY = 0, moved = false;
  body.addEventListener("pointerdown", (e) => {
    dragging = true; moved = false;
    downX = e.clientX; downY = e.clientY; downT = now();
    const r = mascot.getBoundingClientRect();
    offX = e.clientX - r.left; offY = e.clientY - r.top;
    mascot.classList.add("is-dragging");
    stopLegs();
    body.setPointerCapture?.(e.pointerId);
  });
  window.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > 5) moved = true;
    pos.x = clampX(e.clientX - offX);
    pos.y = Math.max(skyMinY(), Math.min(groundY(), e.clientY - offY));
    mascot.style.left = `${pos.x}px`;
    mascot.style.top = `${pos.y}px`;
  });
  window.addEventListener("pointerup", () => {
    if (!dragging) return;
    dragging = false;
    mascot.classList.remove("is-dragging");
    if (!moved && now() - downT < 400) { react(); return; }
    // solto no ar → cai de paraquedas até o chão
    if (isAirborne()) {
      say("Uau, que voo! 🪂", 2400);
      setTimeout(() => land(300), 350);
    }
  });

  function react() {
    const lines = ["Ei! 😄", "Beep boop 🔧", "Bora codar? 👨‍💻", "Cuidado, faço cócegas 🤖", "Partiu projeto? 🚀"];
    say(lines[Math.floor(Math.random() * lines.length)], 2600);
    wave();
    if (reduce) return;
    mascot.classList.remove("is-jumping");
    void mascot.offsetWidth;
    mascot.classList.add("is-jumping");
    setTimeout(() => mascot.classList.remove("is-jumping"), 600);
  }

  /* ----------------------------- Saudação -------------------------------- */
  setTimeout(() => {
    wave();
    say("Oi! Eu sou o LAo 🤖 Precisa de site, app ou sistema? É só me chamar!", 6000);
  }, 1400);

  window.addEventListener("resize", () => {
    pos.x = clampX(pos.x);
    pos.y = clampY(pos.y);
    mascot.style.left = `${pos.x}px`;
    mascot.style.top = `${pos.y}px`;
  });
}
