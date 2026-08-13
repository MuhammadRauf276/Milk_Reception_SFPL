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

const files = walkDir(path.join(__dirname, '../src'));
files.forEach((file) => {
  const content = fs.readFileSync(file, 'utf-8');
  if (content.includes('ZonalHistoryTable') || content.includes('zonal-history') || content.includes('Zonal')) {
    console.log(`Found reference in: ${path.relative(path.join(__dirname, '..'), file)}`);
  }
});
