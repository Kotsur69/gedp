-- SEC-03: audit_log is append-only for the application.
-- The app connects as role "gedp_app" (documented in .env.example as APP_DB_ROLE).
-- Migrations run as the schema owner; the app role only gets DML rights.
-- The role is created NOLOGIN; enabling login and setting its password is done out of band
-- (never commit credentials), e.g.: ALTER ROLE gedp_app LOGIN PASSWORD '...';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gedp_app') THEN
    CREATE ROLE gedp_app NOLOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO gedp_app;

-- DML on all current tables and sequences.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO gedp_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO gedp_app;

-- Tables created by later migrations get the same rights automatically.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO gedp_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO gedp_app;

-- Audit log: read and append only.
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "audit_log" FROM gedp_app;
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "audit_log" FROM PUBLIC;
