/* Conteúdo do cartão de divulgação, lido do MESMO banco que a home publica.
   Existe como arquivo, e não embutido no .ps1, porque JavaScript multilinha
   dentro de here-string do PowerShell quebra por motivo de aspas — e um script
   de arte não é lugar para gastar tempo com escape.

   Uso: node src/dados-cartao.cjs   →  JSON no stdout */
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const RAIZ = path.join(__dirname, "..");
const db = new DatabaseSync(path.join(RAIZ, "data", "site.db"), { readOnly: true });

const S = Object.fromEntries(
  db.prepare("SELECT key,value FROM settings").all().map((r) => [r.key, r.value]));

/* Os textos do painel aceitam HTML; na arte só cabe texto. */
const limpa = (t) => String(t || "")
  .replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ")
  .replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

process.stdout.write(JSON.stringify({
  servicos: db.prepare("SELECT title,text FROM services ORDER BY sort,id").all()
    .map((s) => ({ titulo: limpa(s.title), texto: limpa(s.text) })),
  stats: JSON.parse(S.stats || "[]"),
  whatsapp: String(S.whatsapp || "").replace(/\D/g, ""),
  site: "luizaugust.me",
}));
