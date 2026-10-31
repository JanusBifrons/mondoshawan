# Draws assets/mondo.ico (navy tile, glowing orange core, four brass element triangles) at several sizes.
# Re-run only if you want to change the icon: powershell -File scripts/make-icon.ps1
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root "assets\mondo.ico"
$sizes = 16, 24, 32, 48, 64, 128, 256
$pngs = @()
foreach ($s in $sizes) {
  $bmp = New-Object System.Drawing.Bitmap $s, $s
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'; $g.TextRenderingHint = 'AntiAliasGridFit'
  $r = [Math]::Max(2, [int]($s * 0.22)); $d = $r * 2
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddArc(0, 0, $d, $d, 180, 90); $path.AddArc($s - $d - 1, 0, $d, $d, 270, 90)
  $path.AddArc($s - $d - 1, $s - $d - 1, $d, $d, 0, 90); $path.AddArc(0, $s - $d - 1, $d, $d, 90, 90)
  $path.CloseFigure()
  $g.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 15, 20, 36))), $path)
  # glowing core: Leeloo orange fading out, taxi-yellow centre
  $c = $s / 2.0
  $glowR = $s * 0.34
  $gp = New-Object System.Drawing.Drawing2D.GraphicsPath
  $gp.AddEllipse([single]($c - $glowR), [single]($c - $glowR), [single]($glowR * 2), [single]($glowR * 2))
  $pgb = New-Object System.Drawing.Drawing2D.PathGradientBrush $gp
  $pgb.CenterColor = [System.Drawing.Color]::FromArgb(255, 255, 140, 40)
  $pgb.SurroundColors = @([System.Drawing.Color]::FromArgb(0, 255, 110, 20))
  $g.FillPath($pgb, $gp)
  $coreR = $s * 0.09
  $g.FillEllipse((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 255, 214, 60))), [single]($c - $coreR), [single]($c - $coreR), [single]($coreR * 2), [single]($coreR * 2))
  # four alchemical element triangles in the corners: fire, air (top), water, earth (bottom)
  $brass = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 214, 172, 96)), ([single][Math]::Max(1.1, $s * 0.04))
  $brass.LineJoin = "Round"
  $w2 = $s * 0.10; $th = $s * 0.17
  function Tri($cx, $cy, $up, $bar) {
    if ($up) { $tipY = $cy - $th / 2.0; $baseY = $cy + $th / 2.0 } else { $tipY = $cy + $th / 2.0; $baseY = $cy - $th / 2.0 }
    $pts = [System.Drawing.PointF[]]@(
      (New-Object System.Drawing.PointF ([single]$cx), ([single]$tipY)),
      (New-Object System.Drawing.PointF ([single]($cx + $w2)), ([single]$baseY)),
      (New-Object System.Drawing.PointF ([single]($cx - $w2)), ([single]$baseY)))
    $g.DrawPolygon($brass, $pts)
    if ($bar) {
      $by = ($tipY + $baseY) / 2.0 + ($baseY - $tipY) * 0.12
      $g.DrawLine($brass, [single]($cx - $w2 * 0.7), [single]$by, [single]($cx + $w2 * 0.7), [single]$by)
    }
  }
  $lo = $s * 0.24; $hi = $s * 0.76
  Tri $lo $lo $true $false
  Tri $hi $lo $true $true
  Tri $lo $hi $false $false
  Tri $hi $hi $false $true
  $ms = New-Object System.IO.MemoryStream; $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $pngs += ,@($s, $ms.ToArray()); $g.Dispose(); $bmp.Dispose()
}
# ICO container with PNG-encoded entries
$fs = [System.IO.File]::Create($out); $w = New-Object System.IO.BinaryWriter $fs
$w.Write([UInt16]0); $w.Write([UInt16]1); $w.Write([UInt16]$pngs.Count)
$offset = 6 + 16 * $pngs.Count
foreach ($p in $pngs) {
  $s = $p[0]; $bytes = $p[1]; $dim = if ($s -ge 256) { 0 } else { $s }
  $w.Write([byte]$dim); $w.Write([byte]$dim); $w.Write([byte]0); $w.Write([byte]0)
  $w.Write([UInt16]1); $w.Write([UInt16]32); $w.Write([UInt32]$bytes.Length); $w.Write([UInt32]$offset)
  $offset += $bytes.Length
}
foreach ($p in $pngs) { $w.Write($p[1]) }
$w.Close()
Write-Output "Wrote $out"
