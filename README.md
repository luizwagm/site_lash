# LA Software House — site + gerenciador

Site institucional e de captação da **LA Software House**, com painel de
conteúdo próprio. O HTML é estático; o conteúdo vem do banco e é assado no
arquivo pelo botão **Publicar**.

- **Domínio:** luizaugust.me · **Porta interna:** 5180 · **Serviço:** `lash.service`
- **Stack:** Node puro (`node:http`) + SQLite via **better-sqlite3**. Exige **Node ≥ 20**.
- **Painel:** `/admin/` — senha inicial `la-admin` (**troque antes de divulgar o site**).
- **Gestão da agência:** `/restrito/` — leads, funil e prospecção (ver seção própria).

## Como o conteúdo funciona

**Nada é editado no HTML.** O conteúdo vive em `data/site.db` e o botão
**Publicar** regenera os arquivos estáticos:

- `index.html` tem 14 marcadores `<!--#CHAVE-->…<!--/CHAVE-->` que o publish
  substitui. **Nunca remova esses marcadores** — sem eles o publish não tem
  onde escrever e a seção some.
- O publish também regenera `assets/data/projects.json` e `assets/js/config.js`,
  e roda o `build.js`, que monta as páginas de case em `projeto/<id>/` e o
  `sitemap.xml`.
- Tabelas: `settings`, `projects`, `services`, `testimonials`, `faq`, `process`.

O menu do painel segue as seções do site: Publicar, Topo (Hero), Tecnologias,
Serviços, Projetos, Processo, Diferenciais, Depoimentos, FAQ, Contato, Rodapé,
Senha.

## Gestão da agência (/restrito)

Área logada SEPARADA do painel de conteúdo, para a operação comercial. A
mecânica veio do bot de representação (jeans_hunter), generalizada para
qualquer segmento. Código em `restrito.js` + `restrito/app.html`; banco
próprio em `data/gestao.db` (WAL — dois processos escrevem nele).

- **Login inicial:** `contato@luizaugust.me` / `la-restrito` (**troque na aba Senha**).
- **Leads:** captação pelo Google Places (qualquer nicho + cidade — a flag
  "sem site próprio" é o gancho de venda), cadastro manual, filtros, histórico
  de contato por lead e mensagem de 1º contato escrita pela IA para enviar
  pelo `wa.me`.
- **Funil (11 etapas):** kanban com arrastar-e-soltar; a automação espelha o
  status da conversa no funil, mas **nunca rebaixa** etapa marcada por humano.
- **Prospecção automática:** lotes de primeiro contato + follow-ups em
  24h/48h/72h/5d, teto diário (só conta envio da IA), janela de horário no
  fuso do negócio, intervalo aleatório de 45–180s entre envios, opt-out
  respeitado em todos os caminhos. **O kill-switch nasce DESLIGADO.**
- **IA vendedora:** responde as empresas com saída estruturada; nunca escreve
  URL (marca `[LINK]` e o código resolve para o site/case do portfólio; link
  externo derruba a mensagem); quem fala em fechar/valores/prazo vai para
  humano; quem pede para parar vira opt-out.
- **Worker do WhatsApp:** `node prospector.js` (processo separado, Baileys —
  dependência opcional). QR de pareamento aparece em Prospecção → Conexão.
  `node prospector.js --seco` roda o motor sem enviar nada (teste).
  Em produção: `sudo cp lash-prospector.service /etc/systemd/system/ &&
  sudo systemctl enable --now lash-prospector` (e atualizar o
  `/etc/sudoers.d/lash` com o `ci/sudoers-lash` novo, senão o deploy não
  consegue parar/subir o worker).
- **Chaves de API** (Anthropic para a IA, Google Places para a captação):
  em Prospecção → Config. A chave gravada nunca volta ao navegador.
- O `gestao.db` entra no mesmo backup diário do `site.db` e no cofre do
  `deploy.sh`.

## Subir pela primeira vez

A ordem importa: o serviço tem de estar no ar **antes** do nginx, e o nginx
antes do certificado (o Let's Encrypt valida acessando o domínio).

```bash
# 1. código no servidor
sudo mkdir -p /var/www/projetos && cd /var/www/projetos
sudo git clone https://github.com/luizwagm/site_lash.git LA-Software-House
cd LA-Software-House

# 2. dependências e dono das pastas graváveis
sudo npm ci --omit=dev
sudo mkdir -p data backups assets/img/uploads
sudo chown -R deploy:deploy /var/www/projetos/LA-Software-House

# 3. serviço
sudo cp lash.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now lash
sudo systemctl status lash          # precisa estar "active (running)"
curl -I http://127.0.0.1:5180/      # precisa responder 200

# 4. DNS: registro A de luizaugust.me e de www apontando para o IP do servidor
#    (confira ANTES — sem DNS o certificado não sai, e o Let's Encrypt
#     limita 5 falhas por hora no mesmo domínio)

# 5. nginx + HTTPS, tudo num comando
sudo ./nginx/criar_site.sh luizaugust.me 5180 contato@luizaugust.me

# 6. TROCAR A SENHA do painel em https://luizaugust.me/admin/
```

## Operação do dia a dia

```bash
./verificar.sh          # só lê: commit, driver, permissões, conteúdo, backups, HTTPS
sudo ./deploy.sh        # backup → para → protege banco → pull → npm ci → devolve → publica → confere
```

- **Nunca `git pull` puro.** O banco não é versionado; o `deploy.sh` o tira do
  caminho antes do pull e devolve depois.
- **`git pull` não reinicia o Node.** Alterou `server.js`? Reinicie.
- **`git pull` não instala dependência.** O `deploy.sh` roda `npm ci` no passo 6.
- **Mudou texto ou imagem no painel?** Clique em **Publicar**.
- CSS e `assets/js/` são servidos direto — não precisam de publish.

## Backup

O site tira backup **sozinho, todo dia**, sem depender de cron: o `backup.js`
roda dentro do processo e, de hora em hora, pergunta se já passaram 24h desde a
última cópia. Se a máquina estava desligada na hora marcada, a cópia sai no
próximo boot em vez de ser pulada.

- **Como copia:** `VACUUM INTO` — o backup online do SQLite, consistente mesmo
  com o site no ar. Copiar o `.db` com `cp` não dá essa garantia (o WAL fica em
  outro arquivo).
- **Confere sozinho:** toda cópia é aberta e passa por `integrity_check` antes
  de contar como válida. Cópia quebrada é apagada e vira erro no log.
- **Onde:** `backups/` (fora do git). Guarda as 30 últimas.

```bash
node server.js --backup          # copia agora
node server.js --backup-status   # quando foi a última, quantas existem
sudo ./restaurar.sh              # lista os backups
sudo ./restaurar.sh ultimo       # restaura o mais recente (e republica o site)
```

## Segurança

Senha com **scrypt + salt** (migra do sha256 antigo no primeiro login certo),
trava de 5 tentativas por 15 min por IP, sessão de 12h, troca de senha derruba
as outras sessões. Cabeçalhos nosniff / X-Frame-Options / Referrer-Policy +
HSTS sob HTTPS + CSP no `/admin`. A aplicação escuta só em `127.0.0.1` — quem
fala com o mundo é o nginx. Upload aceita só PNG/JPG/WEBP/GIF (**SVG não**: é
XML e executaria script na origem do site).

**O que NÃO é servido pela web:** `data/`, `src/`, `node_modules/`, `nginx/`,
`backups/`, dotfiles, e todo `.js`/`.json` que não esteja em `/assets/`.
A regra é por LOCAL, não por nome de arquivo — um bloqueio que precisa ser
lembrado a cada arquivo novo nasce furado (foi assim que `db.js`, `backup.js` e
`build.js` ficaram baixáveis até a v1.2.0).

Bateria de 49 testes de invasão em `scratchpad/lash-pentest.cjs` (acesso sem
sessão, exposição de arquivos, traversal, cabeçalhos, sessão, CORS, SQLi,
upload, vazamento de erro, força bruta).

## Pendências conhecidas

- **A senha antiga está no histórico do Git.** O commit `76f53a6`, já enviado ao
  GitHub, contém `data/site.db` com o hash da senha em **sha256 sem salt** —
  quebrável por dicionário em segundos, e `la-admin` está em qualquer lista. O
  banco já saiu do índice, mas o histórico permanece. **Troque a senha do
  painel** e considere tornar o repositório privado ou reescrever o histórico.
- **Backup só existe dentro do servidor.** Cobre erro humano e corrupção, não
  perda da máquina. Falta destino externo.
- **Os 6 cases são conteúdo fictício** — trocar por projetos reais.
- **`projeto/sistema-intranet/`** existe no disco mas não está no banco: página
  órfã, sem link e fora do sitemap. Decidir se volta ou se a pasta sai.
