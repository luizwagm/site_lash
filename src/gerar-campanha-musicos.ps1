# =============================================================================
#  CAMPANHA "O CACHÊ COMEÇA ANTES DO PALCO" — LA Software House
#  Vertical: músicos, cantores e bandas.
#
#    powershell -ExecutionPolicy Bypass -File src/gerar-campanha-musicos.ps1
#
#  Saída em assets/img/divulgacao/musicos/:
#    · banner-feed-4x5.png    1080×1350  feed do Instagram (mais tela que 1:1)
#    · banner-quadrado.png    1080×1080  1:1 — envio no WhatsApp, LinkedIn
#    · banner-story-9x16.png  1080×1920  story e status do WhatsApp
#    · anuncio-9x16.png       1080×1920  tráfego pago — menos texto de propósito
#
#  O QUE A PEÇA VENDE, e por que nesta ordem:
#  o músico não compra "site", compra CACHÊ MAIOR e AGENDA CHEIA. Então o que
#  aparece grande é o benefício; a entrega técnica (press kit, Google, loja,
#  sistema) vai em letra miúda embaixo, como prova de que o benefício tem
#  mecanismo. Trocar essa ordem é o erro clássico de material de software
#  house: estampar o substantivo do serviço e esperar que o cliente traduza.
#
#  POR QUE ESTE ARQUIVO NÃO LÊ O data/site.db (o gerar-cartao.ps1 lê):
#  aquele cartão é institucional e deve repetir o que a home publica. Este é
#  CAMPANHA — copy de campanha, recorte de público, oferta de entrada. Nada
#  disso mora no painel, e amarrar ao banco faria uma peça de mídia já
#  aprovada mudar sozinha quando alguém editasse o site.
#
#  DEPENDE DE BOM: o PowerShell 5.1 lê .ps1 sem BOM como ANSI e os acentos
#  saem corrompidos DENTRO DA IMAGEM, sem erro nenhum. Gravar sempre UTF-8
#  com BOM — o gerar-cartao.ps1 deste projeto tem BOM pelo mesmo motivo.
#
#  TIPOGRAFIA: a marca é Space Grotesk + Inter (Google Fonts), que não estão
#  instaladas nesta máquina. Duas saídas, nesta ordem: se houver .ttf em
#  assets/fonts, carrega por PrivateFontCollection SEM instalar nada; senão
#  cai para as faces de sistema mais próximas — as mesmas do cartão
#  institucional, para as duas peças não divergirem de tipografia.
# =============================================================================

Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = "Stop"
$RAIZ   = Split-Path -Parent $PSScriptRoot
$SAIDA  = Join-Path $RAIZ "assets\img\divulgacao\musicos"
$FONTES = Join-Path $RAIZ "assets\fonts"
if (-not (Test-Path $SAIDA)) { New-Item -ItemType Directory -Path $SAIDA -Force | Out-Null }

# ---------------------------------------------------------------- identidade
# Mesmos tokens do styles.css. Não inventar cor aqui: a campanha tem de
# parecer parte do site, porque o site é a prova de quem faz o serviço.
$BG900   = [System.Drawing.Color]::FromArgb(8, 8, 12)
$BG800   = [System.Drawing.Color]::FromArgb(13, 13, 20)
$TEXTO   = [System.Drawing.Color]::FromArgb(243, 244, 251)
$MUDO    = [System.Drawing.Color]::FromArgb(154, 157, 177)
$VIOLETA = [System.Drawing.Color]::FromArgb(124, 92, 255)
$CIANO   = [System.Drawing.Color]::FromArgb(36, 227, 214)

# ------------------------------------------------------------------- fontes
$PRIV = New-Object System.Drawing.Text.PrivateFontCollection
if (Test-Path $FONTES) {
  Get-ChildItem -Path $FONTES -Include *.ttf, *.otf -Recurse -ErrorAction SilentlyContinue |
    ForEach-Object { try { $PRIV.AddFontFile($_.FullName) } catch {} }
}
$privadas   = $PRIV.Families | ForEach-Object { $_.Name }
$instaladas = (New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object { $_.Name }

# A coleção precisa viajar junto com o nome: o construtor de Font só encontra
# a face privada se receber o FontFamily vindo da coleção dela.
function Familia([string[]]$nomes) {
  foreach ($n in $nomes) {
    if ($privadas -contains $n)   { return (New-Object System.Drawing.FontFamily($n, $PRIV)) }
    if ($instaladas -contains $n) { return (New-Object System.Drawing.FontFamily($n)) }
  }
  return (New-Object System.Drawing.FontFamily("Arial"))
}
$FAM_TIT   = Familia @("Space Grotesk", "Segoe UI Variable Display", "Segoe UI", "Arial")
$FAM_CORPO = Familia @("Inter", "Segoe UI Variable Text", "Segoe UI", "Arial")
$FAM_MONO  = Familia @("JetBrains Mono", "Cascadia Mono", "Consolas", "Courier New")

$NEGRITO = [System.Drawing.FontStyle]::Bold
$NORMAL  = [System.Drawing.FontStyle]::Regular

# ----------------------------------------------------------------- conteúdo
# Toda a copy em um lugar: quem revisa texto não precisa ler desenho, e quem
# mexe no desenho não arrisca o texto.
$ZAP        = "(81) 97101-0607"
$SITE       = "luizaugust.me"
$PUBLICO    = "PARA MÚSICOS, CANTORES E BANDAS"
$HOOK_A     = @("O CACHÊ COMEÇA", "ANTES DO PALCO.")
$HOOK_ALTO  = @("O CACHÊ", "COMEÇA ANTES", "DO PALCO.")
$DESTAQUE   = "CACHÊ"          # única palavra com o gradiente: a do dinheiro
$SUB        = @(
  "Quem te contrata pesquisa você antes de fechar o valor.",
  "Se acha só um perfil bagunçado, negocia para baixo."
)

# AS VANTAGENS. Benefício em caixa-alta (o desejo) + mecanismo em uma linha
# (a prova). Quatro é o limite: o quinto item começa a roubar tamanho dos
# outros quatro e a peça inteira encolhe junto.
$VANTAGENS = @(
  @{ b = "CACHÊ MAIOR";   m = "press kit que corta a pechincha" },
  @{ b = "AGENDA CHEIA";  m = "quem contrata te acha no Google" },
  @{ b = "VENDA DIRETA";  m = "ingresso, camiseta e aula online" },
  @{ b = "MENOS DIRECT";  m = "o sistema responde preço e data" }
)

$OFERTA     = "ANÁLISE GRATUITA DO SEU PERFIL"
$ROTULO_ZAP = "CHAME NO WHATSAPP"
$ANOS_NUM   = "15+"
$ANOS_TXT   = "anos"

# Motivo das barras do rodapé: as alturas do símbolo da marca (20/30/26/16),
# repetidas ao longo da faixa. O logo já tinha leitura de equalizador no
# conceito — aqui essa leitura é ativada em vez de inventar um grafismo novo.
$ALTURAS = @(20, 30, 26, 16)
$ALT_MAX = 30

# -------------------------------------------------------------------- apoio
# O PowerShell 5.1 não tem operador ternário (é do 7). Este ajudante mantém
# as linhas de medida curtas o bastante para se ler de uma vez.
function Se([bool]$c, $a, $b) { if ($c) { return $a } else { return $b } }

# MEDIDA TIPOGRÁFICA, não a padrão do GDI+: o MeasureString comum acrescenta
# respiro nas pontas para acomodar itálico e overhang, e medindo assim a
# palavra seguinte sai com um vão fantasma no meio da frase. Medir e desenhar
# com o MESMO StringFormat é a única forma das duas contas fecharem.
$FMT = [System.Drawing.StringFormat]::GenericTypographic

function Fonte($fam, [single]$tam, $estilo) {
  return (New-Object System.Drawing.Font($fam, $tam, $estilo, [System.Drawing.GraphicsUnit]::Pixel))
}
# O GenericTypographic resolve o vão fantasma no meio da frase, mas cobra o
# preço de NÃO CONTAR o avanço de espaço no fim da medição. Medindo "O " ele
# devolve a largura de "O", e a palavra seguinte era desenhada em cima — foi
# assim que saiu "OCACHÊ COMEÇA" na primeira rodada. A sentinela resolve:
# mede com um caractere de apoio no fim e desconta esse caractere, então o
# espaço passa a contar como o desenho o desenha.
function Larg($g, [string]$t, $fam, [single]$tam, $estilo) {
  $f = Fonte $fam $tam $estilo
  $p0 = [System.Drawing.PointF]::new(0, 0)
  $w = $g.MeasureString(($t + "|"), $f, $p0, $FMT).Width - $g.MeasureString("|", $f, $p0, $FMT).Width
  $f.Dispose(); return $w
}
function Txt($g, [string]$t, $fam, [single]$tam, $estilo, $pincel, [single]$x, [single]$y) {
  $f = Fonte $fam $tam $estilo
  $g.DrawString($t, $f, $pincel, [System.Drawing.PointF]::new([single]$x, [single]$y), $FMT)
  $f.Dispose()
}
# Desenha caindo o corpo até caber na largura dada. Arte de campanha não pode
# vazar da margem: é melhor um ponto menor do que um remendo.
function TxtCabe($g, [string]$t, $fam, [single]$tam, $estilo, $pincel, [single]$x, [single]$y, [single]$max) {
  $w = Larg $g $t $fam $tam $estilo
  if ($w -gt $max) { $tam = [single]($tam * ($max / $w)) }
  Txt $g $t $fam $tam $estilo $pincel $x $y
  return $tam
}

# Entreletra (tracking). O GDI+ não tem: desenha caractere por caractere
# somando o vão. Só para caixa-alta pequena — em texto corrido o tracking
# manual perde o kerning e fica pior que sem.
# Desenhando caractere por caractere, o espaço é medido isolado — e isolado
# ele mede ZERO no formato tipográfico. Resultado da primeira rodada:
# "PARAMÚSICOS,CANTORESEBANDAS". O avanço do espaço passa a ser explícito.
$AVANCO_ESPACO = 0.34      # fração do corpo; 0.34 é o espaço de uma grotesca
function AvancoChar($g, $f, [char]$c, [single]$tam) {
  if ([char]::IsWhiteSpace($c)) { return [single]($tam * $AVANCO_ESPACO) }
  return $g.MeasureString([string]$c, $f, [System.Drawing.PointF]::new(0, 0), $FMT).Width
}
function TxtTrack($g, [string]$t, $fam, [single]$tam, $estilo, $pincel, [single]$x, [single]$y, [single]$vao) {
  $f = Fonte $fam $tam $estilo
  $cx = [single]$x
  foreach ($c in $t.ToCharArray()) {
    if (-not [char]::IsWhiteSpace($c)) {
      $g.DrawString([string]$c, $f, $pincel, [System.Drawing.PointF]::new($cx, [single]$y), $FMT)
    }
    $cx += (AvancoChar $g $f $c $tam) + $vao
  }
  $f.Dispose()
}
function LargTrack($g, [string]$t, $fam, [single]$tam, $estilo, [single]$vao) {
  $f = Fonte $fam $tam $estilo
  $w = [single]0
  foreach ($c in $t.ToCharArray()) { $w += (AvancoChar $g $f $c $tam) + $vao }
  $f.Dispose(); return ($w - $vao)
}

function Arred([single]$x, [single]$y, [single]$w, [single]$h, [single]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  if ($r -le 0 -or $w -le 0 -or $h -le 0) {
    $p.AddRectangle((New-Object System.Drawing.RectangleF($x, $y, [Math]::Max($w,1), [Math]::Max($h,1)))); return $p
  }
  $r = [Math]::Min($r, [Math]::Min($w, $h) / 2)
  $d = $r * 2
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure(); return $p
}

function Aurora($g, [single]$cx, [single]$cy, [single]$raio, $cor, [int]$alfa) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $p.AddEllipse($cx - $raio, $cy - $raio, $raio * 2, $raio * 2)
  $b = New-Object System.Drawing.Drawing2D.PathGradientBrush($p)
  $b.CenterColor = [System.Drawing.Color]::FromArgb($alfa, $cor)
  $b.SurroundColors = @([System.Drawing.Color]::FromArgb(0, $cor))
  $g.FillPath($b, $p); $b.Dispose(); $p.Dispose()
}

# FACHO DE PALCO — o gradiente da marca com função narrativa em vez de
# decorativa: um trapézio que desce do alto, aceso em cima e dissolvido
# embaixo. É o ÚNICO elemento aceso forte do fundo; empilhar mais gradiente
# aqui só sujaria a leitura do título.
function Facho($g, [int]$L, [int]$A) {
  $pts = @(
    [System.Drawing.PointF]::new([single]($L * 0.24), [single](-30)),
    [System.Drawing.PointF]::new([single]($L * 0.56), [single](-30)),
    [System.Drawing.PointF]::new([single]($L * 1.20), [single]($A * 0.80)),
    [System.Drawing.PointF]::new([single](-$L * 0.12), [single]($A * 0.80))
  )
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $p.AddPolygon($pts)
  $r = New-Object System.Drawing.Rectangle(0, -30, $L, [int]($A * 0.80 + 30))
  $b = New-Object System.Drawing.Drawing2D.LinearGradientBrush($r,
        [System.Drawing.Color]::FromArgb(54, $VIOLETA),
        [System.Drawing.Color]::FromArgb(0, $VIOLETA), 90.0)
  $g.FillPath($b, $p); $b.Dispose(); $p.Dispose()
}

# Emblema da marca (logo v4: 4 barras + fundação do L; sem estrela, sem cena).
function Emblema($g, [single]$x, [single]$y, [single]$tam) {
  $u = $tam / 64.0
  $branco = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
  $g.FillRectangle($branco, $x + 6 * $u, $y + 10 * $u, 7 * $u, 40 * $u)
  $g.FillRectangle($branco, $x + 6 * $u, $y + 44 * $u, 52 * $u, 6 * $u)
  $ret = New-Object System.Drawing.Rectangle(([int]($x + 16 * $u)), ([int]$y), ([int](44 * $u)), ([int](50 * $u)))
  $grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush($ret, $CIANO, $VIOLETA, 60.0)
  for ($i = 0; $i -lt 4; $i++) {
    $bh = $ALTURAS[$i] * $u
    $p = Arred ($x + (17 + $i * 11) * $u) ($y + 44 * $u - $bh) (8 * $u) $bh (2 * $u)
    $g.FillPath($grad, $p); $p.Dispose()
  }
  $grad.Dispose(); $branco.Dispose()
}

# ===========================================================================
#  VANTAGENS 2×2
#
#  Por que grade de dois e não lista de quatro: numa lista vertical de itens
#  do mesmo peso o olho não tem porta de entrada — em miniatura no feed vira
#  escada cinza (é o defeito do cartão institucional atual). Em 2×2 cada
#  benefício ganha o dobro de corpo e os quatro se leem num varrimento em Z.
#
#  A barrinha vertical em gradiente à esquerda é o mesmo marcador dos cartões
#  de serviço do site: componente repetido, não enfeite novo. As alturas dela
#  seguem o perfil do símbolo, então a grade também carrega a marca.
# ===========================================================================
#  A altura do bloco é função só dos corpos — por isso ela também é calculável
#  ANTES de desenhar (AltVantagens), que é o que permite a guarda de espaço lá
#  embaixo. Com $tamM = 0 o bloco sai sem as legendas: é a versão do 1:1, que
#  não tem altura para carregar mecanismo e nem precisa, porque quem recebe a
#  peça no WhatsApp já está numa conversa.
function AltVantagens([single]$tamB, [single]$tamM) {
  return [single](($tamB * 1.28 + (Se ($tamM -gt 0) ($tamM * 1.95) 0)) * 2 + $tamB * 0.86)
}
function Vantagens($g, [single]$x, [single]$y, [single]$larg, [single]$tamB, [single]$tamM) {
  $vaoCol = [single]46
  $col = [single](($larg - $vaoCol) / 2)
  $pTexto = New-Object System.Drawing.SolidBrush $TEXTO
  $pMudo  = New-Object System.Drawing.SolidBrush $MUDO

  $altLinha = [single]($tamB * 1.28 + (Se ($tamM -gt 0) ($tamM * 1.95) 0))
  $vaoLinha = [single]($tamB * 0.86)

  for ($i = 0; $i -lt $VANTAGENS.Count; $i++) {
    $cx = [single]($x + ($i % 2) * ($col + $vaoCol))
    $cy = [single]($y + [Math]::Floor($i / 2) * ($altLinha + $vaoLinha))

    # marcador: barra em gradiente, altura pelo perfil do símbolo
    $hM = [single]($tamB * (0.62 + 0.38 * ($ALTURAS[$i] / $ALT_MAX)))
    $rM = New-Object System.Drawing.Rectangle(([int]$cx), ([int]$cy), 8, ([int]$hM))
    $gm = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rM, $CIANO, $VIOLETA, 90.0)
    $pm = Arred $cx ($cy + $tamB * 0.10) 8 $hM 4
    $g.FillPath($gm, $pm); $pm.Dispose(); $gm.Dispose()

    $tx = [single]($cx + 30)
    $lu = [single]($col - 30)
    TxtCabe $g $VANTAGENS[$i].b $FAM_TIT $tamB $NEGRITO $pTexto $tx $cy $lu | Out-Null
    if ($tamM -gt 0) {
      TxtCabe $g $VANTAGENS[$i].m $FAM_CORPO $tamM $NORMAL $pMudo $tx ($cy + $tamB * 1.26) $lu | Out-Null
    }
  }
  $pTexto.Dispose(); $pMudo.Dispose()
  return [single]($altLinha * 2 + $vaoLinha)
}

# ===========================================================================
#  FAIXA DE NÍVEL — o símbolo da marca virado equalizador, com reflexo.
#  Só grafismo, sem texto: ela fecha a composição e dá chão de palco à peça.
#  A envoltória senoidal existe para as barras não saírem mecânicas — o
#  motivo 20/30/26/16 puro e repetido lê como listra, não como som.
# ===========================================================================
function Faixa($g, [single]$x, [single]$y, [single]$larg, [single]$alt) {
  $bw = [single]22
  # Quantas barras cabem com o vão desejado, e DEPOIS o vão exato para elas
  # preencherem a largura inteira. Sem esta segunda conta a régua do chão
  # sobrava uns 40px depois da última barra e a faixa parecia cortada.
  $n = [int][Math]::Floor(($larg + 18) / ($bw + 18))
  $vao = [single](($larg - $n * $bw) / ($n - 1))
  $base = [single]($y + $alt)
  for ($i = 0; $i -lt $n; $i++) {
    $env = 0.50 + 0.50 * [Math]::Abs([Math]::Sin(($i + 1) * 0.62))
    $bh = [single]($alt * ($ALTURAS[$i % 4] / $ALT_MAX) * $env)
    if ($bh -lt 8) { $bh = 8 }
    $bx = [single]($x + $i * ($bw + $vao))
    $by = [single]($base - $bh)
    $r = New-Object System.Drawing.Rectangle(([int]$bx), ([int]$by), ([int]$bw), ([int]$bh))
    $gb = New-Object System.Drawing.Drawing2D.LinearGradientBrush($r, $CIANO, $VIOLETA, 90.0)
    $p = Arred $bx $by $bw $bh 6
    $g.FillPath($gb, $p); $p.Dispose(); $gb.Dispose()

    # reflexo curto no chão: é o que faz a faixa POUSAR em vez de flutuar
    $hr = [single]([Math]::Min($bh * 0.34, $alt * 0.22))
    $rr = New-Object System.Drawing.Rectangle(([int]$bx), ([int]$base + 3), ([int]$bw), ([int][Math]::Max($hr, 1)))
    $gr = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rr,
            [System.Drawing.Color]::FromArgb(64, $VIOLETA),
            [System.Drawing.Color]::FromArgb(0, $VIOLETA), 90.0)
    $pr = Arred $bx ($base + 3) $bw $hr 6
    $g.FillPath($gr, $pr); $pr.Dispose(); $gr.Dispose()
  }
  $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(64, 255, 255, 255)), 2
  $g.DrawLine($pen, $x, $base, $x + $larg, $base); $pen.Dispose()
}

# ===========================================================================
#  A ARTE
#
#  LAYOUT POR ESPAÇO CALCULADO. O rodapé (oferta + WhatsApp) é reservado
#  ANTES de tudo; a faixa de nível ancora imediatamente acima dele e o miolo
#  recebe o que sobra. Altura chutada só funciona enquanto a copy não muda —
#  e copy de campanha muda até a hora de subir o anúncio.
# ===========================================================================
function Gerar([int]$L, [int]$A, [string]$arquivo, [string]$variante) {
  $bmp = New-Object System.Drawing.Bitmap($L, $A)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

  $alto = (($A / $L) -gt 1.4)         # story / anúncio 9:16

  # CADA FORMATO É UMA PEÇA, não a mesma peça esticada. O que cada um carrega:
  #   feed 4:5   — tudo: dor, benefício, mecanismo, oferta, contato, site
  #   quadrado   — sem a linha de dor e SEM mecanismo: no 1080×1080 os quatro
  #                benefícios só chegam a corpo desejável se as legendas
  #                saírem. Menos palavra também é o certo aqui, porque o 1:1
  #                circula no WhatsApp, onde a conversa já está aberta.
  #   story      — tudo, com folga de interface no topo e no pé
  #   anúncio    — sem a linha de dor: em mídia paga, texto a menos lê melhor
  #                e a explicação acontece na conversa, não na arte
  $temSub     = ($variante -eq "feed" -or $variante -eq "story")
  $temLegenda = ($variante -ne "quadrado")
  $temSite    = ($variante -eq "feed" -or $variante -eq "story")

  # ---- fundo
  $rTudo = New-Object System.Drawing.Rectangle(0, 0, $L, $A)
  $fundo = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rTudo, $BG800, $BG900, 90.0)
  $g.FillRectangle($fundo, $rTudo); $fundo.Dispose()

  Facho $g $L $A
  Aurora $g ($L * 0.40) ($A * 0.03) ($L * 0.54) $VIOLETA 88
  Aurora $g ($L * 1.04) ($A * 0.58) ($L * 0.44) $CIANO   54

  $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(10, 255, 255, 255)), 1
  for ($x = 0; $x -lt $L; $x += 60) { $g.DrawLine($pen, $x, 0, $x, $A) }
  for ($y = 0; $y -lt $A; $y += 60) { $g.DrawLine($pen, 0, $y, $L, $y) }
  $pen.Dispose()

  $pTexto = New-Object System.Drawing.SolidBrush $TEXTO
  $pMudo  = New-Object System.Drawing.SolidBrush $MUDO
  $pCiano = New-Object System.Drawing.SolidBrush $CIANO
  $margem = [single]90
  $util   = [single]($L - $margem * 2)

  # No 9:16 o Instagram cobre topo e base com a própria interface; começar em
  # 8,5% da altura mantém a marca fora da faixa do avatar e do nome.
  $y = [single](Se $alto ($A * 0.085) 88)

  # ============================================================ TOPO
  # 15 anos de mercado é o argumento de confiança mais forte que existe para
  # quem nunca contratou desenvolvedor. Fica na MESMA faixa da marca, sem
  # disputar espaço com o conteúdo.
  $lado = [single](Se $alto 118 100)
  $sx = [single]($L - $margem - $lado)
  $p = Arred $sx $y $lado $lado ($lado * 0.26)
  $rS = New-Object System.Drawing.Rectangle(([int]$sx), ([int]$y), ([int]$lado), ([int]$lado))
  $gs = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rS, $VIOLETA, $CIANO, 45.0)
  $g.FillPath($gs, $p); $gs.Dispose(); $p.Dispose()
  $escuro = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 9, 9, 15))
  $tN = [single]($lado * 0.40)
  $wN = Larg $g $ANOS_NUM $FAM_TIT $tN $NEGRITO
  Txt $g $ANOS_NUM $FAM_TIT $tN $NEGRITO $escuro ($sx + ($lado - $wN) / 2) ($y + $lado * 0.19)
  $tL = [single]($lado * 0.17)
  $wL = Larg $g $ANOS_TXT $FAM_CORPO $tL $NEGRITO
  Txt $g $ANOS_TXT $FAM_CORPO $tL $NEGRITO $escuro ($sx + ($lado - $wL) / 2) ($y + $lado * 0.63)
  $escuro.Dispose()

  # Lockup discreto: aqui a marca NÃO é a heroína, a promessa é. Ninguém para
  # de rolar o feed por causa do logo de um fornecedor.
  $tamMarca = [single](Se $alto 37 33)
  Emblema $g $margem ($y + $lado * 0.15) ($tamMarca * 1.72)
  $bxT = [single]($margem + $tamMarca * 2.10)
  $byT = [single]($y + $lado * 0.15 + $tamMarca * 0.52)
  $wLA = Larg $g "LA" $FAM_TIT $tamMarca $NEGRITO
  Txt $g "LA" $FAM_TIT $tamMarca $NEGRITO $pCiano $bxT $byT
  # O vão entre "LA" e "Software House" é explícito: métrica nenhuma conta o
  # espaço final de uma palavra, então ele nunca sairia sozinho.
  Txt $g "Software House" $FAM_TIT $tamMarca $NEGRITO $pTexto ($bxT + $wLA + $tamMarca * 0.30) $byT

  $y += [single]($lado + (Se $alto 54 34))

  # ============================================================ PÚBLICO
  # Primeira linha que o músico lê. Sem isso a peça fala com "todo mundo",
  # que é o mesmo que não falar com ninguém.
  $tEy = [single](Se $alto 27 24)
  TxtTrack $g $PUBLICO $FAM_MONO $tEy $NEGRITO $pCiano $margem $y 2.5
  $y += [single]($tEy * 2.15)

  # ============================================================ HEADLINE
  # "CACHÊ" leva o gradiente — uma única palavra acentuada, a do dinheiro.
  # Marcar mais de uma destrói a função do destaque.
  $linhas = Se $alto $HOOK_ALTO $HOOK_A
  $tamTit = [single](Se $alto 100 88)
  $maisLarga = [single]0
  foreach ($ln in $linhas) {
    $w = Larg $g $ln $FAM_TIT $tamTit $NEGRITO
    if ($w -gt $maisLarga) { $maisLarga = $w }
  }
  if ($maisLarga -gt $util) { $tamTit = [single]($tamTit * ($util / $maisLarga)) }
  # 1.00 de entrelinha é apertado demais para caixa-alta ACENTUADA: a cedilha
  # do "Ç" de COMEÇA descia dentro do "O" de PALCO e parecia sujeira de
  # impressão. Português em versalete precisa de folga em cima (Ê, Ó) e
  # embaixo (Ç) — 1.08 é o mínimo que separa os dois sem soltar as linhas.
  $passo = [single]($tamTit * 1.08)

  foreach ($ln in $linhas) {
    if ($ln.Contains($DESTAQUE)) {
      $i = $ln.IndexOf($DESTAQUE)
      $antes  = $ln.Substring(0, $i)
      $depois = $ln.Substring($i + $DESTAQUE.Length)
      $cx = [single]$margem
      if ($antes.Length -gt 0) {
        Txt $g $antes $FAM_TIT $tamTit $NEGRITO $pTexto $cx $y
        $cx += Larg $g $antes $FAM_TIT $tamTit $NEGRITO
      }
      $wD = Larg $g $DESTAQUE $FAM_TIT $tamTit $NEGRITO
      $rD = New-Object System.Drawing.Rectangle(([int]$cx), ([int]$y), ([int]$wD), ([int]($tamTit * 1.2)))
      $gD = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rD, $VIOLETA, $CIANO, 8.0)
      Txt $g $DESTAQUE $FAM_TIT $tamTit $NEGRITO $gD $cx $y
      $gD.Dispose()
      $cx += $wD
      if ($depois.Length -gt 0) { Txt $g $depois $FAM_TIT $tamTit $NEGRITO $pTexto $cx $y }
    } else {
      Txt $g $ln $FAM_TIT $tamTit $NEGRITO $pTexto $margem $y
    }
    $y += $passo
  }
  # Respiro entre título e subtítulo: com 16px o "ANTES DO PALCO." encostava
  # na primeira linha do apoio e os dois blocos liam como um só parágrafo.
  $y += [single](Se $alto 38 28)

  # ============================================================ SUBTÍTULO
  if ($temSub) {
    $tSub = [single](Se $alto 36 32)
    foreach ($ln in $SUB) {
      Txt $g $ln $FAM_CORPO $tSub $NORMAL $pMudo $margem $y
      $y += [single]($tSub * 1.36)
    }
  }

  # ============================================================ RODAPÉ
  # Reservado ANTES do resto: é ele que decide onde o miolo tem de parar.
  # Sem a linha do site o rodapé encolhe de verdade — não faz sentido reservar
  # espaço para algo que aquela variante não desenha.
  $altRodape = [single](Se $alto 408 316)
  if (-not $temSite) { $altRodape -= [single](Se $alto 58 46) }
  $yRodape = [single]($A - $altRodape)

  # ==================================================== FAIXA + VANTAGENS
  # A faixa é assinatura gráfica, não conteúdo: ancora logo acima do rodapé e
  # ficou baixa de propósito, para não disputar atenção com os benefícios.
  # No 1:1 a faixa é a primeira coisa a ceder altura: ela é assinatura, e os
  # quatro benefícios são o argumento de venda. Deixá-los em 35px para manter
  # o grafismo em 78px seria inverter a prioridade da peça.
  $altFaixa = [single](Se $alto 100 (Se $temSub 78 58))
  $yFaixa   = [single]($yRodape - $altFaixa - (Se $alto 86 46))

  # GUARDA DE ESPAÇO — o conserto que importa. Na rodada anterior a faixa foi
  # desenhada POR CIMA das legendas: o bloco de vantagens tinha altura fixa e,
  # quando a entrelinha do título cresceu, ele passou do limite sem ninguém
  # reclamar. Agora o vão real é medido e o bloco se ajusta a ele. Se um dia a
  # copy crescer, a peça sai com o benefício um ponto menor — nunca com
  # grafismo em cima de texto.
  $folgaBaixo = [single]44
  $yVant = [single]($y + (Se $alto 44 26))
  $tamB = [single](Se $alto 56 48)
  $tamM = [single](Se $temLegenda (Se $alto 29 26) 0)
  $altVant = AltVantagens $tamB $tamM
  $dispo = [single]($yFaixa - $folgaBaixo - $yVant)
  if ($altVant -gt $dispo) {
    # PISO NA ESCALA. Sem ele um vão negativo produzia corpo de fonte negativo
    # e o GDI+ derrubava o script inteiro no construtor de Font. E mesmo com
    # vão positivo, encolher sem limite entregaria benefício ilegível — que é
    # pior do que a peça não sair. Abaixo de 0,74 o script AVISA: aquele
    # formato não tem altura para essa copy e a decisão é editorial (cortar
    # texto), não de layout.
    $k = [single]([Math]::Max($dispo / $altVant, 0.74))
    $tamB = [single]($tamB * $k)
    $tamM = [single]($tamM * $k)
    $altVant = AltVantagens $tamB $tamM
    if ($altVant -gt $dispo + 1) {
      Write-Host ("  ATENCAO {0}: faltam {1}px para as vantagens (vao {2}px, bloco {3}px). Corte copy." -f `
                  $variante, [int]($altVant - $dispo), [int]$dispo, [int]$altVant) -ForegroundColor Yellow
    }
  } else {
    $yVant += ($dispo - $altVant) / 2      # centra no vão em vez de escorar
  }                                        # no texto de cima
  Vantagens $g $margem $yVant $util $tamB $tamM | Out-Null

  Faixa $g $margem $yFaixa $util $altFaixa

  # ============================================================ OFERTA
  # A razão para agir AGORA. Sem ela o anúncio compra curtida: músico não
  # abre conversa com fornecedor para "pedir orçamento", abre para receber
  # alguma coisa. A análise gratuita é o degrau mais baixo que ainda
  # qualifica lead — quem manda o @ já mostrou o que tem.
  $yPe = [single]$yRodape
  $tOf = [single](Se $alto 30 27)
  $altPill = [single]($tOf * 2.5)
  $wOf = LargTrack $g $OFERTA $FAM_MONO $tOf $NEGRITO 2.0
  $pillW = [single]($wOf + $tOf * 3.0)
  $p = Arred $margem $yPe $pillW $altPill ($altPill / 2)
  $rP = New-Object System.Drawing.Rectangle(([int]$margem), ([int]$yPe), ([int]$pillW), ([int]$altPill))
  $gp = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rP, $VIOLETA, $CIANO, 12.0)
  $g.FillPath($gp, $p); $gp.Dispose(); $p.Dispose()
  $escuro = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 9, 9, 15))
  TxtTrack $g $OFERTA $FAM_MONO $tOf $NEGRITO $escuro ($margem + $tOf * 1.5) ($yPe + ($altPill - $tOf * 1.32) / 2) 2.0
  $escuro.Dispose()
  $yPe += [single]($altPill + (Se $alto 54 40))

  # ============================================================ CONTATO
  $tRot = [single](Se $alto 26 23)
  TxtTrack $g $ROTULO_ZAP $FAM_MONO $tRot $NEGRITO $pCiano $margem $yPe 2.5
  $yPe += [single]($tRot * 1.68)
  $tZap = [single](Se $alto 74 64)
  Txt $g $ZAP $FAM_TIT $tZap $NEGRITO $pTexto $margem $yPe
  $yPe += [single]($tZap * 1.28)
  if ($temSite) {
    # Em #9a9db1 sobre quase-preto o endereço quase desaparecia. Ele é
    # informação de contato, não legenda: sobe um degrau de contraste.
    $pSite = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(198, 201, 216))
    Txt $g $SITE $FAM_CORPO (Se $alto 35 32) $NORMAL $pSite $margem $yPe
    $pSite.Dispose()
  }

  $pTexto.Dispose(); $pMudo.Dispose(); $pCiano.Dispose()
  $destino = Join-Path $SAIDA $arquivo
  $bmp.Save($destino, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  $kb = [math]::Round((Get-Item $destino).Length / 1KB)
  Write-Host ("  gerado  {0}  {1}x{2}  {3} KB" -f $arquivo, $L, $A, $kb)
}

Write-Host "`n  LA Software House - campanha MUSICOS"
Write-Host ("  tipografia: {0} / {1} / {2}`n" -f $FAM_TIT.Name, $FAM_CORPO.Name, $FAM_MONO.Name)
Gerar 1080 1350 "banner-feed-4x5.png"   "feed"
Gerar 1080 1080 "banner-quadrado.png"   "quadrado"
Gerar 1080 1920 "banner-story-9x16.png" "story"
Gerar 1080 1920 "anuncio-9x16.png"      "anuncio"
Write-Host ("`n  em {0}`n" -f $SAIDA)








