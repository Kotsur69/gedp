-- CreateTable
CREATE TABLE "login_credential" (
    "employee_id" INTEGER NOT NULL,
    "password_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "login_credential_pkey" PRIMARY KEY ("employee_id")
);

-- AddForeignKey
ALTER TABLE "login_credential" ADD CONSTRAINT "login_credential_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Only scrypt hashes in the documented format may be stored, never a plain password.
ALTER TABLE "login_credential" ADD CONSTRAINT "login_credential_password_hash_format"
  CHECK ("password_hash" ~ '^scrypt\$[0-9]+\$[0-9]+\$[0-9]+\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$');

-- Same lockdown as 20261113090000_rls_lockdown: deny by default, app role only.
ALTER TABLE "login_credential" ENABLE ROW LEVEL SECURITY;
CREATE POLICY gedp_app_all ON "login_credential" FOR ALL TO gedp_app USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "login_credential" TO gedp_app;
