import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { motCollectionRequestBody } from '../offlineStore';
import { evaluateAllCalculatedTests, FORMULA_SNF_CANONICAL } from '@/lib/calculated-tests';

describe('Phase 4: Offline Milk Collection Lifecycle & Calculations', () => {

  test('Computes Richmond SNF accurately for offline collection draft', () => {
    // Cow milk sample: LR=28.0, Fat=3.5%
    // Richmond formula: SNF = (LR / 4) + (0.22 * Fat) + 0.72 = 7.0 + 0.77 + 0.72 = 8.49
    const calculated = evaluateAllCalculatedTests({
      LR: 28.0,
      FAT: 3.5,
    });

    const snf = calculated.SNF_CANONICAL ?? FORMULA_SNF_CANONICAL.calculate({ LR: 28.0, FAT: 3.5 });
    assert.ok(snf !== null && snf !== undefined);
    assert.ok(snf > 8.4 && snf < 8.6, `Expected SNF ~8.49, got ${snf}`);
  });

  test('Calculates Total Solids from FAT and Richmond SNF', () => {
    // Total Solids = FAT + SNF
    const calculated = evaluateAllCalculatedTests({
      LR: 28.0,
      FAT: 3.5,
    });

    const ts = calculated.TOTAL_SOLIDS;
    assert.ok(ts !== null && ts !== undefined);
    assert.ok(ts > 11.5, `Expected Total Solids > 11.5, got ${ts}`);
  });

  test('Formats queued collection matching server API contract (motCollectionRequestBody)', () => {
    const queuedItem = {
      client_event_id: 'col-uuid-1234',
      journey_id: 'journey-99',
      stop_id: 'stop-42',
      shop_rmr_number: 'RMR-001',
      milk_source_id: 'source-15',
      quantity: 125.5,
      unit: 'LITER' as const,
      lr: 29.5,
      fat: 6.2,
      recorded_latitude: 29.6974,
      recorded_longitude: 72.5539,
      recorded_gps_accuracy: 10.5,
      offline_created_at: '2026-11-01T17:00:00.000Z',
      person_decision: 'ACCEPT' as const,
      decision_remarks: 'All quality checks passed',
    };

    const requestBody = motCollectionRequestBody(queuedItem);

    assert.equal(requestBody.client_event_id, 'col-uuid-1234');
    assert.equal(requestBody.journey_id, 'journey-99');
    assert.equal(requestBody.stop_id, 'stop-42');
    assert.equal(requestBody.milk_source_id, 'source-15');
    assert.equal(requestBody.quantity, 125.5);
    assert.equal(requestBody.unit, 'LITER');
    assert.equal(requestBody.lr, 29.5);
    assert.equal(requestBody.fat, 6.2);
    assert.equal(requestBody.person_decision, 'ACCEPT');
    assert.equal(requestBody.recorded_latitude, 29.6974);
    assert.equal(requestBody.recorded_longitude, 72.5539);
  });

  test('Collection payload preserves client_event_id for server-side idempotency deduplication', () => {
    const clientUuid = '550e8400-e29b-41d4-a716-446655440000';
    const queuedItem = {
      client_event_id: clientUuid,
      journey_id: 'journey-1',
      stop_id: 'stop-1',
      milk_source_id: 'source-1',
      quantity: 50.0,
      unit: 'LITER' as const,
      lr: 28.0,
      fat: 3.5,
      offline_created_at: '2026-11-01T17:00:00.000Z',
    };

    const body = motCollectionRequestBody(queuedItem);
    assert.equal(body.client_event_id, clientUuid);
  });
});
