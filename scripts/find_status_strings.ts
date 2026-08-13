import fs from 'fs';
import path from 'path';

const statusPatterns = [
  'DISPATCHED', 'Dispatched',
  'GATE', 'Gate', 'GATE_IN', 'TOKEN_ISSUED', 'Token Issued',
  'LAB', 'PLANT_QA', 'Sampling', 'QA_PENDING',
  'ACCEPTED', 'Accepted', 'REJECTED', 'Rejected',
  'SCALE_1', 'READY_FOR_GROSS', 'GROSS_WEIGHED', 'First Weight',
  'UNLOAD', 'READY_FOR_UNLOADING', 'UNLOADING', 'UNLOADED', 'Silo Reception',
  'SCALE_2_READY', 'READY_FOR_TARE', 'TARE_WEIGHED', 'Second Weight',
  'READY_FOR_GATE_EXIT', 'COMPLETED', 'Completed',
  'current_status', 'status'
];

function searchStatuses(dir: string) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!['node_modules', '.next', '.git'].includes(entry.name)) {
        searchStatuses(fullPath);
      }
    } else if (entry.isFile() && /\.(ts|tsx|js|jsx|prisma)$/.test(entry.name)) {
      const content = fs.readFileSync(fullPath, 'utf8');
      const lines = content.split('\n');
      lines.forEach((line, index) => {
        statusPatterns.forEach((pat) => {
          if (line.includes(`'${pat}'`) || line.includes(`"${pat}"`) || line.includes(`status === '${pat}'`)) {
            console.log(`${fullPath}:${index + 1} [${pat}] -> ${line.trim()}`);
          }
        });
      });
    }
  }
}

console.log('Auditing codebase for workflow status usages...\n');
searchStatuses('D:\\MilkReceptionApp\\src');
searchStatuses('D:\\MilkReceptionApp\\prisma');
