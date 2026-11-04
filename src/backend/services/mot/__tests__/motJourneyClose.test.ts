import test from 'node:test';
import assert from 'node:assert/strict';
import { closeArrivedJourneyTx } from '../motJourneyClose';

test('only a journey waiting at the ZMCC is closed', async () => {
  const calls: Array<{ where: unknown; data: unknown }> = [];
  const tx = {
    motJourney: {
      updateMany: async (args: { where: unknown; data: unknown }) => {
        calls.push(args);
        return { count: 1 };
      },
    },
  };
  await closeArrivedJourneyTx(tx as never, BigInt(7));
  assert.deepEqual(calls, [{ where: { id: BigInt(7), status: 'ARRIVED' }, data: { status: 'COMPLETED' } }]);
});
