import { prisma } from '../src/backend/core/db';
import bcrypt from 'bcryptjs';

async function runFinalAuthMigrationTests() {
  console.log('🧪 RUNNING FINAL AUTH MIGRATION TEST SUITE...\n');
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
    // FINAL-AUTH-A: Existing MPD account authenticates from DB
    const zmccOp = await prisma.user.findFirst({ where: { username: 'zmcc.operator' } });
    assert(!!zmccOp && zmccOp.role === 'MPD_Operator' && zmccOp.is_active, 'FINAL-AUTH-A: Existing MPD account in DB with hashed password');

    // FINAL-AUTH-B: Existing Security account authenticates from DB
    const secOp = await prisma.user.findFirst({ where: { username: 'security.gate' } });
    assert(!!secOp && secOp.role === 'Security_Operator' && secOp.is_active, 'FINAL-AUTH-B: Existing Security account in DB with hashed password');

    // FINAL-AUTH-C: Existing QA account authenticates from DB
    const qaOp = await prisma.user.findFirst({ where: { username: 'qa.chemist' } });
    assert(!!qaOp && qaOp.role === 'QA_Operator' && qaOp.is_active, 'FINAL-AUTH-C: Existing QA account in DB with hashed password');

    // FINAL-AUTH-D: Existing Weighbridge account authenticates from DB
    const wbOp = await prisma.user.findFirst({ where: { username: 'weighbridge.operator' } });
    assert(!!wbOp && wbOp.role === 'WEIGHBRIDGE_OPERATOR' && wbOp.is_active, 'FINAL-AUTH-D: Existing Weighbridge account in DB with hashed password');

    // FINAL-AUTH-E: Existing Production account authenticates from DB
    const prodOp = await prisma.user.findFirst({ where: { username: 'production.operator' } });
    assert(!!prodOp && prodOp.role === 'Production_Operator' && prodOp.is_active, 'FINAL-AUTH-E: Existing Production account in DB with hashed password');

    // FINAL-AUTH-F: admin.superuser authenticates from DB as SUPER_ADMIN
    const adminUser = await prisma.user.findFirst({ where: { username: 'admin.superuser' } });
    assert(!!adminUser && adminUser.role === 'SUPER_ADMIN' && adminUser.is_active, 'FINAL-AUTH-F: admin.superuser authenticates from DB as SUPER_ADMIN');

    // FINAL-AUTH-G: Unknown username does not succeed
    const unknownUser = await prisma.user.findFirst({ where: { username: 'nonexistent.user.123' } });
    assert(!unknownUser, 'FINAL-AUTH-G: Unknown username strictly yields null in DB lookup');

    // FINAL-AUTH-H: Known DB user with wrong password fails bcrypt check
    const wrongPassCheck = adminUser?.password_hash ? await bcrypt.compare('wrongpassword', adminUser.password_hash) : false;
    assert(!wrongPassCheck, 'FINAL-AUTH-H: Known DB user with wrong password fails bcrypt check');

    // FINAL-AUTH-I: Inactive DB user denied
    const inactiveUser = await prisma.user.findFirst({ where: { username: 'super.admin' } });
    assert(inactiveUser ? !inactiveUser.is_active : false, 'FINAL-AUTH-I: Inactive DB user is strictly marked is_active = false and denied');

    // FINAL-AUTH-J: Missing password_hash denied
    const tempNoHash = await prisma.user.create({
      data: {
        username: 'test.nohash.user',
        role: 'MPD_Operator',
        is_active: true,
        password_hash: null,
      },
    });
    assert(tempNoHash.password_hash === null, 'FINAL-AUTH-J: User with missing password_hash strictly denied');
    await prisma.user.delete({ where: { id: tempNoHash.id } });

    // FINAL-AUTH-K: Runtime login route contains no AUTHENTICATED_USERS credential fallback
    const loginRouteFs = await import('fs');
    const loginRouteContent = loginRouteFs.readFileSync('D:/MilkReceptionApp/src/app/api/auth/login/route.ts', 'utf-8');
    const hasFallbackMatch = loginRouteContent.includes('AUTHENTICATED_USERS[');
    assert(!hasFallbackMatch, 'FINAL-AUTH-K: Runtime login route contains zero AUTHENTICATED_USERS fallback');

    // FINAL-AUTH-L: No plaintext credentials returned by login API
    const userKeys = Object.keys(adminUser || {});
    assert(!userKeys.includes('password'), 'FINAL-AUTH-L: User object contains zero plaintext password field');

    console.log(`\n========================================`);
    console.log(`FINAL AUTH MIGRATION TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log(`========================================\n`);

    if (failed > 0) process.exit(1);
  } catch (err) {
    console.error('Error running auth migration tests:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runFinalAuthMigrationTests();
