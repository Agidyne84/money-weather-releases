---
description: SQLite database safety rules for BudgetApp to prevent data loss
tags: [database, sqlite, safety, data-loss-prevention]
---

# BudgetApp SQLite Database Safety Rules

## Canonical Database Path
- The ONLY canonical database file is `server/database/budget.db`.
- `resolveServerAsset()` in `server/src/database.ts` must always resolve to this exact path regardless of whether the code is run from source (`tsx`) or compiled (`dist/`).
- The implementation finds the `server/` directory by locating `package.json` with `name: "budget-app-server"` and joins the relative path from there.

## Prohibited Operations
- **NEVER** move, rename, or delete `budget.db` during troubleshooting.
- **NEVER** use `mv` or `Copy-Item -Force` to overwrite `budget.db` without first verifying row counts in both source and destination.
- **NEVER** rely on `process.cwd()` or `__dirname` arithmetic alone without an explicit anchor (e.g., `package.json` lookup).

## Backup Protocol
- Before any database-related change, create a timestamped backup using `Copy-Item` (not `Move-Item`).
- Existing `budget.db.bak` must be preserved until the new backup is verified.
- Verify backups by checking table row counts with SQLite before trusting them.

## Startup Verification
- On every server startup, log the resolved database path with `[DB] Resolved asset ...`.
- If a second empty database is ever detected anywhere else in the project tree, investigate immediately and delete the stray file after confirming the canonical database is intact.

## Migration Safety
- Migrations must be idempotent (`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ADD COLUMN IF NOT EXISTS` or equivalent checks).
- Migration scripts must not be required/instantiated inside the Database constructor, because that creates a second database connection which can cause `SQLITE_MISUSE` or race conditions.
- Schema changes must be applied via `ensureColumn()` calls inside the Database class, not via external migration scripts that open their own connection.
