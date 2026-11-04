-- Vehicle report (Senior Executive Management and AVP-QA): a live read view with one row per dispatched portion.
-- Additive: one index and one plain view, no data change, no refresh needed.

-- 1. The report always filters on dispatch time, so this is what keeps a date range fast.
CREATE INDEX IF NOT EXISTS idx_dispatch_info_dispatch_timestamp ON dispatch_info (dispatch_timestamp DESC);

-- 2. Lab results are read per portion through their portion_id indexes, only for the rows a date range selects.
--    SNF and TS repeat calculateSNF / calculateTS (src/backend/utils/milkFormulas.ts).
--    The stage repeats currentStageLabel in deriveManagerLifecycle (zmccManagerHelpers.ts).
DROP VIEW IF EXISTS vw_vehicle_portion_report CASCADE;
CREATE VIEW vw_vehicle_portion_report AS
SELECT
  v.id AS visit_id,
  p.id AS portion_id,
  p.portion_number,
  'P-' || lpad(p.portion_number::text, 2, '0') AS portion_label,
  (p.portion_number = stats.first_portion) AS is_first_portion,
  v.vehicle_number,
  v.token_number,
  COALESCE(ps.name, 'ZMCC / Contractor') AS source_name,
  di.dispatch_timestamp AS dispatched_at,
  to_char(di.dispatch_timestamp AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Karachi', 'DD Mon YYYY') AS dispatch_date_text,
  CASE
    WHEN receipt.id IS NOT NULL THEN 'Final Receipt Completed'
    WHEN wt.tare_weight_kg IS NOT NULL THEN 'Awaiting Final Silo Receipt'
    WHEN unload.pump_end_timestamp IS NOT NULL
      OR upper(v.current_status) IN ('UNLOADED', 'READY_FOR_TARE', 'TARE_WEIGHED', 'READY_FOR_GATE_EXIT', 'COMPLETED', 'GATE_OUT')
      THEN 'Second Weight (After Unloading)'
    WHEN unload.pump_start_timestamp IS NOT NULL OR upper(v.current_status) = 'UNLOADING' THEN 'Silo Milk Offloading'
    WHEN wt.gross_weight_kg IS NOT NULL THEN 'Awaiting Unloading'
    WHEN stats.qa_final THEN 'First Weight (Loaded Vehicle)'
    WHEN g.entry_timestamp IS NOT NULL
      OR upper(v.current_status) IN ('GATE_IN', 'IN_QA', 'QA_ACCEPTED', 'WEIGHED_IN')
      THEN 'Plant QA Analysis'
    ELSE 'Dispatch'
  END AS stage,
  upper(COALESCE(p.plant_decision, 'PENDING')) AS decision,
  p.dispatch_quantity_value,
  lower(p.dispatch_quantity_unit::text) AS dispatch_quantity_unit,
  dq.fat AS dispatch_fat,
  pq.fat AS plant_fat,
  dq.lr AS dispatch_lr,
  pq.lr AS plant_lr,
  round(dq.lr / 4 + 0.22 * dq.fat + 0.72, 3) AS dispatch_snf,
  round(pq.lr / 4 + 0.22 * pq.fat + 0.72, 3) AS plant_snf,
  dq.fat + round(dq.lr / 4 + 0.22 * dq.fat + 0.72, 3) AS dispatch_ts,
  pq.fat + round(pq.lr / 4 + 0.22 * pq.fat + 0.72, 3) AS plant_ts,
  v.vehicle_dispatch_at_13ts_liters AS dispatch_at_13ts_liters,
  wt.gross_weight_kg AS first_weight_kg,
  wt.tare_weight_kg AS second_weight_kg,
  wt.net_weight_kg,
  receipt.plant_final_at_13ts_liters AS received_at_13ts_liters
FROM visit_portion p
JOIN dispatch_info di ON di.portion_id = p.id
JOIN vehicle_visit v ON v.id = p.visit_id
LEFT JOIN procurement_source ps ON ps.id = v.procurement_source_id
LEFT JOIN gate_log g ON g.visit_id = v.id
LEFT JOIN weight_ticket wt ON wt.visit_id = v.id
LEFT JOIN LATERAL (
  SELECT
    min(pp.portion_number) AS first_portion,
    bool_and(upper(COALESCE(pp.plant_decision, 'PENDING')) IN ('ACCEPTED', 'REJECTED')) AS qa_final
  FROM visit_portion pp
  WHERE pp.visit_id = v.id
) stats ON true
LEFT JOIN LATERAL (
  SELECT ul.pump_start_timestamp, ul.pump_end_timestamp
  FROM unloading_log ul
  JOIN visit_portion pp ON pp.id = ul.portion_id
  WHERE pp.visit_id = v.id AND pp.portion_number = stats.first_portion
) unload ON true
LEFT JOIN LATERAL (
  SELECT tx.id, tx.plant_final_at_13ts_liters
  FROM silo_inventory_transaction tx
  WHERE tx.visit_id = v.id AND tx.transaction_type = 'RECEIPT'
  ORDER BY tx.id
  LIMIT 1
) receipt ON true
LEFT JOIN LATERAL (
  -- A whole-vehicle dispatch records Fat and LR once on the visit, so a portion without its own result uses those.
  SELECT
    COALESCE(x.fat, v.vehicle_dispatch_fat) AS fat,
    COALESCE(x.lr, v.vehicle_dispatch_lr) AS lr
  FROM (
    SELECT
      (array_agg(r.numeric_value ORDER BY r.id) FILTER (
        WHERE t.system_role = 'FAT' OR (t.system_role IS NULL AND upper(trim(t.test_code)) = 'LT-000026')
      ))[1] AS fat,
      (array_agg(r.numeric_value ORDER BY r.id) FILTER (
        WHERE t.system_role = 'LR' OR (t.system_role IS NULL AND upper(trim(t.test_code)) = 'LT-000008')
      ))[1] AS lr
    FROM dispatch_lab_result r
    JOIN lab_test t ON t.id = r.test_id
    WHERE r.portion_id = p.id AND r.performance_status = 'PERFORMED' AND r.numeric_value IS NOT NULL
  ) x
) dq ON true
LEFT JOIN LATERAL (
  SELECT
    (array_agg(r.numeric_value ORDER BY r.id) FILTER (
      WHERE t.system_role = 'FAT' OR (t.system_role IS NULL AND upper(trim(t.test_code)) = 'LT-000026')
    ))[1] AS fat,
    (array_agg(r.numeric_value ORDER BY r.id) FILTER (
      WHERE t.system_role = 'LR' OR (t.system_role IS NULL AND upper(trim(t.test_code)) = 'LT-000008')
    ))[1] AS lr
  FROM plant_lab_result r
  JOIN lab_test t ON t.id = r.test_id
  WHERE r.portion_id = p.id AND r.performance_status = 'PERFORMED' AND r.numeric_value IS NOT NULL
) pq ON true
WHERE di.dispatch_timestamp IS NOT NULL;
