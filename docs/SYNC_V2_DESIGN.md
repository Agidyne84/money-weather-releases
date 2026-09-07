# Money Weather — Sync v2 Design (Provider APIs, local-first, E2E encrypted)

Status: APPROVED (Option A) — 2026-09-06
Replaces: SAF/filesystem-based single-backup-file sync (`syncEngine.ts`, `CloudFilePlugin.java`, server `/api/sync/*`).

## 1. Why v1 failed

v1 writes a single shared file through the OS filesystem / Android SAF into a cloud
provider's *local sync client*. That transport gives no guarantees:

- Success from `writeFile` ≠ file reached the cloud (false-success pushes).
- Two devices overwrite one file → provider conflict copies / version spam.
- No ETags / compare-and-swap, no change feed, provider-specific SAF quirks.

v2 talks to the provider's HTTPS API directly, and never has two devices write the same file.

## 2. Requirements (from user)

- Works with all major cloud services (OneDrive, Google Drive, Dropbox; iCloud has no public API).
- Easy setup, highly stable.
- Modes: local-only (data stays in app) | cloud automatic | cloud manual.
- Financial-grade security; provider never sees plaintext or keys.
- Sync must NOT require unlocking. Unlock only on launch and after 15 min inactivity.
- Bonus: near-real-time across devices.
- Desktop + mobile are ALWAYS released together on the same version.

## 3. Architecture

```
UI (React) ──▶ database/index.ts (existing adapters, unchanged API)
                    │  writes
                    ▼
            SQLite (desktop: server/, mobile: capacitor sqlite)
                    │  triggers
                    ▼
            _sync_changes (op log: table,row_id,op,payload,hlc,device_id)
                    │
                    ▼
            syncV2/engine.ts ── merge (LWW per row via HLC)
                    │
                    ▼
            syncV2/crypto.ts (AES-256-GCM, data key)
                    │
                    ▼
            syncV2/providers/{onedrive,gdrive,dropbox}.ts  (CloudProvider interface)
                    │  HTTPS + OAuth PKCE
                    ▼
            Provider API (ETag CAS, delta feed)
```

### 3.1 Change capture — SQLite triggers (platform agnostic)

Table `_sync_changes`:

| col | type | notes |
|---|---|---|
| seq | INTEGER PK AUTOINCREMENT | local ordering |
| tbl | TEXT | accounts, categories, transactions, forecast_overrides, transaction_rules, historical_transactions, user_preferences |
| row_id | TEXT | PK of the row (user_preferences: `key`) |
| op | TEXT | `upsert` \| `delete` |
| payload | TEXT | JSON of full row for upsert, NULL for delete |
| hlc | TEXT | hybrid logical clock `"<ms>-<counter>-<deviceId>"` |
| device_id | TEXT | this device |
| pushed | INTEGER | 0 until included in an uploaded change file |

`AFTER INSERT/UPDATE/DELETE` triggers on each synced table write one row here.
Triggers are suppressed during *apply* of remote changes via a `_sync_meta.applying=1` flag
checked in the trigger `WHEN` clause, so remote applies don't echo back.

Same `schema.sql` additions run on desktop (server) and mobile (mobileDb.ts).

### 3.2 Cloud layout — one writer per file

```
/Apps/MoneyWeather/<vault-id>/
   manifest.json.enc            # vault metadata (created by first device, then immutable)
   snapshot.enc                 # full DB image, rewritten only by the "compactor" (see 3.5)
   devices/<device-id>.enc      # append-only change batches from that device ONLY
```

- A device only ever PUTs `devices/<its-own-id>.enc` (and the snapshot when it is compactor).
- No two devices write the same file → no conflict copies, ever.
- Every PUT uses `If-Match: <etag>`; a 412 means "someone else wrote" → re-read, re-merge, retry.

### 3.3 Merge — per-row last-writer-wins with HLC

- For each `(tbl,row_id)` take the change with the greatest `hlc`.
- Deletes are tombstones (win if newer). Tombstones are compacted after 90 days.
- HLC = `max(wallClock, lastHlc+1)` — tolerates clock skew between devices.
- FK ordering on apply: accounts, categories → transactions → forecast_overrides,
  transaction_rules, historical_transactions → user_preferences.

### 3.4 Sync cycle (`engine.syncOnce()`), exclusive lock

1. `provider.delta()` → list of changed files since cursor.
2. Download+decrypt changed `devices/*.enc` (and snapshot if newer than local base).
3. Merge into local DB with `applying=1`.
4. Read local unpushed `_sync_changes`; encrypt; append to own device file with `If-Match`.
5. Mark pushed; store new cursor/etags in `_sync_meta`.

Triggers:
- **automatic**: debounce 3 s after any local write; poll `delta()` every 30 s foregrounded, on
  app focus/resume, and on network reconnect.
- **manual**: Sync button and pull-to-refresh call `syncOnce()`.

### 3.5 Compaction

The device with the lexicographically lowest active device-id (heartbeat < 7 days) is
compactor. When any device file > 2 MB or > 500 batches, compactor writes a new
`snapshot.enc` (If-Match) then truncates *its own* device file. Other devices truncate
their own file after confirming the snapshot's `includesUpTo[deviceId]` covers them.

### 3.6 Security

- **Data key (DK)**: random 256-bit AES-GCM key generated at vault creation. All cloud
  blobs are encrypted with DK. Provider never sees DK or plaintext.
- **Passphrase**: PBKDF2-SHA256 600 000 iters (Web Crypto; no native Argon2 dependency)
  → KEK. `manifest.json.enc` contains `wrap(KEK, DK)` so a new device can join with the
  passphrase alone.
- **Device keystore**: DK is wrapped and stored in the OS keystore so sync runs with the
  UI locked:
  - Android: `@aparajita/capacitor-secure-storage` (Android Keystore backed).
  - Desktop: Electron `safeStorage` (DPAPI) via new IPC `secure:set/get/remove`.
- **UI lock** (`lockService.ts`) becomes a pure UI gate. Timeout → 15 min. It no longer
  gates the sync passphrase.
- OAuth tokens (refresh token) stored in the same keystore. PKCE, no client secret in app.
- All blobs: `MAGIC "MWS2" | ver | deviceId | iv | ciphertext | tag`. AAD = vault-id + filename
  (prevents blob swapping between vaults/files).

### 3.7 Providers

`CloudProvider` interface:

```ts
interface CloudProvider {
  id: 'onedrive' | 'gdrive' | 'dropbox'
  signIn(): Promise<void>; signOut(): Promise<void>; isSignedIn(): Promise<boolean>
  ensureFolder(path: string): Promise<void>
  list(path: string): Promise<FileMeta[]>
  get(path: string): Promise<{ data: Uint8Array; etag: string } | null>
  put(path: string, data: Uint8Array, opts: { ifMatch?: string; ifNoneMatch?: boolean }): Promise<{ etag: string }>
  delete(path: string): Promise<void>
  delta(cursor: string | null): Promise<{ changed: FileMeta[]; cursor: string }>
}
```

| Provider | Auth | CAS | Change feed |
|---|---|---|---|
| OneDrive | MS Identity PKCE, scope `Files.ReadWrite.AppFolder offline_access` | `If-Match` eTag | `/drive/special/approot/delta` |
| Google Drive | Google OAuth PKCE, scope `drive.file` (`drive.appdata` optional) | `If-Match` on `files.update` (or version check) | `changes.list` with `startPageToken` |
| Dropbox | Dropbox OAuth PKCE, App-folder app | `mode: update <rev>` | `files/list_folder/continue` cursor |

OAuth redirect:
- Desktop: system browser → loopback `http://127.0.0.1:<port>/callback` served by Electron main.
- Android: Chrome Custom Tab (`@capacitor/browser`) → custom scheme `moneyweather://oauth` via `App.addListener('appUrlOpen')`.

HTTP: renderer `fetch`. Electron CSP `connect-src` extended to provider hosts.

### 3.8 End-user setup flow (APPROVED: App Folder + named vaults)

Non-technical, 4 taps:

1. **Choose service** — OneDrive / Google Drive / Dropbox tiles.
2. **Sign in** — provider's own consent screen opens (system browser / Chrome Custom Tab).
   Permission requested is *App Folder only*; the app cannot see the rest of the drive.
3. **Sync password** — create (first device) or enter (joining device). Shown once with a
   clear "we cannot recover this" notice. Optional: remember with PIN/biometric.
4. **Mode** — Automatic (recommended) or Manual.

Storage location is fixed: `Apps/Money Weather/<vault>/`. Users never pick files or
folders. Multiple budgets = multiple **vaults** (default vault name "My Budget"); the
joining device sees a list of existing vaults and picks one.

### 3.9 Modes & settings (`_sync_meta` / Preferences)

- `sync.mode`: `off` | `auto` | `manual`
- `sync.provider`, `sync.vaultId`, `sync.deviceId`, `sync.cursor`, per-file etags.
- Migration: on first v2 enable, if a v1 `cloud-backup.budgetbackup` path exists, offer
  "Import existing backup as initial snapshot".

## 4. Phases

| # | Phase | Deliverable | Needs creds? |
|---|---|---|---|
| 1 | Change capture | `_sync_changes` + triggers (server schema + mobileDb), HLC util, unit tests | no |
| 2 | Crypto + keystore | `syncV2/crypto.ts`, Electron `safeStorage` IPC, DK wrap/unwrap, lock decoupling (15 min) | no |
| 3 | Merge engine | `syncV2/engine.ts` with a `MemoryProvider` test double; full unit tests for merge/tombstones/compaction | no |
| 4 | OneDrive provider | PKCE (desktop loopback + Android custom tab), Graph adapter, delta | **Azure app client ID** |
| 5 | Settings UI | New Cloud Sync page: provider sign-in, mode, status, manual sync, join-vault flow, v1 import | no |
| 6 | Google Drive + Dropbox | adapters | **Google + Dropbox client IDs** |
| 7 | Remove v1 | delete `CloudFilePlugin.java` usage, `/api/sync/*`, `syncEngine.ts` | no |

Each phase ends with a same-version desktop + mobile publish.

## 5. Developer (publisher) one-time registrations

These are done ONCE by the app publisher and baked into the build as public client IDs
(PKCE, no secrets). End users never see or configure them.

1. **Azure (OneDrive)**: App registration → "Mobile and desktop applications" platform.
   Redirect URIs: `http://127.0.0.1` (loopback, any port) and `moneyweather://oauth`.
   API permission: `Files.ReadWrite.AppFolder`, `offline_access`. → give me the **Application (client) ID**.
2. **Google Cloud (Drive)**: OAuth client type "Desktop" (for Electron) and "Android"
   (package `com.monroe.moneyweather` + SHA-1 of the release keystore). Enable Drive API. → **client IDs**.
3. **Dropbox**: App console → Scoped access, App folder. Redirect URIs as above. → **App key**.
