-- Migration: 20260912120000_milk_test_policy_assignment
-- Stage 6G-A: Central Milk Test Policy and Head of MPD Authority

-- 1. Create Table: milk_test_policy_assignment
CREATE TABLE milk_test_policy_assignment (
    id BIGSERIAL NOT NULL,
    lab_test_id BIGINT NOT NULL,
    testing_point VARCHAR(50) NOT NULL,
    is_required BOOLEAN NOT NULL DEFAULT true,
    display_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_by_user_id BIGINT NOT NULL,
    updated_by_user_id BIGINT,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT milk_test_policy_assignment_pkey PRIMARY KEY (id),
    CONSTRAINT chk_milk_test_policy_testing_point CHECK (
        testing_point IN ('MOT_SHOP', 'ZMCC_LAB_MOT', 'ZMCC_LAB_CONTRACTOR', 'DISPATCH', 'PLANT_QA')
    )
);

-- 2. Unique constraints & indexes
CREATE UNIQUE INDEX milk_test_policy_assignment_lab_test_id_testing_point_key ON milk_test_policy_assignment(lab_test_id, testing_point);
CREATE INDEX milk_test_policy_assignment_testing_point_is_active_idx ON milk_test_policy_assignment(testing_point, is_active);

-- 3. Foreign key constraints
ALTER TABLE milk_test_policy_assignment ADD CONSTRAINT milk_test_policy_assignment_lab_test_id_fkey FOREIGN KEY (lab_test_id) REFERENCES lab_test(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE milk_test_policy_assignment ADD CONSTRAINT milk_test_policy_assignment_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE milk_test_policy_assignment ADD CONSTRAINT milk_test_policy_assignment_updated_by_user_id_fkey FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE;