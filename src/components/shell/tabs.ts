// Main tabs of the app shell (HOME-12). Shared by the server, which decides WHICH tabs a person
// sees (src/server/navigation.ts), and the client, which only highlights the active one.
// No `server-only`: the client tab strip imports tabForSegment.

export const TAB_IDS = ["gedpCycle", "myInformation", "myTeam", "administrator", "helpAndSupport"] as const;
export type TabId = (typeof TAB_IDS)[number];

export interface TabDefinition {
  id: TabId;
  href: string;
  /**
   * First route segment under the (app) layout, as returned by useSelectedLayoutSegment(); null for
   * the start page. Segments come from the route tree, not the browser URL, so they stay correct
   * behind the locale rewrite in proxy.ts (usePathname would not).
   */
  segment: string | null;
}

// Order here = order on screen.
const TABS: readonly TabDefinition[] = [
  { id: "gedpCycle", href: "/", segment: null },
  { id: "myInformation", href: "/my-information", segment: "my-information" },
  { id: "myTeam", href: "/team", segment: "team" },
  { id: "administrator", href: "/admin", segment: "admin" },
  { id: "helpAndSupport", href: "/help", segment: "help" },
];

/** Tabs in screen order, limited to the given ids (already filtered by role on the server). */
export function orderedTabs(visible: readonly TabId[]): TabDefinition[] {
  return TABS.filter((tab) => visible.includes(tab.id));
}

/** The tab a route segment belongs to, or null for a screen outside the main tabs. */
export function tabForSegment(segment: string | null): TabId | null {
  return TABS.find((tab) => tab.segment === segment)?.id ?? null;
}
