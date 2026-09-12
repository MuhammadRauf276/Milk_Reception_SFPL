-- Migration: 20260912180000_mot_journey_summary
-- Stage 6G-B: MOT Journey Final Summary

-- 1. Create Table: mot_journey_summary
CREATE TABLE mot_journey_summary (
    id BIGSERIAL NOT NULL,
    journey_id BIGINT NOT NULL,
    journey_ended_at TIMESTAMP(6) NOT NULL,
    assigned_shop_count INTEGER NOT NULL,
    collected_shop_count INTEGER NOT NULL,
    skipped_shop_count INTEGER NOT NULL,
    pending_shop_count INTEGER NOT NULL,
    total_gross_liters DECIMAL(12, 2) NOT NULL,
    total_at_13ts_liters DECIMAL(12, 2) NOT NULL,
    weighted_avg_lr DECIMAL(6, 2),
    weighted_avg_fat DECIMAL(6, 2),
    weighted_avg_snf DECIMAL(6, 2),
    weighted_avg_ts DECIMAL(6, 2),
    summary_version VARCHAR(20) NOT NULL DEFAULT '1.0',
    source_calculation_versions JSONB NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    generated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_recomputed_at TIMESTAMP(6),

    CONSTRAINT mot_journey_summary_pkey PRIMARY KEY (id),
    CONSTRAINT chk_mot_journey_summary_revision CHECK (revision >= 1),
    CONSTRAINT chk_mot_journey_summary_counts CHECK (
        assigned_shop_count >= 0 AND
        collected_shop_count >= 0 AND
        skipped_shop_count >= 0 AND
        pending_shop_count >= 0
    ),
    CONSTRAINT chk_mot_journey_summary_totals CHECK (
        total_gross_liters >= 0 AND
        total_at_13ts_liters >= 0
    )
);

-- 2. Unique index & search index
CREATE UNIQUE INDEX mot_journey_summary_journey_id_key ON mot_journey_summary(journey_id);
CREATE INDEX mot_journey_summary_journey_id_idx ON mot_journey_summary(journey_id);

-- 3. Foreign key constraints
ALTER TABLE mot_journey_summary ADD CONSTRAINT mot_journey_summary_journey_id_fkey FOREIGN KEY (journey_id) REFERENCES mot_journey(id) ON DELETE RESTRICT ON UPDATE CASCADE;
