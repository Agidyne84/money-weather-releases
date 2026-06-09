#Requires -Version 5.1
<#
.SYNOPSIS
    Publish the Money Weather Android APK to an existing GitHub Release and update mobile-version.json.

.DESCRIPTION
    This script automates the mobile publish workflow:
    1. Optionally builds the release APK
    2. Uploads app-release.apk to the matching GitHub Release
    3. Updates mobile-version.json with new versionCode and downloadUrl
    4. Commits and pushes the updated mobile-version.json

.PARAMETER Version
    The version string to publish (e.g., "1.1.5"). Defaults to the version in package.json.

.PARAMETER Token
    GitHub personal access token with 'repo' scope. Defaults to $env:GH_TOKEN.

.PARAMETER Build
    If specified, runs gradlew assembleRelease before uploading.

.PARAMETER SkipBuild
    If specified, skips the APK build step and uploads an existing APK.

.PARAMETER Force
    If specified, overwrites an existing APK asset on the release.

.EXAMPLE
    .\publish-mobile.ps1 -Version "1.1.5" -Token "ghp_xxxx" -Build

.EXAMPLE
    .\publish-mobile.ps1 -Version "1.1.5" -SkipBuild -Force
#>

param(
    [string]$Version = "",
    [string]$Token = $env:GH_TOKEN,
    [switch]$Build,
    [switch]$SkipBuild,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# ── Configuration ────────────────────────────────────────────────────────────
$RepoOwner = 'Agidyne84'
$RepoName  = 'money-weather-releases'
$ApkPath   = 'client\android\app\build\outputs\apk\release\app-release.apk'

# ── Helpers ──────────────────────────────────────────────────────────────────
function Get-PackageJsonVersion {
    $json = Get-Content 'package.json' -Raw | ConvertFrom-Json
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
    param([string]$UploadUrl, [string]$FilePath, [string]$AssetName)
    # Upload URL contains {?name,label} placeholder
    $url = $UploadUrl -replace '\{\?name,label\}', "?name=$AssetName"
    $headers = @{
        Authorization = "Bearer $Token"
        Accept        = 'application/vnd.github+json'
        'Content-Type'= 'application/vnd.android.package-archive'
    }
    $body = [System.IO.File]::ReadAllBytes($FilePath)
    $response = Invoke-RestMethod -Uri $url -Headers $headers -Method POST -Body $body
    return $response
}

function Test-ApkExists {
    param([string]$Path)
    if (-not (Test-Path $Path)) {
        throw "APK not found at: $Path`nRun with -Build to generate it, or build manually first."
    }
}

# ── Validate token ───────────────────────────────────────────────────────────
if ([string]::IsNullOrWhiteSpace($Token)) {
    Write-Error "GitHub token is required.`nSet `$env:GH_TOKEN or pass -Token."
    exit 1
}

# ── Resolve version ──────────────────────────────────────────────────────────
if ([string]::IsNullOrWhiteSpace($Version)) {
    $Version = Get-PackageJsonVersion
    Write-Host "Using version from package.json: $Version" -ForegroundColor Cyan
}

$tag = "v$Version"
$parts = $Version -split '\.'
$major = [int]$parts[0]
$minor = if ($parts.Length -gt 1) { [int]$parts[1] } else { 0 }
$patch = if ($parts.Length -gt 2) { [int]$parts[2] } else { 0 }
$versionCode = $major * 10000 + $minor * 100 + $patch

Write-Host "`n=== Money Weather Mobile Publisher ===" -ForegroundColor Green
Write-Host "Version:     $Version"
Write-Host "VersionCode: $versionCode"
Write-Host "Tag:         $tag"
Write-Host "Repo:        $RepoOwner/$RepoName"
Write-Host ""

# ── Build APK (if requested) ─────────────────────────────────────────────────
if ($Build) {
    Write-Host "Building release APK..." -ForegroundColor Cyan

    Write-Host "  Syncing Capacitor..." -ForegroundColor Gray
    Set-Location client
    npx cap sync 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
    Set-Location ..

    Write-Host "  Building with Gradle..." -ForegroundColor Gray
    Set-Location client\android
    .\gradlew.bat assembleRelease 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
    Set-Location ..\..

    Test-ApkExists $ApkPath
    $apkSize = [math]::Round((Get-Item $ApkPath).Length / 1MB, 2)
    Write-Host "APK built: $ApkPath ($apkSize MB)" -ForegroundColor Green
}
elseif (-not $SkipBuild) {
    Write-Host "Checking for existing APK..." -ForegroundColor Cyan
    Test-ApkExists $ApkPath
    $apkSize = [math]::Round((Get-Item $ApkPath).Length / 1MB, 2)
    Write-Host "Found APK: $ApkPath ($apkSize MB)" -ForegroundColor Green
}
else {
    Test-ApkExists $ApkPath
    Write-Host "Using existing APK: $ApkPath" -ForegroundColor Green
}

# ── Get release info ───────────────────────────────────────────────────────
Write-Host "`nFetching GitHub release $tag..." -ForegroundColor Cyan
$release = Get-GithubReleaseByTag -Tag $tag
Write-Host "Release found: $($release.html_url)" -ForegroundColor Green
Write-Host "Upload URL: $($release.upload_url)" -ForegroundColor DarkGray

# ── Check for existing APK asset ─────────────────────────────────────────────
$assetName = 'app-release.apk'
$existingAsset = Get-GithubReleaseAsset -ReleaseId $release.id -AssetName $assetName
if ($existingAsset) {
    if ($Force) {
        Write-Host "Removing existing APK asset..." -ForegroundColor Yellow
        Remove-GithubReleaseAsset -AssetId $existingAsset.id
        Write-Host "Existing asset removed." -ForegroundColor Green
    }
    else {
        Write-Error "APK asset '$assetName' already exists on this release.`nUse -Force to overwrite, or delete it manually.`nAsset URL: $($existingAsset.browser_download_url)"
        exit 1
    }
}

# ── Upload APK ───────────────────────────────────────────────────────────────
Write-Host "`nUploading APK to GitHub..." -ForegroundColor Cyan
$uploaded = Send-GithubReleaseAsset -UploadUrl $release.upload_url -FilePath $ApkPath -AssetName $assetName
Write-Host "Upload complete!" -ForegroundColor Green
Write-Host "Download URL: $($uploaded.browser_download_url)" -ForegroundColor DarkGray

# ── Update mobile-version.json ──────────────────────────────────────────────
Write-Host "`nUpdating mobile-version.json..." -ForegroundColor Cyan
$mobileVersionPath = 'mobile-version.json'
$mobileVersion = Get-Content $mobileVersionPath -Raw | ConvertFrom-Json

$mobileVersion.version      = $Version
$mobileVersion.versionCode  = $versionCode
$mobileVersion.downloadUrl  = $uploaded.browser_download_url
$mobileVersion.releaseNotes = $mobileVersion.releaseNotes

$mobileVersion | ConvertTo-Json -Depth 3 | Set-Content $mobileVersionPath -Encoding UTF8
Write-Host "mobile-version.json updated." -ForegroundColor Green

# ── Git commit and push ──────────────────────────────────────────────────────
Write-Host "`nCommitting changes..." -ForegroundColor Cyan
git add mobile-version.json client/android/app/build.gradle 2>&1 | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
$commitMsg = "Bump mobile to v$Version"
git diff --cached --quiet; if ($LASTEXITCODE -ne 0) {
    git commit -m $commitMsg 2>&1 | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
    Write-Host "Pushing to origin..." -ForegroundColor Cyan
    git push origin master 2>&1 | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
    Write-Host "Pushed." -ForegroundColor Green
} else {
    Write-Host "No changes to commit." -ForegroundColor Yellow
}

# ── Summary ─────────────────────────────────────────────────────────────────
Write-Host "`n=== Publish Complete ===" -ForegroundColor Green
Write-Host "Version:      $Version"
Write-Host "VersionCode:  $versionCode"
Write-Host "Tag:          $tag"
Write-Host "APK URL:      $($uploaded.browser_download_url)"
Write-Host "Release:      $($release.html_url)"
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. Install v$Version APK on a device (or fresh install)"
Write-Host "  2. Bump version to vNEXT, build, and publish again"
Write-Host "  3. The device running v$Version will detect the new version automatically"
