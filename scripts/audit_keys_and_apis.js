const fs = require('fs');
const path = require('path');

function walkDir(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      walkDir(filePath, fileList);
    } else if (filePath.endsWith('.tsx') || filePath.endsWith('.jsx') || filePath.endsWith('.ts')) {
      fileList.push(filePath);
    }
  }
  return fileList;
}

const allFiles = walkDir(path.join(__dirname, '../src'));
console.log(`===============================================================`);
console.log(`🔍 AUDITING ${allFiles.length} FRONTEND & BACKEND FILES FOR KEYS & APIS`);
console.log(`===============================================================\n`);

const frontendKeyMap = [];
const apiArrayRoutes = [];

for (const file of allFiles) {
  const content = fs.readFileSync(file, 'utf-8');
  const lines = content.split('\n');
  const relativePath = path.relative(path.join(__dirname, '..'), file);

  // Frontend key inspection
  if (file.endsWith('.tsx') || file.endsWith('.jsx')) {
    lines.forEach((line, idx) => {
      if (line.includes('key=') || line.includes('.map(') || line.includes('<Fragment') || line.includes('<React.Fragment')) {
        frontendKeyMap.push({
          file: relativePath,
          line: idx + 1,
          code: line.trim(),
        });
      }
    });
  }

  // API inspection
  if (file.includes('src/app/api/') && file.endsWith('route.ts')) {
    if (content.includes('findMany') || content.includes('query(') || content.includes('NextResponse.json')) {
      apiArrayRoutes.push({
        file: relativePath,
        hasFindMany: content.includes('findMany'),
        hasRawQuery: content.includes('query('),
      });
    }
  }
}

console.log(`--- FRONTEND MAP & KEY LOCATIONS (${frontendKeyMap.length} found) ---`);
frontendKeyMap.forEach((item) => {
  console.log(`${item.file}:${item.line}: ${item.code}`);
});

console.log(`\n--- API ROUTE ARRAY PROVIDERS (${apiArrayRoutes.length} found) ---`);
apiArrayRoutes.forEach((item) => {
  console.log(`${item.file} (findMany: ${item.hasFindMany}, rawQuery: ${item.hasRawQuery})`);
});
