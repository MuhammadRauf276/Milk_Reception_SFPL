-- CreateTable
CREATE TABLE lab_test_assignment (
    id BIGSERIAL NOT NULL,
    visit_id BIGINT NOT NULL,
    workflow VARCHAR(50) NOT NULL,
    test_id BIGINT NOT NULL,
    test_code_snapshot VARCHAR(50) NOT NULL,
    test_name_snapshot VARCHAR(150) NOT NULL,
    result_type_snapshot VARCHAR(20) NOT NULL,
    unit_snapshot VARCHAR(30),
    test_scope_snapshot VARCHAR(20),
    is_required_snapshot BOOLEAN NOT NULL DEFAULT true,
    display_order_snapshot INTEGER NOT NULL DEFAULT 0,
    assigned_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT lab_test_assignment_pkey PRIMARY KEY (id)
);

-- CreateIndex
CREATE INDEX lab_test_assignment_visit_id_workflow_idx ON lab_test_assignment(visit_id, workflow);

-- CreateIndex
CREATE UNIQUE INDEX lab_test_assignment_visit_id_workflow_test_id_key ON lab_test_assignment(visit_id, workflow, test_id);

-- AddForeignKey
ALTER TABLE lab_test_assignment ADD CONSTRAINT lab_test_assignment_visit_id_fkey FOREIGN KEY (visit_id) REFERENCES vehicle_visit(id) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE lab_test_assignment ADD CONSTRAINT lab_test_assignment_test_id_fkey FOREIGN KEY (test_id) REFERENCES lab_test(id) ON DELETE RESTRICT ON UPDATE CASCADE;
