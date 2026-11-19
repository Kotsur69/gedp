import "server-only";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { ExportErrorCode, PeopleScope } from "@/domain/data-export";
import { scopedEmployeesWhere, type Viewer } from "@/server/permissions";
import type { ExportRequest } from "./request";

// WHO and WHICH YEAR of an export (HR-12), resolved ONCE per request. Every data query then filters
// by the same people filter AND every loaded row is matched to a person of the resolved set (sheets.ts),
// so a query that returned too much could still never put another person into the file.

/** Rows per sheet; Excel allows ~1M, this keeps one request's memory bounded. */
export const MAX_EXPORT_ROWS = 100_000;
/** Rows across all sheets of one file: the workbook is built in memory, so the whole file is capped too. */
export const MAX_EXPORT_TOTAL_ROWS = 150_000;

export class ExportError extends Error {
  constructor(
    readonly code: ExportErrorCode,
    message: string,
    /** UNKNOWN_PEOPLE: the AMEIs that matched nobody. */
    readonly ameis: readonly string[] = [],
  ) {
    super(message);
    this.name = "ExportError";
  }
}

/** The people filter of the request, always ANDed with the viewer's own scope. */
export function peopleWhere(viewer: Viewer, people: PeopleScope): Prisma.EmployeeWhereInput {
  switch (people.kind) {
    case "one":
      return scopedEmployeesWhere(viewer, { amei: people.amei });
    case "selected":
      return scopedEmployeesWhere(viewer, { amei: { in: people.ameis } });
    case "department":
      return scopedEmployeesWhere(viewer, { department: people.department });
    case "all":
      return scopedEmployeesWhere(viewer);
  }
}

export const exportEmployeeSelect = {
  id: true,
  amei: true,
  email: true,
  firstName: true,
  lastName: true,
  department: true,
  position: true,
  location: true,
  hireDate: true,
  isWhiteCollar: true,
  isActive: true,
  isHrAdmin: true,
  manager: { select: { amei: true } },
  validatorOverride: { select: { amei: true } },
} satisfies Prisma.EmployeeSelect;

export type ExportEmployee = Prisma.EmployeeGetPayload<{ select: typeof exportEmployeeSelect }>;

export interface ResolvedScope {
  cycle: { id: number; year: number };
  /** People in scope, sorted by last name, first name, AMEI: the only people any exported row may belong to. */
  people: readonly ExportEmployee[];
  /** Filter for the documents of these people in this cycle. */
  documentWhere: Prisma.GedpDocumentWhereInput;
}

export type ScopeDb = Pick<PrismaClient, "cycle" | "employee">;

function missingAmeis(people: PeopleScope, found: readonly ExportEmployee[]): string[] {
  const requested = people.kind === "one" ? [people.amei] : people.kind === "selected" ? people.ameis : [];
  const foundAmeis = new Set(found.map((person) => person.amei));
  return requested.filter((amei) => !foundAmeis.has(amei));
}

export async function resolveScope(db: ScopeDb, viewer: Viewer, request: ExportRequest): Promise<ResolvedScope> {
  const cycle = await db.cycle.findUnique({ where: { year: request.year }, select: { id: true, year: true } });
  if (!cycle) throw new ExportError("NO_CYCLE", `No cycle for year ${request.year}`);

  const employeeWhere = peopleWhere(viewer, request.people);
  const people = await db.employee.findMany({
    where: employeeWhere,
    select: exportEmployeeSelect,
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { amei: "asc" }],
    take: MAX_EXPORT_ROWS + 1,
  });
  if (people.length > MAX_EXPORT_ROWS) throw new ExportError("TOO_LARGE", "Too many people in scope");

  // Named people must all exist: a typo must not silently shrink the export.
  const missing = missingAmeis(request.people, people);
  if (missing.length > 0) throw new ExportError("UNKNOWN_PEOPLE", "Unknown AMEI in scope", missing);

  return {
    cycle,
    people,
    documentWhere: { cycleId: cycle.id, employee: employeeWhere },
  };
}
