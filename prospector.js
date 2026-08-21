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

/* Logger quase mudo: `trace/debug/info` do Baileys é um dilúvio, mas WARN e
   ERROR são justamente onde aparece "received error in ack" — o rastro de uma
   mensagem recusada. Sem eles, a recusa vira um mistério no journalctl. */
const logSilencioso = {
  level: "warn", child() { return this; },
  trace() {}, debug() {}, info() {},
  warn: (...a) => console.error("  ⚠ wa:", ...a.map(resumir)),
  error: (...a) => console.error("  ✖ wa:", ...a.map(resumir)),
  fatal: (...a) => console.error("  ✖✖ wa:", ...a.map(resumir)),
};
// objeto do pino vira uma linha só; sem isto o log escorre por 30 linhas
const resumir = (v) => {
  if (typeof v !== "object" || v === null) return v;
  try { return JSON.stringify(v).slice(0, 400); } catch { return "[objeto]"; }
};

/* O canal aponta SEMPRE para o socket atual — sobrevive a reconexões. */
let sock = null;

/* O NONO DÍGITO: colar "@s.whatsapp.net" no número SEM conferir se a conta
   existe é o furo que fazia o painel dizer "3/3 enviados" com um só chegando —
   o servidor aceita o JID errado, devolve id, e não entrega nada. Aqui o
   número é confirmado pelo onWhatsApp() nas DUAS variantes (com e sem o 9) e
   o envio vai para o JID que o servidor confirmar. Sem conta em nenhuma,
   falha EXPLÍCITA e permanente, em vez de fingir sucesso. */
const jidCache = new Map();   // e164 -> jid confirmado (morre com a conexão)
async function resolverJid(para) {
  if (jidCache.has(para)) return jidCache.get(para);
  const variantes = motor.variantesTelefoneBr(para);
  let resposta;
  try {
    resposta = await Promise.race([
      sock.onWhatsApp(...variantes),
      /* onWhatsApp pode NÃO responder; sem teto, o laço de envio congela. E
         timeout NÃO é "sem conta" — tratar como tal aposentaria o lead para
         sempre por uma oscilação de rede. */
      new Promise((_, rej) => setTimeout(() => rej(new Error("verificação do número expirou")), 60_000)),
    ]);
  } catch (e) {
    throw new Error(`não deu para verificar o número (${e.message})`);   // transitório → backoff
  }
  const conta = (resposta || []).find((r) => r && r.exists);
  if (!conta) {
    const erro = new Error("número sem conta de WhatsApp");
    erro.codigo = "SEM_CONTA_WHATSAPP";   // permanente → o motor cancela com motivo
    throw erro;
  }
  jidCache.set(para, conta.jid);
  return conta.jid;
}

const canalWa = {
  name: "whatsapp",
  isReady: () => !!sock && conectado,
  async send(para, texto) {
    if (!canalWa.isReady()) throw new Error("WhatsApp desconectado");
    const jid = await resolverJid(para);
    const enviada = await sock.sendMessage(jid, { text: texto });
    const id = enviada?.key?.id || null;
    if (id) nossas.add(id);
    if (nossas.size > 5000) { const primeiro = nossas.values().next().value; nossas.delete(primeiro); }
    return { externalId: id, deliveredTo: jid.split("@")[0] };
  },
};
let conectado = false;
/* ids das mensagens que NÓS enviamos: separa o eco da própria IA (ignorar)
   do humano digitando no celular (assumir a conversa). */
const nossas = new Set();

/* ===========================================================================
   COMO ESTÁ A NOSSA CONTA
   O WhatsApp responde duas perguntas: se há restrição para iniciar conversa
   nova (`reachout timelock`, o tal 463) e quanto ainda cabe da cota de
   conversas novas. Perguntar é melhor que adivinhar pelo erro: vem a DATA em
   que a punição termina, e é ela que o motor usa para voltar sozinho.
   ========================================================================== */
async function conferirRestricao(textoDaRecusa) {
  if (!sock) return;
  let ate = null, motivo = textoDaRecusa || null, cota = null;
  try {
    const r = await sock.fetchAccountReachoutTimelock();
    if (r?.isActive) {
      ate = r.timeEnforcementEnds ? new Date(r.timeEnforcementEnds).toISOString() : null;
      motivo = motivo || `conta restrita para iniciar conversas novas (${r.enforcementType || "padrão"})`;
    } else if (!textoDaRecusa) {
      motivo = null;   // consulta limpa e sem recusa recente: nada a registrar
    }
  } catch (e) { console.error("  ✖ consulta de restrição:", e.message); }
  try { cota = await sock.fetchNewChatMessageCap(); } catch { /* nem toda conta responde */ }
  /* Recusa sem data: segura por 24h. Melhor esperar um dia do que martelar
     uma conta punida e transformar restrição temporária em bloqueio. */
  if (motivo && !ate) ate = new Date(Date.now() + 24 * 3600e3).toISOString();
  motor.publicarRestricao({ ate, motivo, cota });
  if (motivo) console.error(`  ⚠ CONTA RESTRITA até ${ate} — primeiro contato pausado. ${motivo}`);
  else console.log("  · conta sem restrição para iniciar conversas");
}

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
      // ao conectar, pergunta ao WhatsApp como está a conta (restrição e cota)
      conferirRestricao().catch(() => {});
    }
    if (u.connection === "close") {
      conectado = false;
      jidCache.clear();   // JID confirmado vale para A conexão, não para sempre
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

  /* O VEREDITO DO SERVIDOR. sendMessage() resolve quando o pacote foi escrito
     no socket — não quando o WhatsApp aceitou. Mensagem recusada (ex.: 463,
     conta restrita para iniciar conversa) ficaria como "enviada" para sempre.
     Aqui cada atualização de status vira registro na mensagem. */
  s.ev.on("messages.update", (updates) => {
    for (const u of updates || []) {
      const id = u.key?.id;
      if (!id) continue;
      const st = u.update?.status;
      let veredito = null;
      if (st === 2) veredito = "SERVIDOR";
      else if (st === 3) veredito = "ENTREGUE";
      else if (st === 4 || st === 5) veredito = "LIDA";
      else if (st === 0 || u.update?.error) {
        /* O CÓDIGO VEM EM `messageStubParameters`, não em `update.error` —
           era o que fazia o veredito sair como "ERRO" pelado, sem dizer qual.
           [0] é o código ("463", "479"…) e [1], quando existe, o texto da
           restrição de conta. */
        const par = u.update?.messageStubParameters || [];
        const codigo = String(par[0] ?? u.update?.error?.code ?? "").trim();
        veredito = ("ERRO " + codigo).trim();
        console.error(`  ✖ mensagem recusada pelo WhatsApp (${codigo || "sem código"})${par[1] ? " — " + par[1] : ""}`);
        if (codigo === "463") conferirRestricao(par[1]);
      }
      if (veredito) {
        try { motor.registrarVeredito(id, veredito); }
        catch (e) { console.error("  ✖ veredito:", e.message); }
      }
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
