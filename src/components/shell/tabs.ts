// Main tabs of the app shell (HOME-12). Shared by the server, which decides WHICH tabs a person
// sees (src/server/navigation.ts), and the client, which only highlights the active one.
// No `server-only`: the client tab strip imports tabForSegments.

export const TAB_IDS = ["gedpCycle", "myInformation", "myTeam", "administrator", "helpAndSupport"] as const;
export type TabId = (typeof TAB_IDS)[number];

export interface TabDefinition {
  id: TabId;
  href: string;
  /**
   * Route segments under the (app) layout that open this tab, as returned by
   * useSelectedLayoutSegments(); the tab is active on them and on every route below them. Empty
   * for the start page, which matches only itself. Segments come from the route tree, not the
   * browser URL, so they stay correct behind the locale rewrite in proxy.ts (usePathname would not).
   */
  segments: readonly string[];
}

// Order here = order on screen.
const TABS: readonly TabDefinition[] = [
  { id: "gedpCycle", href: "/", segments: [] },
  { id: "myInformation", href: "/my-information", segments: ["my-information"] },
  // WF-20: the team view lives in Goal Centre, behind its "Moje cele | Mój zespół" switch.
  { id: "myTeam", href: "/goal-centre/team", segments: ["goal-centre", "team"] },
  { id: "administrator", href: "/admin", segments: ["admin"] },
  { id: "helpAndSupport", href: "/help", segments: ["help"] },
];

/** Tabs in screen order, limited to the given ids (already filtered by role on the server). */
export function orderedTabs(visible: readonly TabId[]): TabDefinition[] {
  return TABS.filter((tab) => visible.includes(tab.id));
}

function startsWith(route: readonly string[], prefix: readonly string[]): boolean {
  return prefix.every((segment, index) => route[index] === segment);
}

/**
 * The tab a route belongs to (its segments under the (app) layout), or null for a screen outside
 * the main tabs. The longest matching prefix wins; the start page matches only itself.
 */
export function tabForSegments(route: readonly string[]): TabId | null {
  if (route.length === 0) return "gedpCycle";
  const matches = TABS.filter((tab) => tab.segments.length > 0 && startsWith(route, tab.segments));
  const best = matches.reduce<TabDefinition | null>(
    (current, tab) => (current === null || tab.segments.length > current.segments.length ? tab : current),
    null,
  );
  return best?.id ?? null;
}
