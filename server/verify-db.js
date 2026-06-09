const sqlite3 = require('better-sqlite3');
const fs = require('fs');

const results = {};
const dbPath = 'database/budget.db';

try {
  const db = sqlite3(dbPath, { readonly: true });
  results.tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
  results.rowCounts = {};
  for (const table of results.tables) {
    try {
      results.rowCounts[table] = db.prepare(`SELECT COUNT(*) as c FROM "${table}"`).get().c;
    } catch(e) {
      results.rowCounts[table] = 'error';
    }
  }
  db.close();
  results.success = true;
} catch(e) {
  results.error = e.message;
  results.success = false;
}

fs.writeFileSync('db-verify.json', JSON.stringify(results, null, 2));
console.log('Verification complete');
