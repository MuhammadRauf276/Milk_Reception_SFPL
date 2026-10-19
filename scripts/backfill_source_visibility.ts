import 'dotenv/config';
import { prisma } from '../src/backend/core/db';

async function main() {
  console.log('Starting backfill of MilkSourceZmccVisibility...');
  const sources = await prisma.zmccMilkSource.findMany();
  console.log(`Found ${sources.length} milk sources.`);

  let createdCount = 0;
  for (const source of sources) {
    if (source.zmcc_id) {
      await prisma.milkSourceZmccVisibility.upsert({
        where: {
          milk_source_id_zmcc_id: {
            milk_source_id: source.id,
            zmcc_id: source.zmcc_id,
          },
        },
        update: {
          is_active: source.is_active,
        },
        create: {
          milk_source_id: source.id,
          zmcc_id: source.zmcc_id,
          is_active: source.is_active,
        },
      });
      createdCount++;
    }
  }

  console.log(`Successfully backfilled/upserted ${createdCount} visibility records.`);
}

main()
  .catch((e) => {
    console.error('Backfill error:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
