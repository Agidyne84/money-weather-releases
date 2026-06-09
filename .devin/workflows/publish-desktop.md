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

### 2. Rebuild
// turbo
```powershell
cd "c:\Users\Raymond\CascadeProjects\BudgetApp"
npm run build
```
This builds the server, builds the client, copies everything into `electron/`, and rebuilds `sqlite3` for Electron.

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
cd "c:\Users\Raymond\CascadeProjects\BudgetApp\electron"
$env:GH_TOKEN="<TOKEN>"
npm run publish
```

This runs `electron-builder --publish=always`, which:
- Packages the app for Windows (NSIS)
- Creates `Money-Weather-Setup-X.Y.Z.exe`
- Creates `latest.yml` (required for auto-updater)
- Creates a GitHub Release at `vX.Y.Z`
- Uploads `.exe`, `.blockmap`, and `latest.yml`

### 6. Verify
Check the release at: https://github.com/Agidyne84/money-weather-releases/releases/latest

Confirm these assets exist:
- `Money-Weather-Setup-X.Y.Z.exe`
- `Money-Weather-Setup-X.Y.Z.exe.blockmap`
- `latest.yml`

**Missing `latest.yml` will break auto-updates.**

## How auto-updates work
- `electron-updater` checks GitHub Releases on app startup (3-second delay)
- If `latest.yml` shows a newer version, it downloads silently
- User gets a dialog: "Restart Now" or "Install on Next Launch"
- Users can also trigger manual check via **Help > Check for Updates**

## Troubleshooting
| Problem | Cause | Fix |
|---------|-------|-----|
| App doesn't detect update | Missing `latest.yml` or wrong version in `latest.yml` | Ensure publish completes, check assets on release page |
| `v1.1.1` broken | Incomplete release missing `.exe` and `latest.yml` | Skip it, publish newer version |
| Workflow not triggering | This repo doesn't use GitHub Actions for releases | Local publish with `npm run publish` is the current method |
| Push blocked | Missing GitHub credentials | Inject token temporarily in remote URL |
