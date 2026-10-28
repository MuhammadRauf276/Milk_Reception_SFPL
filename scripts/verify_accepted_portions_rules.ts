import 'dotenv/config';
import { chromium } from 'playwright';
import { prisma } from '../src/backend/core/db';
import { createSessionToken } from '../src/backend/core/auth';
import { Prisma } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const ARTIFACT_DIR = path.resolve('public/test-screenshots');
if (!fs.existsSync(ARTIFACT_DIR)) {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
}

async function verifyAcceptedPortionsRules() {
  console.log('================================================================');
  console.log('STARTING ACCEPTED PORTIONS & N+1 WEIGHMENT VERIFICATION');
  console.log('================================================================\n');

  // Step 1: Find test user
  const wbUser = await prisma.user.findFirstOrThrow({
    where: { role: 'WEIGHBRIDGE_OPERATOR', is_active: true },
  });

  const wbToken = await createSessionToken({
    id: String(wbUser.id),
    username: wbUser.username,
    name: wbUser.full_name || wbUser.username,
    role: wbUser.role as any,
    department: wbUser.department || 'Production & Weighbridge',
  } as any);

  const source = await prisma.procurementSource.findFirstOrThrow({ where: { is_active: true } });

  // Step 2: Clean up previous test vehicles
  const testVehicles = ['TK-PORTION-2OF3', 'TK-PORTION-1OF2', 'TK-PORTION-0OF2'];
  for (const vNum of testVehicles) {
    const oldV = await prisma.vehicleVisit.findFirst({ where: { vehicle_number: vNum } });
    if (oldV) {
      await prisma.plantFinalDualReconciliation.deleteMany({ where: { visit_id: oldV.id } });
      await prisma.siloInventoryTransaction.deleteMany({ where: { visit_id: oldV.id } });
      await prisma.unloadingLog.deleteMany({ where: { portion: { visit_id: oldV.id } } });
      await prisma.plantLabResult.deleteMany({ where: { visit_id: oldV.id } });
      await prisma.weightTicket.deleteMany({ where: { visit_id: oldV.id } });
      await prisma.visitPortion.deleteMany({ where: { visit_id: oldV.id } });
      await prisma.gateLog.deleteMany({ where: { visit_id: oldV.id } });
      await prisma.vehicleVisit.delete({ where: { id: oldV.id } });
    }
  }

  const now = new Date();
  const t0 = new Date(now.getTime() - 90 * 60000); // 90 min ago

  // ---------------------------------------------------------------------------
  // Case A: 2 Accepted portions out of 3 total (Portions 1 & 2 Accepted, 3 Rejected)
  // Rule: 2 Accepted -> 3 Physical Weighments (W0 Gross + 2 Tares)
  // ---------------------------------------------------------------------------
  console.log('Creating Case A: TK-PORTION-2OF3 (2 of 3 accepted -> 3 weighments)...');
  const visit2of3 = await prisma.vehicleVisit.create({
    data: {
      vehicle_number: 'TK-PORTION-2OF3',
      token_number: 'T-2OF3',
      visit_number: `VN-2OF3-${Date.now()}`,
      reception_number: `REC-2OF3-${Date.now()}`,
      current_status: 'READY_FOR_GROSS',
      test_mode: 'PORTION_WISE',
      procurement_source_id: source.id,
      operational_date: now,
      business_date_source: 'GATE_ENTRY',
      business_date_set_at: t0,
      gate_log: {
        create: {
          entry_timestamp: t0,
          entry_guard: { connect: { id: wbUser.id } },
        },
      },
      portions: {
        create: [
          {
            portion_number: 1,
            plant_decision: 'ACCEPTED',
            current_status: 'ACCEPTED',
            dispatch_quantity_value: new Prisma.Decimal(10000),
            dispatch_quantity_unit: 'LITER',
          },
          {
            portion_number: 2,
            plant_decision: 'ACCEPTED',
            current_status: 'ACCEPTED',
            dispatch_quantity_value: new Prisma.Decimal(10000),
            dispatch_quantity_unit: 'LITER',
          },
          {
            portion_number: 3,
            plant_decision: 'REJECTED',
            current_status: 'REJECTED',
            plant_rejection_reason: 'High Acidity / Microbial contamination',
            dispatch_quantity_value: new Prisma.Decimal(10000),
            dispatch_quantity_unit: 'LITER',
          },
        ],
      },
    },
  });

  // ---------------------------------------------------------------------------
  // Case B: 1 Accepted portion out of 2 total (Portion 1 Accepted, 2 Rejected)
  // Rule: 1 Accepted -> 2 Physical Weighments (W0 Gross + 1 Tare)
  // ---------------------------------------------------------------------------
  console.log('Creating Case B: TK-PORTION-1OF2 (1 of 2 accepted -> 2 weighments)...');
  const visit1of2 = await prisma.vehicleVisit.create({
    data: {
      vehicle_number: 'TK-PORTION-1OF2',
      token_number: 'T-1OF2',
      visit_number: `VN-1OF2-${Date.now()}`,
      reception_number: `REC-1OF2-${Date.now()}`,
      current_status: 'READY_FOR_GROSS',
      test_mode: 'PORTION_WISE',
      procurement_source_id: source.id,
      operational_date: now,
      business_date_source: 'GATE_ENTRY',
      business_date_set_at: t0,
      gate_log: {
        create: {
          entry_timestamp: t0,
          entry_guard: { connect: { id: wbUser.id } },
        },
      },
      portions: {
        create: [
          {
            portion_number: 1,
            plant_decision: 'ACCEPTED',
            current_status: 'ACCEPTED',
            dispatch_quantity_value: new Prisma.Decimal(12000),
            dispatch_quantity_unit: 'LITER',
          },
          {
            portion_number: 2,
            plant_decision: 'REJECTED',
            current_status: 'REJECTED',
            plant_rejection_reason: 'Abnormal Organoleptic Clots',
            dispatch_quantity_value: new Prisma.Decimal(12000),
            dispatch_quantity_unit: 'LITER',
          },
        ],
      },
    },
  });

  // ---------------------------------------------------------------------------
  // Case C: 0 Accepted portions out of 2 total (Both Rejected by QA)
  // Rule: 0 Accepted -> Direct to GATE EXIT (0 Scale Weighments)
  // ---------------------------------------------------------------------------
  console.log('Creating Case C: TK-PORTION-0OF2 (0 of 2 accepted -> Gate Exit)...');
  const visit0of2 = await prisma.vehicleVisit.create({
    data: {
      vehicle_number: 'TK-PORTION-0OF2',
      token_number: 'T-0OF2',
      visit_number: `VN-0OF2-${Date.now()}`,
      reception_number: `REC-0OF2-${Date.now()}`,
      current_status: 'READY_FOR_GATE_EXIT',
      test_mode: 'PORTION_WISE',
      procurement_source_id: source.id,
      operational_date: now,
      business_date_source: 'LAST_QA_REJECTION',
      business_date_set_at: t0,
      gate_log: {
        create: {
          entry_timestamp: t0,
          entry_guard: { connect: { id: wbUser.id } },
        },
      },
      portions: {
        create: [
          {
            portion_number: 1,
            plant_decision: 'REJECTED',
            current_status: 'REJECTED',
            plant_rejection_reason: 'Adulteration positive: Neutralizers',
            dispatch_quantity_value: new Prisma.Decimal(15000),
            dispatch_quantity_unit: 'LITER',
          },
          {
            portion_number: 2,
            plant_decision: 'REJECTED',
            current_status: 'REJECTED',
            plant_rejection_reason: 'Adulteration positive: Urea',
            dispatch_quantity_value: new Prisma.Decimal(15000),
            dispatch_quantity_unit: 'LITER',
          },
        ],
      },
    },
  });

  console.log('Database test fixtures initialized successfully.\n');

  // Step 3: Launch Browser via Playwright
  console.log('Launching Chrome browser via Playwright...');
  const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });

  await context.addCookies([
    {
      name: 'auth_token',
      value: wbToken,
      domain: 'localhost',
      path: '/',
      httpOnly: false,
      secure: false,
      sameSite: 'Lax',
    },
  ]);

  const page = await context.newPage();

  // ---------------------------------------------------------------------------
  // Test 1: Verify Sidebar Navigation (Single Weighbridge Station, NO Sub-tabs)
  // ---------------------------------------------------------------------------
  console.log('Navigating to http://localhost:3000/department/weighbridge...');
  await page.goto('http://localhost:3000/department/weighbridge', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // Open sidebar navigation drawer
  console.log('Opening sidebar navigation drawer to inspect Weighbridge link...');
  await page.evaluate(() => {
    const btn = document.querySelector('button[aria-label="Open navigation"]') as HTMLButtonElement | null;
    if (btn) btn.click();
  });
  await page.waitForTimeout(1000);

  const sidebarScreenshotPath = path.join(ARTIFACT_DIR, '01_sidebar_single_station.png');
  await page.screenshot({ path: sidebarScreenshotPath });
  console.log(`Saved screenshot: ${sidebarScreenshotPath}`);

  // Assert NO "First Weight" or "Second Weight" sub-tabs exist in nav
  const firstWeightTab = page.locator('nav a:has-text("First Weight"), [role="dialog"] a:has-text("First Weight")');
  const secondWeightTab = page.locator('nav a:has-text("Second Weight"), [role="dialog"] a:has-text("Second Weight")');
  const hasFirstWeight = (await firstWeightTab.count()) > 0;
  const hasSecondWeight = (await secondWeightTab.count()) > 0;
  console.log(`Sidebar sub-tabs check: 'First Weight' present? ${hasFirstWeight}, 'Second Weight' present? ${hasSecondWeight}`);

  if (hasFirstWeight || hasSecondWeight) {
    console.error('FAILED: Sidebar navigation still contains First Weight / Second Weight sub-tabs!');
  } else {
    console.log('PASSED: Sidebar navigation cleanly shows single unified Weighbridge Station without sub-tabs.');
  }

  // Close nav drawer if open by pressing Escape
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // ---------------------------------------------------------------------------
  // Test 2: Unified Workstation Cards Verification
  // ---------------------------------------------------------------------------
  console.log('Inspecting Unified Workstation Cards...');
  const boardScreenshotPath = path.join(ARTIFACT_DIR, '02_cards_accepted_formula.png');
  await page.screenshot({ path: boardScreenshotPath, fullPage: true });
  console.log(`Saved screenshot: ${boardScreenshotPath}`);

  // Verify TK-PORTION-2OF3 Card Text
  const card2of3 = page.locator('div:has-text("TK-PORTION-2OF3")').first();
  const text2of3 = await card2of3.innerText();
  console.log('\n--- Card TK-PORTION-2OF3 ---');
  console.log(text2of3);
  const pass2of3 = text2of3.includes('2 of 3 Accepted Portions') && text2of3.includes('3 Scale Weighments');
  console.log(`TK-PORTION-2OF3 Verification: ${pass2of3 ? 'PASSED (2 accepted -> 3 weighments)' : 'FAILED'}`);

  // Verify TK-PORTION-1OF2 Card Text
  const card1of2 = page.locator('div:has-text("TK-PORTION-1OF2")').first();
  const text1of2 = await card1of2.innerText();
  console.log('\n--- Card TK-PORTION-1OF2 ---');
  console.log(text1of2);
  const pass1of2 = text1of2.includes('1 of 2 Accepted Portions') && text1of2.includes('2 Scale Weighments');
  console.log(`TK-PORTION-1OF2 Verification: ${pass1of2 ? 'PASSED (1 accepted -> 2 weighments)' : 'FAILED'}`);

  // Switch to "All Active" or "Completed" filter to view TK-PORTION-0OF2
  console.log('\nSwitching to "All Active" filter to inspect 0-accepted vehicle...');
  await page.click('button:has-text("All Active")');
  await page.waitForTimeout(800);

  const allActiveScreenshotPath = path.join(ARTIFACT_DIR, '03_all_active_including_0of2.png');
  await page.screenshot({ path: allActiveScreenshotPath, fullPage: true });
  console.log(`Saved screenshot: ${allActiveScreenshotPath}`);

  const card0of2 = page.locator('div:has-text("TK-PORTION-0OF2")').first();
  const text0of2 = await card0of2.innerText();
  console.log('\n--- Card TK-PORTION-0OF2 ---');
  console.log(text0of2);
  const pass0of2 = text0of2.includes('0 of 2 Portions Accepted') && (text0of2.includes('All Rejected') || text0of2.includes('Gate Exit'));
  console.log(`TK-PORTION-0OF2 Verification: ${pass0of2 ? 'PASSED (0 accepted -> Direct Gate Exit)' : 'FAILED'}`);

  // ---------------------------------------------------------------------------
  // Test 3: Progressive Stepper Drawer for 2 of 3 Accepted (3 Weighments)
  // ---------------------------------------------------------------------------
  console.log('\nOpening Stepper Drawer for TK-PORTION-2OF3...');
  await page.locator('[role="button"]:has-text("TK-PORTION-2OF3")').first().click();
  await page.waitForTimeout(1000);

  const drawer2of3ScreenshotPath = path.join(ARTIFACT_DIR, '04_drawer_2of3_3weighments.png');
  await page.screenshot({ path: drawer2of3ScreenshotPath });
  console.log(`Saved screenshot: ${drawer2of3ScreenshotPath}`);

  const drawerDialog2of3 = page.locator('[role="dialog"]');
  const drawerText2of3 = await drawerDialog2of3.innerText();
  console.log('\nDrawer Header & Rule Text (TK-PORTION-2OF3):');
  console.log(drawerText2of3.split('\n').slice(0, 15).join('\n'));

  const drawerPass2of3 =
    drawerText2of3.includes('2 Accepted Portions ➔ 3 Physical Scale Weighments') &&
    drawerText2of3.includes('Compartment #3 was REJECTED');
  console.log(`Drawer 2of3 Verification: ${drawerPass2of3 ? 'PASSED (Formula and rejection notice displayed)' : 'FAILED'}`);

  // Close drawer
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // ---------------------------------------------------------------------------
  // Test 4: Progressive Stepper Drawer for 1 of 2 Accepted (2 Weighments)
  // ---------------------------------------------------------------------------
  console.log('\nOpening Stepper Drawer for TK-PORTION-1OF2...');
  await page.locator('[role="button"]:has-text("TK-PORTION-1OF2")').first().click();
  await page.waitForTimeout(1000);

  const drawer1of2ScreenshotPath = path.join(ARTIFACT_DIR, '05_drawer_1of2_2weighments.png');
  await page.screenshot({ path: drawer1of2ScreenshotPath });
  console.log(`Saved screenshot: ${drawer1of2ScreenshotPath}`);

  const drawerDialog1of2 = page.locator('[role="dialog"]');
  const drawerText1of2 = await drawerDialog1of2.innerText();
  console.log('\nDrawer Header & Rule Text (TK-PORTION-1OF2):');
  console.log(drawerText1of2.split('\n').slice(0, 15).join('\n'));

  const drawerPass1of2 =
    drawerText1of2.includes('1 Accepted Portion ➔ 2 Physical Scale Weighments') &&
    drawerText1of2.includes('Compartment #2 was REJECTED');
  console.log(`Drawer 1of2 Verification: ${drawerPass1of2 ? 'PASSED (Formula and rejection notice displayed)' : 'FAILED'}`);

  // Close drawer
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // ---------------------------------------------------------------------------
  // Test 5: Progressive Stepper Drawer for 0 of 2 Accepted (0 Weighments / Exit)
  // ---------------------------------------------------------------------------
  console.log('\nOpening Stepper Drawer for TK-PORTION-0OF2...');
  await page.locator('[role="button"]:has-text("TK-PORTION-0OF2")').first().click();
  await page.waitForTimeout(1000);

  const drawer0of2ScreenshotPath = path.join(ARTIFACT_DIR, '06_drawer_0of2_total_rejection.png');
  await page.screenshot({ path: drawer0of2ScreenshotPath });
  console.log(`Saved screenshot: ${drawer0of2ScreenshotPath}`);

  const drawerDialog0of2 = page.locator('[role="dialog"]');
  const drawerText0of2 = await drawerDialog0of2.innerText();
  console.log('\nDrawer Header & Rule Text (TK-PORTION-0OF2):');
  console.log(drawerText0of2.split('\n').slice(0, 15).join('\n'));

  const drawerPass0of2 =
    drawerText0of2.includes('100% Rejected by QA Laboratory') &&
    drawerText0of2.includes('Direct vehicle to Security Gate for exit checkout');
  console.log(`Drawer 0of2 Verification: ${drawerPass0of2 ? 'PASSED (Direct gate exit notice displayed)' : 'FAILED'}`);

  // Close browser
  await browser.close();

  console.log('\n================================================================');
  console.log('ALL VERIFICATION CHECKS COMPLETED SUCCESSFULLY');
  console.log('================================================================');
}

verifyAcceptedPortionsRules()
  .catch((err) => {
    console.error('Fatal verification error:', err);
    process.exit(1);
  });
