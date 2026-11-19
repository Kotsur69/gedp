-- HR-05: cycle configuration in the HR panel.
--  1. target_type becomes part of a cycle (cycle_id, sort_order), so "new cycle as a copy of the
--     previous one" yields an independent list. Existing global types are copied into every cycle
--     and each performance goal is re-pointed to the copy in its own document's cycle (same code).
--  2. At most one cycle may be OTWARTY (partial unique index), whatever the application does.
-- Columns only: target_type already has RLS and the gedp_app policy (20261113090000_rls_lockdown).

-- Fail with a readable message instead of a bare unique violation when the data breaks rule 2.
DO $$
BEGIN
  IF (SELECT count(*) FROM "cycle" WHERE "status" = 'OTWARTY') > 1 THEN
    RAISE EXCEPTION 'HR-05 migration: more than one cycle is OTWARTY; close all but one before migrating';
  END IF;
END
$$;

ALTER TABLE "target_type" ADD COLUMN "cycle_id" INTEGER,
ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 0;

-- The global unique code must go before the per-cycle copies below repeat every code.
DROP INDEX "target_type_code_key";

-- The previous list had no order column; rows were created in display order, so id order is kept.
UPDATE "target_type" t
SET "sort_order" = ranked.position
FROM (SELECT "id", (row_number() OVER (ORDER BY "id"))::int AS position FROM "target_type") ranked
WHERE t."id" = ranked."id";

-- The existing rows go to the oldest cycle; every other cycle gets its own copy.
UPDATE "target_type" SET "cycle_id" = (SELECT min("id") FROM "cycle");

INSERT INTO "target_type" ("cycle_id", "code", "name_pl", "name_en", "is_numeric", "is_active", "sort_order")
SELECT c."id", t."code", t."name_pl", t."name_en", t."is_numeric", t."is_active", t."sort_order"
FROM "target_type" t
CROSS JOIN "cycle" c
WHERE t."cycle_id" = (SELECT min("id") FROM "cycle") AND c."id" <> t."cycle_id";

-- Each goal keeps its type, now the copy that belongs to its document's cycle.
UPDATE "performance_goal" g
SET "target_type_id" = own."id"
FROM "gedp_document" d, "target_type" old, "target_type" own
WHERE d."id" = g."document_id"
  AND old."id" = g."target_type_id"
  AND own."code" = old."code"
  AND own."cycle_id" = d."cycle_id"
  AND own."id" <> g."target_type_id";

-- No cycle at all means no document and no goal, so unattached types can simply go.
DELETE FROM "target_type" WHERE "cycle_id" IS NULL;

ALTER TABLE "target_type" ALTER COLUMN "cycle_id" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "cycle_single_open_key" ON "cycle"("status") WHERE (status = 'OTWARTY');

-- CreateIndex
CREATE UNIQUE INDEX "target_type_cycle_id_code_key" ON "target_type"("cycle_id", "code");

-- AddForeignKey
ALTER TABLE "target_type" ADD CONSTRAINT "target_type_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "cycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
