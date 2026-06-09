const fs = require('fs');
const path = require('path');

const output = [];
const dirs = [
  path.join(__dirname, 'database'),
  path.join(__dirname, 'src', 'database'),
  path.join(process.cwd(), 'database'),
  path.join(process.cwd(), 'src', 'database'),
];

dirs.forEach(dir => {
  output.push(`DIR: ${dir}`);
  if (fs.existsSync(dir)) {
    fs.readdirSync(dir).forEach(f => {
      const stat = fs.statSync(path.join(dir, f));
      output.push(`  ${f} ${stat.size}`);
    });
  } else {
    output.push('  (does not exist)');
  }
});

fs.writeFileSync('check-output.txt', output.join('\n'));
