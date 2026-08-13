const fs = require('fs');
const path = require('path');

function walkDir(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      walkDir(filePath, fileList);
    } else if (filePath.endsWith('route.ts')) {
      fileList.push(filePath);
    }
  }
  return fileList;
}

const apiFiles = walkDir(path.join(__dirname, '../src/app/api'));
console.log(`Inspecting ${apiFiles.length} API routes for array queries and duplicate joins...\n`);

for (const file of apiFiles) {
  const content = fs.readFileSync(file, 'utf-8');
  const relativePath = path.relative(path.join(__dirname, '..'), file);

  if (content.includes('findMany') || content.includes('query(') || content.includes('select')) {
    console.log(`=== API Route: ${relativePath} ===`);
    if (content.includes('include:')) {
      console.log(`  - Uses Prisma include for nested relations (Clean hierarchical structure)`);
    }
    if (content.includes('query(')) {
      console.log(`  - Uses raw SQL query()`);
    }
  }
}
