// Who may see the test policy screens (Lab Policies, Testing Policies, SOP rules). Client-safe.
const TEST_POLICY_PATHS = ['/super-admin/test-policies', '/super-admin/sop-rules', '/super-admin/lab-tests', '/super-admin/test-point-policies'];

/** Senior Executive Management has no access to test policies, not even to read them. */
export function canSeeTestPolicies(role: string | null | undefined): boolean {
  return (role ?? '').trim() !== 'EXECUTIVE_MANAGEMENT';
}

export function isTestPolicyPath(pathname: string | null | undefined): boolean {
  return TEST_POLICY_PATHS.some((p) => pathname === p || pathname?.startsWith(`${p}/`));
}
