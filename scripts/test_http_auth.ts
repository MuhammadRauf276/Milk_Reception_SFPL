import { GET as getDispatches } from '../src/app/api/dispatches/route';
import { GET as getQaSearch } from '../src/app/api/qa/vehicle-visits/search/route';
import { GET as getScaleReady } from '../src/app/api/scale/ready-for-gross/route';
import { GET as getMe } from '../src/app/api/auth/me/route';
import { createSessionToken } from '../src/backend/core/auth';
import { DEFAULT_USERS } from '../src/backend/core/types';

async function testHttpAuth() {
  console.log('Testing Route Handlers with No Cookies / Invalid Token / Valid Token...\n');

  // 1. Test GET /api/auth/me with no cookies
  const meRes = await getMe();
  const meData = await meRes.json();
  console.log(`GET /api/auth/me (No Cookies) -> user: ${meData.user === null ? 'null ✅' : meData.user}`);

  // 2. Test GET /api/dispatches with no cookies
  const reqDisp = new Request('http://localhost:3000/api/dispatches');
  const dispRes = await getDispatches(reqDisp);
  console.log(`GET /api/dispatches (No Cookies) -> Status: ${dispRes.status} (Expected: 401) ${dispRes.status === 401 ? '✅ PASS' : '❌ FAIL'}`);

  // 3. Test GET /api/qa/vehicle-visits/search with no cookies
  const reqNoAuth = new Request('http://localhost:3000/api/qa/vehicle-visits/search');
  const qaRes = await getQaSearch(reqNoAuth);
  console.log(`GET /api/qa/vehicle-visits/search (No Cookies) -> Status: ${qaRes.status} (Expected: 401) ${qaRes.status === 401 ? '✅ PASS' : '❌ FAIL'}`);

  // 4. Test GET /api/scale/ready-for-gross with no cookies
  const scaleRes = await getScaleReady(reqNoAuth);
  console.log(`GET /api/scale/ready-for-gross (No Cookies) -> Status: ${scaleRes.status} (Expected: 401) ${scaleRes.status === 401 ? '✅ PASS' : '❌ FAIL'}`);
}

testHttpAuth().catch(console.error);
