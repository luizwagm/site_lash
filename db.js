/* ==========================================================================
   db.js — de onde vem o SQLite

   O site usava `node:sqlite`, o driver que o Node traz de fábrica. Ele
   funciona, mas é marcado como EXPERIMENTAL: o próprio Node avisa a cada boot
   que a interface "pode mudar a qualquer momento". Numa atualização do Node
   isso derrubaria o site inteiro — e em produção isso não se aceita.

   Passamos a preferir o `better-sqlite3` — mesma engine SQLite, mesmo arquivo,
   mesmo SQL, mesma API (prepare/run/get/all/exec); só que é uma biblioteca
   estável e madura, fora do ciclo experimental do Node.

   O require fica dentro de um try: se o pacote não estiver instalado (servidor
   sem `npm install`, por exemplo), o site NÃO cai — volta para o driver de
   fábrica e apenas registra o aviso. Trocar de driver não migra nada: o arquivo
   .db é o mesmo, lido pelos dois.
   ========================================================================== */

let Driver = null;
let DRIVER_NOME = "";
let DRIVER_AVISO = "";

try {
  Driver = require("better-sqlite3");
  DRIVER_NOME = "better-sqlite3";
} catch {
  Driver = require("node:sqlite").DatabaseSync;
  DRIVER_NOME = "node:sqlite";
  DRIVER_AVISO = "driver experimental do Node — rode `npm ci --omit=dev` para usar o better-sqlite3";
}

/* Abre (ou cria) um banco. Assinatura igual nos dois drivers: só o caminho. */
function abrirBanco(arquivo) {
  return new Driver(arquivo);
}

module.exports = { abrirBanco, DRIVER_NOME, DRIVER_AVISO };
