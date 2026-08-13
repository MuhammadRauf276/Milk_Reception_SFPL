import { POST as loginRoute } from '../src/app/api/auth/login/route';
import { NextRequest } from 'next/server';
import { verifySessionToken } from '../src/backend/core/auth';

async function runRoleLoginTests() {
  console.log('==================================================');
  console.log('RUNNING AUTHENTICATION ROLE-ONLY BYPASS TESTS');
  console.log('==================================================\n');

  // Test A — Role only
  console.log('Test A — Role Only Request: { "role": "MPD_Operator" }');
  const reqA = new NextRequest('http://localhost:3000/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ role: 'MPD_Operator' }),
  });
  const resA = await loginRoute(reqA);
  const dataA = await resA.json();
  const cookieA = resA.cookies.get('auth_token');
  console.log(`Status: ${resA.status} (Expected: 400 or 401)`);
  console.log(`Error Response: ${dataA.error}`);
  console.log(`Cookie Issued: ${cookieA ? 'YES ❌' : 'NO ✅'}`);
  const passA = (resA.status === 400 || resA.status === 401) && !cookieA;
  console.log(`Test A Result: ${passA ? '✅ PASS' : '❌ FAIL'}\n`);

  // Test B — Invalid credentials
  console.log('Test B — Invalid Credentials: { "username": "zmcc.operator", "password": "wrongpassword" }');
  const reqB = new NextRequest('http://localhost:3000/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'zmcc.operator', password: 'wrongpassword' }),
  });
  const resB = await loginRoute(reqB);
  const dataB = await resB.json();
  const cookieB = resB.cookies.get('auth_token');
  console.log(`Status: ${resB.status} (Expected: 401)`);
  console.log(`Error Response: ${dataB.error}`);
  console.log(`Cookie Issued: ${cookieB ? 'YES ❌' : 'NO ✅'}`);
  const passB = resB.status === 401 && !cookieB;
  console.log(`Test B Result: ${passB ? '✅ PASS' : '❌ FAIL'}\n`);

  // Test C — Valid existing credentials
  console.log('Test C — Valid Credentials: { "username": "zmcc.operator", "password": "mpd123" }');
  const reqC = new NextRequest('http://localhost:3000/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'zmcc.operator', password: 'mpd123' }),
  });
  const resC = await loginRoute(reqC);
  const dataC = await resC.json();
  const cookieC = resC.cookies.get('auth_token');
  console.log(`Status: ${resC.status} (Expected: 200)`);
  console.log(`Authenticated Username: ${dataC.user?.username}`);
  console.log(`Authenticated Role: ${dataC.user?.role}`);
  console.log(`Cookie Issued: ${cookieC ? 'YES ✅' : 'NO ❌'}`);
  const passC = resC.status === 200 && cookieC && dataC.user?.username === 'zmcc.operator';
  console.log(`Test C Result: ${passC ? '✅ PASS' : '❌ FAIL'}\n`);

  // Test D — Role manipulation attempt
  console.log('Test D — Role Manipulation Attempt: { "username": "zmcc.operator", "password": "mpd123", "role": "Admin" }');
  const reqD = new NextRequest('http://localhost:3000/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'zmcc.operator', password: 'mpd123', role: 'Admin' }),
  });
  const resD = await loginRoute(reqD);
  const dataD = await resD.json();
  const cookieD = resD.cookies.get('auth_token')?.value;
  let verifiedRoleFromJWT: string | undefined;
  if (cookieD) {
    const verified = await verifySessionToken(cookieD);
    verifiedRoleFromJWT = verified?.role;
  }
  console.log(`Status: ${resD.status} (Expected: 200)`);
  console.log(`Authenticated User Role in Response: ${dataD.user?.role}`);
  console.log(`Verified Role stored inside JWT: ${verifiedRoleFromJWT}`);
  const passD = resD.status === 200 && dataD.user?.role === 'MPD_Operator' && verifiedRoleFromJWT === 'MPD_Operator';
  console.log(`Test D Result: ${passD ? '✅ PASS (Client role ignored, user role enforced)' : '❌ FAIL'}\n`);
}

runRoleLoginTests().catch(console.error);
