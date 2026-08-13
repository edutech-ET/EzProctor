Add-Type -AssemblyName System.Drawing

$buildDirectory = Join-Path $PSScriptRoot "..\build"
New-Item -ItemType Directory -Force -Path $buildDirectory | Out-Null

$bitmap = New-Object System.Drawing.Bitmap 256, 256
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.Clear([System.Drawing.Color]::FromArgb(13, 49, 40))

$peach = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(242, 181, 132))
$green = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(13, 49, 40))
$font = New-Object System.Drawing.Font "Arial", 72, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
$format = New-Object System.Drawing.StringFormat
$format.Alignment = [System.Drawing.StringAlignment]::Center
$format.LineAlignment = [System.Drawing.StringAlignment]::Center

$graphics.FillEllipse($peach, 28, 28, 200, 200)
$graphics.DrawString("EZ", $font, $green, (New-Object System.Drawing.RectangleF 28, 28, 200, 200), $format)

$icon = [System.Drawing.Icon]::FromHandle($bitmap.GetHicon())
$stream = [System.IO.File]::Create((Join-Path $buildDirectory "ezproctor.ico"))
$icon.Save($stream)

$stream.Close()
$icon.Dispose()
$format.Dispose()
$font.Dispose()
$green.Dispose()
$peach.Dispose()
$graphics.Dispose()
$bitmap.Dispose()
