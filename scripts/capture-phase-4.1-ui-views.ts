import 'dotenv/config';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import path from 'node:path';
import { prisma } from '../src/backend/core/db';
import { createSessionToken } from '../src/backend/core/auth';
import type { Role } from '../src/backend/core/types';

const CHROME_PATH = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
const BASE_URL = 'http://127.0.0.1:3000';
const OUTPUT_DIR = 'C:\\Users\\SC-RAUF\\.gemini\\antigravity\\brain\\63b7fe61-c17a-432c-afb1-98ff93923ce9\\screenshots';

async function generateToken(username: string): Promise<{ token: string; user: any }> {
  const dbUser = await prisma.user.findFirstOrThrow({
    where: { username, is_active: true },
  });
  const token = await createSessionToken({
    id: String(dbUser.id),
    username: dbUser.username,
    name: dbUser.full_name || dbUser.username,
    role: dbUser.role as Role,
    department: dbUser.department || 'Operations',
    zone: (dbUser as any).zone || null,
    scope_type: dbUser.scope_type || 'ALL',
    procurement_source_id: dbUser.procurement_source_id ? String(dbUser.procurement_source_id) : null,
  });
  return { token, user: dbUser };
}

async function createContextWithAuth(browser: Browser, token: string): Promise<BrowserContext> {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });

  await context.addCookies([
    {
      name: 'auth_token',
      value: token,
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
    {
      name: 'session_token',
      value: token,
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);

  return context;
}

async function main() {
  console.log('================================================================');
  console.log(' CAPTURING SCREEN UI VIEWS FOR PHASE 4.1 @13 TS LITERS');
  console.log('================================================================\n');

  let browser: Browser;
  try {
    browser = await chromium.launch({
      executablePath: CHROME_PATH,
      headless: true,
    });
    console.log('✓ Launched Google Chrome via Playwright CDP');
  } catch (err) {
    console.warn('Chrome executable not found at specified path, falling back to bundled chromium...', err);
    browser = await chromium.launch({ headless: true });
    console.log('✓ Launched Playwright Chromium');
  }

  try {
    // 1. ZMCC Manager context
    const zmccAuth = await generateToken('zmcc.manager.hasilpur');
    console.log(`✓ Generated token for ZMCC Manager: ${zmccAuth.user.username}`);
    const zmccContext = await createContextWithAuth(browser, zmccAuth.token);
    const zmccPage = await zmccContext.newPage();

    // 1.1 In-Transit tankers showing @13 TS Liters
    console.log('1. Capturing ZMCC Live In-Transit Tankers...');
    await zmccPage.goto(`${BASE_URL}/mpd/zmcc-manager?tab=PLANT_TRANSIT&view=IN_TRANSIT`, {
      waitUntil: 'domcontentloaded',
      timeout: 10000,
    }).catch(async () => {
      await zmccPage.waitForTimeout(3000);
    });
    await zmccPage.waitForTimeout(4000);
    const shot1Path = path.join(OUTPUT_DIR, '01-zmcc-live-in-transit-tankers.png');
    await zmccPage.screenshot({ path: shot1Path, fullPage: false });
    console.log(`   -> Saved: ${shot1Path}`);

    // 1.2 All Dispatches History table with Dispatch @13TS & Received @13TS columns
    console.log('2. Capturing ZMCC All Dispatches History Table...');
    await zmccPage.goto(`${BASE_URL}/mpd/zmcc-manager?tab=PLANT_TRANSIT&view=ALL_DISPATCHES`, {
      waitUntil: 'domcontentloaded',
      timeout: 10000,
    }).catch(async () => {
      await zmccPage.waitForTimeout(3000);
    });
    await zmccPage.waitForTimeout(4000);
    const shot2Path = path.join(OUTPUT_DIR, '02-zmcc-history-13ts-columns.png');
    await zmccPage.screenshot({ path: shot2Path, fullPage: false });
    console.log(`   -> Saved: ${shot2Path}`);

    // 1.3 Tank Storage Report with Stock @13% TS & Composite TS %
    console.log('3. Capturing ZMCC Tank Storage Report...');
    await zmccPage.goto(`${BASE_URL}/mpd/zmcc-manager?tab=REPORTS&view=TANK_STORAGE`, {
      waitUntil: 'domcontentloaded',
      timeout: 10000,
    }).catch(async () => {
      await zmccPage.waitForTimeout(3000);
    });
    await zmccPage.waitForTimeout(4000);
    const shot3Path = path.join(OUTPUT_DIR, '03-zmcc-tank-storage-13ts.png');
    await zmccPage.screenshot({ path: shot3Path, fullPage: false });
    console.log(`   -> Saved: ${shot3Path}`);

    // 1.4 ZMCC Manager Overview with Current tank stock (@13% TS)
    console.log('4. Capturing ZMCC Manager Overview...');
    await zmccPage.goto(`${BASE_URL}/mpd/zmcc-manager?tab=OVERVIEW`, {
      waitUntil: 'domcontentloaded',
      timeout: 10000,
    }).catch(async () => {
      await zmccPage.waitForTimeout(3000);
    });
    await zmccPage.waitForTimeout(4000);
    const shot4Path = path.join(OUTPUT_DIR, '04-zmcc-manager-overview-tank-stock.png');
    await zmccPage.screenshot({ path: shot4Path, fullPage: false });
    console.log(`   -> Saved: ${shot4Path}`);

    await zmccContext.close();

    // 2. Super Admin context - Silos Storage
    const adminAuth = await generateToken('admin.superuser');
    console.log(`✓ Generated token for Super Admin: ${adminAuth.user.username}`);
    const adminContext = await createContextWithAuth(browser, adminAuth.token);
    const adminPage = await adminContext.newPage();

    console.log('5. Capturing Plant Silo Storage Screen...');
    await adminPage.goto(`${BASE_URL}/super-admin/silos`, {
      waitUntil: 'domcontentloaded',
      timeout: 10000,
    }).catch(async () => {
      await adminPage.waitForTimeout(3000);
    });
    await adminPage.waitForTimeout(4000);
    const shot5Path = path.join(OUTPUT_DIR, '05-plant-silos-13ts-storage.png');
    await adminPage.screenshot({ path: shot5Path, fullPage: false });
    console.log(`   -> Saved: ${shot5Path}`);

    await adminContext.close();

    // 3. Production Head context - Production Unloading Workspace
    const prodHeadAuth = await generateToken('production.head');
    console.log(`✓ Generated token for Production Head: ${prodHeadAuth.user.username}`);
    const prodHeadContext = await createContextWithAuth(browser, prodHeadAuth.token);
    const prodHeadPage = await prodHeadContext.newPage();

    console.log('6. Capturing Production Unloading Workspace (Production Head)...');
    await prodHeadPage.goto(`${BASE_URL}/department/production`, {
      waitUntil: 'domcontentloaded',
      timeout: 10000,
    }).catch(async () => {
      await prodHeadPage.waitForTimeout(3000);
    });
    await prodHeadPage.waitForTimeout(4000);
    const shot6Path = path.join(OUTPUT_DIR, '06-plant-production-head-unloading.png');
    await prodHeadPage.screenshot({ path: shot6Path, fullPage: false });
    console.log(`   -> Saved: ${shot6Path}`);

    await prodHeadContext.close();

    // 4. Production Reception Operator context - Double Blind View
    const operatorAuth = await generateToken('production.operator');
    console.log(`✓ Generated token for Production Reception Operator: ${operatorAuth.user.username}`);
    const operatorContext = await createContextWithAuth(browser, operatorAuth.token);
    const operatorPage = await operatorContext.newPage();

    console.log('7. Capturing Production Operator Workspace (Double-Blind Isolation)...');
    await operatorPage.goto(`${BASE_URL}/department/production`, {
      waitUntil: 'domcontentloaded',
      timeout: 10000,
    }).catch(async () => {
      await operatorPage.waitForTimeout(3000);
    });
    await operatorPage.waitForTimeout(4000);
    const shot7Path = path.join(OUTPUT_DIR, '07-plant-operator-double-blind-unloading.png');
    await operatorPage.screenshot({ path: shot7Path, fullPage: false });
    console.log(`   -> Saved: ${shot7Path}`);

    await operatorContext.close();

    console.log('\n================================================================');
    console.log(' ALL 7 SCREEN VIEWS SUCCESSFULLY CAPTURED!');
    console.log('================================================================');
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('Fatal error during capture:', err);
  process.exit(1);
});
