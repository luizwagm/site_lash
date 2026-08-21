# =============================================================================
#  CARTÃO DE DIVULGAÇÃO — LA Software House
#
#  Gera as artes de compartilhamento (WhatsApp, Instagram, LinkedIn) a partir
#  do CONTEÚDO REAL do site: os serviços, os números e o WhatsApp saem do
#  data/site.db, os mesmos que a home publica. Mudou o serviço no painel? Roda
#  de novo e a arte acompanha — ninguém precisa lembrar de editar dois lugares.
#
#    powershell -ExecutionPolicy Bypass -File src/gerar-cartao.ps1
#
#  Saída em assets/img/divulgacao/:
#    · cartao-quadrado.png   1080×1080  feed do Insta, LinkedIn, envio no zap
#    · cartao-status.png     1080×1920  status do WhatsApp e stories
#
#  POR QUE PowerShell/GDI+ e não HTML: aqui não há como rasterizar página (o
#  pane de inspeção não compõe quadros). O System.Drawing desenha direto no
#  bitmap, é o mesmo caminho já usado para a og-image deste projeto.
#
#  TIPOGRAFIA: a marca usa Space Grotesk + Inter, que vêm do Google Fonts e
#  NÃO estão instaladas nesta máquina. O script cai para as faces de sistema
#  mais próximas (ver $FonteTitulo). Instalando os .ttf da marca, ele passa a
#  usá-las sozinho — a lista de preferência já as procura primeiro.
# =============================================================================

Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = "Stop"
$RAIZ  = Split-Path -Parent $PSScriptRoot
$SAIDA = Join-Path $RAIZ "assets\img\divulgacao"
if (-not (Test-Path $SAIDA)) { New-Item -ItemType Directory -Path $SAIDA | Out-Null }

# ---------------------------------------------------------------- identidade
$BG900   = [System.Drawing.Color]::FromArgb(8, 8, 12)
$BG800   = [System.Drawing.Color]::FromArgb(13, 13, 20)
$SURF    = [System.Drawing.Color]::FromArgb(20, 20, 31)
$TEXTO   = [System.Drawing.Color]::FromArgb(243, 244, 251)
$MUDO    = [System.Drawing.Color]::FromArgb(154, 157, 177)
$VIOLETA = [System.Drawing.Color]::FromArgb(124, 92, 255)
$CIANO   = [System.Drawing.Color]::FromArgb(36, 227, 214)
$FUCSIA  = [System.Drawing.Color]::FromArgb(224, 92, 255)

# A primeira instalada vence. Space Grotesk/Inter primeiro: se um dia forem
# instaladas, a arte passa a sair na tipografia da marca sem tocar no script.
$instaladas = (New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object { $_.Name }
function Primeira-Fonte([string[]]$nomes) {
  foreach ($n in $nomes) { if ($instaladas -contains $n) { return $n } }
  return "Arial"
}
$FonteTitulo = Primeira-Fonte @("Space Grotesk", "Segoe UI Variable Display", "Segoe UI", "Arial")
$FonteCorpo  = Primeira-Fonte @("Inter", "Segoe UI Variable Text", "Segoe UI", "Arial")
$FonteMono   = Primeira-Fonte @("JetBrains Mono", "Cascadia Mono", "Consolas", "Courier New")

# --------------------------------------------------- conteúdo vindo do banco
# Sai do site.db pelo node (src/dados-cartao.cjs): o SQLite nativo já é
# dependência do projeto, e ler de lá garante que a arte diga o mesmo que a
# página publicada.
# `--no-warnings` na CHAMADA, e nada de `2>$null`: o node avisa que o SQLite
# nativo e experimental, o aviso sai pelo stderr, e o PowerShell 5.1 embrulha
# stderr de programa nativo como erro de verdade -- com ErrorActionPreference
# em Stop isso derruba o script inteiro por causa de um aviso.
$json = & node --no-warnings (Join-Path $PSScriptRoot 'dados-cartao.cjs')
$DADOS = $json | ConvertFrom-Json

# Telefone só de dígitos → +55 (81) 9 7101-0607
function Formata-Zap([string]$lado) {
  if ($lado -match '^(\d{2})(\d{2})(\d{1})(\d{4})(\d{4})$') { return "+$($Matches[1]) ($($Matches[2])) $($Matches[3]) $($Matches[4])-$($Matches[5])" }
  if ($lado -match '^(\d{2})(\d{2})(\d{4,5})(\d{4})$')       { return "+$($Matches[1]) ($($Matches[2])) $($Matches[3])-$($Matches[4])" }
  return $lado
}
$ZAP = Formata-Zap $DADOS.whatsapp


# ATENCAO AO NOME DAS VARIAVEIS: no PowerShell `$D` e `$d` sao A MESMA COISA —
# a linguagem nao diferencia maiuscula de minuscula. Os dados do banco moravam
# em `$D` e o selo dos anos usava `$d` para o lado do quadrado; a partir dali,
# no meio da funcao, os dados viravam o numero 116 e a lista de servicos sumia
# do cartao SEM ERRO NENHUM. Por isso os dados agora sao `$DADOS`, nome que nao
# colide com medida nenhuma.

# ------------------------------------------------------------------ desenho
# O PowerShell 5.1 desta máquina NÃO tem operador ternário (`? :`) — ele é do
# PowerShell 7. Este auxiliar faz o mesmo papel e mantém as linhas de medida
# curtas o bastante para se ler de uma vez.
function Se([bool]$c, $a, $b) { if ($c) { return $a } else { return $b } }

function Caminho-Arredondado([single]$x, [single]$y, [single]$w, [single]$h, [single]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $diam = $r * 2
  $p.AddArc($x, $y, $diam, $diam, 180, 90)
  $p.AddArc($x + $w - $diam, $y, $diam, $diam, 270, 90)
  $p.AddArc($x + $w - $diam, $y + $h - $diam, $diam, $diam, 0, 90)
  $p.AddArc($x, $y + $h - $diam, $diam, $diam, 90, 90)
  $p.CloseFigure()
  return $p
}

# Brilho radial. O `aurora` do site é um gradiente que some nas bordas; aqui é
# um PathGradientBrush com o centro aceso e a borda transparente.
function Aurora($g, [single]$cx, [single]$cy, [single]$raio, $cor, [int]$alfa) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $p.AddEllipse($cx - $raio, $cy - $raio, $raio * 2, $raio * 2)
  $b = New-Object System.Drawing.Drawing2D.PathGradientBrush($p)
  $b.CenterColor = [System.Drawing.Color]::FromArgb($alfa, $cor)
  $b.SurroundColors = @([System.Drawing.Color]::FromArgb(0, $cor))
  $g.FillPath($b, $p)
  $b.Dispose(); $p.Dispose()
}

# O emblema da marca: 4 barras em gradiente ciano→violeta sobre a fundação
# branca do "L" (pilar + base). É o logo v4, sem estrela e sem cena.
function Emblema($g, [single]$x, [single]$y, [single]$tam) {
  $u = $tam / 64.0
  $branco = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 255, 255))
  # o L: haste + base
  $g.FillRectangle($branco, $x + 6 * $u, $y + 10 * $u, 7 * $u, 40 * $u)
  $g.FillRectangle($branco, $x + 6 * $u, $y + 44 * $u, 52 * $u, 6 * $u)
  # as 4 barras do skyline, alturas em "A"
  $alturas = @(20, 30, 26, 16)
  $ret = New-Object System.Drawing.Rectangle(([int]($x + 16 * $u)), ([int]$y), ([int](44 * $u)), ([int](50 * $u)))
  $grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush($ret, $CIANO, $VIOLETA, 60.0)
  for ($i = 0; $i -lt 4; $i++) {
    $bx = $x + (17 + $i * 11) * $u
    $bh = $alturas[$i] * $u
    $by = $y + 44 * $u - $bh
    $p = Caminho-Arredondado $bx $by (8 * $u) $bh (2 * $u)
    $g.FillPath($grad, $p); $p.Dispose()
  }
  $grad.Dispose(); $branco.Dispose()
}

# Desenha com a MESMA metrica com que Largura() mede. Misturar as duas era o
# defeito: eu media tipografico (estreito) e desenhava com a metrica padrao
# (larga), entao a palavra seguinte comecava antes do fim da anterior e saia
# "softwareque gera".
function Texto($g, [string]$t, [string]$fonte, [single]$tamanho, $estilo, $pincel, [single]$x, [single]$y) {
  $f = New-Object System.Drawing.Font($fonte, $tamanho, $estilo, [System.Drawing.GraphicsUnit]::Pixel)
  $g.DrawString($t, $f, $pincel, (New-Object System.Drawing.PointF($x, $y)), $FORMATO_MEDIDA)
  $f.Dispose()
}

# MEDIDA TIPOGRAFICA, nao a padrao do GDI+. O MeasureString comum acrescenta
# um respiro nas pontas para acomodar italico e overhang; medindo assim, a
# palavra seguinte saia com um vao fantasma no meio da frase.
$FORMATO_MEDIDA = [System.Drawing.StringFormat]::GenericTypographic
function Largura($g, [string]$t, [string]$fonte, [single]$tamanho, $estilo) {
  $f = New-Object System.Drawing.Font($fonte, $tamanho, $estilo, [System.Drawing.GraphicsUnit]::Pixel)
  $m = $g.MeasureString($t, $f, [System.Drawing.PointF]::new(0, 0), $FORMATO_MEDIDA)
  $f.Dispose()
  return $m.Width
}

# --------------------------------------------------------------- a arte
#
#  LAYOUT POR ESPAÇO CALCULADO, não por medida chutada.
#
#  A primeira versão usava alturas fixas: no 1080x1080 os cinco serviços
#  passavam do rodapé e o selo cobria o último cartão. Altura fixa só funciona
#  enquanto o conteúdo não muda — e o conteúdo vem do painel, onde um serviço
#  novo pode nascer a qualquer hora.
#
#  Agora a rotina reserva topo e rodapé, mede o que sobra e divide entre os
#  serviços. Seis serviços cabem; um a menos respira mais. Nada se sobrepõe
#  porque nada é adivinhado.
function Gerar([int]$L, [int]$A, [string]$arquivo) {
  $bmp = New-Object System.Drawing.Bitmap($L, $A)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

  $alto = $A -gt $L    # formato de status/story

  # ---- fundo: quase preto com leve subida de tom
  $rTudo = New-Object System.Drawing.Rectangle(0, 0, $L, $A)
  $fundo = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rTudo, $BG900, $BG800, 90.0)
  $g.FillRectangle($fundo, $rTudo); $fundo.Dispose()

  Aurora $g ($L * 0.16) ($A * 0.06) ($L * 0.60) $VIOLETA 115
  Aurora $g ($L * 0.95) ($A * 0.28) ($L * 0.48) $CIANO    75
  Aurora $g ($L * 0.45) ($A * 1.02) ($L * 0.72) $FUCSIA   55

  $caneta = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(11, 255, 255, 255)), 1
  for ($x = 0; $x -lt $L; $x += 60) { $g.DrawLine($caneta, $x, 0, $x, $A) }
  for ($y = 0; $y -lt $A; $y += 60) { $g.DrawLine($caneta, 0, $y, $L, $y) }
  $caneta.Dispose()

  $pTexto = New-Object System.Drawing.SolidBrush $TEXTO
  $pMudo  = New-Object System.Drawing.SolidBrush $MUDO
  $pCiano = New-Object System.Drawing.SolidBrush $CIANO
  $margem = [single]($L * 0.083)          # 90px no 1080
  $util   = [single]($L - $margem * 2)

  # =========================================================== TOPO
  $y = [single](Se $alto ($A * 0.075) ($L * 0.072))

  # selo dos anos no canto direito, na MESMA faixa da marca. Ficava embaixo,
  # junto dos serviços, e cobria o último cartão — aqui não disputa espaço.
  $anos = ($DADOS.stats | Where-Object { $_.label -match "anos" } | Select-Object -First 1)
  if ($anos) {
    $lado = [single]116
    $sx = $L - $margem - $lado
    $p = Caminho-Arredondado $sx $y $lado $lado 28
    $rS = New-Object System.Drawing.Rectangle(([int]$sx), ([int]$y), ([int]$lado), ([int]$lado))
    $gs = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rS, $VIOLETA, $CIANO, 45.0)
    $g.FillPath($gs, $p); $gs.Dispose(); $p.Dispose()
    $escuro = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 9, 9, 15))
    $wN = Largura $g $anos.num $FonteTitulo 46 ([System.Drawing.FontStyle]::Bold)
    Texto $g $anos.num $FonteTitulo 46 ([System.Drawing.FontStyle]::Bold) $escuro ($sx + ($lado - $wN) / 2) ($y + 24)
    $wL = Largura $g "anos" $FonteCorpo 20 ([System.Drawing.FontStyle]::Bold)
    Texto $g "anos" $FonteCorpo 20 ([System.Drawing.FontStyle]::Bold) $escuro ($sx + ($lado - $wL) / 2) ($y + 74)
    $escuro.Dispose()
  }

  Emblema $g $margem ($y + 14) 76
  $tamMarca = [single]42
  $wLA = Largura $g "LA" $FonteTitulo $tamMarca ([System.Drawing.FontStyle]::Bold)
  Texto $g "LA" $FonteTitulo $tamMarca ([System.Drawing.FontStyle]::Bold) $pCiano ($margem + 94) ($y + 34)
  # O espaco entre "LA" e "Software House" e explicito: nenhuma metrica conta
  # espaco no fim da palavra, entao ele nunca sairia sozinho.
  Texto $g "Software House" $FonteTitulo $tamMarca ([System.Drawing.FontStyle]::Bold) $pTexto ($margem + 94 + $wLA + $tamMarca * 0.30) ($y + 34)

  $y += 152

  # ---- chamada
  Texto $g "DESENVOLVIMENTO SOB MEDIDA" $FonteMono 25 ([System.Drawing.FontStyle]::Bold) $pCiano $margem $y
  $y += 54

  # Título em 3 linhas. "software" leva o gradiente da marca, como na home.
  # A largura sai de Largura(), que usa medida tipográfica — com a medida
  # padrão do GDI+ sobra um vão fantasma depois da palavra.
  $tamTit = [single](Se $alto 78 64)
  $passo  = [single]($tamTit * 1.1)
  Texto $g "Ideias viram" $FonteTitulo $tamTit ([System.Drawing.FontStyle]::Bold) $pTexto $margem $y
  $y += $passo
  $wSoft = Largura $g "software" $FonteTitulo $tamTit ([System.Drawing.FontStyle]::Bold)
  $rSoft = New-Object System.Drawing.Rectangle(([int]$margem), ([int]$y), ([int]$wSoft), ([int]($tamTit * 1.2)))
  $gradTexto = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rSoft, $VIOLETA, $CIANO, 12.0)
  Texto $g "software" $FonteTitulo $tamTit ([System.Drawing.FontStyle]::Bold) $gradTexto $margem $y
  Texto $g "que gera" $FonteTitulo $tamTit ([System.Drawing.FontStyle]::Bold) $pTexto ($margem + $wSoft + $tamTit * 0.28) $y
  $gradTexto.Dispose()
  $y += $passo
  Texto $g "resultado." $FonteTitulo $tamTit ([System.Drawing.FontStyle]::Bold) $pTexto $margem $y
  $y += $passo + (Se $alto 40 18)

  # =========================================================== RODAPÉ
  # Calculado ANTES dos serviços: é ele que define onde a lista tem de parar.
  $altRodape = [single](Se $alto 250 188)
  $yRodape   = [single]($A - $altRodape)

  # =========================================================== SERVIÇOS
  # O que sobra entre o título e o rodapé, dividido pelo número de serviços.
  $n = [Math]::Max(1, $DADOS.servicos.Count)
  $espaco = [single]($yRodape - $y - 24)
  $vao = [single](Se $alto 18 12)
  $altCartao = [single](($espaco - $vao * ($n - 1)) / $n)
  $altCartao = [Math]::Min($altCartao, (Se $alto 126 104))    # não deixa inchar com poucos itens
  $tamServ = [single]([Math]::Min((Se $alto 42 36), $altCartao * 0.40))
  # Com poucos itens o cartao para de crescer (o teto acima) e sobra um vao
  # morto antes do rodape. A sobra vai METADE para cima: o bloco fica
  # centrado entre o titulo e o contato, em vez de escorado no titulo.
  $sobra = [single]($espaco - ($altCartao * $n + $vao * ($n - 1)))
  if ($sobra -gt 0) { $y += $sobra / 2 }

  foreach ($s in $DADOS.servicos) {
    $p = Caminho-Arredondado $margem $y $util $altCartao 18
    $vidro = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(160, $SURF))
    $g.FillPath($vidro, $p)
    $borda = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(30, 255, 255, 255)), 1.5
    $g.DrawPath($borda, $p)
    $vidro.Dispose(); $borda.Dispose(); $p.Dispose()

    $hM = [single]($altCartao * 0.46)
    $pm = Caminho-Arredondado ($margem + 26) ($y + ($altCartao - $hM) / 2) 7 $hM 3.5
    $rM = New-Object System.Drawing.Rectangle(([int]($margem + 26)), ([int]$y), 7, ([int]$altCartao))
    $gm = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rM, $CIANO, $VIOLETA, 90.0)
    $g.FillPath($gm, $pm); $gm.Dispose(); $pm.Dispose()

    Texto $g $s.titulo $FonteTitulo $tamServ ([System.Drawing.FontStyle]::Bold) $pTexto ($margem + 56) ($y + ($altCartao - $tamServ * 1.32) / 2)
    $y += $altCartao + $vao
  }

  # =========================================================== CONTATO
  $yPe = $yRodape
  $pLinha = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(32, 255, 255, 255)), 2
  $g.DrawLine($pLinha, $margem, $yPe, $L - $margem, $yPe); $pLinha.Dispose()
  $yPe += [single](Se $alto 48 36)

  Texto $g "FALE NO WHATSAPP" $FonteMono 24 ([System.Drawing.FontStyle]::Bold) $pCiano $margem $yPe
  $yPe += 40
  Texto $g $ZAP $FonteTitulo 50 ([System.Drawing.FontStyle]::Bold) $pTexto $margem $yPe
  $yPe += 70
  Texto $g $DADOS.site $FonteCorpo 32 ([System.Drawing.FontStyle]::Regular) $pMudo $margem $yPe

  $pTexto.Dispose(); $pMudo.Dispose(); $pCiano.Dispose()
  $destino = Join-Path $SAIDA $arquivo
  $bmp.Save($destino, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  $kb = [math]::Round((Get-Item $destino).Length / 1KB)
  Write-Host ("  gerado  {0}  {1}x{2}  {3} KB  (cartao {4}px, {5} servicos)" -f $arquivo, $L, $A, $kb, [int]$altCartao, $n)
}


Write-Host "`n  LA Software House — cartoes de divulgacao"
Write-Host ("  tipografia: {0} / {1} / {2}`n" -f $FonteTitulo, $FonteCorpo, $FonteMono)
Gerar 1080 1080 "cartao-quadrado.png"
Gerar 1080 1920 "cartao-status.png"
Write-Host ("`n  em {0}`n" -f $SAIDA)
