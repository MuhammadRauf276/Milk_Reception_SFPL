-- Return to PHE saved a status this rule did not allow, so every return failed.
ALTER TABLE "mot_journey" DROP CONSTRAINT "ck_mot_journey_status_valid";
ALTER TABLE "mot_journey" ADD CONSTRAINT "ck_mot_journey_status_valid"
  CHECK ("status" IN ('COLLECTING', 'RETURNING', 'ARRIVED', 'COMPLETED', 'CANCELLED'));

-- Vehicle problem on the road: the MOT asks, the Zonal Manager gives a replacement vehicle.
CREATE TABLE "mot_vehicle_change_request" (
    "id" BIGSERIAL NOT NULL,
    "journey_id" BIGINT NOT NULL,
    "zmcc_id" BIGINT NOT NULL,
    "from_vehicle_id" BIGINT NOT NULL,
    "to_vehicle_id" BIGINT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "reason" TEXT NOT NULL,
    "requested_by" BIGINT NOT NULL,
    "requested_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_by" BIGINT,
    "decided_at" TIMESTAMP(6),
    "decision_note" TEXT,
    "visited_shops" JSONB,
    "carried_gross_liters" DECIMAL(12,2),

    CONSTRAINT "mot_vehicle_change_request_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ck_mot_vehicle_change_status" CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED'))
);

CREATE INDEX "mot_vehicle_change_request_journey_id_idx" ON "mot_vehicle_change_request"("journey_id");
CREATE INDEX "mot_vehicle_change_request_zmcc_id_status_idx" ON "mot_vehicle_change_request"("zmcc_id", "status");
-- One open request per journey.
CREATE UNIQUE INDEX "idx_mot_vehicle_change_one_pending" ON "mot_vehicle_change_request"("journey_id") WHERE "status" = 'PENDING';

ALTER TABLE "mot_vehicle_change_request" ADD CONSTRAINT "mot_vehicle_change_request_journey_id_fkey" FOREIGN KEY ("journey_id") REFERENCES "mot_journey"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mot_vehicle_change_request" ADD CONSTRAINT "mot_vehicle_change_request_from_vehicle_id_fkey" FOREIGN KEY ("from_vehicle_id") REFERENCES "mot_vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mot_vehicle_change_request" ADD CONSTRAINT "mot_vehicle_change_request_to_vehicle_id_fkey" FOREIGN KEY ("to_vehicle_id") REFERENCES "mot_vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "mot_vehicle_change_request" ADD CONSTRAINT "mot_vehicle_change_request_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mot_vehicle_change_request" ADD CONSTRAINT "mot_vehicle_change_request_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
