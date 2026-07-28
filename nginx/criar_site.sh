#!/usr/bin/env bash
# ==========================================================================
#  criar_site.sh — cria o vhost do nginx e emite o certificado (LA Software House)
#
#  Uso:  sudo ./criar_site.sh <dominio> <porta> [email]
#  Ex.:  sudo ./criar_site.sh luizaugust.me 5180 contato@luizaugust.me
#
#  Antes de rodar, o DNS precisa estar apontando para este servidor. O script
#  confere isso e para se não estiver — certificado não sai com DNS errado, e
#  o Let's Encrypt limita 5 falhas por hora para o mesmo domínio.
# ==========================================================================
set -uo pipefail

DOMINIO="${1:-}"
PORTA="${2:-}"
EMAIL="${3:-admin@$DOMINIO}"
# raiz da aplicação: de onde o nginx lê a página de manutenção nas quedas
APP_ROOT="${APP_ROOT:-$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)}"

[ -z "$DOMINIO" ] || [ -z "$PORTA" ] && {
  echo "Uso: sudo $0 <dominio> <porta> [email]"; exit 1; }

verde()   { printf "\033[1;32m%s\033[0m\n" "$1"; }
amarelo() { printf "\033[1;33m%s\033[0m\n" "$1"; }
vermelho(){ printf "\033[1;31m%s\033[0m\n" "$1"; }

# ------------------------------------------------------- 1. conferir o DNS
echo "1/5  Conferindo DNS de $DOMINIO"

# Todos os endereços desta máquina: IPv4 e IPv6, locais e o público visto de fora.
# Servidor Hetzner tem os dois — comparar só com um deles dá falso negativo
# (foi o que aconteceu: ifconfig.me devolveu o IPv6 e o registro A é IPv4).
MEUS_IPS=$(
  { ip -o addr show scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1
    curl -4 -s --max-time 8 https://ifconfig.me 2>/dev/null
    curl -6 -s --max-time 8 https://ifconfig.me 2>/dev/null
  } | sort -u | grep -v '^$'
)
[ -n "${IP_SERVIDOR:-}" ] && MEUS_IPS="$MEUS_IPS
$IP_SERVIDOR"   # permite forçar com IP_SERVIDOR=... ./criar-site.sh

resolve() { dig +short "$2" "$1" 2>/dev/null | grep -E '^[0-9a-fA-F.:]+$' | tail -1; }
aponta_para_ca() {
  local alvo="$1"
  [ -z "$alvo" ] && return 1
  echo "$MEUS_IPS" | grep -qxF "$alvo"
}

A_DOM=$(resolve "$DOMINIO" A);        AAAA_DOM=$(resolve "$DOMINIO" AAAA)
A_WWW=$(resolve "www.$DOMINIO" A);    AAAA_WWW=$(resolve "www.$DOMINIO" AAAA)
CNAME_APEX=$(dig +short CNAME "$DOMINIO" 2>/dev/null)

echo "     IPs deste servidor : $(echo "$MEUS_IPS" | tr '\n' ' ')"
echo "     $DOMINIO           : ${A_DOM:-—} ${AAAA_DOM:-}"
echo "     www.$DOMINIO       : ${A_WWW:-—} ${AAAA_WWW:-}"

if [ -n "$CNAME_APEX" ]; then
  vermelho "     ERRO: o domínio raiz está como CNAME ($CNAME_APEX)."
  vermelho "     CNAME no apex é inválido (RFC 1034) e quebra a validação. Use registro A."
  exit 1
fi

if aponta_para_ca "$A_DOM" || aponta_para_ca "$AAAA_DOM"; then
  verde "     DNS ok — o domínio resolve para este servidor"
else
  amarelo "     O DNS não bateu com nenhum IP detectado aqui."
  # A detecção pode falhar atrás de proxy/NAT. O teste que importa é se uma
  # requisição pelo domínio chega NESTE nginx — é isso que o certbot precisa.
  MARCA="/var/www/html/.dns-check-$$"
  mkdir -p /var/www/html && echo "ok-$$" > "$MARCA"
  RESP=$(curl -s --max-time 10 "http://$DOMINIO/.dns-check-$$" || true)
  rm -f "$MARCA"
  if [ "$RESP" = "ok-$$" ]; then
    verde "     mas a requisição pelo domínio chegou NESTE servidor — seguindo"
  else
    vermelho "     e a requisição pelo domínio também não chegou aqui."
    vermelho "     Crie um registro A: $DOMINIO -> $(echo "$MEUS_IPS" | grep -m1 '\.')"
    vermelho "     Se tiver certeza do DNS, force com:"
    vermelho "       sudo IP_SERVIDOR=<seu-ip> $0 $DOMINIO $PORTA"
    exit 1
  fi
fi

DOMINIOS="-d $DOMINIO"
if aponta_para_ca "$A_WWW" || aponta_para_ca "$AAAA_WWW" || [ "$A_WWW" = "$A_DOM" ]; then
  DOMINIOS="$DOMINIOS -d www.$DOMINIO"
  verde "     www também resolve para cá — entra no mesmo certificado"
else
  amarelo "     www.$DOMINIO não resolve para cá — certificado só para o domínio raiz"
fi

# ------------------------------------------------- 2. a aplicação responde?
echo "2/5  Testando a aplicação em 127.0.0.1:$PORTA"
CODIGO=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "http://127.0.0.1:$PORTA/" || echo 000)
if [ "$CODIGO" != "200" ]; then
  vermelho "     a aplicação não respondeu (HTTP $CODIGO)."
  vermelho "     Suba o serviço antes: systemctl status <servico>"
  exit 1
fi
verde "     aplicação no ar"

# -------------------------------------------------------------- 3. o vhost
echo "3/5  Criando o vhost"
ARQ="/etc/nginx/sites-available/$DOMINIO"
if [ -f "$ARQ" ]; then
  cp "$ARQ" "$ARQ.bak-$(date +%F-%H%M%S)"
  amarelo "     já existia — copiei para $ARQ.bak-*"
fi

cat > "$ARQ" <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name $DOMINIO www.$DOMINIO;

    # o painel envia foto em base64 no JSON; o padrão de 1 MB devolveria 413
    client_max_body_size 25m;

    access_log /var/log/nginx/$DOMINIO.access.log;
    error_log  /var/log/nginx/$DOMINIO.error.log;

    location ~ /\\.(git|env|gitignore) {
        deny all;
        return 404;
    }


    # ------------------------------------------------------------------
    #  Página de manutenção quando a APLICAÇÃO está fora do ar.
    #  O modo manutenção do painel cobre o caso do app rodando; isto cobre
    #  restart, deploy, git stash e queda — quando não há app para responder.
    #  Sem isto o visitante veria a tela cinza de "502 Bad Gateway".
    # ------------------------------------------------------------------
    error_page 502 503 504 /manutencao.html;
    location = /manutencao.html {
        root $APP_ROOT;
        internal;
        add_header Retry-After 3600 always;
        add_header Cache-Control "no-store" always;
    }

    location / {
        proxy_pass http://127.0.0.1:$PORTA;
        proxy_http_version 1.1;

        proxy_set_header Host              \$host;
        proxy_set_header X-Real-IP         \$remote_addr;
        # sem estes dois a aplicação vê todo mundo como 127.0.0.1: o contador
        # de tentativas de login valeria para o servidor todo, e o cookie de
        # sessão do painel perderia a marca Secure
        proxy_set_header X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;

        proxy_connect_timeout 10s;
        proxy_read_timeout    60s;
    }
}
NGINX

ln -sf "$ARQ" "/etc/nginx/sites-enabled/$DOMINIO"
if ! nginx -t 2>&1 | sed 's/^/     /'; then
  vermelho "     configuração inválida — nada foi recarregado"
  exit 1
fi
systemctl reload nginx
verde "     vhost ativo em HTTP"

# ----------------------------------------------------------- 4. certificado
echo "4/5  Emitindo o certificado"
# shellcheck disable=SC2086
if certbot --nginx $DOMINIOS --redirect --agree-tos --no-eff-email -m "$EMAIL" --non-interactive; then
  verde "     certificado emitido e HTTPS ativado"
else
  vermelho "     o certbot falhou. O site segue funcionando em HTTP."
  vermelho "     Veja /var/log/letsencrypt/letsencrypt.log"
  exit 1
fi

# --------------------------------------------------------------- 5. testes
echo "5/5  Conferindo"
sleep 2
HTTPS=$(curl -s -o /dev/null -w "%{http_code}" "https://$DOMINIO/" || echo 000)
REDIR=$(curl -s -o /dev/null -w "%{http_code}" "http://$DOMINIO/" || echo 000)
echo "     https://$DOMINIO      -> $HTTPS"
echo "     http (deve ser 301)   -> $REDIR"
certbot renew --dry-run >/dev/null 2>&1 \
  && verde "     renovação automática testada com sucesso" \
  || amarelo "     atenção: o teste de renovação falhou — rode 'certbot renew --dry-run'"

echo
if [ "$HTTPS" = "200" ]; then
  verde "Pronto: https://$DOMINIO no ar."
else
  amarelo "HTTPS respondeu $HTTPS — confira os logs em /var/log/nginx/$DOMINIO.error.log"
fi
