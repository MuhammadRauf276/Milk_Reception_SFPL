import { prisma } from '../src/backend/core/db';

async function inspectDb() {
  const rows = await prisma.siloInventoryTransaction.findMany();
  console.log(`Total SiloInventoryTransaction rows: ${rows.length}`);
  for (const r of rows) {
    console.log(`ID: ${r.id}, visit_id: ${r.visit_id}, ref_type: ${r.reference_type}, ref_id: ${r.reference_id}`);
  }
}

inspectDb();
