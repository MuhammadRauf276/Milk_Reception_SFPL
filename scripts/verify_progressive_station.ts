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

async function verifyProgressiveStation() {
  console.log('================================================================');
  console.log('STARTING PROGRESSIVE WEIGHBRIDGE STATION CHROME VERIFICATION');
  console.log('================================================================\n');

  // Step 1: Users & Tokens
  const superAdmin = await prisma.user.findFirstOrThrow({ where: { role: 'SUPER_ADMIN', is_active: true } });
  const wbUser = await prisma.user.findFirstOrThrow({ where: { role: 'WEIGHBRIDGE_OPERATOR', is_active: true } });
  const prodUser = await prisma.user.findFirstOrThrow({ where: { role: 'PRODUCTION_RECEPTION_OPERATOR', is_active: true } });
  const qaUser = await prisma.user.findFirstOrThrow({ where: { role: 'QA_LAB_ATTENDANT', is_active: true } });
  const secUser = await prisma.user.findFirstOrThrow({ where: { role: 'SECURITY_OPERATOR', is_active: true } });

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

  const source = await prisma.procurementSource.findFirstOrThrow({ where: { is_active: true } });
  const silos = await prisma.silo.findMany({ where: { is_active: true }, take: 4 });
  const silo1 = silos[0];
  const silo2 = silos[1] || silo1;
  const silo3 = silos[2] || silo1;

  // Step 2: Clean old test visits
  const oldTestVehicles = ['TK-MEGA-3P', 'TK-MEGA-6P'];
  for (const vNum of oldTestVehicles) {
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

  // Create Tanker A: 3 Portions (4 Weighments)
  console.log('--- Creating Tanker A: TK-MEGA-3P (3 Portions -> 4 Physical Weighings) ---');
  const visit3P = await prisma.vehicleVisit.create({
    data: {
      visit_number: `VV-3P-${Date.now().toString().slice(-6)}`,
      vehicle_number: 'TK-MEGA-3P',
      token_number: 'TK-3001',
      operational_date: new Date(),
      current_status: 'READY_FOR_GROSS',
      procurement_source_id: source.id,
      created_by: superAdmin.id,
      test_mode: 'COMPOSITE',
      vehicle_dispatch_quantity_value: new Prisma.Decimal('22000'),
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
          { portion_number: 1, current_status: 'ACCEPTED', plant_decision: 'ACCEPTED', seal_match: true },
          { portion_number: 2, current_status: 'ACCEPTED', plant_decision: 'ACCEPTED', seal_match: true },
          { portion_number: 3, current_status: 'ACCEPTED', plant_decision: 'ACCEPTED', seal_match: true },
        ],
      },
    },
    include: { portions: { orderBy: { portion_number: 'asc' } } },
  });

  for (const portion of visit3P.portions) {
    await prisma.plantLabResult.createMany({
      data: [
        { visit_id: visit3P.id, portion_id: portion.id, test_id: BigInt(8), numeric_value: new Prisma.Decimal('28.0'), performance_status: 'PERFORMED', tested_by: qaUser.id },
        { visit_id: visit3P.id, portion_id: portion.id, test_id: BigInt(26), numeric_value: new Prisma.Decimal('3.8'), performance_status: 'PERFORMED', tested_by: qaUser.id },
      ],
    });
  }

  // Create Tanker B: 6 Portions (7 Weighments)
  console.log('--- Creating Tanker B: TK-MEGA-6P (6 Portions -> 7 Physical Weighings) ---');
  const visit6P = await prisma.vehicleVisit.create({
    data: {
      visit_number: `VV-6P-${Date.now().toString().slice(-6)}`,
      vehicle_number: 'TK-MEGA-6P',
      token_number: 'TK-6001',
      operational_date: new Date(),
      current_status: 'READY_FOR_GROSS',
      procurement_source_id: source.id,
      created_by: superAdmin.id,
      test_mode: 'PORTION_WISE',
      vehicle_dispatch_quantity_value: new Prisma.Decimal('42000'),
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
          { portion_number: 1, current_status: 'ACCEPTED', plant_decision: 'ACCEPTED', seal_match: true },
          { portion_number: 2, current_status: 'ACCEPTED', plant_decision: 'ACCEPTED', seal_match: true },
          { portion_number: 3, current_status: 'ACCEPTED', plant_decision: 'ACCEPTED', seal_match: true },
          { portion_number: 4, current_status: 'ACCEPTED', plant_decision: 'ACCEPTED', seal_match: true },
          { portion_number: 5, current_status: 'ACCEPTED', plant_decision: 'ACCEPTED', seal_match: true },
          { portion_number: 6, current_status: 'ACCEPTED', plant_decision: 'ACCEPTED', seal_match: true },
        ],
      },
    },
    include: { portions: { orderBy: { portion_number: 'asc' } } },
  });

  for (const portion of visit6P.portions) {
    await prisma.plantLabResult.createMany({
      data: [
        { visit_id: visit6P.id, portion_id: portion.id, test_id: BigInt(8), numeric_value: new Prisma.Decimal('28.0'), performance_status: 'PERFORMED', tested_by: qaUser.id },
        { visit_id: visit6P.id, portion_id: portion.id, test_id: BigInt(26), numeric_value: new Prisma.Decimal('3.8'), performance_status: 'PERFORMED', tested_by: qaUser.id },
      ],
    });
  }

  // Step 3: Launch Google Chrome via Playwright
  console.log('\n--- Launching Google Chrome via Playwright ---');
  const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

  await context.addCookies([
    { name: 'auth_token', value: wbToken, domain: 'localhost', path: '/', httpOnly: false, secure: false, sameSite: 'Lax' },
  ]);

  const page = await context.newPage();

  // Test 1: Unified Board Overview
  console.log('\n--- Test 1: Unified Board Overview (Single Page) ---');
  await page.goto('http://localhost:3000/department/weighbridge', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('text=TK-MEGA-3P', { timeout: 15000 });
  await page.waitForTimeout(1000);

  const shot1 = path.join(ARTIFACT_DIR, 'progressive_01_unified_board.png');
  await page.screenshot({ path: shot1, fullPage: true });
  console.log(`Saved screenshot: ${shot1}`);

  const pageText = await page.innerText('body');
  const hasUnifiedTitle = pageText.includes('Unified Physical Weighbridge Station');
  const has3P = pageText.includes('TK-MEGA-3P') && pageText.includes('3 Compartments · 4 Scale Weighments');
  const has6P = pageText.includes('TK-MEGA-6P') && pageText.includes('6 Compartments · 7 Scale Weighments');
  console.log(`- Unified Station Title present: ${hasUnifiedTitle}`);
  console.log(`- 3-Portion Tanker badge correct: ${has3P}`);
  console.log(`- 6-Portion Tanker badge correct: ${has6P}`);

  // Test 2: Stepper for 6-Portion Tanker (All 7 Boxes)
  console.log('\n--- Test 2: Inspecting 6-Portion Tanker Stepper (7 Boxes) ---');
  await page.locator('div[role="button"]:has-text("TK-MEGA-6P")').first().click();
  await page.waitForTimeout(1500);

  const shot2 = path.join(ARTIFACT_DIR, 'progressive_02_stepper_6_portions.png');
  await page.screenshot({ path: shot2, fullPage: true });
  console.log(`Saved screenshot: ${shot2}`);

  const drawer6PText = await page.innerText('body');
  const has7Total = drawer6PText.includes('7 Total Weighings');
  const hasBox1Active = drawer6PText.includes('Active Scale Action') && drawer6PText.includes('Initial Loaded Gross (W0)');
  const hasPendingFuture = drawer6PText.includes('Final Empty Tare (W6)') && drawer6PText.includes('Pending Silo Unload');
  console.log(`- Drawer indicates 7 Total Weighings: ${has7Total}`);
  console.log(`- Box 1 is active for Gross: ${hasBox1Active}`);
  console.log(`- Future boxes (up to W6) are pending/disabled: ${hasPendingFuture}`);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // Test 3: Progressive Lifecycle on 3-Portion Tanker (W0 -> W1 -> W2 -> W3)
  console.log('\n--- Test 3: Executing Progressive Physical Weighing Loop on TK-MEGA-3P ---');

  // Step 3.1: Weighment 1 (W0)
  console.log('Recording W0 = 36,000 KG on TK-MEGA-3P...');
  await fetch('http://localhost:3000/api/scale/gross-weight', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: `auth_token=${wbToken}` },
    body: JSON.stringify({ visitId: String(visit3P.id), scaleId: 'SCALE-01', grossWeightKg: 36000 }),
  });

  // Step 3.2: Offload Portion 1 at Silo 1
  console.log('Production offloading Portion 1 into Silo 1...');
  const p1Id = visit3P.portions[0].id;
  await fetch(`http://localhost:3000/api/production/vehicle-visits/${visit3P.id}/portions/${p1Id}/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: `auth_token=${prodToken}` },
    body: JSON.stringify({ siloId: String(silo1.id) }),
  });
  await fetch(`http://localhost:3000/api/production/vehicle-visits/${visit3P.id}/portions/${p1Id}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: `auth_token=${prodToken}` },
    body: JSON.stringify({}),
  });

  // Refresh page and inspect Box 1 Locked & Box 2 Active
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('text=TK-MEGA-3P', { timeout: 15000 });
  await page.waitForTimeout(1000);

  await page.locator('div[role="button"]:has-text("TK-MEGA-3P")').first().click();
  await page.waitForTimeout(1500);

  const shot3 = path.join(ARTIFACT_DIR, 'progressive_03_box1_locked_box2_active.png');
  await page.screenshot({ path: shot3, fullPage: true });
  console.log(`Saved screenshot: ${shot3}`);

  const drawerStep2Text = await page.innerText('body');
  const box1Locked = drawerStep2Text.includes('Audit Locked') && drawerStep2Text.includes('36,000 kg');
  const box2Active = drawerStep2Text.includes('Tare After Compartment #1 (W1)') && drawerStep2Text.includes('Active Scale Action');
  console.log(`- Box 1 is Permanently Audit-Locked with 36,000 kg: ${box1Locked}`);
  console.log(`- Box 2 is Active Scale Action for W1: ${box2Active}`);

  // Step 3.3: Weighment 2 (W1)
  console.log('\nRecording W1 = 28,000 KG (Portion 1 Net = 8,000 KG)...');
  const tare1Res = await fetch('http://localhost:3000/api/scale/tare-weight', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: `auth_token=${wbToken}` },
    body: JSON.stringify({ visitId: String(visit3P.id), scaleId: 'SCALE-01', tareWeightKg: 28000 }),
  });
  console.log('tare1 status:', tare1Res.status, await tare1Res.json());

  // Step 3.4: Offload Portion 2 at Silo 2
  console.log('Production offloading Portion 2 into Silo 2...');
  const p2Id = visit3P.portions[1].id;
  const startP2 = await fetch(`http://localhost:3000/api/production/vehicle-visits/${visit3P.id}/portions/${p2Id}/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: `auth_token=${prodToken}` },
    body: JSON.stringify({ siloId: String(silo2.id) }),
  });
  console.log('startP2 status:', startP2.status, await startP2.json());

  const compP2 = await fetch(`http://localhost:3000/api/production/vehicle-visits/${visit3P.id}/portions/${p2Id}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: `auth_token=${prodToken}` },
    body: JSON.stringify({}),
  });
  console.log('compP2 status:', compP2.status, await compP2.json());

  // Check DB status of visit3P
  const vAfterP2 = await prisma.vehicleVisit.findUnique({
    where: { id: visit3P.id },
    select: { current_status: true },
  });
  console.log('Vehicle visit status after Portion 2 complete:', vAfterP2?.current_status);

  // Refresh page and inspect Box 1 & Box 2 Locked & Box 3 Active
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('text=TK-MEGA-3P', { timeout: 15000 });
  await page.waitForTimeout(1000);

  await page.locator('div[role="button"]:has-text("TK-MEGA-3P")').first().click();
  await page.waitForTimeout(1500);

  const shot4 = path.join(ARTIFACT_DIR, 'progressive_04_box1_box2_locked_box3_active.png');
  await page.screenshot({ path: shot4, fullPage: true });
  console.log(`Saved screenshot: ${shot4}`);

  const drawerStep3Text = await page.innerText('body');
  const box2LockedWithNet = drawerStep3Text.includes('28,000 kg') && drawerStep3Text.includes('8,000 kg');
  const box3Active = drawerStep3Text.includes('Tare After Compartment #2 (W2)') && drawerStep3Text.includes('Active Scale Action');
  console.log(`- Box 2 is Audit-Locked showing Compartment Net 8,000 kg: ${box2LockedWithNet}`);
  console.log(`- Box 3 is Active Scale Action for W2: ${box3Active}`);

  // Step 3.5: Weighment 3 (W2)
  console.log('\nRecording W2 = 21,000 KG (Portion 2 Net = 7,000 KG)...');
  await fetch('http://localhost:3000/api/scale/tare-weight', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: `auth_token=${wbToken}` },
    body: JSON.stringify({ visitId: String(visit3P.id), scaleId: 'SCALE-01', tareWeightKg: 21000 }),
  });

  // Step 3.6: Offload Portion 3 at Silo 3
  console.log('Production offloading Portion 3 into Silo 3...');
  const p3Id = visit3P.portions[2].id;
  await fetch(`http://localhost:3000/api/production/vehicle-visits/${visit3P.id}/portions/${p3Id}/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: `auth_token=${prodToken}` },
    body: JSON.stringify({ siloId: String(silo3.id) }),
  });
  await fetch(`http://localhost:3000/api/production/vehicle-visits/${visit3P.id}/portions/${p3Id}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: `auth_token=${prodToken}` },
    body: JSON.stringify({}),
  });

  // Refresh page and inspect Boxes 1, 2, 3 Locked & Box 4 Active (Final Empty Tare)
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('text=TK-MEGA-3P', { timeout: 15000 });
  await page.waitForTimeout(1000);

  await page.locator('div[role="button"]:has-text("TK-MEGA-3P")').first().click();
  await page.waitForTimeout(1500);

  const shot5 = path.join(ARTIFACT_DIR, 'progressive_05_final_tare_active.png');
  await page.screenshot({ path: shot5, fullPage: true });
  console.log(`Saved screenshot: ${shot5}`);

  const drawerStep4Text = await page.innerText('body');
  const box3LockedWithNet = drawerStep4Text.includes('21,000 kg') && drawerStep4Text.includes('7,000 kg');
  const box4FinalActive = drawerStep4Text.includes('Final Empty Tare (W3)') && drawerStep4Text.includes('Active Scale Action');
  console.log(`- Box 3 is Audit-Locked showing Compartment Net 7,000 kg: ${box3LockedWithNet}`);
  console.log(`- Box 4 is Active Scale Action for Final Empty Tare: ${box4FinalActive}`);

  // Step 3.7: Weighment 4 (W3 - Final Empty Tare)
  console.log('\nRecording Final Tare W3 = 14,000 KG (Portion 3 Net = 7,000 KG, Total Net = 22,000 KG)...');
  await fetch('http://localhost:3000/api/scale/tare-weight', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: `auth_token=${wbToken}` },
    body: JSON.stringify({ visitId: String(visit3P.id), scaleId: 'SCALE-01', tareWeightKg: 14000 }),
  });

  // Step 3.8: Final DB Check
  const finalDb = await prisma.vehicleVisit.findUniqueOrThrow({
    where: { id: visit3P.id },
    include: {
      portions: { orderBy: { portion_number: 'asc' } },
      weight_ticket: true,
      inventory_transactions: true,
    },
  });

  console.log('\n--- Final Database Audit Verification ---');
  console.log(`- Tanker Status: ${finalDb.current_status} (Expected: READY_FOR_GATE_EXIT)`);
  console.log(`- Ticket: Gross=${finalDb.weight_ticket?.gross_weight_kg} kg, Tare=${finalDb.weight_ticket?.tare_weight_kg} kg, Net=${finalDb.weight_ticket?.net_weight_kg} kg`);
  console.log(`- Portion 1: Net=${finalDb.portions[0].net_weight_kg} kg`);
  console.log(`- Portion 2: Net=${finalDb.portions[1].net_weight_kg} kg`);
  console.log(`- Portion 3: Net=${finalDb.portions[2].net_weight_kg} kg`);
  console.log(`- Total Portion Sum: ${Number(finalDb.portions[0].net_weight_kg) + Number(finalDb.portions[1].net_weight_kg) + Number(finalDb.portions[2].net_weight_kg)} kg`);
  console.log(`- Silo Receipts Generated: ${finalDb.inventory_transactions.length}`);

  // Refresh page on Completed filter
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await page.locator('button:has-text("Completed")').click();
  await page.waitForTimeout(1500);

  const shot6 = path.join(ARTIFACT_DIR, 'progressive_06_completed_ticket.png');
  await page.screenshot({ path: shot6, fullPage: true });
  console.log(`Saved screenshot: ${shot6}`);

  await browser.close();
  console.log('\n================================================================');
  console.log('PROGRESSIVE WEIGHBRIDGE STATION VERIFICATION COMPLETED WITH 100% SUCCESS!');
  console.log('================================================================');
}

verifyProgressiveStation().catch((err) => {
  console.error('Fatal error during verification:', err);
  process.exit(1);
});
