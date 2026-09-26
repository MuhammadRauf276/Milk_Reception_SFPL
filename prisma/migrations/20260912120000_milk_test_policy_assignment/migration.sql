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

-- 4. Deterministic legacy role migration (Section 11)
-- A. MPD_Operator and MPD with ZMCC source -> ZMCC_LAB_ATTENDANT
UPDATE users u
SET role = 'ZMCC_LAB_ATTENDANT', updated_at = CURRENT_TIMESTAMP
FROM procurement_source ps
WHERE u.procurement_source_id = ps.id
  AND ps.source_type = 'ZMCC'
  AND u.role IN ('MPD_Operator', 'MPD');

-- B. MPD_Operator and MPD with CONTRACTOR source -> CONTRACTOR_OPERATOR
UPDATE users u
SET role = 'CONTRACTOR_OPERATOR', updated_at = CURRENT_TIMESTAMP
FROM procurement_source ps
WHERE u.procurement_source_id = ps.id
  AND ps.source_type = 'CONTRACTOR'
  AND u.role IN ('MPD_Operator', 'MPD');

-- C. Ambiguous / unassigned MPD_Operator or MPD -> deactivate
UPDATE users
SET is_active = false, updated_at = CURRENT_TIMESTAMP
WHERE role IN ('MPD_Operator', 'MPD');

-- D. MPD_Zone_Manager with ZMCC source -> ZMCC_MANAGER
UPDATE users u
SET role = 'ZMCC_MANAGER', updated_at = CURRENT_TIMESTAMP
FROM procurement_source ps
WHERE u.procurement_source_id = ps.id
  AND ps.source_type = 'ZMCC'
  AND u.role = 'MPD_Zone_Manager';

-- E. Other MPD_Zone_Manager -> deactivate
UPDATE users
SET is_active = false, updated_at = CURRENT_TIMESTAMP
WHERE role = 'MPD_Zone_Manager';

-- F. QA_Operator / QA -> QA_LAB_ATTENDANT
UPDATE users
SET role = 'QA_LAB_ATTENDANT', updated_at = CURRENT_TIMESTAMP
WHERE role IN ('QA_Operator', 'QA');

-- G. QA_Manager -> QA_MANAGER
UPDATE users
SET role = 'QA_MANAGER', updated_at = CURRENT_TIMESTAMP
WHERE role = 'QA_Manager';

-- H. Production_Manager -> PRODUCTION_HEAD
UPDATE users
SET role = 'PRODUCTION_HEAD', updated_at = CURRENT_TIMESTAMP
WHERE role = 'Production_Manager';

-- I. Production_Operator / Production -> PRODUCTION_RECEPTION_OPERATOR
UPDATE users
SET role = 'PRODUCTION_RECEPTION_OPERATOR', updated_at = CURRENT_TIMESTAMP
WHERE role IN ('Production_Operator', 'Production');

-- J. Security_Operator -> SECURITY_OPERATOR
UPDATE users
SET role = 'SECURITY_OPERATOR', updated_at = CURRENT_TIMESTAMP
WHERE role = 'Security_Operator';

-- K. Security_Manager -> ADMIN_HEAD
UPDATE users
SET role = 'ADMIN_HEAD', updated_at = CURRENT_TIMESTAMP
WHERE role = 'Security_Manager';

-- L. Weighbridge_Operator -> WEIGHBRIDGE_OPERATOR
UPDATE users
SET role = 'WEIGHBRIDGE_OPERATOR', updated_at = CURRENT_TIMESTAMP
WHERE role = 'Weighbridge_Operator';

-- M. Admin -> SUPER_ADMIN only for system admin accounts, otherwise deactivate
UPDATE users
SET role = 'SUPER_ADMIN', updated_at = CURRENT_TIMESTAMP
WHERE role = 'Admin' AND username IN ('admin.superuser', 'admin');

UPDATE users
SET is_active = false, updated_at = CURRENT_TIMESTAMP
WHERE role = 'Admin';

-- N. Unmapped legacy roles -> deactivate and fail closed
UPDATE users
SET is_active = false, updated_at = CURRENT_TIMESTAMP
WHERE role IN ('General_Plant_Manager', 'Correction_Officer', 'Management', 'Security_Weight');

-- O. Wasim Sahib canonicalization: only when linked to a CONTRACTOR ProcurementSource
UPDATE users u
SET full_name = 'Wasim Sahib', role = 'CONTRACTOR_OPERATOR', updated_at = CURRENT_TIMESTAMP
FROM procurement_source ps
WHERE u.username = 'contractor.operator.alkhair'
  AND u.procurement_source_id = ps.id
  AND ps.source_type = 'CONTRACTOR';

UPDATE users u
SET is_active = false, updated_at = CURRENT_TIMESTAMP
WHERE u.username = 'contractor.operator.alkhair'
  AND (
    u.procurement_source_id IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM procurement_source ps
      WHERE ps.id = u.procurement_source_id AND ps.source_type = 'CONTRACTOR'
    )
  );