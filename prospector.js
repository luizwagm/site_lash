/* ==========================================================================
   prospector.js — worker do WhatsApp da prospecção  (processo SEPARADO)

   Rodar:  node prospector.js            (ou:  npm run prospector)
           node prospector.js --seco     (canal seco: testa o motor sem enviar)

   Por que um processo à parte: o Baileys mantém uma conexão viva com o
   WhatsApp e reconecta sozinho; se morasse dentro do server.js, uma queda
   do socket derrubaria o site junto. O banco (data/gestao.db, WAL) é o
   ÚNICO canal entre os dois processos — o painel agenda e configura, este
   worker envia e escuta.

   O WhatsApp usa a biblioteca Baileys (não-oficial). Ela é dependência
   OPCIONAL: sem ela instalada, o worker explica e sai — e o modo --seco
   continua funcionando para provar o motor.

   Duas decisões herdadas do bot de confecção e mantidas:
   · a conexão pode reconectar N vezes, mas o LAÇO DE ENVIO roda uma vez só
     — dois laços concorrentes furariam o intervalo e virariam rajada;
   · respostas passam por DEBOUNCE (6s) + FILA SERIAL — o lojista que manda
     "oi" / "vocês fazem site?" / "quanto custa?" em 3 mensagens picadas
     recebe UMA resposta, e nada processa em paralelo.
   ========================================================================== */

const fs = require("node:fs");
const path = require("node:path");
const { motor, SISTEMA_VERSION } = require("./restrito");

const SECO = process.argv.includes("--seco");
const SESSAO_DIR = process.env.WA_SESSION_DIR || path.join(__dirname, "data", "wa-session");

const DEBOUNCE_MS = 6_000;
const OCIOSO_MS = 60_000;
const ERRO_MS = 30_000;

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
let parando = false;
process.on("SIGINT", () => { parando = true; });
process.on("SIGTERM", () => { parando = true; });

/* ----------------------------- Canal seco -------------------------------- */
const canalSeco = {
  name: "seco",
  isReady: () => true,
  async send(para, texto) {
    console.log(`  [SECO] → ${para}: ${texto.slice(0, 80).replace(/\n/g, " ")}…`);
    return { externalId: null };
  },
};

/* ------------------------------- Baileys --------------------------------- */
let baileys = null;
if (!SECO) {
  try { baileys = require("@whiskeysockets/baileys"); }
  catch {
    console.error("✖ O pacote @whiskeysockets/baileys não está instalado.");
    console.error("  Instale com:  npm install   (ele está em optionalDependencies)");
    console.error("  Ou rode o motor sem WhatsApp:  node prospector.js --seco");
    motor.publicarDesconectado("Baileys não instalado no servidor");
    process.exit(1);
  }
}

/* Logger mudo no formato que o Baileys espera (pino-like). */
const logSilencioso = {
  level: "silent", child() { return this; },
  trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {},
};

/* O canal aponta SEMPRE para o socket atual — sobrevive a reconexões. */
let sock = null;
const canalWa = {
  name: "whatsapp",
  isReady: () => !!sock && conectado,
  async send(para, texto) {
    if (!canalWa.isReady()) throw new Error("WhatsApp desconectado");
    const enviada = await sock.sendMessage(`${para}@s.whatsapp.net`, { text: texto });
    const id = enviada?.key?.id || null;
    if (id) nossas.add(id);
    if (nossas.size > 5000) { const primeiro = nossas.values().next().value; nossas.delete(primeiro); }
    return { externalId: id };
  },
};
let conectado = false;
/* ids das mensagens que NÓS enviamos: separa o eco da própria IA (ignorar)
   do humano digitando no celular (assumir a conversa). */
const nossas = new Set();

/* Debounce por contato + fila serial. */
const pendentes = new Map();   // telefone -> { textos, idExterno, timer }
let cadeia = Promise.resolve();
const enfileirar = (t) => { cadeia = cadeia.then(t).catch((e) => console.error("  ✖ fila:", e.message)); };

function chegouMensagem(telefone, texto, idExterno) {
  const p = pendentes.get(telefone) || { textos: [], idExterno };
  p.textos.push(texto);
  clearTimeout(p.timer);
  p.timer = setTimeout(() => {
    pendentes.delete(telefone);
    // o id da 1ª mensagem do bloco é a chave de dedup do conjunto
    enfileirar(() => motor.tratarEntrada(telefone, p.textos.join("\n"), p.idExterno, canalWa));
  }, DEBOUNCE_MS);
  pendentes.set(telefone, p);
}

async function conectar() {
  const { makeWASocket, useMultiFileAuthState, DisconnectReason } = baileys;
  fs.mkdirSync(SESSAO_DIR, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(SESSAO_DIR);

  const s = makeWASocket({
    auth: state,
    logger: logSilencioso,
    browser: ["LA Software House", "Chrome", "1.0.0"],
    syncFullHistory: false,
  });
  sock = s;
  s.ev.on("creds.update", saveCreds);

  s.ev.on("connection.update", (u) => {
    if (u.qr) {
      motor.publicarQr(u.qr);
      console.log("  · QR novo publicado — escaneie em /restrito → Prospecção → Conexão");
    }
    if (u.connection === "open") {
      conectado = true;
      const fone = s.user?.id ? s.user.id.split(":")[0] : null;
      motor.publicarConectado(fone);
      console.log(`  ✓ WhatsApp conectado${fone ? ` (${fone})` : ""}`);
    }
    if (u.connection === "close") {
      conectado = false;
      const codigo = u.lastDisconnect?.error?.output?.statusCode;
      if (codigo === DisconnectReason.loggedOut) {
        /* Credencial morta: reiniciar em loop nunca geraria QR novo. Apaga a
           sessão e sai — o systemd sobe de novo e aí nasce um QR limpo. */
        motor.publicarDesconectado("Sessão encerrada no celular — escaneie o QR de novo");
        try { fs.rmSync(SESSAO_DIR, { recursive: true, force: true }); } catch {}
        console.error("  ✖ sessão do WhatsApp encerrada — saindo para renascer com QR novo");
        process.exit(1);
      }
      motor.publicarDesconectado(String(u.lastDisconnect?.error?.message || "conexão caiu"));
      console.error("  ✖ conexão caiu — reconectando em 5s");
      setTimeout(() => { if (!parando) conectar().catch((e) => console.error("  ✖ reconexão:", e.message)); }, 5000);
    }
  });

  s.ev.on("messages.upsert", (ev) => {
    /* "notify" é o vivo; "append" é o backlog da reconexão — sem ele,
       resposta recebida com o worker fora do ar sumiria em silêncio
       (a dedup por id_externo absorve a reentrega). */
    if (ev.type !== "notify" && ev.type !== "append") return;
    for (const msg of ev.messages || []) {
      const jid = msg.key?.remoteJid || "";
      // só conversa 1-a-1: grupo, status e broadcast ficam de fora
      if (!/@s\.whatsapp\.net$|@lid$/.test(jid)) continue;
      // endereçamento LID não carrega o telefone — o alt sim; sem ele, descarta
      const jidReal = jid.endsWith("@lid") ? msg.key?.remoteJidAlt || "" : jid;
      const telefone = jidReal.split("@")[0];
      if (!/^\d{10,15}$/.test(telefone)) continue;
      const texto = msg.message?.conversation || msg.message?.extendedTextMessage?.text;
      if (!texto) continue;
      const idExterno = msg.key?.id || null;

      if (msg.key?.fromMe) {
        if (idExterno && nossas.has(idExterno)) continue;   // eco da própria IA
        // humano digitou no celular da agência: registrar e tirar a IA da conversa
        enfileirar(() => Promise.resolve(motor.tratarEcoHumano(telefone, texto, idExterno)));
        continue;
      }
      chegouMensagem(telefone, texto, idExterno);
    }
  });
}

/* --------------------------- Laço de envio ------------------------------- */
async function laco(canal) {
  console.log(`\n  Prospector LA Software House v${SISTEMA_VERSION} — canal: ${canal.name}`);
  while (!parando) {
    try {
      motor.batimento();
      if (motor.consumirPedidoSair()) {
        if (sock) {
          console.log("  · desconexão pedida pelo painel");
          try { await sock.logout(); } catch {}
          try { fs.rmSync(SESSAO_DIR, { recursive: true, force: true }); } catch {}
          conectado = false;
          motor.publicarDesconectado("Desconectado pelo painel");
          await conectar();   // renasce e publica QR novo
        }
      }
      const r = await tickComLog(canal);
      const cfg = motor.lerConfigIA();
      /* Enviou → espera o intervalo humano (aleatório). Ocioso → 60s. */
      await dormir(r.primeiroContato + r.followUps > 0 ? motor.proximoIntervaloMs(cfg) : OCIOSO_MS);
    } catch (e) {
      console.error("  ✖ tick:", e.message);
      await dormir(ERRO_MS);
    }
  }
  console.log("  · prospector encerrado");
  process.exit(0);
}
let ultimoMotivo = "";
async function tickComLog(canal) {
  const r = await motor.tick(canal);
  if (r.motivo !== ultimoMotivo) { console.log(`  · motor: ${r.motivo}`); ultimoMotivo = r.motivo; }
  return r;
}

(async () => {
  if (SECO) {
    motor.publicarConectado("canal-seco");
    await laco(canalSeco);
  } else {
    motor.publicarDesconectado(null);
    await conectar();
    await laco(canalWa);
  }
})().catch((e) => { console.error("✖ prospector:", e.message); process.exit(1); });
