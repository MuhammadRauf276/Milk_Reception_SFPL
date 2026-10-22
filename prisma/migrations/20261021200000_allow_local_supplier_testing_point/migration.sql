-- Allow ZMCC_LAB_LOCAL_SUPPLIER in milk_test_policy_assignment testing_point check constraint
ALTER TABLE "milk_test_policy_assignment"
DROP CONSTRAINT IF EXISTS "chk_milk_test_policy_testing_point";

ALTER TABLE "milk_test_policy_assignment"
ADD CONSTRAINT "chk_milk_test_policy_testing_point"
CHECK (testing_point IN ('MOT_SHOP', 'ZMCC_LAB_MOT', 'ZMCC_LAB_LOCAL_SUPPLIER', 'ZMCC_LAB_CONTRACTOR', 'DISPATCH', 'PLANT_QA'));
