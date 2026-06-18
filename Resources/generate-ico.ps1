# Generate multi-resolution ICO from Money Weather icon - transparent.png
# Fits the full image (preserving aspect ratio) with padding to prevent cutoff
# Requires .NET Framework (built into Windows)

Add-Type -AssemblyName System.Drawing

$srcPath = "C:\Users\Raymond\CascadeProjects\BudgetApp\Resources\Money Weather icon - transparent.png"
$outPath = "C:\Users\Raymond\CascadeProjects\BudgetApp\electron\assets\icon.ico"

# Load source image
$src = [System.Drawing.Image]::FromFile($srcPath)
$srcW = $src.Width
$srcH = $src.Height
$srcRect = New-Object System.Drawing.Rectangle(0, 0, $srcW, $srcH)

# Padding: scale the fitted image down by 75% to add blank space on all sides
$paddingScale = 0.75

# Sizes to include in ICO
$sizes = @(16, 32, 48, 64, 128, 256)

# Create each size as PNG bytes
$pngDataList = @()
foreach ($size in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)

    # Fit full image into canvas while preserving aspect ratio
    $fitScale = [Math]::Min($size / $srcW, $size / $srcH)
    $scale = $fitScale * $paddingScale
    $drawW = [Math]::Floor($srcW * $scale)
    $drawH = [Math]::Floor($srcH * $scale)
    $offsetX = [Math]::Floor(($size - $drawW) / 2)
    $offsetY = [Math]::Floor(($size - $drawH) / 2)
    $destRect = New-Object System.Drawing.Rectangle($offsetX, $offsetY, $drawW, $drawH)
    $g.DrawImage($src, $destRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)

    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $pngDataList += ,$ms.ToArray()

    $g.Dispose()
    $bmp.Dispose()
    $ms.Dispose()
}

$src.Dispose()

# Build ICO file
$fs = [System.IO.File]::OpenWrite($outPath)
$bw = New-Object System.IO.BinaryWriter($fs)

# ICONDIR header
$bw.Write([UInt16]0)      # Reserved
$bw.Write([UInt16]1)      # Type: icon
$bw.Write([UInt16]$sizes.Length)  # Count

# Calculate offsets
$headerSize = 6 + (16 * $sizes.Length)
$offset = $headerSize
$entries = @()

foreach ($pngData in $pngDataList) {
    $entries += @{
        Size = $pngData.Length
        Offset = $offset
    }
    $offset += $pngData.Length
}

# ICONDIRENTRY for each size
for ($i = 0; $i -lt $sizes.Length; $i++) {
    $size = $sizes[$i]
    $pngData = $pngDataList[$i]
    $entry = $entries[$i]

    $dim = if ($size -eq 256) { [Byte]0 } else { [Byte]$size }
    $bw.Write($dim)  # Width (0 means 256)
    $bw.Write($dim)  # Height
    $bw.Write([Byte]0)            # Colors (0 = >256)
    $bw.Write([Byte]0)            # Reserved
    $bw.Write([UInt16]1)          # Color planes
    $bw.Write([UInt16]32)         # Bits per pixel
    $bw.Write([UInt32]$pngData.Length)
    $bw.Write([UInt32]$entry.Offset)
}

# Write PNG data for each size
foreach ($pngData in $pngDataList) {
    $bw.Write($pngData)
}

$bw.Close()
$fs.Close()

Write-Host "Generated: $outPath"
Write-Host "Contains sizes: $($sizes -join ', ')"
