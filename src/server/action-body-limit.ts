// Server Action body limits per path (checked in proxy.ts, before any action runs).
//
// Next has one global serverActions.bodySizeLimit (next.config.ts), raised to 11 MB for the HR
// import upload. Without this check every other action - including the sign-in actions on /login,
// reachable without a session - would also accept 11 MB bodies. So: only the paths listed here may
// send large action bodies; every other action POST keeps Next's default 1 MB and must declare its
// length (browsers always send Content-Length for fetch with FormData).

/** Next's default serverActions.bodySizeLimit. */
export const DEFAULT_ACTION_BODY_BYTES = 1024 * 1024;

/** Visible (non-localized) paths whose Server Actions may use the raised next.config limit. */
export const LARGE_ACTION_PATHS: ReadonlySet<string> = new Set(["/admin/import"]);

const NEXT_ACTION_HEADER = "next-action";

export interface ActionRequestInfo {
  method: string;
  pathname: string;
  headers: Pick<Headers, "get" | "has">;
}

/** True when a Server Action request must be refused with 413 before it reaches Next. */
export function isOversizedServerAction({ method, pathname, headers }: ActionRequestInfo): boolean {
  if (method !== "POST" || !headers.has(NEXT_ACTION_HEADER)) return false;
  if (LARGE_ACTION_PATHS.has(pathname)) return false;
  const declared = headers.get("content-length");
  // Missing or malformed length (e.g. chunked upload) cannot be bounded here, so it is refused.
  if (declared === null || !/^\d+$/.test(declared)) return true;
  return Number(declared) > DEFAULT_ACTION_BODY_BYTES;
}
