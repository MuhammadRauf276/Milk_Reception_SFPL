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
  { name: 'Android Small (360x800)', width: 360, height: 800, isMobile: true },
  { name: 'iPhone / Small (375x812)', width: 375, height: 812, isMobile: true },
  { name: 'Standard Mobile (390x844)', width: 390, height: 844, isMobile: true },
  { name: 'Android Large (412x915)', width: 412, height: 915, isMobile: true },
  { name: 'Tablet Portrait (768x1024)', width: 768, height: 1024, isMobile: false },
  { name: 'Desktop (1366x768)', width: 1366, height: 768, isMobile: false },
];

interface ScreenSpec {
  id: string;
  role: string;
  name: string;
  url: string;
  username: string;
}

const SCREENS: ScreenSpec[] = [
  // Public / Auth
  { id: 'AUTH-01', role: 'Public', name: 'Login Screen', url: 'http://127.0.0.1:3000/login', username: '' },
  { id: 'AUTH-02', role: 'Device', name: 'Phone Device Setup', url: 'http://127.0.0.1:3000/device-setup', username: '' },

  // Field / Stations
  { id: 'MOT-01', role: 'MOT / MDO', name: 'MDO Field Collection', url: 'http://127.0.0.1:3000/mot', username: 'mdo.hasilpur' },
  { id: 'PHE-01', role: 'PHE Operator', name: 'PHE Chiller Station', url: 'http://127.0.0.1:3000/phe', username: 'phe.operator' },
  { id: 'ZMCC-LAB', role: 'ZMCC Lab Attendant', name: 'ZMCC Reception Lab', url: 'http://127.0.0.1:3000/zmcc/lab', username: 'zmcc.operator' },

  // Plant Departments
  { id: 'SEC-01', role: 'Security Operator', name: 'Security Gate Operations', url: 'http://127.0.0.1:3000/department/security', username: 'security.gate' },
  { id: 'WB-01', role: 'Weighbridge Operator', name: 'Weighbridge Gross & Tare', url: 'http://127.0.0.1:3000/department/weighbridge', username: 'weighbridge.operator' },
  { id: 'QA-01', role: 'QA Lab Attendant', name: 'QA Reception Testing Lab', url: 'http://127.0.0.1:3000/department/qa', username: 'qa.reception@shakarganj.com.pk' },
  { id: 'QAH-01', role: 'QA Head', name: 'QA Head Management', url: 'http://127.0.0.1:3000/department/qa-head', username: 'qa.head@shakarganj.com.pk' },
  { id: 'PROD-01', role: 'Production Operator', name: 'Production Silos & Reception', url: 'http://127.0.0.1:3000/department/production', username: 'production.operator' },

  // Contractor
  { id: 'CONT-01', role: 'Contractor Operator', name: 'Contractor Dispatch Flow', url: 'http://127.0.0.1:3000/contractor/dispatch', username: 'contractor.operator.alkhair' },
  { id: 'CONT-02', role: 'Contractor Manager', name: 'Contractor Manager Portal', url: 'http://127.0.0.1:3000/contractor/manager', username: 'contractor.manager.alkhair' },

  // ZMCC Manager
  { id: 'ZMCC-01', role: 'ZMCC Manager', name: 'ZMCC Manager Overview', url: 'http://127.0.0.1:3000/mpd/zmcc-manager?tab=OVERVIEW', username: 'zmcc.manager.hasilpur' },
  { id: 'ZMCC-02', role: 'ZMCC Manager', name: 'ZMCC Manager Approvals Inbox', url: 'http://127.0.0.1:3000/mpd/zmcc-manager?tab=INBOX', username: 'zmcc.manager.hasilpur' },
  { id: 'ZMCC-03', role: 'ZMCC Manager', name: 'ZMCC Manager Hierarchy', url: 'http://127.0.0.1:3000/mpd/zmcc-manager?tab=HIERARCHY', username: 'zmcc.manager.hasilpur' },
  { id: 'ZMCC-04', role: 'ZMCC Manager', name: 'ZMCC Manager Fleet & Radar', url: 'http://127.0.0.1:3000/mpd/zmcc-manager?tab=FLEET', username: 'zmcc.manager.hasilpur' },
  { id: 'ZMCC-05', role: 'ZMCC Manager', name: 'ZMCC Manager Transit & Dispatches', url: 'http://127.0.0.1:3000/mpd/zmcc-manager?tab=TRANSIT', username: 'zmcc.manager.hasilpur' },

  // Management / Super Admin
  { id: 'SA-01', role: 'Super Admin', name: 'Super Admin Overview', url: 'http://127.0.0.1:3000/super-admin', username: 'admin.superuser' },
  { id: 'SA-02', role: 'Super Admin', name: 'Super Admin Users', url: 'http://127.0.0.1:3000/super-admin/users', username: 'admin.superuser' },
  { id: 'SA-03', role: 'Super Admin', name: 'Super Admin Procurement Sources', url: 'http://127.0.0.1:3000/super-admin/procurement-sources', username: 'admin.superuser' },
  { id: 'SA-04', role: 'Super Admin', name: 'Super Admin Audit Logs', url: 'http://127.0.0.1:3000/super-admin/audit', username: 'admin.superuser' },
  { id: 'SA-05', role: 'Super Admin', name: 'Super Admin Daily Report', url: 'http://127.0.0.1:3000/super-admin/daily-report', username: 'admin.superuser' },
  { id: 'APPR-01', role: 'Super Admin', name: 'Universal Approval Inbox', url: 'http://127.0.0.1:3000/approvals', username: 'admin.superuser' },
  { id: 'DE-01', role: 'Data Executive', name: 'Data Executive Dashboard', url: 'http://127.0.0.1:3000/data-executive', username: 'data.executive' },
  { id: 'TV-01', role: 'Public / Display', name: 'Public TV Board', url: 'http://127.0.0.1:3000/tv-board', username: 'admin.superuser' },
];

async function generateUserToken(username: string): Promise<string> {
  const dbUser = await prisma.user.findFirst({
    where: { username, is_active: true },
  });
  if (!dbUser) {
    throw new Error(`User '${username}' not found in database.`);
  }
  return createSessionToken({
    id: String(dbUser.id),
    username: dbUser.username,
    name: dbUser.full_name || dbUser.username,
    role: dbUser.role as Role,
    department: dbUser.department || 'Operations',
    zone: (dbUser as any).zone || null,
    scope_type: dbUser.scope_type || 'ALL',
    procurement_source_id: dbUser.procurement_source_id ? String(dbUser.procurement_source_id) : null,
  });
}

async function runResponsiveVerification() {
  console.log('========================================================================');
  console.log('  MILK RECEPTION APP — MOBILE RESPONSIVE MULTI-VIEWPORT VERIFICATION');
  console.log('========================================================================\n');

  let browser: Browser;
  try {
    browser = await chromium.launch({
      executablePath: CHROME_PATH,
      headless: true,
    });
  } catch (err: any) {
    console.error('Chromium launch failed with Chrome path, trying default playwright chromium...', err.message);
    browser = await chromium.launch({ headless: true });
  }

  // Pre-generate tokens
  const tokenCache = new Map<string, string>();
  for (const s of SCREENS) {
    if (s.username && !tokenCache.has(s.username)) {
      try {
        const t = await generateUserToken(s.username);
        tokenCache.set(s.username, t);
      } catch (err: any) {
        console.warn(`Could not generate token for ${s.username}:`, err.message);
      }
    }
  }

  let totalTests = 0;
  let passedTests = 0;
  let overflowIssues: Array<{ screen: string; viewport: string; scrollWidth: number; clientWidth: number; overflowingElements: string[] }> = [];

  for (const vp of VIEWPORTS) {
    console.log(`\n── Viewport: ${vp.name} (${vp.width}x${vp.height}) ──`);
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      isMobile: vp.isMobile,
      hasTouch: vp.isMobile,
    });

    for (const screen of SCREENS) {
      totalTests++;
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
        await page.waitForTimeout(500); // Wait 500ms for layout

        const bodyText = await page.innerText('body');
        const hasCrash = /Unhandled Runtime Error|column.*does not exist|Invalid `prisma\./i.test(bodyText);

        if (status >= 400 || hasCrash) {
          console.error(`  ✗ [${screen.id}] ${screen.name}: HTTP ${status} or Runtime Error`);
          await page.close();
          continue;
        }

        // Measure document width vs innerWidth
        const metrics = await page.evaluate(() => {
          const docEl = document.documentElement;
          const body = document.body;
          const scrollWidth = Math.max(docEl.scrollWidth, body ? body.scrollWidth : 0);
          const clientWidth = window.innerWidth;
          const hasOverflow = scrollWidth > clientWidth + 1; // 1px threshold for fractional subpixel rendering

          let overflowingElements: string[] = [];
          if (hasOverflow) {
            const all = document.querySelectorAll('*');
            for (let i = 0; i < all.length; i++) {
              const el = all[i];
              const rect = el.getBoundingClientRect();
              if (rect.right > clientWidth + 1) {
                const tag = el.tagName.toLowerCase();
                const cls = (el.className && typeof el.className === 'string') ? el.className.split(' ').slice(0, 3).join('.') : '';
                const id = el.id ? `#${el.id}` : '';
                overflowingElements.push(`${tag}${id}${cls ? '.' + cls : ''} (right: ${Math.round(rect.right)}px)`);
                if (overflowingElements.length >= 3) break;
              }
            }
          }

          return { scrollWidth, clientWidth, hasOverflow, overflowingElements };
        });

        if (metrics.hasOverflow) {
          console.warn(`  ⚠ [${screen.id}] ${screen.name}: OVERFLOW! scrollWidth=${metrics.scrollWidth} > clientWidth=${metrics.clientWidth}`);
          overflowIssues.push({
            screen: `[${screen.id}] ${screen.name}`,
            viewport: vp.name,
            scrollWidth: metrics.scrollWidth,
            clientWidth: metrics.clientWidth,
            overflowingElements: metrics.overflowingElements,
          });
        } else {
          passedTests++;
          console.log(`  ✓ [${screen.id}] ${screen.name}: ${metrics.scrollWidth}/${metrics.clientWidth}px OK`);
        }
      } catch (err: any) {
        console.error(`  ✗ [${screen.id}] ${screen.name} Error:`, err.message);
      } finally {
        await page.close();
      }
    }

    await context.close();
  }

  await browser.close();

  console.log('\n========================================================================');
  console.log(`  VERIFICATION RESULTS: ${passedTests} / ${totalTests} viewport checks PASSED (${Math.round((passedTests/totalTests)*100)}%)`);
  if (overflowIssues.length > 0) {
    console.log(`  Total Overflow Warnings: ${overflowIssues.length}`);
    for (const item of overflowIssues.slice(0, 15)) {
      console.log(`   - ${item.screen} on ${item.viewport}: ${item.scrollWidth}px vs ${item.clientWidth}px (${item.overflowingElements.join(', ')})`);
    }
  } else {
    console.log('  ALL SCREENS ARE 100% CONTAINED WITH ZERO HORIZONTAL OVERFLOW!');
  }
  console.log('========================================================================\n');
}

runResponsiveVerification().catch((err) => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
