import fs from 'fs';
import path from 'path';

function findMpdFiles(dir: string) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!['node_modules', '.next', '.git'].includes(entry.name)) {
        findMpdFiles(fullPath);
      }
    } else if (entry.isFile() && /\.(ts|tsx|js|jsx)$/.test(entry.name)) {
      if (entry.name.toLowerCase().includes('mpd') || entry.name.toLowerCase().includes('dispatch')) {
        console.log(fullPath);
      }
    }
  }
}

findMpdFiles(path.join(path.resolve(__dirname, '..'), 'src'));
