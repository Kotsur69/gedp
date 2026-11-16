import { Suspense } from "react";
import type { Metadata } from "next";
import { forbidden } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import { requireEmployee } from "@/server/current-employee";
import { MAX_IMPORT_FILE_BYTES } from "@/server/import/table";
import { ImportGuide } from "./import-guide";
import { ImportScreen } from "./import-screen";

// HR import of the employee structure (HR-01..03): upload -> preview diff -> confirm or reject.
// HR only: anyone else gets the 403 boundary (forbidden.tsx). The Server Actions check HR again,
// so the screen is never the only gate. Plain layout for now; the design pass comes with the shell.

const BYTES_PER_MB = 1024 * 1024;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("header.screen", { app: t("common.appName"), screen: t("admin.import.title") }) };
}

export default function ImportPage() {
  return (
    <Suspense fallback={null}>
      <GuardedImport />
    </Suspense>
  );
}

async function GuardedImport() {
  const employee = await requireEmployee();
  if (!employee.isHrAdmin) forbidden();

  // The client screen gets only the messages it renders, not the whole glossary.
  const { admin, common } = await getMessages();
  const messages = {
    admin: { import: admin.import, employeeFields: admin.employeeFields },
    common: { yes: common.yes, no: common.no },
  };
  return (
    <NextIntlClientProvider messages={messages}>
      <ImportScreen
        maxFileBytes={MAX_IMPORT_FILE_BYTES}
        maxFileMb={MAX_IMPORT_FILE_BYTES / BYTES_PER_MB}
        guide={<ImportGuide />}
      />
    </NextIntlClientProvider>
  );
}
