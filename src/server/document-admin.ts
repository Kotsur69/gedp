import "server-only";
import { z } from "zod";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { DOCUMENT_STATUSES, type DocumentStatusValue } from "@/domain/document-status";
import { requireActiveHrAdmin, type Viewer } from "@/server/permissions";

// HR panel, documents (WF-08, WF-09): every GEDP document of a cycle with its status and who
// validates it, as the starting point of "Cofnij status" and of HR-07 corrections. HR only, re-checked
// against the live row.
// The revert itself is revertDocumentStatus in workflow.ts; this module only reads.

/** Upper bound for one list; the page says when it is cut and asks for a narrower search. */
export const DOCUMENT_LIST_LIMIT = 200;

const MAX_QUERY_LENGTH = 100;
const MAX_QUERY_TERMS = 5;

const firstValue = (value: unknown): unknown => (Array.isArray(value) ? value[0] : value);

// URL search params are untrusted; an invalid value falls back to "no filter".
const listFiltersSchema = z.object({
  q: z.preprocess(firstValue, z.string().trim().max(MAX_QUERY_LENGTH)).catch(""),
  status: z.preprocess(firstValue, z.enum(DOCUMENT_STATUSES).nullable()).catch(null),
});

export type DocumentListFilters = z.output<typeof listFiltersSchema>;

export function parseDocumentListFilters(raw: Record<string, unknown>): DocumentListFilters {
  return listFiltersSchema.parse(raw);
}

/** Documents of the cycle; every search word must match the employee's first name, last name, AMEI or department (HR-07). */
export function documentListWhere(cycleId: number, filters: DocumentListFilters): Prisma.GedpDocumentWhereInput {
  const terms = filters.q.split(/\s+/).filter(Boolean).slice(0, MAX_QUERY_TERMS);
  const employee: Prisma.EmployeeWhereInput[] = terms.map((term) => ({
    OR: [
      { firstName: { contains: term, mode: "insensitive" } },
      { lastName: { contains: term, mode: "insensitive" } },
      { amei: { contains: term, mode: "insensitive" } },
      { department: { contains: term, mode: "insensitive" } },
    ],
  }));
  return {
    cycleId,
    ...(filters.status ? { status: filters.status } : {}),
    ...(employee.length > 0 ? { employee: { AND: employee } } : {}),
  };
}

const personSelect = { amei: true, firstName: true, lastName: true } satisfies Prisma.EmployeeSelect;

const listSelect = {
  id: true,
  status: true,
  updatedAt: true,
  employee: {
    select: {
      amei: true,
      firstName: true,
      lastName: true,
      department: true,
      isActive: true,
      manager: { select: personSelect },
      validatorOverride: { select: personSelect },
    },
  },
} satisfies Prisma.GedpDocumentSelect;

type ListRow = Prisma.GedpDocumentGetPayload<{ select: typeof listSelect }>;

export interface PersonRef {
  amei: string;
  name: string;
}

export interface AdminDocumentItem {
  documentId: number;
  status: DocumentStatusValue;
  updatedAt: Date;
  employeeName: string;
  amei: string;
  department: string | null;
  isActive: boolean;
  /** N+1 from the live structure; null at the top of the structure. */
  manager: PersonRef | null;
  /** WF-09 override validator; with no manager it is the only one who can validate. */
  validatorOverride: PersonRef | null;
}

export interface AdminDocumentList {
  items: AdminDocumentItem[];
  /** Matching documents; more than items.length when the list was cut at DOCUMENT_LIST_LIMIT. */
  total: number;
}

const personRef = (person: ListRow["employee"]["manager"]): PersonRef | null =>
  person ? { amei: person.amei, name: `${person.firstName} ${person.lastName}` } : null;

function toItem({ id, status, updatedAt, employee }: ListRow): AdminDocumentItem {
  return {
    documentId: id,
    status,
    updatedAt,
    employeeName: `${employee.firstName} ${employee.lastName}`,
    amei: employee.amei,
    department: employee.department,
    isActive: employee.isActive,
    manager: personRef(employee.manager),
    validatorOverride: personRef(employee.validatorOverride),
  };
}

export type DocumentAdminDb = Pick<PrismaClient, "employee" | "gedpDocument">;

export async function listDocumentsForHr(
  db: DocumentAdminDb,
  viewer: Viewer,
  cycleId: number,
  filters: DocumentListFilters,
): Promise<AdminDocumentList> {
  await requireActiveHrAdmin(db, viewer);
  const where = documentListWhere(cycleId, filters);
  const [total, rows] = await Promise.all([
    db.gedpDocument.count({ where }),
    db.gedpDocument.findMany({
      where,
      select: listSelect,
      orderBy: [{ employee: { lastName: "asc" } }, { employee: { firstName: "asc" } }, { id: "asc" }],
      take: DOCUMENT_LIST_LIMIT,
    }),
  ]);
  return { items: rows.map(toItem), total };
}
