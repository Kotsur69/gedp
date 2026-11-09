-- CreateEnum
CREATE TYPE "CycleStatus" AS ENUM ('PRZYGOTOWANIE', 'OTWARTY', 'ZAMKNIETY');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('SZKIC', 'DO_WALIDACJI', 'ZWROCONY', 'ZATWIERDZONY');

-- CreateEnum
CREATE TYPE "GroupGoalType" AS ENUM ('PRZYWODZTWO', 'WARTOSCI', 'BHP');

-- CreateEnum
CREATE TYPE "GoalState" AS ENUM ('SZKIC', 'W_PLANIE', 'ANULOWANY');

-- CreateEnum
CREATE TYPE "ImportKind" AS ENUM ('STRUKTURA', 'CELE_I_DOKUMENTY');

-- CreateTable
CREATE TABLE "employee" (
    "id" SERIAL NOT NULL,
    "amei" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "manager_id" INTEGER,
    "validator_override_id" INTEGER,
    "department" TEXT,
    "position" TEXT,
    "location" TEXT,
    "is_white_collar" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_hr_admin" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_hierarchy" (
    "ancestor_id" INTEGER NOT NULL,
    "descendant_id" INTEGER NOT NULL,
    "depth" INTEGER NOT NULL,

    CONSTRAINT "employee_hierarchy_pkey" PRIMARY KEY ("ancestor_id","descendant_id")
);

-- CreateTable
CREATE TABLE "cycle" (
    "id" SERIAL NOT NULL,
    "year" INTEGER NOT NULL,
    "status" "CycleStatus" NOT NULL DEFAULT 'PRZYGOTOWANIE',
    "goal_setting_opens_at" DATE,
    "goal_setting_closes_at" DATE,
    "min_performance_goals" INTEGER NOT NULL DEFAULT 1,
    "required_weight_sum" INTEGER NOT NULL DEFAULT 100,
    "min_development_goals" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_goal_template" (
    "id" SERIAL NOT NULL,
    "cycle_id" INTEGER NOT NULL,
    "type" "GroupGoalType" NOT NULL,
    "content_pl" TEXT NOT NULL,
    "content_en" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,

    CONSTRAINT "group_goal_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competency" (
    "id" SERIAL NOT NULL,
    "cycle_id" INTEGER NOT NULL,
    "name_pl" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "competency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "development_area" (
    "id" SERIAL NOT NULL,
    "cycle_id" INTEGER NOT NULL,
    "name_pl" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "development_area_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "target_type" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name_pl" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "is_numeric" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "target_type_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gedp_document" (
    "id" SERIAL NOT NULL,
    "employee_id" INTEGER NOT NULL,
    "cycle_id" INTEGER NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'SZKIC',
    "validator_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gedp_document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_goal_ack" (
    "id" SERIAL NOT NULL,
    "document_id" INTEGER NOT NULL,
    "template_id" INTEGER NOT NULL,
    "acknowledged_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hs_commitment" TEXT,

    CONSTRAINT "group_goal_ack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "performance_goal" (
    "id" SERIAL NOT NULL,
    "document_id" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "measures" TEXT,
    "target_type_id" INTEGER,
    "target_value" TEXT,
    "due_date" DATE,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "weight" INTEGER,
    "state" "GoalState" NOT NULL DEFAULT 'SZKIC',
    "changed_by_manager" BOOLEAN NOT NULL DEFAULT false,
    "cascaded_from_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "performance_goal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "development_goal" (
    "id" SERIAL NOT NULL,
    "document_id" INTEGER NOT NULL,
    "development_area_id" INTEGER,
    "competency_id" INTEGER,
    "action_title" TEXT NOT NULL,
    "action_description" TEXT,
    "start_date" DATE,
    "end_date" DATE,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "state" "GoalState" NOT NULL DEFAULT 'SZKIC',
    "changed_by_manager" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "development_goal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_status_history" (
    "id" SERIAL NOT NULL,
    "document_id" INTEGER NOT NULL,
    "from_status" "DocumentStatus",
    "to_status" "DocumentStatus" NOT NULL,
    "author_id" INTEGER NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_block" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "content_pl" TEXT NOT NULL,
    "content_en" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_block_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcement_seen" (
    "employee_id" INTEGER NOT NULL,
    "content_version" INTEGER NOT NULL,
    "seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "announcement_seen_pkey" PRIMARY KEY ("employee_id","content_version")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" BIGSERIAL NOT NULL,
    "actor_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "entity" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_batch" (
    "id" SERIAL NOT NULL,
    "file_name" TEXT NOT NULL,
    "author_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" "ImportKind" NOT NULL,
    "scope" JSONB,
    "new_count" INTEGER NOT NULL DEFAULT 0,
    "changed_count" INTEGER NOT NULL DEFAULT 0,
    "deactivated_count" INTEGER NOT NULL DEFAULT 0,
    "error_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "import_batch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "employee_amei_key" ON "employee"("amei");

-- CreateIndex
CREATE UNIQUE INDEX "employee_email_key" ON "employee"("email");

-- CreateIndex
CREATE INDEX "employee_manager_id_idx" ON "employee"("manager_id");

-- CreateIndex
CREATE INDEX "employee_hierarchy_descendant_id_idx" ON "employee_hierarchy"("descendant_id");

-- CreateIndex
CREATE UNIQUE INDEX "cycle_year_key" ON "cycle"("year");

-- CreateIndex
CREATE UNIQUE INDEX "group_goal_template_cycle_id_sort_order_key" ON "group_goal_template"("cycle_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "competency_cycle_id_name_pl_key" ON "competency"("cycle_id", "name_pl");

-- CreateIndex
CREATE UNIQUE INDEX "competency_cycle_id_name_en_key" ON "competency"("cycle_id", "name_en");

-- CreateIndex
CREATE UNIQUE INDEX "development_area_cycle_id_name_pl_key" ON "development_area"("cycle_id", "name_pl");

-- CreateIndex
CREATE UNIQUE INDEX "development_area_cycle_id_name_en_key" ON "development_area"("cycle_id", "name_en");

-- CreateIndex
CREATE UNIQUE INDEX "target_type_code_key" ON "target_type"("code");

-- CreateIndex
CREATE INDEX "gedp_document_cycle_id_status_idx" ON "gedp_document"("cycle_id", "status");

-- CreateIndex
CREATE INDEX "gedp_document_validator_id_idx" ON "gedp_document"("validator_id");

-- CreateIndex
CREATE UNIQUE INDEX "gedp_document_employee_id_cycle_id_key" ON "gedp_document"("employee_id", "cycle_id");

-- CreateIndex
CREATE UNIQUE INDEX "group_goal_ack_document_id_template_id_key" ON "group_goal_ack"("document_id", "template_id");

-- CreateIndex
CREATE INDEX "performance_goal_document_id_idx" ON "performance_goal"("document_id");

-- CreateIndex
CREATE INDEX "development_goal_document_id_idx" ON "development_goal"("document_id");

-- CreateIndex
CREATE INDEX "document_status_history_document_id_created_at_idx" ON "document_status_history"("document_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "content_block_key_version_key" ON "content_block"("key", "version");

-- CreateIndex
CREATE INDEX "audit_log_entity_entity_id_idx" ON "audit_log"("entity", "entity_id");

-- CreateIndex
CREATE INDEX "audit_log_actor_id_idx" ON "audit_log"("actor_id");

-- CreateIndex
CREATE INDEX "audit_log_created_at_idx" ON "audit_log"("created_at");

-- CreateIndex
CREATE INDEX "import_batch_created_at_idx" ON "import_batch"("created_at");

-- AddForeignKey
ALTER TABLE "employee" ADD CONSTRAINT "employee_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee" ADD CONSTRAINT "employee_validator_override_id_fkey" FOREIGN KEY ("validator_override_id") REFERENCES "employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_hierarchy" ADD CONSTRAINT "employee_hierarchy_ancestor_id_fkey" FOREIGN KEY ("ancestor_id") REFERENCES "employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_hierarchy" ADD CONSTRAINT "employee_hierarchy_descendant_id_fkey" FOREIGN KEY ("descendant_id") REFERENCES "employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_goal_template" ADD CONSTRAINT "group_goal_template_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "cycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competency" ADD CONSTRAINT "competency_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "cycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "development_area" ADD CONSTRAINT "development_area_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "cycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gedp_document" ADD CONSTRAINT "gedp_document_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gedp_document" ADD CONSTRAINT "gedp_document_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "cycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gedp_document" ADD CONSTRAINT "gedp_document_validator_id_fkey" FOREIGN KEY ("validator_id") REFERENCES "employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_goal_ack" ADD CONSTRAINT "group_goal_ack_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "gedp_document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_goal_ack" ADD CONSTRAINT "group_goal_ack_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "group_goal_template"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_goal" ADD CONSTRAINT "performance_goal_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "gedp_document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_goal" ADD CONSTRAINT "performance_goal_target_type_id_fkey" FOREIGN KEY ("target_type_id") REFERENCES "target_type"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_goal" ADD CONSTRAINT "performance_goal_cascaded_from_id_fkey" FOREIGN KEY ("cascaded_from_id") REFERENCES "performance_goal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "development_goal" ADD CONSTRAINT "development_goal_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "gedp_document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "development_goal" ADD CONSTRAINT "development_goal_development_area_id_fkey" FOREIGN KEY ("development_area_id") REFERENCES "development_area"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "development_goal" ADD CONSTRAINT "development_goal_competency_id_fkey" FOREIGN KEY ("competency_id") REFERENCES "competency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_status_history" ADD CONSTRAINT "document_status_history_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "gedp_document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_status_history" ADD CONSTRAINT "document_status_history_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement_seen" ADD CONSTRAINT "announcement_seen_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
