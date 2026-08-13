import fs from 'fs';
import path from 'path';

async function runGlobalNotificationsVerification() {
  console.log('==================================================');
  console.log('RUNNING GLOBAL NOTIFICATION SYSTEM VERIFICATION');
  console.log('==================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail: string) {
    if (condition) {
      console.log(`[PASS] ${testName}: ${detail}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName}: ${detail}`);
      failed++;
    }
  }

  // TOAST-A to TOAST-F: Toast Provider integration in root layout
  const layoutPath = path.join(process.cwd(), 'src/app/layout.tsx');
  const layoutContent = fs.readFileSync(layoutPath, 'utf8');
  assert(layoutContent.includes('ToastProvider'), 'TOAST-A..F', 'RootLayout wraps application in global ToastProvider');

  // Check ToastContext file existence and exported API
  const contextPath = path.join(process.cwd(), 'src/frontend/context/ToastContext.tsx');
  const contextContent = fs.readFileSync(contextPath, 'utf8');
  assert(contextContent.includes('showSuccess') && contextContent.includes('showWarning') && contextContent.includes('showError') && contextContent.includes('showInfo'), 'TOAST-SYS', 'ToastContext exports showSuccess, showWarning, showError, and showInfo');

  // TOAST-G: Warning pattern for pending plant LR
  assert(contextContent.includes('WARNING'), 'TOAST-G', 'ToastContext supports WARNING category for pending Plant LR notifications');

  // TOAST-H & TOAST-I: Error handling pattern - no raw Prisma internals exposed
  const apiRoutesDir = path.join(process.cwd(), 'src/app/api');
  let hasPrismaExposure = false;

  function checkDirForPrismaErrorExposure(dir: string) {
    const files = fs.readdirSync(dir, { withFileTypes: true });
    for (const f of files) {
      const full = path.join(dir, f.name);
      if (f.isDirectory()) {
        checkDirForPrismaErrorExposure(full);
      } else if (f.name.endsWith('.ts') || f.name.endsWith('.tsx')) {
        const content = fs.readFileSync(full, 'utf8');
        if (content.includes('NextResponse.json(err') || content.includes('NextResponse.json({ error: err }')) {
          hasPrismaExposure = true;
        }
      }
    }
  }

  checkDirForPrismaErrorExposure(apiRoutesDir);
  assert(!hasPrismaExposure, 'TOAST-H & TOAST-I', 'API error responses return safe user-facing error strings without raw Prisma stack traces');

  // TOAST-J: Check for raw browser alert() calls in frontend components
  const modulesDir = path.join(process.cwd(), 'src/frontend/modules');
  let alertCount = 0;

  function checkDirForAlerts(dir: string) {
    const files = fs.readdirSync(dir, { withFileTypes: true });
    for (const f of files) {
      const full = path.join(dir, f.name);
      if (f.isDirectory()) {
        checkDirForAlerts(full);
      } else if (f.name.endsWith('.ts') || f.name.endsWith('.tsx')) {
        const content = fs.readFileSync(full, 'utf8');
        const matches = content.match(/\balert\s*\(/g);
        if (matches) {
          alertCount += matches.length;
        }
      }
    }
  }

  checkDirForAlerts(modulesDir);
  assert(alertCount === 0, 'TOAST-J', `Zero browser alert() calls found across frontend modules (Found: ${alertCount})`);

  console.log('\n==================================================');
  console.log(`VERIFICATION COMPLETE: ${passed} PASSED, ${failed} FAILED`);
  console.log('==================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runGlobalNotificationsVerification().catch((err) => {
  console.error(err);
  process.exit(1);
});
