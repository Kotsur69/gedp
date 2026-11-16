import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import type { Prisma } from "@/generated/prisma/client";
import { TAB_IDS, type TabId } from "@/components/shell/tabs";
import { requireEmployee } from "@/server/current-employee";
import { db } from "@/server/db";

// Which main tabs a person sees (HOME-12). Decided on the server from live data, never from
// anything the browser sends. Hiding a tab is not access control: each restricted page also calls
// requireTab(), so typing /admin as a non-HR person gives 404.

export interface ShellRoles {
  isHrAdmin: boolean;
  /** Someone reports to this person, or has them as override validator (WF-09). */
  leadsTeam: boolean;
}

export type TeamReader = Pick<Prisma.TransactionClient, "employee">;

/** Tab ids in screen order. "Mój zespół" for people with a team, "Administrator" for HR only. */
export function visibleTabIds(roles: ShellRoles): TabId[] {
  return TAB_IDS.filter((id) => {
    if (id === "myTeam") return roles.leadsTeam;
    if (id === "administrator") return roles.isHrAdmin;
    return true;
  });
}

/**
 * True when anyone has this person as manager (N+1) or override validator. N+2 and above always
 * have direct reports themselves, so this covers every level. Inactive reports count too: their
 * documents stay visible to the manager (ACC-04).
 */
export async function leadsTeam(reader: TeamReader, employeeId: number): Promise<boolean> {
  const row = await reader.employee.findFirst({
    where: { OR: [{ managerId: employeeId }, { validatorOverrideId: employeeId }] },
    select: { id: true },
  });
  return row !== null;
}

/** Tabs for the signed-in person. Deduplicated per request; redirects when signed out. */
export const getVisibleTabs = cache(async (): Promise<TabId[]> => {
  const employee = await requireEmployee();
  return visibleTabIds({ isHrAdmin: employee.isHrAdmin, leadsTeam: await leadsTeam(db(), employee.id) });
});

/**
 * Page guard for a role-restricted tab: not-found (not 403), so the page content never renders.
 * Called inside Suspense (cacheComponents), the HTTP status is already 200 when it fires; the
 * browser still only gets the not-found UI.
 */
export async function requireTab(id: TabId): Promise<void> {
  if (!(await getVisibleTabs()).includes(id)) notFound();
}
