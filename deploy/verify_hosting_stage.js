const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

try {
  const [site, manifestPath] = process.argv.slice(2);
  const expected = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).files;
  const actual = [];
  function walk(dir, prefix = '') {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, relative);
      else if (entry.isFile()) actual.push({path: relative, sha256: crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex').toUpperCase()});
      else throw new Error(`Unexpected stage entry: ${relative}`);
    }
  }
  walk(site);
  const sort = (a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  actual.sort(sort);
  expected.sort(sort);
  if (actual.length !== expected.length || actual.some((file, i) => file.path !== expected[i].path || file.sha256 !== expected[i].sha256)) throw new Error('Hosting stage manifest mismatch');
  console.log(`Hosting stage verified: ${actual.length} files`);
} catch (error) {
  console.error(`Hosting stage verification failed: ${error.message}`);
  process.exitCode = 1;
}
