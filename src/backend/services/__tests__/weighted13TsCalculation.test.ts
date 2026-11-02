import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateSNF,
  calculateTS,
  calculateAt13TSLiters,
  computeWeightedMilkMetrics,
} from '@/backend/utils/milkFormulas';
import {
  canViewZmcc13TsLiters,
  canViewPlant13TsLiters,
  isBlindOperationalRole,
} from '@/lib/role-visibility';

test('computeWeightedMilkMetrics: correctly calculates weighted averages and @13 TS Liters with zero drift', () => {
  // Batch 1: Cow milk (5,000 L, LR 28.0, Fat 3.5%)
  // Batch 2: Buffalo milk (5,000 L, LR 30.0, Fat 6.5%)
  const b1Snf = calculateSNF(28.0, 3.5); // 8.49%
  const b1Ts = calculateTS(3.5, b1Snf); // 11.99%
  const b1At13 = calculateAt13TSLiters(5000, b1Ts); // 4611.538...

  const b2Snf = calculateSNF(30.0, 6.5); // 9.65%
  const b2Ts = calculateTS(6.5, b2Snf); // 16.15%
  const b2At13 = calculateAt13TSLiters(5000, b2Ts); // 6211.538...

  const sumAt13 = Number((b1At13 + b2At13).toFixed(2)); // 10823.08 L

  const composite = computeWeightedMilkMetrics([
    { grossLiters: 5000, lr: 28.0, fat: 3.5 },
    { grossLiters: 5000, lr: 30.0, fat: 6.5 },
  ]);

  assert.equal(composite.totalGrossLiters, 10000);
  assert.equal(composite.weightedLr, 29.0);
  assert.equal(composite.weightedFat, 5.0);
  assert.equal(composite.weightedSnf, 9.07);
  assert.equal(composite.weightedTs, 14.07);
  assert.equal(composite.weightedDensity, 1.029);
  assert.equal(composite.totalAt13tsLiters, sumAt13);
});

test('role-visibility: canViewZmcc13TsLiters authorizes strictly ZMCC management chain', () => {
  const allowed = [
    'ZMCC_MANAGER',
    'HEAD_OF_MPD',
    'EXECUTIVE_MANAGEMENT',
    'DATA_EXECUTIVE',
    'SUPER_ADMIN',
  ];
  for (const role of allowed) {
    assert.equal(canViewZmcc13TsLiters(role), true, `Role ${role} should be allowed`);
  }

  const blocked = [
    'ZMCC_LAB_ATTENDANT',
    'PHE_OPERATOR',
    'MDO',
    'MOT',
    'SECURITY_OPERATOR',
    'PRODUCTION_RECEPTION_OPERATOR',
    'WEIGHBRIDGE_OPERATOR',
    'QA_LAB_ATTENDANT',
    'PRODUCTION_HEAD',
  ];
  for (const role of blocked) {
    assert.equal(canViewZmcc13TsLiters(role), false, `Role ${role} should be blocked`);
  }
});

test('role-visibility: canViewPlant13TsLiters authorizes strictly Plant management chain', () => {
  const allowed = [
    'PRODUCTION_HEAD',
    'EXECUTIVE_MANAGEMENT',
    'DATA_EXECUTIVE',
    'SUPER_ADMIN',
  ];
  for (const role of allowed) {
    assert.equal(canViewPlant13TsLiters(role), true, `Role ${role} should be allowed`);
  }

  const blocked = [
    'PRODUCTION_RECEPTION_OPERATOR',
    'WEIGHBRIDGE_OPERATOR',
    'QA_LAB_ATTENDANT',
    'SECURITY_OPERATOR',
    'ZMCC_MANAGER',
    'HEAD_OF_MPD',
    'ZMCC_LAB_ATTENDANT',
    'PHE_OPERATOR',
  ];
  for (const role of blocked) {
    assert.equal(canViewPlant13TsLiters(role), false, `Role ${role} should be blocked`);
  }
});

test('role-visibility: isBlindOperationalRole detects field operators who must remain double-blind', () => {
  const blindRoles = [
    'ZMCC_LAB_ATTENDANT',
    'PHE_OPERATOR',
    'MDO',
    'MOT',
    'PRODUCTION_RECEPTION_OPERATOR',
    'WEIGHBRIDGE_OPERATOR',
    'QA_LAB_ATTENDANT',
    'SECURITY_OPERATOR',
  ];
  for (const role of blindRoles) {
    assert.equal(isBlindOperationalRole(role), true, `Role ${role} must be blind`);
  }

  const mgmtRoles = [
    'ZMCC_MANAGER',
    'HEAD_OF_MPD',
    'PRODUCTION_HEAD',
    'EXECUTIVE_MANAGEMENT',
    'DATA_EXECUTIVE',
    'SUPER_ADMIN',
  ];
  for (const role of mgmtRoles) {
    assert.equal(isBlindOperationalRole(role), false, `Role ${role} is management, not blind`);
  }
});

test('serializeTank: enforces role-based volume masking and 13 TS visibility', async () => {
  const { serializeTank } = await import('@/backend/services/zmccTankService');

  const mockTank = {
    id: BigInt(101),
    zmcc_id: BigInt(1),
    tank_code: 'TANK-01',
    tank_name: 'Raw Milk Tank 1',
    capacity_liters: 50000,
    is_active: true,
    created_by_user_id: BigInt(1),
    created_at: new Date(),
    updated_at: new Date(),
  };

  const stockSummary = {
    physicalStockGrossLiters: 12000,
    commercialStockAt13Ts: 11067.69,
    commercialBalanceComplete: true,
  };

  // Case 1: Blind Operational Role (ZMCC_LAB_ATTENDANT)
  const labSerialized = serializeTank(mockTank as any, stockSummary, 'ZMCC_LAB_ATTENDANT');
  assert.equal(labSerialized.current_stock, null, 'Operational role must not see gross liters');
  assert.equal(labSerialized.current_stock_at_13ts, null, 'Operational role must not see 13 TS liters');
  assert.equal(labSerialized.capacity_liters, null, 'Operational role must not see capacity');

  // Case 2: Blind Field Role (PHE_OPERATOR)
  const pheSerialized = serializeTank(mockTank as any, stockSummary, 'PHE_OPERATOR');
  assert.equal(pheSerialized.current_stock, null, 'PHE Operator must be blind');
  assert.equal(pheSerialized.current_stock_at_13ts, null, 'PHE Operator must be blind');

  // Case 3: Authorized ZMCC Manager
  const zmccMgrSerialized = serializeTank(mockTank as any, stockSummary, 'ZMCC_MANAGER');
  assert.equal(zmccMgrSerialized.current_stock, 12000, 'ZMCC Manager sees physical stock');
  assert.equal(zmccMgrSerialized.current_stock_at_13ts, 11067.69, 'ZMCC Manager sees 13 TS liters');

  // Case 4: Authorized MPD Head
  const mpdHeadSerialized = serializeTank(mockTank as any, stockSummary, 'HEAD_OF_MPD');
  assert.equal(mpdHeadSerialized.current_stock_at_13ts, 11067.69, 'MPD Head sees 13 TS liters');

  // Case 5: Plant Role (PRODUCTION_HEAD - not in ZMCC 13TS authorization)
  const prodHeadSerialized = serializeTank(mockTank as any, stockSummary, 'PRODUCTION_HEAD');
  assert.equal(prodHeadSerialized.current_stock_at_13ts, null, 'Production Head cannot see ZMCC 13 TS liters');

  // Case 6: Super Admin (all visible)
  const adminSerialized = serializeTank(mockTank as any, stockSummary, 'SUPER_ADMIN');
  assert.equal(adminSerialized.current_stock_at_13ts, 11067.69, 'Super Admin sees 13 TS liters');
});
