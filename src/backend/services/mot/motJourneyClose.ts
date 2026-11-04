import type { Prisma } from '@prisma/client';

/**
 * A journey stays open after the vehicle reaches the ZMCC. It ends here: when the lab rejects everything,
 * the final receipt is given, or the vehicle leaves without unloading. Older journeys are already COMPLETED.
 */
export async function closeArrivedJourneyTx(tx: Prisma.TransactionClient, journeyId: bigint): Promise<void> {
  await tx.motJourney.updateMany({
    where: { id: journeyId, status: 'ARRIVED' },
    data: { status: 'COMPLETED' },
  });
}
