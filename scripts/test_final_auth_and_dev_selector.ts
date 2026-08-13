import { prisma } from '../src/backend/core/db';
import { NORMAL_SESSION_TTL, REMEMBERED_SESSION_TTL } from '../src/backend/core/auth';
import bcrypt from 'bcryptjs';
import fs from 'fs';

async function runFinalAuthAndDevSelectorTests() {
  console.log('🧪 RUNNING COMPREHENSIVE FINAL AUTH & DEV SELECTOR TEST SUITE...\n');
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`  ✅ PASSED: [${testName}]`);
      passed++;
    } else {
      console.error(`  ❌ FAILED: [${testName}] ${detail || ''}`);
      failed++;
    }
  }

  try {
    // ====================================================
    // GROUP 1: LOGIN-AUTH & DEV CREDENTIALS (01..13)
    // ====================================================
    console.log('--- GROUP 1: LOGIN-AUTH & DEV CREDENTIALS ---');

    const DEV_CREDENTIALS = [
      { id: 'CRED-01', username: 'admin.superuser', pass: 'admin123', expectedRole: 'SUPER_ADMIN' },
      { id: 'CRED-02', username: 'zmcc.operator', pass: 'mpd123', expectedRole: 'MPD_Operator' },
      { id: 'CRED-03', username: 'zmcc.manager.north', pass: 'zone123', expectedRole: 'MPD_Zone_Manager' },
      { id: 'CRED-04', username: 'security.gate', pass: 'security123', expectedRole: 'Security_Operator' },
      { id: 'CRED-05', username: 'security.head', pass: 'sechead123', expectedRole: 'Security_Manager' },
      { id: 'CRED-06', username: 'qa.chemist', pass: 'qa123', expectedRole: 'QA_Operator' },
      { id: 'CRED-07', username: 'qa.head', pass: 'qahead123', expectedRole: 'QA_Manager' },
      { id: 'CRED-08', username: 'weighbridge.operator', pass: 'weighbridge123', expectedRole: 'WEIGHBRIDGE_OPERATOR' },
      { id: 'CRED-09', username: 'weighbridge.02', pass: 'weighbridge123', expectedRole: 'WEIGHBRIDGE_OPERATOR' },
      { id: 'CRED-10', username: 'production.operator', pass: 'production123', expectedRole: 'Production_Operator' },
      { id: 'CRED-11', username: 'production.head', pass: 'prodhead123', expectedRole: 'Production_Manager' },
      { id: 'CRED-12', username: 'general.plant.manager', pass: 'plantmanager123', expectedRole: 'General_Plant_Manager' },
      { id: 'CRED-13', username: 'correction.officer', pass: 'correct123', expectedRole: 'Correction_Officer' },
    ];

    for (const cred of DEV_CREDENTIALS) {
      const dbUser = await prisma.user.findFirst({ where: { username: cred.username } });
      let passOk = false;
      if (dbUser && dbUser.password_hash) {
        passOk = await bcrypt.compare(cred.pass, dbUser.password_hash);
      }
      assert(
        !!dbUser && dbUser.is_active && passOk && dbUser.role === cred.expectedRole,
        `LOGIN-${cred.id}: Account ${cred.username} authenticates against PostgreSQL with role ${cred.expectedRole}`
      );
    }

    // LOGIN-AUTH-02..05: Negative authentication tests
    const wbUser = await prisma.user.findFirst({ where: { username: 'weighbridge.operator' } });
    const wrongPassCheck = wbUser?.password_hash ? await bcrypt.compare('wrongpass', wbUser.password_hash) : false;
    assert(!wrongPassCheck, 'LOGIN-AUTH-02: Wrong password strictly rejected by bcrypt');

    const unknownUser = await prisma.user.findFirst({ where: { username: 'unknown.user' } });
    assert(!unknownUser, 'LOGIN-AUTH-03: Unknown username strictly yields null in DB');

    const retiredUser = await prisma.user.findFirst({ where: { username: 'super.admin' } });
    assert(retiredUser ? !retiredUser.is_active : false, 'LOGIN-AUTH-04: Inactive account (super.admin) has is_active = false');

    // ====================================================
    // GROUP 2: SEED PASSWORD PROTECTION & RESET MECHANISM
    // ====================================================
    console.log('\n--- GROUP 2: SEED PASSWORD PROTECTION & RESET MECHANISM ---');

    const resetScriptContent = fs.readFileSync('D:/MilkReceptionApp/prisma/reset-dev-login-passwords.ts', 'utf-8');
    const hasProdGuard = resetScriptContent.includes("process.env.NODE_ENV === 'production'");
    assert(hasProdGuard, 'SEED-PASS-C: Explicit dev password reset script contains production environment guard');

    const seedScriptContent = fs.readFileSync('D:/MilkReceptionApp/prisma/seed.ts', 'utf-8');
    const hasSeedPassGuard = seedScriptContent.includes('RESET_DEV_PASSWORDS') && seedScriptContent.includes('!existingUser.password_hash');
    assert(hasSeedPassGuard, 'SEED-PASS-A & B: Normal seed protects existing password_hash values unless RESET_DEV_PASSWORDS=true');

    // ====================================================
    // GROUP 3: PROCUREMENT SOURCE RECONCILIATION & SAFETY
    // ====================================================
    console.log('\n--- GROUP 3: PROCUREMENT SOURCE RECONCILIATION & SAFETY ---');

    const sources = await prisma.procurementSource.findMany();
    const hasilpur = sources.find((s) => s.code === 'ZMCC-HASILPUR');
    const jhang = sources.find((s) => s.code === 'ZMCC-JHANG');
    const kabirwala = sources.find((s) => s.code === 'ZMCC-KABIRWALA');
    const alKhair = sources.find((s) => s.code === 'CONT-ALKHAIR');
    const imran = sources.find((s) => s.code === 'CONT-IMRAN');
    const alMehmood = sources.find((s) => s.code === 'CONT-ALMEHMOOD');

    assert(hasilpur?.name === 'ZMCC Hasilpur', 'LABEL-02A: ZMCC Hasilpur display name reconciled');
    assert(jhang?.name === 'ZMCC Jhang', 'LABEL-02B: ZMCC Jhang display name reconciled');
    assert(kabirwala?.name === 'ZMCC Kabirwala', 'LABEL-02C: ZMCC Kabirwala display name reconciled');
    assert(alKhair?.name === 'Al Khair Dairy', 'LABEL-03A: Al Khair Dairy display name reconciled');
    assert(imran?.name === 'Imran Mehmood', 'SOURCE-SAFE-A: Imran Mehmood preserved separately (not merged)');
    assert(alMehmood?.name === 'Al Mehmood Dairy', 'LABEL-03B: Al Mehmood Dairy seeded as distinct contractor');
    assert(sources.length === 6, 'SOURCE-SAFE-C: No duplicate ProcurementSource rows created (exact 6 sources)');

    // ====================================================
    // GROUP 4: REMEMBER ME & TTL CONSTANTS
    // ====================================================
    console.log('\n--- GROUP 4: REMEMBER ME & TTL CONSTANTS ---');

    assert(NORMAL_SESSION_TTL === 43200, 'REMEMBER-TTL-A: NORMAL_SESSION_TTL is 12 hours (43,200s)');
    assert(REMEMBERED_SESSION_TTL === 2592000, 'REMEMBER-TTL-B: REMEMBERED_SESSION_TTL is 30 days (2,592,000s)');

    const authFileContent = fs.readFileSync('D:/MilkReceptionApp/src/backend/core/auth.ts', 'utf-8');
    assert(authFileContent.includes("'30d'") && authFileContent.includes("'12h'"), 'REM-01 & 02: auth.ts sets JWT expiration matching session TTL');

    // ====================================================
    // GROUP 5: BUNDLE SECRET SAFETY & DEV PROFILES GATING
    // ====================================================
    console.log('\n--- GROUP 5: BUNDLE SECRET SAFETY & DEV PROFILES GATING ---');

    const devProfilesRouteContent = fs.readFileSync('D:/MilkReceptionApp/src/app/api/auth/dev-profiles/route.ts', 'utf-8');
    const hasDoubleGating = devProfilesRouteContent.includes("process.env.NODE_ENV !== 'production'") && devProfilesRouteContent.includes("NEXT_PUBLIC_ENABLE_DEV_LOGIN_PROFILES === 'true'");
    assert(hasDoubleGating, 'DEV-LOGIN-01 & 03: dev-profiles route enforces strict double gating');

    const loginPageContent = fs.readFileSync('D:/MilkReceptionApp/src/frontend/modules/auth/LoginPage.tsx', 'utf-8');
    const noHardcodedSecretInClient = !loginPageContent.includes('weighbridge123') && !loginPageContent.includes('admin123');
    assert(noHardcodedSecretInClient, 'BUNDLE-SECRET-A: LoginPage.tsx client code contains zero hardcoded credential secrets');

    console.log(`\n========================================`);
    console.log(`FINAL AUTH & DEV SELECTOR TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log(`========================================\n`);

    if (failed > 0) process.exit(1);
  } catch (err) {
    console.error('Error running auth & dev selector tests:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runFinalAuthAndDevSelectorTests();
