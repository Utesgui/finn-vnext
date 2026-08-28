Add-Type -AssemblyName System.Drawing

function Draw-Mark([System.Drawing.Graphics]$g, [double]$s) {
  # All coordinates on a 64-unit master grid, scaled by $s/64
  $k = $s / 64.0
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

  # Tile background: diagonal ink gradient with rounded corners
  $rect = New-Object System.Drawing.RectangleF(0, 0, $s, $s)
  $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect,
        [System.Drawing.Color]::FromArgb(255, 27, 31, 35),
        [System.Drawing.Color]::FromArgb(255, 10, 12, 14), 45.0)
  $r = 14.0 * $k
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $path.AddArc(0, 0, $d, $d, 180, 90)
  $path.AddArc($s - $d, 0, $d, $d, 270, 90)
  $path.AddArc($s - $d, $s - $d, $d, $d, 0, 90)
  $path.AddArc(0, $s - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  $g.FillPath($bg, $path)

  # F glyph
  $white = [System.Drawing.Brushes]::White
  $g.FillRectangle($white, [single](21 * $k), [single](16 * $k), [single](9 * $k),  [single](32 * $k))
  $g.FillRectangle($white, [single](21 * $k), [single](16 * $k), [single](23 * $k), [single](9 * $k))
  $g.FillRectangle($white, [single](21 * $k), [single](31 * $k), [single](18 * $k), [single](8 * $k))

  # Teal dot
  $dotRect = New-Object System.Drawing.RectangleF([single](39.5 * $k), [single](39 * $k), [single](9 * $k), [single](9 * $k))
  $dot = New-Object System.Drawing.Drawing2D.LinearGradientBrush($dotRect,
         [System.Drawing.Color]::FromArgb(255, 46, 230, 214),
         [System.Drawing.Color]::FromArgb(255, 10, 166, 184), 45.0)
  $g.FillEllipse($dot, $dotRect)

  $bg.Dispose(); $dot.Dispose(); $path.Dispose()
}

function New-MarkBitmap([int]$size) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.Clear([System.Drawing.Color]::Transparent)
  Draw-Mark $g $size
  $g.Dispose()
  return $bmp
}

$root = $PSScriptRoot
if (-not $root) { $root = Get-Location }

# apple-touch-icon: 180px, full-bleed square (iOS applies its own mask)
$apple = New-Object System.Drawing.Bitmap(180, 180)
$g = [System.Drawing.Graphics]::FromImage($apple)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$rect = New-Object System.Drawing.RectangleF(0, 0, 180, 180)
$bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect,
      [System.Drawing.Color]::FromArgb(255, 27, 31, 35),
      [System.Drawing.Color]::FromArgb(255, 10, 12, 14), 45.0)
$g.FillRectangle($bg, $rect)
$k = 180.0 / 64.0
$white = [System.Drawing.Brushes]::White
$g.FillRectangle($white, [single](21 * $k), [single](16 * $k), [single](9 * $k),  [single](32 * $k))
$g.FillRectangle($white, [single](21 * $k), [single](16 * $k), [single](23 * $k), [single](9 * $k))
$g.FillRectangle($white, [single](21 * $k), [single](31 * $k), [single](18 * $k), [single](8 * $k))
$dotRect = New-Object System.Drawing.RectangleF([single](39.5 * $k), [single](39 * $k), [single](9 * $k), [single](9 * $k))
$dot = New-Object System.Drawing.Drawing2D.LinearGradientBrush($dotRect,
       [System.Drawing.Color]::FromArgb(255, 46, 230, 214),
       [System.Drawing.Color]::FromArgb(255, 10, 166, 184), 45.0)
$g.FillEllipse($dot, $dotRect)
$g.Dispose(); $bg.Dispose(); $dot.Dispose()
$apple.Save((Join-Path $root "assets\apple-touch-icon.png"), [System.Drawing.Imaging.ImageFormat]::Png)
$apple.Dispose()

# favicon.ico: 32px via GetHicon
$bmp32 = New-MarkBitmap 32
$hicon = $bmp32.GetHicon()
$icon = [System.Drawing.Icon]::FromHandle($hicon)
$fs = [System.IO.File]::Create((Join-Path $root "favicon.ico"))
$icon.Save($fs)
$fs.Close()
$icon.Dispose(); $bmp32.Dispose()

Write-Output "done"
