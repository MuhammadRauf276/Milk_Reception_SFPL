import { Prisma } from '@prisma/client';

/**
 * Generates a human-facing, concurrency-safe Milk Reception Number in format MR-YYYYMM-NNNN.
 * Uses PostgreSQL row-level lock via ON CONFLICT DO UPDATE RETURNING last_seq.
 *
 * @param tx Prisma transaction or client instance
 * @param dateInput Optional operational date or server date for YYYYMM prefix
 */
export async function generateReceptionNumber(
  tx: Prisma.TransactionClient,
  dateInput?: Date | string | null
): Promise<string> {
  const targetDate = dateInput ? new Date(dateInput) : new Date();
  const year = targetDate.getFullYear();
  const month = String(targetDate.getMonth() + 1).padStart(2, '0');
  const yearMonth = `${year}${month}`;

  const [counter] = await tx.$queryRaw<Array<{ last_seq: number }>>`
    INSERT INTO monthly_reception_counter (year_month, last_seq, updated_at)
    VALUES (${yearMonth}, 1, NOW())
    ON CONFLICT (year_month) DO UPDATE
    SET last_seq = monthly_reception_counter.last_seq + 1, updated_at = NOW()
    RETURNING last_seq;
  `;

  const seqNum = Number(counter.last_seq);
  const seqStr = String(seqNum).padStart(4, '0');

  return `MR-${yearMonth}-${seqStr}`;
}
