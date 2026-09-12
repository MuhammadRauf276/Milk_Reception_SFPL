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
  await prisma.$executeRawUnsafe('CREATE SEQUENCE IF NOT EXISTS mot_journey_number_seq START WITH 1 INCREMENT BY 1;');
  await prisma.$executeRawUnsafe('CREATE SEQUENCE IF NOT EXISTS mot_collection_number_seq START WITH 1 INCREMENT BY 1;');
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
    { username: 'executive.management', name: 'Senior Executive Management', role: 'EXECUTIVE_MANAGEMENT', department: 'Executive Management', pass: 'exec123', scopeType: 'SYSTEM', isActive: true, sourceCode: null },
    { username: 'data.executive', name: 'Data Executive', role: 'DATA_EXECUTIVE', department: 'Data & Analytics', pass: 'data123', scopeType: 'SYSTEM', isActive: true, sourceCode: null },
    { username: 'mpd.head', name: 'MPD Head', role: 'HEAD_OF_MPD', department: 'Milk Procurement', pass: 'mpdhead123', scopeType: 'SYSTEM', isActive: true, sourceCode: null },
    { username: 'admin.head', name: 'Admin Head', role: 'ADMIN_HEAD', department: 'Administration', pass: 'adminhead123', scopeType: 'DEPARTMENT', isActive: true, sourceCode: null },
    { username: 'qa.head', name: 'QA Head', role: 'QA_HEAD', department: 'Quality Assurance', pass: 'qahead123', scopeType: 'DEPARTMENT', isActive: true, sourceCode: null },
    { username: 'production.head', name: 'Production Head', role: 'PRODUCTION_HEAD', department: 'Production', pass: 'prodhead123', scopeType: 'DEPARTMENT', isActive: true, sourceCode: null },
    { username: 'finance.accounts', name: 'Finance and Accounts', role: 'FINANCE_ACCOUNTS', department: 'Finance & Accounts', pass: 'finance123', scopeType: 'DEPARTMENT', isActive: true, sourceCode: null },
    { username: 'zmcc.manager.north', name: 'ZMCC Manager - Hasilpur', role: 'ZMCC_MANAGER', department: 'Milk Procurement', pass: 'zone123', scopeType: 'SOURCE', isActive: true, sourceCode: 'ZMCC-HASILPUR' },
    { username: 'contractor.manager.alkhair', name: 'Contractor Manager - Al Khair', role: 'CONTRACTOR_MANAGER', department: 'Milk Procurement', pass: 'contractor123', scopeType: 'SOURCE', isActive: true, sourceCode: 'CONT-ALKHAIR' },
    { username: 'phe.operator', name: 'PHE Operator', role: 'PHE_OPERATOR', department: 'Milk Procurement', pass: 'phe123', scopeType: 'SOURCE', isActive: true, sourceCode: 'ZMCC-HASILPUR' },
    { username: 'zmcc.operator', name: 'ZMCC Lab Attendant (Hasilpur)', role: 'ZMCC_LAB_ATTENDANT', department: 'Milk Procurement', pass: 'mpd123', scopeType: 'SOURCE', isActive: true, sourceCode: 'ZMCC-HASILPUR' },
    { username: 'zmcc.operator.jhang', name: 'ZMCC Lab Attendant (Jhang)', role: 'ZMCC_LAB_ATTENDANT', department: 'Milk Procurement', pass: 'mpd123', scopeType: 'SOURCE', isActive: true, sourceCode: 'ZMCC-JHANG' },
    { username: 'zmcc.operator.kabirwala', name: 'ZMCC Lab Attendant (Kabirwala)', role: 'ZMCC_LAB_ATTENDANT', department: 'Milk Procurement', pass: 'mpd123', scopeType: 'SOURCE', isActive: true, sourceCode: 'ZMCC-KABIRWALA' },
    { username: 'mot.driver', name: 'MOT Operator', role: 'MOT', department: 'Milk Procurement', pass: 'mot123', scopeType: 'SOURCE', isActive: true, sourceCode: 'ZMCC-HASILPUR' },
    { username: 'contractor.operator.alkhair', name: 'Wasim Sahib', role: 'CONTRACTOR_OPERATOR', department: 'Milk Procurement - Contractor Operations', pass: 'mpd123', scopeType: 'SOURCE', isActive: true, sourceCode: 'CONT-ALKHAIR' },
    { username: 'contractor.operator.almehmood', name: 'Contractor Operator (Al Mehmood)', role: 'CONTRACTOR_OPERATOR', department: 'Milk Procurement - Contractor Operations', pass: 'mpd123', scopeType: 'SOURCE', isActive: true, sourceCode: 'CONT-ALMEHMOOD' },
    { username: 'security.gate', name: 'Security Operator', role: 'SECURITY_OPERATOR', department: 'Security', pass: 'security123', scopeType: 'DEPARTMENT', isActive: true, sourceCode: null },
    { username: 'qa.manager', name: 'QA Manager', role: 'QA_MANAGER', department: 'Quality Assurance', pass: 'qamgr123', scopeType: 'DEPARTMENT', isActive: true, sourceCode: null },
    { username: 'qa.chemist', name: 'QA Lab Attendant', role: 'QA_LAB_ATTENDANT', department: 'Quality Assurance', pass: 'qa123', scopeType: 'DEPARTMENT', isActive: true, sourceCode: null },
    { username: 'weighbridge.operator', name: 'Weighbridge Operator', role: 'WEIGHBRIDGE_OPERATOR', department: 'Production & Weighbridge', pass: 'weighbridge123', scopeType: 'DEPARTMENT', isActive: true, sourceCode: null },
    { username: 'weighbridge.02', name: 'Weighbridge Shift Operator 2', role: 'WEIGHBRIDGE_OPERATOR', department: 'Production & Weighbridge', pass: 'weighbridge123', scopeType: 'DEPARTMENT', isActive: true, sourceCode: null },
    { username: 'production.operator', name: 'Production Reception Operator', role: 'PRODUCTION_RECEPTION_OPERATOR', department: 'Production', pass: 'production123', scopeType: 'DEPARTMENT', isActive: true, sourceCode: null },
    // Inactive legacy accounts preserved for FK history without active authority
    { username: 'security.head', name: 'Retired Security Head', role: 'ADMIN_HEAD', department: 'Security Management', pass: 'sechead123', scopeType: 'DEPARTMENT', isActive: false, sourceCode: null },
    { username: 'general.plant.manager', name: 'Retired Plant Manager', role: 'EXECUTIVE_MANAGEMENT', department: 'Plant Executive Directorate', pass: 'plantmanager123', scopeType: 'SYSTEM', isActive: false, sourceCode: null },
    { username: 'correction.officer', name: 'Retired Correction Officer', role: 'SUPER_ADMIN', department: 'Plant Audit & Data Corrections', pass: 'correct123', scopeType: 'SYSTEM', isActive: false, sourceCode: null },
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

  console.log('✅ Successfully seeded 30 Lab Tests, 5 Procurement Sources, System Users, and 11 Chiller Ownership records!');
}

main()
  .catch((e) => {
    console.error('Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
