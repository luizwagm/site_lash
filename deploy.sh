#!/usr/bin/env bash
# ==========================================================================
#  deploy.sh — atualiza o luizaugust.me sem arriscar o conteúdo
#
#  Uso:  sudo ./deploy.sh
#
#  O banco data/site.db é TODO o conteúdo do site (hero, serviços, projetos,
#  depoimentos, FAQ, contato, rodapé). Ele vive só no servidor — não está no
#  repositório. Por isso o deploy tira o banco do caminho ANTES do git pull e
#  devolve depois: nem um pull mal resolvido nem um commit antigo que apaga o
#  arquivo conseguem encostar nele.
#
#  Sequência: backup → inventário → parar → proteger → pull → dependências →
#             devolver → subir → publicar → conferir inventário → testar.
#             Falhou, restaura sozinho.
#
#  Este é o backup DO DEPLOY (uma foto antes de mexer). O site também tira um
#  backup DIÁRIO sozinho, na mesma pasta backups/ — ver backup.js.
# ==========================================================================
set -uo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "$(readlink -f "$0")")" && pwd)}"
SERVICO="${SERVICO:-lash.service}"
PORTA="${PORTA:-5180}"
BACKUP_DIR="${BACKUP_DIR:-$APP_DIR/backups}"
MANTER_BACKUPS=20
COFRE="/tmp/lash-deploy-$$"

cd "$APP_DIR" || { echo "Diretório $APP_DIR não existe"; exit 1; }

# ==========================================================================
#  ROOT OU O USUÁRIO DO SERVIÇO — e isto é decisão de segurança, não de gosto.
#
#  Este script VEM DO REPOSITÓRIO. Se a entrega automática o rodasse como root,
#  quem invadisse o repositório deste site viraria dono do servidor inteiro:
#  os onze sites, o Postgres e os certificados. Rodando como
#  `deploy` — o mesmo usuário que já executa a aplicação —, o pior que um commit
#  malicioso alcança é o próprio site, que é o poder que ele já tinha.
#
#  O que exige raiz é só parar e subir o serviço, e para isso existe uma regra
#  de sudo com esses verbos e mais nada (ver ci/sudoers-lash).
#
#  `sudo ./deploy.sh` continua funcionando: aí já somos root e o sudo some.
# ==========================================================================
if [ "$(id -u)" = "0" ]; then
  SC="systemctl"; SOU_ROOT=1
else
  SC="sudo -n systemctl"; SOU_ROOT=0
  # A CONFERÊNCIA TEM DE USAR UM COMANDO DA LISTA. Antes eu testava com
  # `sudo -n true` — e `true` não está autorizado, justamente porque a regra é
  # estreita de propósito. Resultado: com a regra instalada e funcionando, o
  # deploy parava dizendo que ela faltava.
  #
  # `is-active` está na lista. E a permissão é medida pelo que sai na SAÍDA
  # PADRÃO, não pelo código de retorno: com o serviço parado ele devolve 3, o
  # que é uma resposta legítima; quando o sudo recusa, a saída vem VAZIA porque
  # o "a password is required" vai para a saída de erro.
  if [ -z "$(sudo -n systemctl is-active "$SERVICO" 2>/dev/null)" ]; then
    echo "PAREI: preciso de 'systemctl' sem senha e a regra de sudo não está instalada."
    echo "  Instale uma vez, como root:"
    echo "    sudo cp ci/sudoers-lash /etc/sudoers.d/lash && sudo chmod 440 /etc/sudoers.d/lash"
    echo "  Ou rode com sudo:  sudo ./deploy.sh"
    exit 1
  fi
fi

azul()    { printf "\033[1;34m%s\033[0m\n" "$1"; }
verde()   { printf "\033[1;32m%s\033[0m\n" "$1"; }
amarelo() { printf "\033[1;33m%s\033[0m\n" "$1"; }
vermelho(){ printf "\033[1;31m%s\033[0m\n" "$1"; }

# Conta o que existe no banco — serve para provar, no fim, que nada sumiu
inventario() {
  [ -f data/site.db ] || { echo "SEM BANCO"; return; }
  node -e '
    const { abrirBanco } = require("./db");
    try {
      const db = abrirBanco("data/site.db");
      const n = (t) => db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
      console.log(`${n("projects")} projetos · ${n("services")} serviços · ${n("testimonials")} depoimentos · ${n("faq")} perguntas · ${n("process")} etapas · ${n("settings")} textos`);
    } catch (e) { console.log("BANCO ILEGÍVEL: " + e.message); }
  ' 2>/dev/null
}

restaurar_e_sair() {
  vermelho "$1"
  if [ -f "$COFRE/site.db" ]; then
    mkdir -p data && cp "$COFRE/site.db" data/site.db
    amarelo "Banco devolvido do cofre temporário."
  elif [ -f "${BACKUP:-}" ]; then
    mkdir -p data && cp "$BACKUP" data/site.db
    amarelo "Banco restaurado do backup: $BACKUP"
  fi
  if [ -f "$COFRE/gestao.db" ]; then
    mkdir -p data && cp "$COFRE/gestao.db" data/gestao.db
    amarelo "Banco da gestão devolvido do cofre."
  fi
  $SC start "$SERVICO" 2>/dev/null
  $SC start lash-prospector.service 2>/dev/null
  rm -rf "$COFRE"
  exit 1
}

# ----------------------------------------------------------- 1. backup
# Usa o próprio backup.js: VACUUM INTO (cópia consistente com o site no ar) e
# integrity_check na cópia — melhor que `cp`, que pode pegar estado partido.
azul "1/9  Backup do banco"
mkdir -p "$BACKUP_DIR"
if [ -f data/site.db ]; then
  if ! node server.js --backup 2>&1 | sed 's/^/  /'; then
    amarelo "     backup pelo sistema falhou — caindo para cópia simples"
    cp data/site.db "$BACKUP_DIR/site.$(date +%Y-%m-%d_%H%M%S).db"
  fi
  BACKUP=$(ls -1t "$BACKUP_DIR"/site.*.db 2>/dev/null | head -1)
  ls -1t "$BACKUP_DIR"/site.*.db 2>/dev/null | tail -n +$((MANTER_BACKUPS + 1)) | xargs -r rm --
else
  amarelo "     ainda não existe banco (primeira instalação)"
fi

# -------------------------------------------------------- 2. inventário
azul "2/9  Conteúdo atual"
ANTES=$(inventario)
echo "     $ANTES"

# ------------------------------------------------------------ 3. parar
azul "3/9  Parando o serviço"
$SC stop "$SERVICO" 2>/dev/null
# O prospector escreve no data/gestao.db — mexer no banco com ele vivo
# perderia escrita. Se a unit não existe/não está autorizada, segue o jogo.
$SC stop lash-prospector.service 2>/dev/null
sleep 1
verde "     parado (o SQLite solta o arquivo antes de mexermos nele)"

# --------------------------------------------------------- 4. proteger
azul "4/9  Tirando banco e imagens do caminho do git"
mkdir -p "$COFRE"
[ -f data/site.db ] && mv data/site.db "$COFRE/site.db"
for wal in data/site.db-wal data/site.db-shm; do
  [ -f "$wal" ] && mv "$wal" "$COFRE/$(basename "$wal")"
done
# gestao.db é a carteira de leads do /restrito — mesma proteção do site.db
for g in data/gestao.db data/gestao.db-wal data/gestao.db-shm; do
  [ -f "$g" ] && mv "$g" "$COFRE/$(basename "$g")"
done
[ -d assets/img/uploads ] && cp -r assets/img/uploads "$COFRE/uploads"
verde "     guardados em $COFRE"

# ------------------------------------------------------------- 5. pull
# ------------------------------------- 4b. descartar o que o publish gerou
#
# O passo 8 REESCREVE, no lugar, arquivos que estão versionados: index.html,
# assets/data/projects.json e sitemap.xml. Eles ficam como MODIFICADOS na
# árvore, e `git pull --ff-only` recusa mexer em arquivo alterado — sem este
# passo o deploy para antes mesmo de tentar o pull. Hoje são 3 no servidor.
#
# Descartar é seguro porque são DERIVADOS do banco: o passo 8 os refaz com o
# conteúdo atual. O que NÃO é derivado (banco, imagens enviadas) já saiu do
# caminho no passo 4.
#
# Só descarta o que o próprio servidor mudou (estado "M"), e diz quantos foram:
# deploy que apaga arquivo em silêncio é deploy em que não se confia.
azul "4b/9 Descartando as páginas geradas pelo Publicar"
MODIFICADOS=$(git status --porcelain | awk '$1 == "M" { print $2 }')
if [ -n "$MODIFICADOS" ]; then
  QUANTOS=$(printf '%s\n' "$MODIFICADOS" | wc -l)
  printf '%s\n' "$MODIFICADOS" | xargs -r git checkout --
  verde "     $QUANTOS arquivos gerados descartados (refeitos no passo 8)"
else
  verde "     nada gerado pendente"
fi

azul "5/9  Baixando a versão nova"
DE=$(git rev-parse --short HEAD)
if ! git pull --ff-only; then
  restaurar_e_sair "     git pull falhou — nada foi alterado."
fi
PARA=$(git rev-parse --short HEAD)
if [ "$DE" = "$PARA" ]; then
  amarelo "     já estava atualizado ($PARA)"
else
  verde "     $DE → $PARA"
  git log --oneline "$DE..$PARA" | sed 's/^/       /'
fi

# ---------------------------------------------------- 6. dependências
# O site usa o better-sqlite3 (driver estável do SQLite). Não é fatal: sem a
# pasta node_modules o db.js volta sozinho para o driver de fábrica do Node.
azul "6/9  Dependências"
if [ -f package.json ]; then
  if command -v npm >/dev/null 2>&1; then
    if npm ci --omit=dev --no-audit --no-fund 2>/dev/null || npm install --omit=dev --no-audit --no-fund; then
      verde "     node_modules em dia"
    else
      amarelo "     npm install falhou — o site sobe com o driver de fábrica do Node"
    fi
  else
    amarelo "     npm não encontrado — instale com: apt install -y npm"
  fi
fi

# --------------------------------------------------------- 7. devolver
azul "7/9  Devolvendo banco e imagens"
mkdir -p data assets/img/uploads
[ -f "$COFRE/site.db" ] && mv "$COFRE/site.db" data/site.db
for wal in site.db-wal site.db-shm; do
  [ -f "$COFRE/$wal" ] && mv "$COFRE/$wal" "data/$wal"
done
for g in gestao.db gestao.db-wal gestao.db-shm; do
  [ -f "$COFRE/$g" ] && mv "$COFRE/$g" "data/$g"
done
[ -d "$COFRE/uploads" ] && cp -rn "$COFRE/uploads/." assets/img/uploads/ 2>/dev/null

# O dono precisa ser o usuário do serviço, não um palpite: com o dono errado o
# SQLite responde "attempt to write a readonly database" e o painel não salva.
DONO=$($SC show "$SERVICO" -p User --value 2>/dev/null); [ -z "$DONO" ] && DONO="root"
GRUPO=$($SC show "$SERVICO" -p Group --value 2>/dev/null); [ -z "$GRUPO" ] && GRUPO="$DONO"
# O chown só serve quando o deploy roda como ROOT: aí os arquivos nasceriam de
# root e o serviço não conseguiria escrever. Rodando como o próprio dono, é
# comando sem efeito que ainda por cima falha em alguns sistemas.
if [ "$SOU_ROOT" = "1" ]; then chown -R "$DONO:$GRUPO" data assets/img/uploads backups 2>/dev/null; fi
chmod 755 data assets/img/uploads 2>/dev/null
# backups: 750 na pasta, 640 nos arquivos (é o banco inteiro, com hash e chaves)
[ -d backups ] && chmod 750 backups 2>/dev/null && find backups -name '*.db' -exec chmod 640 {} + 2>/dev/null
[ -f data/site.db ] && chmod 644 data/site.db
[ -f data/gestao.db ] && chmod 644 data/gestao.db
[ -f data/gestao.chave ] && chmod 600 data/gestao.chave
verde "     de volta no lugar (dono: $DONO:$GRUPO)"

$SC start "$SERVICO"
$SC start lash-prospector.service 2>/dev/null
sleep 3

# -------------------------------------------------------- 8. publicar
# O HTML é gerado a partir do banco. Se o pull trouxe template novo, é aqui que
# ele encontra o conteúdo — sem isso o site fica com o HTML do commit.
azul "8/9  Republicando o site a partir do banco"
if sudo -u "$DONO" node server.js --publicar 2>&1 | sed 's/^/     /'; then
  verde "     páginas regeneradas"
else
  amarelo "     publish falhou — o site segue com o HTML do repositório"
fi

# ----------------------------------------------------------- 9. testar
azul "9/9  Conferindo"
DEPOIS=$(inventario)
echo "     antes : $ANTES"
echo "     depois: $DEPOIS"
if [ "$ANTES" != "$DEPOIS" ] && [ "$ANTES" != "SEM BANCO" ]; then
  restaurar_e_sair "     O CONTEÚDO MUDOU. Restaurando por segurança."
fi

OK=0
for _ in $(seq 1 10); do
  CODIGO=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$PORTA/" || echo 000)
  [ "$CODIGO" = "200" ] && { OK=1; break; }
  sleep 2
done

rm -rf "$COFRE"

if [ "$OK" = "1" ]; then
  echo
  verde "Deploy concluído — site no ar em https://luizaugust.me"
  echo "  Backup desta atualização: ${BACKUP:-nenhum (primeira instalação)}"
  echo
  echo "  Backup automático (diário, dentro do serviço):"
  node server.js --backup-status 2>/dev/null | sed 's/^/    /'
else
  echo
  vermelho "O site não respondeu (HTTP $CODIGO). Últimas linhas do log:"
  journalctl -u "$SERVICO" -n 25 --no-pager | sed 's/^/  /'
  echo
  amarelo "O banco está intacto em data/site.db e no backup:"
  amarelo "  ${BACKUP:-(sem backup — primeira instalação)}"
  exit 1
fi
