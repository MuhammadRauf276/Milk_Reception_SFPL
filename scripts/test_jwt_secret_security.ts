import { createSessionToken, verifySessionToken, getCurrentUser } from '../src/backend/core/auth';
import { DEFAULT_USERS } from '../src/backend/core/types';
import { POST as loginRoute } from '../src/app/api/auth/login/route';
import { NextRequest } from 'next/server';

async function runJwtSecretTests() {
  console.log('==================================================');
  console.log('RUNNING HARDCODED JWT SECRET REMOVAL SECURITY TESTS');
  console.log('==================================================\n');

  const ORIGINAL_SECRET = process.env.JWT_SECRET;

  // Test A — JWT_SECRET Present
  console.log('Test A — JWT_SECRET Present:');
  process.env.JWT_SECRET = 'valid-test-secret-key-for-jwt-2026';
  const testUser = DEFAULT_USERS.MPD_Operator;
  let tokenA = '';
  try {
    tokenA = await createSessionToken(testUser);
    console.log('Token Creation: ✅ SUCCEEDED');
  } catch (err: any) {
    console.log(`Token Creation: ❌ FAILED (${err.message})`);
  }
  const verifiedA = await verifySessionToken(tokenA);
  console.log(`Token Verification: ${verifiedA && verifiedA.username === testUser.username ? '✅ SUCCEEDED' : '❌ FAILED'}`);
  const passA = !!tokenA && verifiedA?.username === testUser.username;
  console.log(`Test A Result: ${passA ? '✅ PASS' : '❌ FAIL'}\n`);

  // Test B — JWT_SECRET Missing (Temporarily Unset)
  console.log('Test B — JWT_SECRET Missing (Unset):');
  delete process.env.JWT_SECRET;
  let tokenBFailed = false;
  try {
    await createSessionToken(testUser);
    console.log('Token Creation: ❌ SILENTLY SUCCEEDED WITH FALLBACK (VULNERABILITY DETECTED)');
  } catch (err: any) {
    console.log(`Token Creation: ✅ SAFELY REJECTED (${err.message})`);
    tokenBFailed = true;
  }
  const verifiedB = await verifySessionToken(tokenA);
  console.log(`Token Verification: ${verifiedB === null ? '✅ SAFELY RETURNED NULL' : '❌ ACCEPTED TOKEN WITHOUT SECRET'}`);
  const passB = tokenBFailed && verifiedB === null;
  console.log(`Test B Result: ${passB ? '✅ PASS' : '❌ FAIL'}\n`);

  // Test C — JWT_SECRET Empty ("")
  console.log('Test C — JWT_SECRET Empty (""):');
  process.env.JWT_SECRET = '   ';
  let tokenCFailed = false;
  try {
    await createSessionToken(testUser);
    console.log('Token Creation: ❌ SILENTLY SUCCEEDED WITH EMPTY SECRET');
  } catch (err: any) {
    console.log(`Token Creation: ✅ SAFELY REJECTED (${err.message})`);
    tokenCFailed = true;
  }
  const verifiedC = await verifySessionToken(tokenA);
  console.log(`Token Verification: ${verifiedC === null ? '✅ SAFELY RETURNED NULL' : '❌ ACCEPTED TOKEN WITH EMPTY SECRET'}`);
  const passC = tokenCFailed && verifiedC === null;
  console.log(`Test C Result: ${passC ? '✅ PASS' : '❌ FAIL'}\n`);

  // Test D — Invalid JWT string with valid secret
  console.log('Test D — Invalid JWT String:');
  process.env.JWT_SECRET = 'valid-test-secret-key-for-jwt-2026';
  const verifiedD = await verifySessionToken('invalid.malformed.jwt.token');
  console.log(`Verification Result: ${verifiedD === null ? '✅ SAFELY RETURNED NULL' : '❌ FAILED'}`);
  const passD = verifiedD === null;
  console.log(`Test D Result: ${passD ? '✅ PASS' : '❌ FAIL'}\n`);

  // Test E — Regressions Check
  console.log('Test E — Regressions Check:');
  // 1. Role-only login rejection
  const reqRoleOnly = new NextRequest('http://localhost:3000/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ role: 'MPD_Operator' }),
  });
  const resRoleOnly = await loginRoute(reqRoleOnly);
  const passRoleOnly = resRoleOnly.status === 400;

  // 2. Valid login creates token
  const reqValidLogin = new NextRequest('http://localhost:3000/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'zmcc.operator', password: 'mpd123' }),
  });
  const resValidLogin = await loginRoute(reqValidLogin);
  const passValidLogin = resValidLogin.status === 200 && !!resValidLogin.cookies.get('auth_token');

  console.log(`Role-only login rejected: ${passRoleOnly ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Valid login succeeds: ${passValidLogin ? '✅ PASS' : '❌ FAIL'}`);
  const passE = passRoleOnly && passValidLogin;
  console.log(`Test E Result: ${passE ? '✅ PASS' : '❌ FAIL'}\n`);

  // Restore original environment secret
  if (ORIGINAL_SECRET) {
    process.env.JWT_SECRET = ORIGINAL_SECRET;
  }
}

runJwtSecretTests().catch(console.error);
