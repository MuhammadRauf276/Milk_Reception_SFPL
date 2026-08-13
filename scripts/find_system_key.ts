import fs from 'fs';
import path from 'path';

function findMatches(dir: string) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!['node_modules', '.next', '.git'].includes(entry.name)) {
        findMatches(fullPath);
      }
    } else if (entry.isFile()) {
      if (/\.(ts|tsx|js|jsx|prisma|json|md)$/.test(entry.name)) {
        const content = fs.readFileSync(fullPath, 'utf8');
        const lines = content.split('\n');
        lines.forEach((line, index) => {
          if (line.includes('systemKey') || line.includes('system_key')) {
            console.log(`${fullPath}:${index + 1} -> ${line.trim()}`);
          }
        });
      }
    }
  }
}

console.log('Searching for systemKey and system_key in D:\\MilkReceptionApp...');
findMatches('D:\\MilkReceptionApp');
