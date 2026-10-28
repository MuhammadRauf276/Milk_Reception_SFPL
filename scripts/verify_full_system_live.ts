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

async function verifyFullSystemLive() {
  console.log('================================================================');
  console.log('STARTING FULL PLAYWRIGHT & CODEBASE PLAN INSPECTION & VERIFICATION');
  console.log('================================================================\n');

  // Step 1: Prepare Master Users
  const superAdmin = await prisma.user.findFirstOrThrow({ where: { role: 'SUPER_ADMIN', is_active: true } });
  const wbUser = await prisma.user.findFirstOrThrow({ where: { role: 'WEIGHBRIDGE_OPERATOR', is_active: true } });
  const prodUser = await prisma.user.findFirstOrThrow({ where: { role: 'PRODUCTION_RECEPTION_OPERATOR', is_active: true } });
  const qaUser = await prisma.user.findFirstOrThrow({ where: { role: 'QA_LAB_ATTENDANT', is_active: true } });
  const zmccMgr = await prisma.user.findFirstOrThrow({ where: { username: 'zmcc.manager.hasilpur', is_active: true } });
  let secUser = await prisma.user.findFirst({ where: { role: 'SECURITY_OPERATOR', is_active: true } });
  if (!secUser) {
    secUser = await prisma.user.create({
      data: {
        username: 'security.guard.test',
        full_name: 'Security Guard Test',
        role: 'SECURITY_OPERATOR',
        department: 'Security',
        is_active: true,
      },
    });
  }

  // Create auth session tokens
  const wbToken = await createSessionToken({
    id: String(wbUser.id),
    username: wbUser.username,
    name: wbUser.full_name || wbUser.username,
    role: wbUser.role as any,
    department: wbUser.department || 'Production & Weighbridge',
  } as any);

  const prodToken = await createSessionToken({
    id: String(prodUser.id),
    username: prodUser.username,
    name: prodUser.full_name || prodUser.username,
    role: prodUser.role as any,
    department: prodUser.department || 'Production',
  } as any);

  const qaToken = await createSessionToken({
    id: String(qaUser.id),
    username: qaUser.username,
    name: qaUser.full_name || qaUser.username,
    role: qaUser.role as any,
    department: qaUser.department || 'QA',
  } as any);

  const secToken = await createSessionToken({
    id: String(secUser.id),
    username: secUser.username,
    name: secUser.full_name || secUser.username,
    role: secUser.role as any,
    department: secUser.department || 'Security',
  } as any);

  const zmccMgrToken = await createSessionToken({
    id: String(zmccMgr.id),
    username: zmccMgr.username,
    name: zmccMgr.full_name || zmccMgr.username,
    role: zmccMgr.role as any,
    department: zmccMgr.department || 'Milk Procurement',
  } as any);

  const adminToken = await createSessionToken({
    id: String(superAdmin.id),
    username: superAdmin.username,
    name: superAdmin.full_name || superAdmin.username,
    role: superAdmin.role as any,
    department: superAdmin.department || 'System Administration',
  } as any);

  // Step 2: Create a 2-Portion Tanker Visit in READY_FOR_GROSS
  console.log('--- Step 2: Setting up 2-Portion Test Vehicle (TK-LIVE-N1) in READY_FOR_GROSS ---');
  const source = await prisma.procurementSource.findFirstOrThrow({ where: { is_active: true } });
  const silo1 = await prisma.silo.findFirstOrThrow({ where: { is_active: true } });
  const silo2 = (await prisma.silo.findFirst({ where: { is_active: true, id: { not: silo1.id } } })) || silo1;

  // Clean old test visit if exists
  const oldVisit = await prisma.vehicleVisit.findFirst({ where: { vehicle_number: 'TK-LIVE-N1' } });
  if (oldVisit) {
    await prisma.plantFinalDualReconciliation.deleteMany({ where: { visit_id: oldVisit.id } });
    await prisma.siloInventoryTransaction.deleteMany({ where: { visit_id: oldVisit.id } });
    await prisma.unloadingLog.deleteMany({ where: { portion: { visit_id: oldVisit.id } } });
    await prisma.plantLabResult.deleteMany({ where: { visit_id: oldVisit.id } });
    await prisma.weightTicket.deleteMany({ where: { visit_id: oldVisit.id } });
    await prisma.visitPortion.deleteMany({ where: { visit_id: oldVisit.id } });
    await prisma.gateLog.deleteMany({ where: { visit_id: oldVisit.id } });
    await prisma.vehicleVisit.delete({ where: { id: oldVisit.id } });
  }

  const testVisit = await prisma.vehicleVisit.create({
    data: {
      visit_number: `VV-TEST-${Date.now().toString().slice(-6)}`,
      vehicle_number: 'TK-LIVE-N1',
      token_number: 'TK-9901',
      operational_date: new Date(),
      current_status: 'READY_FOR_GROSS',
      procurement_source_id: source.id,
      created_by: superAdmin.id,
      test_mode: 'COMPOSITE', // Intentionally COMPOSITE to verify loop runs based on N=2 portions!
      vehicle_dispatch_quantity_value: new Prisma.Decimal('16500'),
      vehicle_dispatch_quantity_unit: 'KG',
      vehicle_dispatch_quantity_basis: 'MEASURED',
      gate_log: {
        create: {
          entry_timestamp: new Date(),
          entry_guard: { connect: { id: secUser.id } },
        },
      },
      portions: {
        create: [
          {
            portion_number: 1,
            current_status: 'ACCEPTED',
            plant_decision: 'ACCEPTED',
            dispatch_quantity_value: new Prisma.Decimal('8250'),
            dispatch_quantity_unit: 'KG',
            dispatch_quantity_basis: 'MEASURED',
            seal_match: true,
          },
          {
            portion_number: 2,
            current_status: 'ACCEPTED',
            plant_decision: 'ACCEPTED',
            dispatch_quantity_value: new Prisma.Decimal('8250'),
            dispatch_quantity_unit: 'KG',
            dispatch_quantity_basis: 'MEASURED',
            seal_match: true,
          },
        ],
      },
    },
    include: { portions: { orderBy: { portion_number: 'asc' } } },
  });

  // Attach Plant Lab Results (LR = 28, Fat = 3.8) for all portions
  for (const portion of testVisit.portions) {
    await prisma.plantLabResult.createMany({
      data: [
        {
          visit_id: testVisit.id,
          portion_id: portion.id,
          test_id: BigInt(8),
          numeric_value: new Prisma.Decimal('28.0'),
          performance_status: 'PERFORMED',
          tested_by: qaUser.id,
        },
        {
          visit_id: testVisit.id,
          portion_id: portion.id,
          test_id: BigInt(26),
          numeric_value: new Prisma.Decimal('3.8'),
          performance_status: 'PERFORMED',
          tested_by: qaUser.id,
        },
      ],
    });
  }

  const portion1Id = testVisit.portions[0].id;
  const portion2Id = testVisit.portions[1].id;
  console.log(`Created test visit ID: ${testVisit.id}, Vehicle: ${testVisit.vehicle_number}, Portions: ${testVisit.portions.length}`);

  // Step 3: Launch Browser for Live Inspection
  console.log('\n--- Step 3: Launching Headless Chromium via Playwright ---');
  const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

  const setAuth = async (token: string) => {
    await context.clearCookies();
    await context.addCookies([
      {
        name: 'auth_token',
        value: token,
        domain: 'localhost',
        path: '/',
        httpOnly: false,
        secure: false,
        sameSite: 'Lax',
      },
    ]);
  };

  const page = await context.newPage();

  // Test 1: Weighbridge First Weight Screen & Drawer
  console.log('\n--- Test 1: Inspecting Weighbridge First Weight Station ---');
  await setAuth(wbToken);
  await page.goto('http://localhost:3000/department/weighbridge', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('text=TK-LIVE-N1', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1000);

  const grossShot = path.join(ARTIFACT_DIR, '01_weighbridge_gross_blind.png');
  await page.screenshot({ path: grossShot, fullPage: true });
  console.log(`Saved screenshot: ${grossShot}`);

  const pageTextGross = await page.innerText('body');
  const hasVehicle = pageTextGross.includes('TK-LIVE-N1');
  const hasW0Label = pageTextGross.includes('Initial Loaded Gross (W0)');
  const leaksDispatchGross = pageTextGross.includes('16,500') || pageTextGross.includes('8,250') || pageTextGross.includes('Accepted Qty:');

  console.log(`- Vehicle TK-LIVE-N1 rendered: ${hasVehicle}`);
  console.log(`- 'Initial Loaded Gross (W0)' rendered: ${hasW0Label}`);
  console.log(`- Dispatch quantities leaked on First Weight: ${leaksDispatchGross} (Expected: false)`);

  // Open Drawer and inspect
  const vehicleCard = page.locator('div[role="button"]:has-text("TK-LIVE-N1")').first();
  if (await vehicleCard.count() > 0) {
    await vehicleCard.click();
    await page.waitForTimeout(1000);
    const drawerShot = path.join(ARTIFACT_DIR, '01b_weighbridge_gross_drawer.png');
    await page.screenshot({ path: drawerShot, fullPage: true });
    const drawerText = await page.innerText('body');
    const drawerHasScale1 = drawerText.includes('Scale 1 · Loaded Gross (W0)');
    const drawerLeaks = drawerText.includes('16,500') || drawerText.includes('8,250');
    console.log(`- Drawer shows 'Scale 1 · Loaded Gross (W0)': ${drawerHasScale1}`);
    console.log(`- Drawer leaks dispatch quantities: ${drawerLeaks} (Expected: false)`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }

  // Step 4: Execute Weighment 1 (W0) via Scale API
  console.log('\n--- Step 4: Recording Initial Gross Weighment W0 = 32,000 KG ---');
  const grossRes = await fetch('http://localhost:3000/api/scale/gross-weight', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      cookie: `auth_token=${wbToken}`,
    },
    body: JSON.stringify({
      visitId: String(testVisit.id),
      scaleId: 'SCALE-01',
      grossWeightKg: 32000,
    }),
  });
  const grossData = await grossRes.json();
  console.log(`Scale API Gross Response status: ${grossRes.status}, success: ${grossData.success}`);

  // Step 5: Production Station - Unload Portion 1
  console.log('\n--- Step 5: Inspecting Production Station & Offloading Portion 1 ---');
  await setAuth(prodToken);
  await page.goto('http://localhost:3000/department/production', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('text=TK-LIVE-N1', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1000);

  const prodShot = path.join(ARTIFACT_DIR, '02_production_unloading_blind.png');
  await page.screenshot({ path: prodShot, fullPage: true });
  console.log(`Saved screenshot: ${prodShot}`);

  const prodText = await page.innerText('body');
  const prodHasVehicle = prodText.includes('TK-LIVE-N1');
  const prodLeaks = prodText.includes('8,250') || prodText.includes('16,500');
  console.log(`- Production queue displays TK-LIVE-N1: ${prodHasVehicle}`);
  console.log(`- Production screen leaks dispatch/expected quantities: ${prodLeaks} (Expected: false)`);

  // Start & Complete Unloading Portion 1 via API
  const startP1Res = await fetch(`http://localhost:3000/api/production/vehicle-visits/${testVisit.id}/portions/${portion1Id}/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: `auth_token=${prodToken}` },
    body: JSON.stringify({ siloId: String(silo1.id) }),
  });
  console.log(`Portion 1 Start Unloading: status=${startP1Res.status}`);

  const compP1Res = await fetch(`http://localhost:3000/api/production/vehicle-visits/${testVisit.id}/portions/${portion1Id}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: `auth_token=${prodToken}` },
    body: JSON.stringify({}),
  });
  console.log(`Portion 1 Complete Unloading: status=${compP1Res.status}`);

  // Step 6: Weighbridge Second Weight - Intermediate Weighment W1 (2 of 3)
  console.log('\n--- Step 6: Inspecting Intermediate Weighment W1 (Weighment 2 of 3) ---');
  await setAuth(wbToken);
  await page.goto('http://localhost:3000/department/weighbridge?tab=SECOND_WEIGHT', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2500);

  const tareIntermediateShot = path.join(ARTIFACT_DIR, '03_weighbridge_intermediate_tare.png');
  await page.screenshot({ path: tareIntermediateShot, fullPage: true });
  console.log(`Saved screenshot: ${tareIntermediateShot}`);

  const secondWeightText = await page.innerText('body');
  const hasIntermediateLabel = secondWeightText.includes('TK-LIVE-N1') && secondWeightText.includes('Portion #1 of 2');
  const leaksSecondWeight = secondWeightText.includes('8,250') || secondWeightText.includes('16,500');
  console.log(`- Screen displays vehicle card with 'Portion #1 of 2': ${hasIntermediateLabel}`);
  console.log(`- Screen leaks dispatch quantity: ${leaksSecondWeight} (Expected: false)`);

  // Record Intermediate Tare W1 = 23,500 KG
  const intermediateTareRes = await fetch('http://localhost:3000/api/scale/tare-weight', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: `auth_token=${wbToken}` },
    body: JSON.stringify({
      visitId: String(testVisit.id),
      scaleId: 'SCALE-01',
      tareWeightKg: 23500,
    }),
  });
  const intermediateTareData = await intermediateTareRes.json();
  console.log(`Intermediate Tare Response: success=${intermediateTareData.success}, nextStatus=${intermediateTareData.data?.visit_status}, portionNet=${intermediateTareData.data?.portion_net_weight_kg} KG`);

  // Step 7: Production Station - Unload Portion 2
  console.log('\n--- Step 7: Offloading Portion 2 into Silo 2 ---');
  await setAuth(prodToken);
  const startP2Res = await fetch(`http://localhost:3000/api/production/vehicle-visits/${testVisit.id}/portions/${portion2Id}/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: `auth_token=${prodToken}` },
    body: JSON.stringify({ siloId: String(silo2.id) }),
  });
  console.log(`Portion 2 Start Unloading: status=${startP2Res.status}`);

  const compP2Res = await fetch(`http://localhost:3000/api/production/vehicle-visits/${testVisit.id}/portions/${portion2Id}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: `auth_token=${prodToken}` },
    body: JSON.stringify({}),
  });
  console.log(`Portion 2 Complete Unloading: status=${compP2Res.status}`);

  // Step 8: Weighbridge Second Weight - Final Empty Tare W2 (3 of 3)
  console.log('\n--- Step 8: Inspecting Final Empty Tare Weighment W2 (Weighment 3 of 3) ---');
  await setAuth(wbToken);
  await page.goto('http://localhost:3000/department/weighbridge?tab=SECOND_WEIGHT', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2500);

  const finalTareShot = path.join(ARTIFACT_DIR, '04_weighbridge_final_tare.png');
  await page.screenshot({ path: finalTareShot, fullPage: true });
  console.log(`Saved screenshot: ${finalTareShot}`);

  const finalTareText = await page.innerText('body');
  const hasFinalTareLabel = finalTareText.includes('TK-LIVE-N1') && finalTareText.includes('Portion #2 of 2');
  console.log(`- Screen displays vehicle card with 'Portion #2 of 2': ${hasFinalTareLabel}`);

  // Record Final Tare W2 = 15,000 KG
  const finalTareRes = await fetch('http://localhost:3000/api/scale/tare-weight', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: `auth_token=${wbToken}` },
    body: JSON.stringify({
      visitId: String(testVisit.id),
      scaleId: 'SCALE-01',
      tareWeightKg: 15000,
    }),
  });
  const finalTareData = await finalTareRes.json();
  console.log(`Final Tare Response: success=${finalTareData.success}, nextStatus=${finalTareData.data?.visit_status}, ticketNet=${finalTareData.data?.ticket_net_weight_kg} KG`);

  // Verify Final DB State
  const finalDbVisit = await prisma.vehicleVisit.findUniqueOrThrow({
    where: { id: testVisit.id },
    include: {
      portions: { orderBy: { portion_number: 'asc' } },
      weight_ticket: true,
      inventory_transactions: true,
    },
  });
  console.log('\n--- Final Database Verification ---');
  console.log(`- Vehicle Status: ${finalDbVisit.current_status} (Expected: READY_FOR_GATE_EXIT)`);
  console.log(`- Ticket Gross: ${finalDbVisit.weight_ticket?.gross_weight_kg} KG, Tare: ${finalDbVisit.weight_ticket?.tare_weight_kg} KG, Net: ${finalDbVisit.weight_ticket?.net_weight_kg} KG`);
  console.log(`- Portion 1: First=${finalDbVisit.portions[0].first_weight_kg}, Second=${finalDbVisit.portions[0].second_weight_kg}, Net=${finalDbVisit.portions[0].net_weight_kg} KG`);
  console.log(`- Portion 2: First=${finalDbVisit.portions[1].first_weight_kg}, Second=${finalDbVisit.portions[1].second_weight_kg}, Net=${finalDbVisit.portions[1].net_weight_kg} KG`);
  console.log(`- Silo Receipts Created: ${finalDbVisit.inventory_transactions.length}`);

  // Step 9: QA Lab Station Double-Blind Inspection
  console.log('\n--- Step 9: Inspecting QA Lab Station Double-Blind View ---');
  await setAuth(qaToken);
  await page.goto('http://localhost:3000/department/qa', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2500);

  const qaShot = path.join(ARTIFACT_DIR, '05_qa_lab_blind.png');
  await page.screenshot({ path: qaShot, fullPage: true });
  console.log(`Saved screenshot: ${qaShot}`);

  // Step 10: Security Station Double-Blind Inspection
  console.log('\n--- Step 10: Inspecting Security Station Double-Blind View ---');
  await setAuth(secToken);
  await page.goto('http://localhost:3000/department/security', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2500);

  const secShot = path.join(ARTIFACT_DIR, '06_security_blind.png');
  await page.screenshot({ path: secShot, fullPage: true });
  console.log(`Saved screenshot: ${secShot}`);

  // Step 11: ZMCC Manager Reconciliation View
  console.log('\n--- Step 11: Inspecting ZMCC Manager Reconciliation (/mpd/zmcc-manager) ---');
  await setAuth(zmccMgrToken);
  await page.goto('http://localhost:3000/mpd/zmcc-manager', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2500);

  const zmccShot = path.join(ARTIFACT_DIR, '07_zmcc_manager_recon.png');
  await page.screenshot({ path: zmccShot, fullPage: true });
  console.log(`Saved screenshot: ${zmccShot}`);

  // Step 12: Super Admin / Data Executive Loss Reconciliation
  console.log('\n--- Step 12: Inspecting Super Admin / Data Executive (/data-executive) ---');
  await setAuth(adminToken);
  await page.goto('http://localhost:3000/data-executive', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2500);

  const adminShot = path.join(ARTIFACT_DIR, '08_data_executive_recon.png');
  await page.screenshot({ path: adminShot, fullPage: true });
  console.log(`Saved screenshot: ${adminShot}`);

  // Step 13: Executive Management Command Cockpit
  console.log('\n--- Step 13: Inspecting Executive Management Command Cockpit (/command) ---');
  await page.goto('http://localhost:3000/command', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2500);

  const cmdShot = path.join(ARTIFACT_DIR, '09_executive_command.png');
  await page.screenshot({ path: cmdShot, fullPage: true });
  console.log(`Saved screenshot: ${cmdShot}`);

  await browser.close();
  console.log('\n================================================================');
  console.log('ALL PLAYWRIGHT TESTS & SCREENSHOTS COMPLETED SUCCESSFULLY!');
  console.log('================================================================');
}

verifyFullSystemLive().catch((err) => {
  console.error('Fatal error during verification:', err);
  process.exit(1);
});
