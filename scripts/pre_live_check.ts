import 'dotenv/config';
import { chromium } from 'playwright';
import { prisma } from '../src/backend/core/db';
import { createSessionToken } from '../src/backend/core/auth';
import type { Role } from '../src/backend/core/types';

const CHROME_PATH = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';

interface ScreenTest {
  id: string;
  name: string;
  url: string;
  username: string;
  expectedSelector?: string;
}

const TEST_SCREENS: ScreenTest[] = [
  // 1. Super Admin screens
  { id: 'SA-01', name: 'Super Admin Overview', url: 'http://127.0.0.1:3000/super-admin', username: 'admin.superuser' },
  { id: 'SA-02', name: 'Super Admin Users', url: 'http://127.0.0.1:3000/super-admin/users', username: 'admin.superuser' },
  { id: 'SA-03', name: 'Super Admin Lab Tests', url: 'http://127.0.0.1:3000/super-admin/lab-tests', username: 'admin.superuser' },
  { id: 'SA-04', name: 'Super Admin Test Point Policies', url: 'http://127.0.0.1:3000/super-admin/test-point-policies', username: 'admin.superuser' },
  { id: 'SA-05', name: 'Super Admin Silos', url: 'http://127.0.0.1:3000/super-admin/silos', username: 'admin.superuser' },
  { id: 'SA-06', name: 'Super Admin Procurement Sources', url: 'http://127.0.0.1:3000/super-admin/procurement-sources', username: 'admin.superuser' },
  { id: 'SA-07', name: 'Super Admin Weighing Policy', url: 'http://127.0.0.1:3000/super-admin/weighing-policy', username: 'admin.superuser' },
  { id: 'SA-08', name: 'Super Admin Audit Logs', url: 'http://127.0.0.1:3000/super-admin/audit', username: 'admin.superuser' },
  { id: 'SA-09', name: 'Super Admin Daily Report', url: 'http://127.0.0.1:3000/super-admin/daily-report', username: 'admin.superuser' },
  { id: 'SA-10', name: 'Universal Approval Inbox', url: 'http://127.0.0.1:3000/approvals', username: 'admin.superuser' },

  // 2. Data Executive screens
  { id: 'DE-01', name: 'Data Executive Dashboard', url: 'http://127.0.0.1:3000/data-executive', username: 'data.executive' },

  // 3. Security Guard Gate
  { id: 'SEC-01', name: 'Security Gate Operations', url: 'http://127.0.0.1:3000/department/security', username: 'security.gate' },

  // 4. Weighbridge Operator
  { id: 'WB-01', name: 'Weighbridge Gross & Tare', url: 'http://127.0.0.1:3000/department/weighbridge', username: 'weighbridge.operator' },

  // 5. Plant QA
  { id: 'QA-01', name: 'QA Head Management', url: 'http://127.0.0.1:3000/department/qa-head', username: 'qa.head@shakarganj.com.pk' },
  { id: 'QA-02', name: 'QA Reception Testing Lab', url: 'http://127.0.0.1:3000/department/qa', username: 'qa.reception@shakarganj.com.pk' },

  // 6. Plant Production Operator
  { id: 'PROD-01', name: 'Production Unloading & Silos', url: 'http://127.0.0.1:3000/department/production', username: 'production.operator' },

  // 7. ZMCC Manager (All Tabs)
  { id: 'ZMCC-01', name: 'ZMCC Manager Overview', url: 'http://127.0.0.1:3000/mpd/zmcc-manager?tab=OVERVIEW', username: 'zmcc.manager.hasilpur' },
  { id: 'ZMCC-02', name: 'ZMCC Manager Approvals', url: 'http://127.0.0.1:3000/mpd/zmcc-manager?tab=INBOX', username: 'zmcc.manager.hasilpur' },
  { id: 'ZMCC-03', name: 'ZMCC Manager Hierarchy', url: 'http://127.0.0.1:3000/mpd/zmcc-manager?tab=HIERARCHY', username: 'zmcc.manager.hasilpur' },
  { id: 'ZMCC-04', name: 'ZMCC Manager Fleet', url: 'http://127.0.0.1:3000/mpd/zmcc-manager?tab=FLEET', username: 'zmcc.manager.hasilpur' },
  { id: 'ZMCC-05', name: 'ZMCC Manager Transit', url: 'http://127.0.0.1:3000/mpd/zmcc-manager?tab=TRANSIT', username: 'zmcc.manager.hasilpur' },

  // 8. Field MDO & PHE Chiller
  { id: 'PHE-01', name: 'PHE Chiller Station', url: 'http://127.0.0.1:3000/phe', username: 'phe.operator' },
  { id: 'MOT-01', name: 'MDO Field Collection App', url: 'http://127.0.0.1:3000/mot', username: 'mdo.hasilpur' },
  { id: 'ZMCC-LAB', name: 'ZMCC Reception Lab', url: 'http://127.0.0.1:3000/zmcc/lab', username: 'zmcc.operator' },

  // 9. Contractor Operations
  { id: 'CONT-01', name: 'Contractor Manager Portal', url: 'http://127.0.0.1:3000/contractor/manager', username: 'contractor.manager.alkhair' },
  { id: 'CONT-02', name: 'Contractor Dispatch Flow', url: 'http://127.0.0.1:3000/contractor/dispatch', username: 'contractor.operator.alkhair' },

  // 10. Public TV Board & WhatsApp
  { id: 'TV-01', name: 'Public TV Board', url: 'http://127.0.0.1:3000/tv-board', username: 'admin.superuser' },
  { id: 'WA-01', name: 'WhatsApp Gateway Dashboard', url: 'http://127.0.0.1:3000/whatsapp-gateway', username: 'admin.superuser' },
];

async function runPreLiveCheck() {
  console.log('================================================================');
  console.log('   MILK RECEPTION APP - PRE-LIVE SYSTEM VERIFICATION SUITE');
  console.log('================================================================\n');

  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: true,
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });

  let passCount = 0;
  let failCount = 0;
  const results: Array<{ id: string; name: string; status: 'PASS' | 'FAIL'; note: string }> = [];

  // -------------------------------------------------------------
  // TEST 1: REAL UI LOGIN FORM SUBMISSION
  // -------------------------------------------------------------
  console.log('[TEST 1/2] Verifying Interactive UI Form Login at /login...');
  try {
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:3000/login', { waitUntil: 'networkidle' });

    await page.fill('input#username, input[name="username"]', 'admin.superuser');
    await page.fill('input#password, input[name="password"]', 'admin123');
    await page.click('button[type="submit"]');

    await page.waitForURL('**/super-admin**', { timeout: 8000 });
    console.log('  ✓ UI Form Login Succeeded! Redirected to /super-admin cleanly.\n');
    passCount++;
    results.push({ id: 'AUTH-UI', name: 'Interactive UI Form Login', status: 'PASS', note: 'Login form redirects to dashboard' });
    await page.close();
  } catch (err: any) {
    console.error('  ✗ UI Form Login Failed:', err.message);
    failCount++;
    results.push({ id: 'AUTH-UI', name: 'Interactive UI Form Login', status: 'FAIL', note: err.message });
  }

  // -------------------------------------------------------------
  // TEST 2: ALL SCREENS & ROLE WORKSPACES VERIFICATION
  // -------------------------------------------------------------
  console.log(`[TEST 2/2] Verifying ${TEST_SCREENS.length} Operational Screens Across All Roles...\n`);

  for (const screen of TEST_SCREENS) {
    const page = await context.newPage();
    const consoleErrors: string[] = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        // Ignore favicon and analytics noise
        if (!text.includes('favicon') && !text.includes('manifest')) {
          consoleErrors.push(text);
        }
      }
    });

    try {
      // Find user in DB
      const dbUser = await prisma.user.findFirst({
        where: { username: screen.username, is_active: true },
      });

      if (!dbUser) {
        throw new Error(`Required user '${screen.username}' not found in database.`);
      }

      // Generate verified session token
      const token = await createSessionToken({
        id: String(dbUser.id),
        username: dbUser.username,
        name: dbUser.full_name || dbUser.username,
        role: dbUser.role as Role,
        department: dbUser.department || 'Operations',
        zone: dbUser.zone || null,
        scope_type: dbUser.scope_type || 'ALL',
        procurement_source_id: dbUser.procurement_source_id ? String(dbUser.procurement_source_id) : null,
      });

      // Set cookie in browser context
      await context.addCookies([
        {
          name: 'auth_token',
          value: token,
          url: 'http://127.0.0.1:3000',
        },
      ]);

      const resp = await page.goto(screen.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      const status = resp?.status() || 0;

      // Allow 1.5s for client hydration
      await page.waitForTimeout(1500);

      const bodyText = await page.innerText('body');
      const hasCrash = /Unhandled Runtime Error|Crash|column.*does not exist|Invalid `prisma\./i.test(bodyText);

      if (status >= 400) {
        throw new Error(`HTTP ${status}`);
      }
      if (hasCrash) {
        throw new Error(`Page contains crash or database error text.`);
      }

      console.log(`  ✓ [${screen.id}] ${screen.name.padEnd(32)} -> HTTP ${status} OK`);
      passCount++;
      results.push({ id: screen.id, name: screen.name, status: 'PASS', note: `HTTP ${status}` });
    } catch (err: any) {
      console.log(`  ✗ [${screen.id}] ${screen.name.padEnd(32)} -> FAILED: ${err.message}`);
      failCount++;
      results.push({ id: screen.id, name: screen.name, status: 'FAIL', note: err.message });
    } finally {
      await page.close();
    }
  }

  await browser.close();

  console.log('\n================================================================');
  console.log(`VERIFICATION SUMMARY: ${passCount} PASSED | ${failCount} FAILED`);
  console.log('================================================================\n');

  if (failCount > 0) {
    process.exit(1);
  }
}

runPreLiveCheck().catch((err) => {
  console.error('Fatal Test Runner Error:', err);
  process.exit(1);
});
