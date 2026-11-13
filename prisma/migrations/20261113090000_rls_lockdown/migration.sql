-- Lock tables down for Supabase hosting (also safe on plain PostgreSQL).
-- Supabase exposes schema public through its Data API to roles anon / authenticated.
-- GEDP never uses that API: the app talks to Postgres directly, so:
--  1. RLS is enabled on every table (including _prisma_migrations) - deny by default.
--  2. Only the application role gedp_app gets a permissive policy; the migration owner bypasses RLS as table owner.
--  3. Any privileges of anon / authenticated are revoked, now and for future objects.
-- Tables added by later migrations must enable RLS and add the gedp_app policy themselves.

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    IF t <> '_prisma_migrations' THEN
      EXECUTE format('CREATE POLICY gedp_app_all ON public.%I FOR ALL TO gedp_app USING (true) WITH CHECK (true)', t);
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
  END IF;
END
$$;
