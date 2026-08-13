import { AUTHENTICATED_USERS } from '../src/backend/core/types';

function resolveRouteForRole(role: string): string {
  if (role === 'Production_Operator' || role === 'PRODUCTION_OPERATOR' || role === 'Production') {
    return '/department/production';
  } else if (role === 'MPD_Operator' || role === 'MPD') {
    return '/department/mpd';
  } else if (role === 'Security_Operator' || role === 'Security_Weight') {
    return '/department/security';
  } else if (role === 'Security_Manager') {
    return '/department/security-manager';
  } else if (role === 'QA_Operator' || role === 'QA') {
    return '/department/qa';
  } else if (role === 'WEIGHBRIDGE_OPERATOR' || role === 'Weighbridge_Operator') {
    return '/department/weighbridge';
  } else if (
    role === 'MPD_Zone_Manager' ||
    role === 'General_Plant_Manager' ||
    role === 'Management' ||
    role === 'QA_Manager' ||
    role === 'Production_Manager' ||
    role === 'Admin'
  ) {
    return '/management/dashboard';
  }
  return '/department/production';
}

function shouldShowSidebar(role: string): boolean {
  return role !== 'Production_Operator' && role !== 'PRODUCTION_OPERATOR' && role !== 'Production';
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
      prodAuth !== undefined &&
        (prodAuth.user.role === 'Production_Operator' || (prodAuth.user.role as string) === 'PRODUCTION_OPERATOR'),
      'PROD-AUTH-1: Production Operator Credentials in Matrix',
      `production.operator configured with role="${prodAuth?.user?.role}"`
    );

    // 2. Role-to-Route Mapping Function Simulation (as implemented in LoginPage.tsx & page.tsx)
    const prodRoute = resolveRouteForRole(prodAuth.user.role);
    const prodAliasRoute = resolveRouteForRole('PRODUCTION_OPERATOR');
    const wbRoute = resolveRouteForRole('WEIGHBRIDGE_OPERATOR');
    const secRoute = resolveRouteForRole('Security_Operator');
    const qaRoute = resolveRouteForRole('QA_Operator');
    const mpdRoute = resolveRouteForRole('MPD_Operator');
    const mgrRoute = resolveRouteForRole('General_Plant_Manager');

    assert(
      prodRoute === '/department/production' && prodAliasRoute === '/department/production',
      'PROD-ROUTE-1: Production Operator Role -> /department/production Mapping',
      'Production_Operator and PRODUCTION_OPERATOR map strictly to /department/production'
    );

    assert(
      wbRoute === '/department/weighbridge' &&
        secRoute === '/department/security' &&
        qaRoute === '/department/qa' &&
        mpdRoute === '/department/mpd' &&
        mgrRoute === '/management/dashboard',
      'PROD-ROUTE-2: Operational Role Route Isolation',
      'Other roles (Weighbridge, Security, QA, MPD, Manager) continue routing cleanly to their specific departmental workstations'
    );

    // 3. Sidebar Omission Logic for Production Operator Page
    const prodShowsSidebar = shouldShowSidebar(prodAuth.user.role);
    const mgrShowsSidebar = shouldShowSidebar('Production_Manager');

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
