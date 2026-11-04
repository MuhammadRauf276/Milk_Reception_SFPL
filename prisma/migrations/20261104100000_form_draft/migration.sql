-- Server-side drafts for the stage forms (additive: one new table, nothing existing is changed).
CREATE TABLE "form_draft" (
    "id" BIGSERIAL NOT NULL,
    "form_type" VARCHAR(40) NOT NULL,
    "scope_id" BIGINT NOT NULL,
    "portion_key" VARCHAR(64) NOT NULL,
    "user_id" BIGINT NOT NULL,
    "content" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "form_draft_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "form_draft_form_type_scope_id_portion_key_user_id_key" ON "form_draft"("form_type", "scope_id", "portion_key", "user_id");
CREATE INDEX "form_draft_form_type_scope_id_portion_key_idx" ON "form_draft"("form_type", "scope_id", "portion_key");
CREATE INDEX "form_draft_updated_at_idx" ON "form_draft"("updated_at");

ALTER TABLE "form_draft" ADD CONSTRAINT "form_draft_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
