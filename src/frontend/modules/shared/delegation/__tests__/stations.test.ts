import test from 'node:test';
import assert from 'node:assert/strict';
import type { User, Role } from '@/backend/core/types';
import {
  getTeamStationsForRole,
  resolveDelegationContext,
} from '../stations';
import { getRoleNavSections } from '../../navigation/roleNavConfig';

function mockUser(role: string, name = 'Test User', sourceName?: string): User {
  return {
    id: '100',
    username: 'testuser',
    name,
    role: role as Role,
    department: 'Test Dept',
    scope_type: 'SYSTEM',
    procurement_source_id: sourceName ? '1' : null,
    procurement_source: sourceName
      ? {
          id: '1',
          code: 'ZMCC-01',
          name: sourceName,
          source_type: 'ZMCC',
          is_active: true,
        }
      : null,
  };
}

test('Role Testing Matrix: HEAD_OF_MPD team stations derivation and grouping', () => {
  const stations = getTeamStationsForRole('HEAD_OF_MPD');
  const labels = stations.map((s) => s.label);

  // Must include ZMCC stations and Contractor dispatch
  assert.ok(labels.includes('Zonal Lab'));
  assert.ok(labels.includes('PHE Milk Reception'));
  assert.ok(labels.includes('MOT Mobile Journey'));
  assert.ok(labels.includes('Tanker Dispatch'));
  assert.ok(labels.includes('MDO Field Operations'));
  assert.ok(labels.includes('Contractor Dispatch'));

  // Must NOT include Plant stations (under Production Head & QA Head)
  assert.ok(!labels.includes('Weighbridge'));
  assert.ok(!labels.includes('Silo Unloading'));
  assert.ok(!labels.includes('Plant Reception Lab'));

  // Groups must be set for wide-group roles
  const zmccStation = stations.find((s) => s.label === 'Zonal Lab');
  assert.equal(zmccStation?.group, 'ZMCC Operations');

  const contractorStation = stations.find((s) => s.label === 'Contractor Dispatch');
  assert.equal(contractorStation?.group, 'Contractor Operations');
});

test('Role Testing Matrix: ZMCC_MANAGER team stations derivation', () => {
  const stations = getTeamStationsForRole('ZMCC_MANAGER');
  const labels = stations.map((s) => s.label);

  assert.ok(labels.includes('PHE Milk Reception'));
  assert.ok(labels.includes('Zonal Lab'));
  assert.ok(labels.includes('Tanker Dispatch'));
  assert.ok(labels.includes('MOT Mobile Journey'));
  assert.ok(labels.includes('MDO Field Operations'));

  // Must NOT include contractor or plant stations
  assert.ok(!labels.includes('Contractor Dispatch'));
  assert.ok(!labels.includes('Weighbridge'));
  assert.ok(!labels.includes('Plant Reception Lab'));
});

test('Role Testing Matrix: QA_HEAD team stations derivation', () => {
  const stations = getTeamStationsForRole('QA_HEAD');
  const labels = stations.map((s) => s.label);

  assert.deepEqual(labels, ['Plant Reception Lab']);
  const lab = stations[0];
  assert.equal(lab.href, '/department/qa');
});

test('Role Testing Matrix: PRODUCTION_HEAD team stations derivation', () => {
  const stations = getTeamStationsForRole('PRODUCTION_HEAD');
  const labels = stations.map((s) => s.label);

  assert.ok(labels.includes('Weighbridge'));
  assert.ok(labels.includes('Silo Unloading'));
  assert.equal(labels.length, 2);
});

test('Role Testing Matrix: SUPER_ADMIN global station access', () => {
  const stations = getTeamStationsForRole('SUPER_ADMIN');
  const labels = stations.map((s) => s.label);

  assert.ok(labels.includes('Zonal Lab'));
  assert.ok(labels.includes('PHE Milk Reception'));
  assert.ok(labels.includes('MOT Mobile Journey'));
  assert.ok(labels.includes('Tanker Dispatch'));
  assert.ok(labels.includes('Contractor Dispatch'));
  assert.ok(labels.includes('Weighbridge'));
  assert.ok(labels.includes('Silo Unloading'));
  assert.ok(labels.includes('Plant Reception Lab'));
  assert.ok(labels.includes('Security Gate'));
});

test('Role Testing Matrix: DATA_EXECUTIVE 2nd top station access with logical grouping', () => {
  const stations = getTeamStationsForRole('DATA_EXECUTIVE');
  const labels = stations.map((s) => s.label);

  // Must include all operational stations across ZMCC, Contractor, and Plant
  assert.ok(labels.includes('Zonal Lab'));
  assert.ok(labels.includes('PHE Milk Reception'));
  assert.ok(labels.includes('MOT Mobile Journey'));
  assert.ok(labels.includes('Tanker Dispatch'));
  assert.ok(labels.includes('Contractor Dispatch'));
  assert.ok(labels.includes('Weighbridge'));
  assert.ok(labels.includes('Silo Unloading'));
  assert.ok(labels.includes('Plant Reception Lab'));
  assert.ok(labels.includes('Security Gate'));

  // Groups must be set for DATA_EXECUTIVE as a wide-group role
  const zmccStation = stations.find((s) => s.label === 'Zonal Lab');
  assert.equal(zmccStation?.group, 'ZMCC Operations');

  const contractorStation = stations.find((s) => s.label === 'Contractor Dispatch');
  assert.equal(contractorStation?.group, 'Contractor Operations');

  const plantStation = stations.find((s) => s.label === 'Weighbridge');
  assert.equal(plantStation?.group, 'Plant Operations');
});

test('Role Testing Matrix: Field operators have NO team stations', () => {
  const fieldRoles = [
    'PHE_OPERATOR',
    'MOT',
    'ZMCC_LAB_ATTENDANT',
    'CONTRACTOR_OPERATOR',
    'WEIGHBRIDGE_OPERATOR',
    'PRODUCTION_RECEPTION_OPERATOR',
    'QA_LAB_ATTENDANT',
    'SECURITY_OPERATOR',
  ];

  for (const role of fieldRoles) {
    const stations = getTeamStationsForRole(role);
    assert.deepEqual(stations, [], `Field role ${role} should have 0 team stations`);
    const sections = getRoleNavSections(mockUser(role));
    const teamSection = sections.find((s) => s.id === 'team-stations');
    assert.equal(teamSection, undefined, `Field role ${role} should not render team-stations section`);
  }
});

test('resolveDelegationContext: HEAD_OF_MPD on /zmcc/lab', () => {
  const user = mockUser('HEAD_OF_MPD');
  const ctx = resolveDelegationContext(user, '/zmcc/lab');

  assert.equal(ctx.isDelegated, true);
  assert.equal(ctx.actingAs, 'ZMCC_LAB_ATTENDANT');
  assert.equal(ctx.subordinateRoleLabel, 'Zonal Lab Attendant');
  assert.equal(ctx.homeRoute, '/mpd/head');
  assert.equal(ctx.isRegional, true);
  assert.equal(ctx.targetSourceType, 'ZMCC');
});

test('resolveDelegationContext: HEAD_OF_MPD on canonical home /mpd/head', () => {
  const user = mockUser('HEAD_OF_MPD');
  const ctx = resolveDelegationContext(user, '/mpd/head');

  assert.equal(ctx.isDelegated, false);
});

test('resolveDelegationContext: ZMCC_MANAGER on /zmcc/lab', () => {
  const user = mockUser('ZMCC_MANAGER', 'Zonal Manager', 'ZMCC Hasilpur');
  const ctx = resolveDelegationContext(user, '/zmcc/lab');

  assert.equal(ctx.isDelegated, true);
  assert.equal(ctx.actingAs, 'ZMCC_LAB_ATTENDANT');
  assert.equal(ctx.subordinateRoleLabel, 'Zonal Lab Attendant');
  assert.equal(ctx.homeRoute, '/mpd/zmcc-manager');
  assert.equal(ctx.isRegional, true);
});

test('resolveDelegationContext: QA_HEAD on /department/qa', () => {
  const user = mockUser('QA_HEAD');
  const ctx = resolveDelegationContext(user, '/department/qa');

  assert.equal(ctx.isDelegated, true);
  assert.equal(ctx.actingAs, 'QA_LAB_ATTENDANT');
  assert.equal(ctx.subordinateRoleLabel, 'QAE – Reception Lab');
  assert.equal(ctx.homeRoute, '/department/qa-head');
  assert.equal(ctx.isRegional, false);
});

test('resolveDelegationContext: PRODUCTION_HEAD on /department/weighbridge', () => {
  const user = mockUser('PRODUCTION_HEAD');
  const ctx = resolveDelegationContext(user, '/department/weighbridge');

  assert.equal(ctx.isDelegated, true);
  assert.equal(ctx.actingAs, 'WEIGHBRIDGE_OPERATOR');
  assert.equal(ctx.subordinateRoleLabel, 'Weighbridge Operator');
  assert.equal(ctx.homeRoute, '/department/production');
});

test('resolveDelegationContext: Field operator doing own work is NOT delegated', () => {
  const labUser = mockUser('ZMCC_LAB_ATTENDANT');
  const ctx = resolveDelegationContext(labUser, '/zmcc/lab');

  assert.equal(ctx.isDelegated, false);
});

test('resolveDelegationContext: Unauthorized cross-department role is NOT delegated', () => {
  const pheUser = mockUser('PHE_OPERATOR');
  // PHE Operator cannot act as QA_LAB_ATTENDANT
  const ctx = resolveDelegationContext(pheUser, '/department/qa');

  assert.equal(ctx.isDelegated, false);
});

test('resolveDelegationContext: DATA_EXECUTIVE on /zmcc/lab', () => {
  const user = mockUser('DATA_EXECUTIVE');
  const ctx = resolveDelegationContext(user, '/zmcc/lab');

  assert.equal(ctx.isDelegated, true);
  assert.equal(ctx.actingAs, 'ZMCC_LAB_ATTENDANT');
  assert.equal(ctx.subordinateRoleLabel, 'Zonal Lab Attendant');
  assert.equal(ctx.homeRoute, '/super-admin/corrections');
  assert.equal(ctx.isRegional, true);
  assert.equal(ctx.targetSourceType, 'ZMCC');
});

test('resolveDelegationContext: DATA_EXECUTIVE on canonical home /super-admin/lab-tests', () => {
  const user = mockUser('DATA_EXECUTIVE');
  const ctx = resolveDelegationContext(user, '/super-admin/lab-tests');

  assert.equal(ctx.isDelegated, false);
});

test('getRoleNavSections: Collapsible "Team Stations (Cover Staff)" section presence', () => {
  // Superiors must have team-stations section with Users icon
  const saSections = getRoleNavSections(mockUser('SUPER_ADMIN'));
  const saTeamSection = saSections.find((s) => s.id === 'team-stations');
  assert.ok(saTeamSection);
  assert.equal(saTeamSection.label, 'Team Stations (Cover Staff)');

  const deSections = getRoleNavSections(mockUser('DATA_EXECUTIVE'));
  const deTeamSection = deSections.find((s) => s.id === 'team-stations');
  assert.ok(deTeamSection);
  assert.equal(deTeamSection.label, 'Team Stations (Cover Staff)');

  const mpdSections = getRoleNavSections(mockUser('HEAD_OF_MPD'));
  const mpdTeamSection = mpdSections.find((s) => s.id === 'team-stations');
  assert.ok(mpdTeamSection);
  assert.equal(mpdTeamSection.label, 'Team Stations (Cover Staff)');

  const zmccSections = getRoleNavSections(mockUser('ZMCC_MANAGER'));
  const zmccTeamSection = zmccSections.find((s) => s.id === 'team-stations');
  assert.ok(zmccTeamSection);
  assert.equal(zmccTeamSection.label, 'Team Stations (Cover Staff)');

  const qaSections = getRoleNavSections(mockUser('QA_HEAD'));
  const qaTeamSection = qaSections.find((s) => s.id === 'team-stations');
  assert.ok(qaTeamSection);
  assert.equal(qaTeamSection.label, 'Team Stations (Cover Staff)');

  const prodSections = getRoleNavSections(mockUser('PRODUCTION_HEAD'));
  const prodTeamSection = prodSections.find((s) => s.id === 'team-stations');
  assert.ok(prodTeamSection);
  assert.equal(prodTeamSection.label, 'Team Stations (Cover Staff)');
});
