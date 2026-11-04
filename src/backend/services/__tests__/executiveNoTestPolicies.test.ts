import test from 'node:test';
import assert from 'node:assert/strict';
import { canSeeTestPolicies, isTestPolicyPath } from '@/lib/test-policy-access';
import { getRoleNavSections, type RoleNavSection } from '@/frontend/modules/shared/navigation/roleNavConfig';
import { assertCanReadAdminPolicies, assertCanReadEffectivePolicy } from '../milkTestPolicyService';
import type { User } from '@core/types';

const hrefs = (sections: RoleNavSection[]): string[] =>
  sections.flatMap((s) => [s.href ?? '', ...(s.children ?? []).map((c) => c.href ?? '')]).filter(Boolean);
const navFor = (role: string) => hrefs(getRoleNavSections({ role } as unknown as User));

test('Senior Executive Management has no test policy link; the Command Center stays', () => {
  const links = navFor('EXECUTIVE_MANAGEMENT');
  assert.equal(links.includes('/command?view=POLICIES'), false);
  assert.equal(links.some(isTestPolicyPath), false);
  assert.equal(links.includes('/command?view=FLEET_RADAR'), true);
});

test('MPD Head keeps the Testing Policies link; Data Executive keeps Lab Policies', () => {
  assert.equal(navFor('HEAD_OF_MPD').includes('/command?view=POLICIES'), true);
  assert.equal(navFor('DATA_EXECUTIVE').includes('/super-admin/test-policies'), true);
});

test('access rule: only Senior Executive Management is shut out', () => {
  assert.equal(canSeeTestPolicies('EXECUTIVE_MANAGEMENT'), false);
  for (const role of ['SUPER_ADMIN', 'DATA_EXECUTIVE', 'HEAD_OF_MPD', 'QA_HEAD']) assert.equal(canSeeTestPolicies(role), true, role);
});

test('every test policy page path is recognised, and other admin pages are not', () => {
  for (const p of ['/super-admin/test-policies', '/super-admin/sop-rules', '/super-admin/lab-tests', '/super-admin/test-point-policies']) assert.equal(isTestPolicyPath(p), true, p);
  for (const p of ['/super-admin', '/super-admin/hierarchy-work', '/super-admin/reports', '/command']) assert.equal(isTestPolicyPath(p), false, p);
});

test('the policy read guards refuse Senior Executive Management', () => {
  assert.throws(() => assertCanReadAdminPolicies('EXECUTIVE_MANAGEMENT'), /not authorized/);
  assert.throws(() => assertCanReadEffectivePolicy('EXECUTIVE_MANAGEMENT', 'PLANT_QA'), /not authorized/);
});
