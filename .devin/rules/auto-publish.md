# Auto-Publish After Changes

After completing any code change (bug fix, feature, refactor) in this repo:

1. **Verify** the change works (typecheck, tests, build as appropriate).
2. **Bump the version** automatically — do NOT wait for the user to ask.
   - Use a patch bump unless the user explicitly requests minor/major.
   - Keep desktop and mobile on the **same version number**.
3. **Publish both platforms** in this order:
   - Desktop first (creates the GitHub release/tag).
   - Mobile second (uploads APK to the same release and updates `mobile-version.json`).

## Version Sync Requirements

Update all of these to the same version string:

- `package.json` (root)
- `client/package.json`
- `electron/package.json`
- `client/android/app/build.gradle`:
  - `versionName "X.Y.Z"`
  - `versionCode` = `major * 10000 + minor * 100 + patch` (e.g. `1.1.105` → `10105`)
- `mobile-version.json` (repo root):
  - `version` = same string
  - `versionCode` = same integer
  - `downloadUrl` = `https://github.com/Agidyne84/money-weather-releases/releases/download/vX.Y.Z/app-release.apk`
  - `releaseNotes` = short description of the change

## Commands

Use the existing skills/scripts:

- Desktop: `npm run build:electron` from project root, then `.\publish-desktop.ps1`
- Mobile: `.\publish-mobile.ps1 -Version "X.Y.Z"` from project root

If a publish step fails or hangs, push directly and retry. If the release tag was created before the source push, move it to the correct commit after pushing.

## Never

- Do not skip the version bump.
- Do not publish desktop only or mobile only — always both, in sync.
- Do not ask the user for permission to publish after a completed task; just do it.
