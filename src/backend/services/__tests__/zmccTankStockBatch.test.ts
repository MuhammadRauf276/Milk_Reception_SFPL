import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Prisma } from '@prisma/client';

test('zmcc tank stock batch tests', async (t) => {
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = 'postgresql://user:password@localhost:5432/testdb';
  }

  const { getBatchTankPhysicalStock } = await import('../zmccTankService');

  await t.test('getBatchTankPhysicalStock: returns empty Map when tankIds is empty', async () => {
    const result = await getBatchTankPhysicalStock([]);
    assert.equal(result.size, 0);
  });

  await t.test('getBatchTankPhysicalStock: correctly aggregates and maps stocks from $queryRaw', async () => {
    const mockRows = [
      { tank_id: BigInt(101), current_stock: '4500.50' },
      { tank_id: BigInt(102), current_stock: 0 },
      { tank_id: '103', current_stock: '12000' },
    ];

    const mockTx = {
      $queryRaw: async () => mockRows,
    } as unknown as Prisma.TransactionClient;

    const result = await getBatchTankPhysicalStock([BigInt(101), BigInt(102), BigInt(103)], mockTx);

    assert.equal(result.get('101'), 4500.5);
    assert.equal(result.get('102'), 0);
    assert.equal(result.get('103'), 12000);
    assert.equal(result.get('999'), undefined);
  });

  await t.test('mpdExecutiveService uses batched tank stock lookup instead of N+1 loop', () => {
    const src = readFileSync(join(process.cwd(), 'src', 'backend', 'services', 'mpdExecutiveService.ts'), 'utf8');
    assert.ok(src.includes('getBatchTankPhysicalStock(allTankIds)'), 'Must call getBatchTankPhysicalStock with allTankIds');
    assert.ok(!src.includes('zmccSources.flatMap((z) => z.zmcc_tanks).map(async (t) => await getTankPhysicalStock(t.id))'), 'Must not have N+1 loop');
  });
});
