const sqlite3 = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const results = {};

// Check both possible database locations
const dbPaths = [
  path.join(__dirname, 'database', 'budget.db'),
  path.join(__dirname, 'src', 'database', 'budget.db'),
  path.join(process.cwd(), 'database', 'budget.db'),
  path.join(process.cwd(), 'src', 'database', 'budget.db'),
];

dbPaths.forEach(p => {
  if (fs.existsSync(p)) {
    try {
      const db = sqlite3(p, { readonly: true });
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
      const rowCounts = {};
      tables.forEach(t => {
        try {
          const count = db.prepare(`SELECT COUNT(*) as c FROM "${t.name}"`).get();
          rowCounts[t.name] = count.c;
        } catch(e) {
          rowCounts[t.name] = 'error: ' + e.message;
        }
      });
      db.close();
      results[p] = { size: fs.statSync(p).size, tables: rowCounts };
    } catch(e) {
      results[p] = { size: fs.statSync(p).size, error: e.message };
    }
  } else {
    results[p] = { exists: false };
  }
});

fs.writeFileSync('db-check.json', JSON.stringify(results, null, 2));
console.log('Check complete, written to db-check.json');
