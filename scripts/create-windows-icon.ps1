Add-Type -AssemblyName System.Drawing

$buildDirectory = Join-Path $PSScriptRoot "..\build"
$logoPath = Join-Path $PSScriptRoot "..\assets\brand\ezproctor-logo.png"
New-Item -ItemType Directory -Force -Path $buildDirectory | Out-Null

$source = [System.Drawing.Image]::FromFile($logoPath)
$bitmap = New-Object System.Drawing.Bitmap 256, 256
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$graphics.DrawImage($source, 0, 0, 256, 256)

$icon = [System.Drawing.Icon]::FromHandle($bitmap.GetHicon())
$stream = [System.IO.File]::Create((Join-Path $buildDirectory "ezproctor.ico"))
$icon.Save($stream)

$stream.Close()
$icon.Dispose()
$graphics.Dispose()
$bitmap.Dispose()
$source.Dispose()
