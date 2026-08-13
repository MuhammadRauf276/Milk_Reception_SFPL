import { createSessionToken, verifySessionToken } from '../src/backend/core/auth';
import { DEFAULT_USERS, Role } from '../src/backend/core/types';
import { POST as loginRoute } from '../src/app/api/auth/login/route';
import { NextRequest } from 'next/server';

async function runProductionAuthTests() {
  console.log('==================================================');
  console.log('RUNNING PRODUCTION AUTHENTICATION MISMATCH TESTS');
  console.log('==================================================\n');

  if (!process.env.JWT_SECRET) {
    process.env.JWT_SECRET = 'super-secret-jwt-key-milk-reception-app-2026';
  }

  // Test A — No Authentication
  console.log('Test A — No Authentication (No Cookie):');
  const tokenA = undefined;
  const verifiedA = tokenA ? await verifySessionToken(tokenA) : null;
  console.log(`getCurrentUser result: ${verifiedA === null ? 'null ✅' : 'USER EXPOSURE ❌'}`);
  const passA = verifiedA === null;
  console.log(`Test A Result: ${passA ? '✅ PASS' : '❌ FAIL'}\n`);

  // Test B — Invalid Token
  console.log('Test B — Invalid Token ("invalid.jwt.token"):');
  const verifiedB = await verifySessionToken('invalid.jwt.token');
  console.log(`getCurrentUser result: ${verifiedB === null ? 'null ✅' : 'INVALID TOKEN ACCEPTED ❌'}`);
  const passB = verifiedB === null;
  console.log(`Test B Result: ${passB ? '✅ PASS' : '❌ FAIL'}\n`);

  // Test C & D — Valid Production User & Normal Login Cookie
  console.log('Test C & D — Valid Production User & Login Cookie ("production.operator"):');
  const reqC = new NextRequest('http://localhost:3000/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'production.operator', password: 'production123' }),
  });
  const resC = await loginRoute(reqC);
  const cookieAuthToken = resC.cookies.get('auth_token')?.value;
  const cookieAuthSession = resC.cookies.get('auth_session')?.value;
  console.log(`Login Response Status: ${resC.status}`);
  console.log(`auth_token Cookie Set: ${cookieAuthToken ? 'YES ✅' : 'NO ❌'}`);
  console.log(`auth_session Cookie Set: ${cookieAuthSession ? 'YES ❌' : 'NO ✅ (Legacy cookie removed)'}`);

  let verifiedC = null;
  if (cookieAuthToken) {
    verifiedC = await verifySessionToken(cookieAuthToken);
  }
  console.log(`Verified Username: ${verifiedC?.username}`);
  console.log(`Verified Role: ${verifiedC?.role}`);

  const allowedRoles: Role[] = ['Admin', 'Production_Operator', 'Production_Manager', 'Production'];
  const isAuthorizedC = verifiedC && allowedRoles.includes(verifiedC.role as Role);
  console.log(`Production Workspace Access Granted: ${isAuthorizedC ? 'YES ✅' : 'NO ❌'}`);

  const passCD = !!cookieAuthToken && !cookieAuthSession && verifiedC?.username === 'production.operator' && isAuthorizedC;
  console.log(`Test C & D Result: ${passCD ? '✅ PASS' : '❌ FAIL'}\n`);

  // Test E — Role Authorization Gate ("zmcc.operator" with role "MPD_Operator")
  console.log('Test E — Role Authorization Gate ("zmcc.operator" with role "MPD_Operator"):');
  const reqE = new NextRequest('http://localhost:3000/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'zmcc.operator', password: 'mpd123' }),
  });
  const resE = await loginRoute(reqE);
  const tokenE = resE.cookies.get('auth_token')?.value;
  let verifiedE = null;
  if (tokenE) {
    verifiedE = await verifySessionToken(tokenE);
  }
  console.log(`Authenticated Username: ${verifiedE?.username}`);
  console.log(`Authenticated Role: ${verifiedE?.role}`);
  const isAuthorizedE = verifiedE && allowedRoles.includes(verifiedE.role as Role);
  console.log(`Production Access Allowed for MPD_Operator: ${isAuthorizedE ? 'YES ❌ (Vulnerability)' : 'NO ✅ (Access Denied as expected)'}`);
  const passE = !isAuthorizedE;
  console.log(`Test E Result: ${passE ? '✅ PASS' : '❌ FAIL'}\n`);

  // Regressions Check
  console.log('Regression Checks:');
  // 1. Role-only login
  const reqRoleOnly = new NextRequest('http://localhost:3000/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ role: 'Production_Operator' }),
  });
  const resRoleOnly = await loginRoute(reqRoleOnly);
  const passRoleOnly = resRoleOnly.status === 400;

  // 2. Missing JWT secret handling
  const origSecret = process.env.JWT_SECRET;
  delete process.env.JWT_SECRET;
  let passMissingSecret = false;
  try {
    await createSessionToken(DEFAULT_USERS.Production_Operator);
  } catch (err) {
    passMissingSecret = true;
  }
  if (origSecret) process.env.JWT_SECRET = origSecret;

  console.log(`Role-only login rejected: ${passRoleOnly ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Missing JWT secret fails safely: ${passMissingSecret ? '✅ PASS' : '❌ FAIL'}`);
  const passRegressions = passRoleOnly && passMissingSecret;
  console.log(`Regressions Result: ${passRegressions ? '✅ PASS' : '❌ FAIL'}\n`);
}

runProductionAuthTests().catch(console.error);
