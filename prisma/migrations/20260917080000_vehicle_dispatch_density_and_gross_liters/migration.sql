-- AlterTable: Add vehicle_dispatch_lr, vehicle_dispatch_density, vehicle_dispatch_gross_liters to vehicle_visit
ALTER TABLE "vehicle_visit" ADD COLUMN IF NOT EXISTS "vehicle_dispatch_lr" DECIMAL(6, 2);
ALTER TABLE "vehicle_visit" ADD COLUMN IF NOT EXISTS "vehicle_dispatch_density" DECIMAL(6, 4);
ALTER TABLE "vehicle_visit" ADD COLUMN IF NOT EXISTS "vehicle_dispatch_gross_liters" DECIMAL(12, 2);
