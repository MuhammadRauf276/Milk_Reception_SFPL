const fs = require('fs');
const path = require('path');

function searchDir(dir, pattern, results = []) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      if (file !== 'node_modules' && file !== '.next' && file !== '.git') {
        searchDir(filePath, pattern, results);
      }
    } else if (stat.isFile()) {
      const content = fs.readFileSync(filePath, 'utf8');
      if (content.includes(pattern)) {
        results.push(filePath);
      }
    }
  }
  return results;
}

const rootDir = path.join(__dirname, '..', 'src');
console.log('Searching for "auth_session" in:', rootDir);
const matchesSession = searchDir(rootDir, 'auth_session');
console.log('\nFiles referencing "auth_session":');
matchesSession.forEach((m) => console.log(' -', m));

console.log('\nSearching for "auth_token" in:', rootDir);
const matchesToken = searchDir(rootDir, 'auth_token');
console.log('\nFiles referencing "auth_token":');
matchesToken.forEach((m) => console.log(' -', m));
