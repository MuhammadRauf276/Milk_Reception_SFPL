import fs from 'fs';
import path from 'path';

function searchString(dir: string, pattern: string) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!['node_modules', '.next', '.git'].includes(entry.name)) {
        searchString(fullPath, pattern);
      }
    } else if (entry.isFile() && /\.(ts|tsx|js|jsx)$/.test(entry.name)) {
      const content = fs.readFileSync(fullPath, 'utf8');
      if (content.includes(pattern)) {
        console.log(`${fullPath}`);
      }
    }
  }
}

const srcDir = path.join(path.resolve(__dirname, '..'), 'src');
searchString(srcDir, 'MPDFieldWorkspace');
searchString(srcDir, 'DynamicDispatchForm');
