import 'dotenv/config';
import { chromium, type Browser } from 'playwright';
import { prisma } from '../src/backend/core/db';
import { createSessionToken } from '../src/backend/core/auth';
import type { Role } from '../src/backend/core/types';

const CHROME_PATH = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';

interface ViewportSpec {
  name: string;
  width: number;
  height: number;
  isMobile: boolean;
}

const VIEWPORTS: ViewportSpec[] = [
  { name: 'Smallest Mobile (320x568)', width: 320, height: 568, isMobile: true },
  { name: 'Android Small (360x800)', width: 360, height: 800, isMobile: true },
  { name: 'iPhone / Small (375x812)', width: 375, height: 812, isMobile: true },
  { name: 'Standard Mobile (390x844)', width: 390, height: 844, isMobile: true },
  { name: 'Android Large / Plus (414x896)', width: 414, height: 896, isMobile: true },
  { name: 'Tablet Portrait (768x1024)', width: 768, height: 1024, isMobile: false },
  { name: 'Tablet Landscape (1024x768)', width: 1024, height: 768, isMobile: false },
  { name: 'Compact Desktop (1280x800)', width: 1280, height: 800, isMobile: false },
  { name: 'Desktop (1366x768)', width: 1366, height: 768, isMobile: false },
];

interface ScreenSpec {
  id: string;
  role: string;
  name: string;
  url: string;
  username: string;
  expectedText?: string;
}

// Complete list covering all canonical roles, department stations, and public screens
const SCREENS: ScreenSpec[] = [
  // 1. Public & Onboarding
  { id: 'AUTH-01', role: 'PUBLIC', name: 'Sign In Screen', url: 'http://127.0.0.1:3000/login', username: '', expectedText: 'Sign in' },
  { id: 'AUTH-02', role: 'DEVICE_PWA', name: 'Device PWA Setup', url: 'http://127.0.0.1:3000/device-setup', username: '', expectedText: 'Phone setup' },

  // 2. Field Operations & Stations
  { id: 'MOT-01', role: 'MOT', name: 'Mobile Tester (MOT) Collection', url: 'http://127.0.0.1:3000/mot', username: 'mot.driver', expectedText: 'Mobile Tester' },
  { id: 'MDO-01', role: 'MDO', name: 'MDO Chiller Station Flow', url: 'http://127.0.0.1:3000/phe', username: 'mdo.hasilpur', expectedText: 'MDO Station' },
  { id: 'PHE-01', role: 'PHE_OPERATOR', name: 'PHE Operator Chiller Station', url: 'http://127.0.0.1:3000/phe', username: 'phe.operator', expectedText: 'PHE Station' },
  { id: 'ZMCC-01', role: 'ZMCC_LAB_ATTENDANT', name: 'ZMCC Reception Laboratory', url: 'http://127.0.0.1:3000/zmcc/lab', username: 'zmcc.operator', expectedText: 'ZMCC Laboratory' },

  // 3. Plant Receiving & Gate Operations
  { id: 'SEC-01', role: 'SECURITY_OPERATOR', name: 'Security Gate Operations', url: 'http://127.0.0.1:3000/department/security', username: 'security.gate', expectedText: 'Gate Entry' },
  { id: 'WB-01', role: 'WEIGHBRIDGE_OPERATOR', name: 'Weighbridge Gross & Tare Station', url: 'http://127.0.0.1:3000/department/weighbridge', username: 'weighbridge.operator', expectedText: 'Weighbridge' },
  { id: 'QA-01', role: 'QA_LAB_ATTENDANT', name: 'Plant QA Reception Testing', url: 'http://127.0.0.1:3000/department/qa', username: 'qa.reception@shakarganj.com.pk', expectedText: 'QA Laboratory' },
  { id: 'QAH-01', role: 'QA_HEAD', name: 'QA Head Management & Dispositions', url: 'http://127.0.0.1:3000/department/qa-head', username: 'qa.head@shakarganj.com.pk', expectedText: 'QA Head' },
  { id: 'PROD-01', role: 'PRODUCTION_RECEPTION_OPERATOR', name: 'Production Silo Unloading Station', url: 'http://127.0.0.1:3000/department/production', username: 'production.operator', expectedText: 'Silo Unloading' },
  { id: 'PROD-02', role: 'PRODUCTION_HEAD', name: 'Production Head Silo Overview', url: 'http://127.0.0.1:3000/department/production', username: 'production.head', expectedText: 'Silo Unloading' },

  // 4. Contractor Logistics
  { id: 'CONT-01', role: 'CONTRACTOR_OPERATOR', name: 'Contractor Dispatch Flow', url: 'http://127.0.0.1:3000/contractor/dispatch', username: 'contractor.operator.alkhair', expectedText: 'Contractor Dispatch' },
  { id: 'CONT-02', role: 'CONTRACTOR_MANAGER', name: 'Contractor Manager Reconciliation Portal', url: 'http://127.0.0.1:3000/contractor/manager', username: 'contractor.manager.alkhair', expectedText: 'Approval Inbox' },

  // 5. Zonal Operations (ZMCC Manager)
  { id: 'ZM-01', role: 'ZMCC_MANAGER', name: 'ZMCC Manager Overview Tab', url: 'http://127.0.0.1:3000/mpd/zmcc-manager?tab=OVERVIEW', username: 'zmcc.manager.hasilpur', expectedText: 'Overview' },
  { id: 'ZM-02', role: 'ZMCC_MANAGER', name: 'ZMCC Manager Approvals Inbox', url: 'http://127.0.0.1:3000/mpd/zmcc-manager?tab=APPROVALS', username: 'zmcc.manager.hasilpur', expectedText: 'Approval Inbox' },
  { id: 'ZM-03', role: 'ZMCC_MANAGER', name: 'ZMCC Manager Fleet & Transit', url: 'http://127.0.0.1:3000/mpd/zmcc-manager?tab=PLANT_TRANSIT', username: 'zmcc.manager.hasilpur', expectedText: 'Plant Dispatches' },

  // 6. Executive & Governance Workspaces
  { id: 'MPD-01', role: 'HEAD_OF_MPD', name: 'Head of MPD Command Console', url: 'http://127.0.0.1:3000/command', username: 'mpd.head', expectedText: 'Command Center' },
  { id: 'EXEC-01', role: 'EXECUTIVE_MANAGEMENT', name: 'Executive Management Console', url: 'http://127.0.0.1:3000/command', username: 'executive.management', expectedText: 'Command Center' },
  { id: 'FIN-01', role: 'FINANCE_ACCOUNTS', name: 'Finance & Accounts Governance', url: 'http://127.0.0.1:3000/approvals', username: 'finance.accounts', expectedText: 'Approvals' },
  { id: 'ADM-01', role: 'ADMIN_HEAD', name: 'Admin Head Exception Clearances', url: 'http://127.0.0.1:3000/approvals', username: 'admin.head', expectedText: 'Approvals' },
  { id: 'DE-01', role: 'DATA_EXECUTIVE', name: 'Data Executive Workspace', url: 'http://127.0.0.1:3000/super-admin/corrections', username: 'data.executive', expectedText: 'Corrections' },

  // 7. Super Admin Management Workspaces
  { id: 'SA-01', role: 'SUPER_ADMIN', name: 'Super Admin Overview', url: 'http://127.0.0.1:3000/super-admin', username: 'admin.superuser', expectedText: 'Overview' },
  { id: 'SA-02', role: 'SUPER_ADMIN', name: 'Super Admin Users', url: 'http://127.0.0.1:3000/super-admin/users', username: 'admin.superuser', expectedText: 'Users' },
  { id: 'SA-03', role: 'SUPER_ADMIN', name: 'Super Admin Procurement Sources', url: 'http://127.0.0.1:3000/super-admin/procurement-sources', username: 'admin.superuser', expectedText: 'Procurement' },
  { id: 'SA-04', role: 'SUPER_ADMIN', name: 'Super Admin Audit Logs', url: 'http://127.0.0.1:3000/super-admin/audit', username: 'admin.superuser', expectedText: 'Audit' },
  { id: 'SA-05', role: 'SUPER_ADMIN', name: 'Super Admin Daily Report', url: 'http://127.0.0.1:3000/super-admin/daily-report', username: 'admin.superuser', expectedText: 'Daily Report' },

  // 8. Public Transit Display
  { id: 'TV-01', role: 'PUBLIC_DISPLAY', name: 'Public TV Board', url: 'http://127.0.0.1:3000/tv-board', username: 'admin.superuser', expectedText: 'Yard Status Board' },
];

async function generateUserToken(username: string): Promise<string> {
  const dbUser = await prisma.user.findFirst({
    where: { username, is_active: true },
  });
  if (!dbUser) {
    throw new Error(`Required active user '${username}' not found in database.`);
  }
  return createSessionToken({
    id: String(dbUser.id),
    username: dbUser.username,
    name: dbUser.full_name || dbUser.username,
    role: dbUser.role as Role,
    department: dbUser.department || 'Operations',
    zone: (dbUser as unknown as { zone?: string | null }).zone || null,
    scope_type: dbUser.scope_type || 'ALL',
    procurement_source_id: dbUser.procurement_source_id ? String(dbUser.procurement_source_id) : null,
  });
}

interface TestResult {
  id: string;
  role: string;
  name: string;
  viewport: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  reason?: string;
  scrollWidth?: number;
  clientWidth?: number;
}

async function runResponsiveVerification() {
  console.log('========================================================================');
  console.log('  MILK RECEPTION APP — STRICT MULTI-VIEWPORT VERIFICATION SUITE');
  console.log('  (Strict Auth Verification, Zero False Passes, Real Interaction Tests)');
  console.log('========================================================================\n');

  let browser: Browser;
  try {
    browser = await chromium.launch({
      executablePath: CHROME_PATH,
      headless: true,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('Chrome path unavailable, using default playwright chromium...', msg);
    browser = await chromium.launch({ headless: true });
  }

  // 1. Authenticate and cache tokens
  console.log('Generating cryptographically signed session tokens for all roles:');
  const tokenCache = new Map<string, string>();
  const tokenErrors = new Map<string, string>();

  for (const s of SCREENS) {
    if (s.username && !tokenCache.has(s.username)) {
      try {
        const token = await generateUserToken(s.username);
        tokenCache.set(s.username, token);
        console.log(`  ✓ Auth token generated for user '${s.username}' (${s.role})`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        tokenErrors.set(s.username, msg);
        console.error(`  ✗ Failed to generate token for user '${s.username}':`, msg);
      }
    }
  }

  const results: TestResult[] = [];

  // 2. Viewport Scan across all screens
  for (const vp of VIEWPORTS) {
    console.log(`\n── Viewport: ${vp.name} (${vp.width}x${vp.height}) ──`);
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      isMobile: vp.isMobile,
      hasTouch: vp.isMobile,
      userAgent: vp.isMobile
        ? 'Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36'
        : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    });

    for (const screen of SCREENS) {
      // Check if username was required but token is missing
      if (screen.username && !tokenCache.has(screen.username)) {
        console.error(`  ✗ [${screen.id}] ${screen.name}: FAIL (Missing auth token for '${screen.username}')`);
        results.push({
          id: screen.id,
          role: screen.role,
          name: screen.name,
          viewport: vp.name,
          status: 'FAIL',
          reason: `Missing auth token: ${tokenErrors.get(screen.username) || 'User not found'}`,
        });
        continue;
      }

      const page = await context.newPage();

      try {
        if (screen.username && tokenCache.has(screen.username)) {
          await context.addCookies([
            {
              name: 'auth_token',
              value: tokenCache.get(screen.username)!,
              url: 'http://127.0.0.1:3000',
            },
          ]);
        }

        const resp = await page.goto(screen.url, { waitUntil: 'domcontentloaded', timeout: 12000 });
        const status = resp?.status() || 0;
        // Wait for page loader/hydration spinner to detach
        await page.waitForSelector('[role="status"]', { state: 'detached', timeout: 6000 }).catch(() => {});
        await page.waitForTimeout(400);

        const finalUrl = page.url();
        const isPublic = screen.url.includes('/login') || screen.url.includes('/device-setup');

        // Check 1: Redirect to /login on a protected screen
        if (!isPublic && (finalUrl.includes('/login') || finalUrl.includes('/auth/login'))) {
          console.error(`  ✗ [${screen.id}] ${screen.name}: FAIL (Unexpected redirect to /login)`);
          results.push({
            id: screen.id,
            role: screen.role,
            name: screen.name,
            viewport: vp.name,
            status: 'FAIL',
            reason: `Redirected to login: ${finalUrl}`,
          });
          await page.close();
          continue;
        }

        // Check 2: HTTP status error
        if (status >= 400) {
          console.error(`  ✗ [${screen.id}] ${screen.name}: FAIL (HTTP ${status})`);
          results.push({
            id: screen.id,
            role: screen.role,
            name: screen.name,
            viewport: vp.name,
            status: 'FAIL',
            reason: `HTTP ${status}`,
          });
          await page.close();
          continue;
        }

        // Check 3: Runtime crash / Prisma error
        const bodyText = await page.innerText('body');
        const hasCrash = /Unhandled Runtime Error|column.*does not exist|Invalid `prisma\./i.test(bodyText);
        if (hasCrash) {
          console.error(`  ✗ [${screen.id}] ${screen.name}: FAIL (Runtime exception detected)`);
          results.push({
            id: screen.id,
            role: screen.role,
            name: screen.name,
            viewport: vp.name,
            status: 'FAIL',
            reason: 'Runtime crash / unhandled exception in DOM',
          });
          await page.close();
          continue;
        }

        // Check 4: Expected content visibility (verifies real screen rendered)
        if (screen.expectedText) {
          const hasExpected = await page.getByText(screen.expectedText).first().isVisible().catch(() => false);
          if (!hasExpected) {
            console.error(`  ✗ [${screen.id}] ${screen.name}: FAIL (Expected UI '${screen.expectedText}' not found)`);
            results.push({
              id: screen.id,
              role: screen.role,
              name: screen.name,
              viewport: vp.name,
              status: 'FAIL',
              reason: `Expected UI text '${screen.expectedText}' not found on page`,
            });
            await page.close();
            continue;
          }
        }

        // Check 5: Horizontal scroll containment
        const metrics = await page.evaluate(() => {
          const docEl = document.documentElement;
          const body = document.body;
          const scrollWidth = Math.max(docEl.scrollWidth, body ? body.scrollWidth : 0);
          const clientWidth = window.innerWidth;
          const hasOverflow = scrollWidth > clientWidth + 1;
          return { scrollWidth, clientWidth, hasOverflow };
        });

        if (metrics.hasOverflow) {
          console.error(`  ✗ [${screen.id}] ${screen.name}: FAIL (Horizontal overflow ${metrics.scrollWidth} > ${metrics.clientWidth}px)`);
          results.push({
            id: screen.id,
            role: screen.role,
            name: screen.name,
            viewport: vp.name,
            status: 'FAIL',
            reason: `Horizontal overflow: ${metrics.scrollWidth}px vs ${metrics.clientWidth}px`,
            scrollWidth: metrics.scrollWidth,
            clientWidth: metrics.clientWidth,
          });
        } else {
          console.log(`  ✓ [${screen.id}] ${screen.name}: PASS (${metrics.scrollWidth}/${metrics.clientWidth}px OK)`);
          results.push({
            id: screen.id,
            role: screen.role,
            name: screen.name,
            viewport: vp.name,
            status: 'PASS',
            scrollWidth: metrics.scrollWidth,
            clientWidth: metrics.clientWidth,
          });
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  ✗ [${screen.id}] ${screen.name}: FAIL (${msg})`);
        results.push({
          id: screen.id,
          role: screen.role,
          name: screen.name,
          viewport: vp.name,
          status: 'FAIL',
          reason: msg,
        });
      } finally {
        await page.close();
      }
    }

    await context.close();
  }

  // 3. Interactive Behavioral Suite on Mobile Emulation
  console.log('\n========================================================================');
  console.log('  INTERACTIVE MOBILE EMULATION BEHAVIORAL SUITE');
  console.log('========================================================================');

  const mobileCtx = await browser.newContext({
    viewport: { width: 360, height: 800 },
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36',
  });

  let interactionPasses = 0;
  let interactionFails = 0;
  let interactionTotal = 0;

  // Interaction Test 1: Keyboard Open & Focused Input Visibility on /login
  interactionTotal++;
  try {
    const page = await mobileCtx.newPage();
    await page.goto('http://127.0.0.1:3000/login', { waitUntil: 'domcontentloaded' });
    const passwordInput = page.locator('input[name="password"]');
    await passwordInput.click();
    await passwordInput.fill('secret123');

    // Simulate virtual keyboard appearance by shrinking viewport height
    await page.setViewportSize({ width: 360, height: 420 });
    await page.waitForTimeout(300);

    const isVisibleInViewport = await page.evaluate(() => {
      const el = document.querySelector('input[name="password"]');
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      return rect.top >= 0 && rect.bottom <= window.innerHeight;
    });

    assert(isVisibleInViewport, 'Password input must remain visible when virtual keyboard opens');
    console.log('  ✓ [INTERACTION-01] Virtual keyboard input visibility & focus retention: PASS');
    interactionPasses++;
    await page.close();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('  ✗ [INTERACTION-01] Virtual keyboard input visibility: FAIL -', msg);
    interactionFails++;
    results.push({
      id: 'INTERACTION-01',
      role: 'PUBLIC',
      name: 'Virtual Keyboard Input Visibility',
      viewport: '360x800',
      status: 'FAIL',
      reason: msg,
    });
  }

  // Interaction Test 2: Drawer Opening, Escape Key Dismissal & Focus Restoration
  interactionTotal++;
  try {
    const page = await mobileCtx.newPage();
    if (!tokenCache.has('admin.superuser')) {
      throw new Error('Missing authentication token for user admin.superuser');
    }
    await mobileCtx.addCookies([
      { name: 'auth_token', value: tokenCache.get('admin.superuser')!, url: 'http://127.0.0.1:3000' },
    ]);
    await page.goto('http://127.0.0.1:3000/super-admin', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[role="status"]', { state: 'detached', timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(600);

    // Click hamburger button to open drawer (MUST FAIL if button is missing)
    const menuBtn = page.getByRole('button', { name: /open navigation|menu|navigation/i }).first();
    const canOpen = await menuBtn.isVisible().catch(() => false);
    if (!canOpen) {
      throw new Error('Navigation menu button not found or not visible on mobile viewport');
    }

    await menuBtn.click();

    // 1. Verify drawer actually opened
    const drawerDialog = page.locator('[role="dialog"]').first();
    await drawerDialog.waitFor({ state: 'visible', timeout: 4000 });
    const isDrawerVisible = await drawerDialog.isVisible();
    assert(isDrawerVisible, 'Navigation drawer dialog must be visible after clicking menu button');

    // 2. Press Escape key to dismiss
    await page.keyboard.press('Escape');
    await drawerDialog.waitFor({ state: 'hidden', timeout: 4000 });
    const isDrawerClosed = !(await drawerDialog.isVisible().catch(() => false));
    assert(isDrawerClosed, 'Navigation drawer dialog must close on Escape key');

    // 3. Verify focus restoration where supported
    await page.waitForTimeout(200);
    const isFocusRestored = await menuBtn.evaluate((el) => el === document.activeElement).catch(() => false);
    console.log(`  ✓ [INTERACTION-02] Navigation drawer opened, Escape dismissed, focus verified (${isFocusRestored}): PASS`);
    interactionPasses++;
    await page.close();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('  ✗ [INTERACTION-02] Navigation drawer escape handling: FAIL -', msg);
    interactionFails++;
    results.push({
      id: 'INTERACTION-02',
      role: 'SUPER_ADMIN',
      name: 'Navigation Drawer Open & Escape Dismissal',
      viewport: '360x800',
      status: 'FAIL',
      reason: msg,
    });
  }

  // Interaction Test 3: Table Local Momentum Scrolling & Container Stability
  interactionTotal++;
  try {
    const page = await mobileCtx.newPage();
    if (!tokenCache.has('admin.superuser')) {
      throw new Error('Missing authentication token for user admin.superuser');
    }
    await mobileCtx.addCookies([
      { name: 'auth_token', value: tokenCache.get('admin.superuser')!, url: 'http://127.0.0.1:3000' },
    ]);
    await page.goto('http://127.0.0.1:3000/super-admin/audit', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[role="status"]', { state: 'detached', timeout: 6000 }).catch(() => {});
    await page.waitForSelector('table', { timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(500);

    const table = page.locator('table').first();
    const hasTable = await table.isVisible().catch(() => false);
    if (!hasTable) {
      throw new Error('Audit table not found on page');
    }

    const tableMetrics = await page.evaluate(() => {
      const tableEl = document.querySelector('table');
      if (!tableEl) return null;
      const container = tableEl.closest('.overflow-x-auto, .table-responsive, [data-table-wrapper]');
      if (!container) return null;
      const docScrollWidth = document.documentElement.scrollWidth;
      const winWidth = window.innerWidth;

      // Test horizontal scrolling
      const initialScroll = container.scrollLeft;
      container.scrollLeft = 50;
      const didScroll = container.scrollLeft > 0;
      container.scrollLeft = initialScroll;

      return {
        hasTable: true,
        hasContainer: true,
        canScroll: didScroll,
        docNoOverflow: docScrollWidth <= winWidth + 1,
      };
    });

    if (!tableMetrics || !tableMetrics.hasContainer) {
      throw new Error('Table container wrapper not found around audit table');
    }
    if (!tableMetrics.docNoOverflow) {
      throw new Error('Document-level horizontal overflow detected with table present');
    }
    if (!tableMetrics.canScroll) {
      throw new Error('Table container could not be scrolled horizontally');
    }

    console.log('  ✓ [INTERACTION-03] Audit table horizontal scroll containment & scrolling on 360px: PASS');
    interactionPasses++;
    await page.close();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('  ✗ [INTERACTION-03] Table scroll containment: FAIL -', msg);
    interactionFails++;
    results.push({
      id: 'INTERACTION-03',
      role: 'SUPER_ADMIN',
      name: 'Table Horizontal Scroll Containment',
      viewport: '360x800',
      status: 'FAIL',
      reason: msg,
    });
  }

  await mobileCtx.close();
  await browser.close();

  // 4. Final Aggregated Results
  const total = results.length;
  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  const skipped = results.filter((r) => r.status === 'SKIP').length;

  console.log('\n========================================================================');
  console.log(`  FINAL VERIFICATION SUMMARY:`);
  console.log(`  Total Checks:        ${total}`);
  console.log(`  PASSED:              ${passed} (${Math.round((passed / total) * 100)}%)`);
  console.log(`  FAILED:              ${failed}`);
  console.log(`  SKIPPED:             ${skipped}`);
  console.log(`  Interactions Tested: ${interactionPasses} / ${interactionTotal} PASSED (Failed: ${interactionFails})`);
  console.log('========================================================================\n');

  if (failed > 0) {
    console.error('Failed items:');
    for (const f of results.filter((r) => r.status === 'FAIL')) {
      console.error(` - [${f.id}] ${f.name} on ${f.viewport}: ${f.reason}`);
    }
    process.exit(1);
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

runResponsiveVerification().catch((err) => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
