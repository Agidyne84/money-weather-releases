# Generate Android launcher icons from Money Weather icon - transparent.png
Add-Type -AssemblyName System.Drawing

$srcPath = "C:\Users\Raymond\CascadeProjects\BudgetApp\Resources\Money Weather icon - transparent.png"
$resRoot = "C:\Users\Raymond\CascadeProjects\BudgetApp\client\android\app\src\main\res"

$src = [System.Drawing.Image]::FromFile($srcPath)
$srcW = $src.Width
$srcH = $src.Height
$srcRect = New-Object System.Drawing.Rectangle(0, 0, $srcW, $srcH)
$paddingScale = 0.75

$densities = @{
    "mipmap-mdpi"    = @{ legacy = 48;  adaptive = 108 }
    "mipmap-hdpi"    = @{ legacy = 72;  adaptive = 162 }
    "mipmap-xhdpi"   = @{ legacy = 96;  adaptive = 216 }
    "mipmap-xxhdpi"  = @{ legacy = 144; adaptive = 324 }
    "mipmap-xxxhdpi" = @{ legacy = 192; adaptive = 432 }
}

function RenderIcon($size, $addBackground) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
    if ($addBackground) {
        $g.Clear([System.Drawing.Color]::White)
    } else {
        $g.Clear([System.Drawing.Color]::Transparent)
    }
    $fitScale = [Math]::Min($size / $srcW, $size / $srcH)
    $scale = $fitScale * $paddingScale
    $drawW = [Math]::Floor($srcW * $scale)
    $drawH = [Math]::Floor($srcH * $scale)
    $offsetX = [Math]::Floor(($size - $drawW) / 2)
    $offsetY = [Math]::Floor(($size - $drawH) / 2)
    $destRect = New-Object System.Drawing.Rectangle($offsetX, $offsetY, $drawW, $drawH)
    $g.DrawImage($src, $destRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
    $g.Dispose()
    return $bmp
}

foreach ($folder in $densities.Keys) {
    $legacySize = $densities[$folder].legacy
    $adaptiveSize = $densities[$folder].adaptive
    $outDir = Join-Path $resRoot $folder
    if (!(Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }

    $legacyBmp = RenderIcon $legacySize $true
    $legacyBmp.Save((Join-Path $outDir "ic_launcher.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    $legacyBmp.Dispose()
    Write-Host "Created $folder/ic_launcher.png ($legacySize x $legacySize)"

    $adaptiveBmp = RenderIcon $adaptiveSize $false
    $adaptiveBmp.Save((Join-Path $outDir "ic_launcher_foreground.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    $adaptiveBmp.Dispose()
    Write-Host "Created $folder/ic_launcher_foreground.png ($adaptiveSize x $adaptiveSize)"

    $roundBmp = RenderIcon $legacySize $true
    $roundBmp.Save((Join-Path $outDir "ic_launcher_round.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    $roundBmp.Dispose()
    Write-Host "Created $folder/ic_launcher_round.png ($legacySize x $legacySize)"
}

$anydpiDir = Join-Path $resRoot "mipmap-anydpi-v26"
if (!(Test-Path $anydpiDir)) { New-Item -ItemType Directory -Path $anydpiDir -Force | Out-Null }
$adaptiveLines = @('<?xml version="1.0" encoding="utf-8"?>','<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">','    <background android:drawable="@color/ic_launcher_background"/>','    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>','</adaptive-icon>')
Set-Content -Path (Join-Path $anydpiDir "ic_launcher.xml") -Value $adaptiveLines -Encoding UTF8
Write-Host "Created mipmap-anydpi-v26/ic_launcher.xml"

$valuesDir = Join-Path $resRoot "values"
if (!(Test-Path $valuesDir)) { New-Item -ItemType Directory -Path $valuesDir -Force | Out-Null }
$bgLines = @('<?xml version="1.0" encoding="utf-8"?>','<resources>','    <color name="ic_launcher_background">#FFFFFF</color>','</resources>')
Set-Content -Path (Join-Path $valuesDir "ic_launcher_background.xml") -Value $bgLines -Encoding UTF8
Write-Host "Created values/ic_launcher_background.xml"

$src.Dispose()
Write-Host "`nAll Android launcher icons generated successfully!"
