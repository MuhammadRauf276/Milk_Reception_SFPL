import { Prisma } from '@prisma/client';
import { getPakistanCalendarDate } from '@/backend/core/business-day';

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
  // The month in Pakistan, whatever time zone the server runs in (an arrival at 00:30 on the 1st is the new month).
  const yearMonth = getPakistanCalendarDate(isNaN(targetDate.getTime()) ? new Date() : targetDate).slice(0, 7).replace('-', '');

  const [counter] = await tx.$queryRaw<Array<{ last_seq: number }>>`
    INSERT INTO monthly_reception_counter (year_month, last_seq, updated_at)
    VALUES (${yearMonth}, 1, (NOW() AT TIME ZONE 'UTC'))
    ON CONFLICT (year_month) DO UPDATE
    SET last_seq = monthly_reception_counter.last_seq + 1, updated_at = (NOW() AT TIME ZONE 'UTC')
    RETURNING last_seq;
  `;

  const seqNum = Number(counter.last_seq);
  const seqStr = String(seqNum).padStart(4, '0');

  return `MR-${yearMonth}-${seqStr}`;
}
