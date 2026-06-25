---
description: Publish a new version of the Money Weather desktop app to GitHub Releases
tags: [desktop, electron, publish, release]
---

# Publish Desktop App to GitHub Releases

## Prerequisites
- GitHub token with `repo` scope (stored securely, never committed)
- All code changes committed and tested
- Client and server builds are up to date

## Steps

### 1. Bump version
Update version in ALL three `package.json` files:
- `package.json` (root)
- `client/package.json`
- `electron/package.json`

Use the same version string (e.g., `1.1.5`) in all three.

### 2. Rebuild (CRITICAL — do not skip)
// turbo
```powershell
cd "c:\Users\Raymond\CascadeProjects\BudgetApp"
npm run build:electron
```
**This MUST be run from the project root.** It builds the server, builds the client, copies everything into `electron/`, rebuilds `sqlite3` for Electron, and then packages the Electron app. Running `npm run build` or `cd electron && npm run build` directly will produce a stale build with old client files.

### 3. Commit and tag
```powershell
cd "c:\Users\Raymond\CascadeProjects\BudgetApp"
git add -A
git commit -m "Bump to vX.Y.Z - [description of changes]"
git tag -a vX.Y.Z -m "Release vX.Y.Z"
```

### 4. Push to GitHub
```powershell
git remote set-url origin https://<TOKEN>@github.com/Agidyne84/money-weather-releases.git
git push origin master --tags
git remote set-url origin https://github.com/Agidyne84/money-weather-releases.git
```
Remove the token from the remote URL immediately after pushing.

### 5. Publish release
// turbo
```powershell
cd "c:\Users\Raymond\CascadeProjects\BudgetApp"
$env:GH_TOKEN="<TOKEN>"
.\publish-desktop.ps1
```

`publish-desktop.ps1` now verifies build freshness before uploading. It will fail with a clear error if `electron\client\dist` does not match `client\dist`.

This uploads:
- `MoneyWeather-Setup-X.Y.Z.exe`
- `MoneyWeather-Setup-X.Y.Z.exe.blockmap`
- `latest.yml` (required for auto-updater)

### 6. Verify
Check the release at: https://github.com/Agidyne84/money-weather-releases/releases/latest

Confirm these assets exist:
- `MoneyWeather-Setup-X.Y.Z.exe`
- `MoneyWeather-Setup-X.Y.Z.exe.blockmap`
- `latest.yml`

**Missing `latest.yml` or a stale build will break auto-updates or app functionality.**

## How auto-updates work
- `electron-updater` checks GitHub Releases on app startup (3-second delay)
- If `latest.yml` shows a newer version, it downloads silently
- User gets a dialog: "Restart Now" or "Install on Next Launch"
- Users can also trigger manual check via **Help > Check for Updates**

## Troubleshooting
| Problem | Cause | Fix |
|---------|-------|-----|
| App doesn't detect update | Missing `latest.yml` or wrong version in `latest.yml` | Ensure publish completes, check assets on release page |
| PIN unlock stops working after update | Stale build: `electron\client\dist` has old client files | Always run `npm run build:electron` from the project root; `publish-desktop.ps1` now blocks stale uploads |
| `v1.1.1` broken | Incomplete release missing `.exe` and `latest.yml` | Skip it, publish newer version |
| Workflow not triggering | This repo doesn't use GitHub Actions for releases | Local publish with `publish-desktop.ps1` is the current method |
| Push blocked | Missing GitHub credentials | Inject token temporarily in remote URL |
