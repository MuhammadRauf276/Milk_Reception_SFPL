-- AlterTable
ALTER TABLE "users" ADD COLUMN "email" VARCHAR(254);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_lower_uidx" ON "users" (LOWER("email")) WHERE "email" IS NOT NULL;
