#!/usr/bin/env bash
# ==========================================================================
#  restaurar.sh — devolve um backup ao lugar
#
#  Uso:  sudo ./restaurar.sh            lista os backups disponíveis
#        sudo ./restaurar.sh ultimo     restaura o mais recente
#        sudo ./restaurar.sh ARQUIVO    restaura um backup específico
#
#  O que ele faz antes de sobrescrever qualquer coisa:
#   1. confere a integridade do backup escolhido (não restaura cópia quebrada);
#   2. guarda o banco ATUAL como .antes-da-restauracao — se a restauração for
#      um engano, o estado de agora não se perde;
#   3. para o serviço, troca o arquivo, ajusta dono e sobe de volta.
#
#  Restaurar devolve o conteúdo do site ao estado do backup: tudo que foi
#  editado no painel depois daquela cópia se perde. Por isso o script pede
#  confirmação digitada e mostra a data do backup antes de agir.
# ==========================================================================
set -uo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "$(readlink -f "$0")")" && pwd)}"
SERVICO="${SERVICO:-lash.service}"
PORTA="${PORTA:-5180}"
BACKUP_DIR="${BACKUP_DIR:-$APP_DIR/backups}"
cd "$APP_DIR" || { echo "Diretório $APP_DIR não existe"; exit 1; }

azul()    { printf "\033[1;34m%s\033[0m\n" "$1"; }
verde()   { printf "\033[1;32m%s\033[0m\n" "$1"; }
amarelo() { printf "\033[1;33m%s\033[0m\n" "$1"; }
vermelho(){ printf "\033[1;31m%s\033[0m\n" "$1"; }

ALVO="${1:-}"
if [ -z "$ALVO" ]; then
  echo
  azul "Backups disponíveis em $BACKUP_DIR"
  echo
  achou=0
  while IFS= read -r f; do
    achou=1
    printf "    %s  %s\n" "$(date -r "$f" '+%d/%m/%Y %H:%M')" "$(basename "$f")"
  done < <(ls -1t "$BACKUP_DIR"/site.*.db 2>/dev/null | head -20)
  [ "$achou" = "0" ] && echo "    (nenhum backup ainda)"
  echo
  echo "  Para restaurar:  sudo ./restaurar.sh ultimo"
  echo "                   sudo ./restaurar.sh site.2026-07-27_030000.db"
  echo
  exit 0
fi

if [ "$ALVO" = "ultimo" ]; then
  ARQ=$(ls -1t "$BACKUP_DIR"/site.*.db 2>/dev/null | head -1)
else
  ARQ="$ALVO"
  [ ! -f "$ARQ" ] && [ -f "$BACKUP_DIR/$ARQ" ] && ARQ="$BACKUP_DIR/$ARQ"
fi
if [ -z "${ARQ:-}" ] || [ ! -f "$ARQ" ]; then
  vermelho "Não encontrei esse backup em $BACKUP_DIR"
  exit 1
fi

# ------------------------------------------- 1. o backup presta?
azul "1/4  Conferindo o backup"
VEREDITO=$(node -e '
  const { abrirBanco } = require("./db");
  try {
    const d = abrirBanco(process.argv[1]);
    const r = d.prepare("PRAGMA integrity_check").get();
    const v = r ? (r.integrity_check || Object.values(r)[0]) : "sem resposta";
    const t = d.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type=\x27table\x27").get().c;
    d.close();
    console.log(v + "|" + t);
  } catch (e) { console.log("ILEGÍVEL: " + e.message + "|0"); }
' "$ARQ" 2>/dev/null)
INTEG="${VEREDITO%%|*}"; TABELAS="${VEREDITO##*|}"
if [ "$INTEG" != "ok" ]; then
  vermelho "     Este backup NÃO está íntegro ($INTEG). Nada foi alterado."
  amarelo "     Tente outro:  sudo ./restaurar.sh"
  exit 1
fi
verde "     íntegro · $TABELAS tabelas · $(du -h "$ARQ" | cut -f1) · de $(date -r "$ARQ" '+%d/%m/%Y %H:%M')"

# ------------------------------------------- 2. confirmação
echo
amarelo "  Vai substituir  data/site.db"
amarelo "  pelo backup de  $(date -r "$ARQ" '+%d/%m/%Y às %H:%M')"
vermelho "  Textos, projetos e ajustes feitos no painel DEPOIS dessa data serão perdidos."
echo
printf "  Digite RESTAURAR para confirmar: "
read -r RESP
[ "$RESP" = "RESTAURAR" ] || { amarelo "Cancelado. Nada foi alterado."; exit 0; }

# ------------------------------------------- 3. troca
azul "2/4  Parando o serviço"
systemctl stop "$SERVICO" 2>/dev/null
sleep 1

azul "3/4  Guardando o banco atual e trocando"
if [ -f data/site.db ]; then
  SEGURANCA="$BACKUP_DIR/site.antes-da-restauracao.$(date +%Y-%m-%d_%H%M%S).db"
  cp data/site.db "$SEGURANCA"
  verde "     estado de agora guardado em $(basename "$SEGURANCA")"
fi
# o WAL do banco antigo não pode sobreviver ao arquivo novo: seria aplicado por
# cima e corromperia a restauração
rm -f data/site.db-wal data/site.db-shm
cp "$ARQ" data/site.db

DONO=$(systemctl show "$SERVICO" -p User --value 2>/dev/null); [ -z "$DONO" ] && DONO="root"
GRUPO=$(systemctl show "$SERVICO" -p Group --value 2>/dev/null); [ -z "$GRUPO" ] && GRUPO="$DONO"
chown "$DONO:$GRUPO" data/site.db 2>/dev/null
chmod 644 data/site.db
verde "     restaurado (dono: $DONO:$GRUPO)"

# ------------------------------------------- 4. sobe, publica e confere
azul "4/4  Subindo o serviço"
systemctl start "$SERVICO"
sleep 3
# o HTML estático vem do banco: depois de restaurar é preciso republicar
sudo -u "$DONO" node server.js --publicar >/dev/null 2>&1 && verde "     site republicado a partir do banco restaurado"
CODIGO=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$PORTA/" || echo 000)
echo
if [ "$CODIGO" = "200" ]; then
  verde "Restauração concluída — site no ar."
  [ -n "${SEGURANCA:-}" ] && echo "  O estado anterior continua em: $SEGURANCA"
else
  vermelho "O site não respondeu (HTTP $CODIGO). Log:"
  journalctl -u "$SERVICO" -n 25 --no-pager | sed 's/^/  /'
  exit 1
fi
