-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "action" VARCHAR(100) NOT NULL,
    "actor" VARCHAR(50) NOT NULL,
    "target_type" VARCHAR(50),
    "target_id" VARCHAR(200),
    "request_id" VARCHAR(100),
    "ip" VARCHAR(45),
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_audit_log_action" ON "audit_log"("action");

-- CreateIndex
CREATE INDEX "idx_audit_log_actor" ON "audit_log"("actor");

-- CreateIndex
CREATE INDEX "idx_audit_log_created_at" ON "audit_log"("created_at" DESC);
