import { prisma } from '../src/backend/core/db';

async function backfillReceptionNumbers() {
  console.log('==================================================');
  console.log('STARTING HISTORICAL RECEPTION NUMBER BACKFILL');
  console.log('==================================================\n');

  const allVisits = await prisma.vehicleVisit.findMany({
    orderBy: [
      { operational_date: 'asc' },
      { created_at: 'asc' },
      { id: 'asc' },
    ],
  });

  console.log(`Found ${allVisits.length} total VehicleVisit records in database.`);

  // Group visits by YYYYMM
  const monthGroups: Record<string, typeof allVisits> = {};

  allVisits.forEach((v) => {
    const targetDate = v.operational_date || v.created_at;
    const year = targetDate.getFullYear();
    const month = String(targetDate.getMonth() + 1).padStart(2, '0');
    const ym = `${year}${month}`;

    if (!monthGroups[ym]) {
      monthGroups[ym] = [];
    }
    monthGroups[ym].push(v);
  });

  let totalUpdated = 0;

  for (const [ym, visits] of Object.entries(monthGroups)) {
    console.log(`Processing month ${ym}: ${visits.length} records...`);

    let seq = 1;
    for (const v of visits) {
      const seqStr = String(seq).padStart(4, '0');
      const recNum = `MR-${ym}-${seqStr}`;

      await prisma.vehicleVisit.update({
        where: { id: v.id },
        data: { reception_number: recNum },
      });

      seq++;
      totalUpdated++;
    }

    // Synchronize monthly_reception_counter to highest assigned sequence
    const maxSeq = visits.length;
    await prisma.monthlyReceptionCounter.upsert({
      where: { year_month: ym },
      update: { last_seq: maxSeq },
      create: { year_month: ym, last_seq: maxSeq },
    });

    console.log(`  ✓ Month ${ym} completed. Counter set to ${maxSeq}.`);
  }

  console.log('\n==================================================');
  console.log(`HISTORICAL BACKFILL COMPLETE: ${totalUpdated} records updated.`);
  console.log('==================================================\n');
}

backfillReceptionNumbers()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
