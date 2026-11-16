-- HR-01: optional hire date from the structure import (`data_zatrudnienia`). Existing rows stay NULL.
ALTER TABLE "employee" ADD COLUMN "hire_date" DATE;
