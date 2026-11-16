-- Vehicle report views, third shape (plain views, no data change):
--  * A portion the plant added for its own testing is now listed too, with its plant results, under the vehicle's
--    dispatch time. It is labelled "(plant)" and gets no dispatch values, not even the vehicle-level ones.
--  * The stage shows the gate exit, and a rejected vehicle waiting at the gate.
--  * The Excel view adds each portion's weighing (weight before and after it was unloaded).
-- The date filter on dispatched_at still reaches the dispatch_info index in both branches of the UNION ALL.
DROP VIEW IF EXISTS vw_vehicle_portion_report CASCADE;
CREATE VIEW vw_vehicle_portion_report AS
WITH base AS (
  SELECT p.id AS portion_id, di.dispatch_timestamp AS dispatched_at, true AS is_dispatch_portion
  FROM visit_portion p
  JOIN dispatch_info di ON di.portion_id = p.id
  WHERE di.dispatch_timestamp IS NOT NULL
  UNION ALL
  -- Portions with no dispatch row, under the dispatch time of the visit's first dispatched portion.
  SELECT p.id, di.dispatch_timestamp, false
  FROM dispatch_info di
  JOIN visit_portion p1 ON p1.id = di.portion_id
  JOIN visit_portion p ON p.visit_id = p1.visit_id
  WHERE di.dispatch_timestamp IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM dispatch_info x WHERE x.portion_id = p.id)
    AND NOT EXISTS (
      SELECT 1 FROM visit_portion q JOIN dispatch_info y ON y.portion_id = q.id
      WHERE q.visit_id = p1.visit_id AND q.portion_number < p1.portion_number
    )
)
SELECT
  v.id AS visit_id,
  p.id AS portion_id,
  p.portion_number,
  'P-' || lpad(p.portion_number::text, 2, '0') || CASE WHEN b.is_dispatch_portion THEN '' ELSE ' (plant)' END AS portion_label,
  (p.portion_number = stats.first_portion) AS is_first_portion,
  v.vehicle_number,
  v.token_number,
  COALESCE(ps.name, 'ZMCC / Contractor') AS source_name,
  b.dispatched_at,
  to_char(b.dispatched_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Karachi', 'DD Mon YYYY') AS dispatch_date_text,
  CASE
    WHEN g.exit_timestamp IS NOT NULL THEN 'Exited Plant'
    WHEN upper(v.current_status) = 'READY_FOR_GATE_EXIT' AND wt.gross_weight_kg IS NULL THEN 'Rejected, Awaiting Gate Exit'
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
  receipt.plant_final_at_13ts_liters AS received_at_13ts_liters,
  b.is_dispatch_portion
FROM base b
JOIN visit_portion p ON p.id = b.portion_id
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
  -- The seal identifies the portion first, since plant QA can renumber portions.
  SELECT (e ->> 'fat')::numeric AS fat, (e ->> 'lr')::numeric AS lr
  FROM jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(v.dispatch_decision_details::jsonb -> 'portions') = 'array'
        THEN v.dispatch_decision_details::jsonb -> 'portions'
      ELSE '[]'::jsonb
    END
  ) e
  WHERE b.is_dispatch_portion
    AND (btrim(e ->> 'sealNumber') = btrim(p.seal_number) OR e ->> 'portionNumber' = p.portion_number::text)
  ORDER BY (btrim(e ->> 'sealNumber') = btrim(p.seal_number)) DESC NULLS LAST
  LIMIT 1
) stored ON true
LEFT JOIN LATERAL (
  -- A portion's own result rows first, then the stored decision, then the values recorded once on the visit.
  -- A portion the plant added was never dispatched, so it borrows nothing.
  SELECT
    COALESCE(x.fat, stored.fat, CASE WHEN b.is_dispatch_portion THEN v.vehicle_dispatch_fat END) AS fat,
    COALESCE(x.lr, stored.lr, CASE WHEN b.is_dispatch_portion THEN v.vehicle_dispatch_lr END) AS lr
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
) pq ON true;

-- The Excel view, recreated on the new shape with each portion's weighing added.
CREATE VIEW vw_vehicle_export_report AS
SELECT
  r.*,
  v.visit_number,
  v.reception_number,
  v.raw_milk_dispatch_note_number AS dispatch_note_number,
  v.driver_name,
  ps.id AS source_id,
  ps.code AS source_code,
  upper(ps.source_type) AS source_type,
  v.dispatch_person_decision,
  v.dispatch_system_outcome,
  v.approval_status,
  v.vehicle_dispatch_gross_liters AS dispatch_gross_liters,
  p.seal_number,
  p.plant_seal_number_entered AS plant_seal_number,
  p.seal_match,
  p.plant_rejection_reason,
  p.plant_decided_at,
  p.first_weight_kg AS portion_weight_before_kg,
  p.second_weight_kg AS portion_weight_after_kg,
  p.net_weight_kg AS portion_net_weight_kg,
  p.second_weight_at AS portion_weighed_at,
  g.entry_timestamp AS gate_in_at,
  g.exit_timestamp AS gate_out_at,
  g.tanker_washed,
  wt.ticket_number AS weight_ticket_number,
  wt.gross_timestamp AS first_weight_at,
  wt.tare_timestamp AS second_weight_at,
  ul.silo_number,
  ul.pump_start_timestamp AS unloading_started_at,
  ul.pump_end_timestamp AS unloading_finished_at,
  fdr.received_gross_liters,
  fdr.gross_variance_liters,
  fdr.gross_variance_percent,
  fdr.at_13ts_variance_liters,
  fdr.at_13ts_variance_percent,
  fdr.reconciled_at
FROM vw_vehicle_portion_report r
JOIN vehicle_visit v ON v.id = r.visit_id
JOIN visit_portion p ON p.id = r.portion_id
LEFT JOIN procurement_source ps ON ps.id = v.procurement_source_id
LEFT JOIN gate_log g ON g.visit_id = v.id
LEFT JOIN weight_ticket wt ON wt.visit_id = v.id
LEFT JOIN unloading_log ul ON ul.portion_id = p.id
LEFT JOIN plant_final_dual_reconciliation fdr ON fdr.visit_id = v.id;
