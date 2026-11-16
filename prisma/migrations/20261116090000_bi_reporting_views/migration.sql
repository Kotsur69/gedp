-- RPT-12: read-only data source for Power BI.
-- Schema "bi" holds views over the app tables; role "gedp_bi" may read those views and nothing else.
-- The delivery channel (direct Power BI connection vs scheduled CSV export) waits for Q-01 (hosting),
-- so only the views and the role are created here.
--
-- Data minimisation (GDPR): the views expose ids, structure, statuses, counts and dates only.
-- Left out on purpose: names, e-mail, hire date, HR-admin flag, password data, the audit log,
-- and every free-text field (goal titles / descriptions / measures / target values, development
-- actions, BHP commitments, status-change comments), which may contain personal data.
-- AMEI is kept so HR can match a row to a person in its own HR system.
--
-- Security model:
--  - Views run with the privileges of their owner (the migration role), which owns the app tables
--    and therefore bypasses their RLS. gedp_bi needs no rights on schema public at all.
--    Do NOT switch these views to security_invoker, and do not FORCE RLS on the app tables,
--    or the views stop returning rows.
--  - Enum columns are cast to text, so gedp_bi never touches the enum types in schema public.
--  - gedp_bi is created NOLOGIN; enabling login and setting its password is done out of band
--    (never commit credentials): ALTER ROLE gedp_bi LOGIN PASSWORD '...';
--  - The role name is hardcoded here and documented in .env.example (BI_DB_ROLE).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gedp_bi') THEN
    CREATE ROLE gedp_bi NOLOGIN;
  END IF;
END
$$;

-- Accident guard only: gedp_bi sessions start read-only. The role could turn this off itself, so the
-- security boundary is the privilege set below (SELECT on bi, nothing else), not this setting.
ALTER ROLE gedp_bi SET default_transaction_read_only = on;

CREATE SCHEMA bi;
REVOKE ALL ON SCHEMA bi FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Employees: structure and eligibility flags only (no names, e-mail or hire date).
-- manager_id lets Power BI build the org tree (DAX PATH) for subtree filters (RPT-13).
-- ---------------------------------------------------------------------------
CREATE VIEW bi.employee AS
SELECT
  e.id              AS employee_id,
  e.amei,
  e.manager_id,
  e.department,
  e.position,
  e.location,
  e.is_white_collar,
  e.is_active
FROM public.employee e;

-- ---------------------------------------------------------------------------
-- One row per GEDP document (employee x cycle) with its current status.
-- Employees without a document in a cycle have no row here: anti-join bi.employee in the report.
-- ---------------------------------------------------------------------------
CREATE VIEW bi.document AS
SELECT
  d.id              AS document_id,
  d.employee_id,
  d.cycle_id,
  c.year            AS cycle_year,
  c.status::text    AS cycle_status,
  d.status::text    AS status,
  d.validator_id,
  d.created_at,
  d.updated_at
FROM public.gedp_document d
JOIN public.cycle c ON c.id = d.cycle_id;

-- ---------------------------------------------------------------------------
-- Performance goals: numbers and dates only, no free text.
-- ---------------------------------------------------------------------------
CREATE VIEW bi.performance_goal AS
SELECT
  g.id              AS goal_id,
  g.document_id,
  g.state::text     AS state,
  t.code            AS target_type_code,
  g.weight,
  g.progress,
  g.due_date,
  g.changed_by_manager,
  g.created_at,
  g.updated_at
FROM public.performance_goal g
LEFT JOIN public.target_type t ON t.id = g.target_type_id;

-- ---------------------------------------------------------------------------
-- Development goals: HR-managed dictionary names instead of the employee's own action text.
-- ---------------------------------------------------------------------------
CREATE VIEW bi.development_goal AS
SELECT
  g.id              AS goal_id,
  g.document_id,
  g.state::text     AS state,
  a.name_pl         AS development_area_pl,
  a.name_en         AS development_area_en,
  k.name_pl         AS competency_pl,
  k.name_en         AS competency_en,
  g.start_date,
  g.end_date,
  g.progress,
  g.changed_by_manager,
  g.created_at,
  g.updated_at
FROM public.development_goal g
LEFT JOIN public.development_area a ON a.id = g.development_area_id
LEFT JOIN public.competency k ON k.id = g.competency_id;

-- ---------------------------------------------------------------------------
-- Status transitions (RPT-03 validation backlog). The return comment is left out.
-- ---------------------------------------------------------------------------
CREATE VIEW bi.document_status_history AS
SELECT
  h.id                AS history_id,
  h.document_id,
  h.from_status::text AS from_status,
  h.to_status::text   AS to_status,
  h.author_id,
  h.created_at
FROM public.document_status_history h;

-- ---------------------------------------------------------------------------
-- Completeness flags per document (RPT-02), mirroring the closing conditions WF-C1..WF-C5.
-- Thresholds come from the cycle configuration (Q-03 is open). Goals count only once added
-- to the plan (state W_PLANIE). A group-goal flag is true when the document's cycle has at least
-- one template of that type and every one of them is acknowledged (BHP: with a non-blank
-- commitment). A cycle without a template of a type shows the flag as false, so a misconfigured
-- cycle surfaces in the report instead of looking complete.
-- ---------------------------------------------------------------------------
CREATE VIEW bi.document_completeness AS
WITH perf AS (
  SELECT document_id, count(*) AS goals_in_plan, COALESCE(sum(weight), 0) AS weight_sum
  FROM public.performance_goal
  WHERE state = 'W_PLANIE'
  GROUP BY document_id
),
dev AS (
  SELECT document_id, count(*) AS goals_in_plan
  FROM public.development_goal
  WHERE state = 'W_PLANIE'
  GROUP BY document_id
),
grp AS (
  SELECT
    d.id AS document_id,
    bool_and(a.id IS NOT NULL) FILTER (WHERE t.type = 'PRZYWODZTWO') AS leadership_acknowledged,
    bool_and(a.id IS NOT NULL) FILTER (WHERE t.type = 'WARTOSCI') AS values_acknowledged,
    bool_and(COALESCE(btrim(a.hs_commitment), '') <> '') FILTER (WHERE t.type = 'BHP') AS hs_commitment_set
  FROM public.gedp_document d
  JOIN public.group_goal_template t ON t.cycle_id = d.cycle_id
  LEFT JOIN public.group_goal_ack a ON a.document_id = d.id AND a.template_id = t.id
  GROUP BY d.id
),
flags AS (
  SELECT
    d.id                                        AS document_id,
    COALESCE(grp.leadership_acknowledged, false) AS leadership_acknowledged,
    COALESCE(grp.values_acknowledged, false)     AS values_acknowledged,
    COALESCE(grp.hs_commitment_set, false)       AS hs_commitment_set,
    COALESCE(perf.goals_in_plan, 0)             AS performance_goals_in_plan,
    COALESCE(perf.weight_sum, 0)                AS performance_weight_sum,
    COALESCE(perf.goals_in_plan, 0) >= c.min_performance_goals
      AND COALESCE(perf.weight_sum, 0) = c.required_weight_sum AS performance_complete,
    COALESCE(dev.goals_in_plan, 0)              AS development_goals_in_plan,
    COALESCE(dev.goals_in_plan, 0) >= c.min_development_goals AS development_complete
  FROM public.gedp_document d
  JOIN public.cycle c ON c.id = d.cycle_id
  LEFT JOIN perf ON perf.document_id = d.id
  LEFT JOIN dev  ON dev.document_id  = d.id
  LEFT JOIN grp  ON grp.document_id  = d.id
)
SELECT
  f.*,
  (f.leadership_acknowledged AND f.values_acknowledged AND f.hs_commitment_set
    AND f.performance_complete AND f.development_complete) AS is_complete
FROM flags f;

-- ---------------------------------------------------------------------------
-- Privileges: USAGE + SELECT on schema bi only. Nothing on schema public is granted to gedp_bi.
-- ---------------------------------------------------------------------------
REVOKE ALL ON ALL TABLES IN SCHEMA bi FROM PUBLIC;
GRANT USAGE ON SCHEMA bi TO gedp_bi;
GRANT SELECT ON ALL TABLES IN SCHEMA bi TO gedp_bi;
-- Views added to bi by later migrations become readable automatically, but only when those
-- migrations run as the same role as this one (default privileges are per creating role).
-- Every column added to bi is visible to Power BI: review new views for data minimisation.
ALTER DEFAULT PRIVILEGES IN SCHEMA bi GRANT SELECT ON TABLES TO gedp_bi;

-- Supabase Data API roles never see the reporting schema, now or later (no-op on plain PostgreSQL).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON SCHEMA bi FROM anon, authenticated;
    REVOKE ALL ON ALL TABLES IN SCHEMA bi FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA bi REVOKE ALL ON TABLES FROM anon, authenticated;
  END IF;
END
$$;
