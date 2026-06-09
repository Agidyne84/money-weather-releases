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

## Step 2: Build and publish (automated)
Run the PowerShell script from the project root:

```powershell
# Set your GitHub token
$env:GH_TOKEN = "ghp_xxxxxxxx"

# Build APK and upload to the release created by desktop publish
.\publish-mobile.ps1 -Version "X.Y.Z" -Build

# Or, if APK is already built:
.\publish-mobile.ps1 -Version "X.Y.Z" -SkipBuild

# Or, to overwrite an existing APK on the release:
.\publish-mobile.ps1 -Version "X.Y.Z" -SkipBuild -Force
```

The script will:
1. Sync Capacitor (`npx cap sync`) if `-Build` is used
2. Build the release APK (`gradlew assembleRelease`) if `-Build` is used
3. Find the existing GitHub release by tag (created by desktop `npm run publish`)
4. Upload `app-release.apk` as a release asset
5. Update `mobile-version.json` with the correct `versionCode` and `downloadUrl`
6. Commit and push the updated `mobile-version.json`

> **Important**: APK must be signed with the same keystore as previous releases, or Android will reject the update install.

## Manual steps (if script fails)

### Build release APK
```bash
cd client
npx cap sync
cd android
.\gradlew.bat assembleRelease
```
Output: `client/android/app/build/outputs/apk/release/app-release.apk`

### Upload APK to GitHub Release
```bash
gh release upload vX.Y.Z client/android/app/build/outputs/apk/release/app-release.apk
```
Or drag-and-drop on the release page.

### Commit and push `mobile-version.json`
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
