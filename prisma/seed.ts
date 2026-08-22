import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

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

const PROCUREMENT_SOURCES_SEED = [
  { code: 'ZMCC-HASILPUR', name: 'ZMCC Hasilpur', sourceType: 'ZMCC' },
  { code: 'ZMCC-JHANG', name: 'ZMCC Jhang', sourceType: 'ZMCC' },
  { code: 'ZMCC-KABIRWALA', name: 'ZMCC Kabirwala', sourceType: 'ZMCC' },
  { code: 'CONT-ALKHAIR', name: 'Al Khair Dairy', sourceType: 'CONTRACTOR' },
  { code: 'CONT-IMRAN', name: 'Imran Mehmood', sourceType: 'CONTRACTOR' },
  { code: 'CONT-ALMEHMOOD', name: 'Al Mehmood Dairy', sourceType: 'CONTRACTOR' },
];

async function main() {
  await prisma.$executeRawUnsafe('CREATE SEQUENCE IF NOT EXISTS lab_test_code_seq START WITH 100 INCREMENT BY 1;');
  console.log('Seeding 30 Laboratory Tests in PostgreSQL...');


  for (const test of LAB_TESTS_SEED) {
    const defaultOptions = (test as any).resultOptions || (
      test.resultType === 'OK_NOT_OK'
        ? [{ value: 'OK', label: 'OK', isPassing: true }, { value: 'NOT_OK', label: 'Not OK', isPassing: false }]
        : test.resultType === 'POSITIVE_NEGATIVE'
        ? [{ value: 'NEGATIVE', label: 'Negative', isPassing: true }, { value: 'POSITIVE', label: 'Positive', isPassing: false }]
        : null
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
      },
    });
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
      },
      create: {
        code: ps.code,
        name: ps.name,
        source_type: ps.sourceType,
      },
    });
  }

  console.log('Seeding System Users in PostgreSQL...');

  const bcrypt = await import('bcryptjs');
  const USERS_SEED = [
    { username: 'admin.superuser', name: 'Super Admin', role: 'SUPER_ADMIN', department: 'System Administration', pass: 'admin123', scopeType: 'SYSTEM', isActive: true, sourceCode: null },
    { username: 'super.admin', name: 'Retired Bootstrap Admin', role: 'SUPER_ADMIN', department: 'Retired Migration Account', pass: 'admin123', scopeType: 'SYSTEM', isActive: false, sourceCode: null },
    { username: 'zmcc.operator', name: 'ZMCC Field Operator (Hasilpur)', role: 'MPD_Operator', department: 'Milk Procurement (Hasilpur)', pass: 'mpd123', scopeType: 'SOURCE', isActive: true, sourceCode: 'ZMCC-HASILPUR' },
    { username: 'zmcc.operator.jhang', name: 'ZMCC Field Operator (Jhang)', role: 'MPD_Operator', department: 'Milk Procurement (Jhang)', pass: 'mpd123', scopeType: 'SOURCE', isActive: true, sourceCode: 'ZMCC-JHANG' },
    { username: 'zmcc.operator.kabirwala', name: 'ZMCC Field Operator (Kabirwala)', role: 'MPD_Operator', department: 'Milk Procurement (Kabirwala)', pass: 'mpd123', scopeType: 'SOURCE', isActive: true, sourceCode: 'ZMCC-KABIRWALA' },
    { username: 'contractor.operator.alkhair', name: 'Contractor Operator (Al Khair)', role: 'MPD_Operator', department: 'Milk Procurement (Al Khair)', pass: 'mpd123', scopeType: 'SOURCE', isActive: true, sourceCode: 'CONT-ALKHAIR' },
    { username: 'contractor.operator.almehmood', name: 'Contractor Operator (Al Mehmood)', role: 'MPD_Operator', department: 'Milk Procurement (Al Mehmood)', pass: 'mpd123', scopeType: 'SOURCE', isActive: true, sourceCode: 'CONT-ALMEHMOOD' },
    { username: 'zmcc.manager.north', name: 'ZMCC Minor Manager (Northern Zone)', role: 'MPD_Zone_Manager', department: 'Milk Procurement (Zone A)', pass: 'zone123', scopeType: 'DEPARTMENT', isActive: true, sourceCode: null },
    { username: 'security.gate', name: 'Security Gate Operator', role: 'Security_Operator', department: 'Security & Weighbridge', pass: 'security123', scopeType: 'ALL', isActive: true, sourceCode: null },
    { username: 'security.head', name: 'Security Admin Manager (Head)', role: 'Security_Manager', department: 'Security Management', pass: 'sechead123', scopeType: 'DEPARTMENT', isActive: true, sourceCode: null },
    { username: 'qa.chemist', name: 'QA Lab Testing Chemist', role: 'QA_Operator', department: 'Quality Assurance Lab', pass: 'qa123', scopeType: 'ALL', isActive: true, sourceCode: null },
    { username: 'qa.head', name: 'QA Department Manager', role: 'QA_Manager', department: 'QA Management', pass: 'qahead123', scopeType: 'DEPARTMENT', isActive: true, sourceCode: null },
    { username: 'weighbridge.operator', name: 'Weighbridge Operator', role: 'WEIGHBRIDGE_OPERATOR', department: 'Production & Weighbridge', pass: 'weighbridge123', scopeType: 'ALL', isActive: true, sourceCode: null },
    { username: 'weighbridge.02', name: 'Weighbridge Shift Operator 2', role: 'WEIGHBRIDGE_OPERATOR', department: 'Production & Weighbridge', pass: 'weighbridge123', scopeType: 'ALL', isActive: true, sourceCode: null },
    { username: 'production.operator', name: 'Production Operator', role: 'Production_Operator', department: 'Plant Production & Silos', pass: 'production123', scopeType: 'ALL', isActive: true, sourceCode: null },
    { username: 'production.head', name: 'Production Department Manager', role: 'Production_Manager', department: 'Production Management', pass: 'prodhead123', scopeType: 'DEPARTMENT', isActive: true, sourceCode: null },
    { username: 'general.plant.manager', name: 'General Plant Manager', role: 'General_Plant_Manager', department: 'Plant Executive Directorate', pass: 'plantmanager123', scopeType: 'ALL', isActive: true, sourceCode: null },
    { username: 'correction.officer', name: 'Dedicated Data Correction Officer', role: 'Correction_Officer', department: 'Plant Audit & Data Corrections', pass: 'correct123', scopeType: 'ALL', isActive: true, sourceCode: null },
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

  console.log('✅ Successfully seeded 30 Lab Tests, 5 Procurement Sources, and System Users!');
}

main()
  .catch((e) => {
    console.error('Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
