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

const files = walkDir(path.join(__dirname, '../src'));
console.log('Tracing ZMCC Manager pages & components...\n');

files.forEach((file) => {
  const rel = path.relative(path.join(__dirname, '..'), file);
  const content = fs.readFileSync(file, 'utf-8');

  if (rel.includes('fleet-tracking') || rel.includes('cross-verification') || rel.includes('KanbanBoard') || rel.includes('ZonalHistory') || rel.includes('AdaptiveVehicleCard')) {
    console.log(`=== File: ${rel} ===`);
    const maps = [];
    const lines = content.split('\n');
    lines.forEach((line, idx) => {
      if (line.includes('.map(') || line.includes('key=')) {
        maps.push(`  L${idx + 1}: ${line.trim()}`);
      }
    });
    console.log(maps.slice(0, 15).join('\n'));
    console.log('');
  }
});
