$root = "C:\Users\Raymond\CascadeProjects\BudgetApp"
$electron = "$root\electron"

# Clean old copies
if (Test-Path "$electron\server") { Remove-Item -Recurse -Force "$electron\server" }
if (Test-Path "$electron\client") { Remove-Item -Recurse -Force "$electron\client" }

# Copy server files (dist, node_modules, package.json, database/schema.sql)
Copy-Item -Recurse -Force "$root\server\dist"         "$electron\server\dist"
Copy-Item -Recurse -Force "$root\server\node_modules" "$electron\server\node_modules"
Copy-Item -Force          "$root\server\package.json" "$electron\server\package.json"

New-Item -ItemType Directory -Force "$electron\server\database" | Out-Null
Copy-Item -Force "$root\server\database\schema.sql"   "$electron\server\database\schema.sql"

# Also copy schema.sql to assets for reliable access in production Electron builds
New-Item -ItemType Directory -Force "$electron\assets\database" | Out-Null
Copy-Item -Force "$root\server\database\schema.sql"   "$electron\assets\database\schema.sql"

# Copy client files
Copy-Item -Recurse -Force "$root\client\dist" "$electron\client\dist"

Write-Host "Copied server + client files to electron/"

# Rebuild sqlite3 native module for Electron 28 (ABI mismatch: system Node != Electron Node)
Write-Host "Rebuilding sqlite3 for Electron 28.3.3..."
$rebuildCmd = "npx @electron/rebuild --version 28.3.3 --which-module sqlite3 --module-dir `"$electron\server`""
Push-Location $electron
Invoke-Expression $rebuildCmd
if ($LASTEXITCODE -ne 0) {
    Write-Error "electron-rebuild failed with exit code $LASTEXITCODE"
    Pop-Location
    exit 1
}
Pop-Location
Write-Host "sqlite3 rebuilt successfully for Electron 28.3.3"
