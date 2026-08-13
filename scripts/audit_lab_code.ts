import fs from 'fs';
import path from 'path';

function searchCode(dir: string, patterns: { search: string; label: string }[]) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      if (file !== 'node_modules' && file !== '.next' && file !== '.git') {
        searchCode(filePath, patterns);
      }
    } else if (stat.isFile() && (file.endsWith('.ts') || file.endsWith('.tsx') || file.endsWith('.js'))) {
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n');
      lines.forEach((line, idx) => {
        patterns.forEach((pat) => {
          if (line.includes(pat.search)) {
            console.log(`[${pat.label}] ${filePath}:${idx + 1} -> ${line.trim()}`);
          }
        });
      });
    }
  }
}

const rootDir = path.join(__dirname, '..', 'src');
console.log('Auditing codebase for LabTest usage in:', rootDir);

searchCode(rootDir, [
  { search: 'testCode', label: 'testCode' },
  { search: 'test_id', label: 'test_id' },
  { search: 'testId', label: 'testId' },
  { search: 'testName', label: 'testName' },
  { search: 'systemKey', label: 'systemKey' },
  { search: 'evaluateLabResult', label: 'evaluateLabResult' },
]);
