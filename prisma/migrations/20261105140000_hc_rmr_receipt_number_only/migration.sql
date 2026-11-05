-- The HC raw milk receipt follows the shop receipt: one number from the paper, digits only, which may repeat because it
-- is not a system ID. Series and book number are nobody's knowledge, so they are no longer needed. One vehicle arrival
-- still gets one receipt (its own unique index stays).
ALTER TABLE "local_supplier_rmr_issuance" ALTER COLUMN "series" DROP NOT NULL;
ALTER TABLE "local_supplier_rmr_issuance" ALTER COLUMN "book_number" DROP NOT NULL;

DROP INDEX IF EXISTS "local_supplier_rmr_paper_identity_key";
CREATE INDEX "local_supplier_rmr_issuance_zmcc_id_receipt_number_idx" ON "local_supplier_rmr_issuance"("zmcc_id", "receipt_number");
