ALTER TABLE "milk_test_policy_assignment"
  ADD COLUMN "source_applicability" JSONB;

COMMENT ON COLUMN "milk_test_policy_assignment"."source_applicability" IS
  'Optional explicit source applicability. Null means all sources permitted for the testing point.';
