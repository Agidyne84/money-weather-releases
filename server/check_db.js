const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.resolve(__dirname, 'database', 'budget.db');
console.log('DB path:', dbPath);

const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.all("SELECT COUNT(*) as count FROM transactions", [], (err, rows) => {
    if (err) console.error('Transactions count error:', err);
    else console.log('Transaction count:', rows[0].count);
  });

  db.all("SELECT id, name, type, amount, category_id, account_id, is_transfer, transfer_to_account_id FROM transactions LIMIT 20", [], (err, rows) => {
    if (err) console.error('Transactions error:', err);
    else console.log('Transactions:', JSON.stringify(rows, null, 2));
  });

  db.all("SELECT id, name, type, parent_id FROM categories", [], (err, rows) => {
    if (err) console.error('Categories error:', err);
    else console.log('Categories:', JSON.stringify(rows, null, 2));
  });
});

db.close();
