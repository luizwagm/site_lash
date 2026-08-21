/* ==========================================================================
   backup.js — cópia de segurança automática do banco

   Por que existe: o `data/site.db` é TODO o conteúdo do site — textos, hero,
   serviços, projetos, depoimentos, FAQ, contato. Ele vive só no servidor e não
   está no git (de propósito). Sem backup, um disco com problema apaga meses de
   ajustes feitos pelo painel.

   Como faz: usa `VACUUM INTO`, o backup ONLINE do próprio SQLite. Ele gera uma
   cópia consistente mesmo com o site no ar e com escritas acontecendo — ao
   contrário de copiar o arquivo com `cp`, que pode capturar um estado partido
   (o WAL fica em outro arquivo). Depois de gerar, a cópia é ABERTA e submetida
   ao `integrity_check`: um backup que ninguém testa não é um backup.

   Roda dentro do processo Node, sem depender de cron/agendador do sistema —
   assim funciona igual em qualquer servidor. A cada hora ele pergunta "já
   passou o intervalo desde a última cópia?"; se sim, copia. Isso sobrevive a
   reinícios: se a máquina ficou desligada na hora marcada, o backup sai no
   próximo boot em vez de ser pulado.
   ========================================================================== */
const fs = require("node:fs");
const path = require("node:path");
const { abrirBanco } = require("./db");

const CARIMBO = () => new Date().toISOString().slice(0, 19).replace("T", "_").replace(/:/g, "");

/* Uma cópia verificada de um banco. Devolve {ok, arquivo, bytes, erro}. */
/* Permissões da pasta de backups: 750 na pasta, 640 nos arquivos. Um backup
   é o banco inteiro, com hash de senha e chaves — "legível por todo mundo" no
   servidor seria um segundo caminho de vazamento. Corrige também o que já
   existia, porque backup antigo não some sozinho. No Windows o chmod não faz
   nada, e tudo bem. */
function ajustarPermissoes(destinoDir) {
  try { fs.chmodSync(destinoDir, 0o750); } catch {}
  try {
    for (const f of fs.readdirSync(destinoDir)) {
      if (/\.db(-\d+)?$/i.test(f)) { try { fs.chmodSync(path.join(destinoDir, f), 0o640); } catch {} }
    }
  } catch {}
}

function copiarBanco(origem, destinoDir) {
  const nome = path.basename(origem, ".db");
  let arquivo = "";
  let db = null, copia = null;
  try {
    if (!fs.existsSync(origem)) return { ok: false, erro: "banco ainda não existe" };
    fs.mkdirSync(destinoDir, { recursive: true });
    ajustarPermissoes(destinoDir);
    /* O carimbo tem precisão de segundo. Duas cópias no mesmo segundo (backup
       manual logo após o automático) cairiam no mesmo nome, e o VACUUM INTO se
       recusa a sobrescrever — então desempata com um sufixo. */
    const base = `${nome}.${CARIMBO()}`;
    arquivo = path.join(destinoDir, `${base}.db`);
    for (let i = 2; fs.existsSync(arquivo) && i < 100; i++) arquivo = path.join(destinoDir, `${base}-${i}.db`);

    db = abrirBanco(origem);
    // VACUUM INTO exige o caminho com barras normais, inclusive no Windows
    db.exec(`VACUUM INTO '${arquivo.split(path.sep).join("/").replace(/'/g, "''")}'`);
    db.close();
    db = null;

    // a cópia presta? abre e checa a integridade antes de considerá-la válida
    copia = abrirBanco(arquivo);
    const r = copia.prepare("PRAGMA integrity_check").get();
    const veredito = r ? (r.integrity_check || Object.values(r)[0]) : "";
    copia.close();
    copia = null;
    if (String(veredito).toLowerCase() !== "ok") {
      fs.unlinkSync(arquivo);
      return { ok: false, erro: "cópia corrompida (" + veredito + ")" };
    }
    try { fs.chmodSync(arquivo, 0o640); } catch {}   // dono lê/escreve, grupo lê, resto nada
    return { ok: true, arquivo, bytes: fs.statSync(arquivo).size };
  } catch (e) {
    try { if (db) db.close(); } catch {}
    try { if (copia) copia.close(); } catch {}
    try { if (arquivo && fs.existsSync(arquivo)) fs.unlinkSync(arquivo); } catch {}
    return { ok: false, erro: e.message };
  }
}

/* Mantém só as N cópias mais recentes de cada banco. */
function limparAntigos(destinoDir, nomeBanco, manter) {
  try {
    const arquivos = fs.readdirSync(destinoDir)
      .filter((f) => f.startsWith(nomeBanco + ".") && f.endsWith(".db"))
      .map((f) => ({ f, t: fs.statSync(path.join(destinoDir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    let removidos = 0;
    for (const velho of arquivos.slice(manter)) { fs.unlinkSync(path.join(destinoDir, velho.f)); removidos++; }
    return removidos;
  } catch { return 0; }
}

/* Quando foi a última cópia de um banco (ms) — 0 se nunca houve. */
function ultimaCopia(destinoDir, nomeBanco) {
  try {
    return fs.readdirSync(destinoDir)
      .filter((f) => f.startsWith(nomeBanco + ".") && f.endsWith(".db"))
      .reduce((max, f) => Math.max(max, fs.statSync(path.join(destinoDir, f)).mtimeMs), 0);
  } catch { return 0; }
}

/* Executa a rodada de backup de todos os bancos configurados. */
function rodarBackup(cfg, motivo) {
  const feitos = [];
  for (const origem of cfg.bancos) {
    const nome = path.basename(origem, ".db");
    const r = copiarBanco(origem, cfg.destino);
    if (r.ok) {
      const removidos = limparAntigos(cfg.destino, nome, cfg.manter);
      const kb = Math.max(1, Math.round(r.bytes / 1024));
      console.log(`  · backup ${motivo}: ${path.basename(r.arquivo)} (${kb} KB)${removidos ? ` · ${removidos} antigo(s) removido(s)` : ""}`);
      feitos.push({ banco: nome, arquivo: r.arquivo, bytes: r.bytes });
    } else if (r.erro !== "banco ainda não existe") {
      console.error(`  ✖ backup de ${nome} FALHOU: ${r.erro}`);
    }
  }
  return feitos;
}

/* Situação atual, para o verificar.sh mostrar. */
function statusBackup(cfg) {
  const bancos = cfg.bancos.map((origem) => {
    const nome = path.basename(origem, ".db");
    const t = ultimaCopia(cfg.destino, nome);
    let copias = 0;
    try { copias = fs.readdirSync(cfg.destino).filter((f) => f.startsWith(nome + ".") && f.endsWith(".db")).length; } catch {}
    return { banco: nome, ultimo: t ? new Date(t).toISOString() : null, horasAtras: t ? (Date.now() - t) / 3600e3 : null, copias };
  });
  return { destino: cfg.destino, intervaloHoras: cfg.intervaloHoras, manter: cfg.manter, bancos };
}

/* Liga a rotina. Chamado uma vez no boot do server.js. */
function agendarBackups(opcoes) {
  const cfg = {
    destino: opcoes.destino,
    bancos: opcoes.bancos.filter(Boolean),
    manter: opcoes.manter || 30,
    intervaloHoras: opcoes.intervaloHoras || 24,
  };
  fs.mkdirSync(cfg.destino, { recursive: true });
  ajustarPermissoes(cfg.destino);

  const vencido = () => cfg.bancos.some((origem) => {
    const t = ultimaCopia(cfg.destino, path.basename(origem, ".db"));
    return !t || (Date.now() - t) > cfg.intervaloHoras * 3600e3;
  });

  // no boot: se está vencido, copia — mas depois de 20s, para não atrasar a subida
  setTimeout(() => { if (vencido()) rodarBackup(cfg, "de boot"); }, 20_000).unref();
  // a cada hora, verifica se venceu. Sobrevive a reinícios e a máquina desligada.
  setInterval(() => { if (vencido()) rodarBackup(cfg, "diário"); }, 3600e3).unref();

  console.log(`  · backup automático: a cada ${cfg.intervaloHoras}h em ${path.relative(process.cwd(), cfg.destino) || cfg.destino} (mantém ${cfg.manter})`);
  return { cfg, rodarAgora: (motivo) => rodarBackup(cfg, motivo || "manual"), status: () => statusBackup(cfg) };
}

module.exports = { agendarBackups, rodarBackup, statusBackup, copiarBanco };
