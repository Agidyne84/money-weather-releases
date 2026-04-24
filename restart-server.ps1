# Kill any process using port 3001
$proc = Get-NetTCPConnection -LocalPort 3001 -ErrorAction SilentlyContinue
if ($proc) {
    Stop-Process -Id $proc.OwningProcess -Force
    Write-Host "Killed process on port 3001"
}

# Run database migration
Write-Host "Running database migration..."
node $PSScriptRoot\server\database\migrate-check.js

# Start API server
Write-Host "Starting API server..."
Set-Location $PSScriptRoot\server
npm run dev
