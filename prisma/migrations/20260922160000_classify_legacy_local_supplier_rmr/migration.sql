-- Preserve and classify legacy Local Supplier RMR strings without treating them
-- as authoritative structured issuances.

CREATE TYPE "LocalSupplierRmrLegacyDisposition" AS ENUM (
  'NEEDS_REVIEW',
  'VERIFIED_HISTORICAL',
  'DUPLICATE_VALUE',
  'INVALID_VALUE'
);

CREATE TABLE "local_supplier_rmr_legacy_classification" (
    "id" BIGSERIAL NOT NULL,
    "local_supplier_arrival_id" BIGINT NOT NULL,
    "legacy_value" VARCHAR(100) NOT NULL,
    "classification" "LocalSupplierRmrLegacyDisposition" NOT NULL DEFAULT 'NEEDS_REVIEW',
    "classification_reason" TEXT NOT NULL,
    "reviewed_by_user_id" BIGINT,
    "reviewed_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "local_supplier_rmr_legacy_classification_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "local_supplier_rmr_legacy_review_state_check" CHECK (
      ("classification" = 'NEEDS_REVIEW' AND "reviewed_by_user_id" IS NULL AND "reviewed_at" IS NULL)
      OR
      ("classification" <> 'NEEDS_REVIEW' AND "reviewed_by_user_id" IS NOT NULL AND "reviewed_at" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "local_supplier_rmr_legacy_classification_arrival_key" ON "local_supplier_rmr_legacy_classification"("local_supplier_arrival_id");
CREATE INDEX "local_supplier_rmr_legacy_classification_status_idx" ON "local_supplier_rmr_legacy_classification"("classification", "created_at");

ALTER TABLE "local_supplier_rmr_legacy_classification" ADD CONSTRAINT "local_supplier_rmr_legacy_classification_arrival_fkey" FOREIGN KEY ("local_supplier_arrival_id") REFERENCES "zmcc_local_supplier_arrival"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "local_supplier_rmr_legacy_classification" ADD CONSTRAINT "local_supplier_rmr_legacy_classification_reviewer_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "local_supplier_rmr_legacy_classification" (
  "local_supplier_arrival_id",
  "legacy_value",
  "classification",
  "classification_reason"
)
SELECT
  "id",
  btrim("rmr_number"),
  'NEEDS_REVIEW'::"LocalSupplierRmrLegacyDisposition",
  'Imported from the legacy arrival rmr_number field; requires manual evidence review before historical verification.'
FROM "zmcc_local_supplier_arrival"
WHERE "rmr_number" IS NOT NULL
  AND length(btrim("rmr_number")) > 0
ON CONFLICT ("local_supplier_arrival_id") DO NOTHING;
