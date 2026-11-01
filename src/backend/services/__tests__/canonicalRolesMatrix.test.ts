import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@/backend/core/db';
import { createSessionToken, verifySessionToken } from '@/backend/core/auth';
import { CANONICAL_ROLES } from '@/backend/core/roles/hierarchy';
import { ROLE_ACCESS_POLICIES } from '@/backend/modules/access-control/rolePolicies';
import { CAPABILITIES, type Capability } from '@/backend/modules/access-control/capabilities';
import { requireCapability } from '@/backend/modules/access-control/serverGuard';
import type { ResourceScope } from '@/backend/modules/access-control/scopes';
import { resolveRoleHome } from '@/lib/role-routing';
import type { Role, User } from '@/backend/core/types';

const APPROVED_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const APPROVED_DB_NAMES = new Set([
  'milk_reception_test',
  'milk_reception_test_db',
  'milk_reception_dev',
  'milk_reception_db',
  'sfpl_milk_test',
]);

function assertTestDatabaseSafety() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error('DATABASE_URL is not set.');
  const parsed = new URL(dbUrl);
  const host = parsed.hostname.toLowerCase();
  const dbName = parsed.pathname.replace(/^\//, '').split('?')[0].toLowerCase();

  if (!APPROVED_HOSTS.has(host) || !APPROVED_DB_NAMES.has(dbName)) {
    throw new Error(`SAFETY REFUSAL: Tests cannot run against unverified host ${host} or db ${dbName}`);
  }
}

test('canonicalRolesMatrix: CANONICAL_ROLES contains exactly 19 roles with defined policies', () => {
  assert.equal(CANONICAL_ROLES.length, 19, 'There must be exactly 19 canonical roles');
  for (const role of CANONICAL_ROLES) {
    assert.ok(ROLE_ACCESS_POLICIES[role], `Role ${role} must have a defined ROLE_ACCESS_POLICY`);
    assert.ok(
      ROLE_ACCESS_POLICIES[role].capabilities.length > 0,
      `Role ${role} must possess at least one capability`
    );
  }
});

test('canonicalRolesMatrix: resolveRoleHome returns valid landing routes for all 19 roles', () => {
  for (const role of CANONICAL_ROLES) {
    const home = resolveRoleHome(role);
    assert.ok(home, `Role ${role} must have a resolved home route`);
    assert.ok(home.startsWith('/'), `Home route for ${role} must start with /`);
    assert.notEqual(
      home,
      '/workspace-unavailable',
      `Canonical role ${role} must never resolve to /workspace-unavailable`
    );
  }

  // Retired role QA_MANAGER must resolve to retired warning page
  const retiredHome = resolveRoleHome('QA_MANAGER');
  assert.equal(
    retiredHome,
    '/workspace-unavailable?reason=retired&role=QA_MANAGER',
    'QA_MANAGER must resolve to retired workspace notice'
  );

  // Unknown role must resolve to unavailable
  assert.equal(
    resolveRoleHome('NON_EXISTENT_ROLE'),
    '/workspace-unavailable',
    'Unknown role must resolve to /workspace-unavailable'
  );
});

test('canonicalRolesMatrix: Token creation, verification, and live auth across all 19 canonical roles', async () => {
  assertTestDatabaseSafety();

  const runId = `CRTEST-${Date.now()}`;

  for (const role of CANONICAL_ROLES) {
    // 1. Find or create an active database user for this role
    let dbUser = await prisma.user.findFirst({
      where: { role, is_active: true },
      include: { procurement_source: true },
    });

    let createdSynthetic = false;
    if (!dbUser) {
      dbUser = await prisma.user.create({
        data: {
          username: `synth_${role.toLowerCase().slice(0, 10)}_${Date.now().toString().slice(-4)}`,
          full_name: `Synthetic ${role}`,
          role,
          department: 'Operations',
          is_active: true,
        },
        include: { procurement_source: true },
      });
      createdSynthetic = true;
    }

    try {
      const userPayload: User = {
        id: dbUser.id.toString(),
        username: dbUser.username,
        name: dbUser.full_name || dbUser.username,
        role: dbUser.role as Role,
        department: dbUser.department || 'Operations',
        scope_type: dbUser.scope_type || 'DEPARTMENT',
        procurement_source_id: dbUser.procurement_source_id ? dbUser.procurement_source_id.toString() : null,
      };

      // 2. Token creation
      const token = await createSessionToken(userPayload);
      assert.ok(token, `Session token for ${role} must be created`);

      // 3. Token verification
      const verified = await verifySessionToken(token);
      assert.ok(verified, `Token for ${role} must verify successfully`);
      assert.equal(verified.id, userPayload.id);
      assert.equal(verified.role, role);
      assert.equal(verified.username, userPayload.username);

      // 4. Authorized capability check
      const policy = ROLE_ACCESS_POLICIES[role];
      const authorizedCap = policy.capabilities[0];

      let matchingScope: ResourceScope;
      if (policy.scopeKind === 'SYSTEM') {
        matchingScope = { kind: 'SYSTEM' };
      } else if (policy.scopeKind === 'DEPARTMENT') {
        matchingScope = { kind: 'DEPARTMENT', departmentId: dbUser.department || 'Operations' };
      } else {
        const sourceId = dbUser.procurement_source_id?.toString() || '1';
        matchingScope = { kind: 'SOURCE', sourceId };
      }

      const reqAuth = new Request('http://localhost:3000/api/test-auth', {
        headers: { authorization: `Bearer ${token}` },
      });

      const authAccess = await requireCapability(authorizedCap, matchingScope, { request: reqAuth });
      assert.equal(
        authAccess.allowed,
        true,
        `Role ${role} must be authorized for granted capability ${authorizedCap}`
      );

      // 5. Unauthorized capability rejection
      const unauthCap = CAPABILITIES.find((c) => !(policy.capabilities as readonly string[]).includes(c));
      if (unauthCap) {
        const reqUnauth = new Request('http://localhost:3000/api/test-auth', {
          headers: { authorization: `Bearer ${token}` },
        });

        const unauthAccess = await requireCapability(unauthCap, matchingScope, { request: reqUnauth });
        assert.equal(
          unauthAccess.allowed,
          false,
          `Role ${role} must NOT be authorized for unassigned capability ${unauthCap}`
        );
        assert.equal(unauthAccess.status, 403);
        assert.equal(unauthAccess.code, 'MISSING_CAPABILITY');
      }
    } finally {
      if (createdSynthetic && dbUser) {
        await prisma.user.delete({ where: { id: dbUser.id } }).catch(() => {});
      }
    }
  }
});

test('canonicalRolesMatrix: Deactivated user is rejected immediately with 401', async () => {
  assertTestDatabaseSafety();

  const runId = `INACT-${Date.now()}`;
  const inactiveUser = await prisma.user.create({
    data: {
      username: `synth_inactive_${runId}`,
      full_name: 'Synthetic Inactive Operator',
      role: 'SECURITY_OPERATOR',
      department: 'Security',
      is_active: false, // DEACTIVATED
    },
  });

  try {
    const token = await createSessionToken({
      id: inactiveUser.id.toString(),
      username: inactiveUser.username,
      name: inactiveUser.full_name || inactiveUser.username,
      role: inactiveUser.role as Role,
      department: 'Security',
    });

    const req = new Request('http://localhost:3000/api/test-auth', {
      headers: { authorization: `Bearer ${token}` },
    });

    const access = await requireCapability('VIEW', { kind: 'DEPARTMENT', departmentId: 'Security' }, { request: req });
    assert.equal(access.allowed, false, 'Inactive user must be denied access');
    assert.equal(access.status, 401, 'Inactive user must return 401 Authentication Required');
    assert.equal(access.code, 'AUTHENTICATION_REQUIRED');
  } finally {
    await prisma.user.delete({ where: { id: inactiveUser.id } }).catch(() => {});
  }
});

test('canonicalRolesMatrix: Retired role QA_MANAGER is rejected with UNSUPPORTED_ROLE (403)', async () => {
  assertTestDatabaseSafety();

  const runId = `RETIRED-${Date.now()}`;
  const retiredUser = await prisma.user.create({
    data: {
      username: `synth_retired_${runId}`,
      full_name: 'Synthetic Retired QA Manager',
      role: 'QA_MANAGER',
      department: 'QA',
      is_active: true,
    },
  });

  try {
    const token = await createSessionToken({
      id: retiredUser.id.toString(),
      username: retiredUser.username,
      name: retiredUser.full_name || retiredUser.username,
      role: retiredUser.role as Role,
      department: 'QA',
    });

    const req = new Request('http://localhost:3000/api/test-auth', {
      headers: { authorization: `Bearer ${token}` },
    });

    const access = await requireCapability('VIEW', { kind: 'DEPARTMENT', departmentId: 'QA' }, { request: req });
    assert.equal(access.allowed, false, 'Retired role QA_MANAGER must be denied access');
    assert.equal(access.status, 403, 'Retired role must return 403 Forbidden');
    assert.equal(access.code, 'UNSUPPORTED_ROLE');
  } finally {
    await prisma.user.delete({ where: { id: retiredUser.id } }).catch(() => {});
  }
});
