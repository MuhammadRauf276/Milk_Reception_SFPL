-- Rename declared_quantity_kg to declared_quantity_value non-destructively
ALTER TABLE "visit_portion" RENAME COLUMN "declared_quantity_kg" TO "declared_quantity_value";
