#!/usr/bin/env bash
# ==========================================================================
#  verificar.sh — só olha, não altera nada.
#  Rode ANTES do deploy para saber em que estado a produção está.
# ==========================================================================
APP_DIR="${APP_DIR:-$(cd "$(dirname "$(readlink -f "$0")")" && pwd)}"
SERVICO="${SERVICO:-lash.service}"
PORTA="${PORTA:-5180}"
DOMINIO="${DOMINIO:-luizaugust.me}"
cd "$APP_DIR" || exit 1

echo "===================== ESTADO DA PRODUÇÃO ====================="
echo
echo "Commit atual : $(git rev-parse --short HEAD) — $(git log -1 --format=%s)"
echo "Node         : $(node -v)"
echo "Driver SQLite: $(node -p 'const d=require("./db"); d.DRIVER_NOME + (d.DRIVER_AVISO ? "  ⚠ " + d.DRIVER_AVISO : "")' 2>/dev/null || echo '—')"
echo "Serviço      : $(systemctl is-active "$SERVICO" 2>/dev/null)"
printf "Site local   : HTTP %s\n" "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORTA/")"
printf "Site público : HTTP %s\n" "$(curl -s -o /dev/null -w '%{http_code}' "https://$DOMINIO/" 2>/dev/null || echo '---')"
echo

echo "--- O banco corre risco no próximo pull? ---"
if git ls-files --error-unmatch data/site.db >/dev/null 2>&1; then
  echo "  ATENÇÃO: data/site.db ainda é RASTREADO neste commit."
  echo "  Um git pull pode apagá-lo. Use ./deploy.sh, que o protege."
else
  echo "  OK: data/site.db não é rastreado — o git não mexe nele."
fi
echo

echo "--- Permissão de escrita no banco ---"
DONO_SVC=$(systemctl show "$SERVICO" -p User --value 2>/dev/null); [ -z "$DONO_SVC" ] && DONO_SVC="root"
echo "  serviço roda como : $DONO_SVC"
echo "  dono de data/     : $(stat -c '%U:%G %a' data 2>/dev/null || echo '—')"
echo "  dono do site.db   : $(stat -c '%U:%G %a' data/site.db 2>/dev/null || echo '—')"
# o SQLite grava um -journal ao lado do banco: sem escrita NA PASTA dá
# "attempt to write a readonly database" mesmo com o .db gravável
if sudo -u "$DONO_SVC" test -w data 2>/dev/null && sudo -u "$DONO_SVC" test -w data/site.db 2>/dev/null; then
  echo "  resultado         : OK, o serviço consegue gravar"
else
  echo "  resultado         : SEM PERMISSÃO — o painel não vai salvar nada"
  echo "                      corrija: sudo chown -R $DONO_SVC: data assets/img/uploads backups"
fi
echo

echo "--- Conteúdo do banco ---"
if [ -f data/site.db ]; then
  echo "  arquivo: $(du -h data/site.db | cut -f1)"
  node -e '
    const { abrirBanco } = require("./db");
    try {
      const db = abrirBanco("data/site.db");
      for (const t of ["projects","services","testimonials","faq","process","settings"])
        console.log("  " + t.padEnd(14) + db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c);
      console.log("  integridade   " + db.prepare("PRAGMA integrity_check").get().integrity_check);
    } catch (e) { console.log("  ERRO ao ler: " + e.message); }
  ' 2>/dev/null
else
  echo "  data/site.db NÃO EXISTE"
fi
echo

echo "--- A senha do painel ainda é a padrão? ---"
node -e '
  const { abrirBanco } = require("./db");
  const crypto = require("node:crypto");
  try {
    const db = abrirBanco("data/site.db");
    const h = db.prepare("SELECT value FROM settings WHERE key=?").get("admin_password_hash");
    if (!h) return console.log("  senha não definida");
    const g = h.value;
    let ehPadrao = false;
    if (g.startsWith("scrypt$")) {
      const [, N, r, p, saltHex, dkHex] = g.split("$");
      const dk = crypto.scryptSync("la-admin", Buffer.from(saltHex, "hex"), dkHex.length / 2, { N: +N, r: +r, p: +p });
      ehPadrao = dk.toString("hex") === dkHex;
    } else {
      ehPadrao = crypto.createHash("sha256").update("la-admin").digest("hex") === g;
      console.log("  formato ANTIGO (sha256 sem salt) — troque a senha para migrar para scrypt");
    }
    console.log(ehPadrao ? "  SIM — ainda é la-admin. TROQUE em /admin → Senha." : "  não, já foi trocada");
  } catch (e) { console.log("  não consegui conferir: " + e.message); }
' 2>/dev/null
echo

echo "--- Backup automático ---"
node server.js --backup-status 2>/dev/null | sed 's/^/  /' || echo "  não consegui consultar"
echo
echo "--- Últimos backups no disco ---"
LISTA=$(ls -1t backups/*.db 2>/dev/null | head -8)
if [ -n "$LISTA" ]; then echo "$LISTA" | sed 's/^/  /'; else echo "  nenhum ainda (o primeiro sai em até 24h ou no próximo deploy)"; fi
echo "  restaurar:  sudo ./restaurar.sh          (lista)"
echo "              sudo ./restaurar.sh ultimo   (restaura o mais recente)"
echo

echo "--- Certificado HTTPS ---"
if command -v certbot >/dev/null 2>&1; then
  certbot certificates 2>/dev/null | grep -A2 "$DOMINIO" | sed 's/^/  /' || echo "  nenhum certificado para $DOMINIO"
else
  echo "  certbot não instalado"
fi
echo
echo "=============================================================="
