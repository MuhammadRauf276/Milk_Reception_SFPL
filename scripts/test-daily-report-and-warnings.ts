import 'dotenv/config';
import { getSuperAdminDailyReportData, generateDailyReportExcel, sendSuperAdminDailyReportEmail } from '../src/backend/services/superAdminDailyReportService';
import { notificationEventCatalog } from '../src/backend/modules/notifications/eventCatalog';
import ExcelJS from 'exceljs';

async function main() {
  console.log('--- Testing Daily Report & Warning Governance ---');

  // 1. Verify Event Catalog has the new warning events
  console.log('1. Checking notificationEventCatalog...');
  const motEv = notificationEventCatalog['MOT_SHOP_WARNING_LOGGED'];
  const zmccEv = notificationEventCatalog['ZMCC_LAB_WARNING_LOGGED'];
  const plantEv = notificationEventCatalog['PLANT_QA_WARNING_LOGGED'];

  if (!motEv || !motEv.recipients.includes('ZMCC_MANAGER') || !motEv.recipients.includes('HEAD_OF_MPD')) {
    throw new Error('MOT_SHOP_WARNING_LOGGED not correctly configured in eventCatalog');
  }
  if (!zmccEv || !zmccEv.recipients.includes('ZMCC_MANAGER') || !zmccEv.recipients.includes('HEAD_OF_MPD')) {
    throw new Error('ZMCC_LAB_WARNING_LOGGED not correctly configured in eventCatalog');
  }
  if (!plantEv || !plantEv.recipients.includes('QA_HEAD')) {
    throw new Error('PLANT_QA_WARNING_LOGGED not correctly configured in eventCatalog');
  }
  console.log('   ✓ Notification catalog verified:');
  console.log('     • MOT_SHOP_WARNING_LOGGED ->', motEv.recipients.join(', '));
  console.log('     • ZMCC_LAB_WARNING_LOGGED ->', zmccEv.recipients.join(', '));
  console.log('     • PLANT_QA_WARNING_LOGGED ->', plantEv.recipients.join(', '));

  // 2. Test getSuperAdminDailyReportData
  console.log('\n2. Testing getSuperAdminDailyReportData...');
  const today = new Date().toISOString().slice(0, 10);
  const data = await getSuperAdminDailyReportData({ date: today });
  console.log(`   ✓ Report generated for date: ${data.date}`);
  console.log(`     • MOT Collections: ${data.kpis.mot.totalCollections} (${data.kpis.mot.totalLiters} L)`);
  console.log(`     • ZMCC Portions: ${data.kpis.zmcc.totalPortions} (${data.kpis.zmcc.totalLiters} L)`);
  console.log(`     • Plant QA Tankers: ${data.kpis.plantQa.totalTankers} (${data.kpis.plantQa.totalLiters} L)`);
  console.log(`     • Exceptions Handled: ${data.kpis.exceptions.totalHandled}`);
  console.log(`     • Supply Chain Losses: T1=${data.kpis.losses.tier1LossPercent}%, T2=${data.kpis.losses.tier2LossPercent}%, T3=${data.kpis.losses.tier3LossPercent}%`);

  // 3. Test Excel generation with exceljs
  console.log('\n3. Testing generateDailyReportExcel...');
  const buffer = await generateDailyReportExcel(data);
  if (!buffer || buffer.length === 0) {
    throw new Error('Excel buffer is empty!');
  }
  console.log(`   ✓ Excel workbook generated! Buffer size: ${buffer.length} bytes`);

  // Read back the workbook to verify sheets
  const testWb = new ExcelJS.Workbook();
  await testWb.xlsx.load(buffer as any);
  const sheetNames = testWb.worksheets.map((w) => w.name);
  console.log('   ✓ Generated sheets inside workbook:', sheetNames.join(', '));
  const expectedSheets = [
    'Executive Summary',
    'MOT Collections',
    'ZMCC Lab Portions',
    'Exceptions Log',
    'Plant QA Reception',
  ];
  for (const es of expectedSheets) {
    if (!sheetNames.includes(es)) {
      throw new Error(`Expected sheet "${es}" not found in workbook!`);
    }
  }

  // 4. Test Email dispatch preview & formatting
  console.log('\n4. Testing sendSuperAdminDailyReportEmail preview formatting...');
  const emailResult = await sendSuperAdminDailyReportEmail({
    recipients: ['head.mpd@shakarganj.com.pk', 'qa.head@shakarganj.com.pk'],
    date: today,
    note: 'Daily operational run completed smoothly. All silos within target temp.',
    reportData: data,
    actingContext: {
      userId: BigInt(1),
      actorRole: 'SUPER_ADMIN',
      actingAs: 'SUPER_ADMIN',
      isDelegated: false,
      scope: { kind: 'GLOBAL' } as any,
    },
  });

  console.log('   ✓ Email dispatch simulated successfully:');
  console.log('   ', emailResult.message);
  console.log('   Preview text:\n' + emailResult.previewText);

  console.log('\n========================================');
  console.log('ALL TESTS PASSED WITH 100% SUCCESS!');
  console.log('========================================');
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
