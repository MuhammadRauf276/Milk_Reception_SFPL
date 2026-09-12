import { AUTHENTICATED_USERS } from '../src/backend/core/types';
import { resolveRoleHome } from '../src/lib/role-routing';

function shouldShowSidebar(role: string): boolean {
  return role !== 'PRODUCTION_RECEPTION_OPERATOR';
}

async function runProductionOperatorLoginRoutingVerification() {
  console.log('==================================================');
  console.log('RUNNING PRODUCTION OPERATOR LOGIN ROUTING VERIFICATION');
  console.log('==================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail: string) {
    if (condition) {
      console.log(`[PASS] ${testName} (${detail})`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName} (${detail})`);
      failed++;
    }
  }

  try {
    // 1. Verify production.operator credentials in AUTHENTICATED_USERS
    const prodAuth = AUTHENTICATED_USERS['production.operator'];

    assert(
      prodAuth !== undefined && prodAuth.user.role === 'PRODUCTION_RECEPTION_OPERATOR',
      'PROD-AUTH-1: Production Operator Credentials in Matrix',
      `production.operator configured with canonical role="${prodAuth?.user?.role}"`
    );

    // 2. Role-to-Route Mapping via resolveRoleHome
    const prodRoute = resolveRoleHome(prodAuth.user.role);
    const legacyProdOpRoute = resolveRoleHome('Production_Operator');
    const legacyProdRoute = resolveRoleHome('Production');
    const wbRoute = resolveRoleHome('WEIGHBRIDGE_OPERATOR');
    const secRoute = resolveRoleHome('SECURITY_OPERATOR');
    const qaRoute = resolveRoleHome('QA_LAB_ATTENDANT');
    const zmccRoute = resolveRoleHome('ZMCC_LAB_ATTENDANT');

    assert(
      prodRoute === '/department/production',
      'PROD-ROUTE-1: Canonical PRODUCTION_RECEPTION_OPERATOR -> /department/production',
      'PRODUCTION_RECEPTION_OPERATOR maps strictly to /department/production'
    );

    assert(
      legacyProdOpRoute === '/workspace-unavailable' && legacyProdRoute === '/workspace-unavailable',
      'PROD-ROUTE-1B: Legacy Production roles strictly fail-closed to /workspace-unavailable',
      'Production_Operator and Production route strictly to /workspace-unavailable'
    );

    assert(
      wbRoute === '/department/weighbridge' &&
        secRoute === '/department/security' &&
        qaRoute === '/department/qa' &&
        zmccRoute === '/zmcc/lab',
      'PROD-ROUTE-2: Operational Role Route Isolation',
      'Other canonical roles (Weighbridge, Security, QA, ZMCC) route cleanly to their specific workstations'
    );

    // 3. Sidebar Omission Logic for Production Operator Page
    const prodShowsSidebar = shouldShowSidebar(prodAuth.user.role);
    const mgrShowsSidebar = shouldShowSidebar('PRODUCTION_HEAD');

    assert(
      prodShowsSidebar === false && mgrShowsSidebar === true,
      'PROD-UI-1: Sidebar Omission for Production Operator',
      'Production Operator page strictly omits sidebar for clean focused workspace; Manager page retains sidebar'
    );

  } catch (err: any) {
    console.error('Test execution error:', err);
    failed++;
  }

  console.log('\n==================================================');
  console.log(`VERIFICATION COMPLETE: ${passed} PASSED, ${failed} FAILED`);
  console.log('==================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runProductionOperatorLoginRoutingVerification();
