# Session State (updated 2026-10-28)

Current released version: **v1.1.109** (desktop + mobile, synced).

## What's in place

- **Auto-publish rule** (`.devin/rules/auto-publish.md`): after every completed task, bump patch version across `package.json`, `client/package.json`, `electron/package.json`, `client/android/app/build.gradle` (versionCode = major*10000+minor*100+patch), `mobile-version.json`; commit, push, then publish desktop (`npm run build:electron` → `publish-desktop.ps1`) then mobile (`publish-mobile.ps1`). GH token comes from `git credential fill` (Git Credential Manager OAuth token works for the release API).
- **Mobile OneDrive sync via Microsoft Graph** (`client/src/services/oneDriveProvider.ts`): PKCE OAuth (`prompt=select_account`), authority `common` (personal + work/school), refresh token in SecureStorage+Preferences, `onedrive:` path scheme routed through syncEngine's mobile file/pull/push paths. SAF remains for other providers.
- **Azure app registration**: client ID `ad5d849b-e20c-4d22-a862-2d34b36412b4`, redirect `moneyweather://oauth` (mobile/desktop platform), scope `Files.ReadWrite offline_access`.
- **In-app OneDrive file browser** in `CloudSyncSettings.tsx` (pick existing file anywhere, create new in any folder, quota display). SAF-picked OneDrive URIs (`com.microsoft.skydrive.*`) are blocked with a modal offering Connect OneDrive / pick different file.
- **ScrollRestoration.tsx**: per-history-entry scroll memory (POP restores, PUSH tops). Mobile scroll container tagged `data-scroll-container` in Layout.tsx.

## Known context

- SAF+OneDrive is fundamentally unreliable (writes cache locally, never upload; no ACTION_OPEN_DOCUMENT_TREE). Graph transport fixed mobile push/pull.
- Watch for: `quotaLimitReached` on push — browser shows "X GB free of Y GB" at root to confirm if the drive is actually full.
- Sync v2 design in `docs/SYNC_V2_DESIGN.md` — Phase 1 (change-log triggers + HLC in `shared/sync/`) shipped in 1.1.104. Remaining phases: crypto/keystore decoupling, merge engine, provider adapters behind one interface (Drive/Dropbox adapters still need OAuth registrations), delta polling.
- publish-mobile.ps1's internal `git push` throws a false NativeCommandError (stderr progress) — verify remote state with `git ls-remote`; it actually succeeds.

## New machine setup

Android Studio (SDK+JDK+adb), Node.js, VS Build Tools (C++ workload) + Python for node-gyp/sqlite3, Git for Windows. `client/android/local.properties` `sdk.dir` may need updating. Keystore (`client/android/app/money-weather-release.keystore` + `keystore.properties`) is gitignored — already carried over by folder copy; do not lose it.
