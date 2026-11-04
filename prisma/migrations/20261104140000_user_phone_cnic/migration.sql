-- Phone and CNIC on every user. Additive and safe to repeat: fix_vm_db.js may already have added these columns.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "phone" VARCHAR(50);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "cnic" VARCHAR(50);
