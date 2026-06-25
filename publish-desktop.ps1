#Requires -Version 5.1
<#
.SYNOPSIS
    Publish the Money Weather desktop installer to an existing GitHub Release.

.DESCRIPTION
    Uploads the built NSIS installer and latest.yml to the matching GitHub Release.
    Run this AFTER `cd electron && npm run build` (or `npm run build:electron` from root).

.PARAMETER Version
    The version string to publish (e.g., "1.1.53"). Defaults to the version in electron/package.json.

.PARAMETER Token
    GitHub personal access token with 'repo' scope. Defaults to $env:GH_TOKEN.

.EXAMPLE
    .\publish-desktop.ps1 -Version "1.1.53" -Token "ghp_xxxx"
#>

param(
    [string]$Version = "",
    [string]$Token = $env:GH_TOKEN
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# ── Configuration ────────────────────────────────────────────────────────────
$RepoOwner = 'Agidyne84'
$RepoName  = 'money-weather-releases'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$DistDir   = Join-Path $ScriptDir 'electron\dist'

# ── Helpers ──────────────────────────────────────────────────────────────────
function Get-ElectronVersion {
    $json = Get-Content (Join-Path $ScriptDir 'electron\package.json') -Raw | ConvertFrom-Json
    return $json.version
}

function Get-GithubReleaseByTag {
    param([string]$Tag)
    $uri = "https://api.github.com/repos/$RepoOwner/$RepoName/releases/tags/$Tag"
    $headers = @{ Authorization = "Bearer $Token"; Accept = 'application/vnd.github+json' }
    $response = Invoke-RestMethod -Uri $uri -Headers $headers -Method GET
    return $response
}

function Get-GithubReleaseAsset {
    param([int]$ReleaseId, [string]$AssetName)
    $uri = "https://api.github.com/repos/$RepoOwner/$RepoName/releases/$ReleaseId/assets"
    $headers = @{ Authorization = "Bearer $Token"; Accept = 'application/vnd.github+json' }
    $assets = Invoke-RestMethod -Uri $uri -Headers $headers -Method GET
    return $assets | Where-Object { $_.name -eq $AssetName }
}

function Remove-GithubReleaseAsset {
    param([int]$AssetId)
    $uri = "https://api.github.com/repos/$RepoOwner/$RepoName/releases/assets/$AssetId"
    $headers = @{ Authorization = "Bearer $Token"; Accept = 'application/vnd.github+json' }
    Invoke-RestMethod -Uri $uri -Headers $headers -Method DELETE | Out-Null
}

function Send-GithubReleaseAsset {
    param([string]$UploadUrl, [string]$FilePath, [string]$AssetName, [string]$ContentType)
    $url = $UploadUrl -replace '\{\?name,label\}', "?name=$AssetName"
    $headers = @{
        Authorization = "Bearer $Token"
        Accept        = 'application/vnd.github+json'
        'Content-Type'= $ContentType
    }
    $body = [System.IO.File]::ReadAllBytes($FilePath)
    $response = Invoke-RestMethod -Uri $url -Headers $headers -Method POST -Body $body
    return $response
}

# ── Validate token ───────────────────────────────────────────────────────────
if ([string]::IsNullOrWhiteSpace($Token)) {
    Write-Error "GitHub token is required.`nSet `$env:GH_TOKEN or pass -Token."
    exit 1
}

# ── Resolve version ──────────────────────────────────────────────────────────
if ([string]::IsNullOrWhiteSpace($Version)) {
    $Version = Get-ElectronVersion
    Write-Host "Using version from electron/package.json: $Version" -ForegroundColor Cyan
}

$tag = "v$Version"
$setupName = "Money Weather Setup $Version.exe"
$blockmapName = "$setupName.blockmap"
$latestYmlName = "latest.yml"

$setupPath = Join-Path $DistDir $setupName
$blockmapPath = Join-Path $DistDir $blockmapName
$latestYmlPath = Join-Path $DistDir $latestYmlName

# ── Verify files exist ───────────────────────────────────────────────────────
foreach ($f in @($setupPath, $blockmapPath, $latestYmlPath)) {
    if (-not (Test-Path $f)) {
        throw "Required file not found: $f`nRun electron build first."
    }
}

Write-Host "`n=== Money Weather Desktop Publisher ===" -ForegroundColor Green
Write-Host "Version: $Version"
Write-Host "Tag:     $tag"
Write-Host "Repo:    $RepoOwner/$RepoName"
Write-Host ""

# ── Get or create release ──────────────────────────────────────────────────
Write-Host "Fetching GitHub release $tag..." -ForegroundColor Cyan
try {
    $release = Get-GithubReleaseByTag -Tag $tag
    Write-Host "Release found: $($release.html_url)" -ForegroundColor Green
} catch {
    Write-Host "Release not found. Creating new release $tag..." -ForegroundColor Yellow
    $uri = "https://api.github.com/repos/$RepoOwner/$RepoName/releases"
    $headers = @{ Authorization = "Bearer $Token"; Accept = 'application/vnd.github+json' }
    $body = @{
        tag_name         = $tag
        target_commitish = 'master'
        name             = "Money Weather v$Version"
        body             = "Desktop v$Version"
        draft            = $false
        prerelease       = $false
    } | ConvertTo-Json
    $release = Invoke-RestMethod -Uri $uri -Headers $headers -Method POST -Body $body
    Write-Host "Created release: $($release.html_url)" -ForegroundColor Green
}

# ── Upload / replace desktop assets ────────────────────────────────────────────
$assets = @(
    @{ Path = $setupPath;    Name = $setupName;    ContentType = 'application/octet-stream' },
    @{ Path = $blockmapPath; Name = $blockmapName; ContentType = 'application/octet-stream' },
    @{ Path = $latestYmlPath; Name = $latestYmlName; ContentType = 'text/yaml' }
)

foreach ($asset in $assets) {
    $existing = Get-GithubReleaseAsset -ReleaseId $release.id -AssetName $asset.Name
    if ($existing) {
        Write-Host "Removing existing asset $($asset.Name)..." -ForegroundColor Yellow
        Remove-GithubReleaseAsset -AssetId $existing.id
    }
    Write-Host "Uploading $($asset.Name)..." -ForegroundColor Cyan
    $uploaded = Send-GithubReleaseAsset -UploadUrl $release.upload_url -FilePath $asset.Path -AssetName $asset.Name -ContentType $asset.ContentType
    Write-Host "Uploaded: $($uploaded.browser_download_url)" -ForegroundColor Green
}

Write-Host "`n=== Desktop Publish Complete ===" -ForegroundColor Green
