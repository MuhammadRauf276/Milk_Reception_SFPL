const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function test() {
  console.log('Testing composite key uniqueness for ZMCC Manager pages...\n');
  const res = await pool.query(`
    SELECT 
      vv.id AS visit_id,
      vp.id AS portion_id,
      vp.portion_number
    FROM vehicle_visit vv
    JOIN visit_portion vp ON vv.id = vp.visit_id
    ORDER BY vv.id DESC, vp.portion_number ASC;
  `);

  console.log(`Total database portion records: ${res.rows.length}\n`);

  // 1. Zonal Historical Archive Parent Visit Keys
  const visitIds = Array.from(new Set(res.rows.map(r => r.visit_id)));
  const historyVisitKeys = visitIds.map(id => `history-${id}`);
  const uniqueHistoryVisit = new Set(historyVisitKeys);
  console.log(`Zonal Historical Archive Visits: ${historyVisitKeys.length} visits -> ${uniqueHistoryVisit.size} unique keys (${historyVisitKeys.length === uniqueHistoryVisit.size ? '✅ ZERO DUPLICATES' : '❌ DUPLICATES DETECTED'})`);

  // 2. Zonal Historical Archive Child Portion Keys
  const historyPortionKeys = res.rows.map(r => `history-${r.visit_id}-${r.portion_id || r.portion_number}`);
  const uniqueHistoryPortion = new Set(historyPortionKeys);
  console.log(`Zonal Historical Archive Portions: ${historyPortionKeys.length} portions -> ${uniqueHistoryPortion.size} unique keys (${historyPortionKeys.length === uniqueHistoryPortion.size ? '✅ ZERO DUPLICATES' : '❌ DUPLICATES DETECTED'})`);

  // 3. Cross-Verification Parent Vehicle Keys
  const crossVisitKeys = visitIds.map(id => `cross-visit-${id}`);
  const uniqueCrossVisit = new Set(crossVisitKeys);
  console.log(`Cross-Verification Visits: ${crossVisitKeys.length} visits -> ${uniqueCrossVisit.size} unique keys (${crossVisitKeys.length === uniqueCrossVisit.size ? '✅ ZERO DUPLICATES' : '❌ DUPLICATES DETECTED'})`);

  // 4. Cross-Verification Portion Keys
  const crossPortionKeys = res.rows.map(r => `cross-${r.visit_id}-${r.portion_id || r.portion_number}`);
  const uniqueCrossPortion = new Set(crossPortionKeys);
  console.log(`Cross-Verification Portions: ${crossPortionKeys.length} portions -> ${uniqueCrossPortion.size} unique keys (${crossPortionKeys.length === uniqueCrossPortion.size ? '✅ ZERO DUPLICATES' : '❌ DUPLICATES DETECTED'})`);
}

test().catch(console.error).finally(() => pool.end());
