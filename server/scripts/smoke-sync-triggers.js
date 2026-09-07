// Smoke test: initialize the real server Database against a temp file and verify
// sync change-capture triggers are installed and firing.
// Usage: node scripts/smoke-sync-triggers.js   (after `npx tsc`)
const os = require('os')
const path = require('path')
const fs = require('fs')

const dbPath = path.join(os.tmpdir(), 'mw-sync-smoke.db')
try { fs.unlinkSync(dbPath) } catch {}
process.env.BUDGET_DB_PATH = dbPath

const { initializeDatabase, getDatabase } = require('../dist/server/src/database.js')

initializeDatabase()
  .then(async () => {
    const db = getDatabase()
    const triggers = await db.all("SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name")
    console.log('TRIGGERS', triggers.length, triggers.map((t) => t.name).join(','))
    await db.run("INSERT INTO accounts (id,name,type) VALUES ('smoke','S','checking')")
    await db.run("UPDATE accounts SET name='S2' WHERE id='smoke'")
    const pending = await db.all("SELECT tbl,row_id,op,payload FROM _sync_changes WHERE tbl='accounts'")
    console.log('PENDING', JSON.stringify(pending))
    db.close()
    if (triggers.length !== 21 || pending.length !== 1 || JSON.parse(pending[0].payload).name !== 'S2') {
      console.error('SMOKE FAIL')
      process.exit(1)
    }
    console.log('SMOKE OK')
  })
  .catch((e) => {
    console.error('SMOKE FAIL', e)
    process.exit(1)
  })
