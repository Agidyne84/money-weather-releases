---
description: Publish a new version of the Money Weather Android app with OTA updates
tags: [mobile, android, ota, publish, apk]
---

# Publish Mobile App (Android OTA)

## How it works
- Android app checks `mobile-version.json` on startup
- If `versionCode` in JSON is higher than the app's `versionCode`, user sees "Update Available"
- Tapping "Update Now" downloads the APK via Android's `DownloadManager`
- When download completes, Android install dialog opens automatically
- **First time only**: User must enable "Install unknown apps" in system settings

## Prerequisites
- Release signing keystore configured (`client/android/app/money-weather-release.keystore`)
- `keystore.properties` in `client/android/`
- GitHub token with `repo` scope (for uploading APK to releases)

## Step 1: Bump version
Update these files with the new version:

1. `package.json` (root), `client/package.json`, `electron/package.json` — same version string
2. `client/android/app/build.gradle`:
   ```gradle
   versionName "X.Y.Z"
   versionCode [major*10000 + minor*100 + patch]  // e.g., 1.1.5 = 10105
   ```
3. `mobile-version.json` (repo root):
   ```json
   {
     "version": "X.Y.Z",
     "versionCode": 10105,
     "downloadUrl": "https://github.com/Agidyne84/money-weather-releases/releases/download/vX.Y.Z/app-release.apk",
     "force": false,
     "releaseNotes": "Describe what's new"
   }
   ```

## Step 2: Sync web assets
// turbo
```bash
cd client
npx cap sync
```

## Step 3: Build release APK
```bash
cd client/android
.\gradlew.bat assembleRelease
```

Output: `client/android/app/build/outputs/apk/release/app-release.apk`

> **Important**: APK must be signed with the same keystore as previous releases, or Android will reject the update install.

## Step 4: Upload APK to GitHub Release
Option A — GitHub CLI:
```bash
gh release upload vX.Y.Z client/android/app/build/outputs/apk/release/app-release.apk
```

Option B — Drag and drop on the release page:
https://github.com/Agidyne84/money-weather-releases/releases

Option C — Use the desktop publish script (upload manually via GitHub web UI):
After `npm run publish` completes for desktop, edit the release and attach the APK.

## Step 5: Commit and push `mobile-version.json`
```bash
git add mobile-version.json client/android/app/build.gradle
git commit -m "Bump mobile to vX.Y.Z"
git push origin master
```

`mobile-version.json` must be on the `main`/`master` branch for the raw GitHub URL to serve it.

## Step 6: Verify
1. Open the app on an Android device
2. If the app's `versionCode` is lower than `mobile-version.json`, the update prompt appears
3. Tap "Update Now" → allow permissions → download → install

## Troubleshooting
| Problem | Cause | Fix |
|---------|-------|-----|
| "App not installed" after download | APK signed with different keystore | Always use the same `money-weather-release.keystore` |
| "Can't open file" | FileProvider not configured or URI wrong | Verify `AndroidManifest.xml` has FileProvider with `.fileprovider` authority |
| No update prompt | versionCode not increased | `mobile-version.json` versionCode must be strictly greater than app's versionCode |
| "Install unknown apps" keeps appearing | User hasn't enabled it in Settings | The app opens Settings automatically; user must toggle it ON and return |
| Download never completes | URL is wrong or APK not accessible | Verify `downloadUrl` in `mobile-version.json` is publicly accessible |

## Architecture
- **Check**: `otaUpdate.ts` fetches `mobile-version.json` from GitHub raw, compares `versionCode`
- **Permission**: `OtaUpdatePlugin.java` checks `canRequestPackageInstalls()` (Android 8+ requirement)
- **Download**: Android `DownloadManager` handles background download to app-private Downloads
- **Install**: `FileProvider` creates a content URI → `ACTION_VIEW` intent triggers system installer
- **UI**: `MobileUpdatePrompt.tsx` shows dialogs for update, permission, and progress
