import test from 'node:test';
import assert from 'node:assert/strict';
import { getProductionHeadOverview } from '../productionHeadOverviewService';
import { canActAs } from '@/backend/core/roles/hierarchy';
import { resolveRoleHome } from '@/lib/role-routing';
import { getTeamStationsForRole } from '@/frontend/modules/shared/delegation/stations';

test('productionHeadOverviewService: returns complete supervisory payload structure', async () => {
  const result = await getProductionHeadOverview();

  // 1. Business date metadata
  assert.ok(result.businessDate, 'Must have businessDate');
  assert.ok(result.calendarDate, 'Must have calendarDate');

  // 2. Executive KPIs
  assert.equal(typeof result.kpis.totalIntake13TsLitersToday, 'number');
  assert.equal(typeof result.kpis.totalIntakeGrossLitersToday, 'number');
  assert.equal(typeof result.kpis.totalIntakeNetKgToday, 'number');
  assert.equal(typeof result.kpis.activeVehiclesInPlant, 'number');
  assert.equal(typeof result.kpis.weighbridgeTicketsToday, 'number');
  assert.equal(typeof result.kpis.unloadingPortionsToday, 'number');
  assert.ok(result.kpis.totalSiloCapacityLiters > 0, 'Silo capacity must be > 0');
  assert.equal(typeof result.kpis.currentSiloStock13TsLiters, 'number');

  // 3. Team Stations - Weighbridge & Reception
  assert.ok(result.teamStations.weighbridge, 'Must have weighbridge station data');
  assert.ok(
    ['ONLINE', 'BUSY', 'IDLE'].includes(result.teamStations.weighbridge.operationalStatus),
    'Weighbridge status must be valid'
  );
  assert.equal(typeof result.teamStations.weighbridge.waitingForGrossCount, 'number');
  assert.equal(typeof result.teamStations.weighbridge.waitingForTareCount, 'number');
  assert.equal(typeof result.teamStations.weighbridge.avgWeighmentMinutes, 'number');

  assert.ok(result.teamStations.reception, 'Must have reception station data');
  assert.ok(
    ['ACTIVE', 'IDLE'].includes(result.teamStations.reception.operationalStatus),
    'Reception status must be valid'
  );
  assert.equal(typeof result.teamStations.reception.activeBaysCount, 'number');
  assert.equal(typeof result.teamStations.reception.waitingForUnloadingCount, 'number');
  assert.equal(typeof result.teamStations.reception.avgUnloadingMinutes, 'number');

  // 4. Subordinate Work History Feed
  assert.ok(Array.isArray(result.subordinateWorkHistory), 'Work history must be an array');
  for (const item of result.subordinateWorkHistory) {
    assert.ok(item.id, 'Item must have an id');
    assert.ok(['WEIGHBRIDGE', 'RECEPTION'].includes(item.station));
    assert.ok(item.timestamp, 'Item must have timestamp');
    assert.ok(item.operatorName, 'Item must have operatorName');
    assert.ok(item.vehicleNumber, 'Item must have vehicleNumber');
  }

  // 5. Silos Grid
  assert.ok(Array.isArray(result.silos), 'Silos must be an array');
  assert.ok(result.silos.length > 0, 'Must have silos configured');
  for (const silo of result.silos) {
    assert.ok(silo.silo_code, 'Silo must have silo_code');
    assert.ok(silo.capacity_liters > 0, 'Silo capacity must be > 0');
    assert.ok(
      ['RECEIVING', 'STORAGE', 'CIP', 'MAINTENANCE', 'EMPTY'].includes(silo.status),
      'Silo status must be valid'
    );
  }
});

test('productionHeadOverviewService: filters history by station correctly', async () => {
  const wbOnly = await getProductionHeadOverview(null, 'WEIGHBRIDGE');
  for (const item of wbOnly.subordinateWorkHistory) {
    assert.equal(item.station, 'WEIGHBRIDGE');
  }

  const rcOnly = await getProductionHeadOverview(null, 'RECEPTION');
  for (const item of rcOnly.subordinateWorkHistory) {
    assert.equal(item.station, 'RECEPTION');
  }
});

test('Production Head Hierarchy & Routing Integrity', () => {
  // 1. Role routing lands on dedicated Production Command Hub
  assert.equal(resolveRoleHome('PRODUCTION_HEAD'), '/department/production-head');

  // 2. Production Head has supervisory authority over Weighbridge & Reception
  assert.equal(canActAs('PRODUCTION_HEAD', 'WEIGHBRIDGE_OPERATOR'), true);
  assert.equal(canActAs('PRODUCTION_HEAD', 'PRODUCTION_RECEPTION_OPERATOR'), true);
  assert.equal(canActAs('PRODUCTION_HEAD', 'QA_LAB_ATTENDANT'), false);

  // 3. Team Stations includes Weighbridge and Silo Unloading
  const teamStations = getTeamStationsForRole('PRODUCTION_HEAD');
  const labels = teamStations.map((s) => s.label);
  assert.ok(labels.includes('Weighbridge'));
  assert.ok(labels.includes('Silo Unloading'));
  assert.equal(labels.length, 2);
});
