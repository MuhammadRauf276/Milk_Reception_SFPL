import 'dotenv/config';
import { Prisma } from '@prisma/client';
import { createPrismaClient } from '../src/backend/core/db';

const prisma = createPrismaClient();

const LAB_TESTS_SEED = [
  { displayOrder: 1, testCode: 'LT-000001', testName: 'Temperature', resultType: 'NUMERIC', unit: '°C', testScope: 'BOTH', isRequired: true, isActive: true },
  { displayOrder: 2, testCode: 'LT-000002', testName: 'Organoleptic Smell', resultType: 'OK_NOT_OK', unit: null, testScope: 'BOTH', isRequired: true, isActive: true },
  { displayOrder: 3, testCode: 'LT-000003', testName: 'Organoleptic Taste', resultType: 'OK_NOT_OK', unit: null, testScope: 'BOTH', isRequired: true, isActive: true },
  { displayOrder: 4, testCode: 'LT-000004', testName: 'Clot on Boiling', resultType: 'POSITIVE_NEGATIVE', unit: null, testScope: 'BOTH', isRequired: true, isActive: true },
  { displayOrder: 5, testCode: 'LT-000005', testName: 'Acidity', resultType: 'NUMERIC', unit: '%', testScope: 'BOTH', isRequired: true, isActive: true },
  { displayOrder: 6, testCode: 'LT-000006', testName: 'pH at 20 Celsius', resultType: 'NUMERIC', unit: 'pH', testScope: 'BOTH', isRequired: true, isActive: true },
  { displayOrder: 7, testCode: 'LT-000007', testName: 'APT at 60 Percent', resultType: 'POSITIVE_NEGATIVE', unit: null, testScope: 'BOTH', isRequired: true, isActive: true },
  { displayOrder: 8, testCode: 'LT-000008', testName: 'LR at 20 Celsius', resultType: 'NUMERIC', unit: 'Reading', testScope: 'BOTH', isRequired: true, isActive: true },
  { displayOrder: 9, testCode: 'LT-000009', testName: 'SNF to Fat Ratio', resultType: 'CALCULATED', unit: 'Ratio', testScope: 'BOTH', isRequired: true, isActive: true },
  { displayOrder: 10, testCode: 'LT-000010', testName: 'Salt', resultType: 'NUMERIC', unit: '%', testScope: 'BOTH', isRequired: true, isActive: true },
  { displayOrder: 11, testCode: 'LT-000011', testName: 'Starch', resultType: 'POSITIVE_NEGATIVE', unit: null, testScope: 'BOTH', isRequired: true, isActive: true },
  { displayOrder: 12, testCode: 'LT-000012', testName: 'Urea', resultType: 'POSITIVE_NEGATIVE', unit: null, testScope: 'BOTH', isRequired: true, isActive: true },
  { displayOrder: 13, testCode: 'LT-000013', testName: 'Ammonium Salts', resultType: 'POSITIVE_NEGATIVE', unit: null, testScope: 'BOTH', isRequired: true, isActive: true },
  { displayOrder: 14, testCode: 'LT-000014', testName: 'Sugar', resultType: 'POSITIVE_NEGATIVE', unit: null, testScope: 'BOTH', isRequired: true, isActive: true },
  { displayOrder: 15, testCode: 'LT-000015', testName: 'Glucose', resultType: 'POSITIVE_NEGATIVE', unit: null, testScope: 'BOTH', isRequired: true, isActive: true },
  { displayOrder: 16, testCode: 'LT-000016', testName: 'Sorbitol', resultType: 'POSITIVE_NEGATIVE', unit: null, testScope: 'BOTH', isRequired: true, isActive: true },
  { displayOrder: 17, testCode: 'LT-000017', testName: 'Detergent', resultType: 'POSITIVE_NEGATIVE', unit: null, testScope: 'BOTH', isRequired: true, isActive: true },
  { displayOrder: 18, testCode: 'LT-000018', testName: 'Formalin', resultType: 'POSITIVE_NEGATIVE', unit: null, testScope: 'BOTH', isRequired: true, isActive: true },
  { displayOrder: 19, testCode: 'LT-000019', testName: 'Hydrogen Peroxide', resultType: 'POSITIVE_NEGATIVE', unit: null, testScope: 'BOTH', isRequired: true, isActive: true },
  { displayOrder: 20, testCode: 'LT-000020', testName: 'Antibiotic', resultType: 'POSITIVE_NEGATIVE', unit: null, testScope: 'BOTH', isRequired: true, isActive: true },
  { displayOrder: 21, testCode: 'LT-000021', testName: 'BR Value', resultType: 'NUMERIC', unit: 'Value', testScope: 'BOTH', isRequired: true, isActive: true },
  { displayOrder: 22, testCode: 'LT-000022', testName: 'Protein', resultType: 'NUMERIC', unit: '%', testScope: 'BOTH', isRequired: true, isActive: true },
  { displayOrder: 23, testCode: 'LT-000023', testName: 'Whey Protein Ratio', resultType: 'NUMERIC', unit: 'Ratio', testScope: 'BOTH', isRequired: true, isActive: true },
  { displayOrder: 24, testCode: 'LT-000024', testName: 'Sodium per 100g SNF', resultType: 'NUMERIC', unit: 'mg/100g', testScope: 'BOTH', isRequired: true, isActive: true },
  { displayOrder: 25, testCode: 'LT-000025', testName: 'MBRT', resultType: 'NUMERIC', unit: 'Minutes', testScope: 'BOTH', isRequired: true, isActive: true },
  { displayOrder: 26, testCode: 'LT-000026', testName: 'Fat', resultType: 'NUMERIC', unit: '%', testScope: 'BOTH', isRequired: true, isActive: true },
  { displayOrder: 27, testCode: 'LT-000027', testName: 'Lactometer Reading', resultType: 'NUMERIC', unit: 'Reading', testScope: 'BOTH', isRequired: true, isActive: true },
  { displayOrder: 28, testCode: 'LT-000028', testName: 'Cup Test', resultType: 'POSITIVE_NEGATIVE', unit: null, testScope: 'BOTH', isRequired: true, isActive: true },
  { displayOrder: 29, testCode: 'LT-000029', testName: 'RM Value', resultType: 'NUMERIC', unit: 'Value', testScope: 'BOTH', isRequired: true, isActive: true },
  { displayOrder: 30, testCode: 'LT-000030', testName: 'Aflatoxin Value', resultType: 'NUMERIC', unit: 'ppt', testScope: 'BOTH', isRequired: true, isActive: true },
];

// Contractors (source_type CONTRACTOR) carry the ERP code of their ledger account. ZMCCs have none.
const PROCUREMENT_SOURCES_SEED: Array<{ code: string; name: string; sourceType: string; erpCode?: string }> = [
  { code: 'ZMCC-HASILPUR', name: 'ZMCC Hasilpur', sourceType: 'ZMCC' },
  { code: 'ZMCC-JHANG', name: 'ZMCC Jhang', sourceType: 'ZMCC' },
  { code: 'ZMCC-KABIRWALA', name: 'ZMCC Kabirwala', sourceType: 'ZMCC' },
  { code: 'CONT-ALKHAIR', name: 'Al Khair Dairy', sourceType: 'CONTRACTOR', erpCode: 'ERP-CON-0001' },
  { code: 'CONT-IMRAN', name: 'Imran Mehmood', sourceType: 'CONTRACTOR', erpCode: 'ERP-CON-0002' },
  { code: 'CONT-ALMEHMOOD', name: 'Al Mehmood Dairy', sourceType: 'CONTRACTOR', erpCode: 'ERP-CON-0003' },
];

// Independent milk sources: a name and an ERP code. Assigned to ZMCCs through MilkSourceZmccVisibility.
const MILK_SOURCES_SEED = [
  { erpCode: 'MS-0001', name: 'Chak 14 Collection Point', zmcc: ['ZMCC-HASILPUR'] },
  { erpCode: 'MS-0002', name: 'Bahawalpur Road Farmers', zmcc: ['ZMCC-HASILPUR'] },
  { erpCode: 'MS-0003', name: 'Haroonabad Village Group', zmcc: ['ZMCC-HASILPUR', 'ZMCC-KABIRWALA'] },
  { erpCode: 'MS-0004', name: 'Jhang Sadar Dairy Farmers', zmcc: ['ZMCC-JHANG'] },
  { erpCode: 'MS-0005', name: 'Shorkot Milk Group', zmcc: ['ZMCC-JHANG'] },
  { erpCode: 'MS-0006', name: 'Kabirwala Town Suppliers', zmcc: ['ZMCC-KABIRWALA'] },
];

// Vehicles are registered by the Data Executive only.
const MC_VEHICLES_SEED = [
  { vehicleNumber: 'LES-1001', zmcc: 'ZMCC-HASILPUR' },
  { vehicleNumber: 'LES-1002', zmcc: 'ZMCC-HASILPUR' },
  { vehicleNumber: 'LES-2001', zmcc: 'ZMCC-JHANG' },
  { vehicleNumber: 'LES-3001', zmcc: 'ZMCC-KABIRWALA' },
];

// Permanent roles for the tests the milk formulas depend on (found by role, never by code/name/order).
// SYS-SNF / SYS-TS are the calculated SNF and Total Solids tests of the master catalog (master-lab-tests-data.ts); they only
// get a role here if a seed row with that code exists.
const SYSTEM_ROLE_BY_CODE: Record<string, string> = {
  'LT-000008': 'LR',
  'LT-000026': 'FAT',
  'LT-000009': 'SNF_FAT_RATIO',
  'SYS-SNF': 'SNF',
  'SYS-TS': 'TOTAL_SOLIDS',
};

async function main() {
  await prisma.$executeRawUnsafe('CREATE SEQUENCE IF NOT EXISTS lab_test_code_seq START WITH 100 INCREMENT BY 1;');
  await prisma.$executeRawUnsafe('CREATE SEQUENCE IF NOT EXISTS mot_journey_number_seq START WITH 1 INCREMENT BY 1;');
  await prisma.$executeRawUnsafe('CREATE SEQUENCE IF NOT EXISTS mot_collection_number_seq START WITH 1 INCREMENT BY 1;');
  console.log('Seeding 30 Laboratory Tests in PostgreSQL...');

  for (const test of LAB_TESTS_SEED) {
    // A role is given only when the test is first created and no other test already holds it (unique index on system_role).
    let roleForCreate: string | null = null;
    const mappedRole = SYSTEM_ROLE_BY_CODE[test.testCode];
    if (mappedRole && !(await prisma.labTest.findUnique({ where: { testCode: test.testCode }, select: { id: true } }))) {
      const holder = await prisma.labTest.findFirst({ where: { systemRole: mappedRole }, select: { id: true } });
      roleForCreate = holder ? null : mappedRole;
    }
    const defaultOptions = (
      test.resultType === 'OK_NOT_OK'
        ? [{ value: 'OK', label: 'OK', isPassing: true }, { value: 'NOT_OK', label: 'Not OK', isPassing: false }]
        : test.resultType === 'POSITIVE_NEGATIVE'
        ? [{ value: 'NEGATIVE', label: 'Negative', isPassing: true }, { value: 'POSITIVE', label: 'Positive', isPassing: false }]
        : Prisma.DbNull
    );

    await prisma.labTest.upsert({
      where: { testCode: test.testCode },
      update: {
        testName: test.testName,
        resultType: test.resultType,
        unit: test.unit,
        testScope: test.testScope,
        isRequired: test.isRequired,
        isActive: test.isActive,
        displayOrder: test.displayOrder,
        resultOptions: defaultOptions,
        // systemRole is set only when the test is first created: re-seeding must never move or clear a role the admin set.
      },
      create: {
        testCode: test.testCode,
        testName: test.testName,
        resultType: test.resultType,
        unit: test.unit,
        testScope: test.testScope,
        isRequired: test.isRequired,
        isActive: test.isActive,
        displayOrder: test.displayOrder,
        resultOptions: defaultOptions,
        systemRole: roleForCreate,
      },
    });
  }

  // SYS-SNF / SYS-TS are not part of LAB_TESTS_SEED, but databases that already have them get their role here.
  // Only an existing test with no role is touched, and only when no other test holds that role (never overwrites).
  for (const [code, role] of Object.entries(SYSTEM_ROLE_BY_CODE)) {
    if (!code.startsWith('SYS-')) continue;
    const existing = await prisma.labTest.findUnique({ where: { testCode: code }, select: { id: true, systemRole: true } });
    if (!existing || existing.systemRole) continue;
    const holder = await prisma.labTest.findFirst({ where: { systemRole: role }, select: { id: true } });
    if (!holder) await prisma.labTest.update({ where: { id: existing.id }, data: { systemRole: role } });
  }

  console.log('Seeding Procurement Sources in PostgreSQL...');

  // Remove unconfirmed demo contractor CONT-NDL if present
  await prisma.procurementSource.deleteMany({
    where: { code: 'CONT-NDL' },
  });

  for (const ps of PROCUREMENT_SOURCES_SEED) {
    await prisma.procurementSource.upsert({
      where: { code: ps.code },
      update: {
        name: ps.name,
        source_type: ps.sourceType,
        ...(ps.erpCode ? { erp_code: ps.erpCode } : {}),
      },
      create: {
        code: ps.code,
        name: ps.name,
        source_type: ps.sourceType,
        ...(ps.erpCode ? { erp_code: ps.erpCode } : {}),
      },
    });
  }

  console.log('Seeding System Users in PostgreSQL...');

  const bcrypt = await import('bcryptjs');
  const USERS_SEED = [
    { username: 'admin.superuser', email: 'admin.superuser@example.com', name: 'Super Admin', role: 'SUPER_ADMIN', department: 'System Administration', pass: 'admin123', scopeType: 'SYSTEM', isActive: true, sourceCode: null },
    { username: 'super.admin', email: 'super.admin@example.com', name: 'Retired Bootstrap Admin', role: 'SUPER_ADMIN', department: 'Retired Migration Account', pass: 'admin123', scopeType: 'SYSTEM', isActive: false, sourceCode: null },
    { username: 'executive.management', email: 'executive.management@example.com', name: 'Senior Executive Management', role: 'EXECUTIVE_MANAGEMENT', department: 'Executive Management', pass: 'exec123', scopeType: 'SYSTEM', isActive: true, sourceCode: null },
    { username: 'data.executive', email: 'data.executive@example.com', name: 'Data Executive', role: 'DATA_EXECUTIVE', department: 'Data & Analytics', pass: 'data123', scopeType: 'SYSTEM', isActive: true, sourceCode: null },
    { username: 'mpd.head', email: 'mpd.head@example.com', name: 'MPD Head', role: 'HEAD_OF_MPD', department: 'Milk Procurement', pass: 'mpdhead123', scopeType: 'SYSTEM', isActive: true, sourceCode: null },
    { username: 'admin.head', email: 'admin.head@example.com', name: 'Admin Head', role: 'ADMIN_HEAD', department: 'Administration', pass: 'adminhead123', scopeType: 'DEPARTMENT', isActive: true, sourceCode: null },
    { username: 'qa.head@shakarganj.com.pk', email: 'qa.head@shakarganj.com.pk', name: 'AVP-QA / Head of Quality', role: 'QA_HEAD', department: 'Quality Assurance', pass: 'qahead123', scopeType: 'DEPARTMENT', isActive: true, sourceCode: null },
    { username: 'qa.head', email: 'qa.head@example.com', name: 'QA Head', role: 'QA_HEAD', department: 'Quality Assurance', pass: 'qahead123', scopeType: 'DEPARTMENT', isActive: true, sourceCode: null },
    { username: 'production.head', email: 'production.head@example.com', name: 'Production Head', role: 'PRODUCTION_HEAD', department: 'Production', pass: 'prodhead123', scopeType: 'DEPARTMENT', isActive: true, sourceCode: null },
    { username: 'finance.accounts', email: 'finance.accounts@example.com', name: 'Finance and Accounts', role: 'FINANCE_ACCOUNTS', department: 'Finance & Accounts', pass: 'finance123', scopeType: 'DEPARTMENT', isActive: true, sourceCode: null },
    { username: 'zmcc.manager.hasilpur', email: 'zmcc.manager.hasilpur@example.com', name: 'ZMCC Manager - Hasilpur', role: 'ZMCC_MANAGER', department: 'Milk Procurement', pass: 'zone123', scopeType: 'SOURCE', isActive: true, sourceCode: 'ZMCC-HASILPUR' },
    { username: 'zmcc.manager.jhang', email: 'zmcc.manager.jhang@example.com', name: 'ZMCC Manager - Jhang', role: 'ZMCC_MANAGER', department: 'Milk Procurement', pass: 'zone123', scopeType: 'SOURCE', isActive: true, sourceCode: 'ZMCC-JHANG' },
    { username: 'zmcc.manager.north', email: 'zmcc.manager.north@example.com', name: 'ZMCC Manager - Hasilpur', role: 'ZMCC_MANAGER', department: 'Milk Procurement', pass: 'zone123', scopeType: 'SOURCE', isActive: true, sourceCode: 'ZMCC-HASILPUR' },
    { username: 'contractor.manager.alkhair', email: 'contractor.manager.alkhair@example.com', name: 'Contractor Manager - Al Khair', role: 'CONTRACTOR_MANAGER', department: 'Milk Procurement', pass: 'contractor123', scopeType: 'SOURCE', isActive: true, sourceCode: 'CONT-ALKHAIR' },
    { username: 'phe.operator', email: 'phe.operator@example.com', name: 'PHE Operator', role: 'PHE_OPERATOR', department: 'Milk Procurement', pass: 'phe123', scopeType: 'SOURCE', isActive: true, sourceCode: 'ZMCC-HASILPUR' },
    { username: 'mdo', email: 'mdo@example.com', name: 'MDO (Milk Development Officer)', role: 'MDO', department: 'Milk Procurement', pass: 'mdo123', scopeType: 'SOURCE', isActive: true, sourceCode: 'ZMCC-HASILPUR' },
    { username: 'mdo.hasilpur', email: 'mdo.hasilpur@example.com', name: 'MDO - Hasilpur', role: 'MDO', department: 'Milk Procurement', pass: 'mdo123', scopeType: 'SOURCE', isActive: true, sourceCode: 'ZMCC-HASILPUR' },
    { username: 'mdo.jhang', email: 'mdo.jhang@example.com', name: 'MDO - Jhang', role: 'MDO', department: 'Milk Procurement', pass: 'mdo123', scopeType: 'SOURCE', isActive: true, sourceCode: 'ZMCC-JHANG' },
    { username: 'zmcc.operator', email: 'zmcc.operator@example.com', name: 'ZMCC Lab Attendant (Hasilpur)', role: 'ZMCC_LAB_ATTENDANT', department: 'Milk Procurement', pass: 'mpd123', scopeType: 'SOURCE', isActive: true, sourceCode: 'ZMCC-HASILPUR' },
    { username: 'zmcc.operator.jhang', email: 'zmcc.operator.jhang@example.com', name: 'ZMCC Lab Attendant (Jhang)', role: 'ZMCC_LAB_ATTENDANT', department: 'Milk Procurement', pass: 'mpd123', scopeType: 'SOURCE', isActive: true, sourceCode: 'ZMCC-JHANG' },
    { username: 'zmcc.operator.kabirwala', email: 'zmcc.operator.kabirwala@example.com', name: 'ZMCC Lab Attendant (Kabirwala)', role: 'ZMCC_LAB_ATTENDANT', department: 'Milk Procurement', pass: 'mpd123', scopeType: 'SOURCE', isActive: true, sourceCode: 'ZMCC-KABIRWALA' },
    { username: 'mot.driver', email: 'mot.driver@example.com', name: 'Mobile Tester', role: 'MOT', department: 'Milk Procurement', pass: 'mot123', scopeType: 'SOURCE', isActive: true, sourceCode: 'ZMCC-HASILPUR' },
    { username: 'contractor.operator.alkhair', email: 'contractor.operator.alkhair@example.com', name: 'Contractor Operator (Al Khair)', role: 'CONTRACTOR_OPERATOR', department: 'Milk Procurement - Contractor Operations', pass: 'mpd123', scopeType: 'SOURCE', isActive: true, sourceCode: 'CONT-ALKHAIR' },
    { username: 'contractor.operator.almehmood', email: 'contractor.operator.almehmood@example.com', name: 'Contractor Operator (Al Mehmood)', role: 'CONTRACTOR_OPERATOR', department: 'Milk Procurement - Contractor Operations', pass: 'mpd123', scopeType: 'SOURCE', isActive: true, sourceCode: 'CONT-ALMEHMOOD' },
    { username: 'security.gate', email: 'security.gate@example.com', name: 'Admin Operator', role: 'SECURITY_OPERATOR', department: 'Administration', pass: 'security123', scopeType: 'DEPARTMENT', isActive: true, sourceCode: null },
    { username: 'qa.reception@shakarganj.com.pk', email: 'qa.reception@shakarganj.com.pk', name: 'QAE Reception Lab', role: 'QA_LAB_ATTENDANT', department: 'Quality Assurance', pass: 'qa123', scopeType: 'DEPARTMENT', isActive: true, sourceCode: null },
    { username: 'qa.chemist', email: 'qa.chemist@example.com', name: 'QA Lab Attendant', role: 'QA_LAB_ATTENDANT', department: 'Quality Assurance', pass: 'qa123', scopeType: 'DEPARTMENT', isActive: true, sourceCode: null },
    { username: 'weighbridge.operator', email: 'weighbridge.operator@example.com', name: 'Weighbridge Operator', role: 'WEIGHBRIDGE_OPERATOR', department: 'Production & Weighbridge', pass: 'weighbridge123', scopeType: 'DEPARTMENT', isActive: true, sourceCode: null },
    { username: 'weighbridge.02', email: 'weighbridge.02@example.com', name: 'Weighbridge Shift Operator 2', role: 'WEIGHBRIDGE_OPERATOR', department: 'Production & Weighbridge', pass: 'weighbridge123', scopeType: 'DEPARTMENT', isActive: true, sourceCode: null },
    { username: 'production.operator', email: 'production.operator@example.com', name: 'Production Reception Operator', role: 'PRODUCTION_RECEPTION_OPERATOR', department: 'Production', pass: 'production123', scopeType: 'DEPARTMENT', isActive: true, sourceCode: null },
    // Inactive legacy accounts preserved for FK history without active authority
    { username: 'security.head', email: 'security.head@example.com', name: 'Retired Security Head', role: 'ADMIN_HEAD', department: 'Security Management', pass: 'sechead123', scopeType: 'DEPARTMENT', isActive: false, sourceCode: null },
    { username: 'general.plant.manager', email: 'general.plant.manager@example.com', name: 'Retired Plant Manager', role: 'EXECUTIVE_MANAGEMENT', department: 'Plant Executive Directorate', pass: 'plantmanager123', scopeType: 'SYSTEM', isActive: false, sourceCode: null },
    { username: 'correction.officer', email: 'correction.officer@example.com', name: 'Retired Correction Officer', role: 'SUPER_ADMIN', department: 'Plant Audit & Data Corrections', pass: 'correct123', scopeType: 'SYSTEM', isActive: false, sourceCode: null },
  ];

  const shouldResetPasswords = process.env.RESET_DEV_PASSWORDS === 'true';

  for (const u of USERS_SEED) {
    const hash = await bcrypt.hash(u.pass, 10);
    let sourceId: bigint | null = null;

    if (u.sourceCode) {
      const src = await prisma.procurementSource.findUnique({ where: { code: u.sourceCode } });
      if (src) sourceId = src.id;
    }

    const existingUser = await prisma.user.findFirst({ where: { username: u.username } });

    if (existingUser) {
      // Idempotency: preserve existing user's email (whether set or NULL)
      // Never overwrite or fabricate an email on rerun.
      const updateData: Record<string, unknown> = {
        full_name: u.name,
        role: u.role,
        department: u.department,
        scope_type: u.scopeType,
        procurement_source_id: sourceId,
        is_active: u.isActive,
      };

      if (shouldResetPasswords || !existingUser.password_hash) {
        updateData.password_hash = hash;
      }

      await prisma.user.update({
        where: { id: existingUser.id },
        data: updateData,
      });
    } else {
      await prisma.user.create({
        data: {
          username: u.username,
          full_name: u.name,
          email: u.email,
          password_hash: hash,
          role: u.role,
          department: u.department,
          scope_type: u.scopeType,
          procurement_source_id: sourceId,
          is_active: u.isActive,
        },
      });
    }
  }

  console.log('Seeding Chiller Ownership Master Data in PostgreSQL...');
  const CHILLER_OWNERSHIP_SEED = [
    { code: 'NESTLE', name: 'Nestlé' },
    { code: 'ENGRO', name: 'Engro' },
    { code: 'SHAKARGANJ', name: 'Shakarganj' },
    { code: 'HALEEB', name: 'Haleeb' },
    { code: 'FFL', name: 'FFL' },
    { code: 'ADAM', name: 'Adam' },
    { code: 'MILLAC', name: 'Millac' },
    { code: 'GHANI', name: 'Ghani' },
    { code: 'ACHA_FOODS', name: 'Acha Foods' },
    { code: 'SELF', name: 'Self' },
    { code: 'OTHER', name: 'Other' },
  ];

  const superAdmin = await prisma.user.findFirst({
    where: {
      username: 'admin.superuser',
      role: 'SUPER_ADMIN',
      is_active: true,
      scope_type: 'SYSTEM',
    },
  });

  if (!superAdmin) {
    throw new Error(
      'Active canonical SUPER_ADMIN (admin.superuser with role=SUPER_ADMIN, is_active=true, scope_type=SYSTEM) not found for seeding ChillerOwnership'
    );
  }

  for (const item of CHILLER_OWNERSHIP_SEED) {
    await prisma.chillerOwnership.upsert({
      where: { ownership_code: item.code },
      update: {
        name: item.name,
        is_active: true,
        updated_by: superAdmin.id,
      },
      create: {
        ownership_code: item.code,
        name: item.name,
        is_active: true,
        created_by: superAdmin.id,
        updated_by: null,
      },
    });
  }

  console.log('Seeding milk sources, ZMCC assignments, MC vehicles and weighing policy...');
  const dataExecutive = await prisma.user.findFirst({ where: { username: 'data.executive', role: 'DATA_EXECUTIVE' } });
  if (!dataExecutive) throw new Error('Data Executive user (data.executive) not found for seeding sources and vehicles');

  for (const ms of MILK_SOURCES_SEED) {
    const source = await prisma.zmccMilkSource.upsert({
      where: { erp_code: ms.erpCode },
      update: { name: ms.name, is_active: true, updated_by: dataExecutive.id },
      create: { erp_code: ms.erpCode, name: ms.name, is_active: true, created_by: dataExecutive.id },
    });
    for (const zmccCode of ms.zmcc) {
      const zmcc = await prisma.procurementSource.findUnique({ where: { code: zmccCode } });
      if (!zmcc) continue;
      await prisma.milkSourceZmccVisibility.upsert({
        where: { milk_source_id_zmcc_id: { milk_source_id: source.id, zmcc_id: zmcc.id } },
        update: { is_active: true },
        create: { milk_source_id: source.id, zmcc_id: zmcc.id, is_active: true },
      });
    }
  }

  for (const v of MC_VEHICLES_SEED) {
    const zmcc = await prisma.procurementSource.findUnique({ where: { code: v.zmcc } });
    if (!zmcc) continue;
    await prisma.motVehicle.upsert({
      where: { vehicle_number: v.vehicleNumber },
      update: { is_active: true },
      create: { vehicle_number: v.vehicleNumber, zmcc_id: zmcc.id, is_active: true, created_by: dataExecutive.id },
    });
  }

  // Global weighing policy (single row): manual entry off, both units allowed once it is switched on.
  const policyCount = await prisma.zmccWeighingPolicy.count();
  if (policyCount === 0) {
    await prisma.zmccWeighingPolicy.create({ data: { manual_entry_enabled: false, allowed_units: 'BOTH', version: 1 } });
  }

  console.log('✅ Successfully seeded 30 Lab Tests, 6 Procurement Sources (contractors with ERP codes), milk sources, MC vehicles, System Users, and 11 Chiller Ownership records!');
}

main()
  .catch((e) => {
    console.error('Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
