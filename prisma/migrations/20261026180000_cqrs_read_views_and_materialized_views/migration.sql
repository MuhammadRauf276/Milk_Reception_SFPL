-- 1. Covering indexes on base tables for high-throughput zero-lock read views
CREATE INDEX IF NOT EXISTS idx_mot_journey_zmcc_date ON mot_journey(zmcc_id, operational_date DESC);
CREATE INDEX IF NOT EXISTS idx_mot_shop_coll_journey_ts ON mot_shop_collection(journey_id, device_collected_at);
CREATE INDEX IF NOT EXISTS idx_zmcc_supplier_arrival_zmcc_date ON zmcc_local_supplier_arrival(zmcc_id, arrival_date DESC);

-- 2. Standard View: vw_mot_collection_feed
DROP VIEW IF EXISTS vw_mot_collection_feed CASCADE;
CREATE VIEW vw_mot_collection_feed AS
SELECT
  c.id AS collection_id,
  c.collection_number,
  c.journey_id,
  j.journey_number,
  j.status AS journey_status,
  c.zmcc_id,
  z.code AS zmcc_code,
  z.name AS zmcc_name,
  c.route_id,
  r.route_code,
  r.name AS route_name,
  c.mot_vehicle_id,
  v.vehicle_number,
  c.mot_profile_id,
  p.name AS mot_driver_name,
  c.shop_id,
  s.shop_code,
  s.shop_name,
  s.owner_name,
  c.operational_date,
  c.quantity_value,
  c.quantity_unit,
  c.gross_liters,
  c.density,
  c.lr,
  c.fat,
  c.snf,
  c.ts,
  c.at_13ts_liters,
  c.final_decision,
  c.device_collected_at,
  c.shop_rmr_number,
  c.collection_notes,
  c.collection_latitude,
  c.collection_longitude,
  c.created_at
FROM mot_shop_collection c
JOIN mot_journey j ON j.id = c.journey_id
JOIN procurement_source z ON z.id = c.zmcc_id
JOIN zmcc_route r ON r.id = c.route_id
JOIN mot_vehicle v ON v.id = c.mot_vehicle_id
JOIN mot_profile p ON p.id = c.mot_profile_id
JOIN zmcc_shop s ON s.id = c.shop_id;

-- 3. Standard View: vw_hc_supplier_inward_feed
DROP VIEW IF EXISTS vw_hc_supplier_inward_feed CASCADE;
CREATE VIEW vw_hc_supplier_inward_feed AS
SELECT
  a.id AS arrival_id,
  a.zmcc_id,
  z.code AS zmcc_code,
  z.name AS zmcc_name,
  a.arrival_date,
  a.arrival_timestamp,
  a.zmcc_token,
  a.raw_milk_token_number,
  a.rmr_number AS arrival_rmr_number,
  a.vehicle_number,
  a.local_supplier_id,
  ls.local_supplier_code,
  ls.name AS supplier_name,
  ls.phone AS supplier_phone,
  ls.cnic AS supplier_cnic,
  ls.is_active AS supplier_active,
  lab.id AS lab_session_id,
  lab.status AS lab_status,
  lab.decision AS lab_decision,
  lab.final_decision,
  lab.gross_liters AS accepted_gross_liters,
  lab.density,
  lab.snf,
  lab.ts,
  lab.at_13ts_liters,
  lab.completed_at AS lab_completed_at,
  rmr.id AS rmr_id,
  rmr.rmr_year,
  rmr.series AS rmr_series,
  rmr.book_number AS rmr_book_number,
  rmr.receipt_number AS rmr_receipt_number,
  rmr.accepted_quantity_value AS rmr_quantity_value,
  rmr.status::text AS rmr_status,
  rmr.issued_at AS rmr_issued_at
FROM zmcc_local_supplier_arrival a
JOIN procurement_source z ON z.id = a.zmcc_id
JOIN zmcc_local_supplier ls ON ls.id = a.local_supplier_id
LEFT JOIN zmcc_lab_session lab ON lab.local_supplier_arrival_id = a.id
LEFT JOIN local_supplier_rmr_issuance rmr ON rmr.local_supplier_arrival_id = a.id;

-- 4. Materialized View: mv_daily_procurement_rollup
DROP MATERIALIZED VIEW IF EXISTS mv_daily_procurement_rollup CASCADE;
CREATE MATERIALIZED VIEW mv_daily_procurement_rollup AS
SELECT
  j.zmcc_id,
  z.code AS zmcc_code,
  z.name AS zmcc_name,
  j.operational_date::date AS operational_date,
  j.route_id,
  r.route_code,
  r.name AS route_name,
  COUNT(DISTINCT j.id)::int AS journey_count,
  COUNT(c.id)::int AS total_shop_collections,
  ROUND(COALESCE(SUM(c.gross_liters), 0)::numeric, 2) AS total_gross_liters,
  ROUND(COALESCE(SUM(c.at_13ts_liters), 0)::numeric, 2) AS total_at_13ts_liters,
  ROUND((SUM(c.gross_liters * c.fat) / NULLIF(SUM(c.gross_liters), 0))::numeric, 2) AS avg_fat_percentage,
  ROUND((SUM(c.gross_liters * c.lr) / NULLIF(SUM(c.gross_liters), 0))::numeric, 2) AS avg_lr_reading,
  ROUND((SUM(c.gross_liters * c.snf) / NULLIF(SUM(c.gross_liters), 0))::numeric, 2) AS avg_snf_percentage
FROM mot_journey j
JOIN procurement_source z ON z.id = j.zmcc_id
JOIN zmcc_route r ON r.id = j.route_id
JOIN mot_shop_collection c ON c.journey_id = j.id
GROUP BY j.zmcc_id, z.code, z.name, j.operational_date::date, j.route_id, r.route_code, r.name
WITH DATA;

CREATE UNIQUE INDEX idx_mv_daily_proc_unique ON mv_daily_procurement_rollup(zmcc_id, operational_date, route_id);
CREATE INDEX idx_mv_daily_proc_date ON mv_daily_procurement_rollup(operational_date DESC);
CREATE INDEX idx_mv_daily_proc_route ON mv_daily_procurement_rollup(route_id);

-- 5. Materialized View: mv_plant_transit_reconciliation
DROP MATERIALIZED VIEW IF EXISTS mv_plant_transit_reconciliation CASCADE;
CREATE MATERIALIZED VIEW mv_plant_transit_reconciliation AS
SELECT
  v.id AS visit_id,
  v.visit_number,
  v.reception_number,
  v.vehicle_number,
  v.procurement_source_id AS zmcc_id,
  ps.code AS zmcc_code,
  ps.name AS zmcc_name,
  v.operational_date,
  v.current_status,
  v.vehicle_dispatch_gross_liters AS dispatch_gross_liters,
  v.vehicle_dispatch_fat AS dispatch_fat,
  v.vehicle_dispatch_lr AS dispatch_lr,
  v.vehicle_dispatch_snf AS dispatch_snf,
  v.vehicle_dispatch_at_13ts_liters AS dispatch_at_13ts_liters,
  fdr.sent_gross_liters,
  fdr.received_gross_liters,
  fdr.gross_variance_liters,
  fdr.gross_variance_percent,
  fdr.sent_at_13ts_liters,
  fdr.received_at_13ts_liters,
  fdr.at_13ts_variance_liters,
  fdr.at_13ts_variance_percent,
  fdr.reconciled_at,
  v.created_at
FROM vehicle_visit v
JOIN procurement_source ps ON ps.id = v.procurement_source_id
LEFT JOIN plant_final_dual_reconciliation fdr ON fdr.visit_id = v.id
WITH DATA;

CREATE UNIQUE INDEX idx_mv_transit_rec_unique ON mv_plant_transit_reconciliation(visit_id);
CREATE INDEX idx_mv_transit_rec_source_date ON mv_plant_transit_reconciliation(zmcc_id, operational_date DESC);
