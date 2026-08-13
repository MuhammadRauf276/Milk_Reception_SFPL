const fs = require('fs');
const path = require('path');

function walkDir(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      walkDir(filePath, fileList);
    } else if (filePath.endsWith('.tsx') || filePath.endsWith('.jsx')) {
      fileList.push(filePath);
    }
  }
  return fileList;
}

const allFiles = walkDir(path.join(__dirname, '../src'));
console.log(`Scanning ${allFiles.length} tsx/jsx files for key= usage...\n`);

for (const file of allFiles) {
  const content = fs.readFileSync(file, 'utf-8');
  const lines = content.split('\n');
  const relativePath = path.relative(path.join(__dirname, '..'), file);

  lines.forEach((line, idx) => {
    if (line.includes('key=')) {
      console.log(`${relativePath}:${idx + 1}: ${line.trim()}`);
    }
  });
}
