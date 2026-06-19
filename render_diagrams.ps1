$sourceDir = "\\fs1\Services\SEP\Artifacts\Docs\process-flows\processes"
$outputDir = "\\fs1\Services\SEP\Artifacts\Docs\process-flows\training"
$pumlDir = Join-Path $outputDir "puml"
$pngDir = Join-Path $outputDir "png"
$pdfDir = Join-Path $outputDir "pdf"
$simpleDir = Join-Path $outputDir "simplified-visuals"

New-Item -ItemType Directory -Path $pumlDir -Force | Out-Null
New-Item -ItemType Directory -Path $pngDir -Force | Out-Null
New-Item -ItemType Directory -Path $pdfDir -Force | Out-Null
New-Item -ItemType Directory -Path $simpleDir -Force | Out-Null

function Remove-ErrorPaths($text) {
    $lines = $text -split "`r?`n"
    $result = @()
    $skip = 0
    for ($i = 0; $i -lt $lines.Count; $i++) {
        $line = $lines[$i]
        if ($skip -gt 0) {
            $skip--
            continue
        }
        if ($line -match '^\s*#Pink:') {
            continue
        }
        if ($line -match '^\s*stop\s*$') {
            continue
        }
        if ($line -match '^\s*goto\s+\w+\s*;?\s*$') {
            continue
        }
        if ($line -match '^\s*if\s*\(.*(?:error|fail|failed|Error|Fail|Failed).*\)\s*then\s*\(([^)]*)\)\s*$') {
            # skip until matching else or endif
            $depth = 1
            while ($i -lt $lines.Count - 1 -and $depth -gt 0) {
                $i++
                $next = $lines[$i]
                if ($next -match '^\s*if\s*\(') { $depth++ }
                if ($next -match '^\s*endif\s*$') { $depth--; break }
                if ($next -match '^\s*else\s*\(') { $depth--; break }
            }
            continue
        }
        if ($line -match '^\s*note\s+right\s*$') {
            # skip note block
            while ($i -lt $lines.Count - 1) {
                $i++
                if ($lines[$i] -match '^\s*end\s*note\s*$') { break }
            }
            continue
        }
        if ($line -match '^\s*:\s*<<[^>]+>>') {
            continue
        }
        if ($line -match '^\s*\|\s*[^|]+\s*\|\s*$') {
            continue
        }
        $result += $line
    }
    return ($result -join "`n")
}

$mdFiles = Get-ChildItem -Path $sourceDir -Filter "*.md" | Sort-Object Name

foreach ($mdFile in $mdFiles) {
    $content = Get-Content -Path $mdFile.FullName -Raw
    $diagrams = [regex]::Matches($content, "(?s)```plantuml\s*\n(.*?)\n```")
    $baseName = [System.IO.Path]::GetFileNameWithoutExtension($mdFile.Name)

    for ($i = 0; $i -lt $diagrams.Count; $i++) {
        $suffix = if ($diagrams.Count -gt 1) { "_" + ($i + 1) } else { "" }
        $pumlName = "$baseName$suffix.puml"
        $pumlPath = Join-Path $pumlDir $pumlName
        $simplePumlPath = Join-Path $simpleDir $pumlName

        $diagram = $diagrams[$i].Groups[1].Value.Trim()
        if (-not $diagram.EndsWith("`n")) { $diagram += "`n" }

        Set-Content -Path $pumlPath -Value $diagram -Encoding UTF8

        $simplified = Remove-ErrorPaths -text $diagram
        $simplified = $simplified -replace "\n\s*\n+", "`n"
        Set-Content -Path $simplePumlPath -Value $simplified -Encoding UTF8

        # Render PNG
        & plantuml -tpng -o $pngDir $pumlPath
        # Render PDF
        & plantuml -tpdf -o $pdfDir $pumlPath
        # Render simplified PNG
        & plantuml -tpng -o $simpleDir $simplePumlPath
    }
}

Write-Host "Rendering complete."
