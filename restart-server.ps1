# Kill any process using port 3001 (API server)
$proc3001 = Get-NetTCPConnection -LocalPort 3001 -ErrorAction SilentlyContinue
if ($proc3001) {
    Stop-Process -Id $proc3001.OwningProcess -Force -ErrorAction SilentlyContinue
    Write-Host "Killed process on port 3001"
    Start-Sleep -Milliseconds 500
}

# Kill any process using port 3000 (Vite dev server)
$proc3000 = Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue
if ($proc3000) {
    Stop-Process -Id $proc3000.OwningProcess -Force -ErrorAction SilentlyContinue
    Write-Host "Killed process on port 3000"
    Start-Sleep -Milliseconds 500
}

# Run database migration (idempotent - safe to run every time)
Write-Host "Running database migration check..."
node "$PSScriptRoot\server\database\migrate-check.js"
Write-Host "Migration check complete."

# Start API server in a new window
Write-Host "Starting API server (port 3001)..."
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$PSScriptRoot\server'; npm run dev"

Start-Sleep -Seconds 2

# Start Vite client dev server in a new window
Write-Host "Starting client dev server (port 3000)..."
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$PSScriptRoot\client'; npm run dev"

Write-Host ""
Write-Host "Both servers starting. Open http://localhost:3000 in your browser."
