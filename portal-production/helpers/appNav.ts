// In-app Back (features.enableWctDocNav, WCT group 2026-11-17).
//
// A Back button goes to the previous page IN THE APP (history back), e.g.
// Orders > order > DO > Back returns to the order. When there is no in-app
// previous page (opened from a link, a new tab, or the first page of the
// session) it falls back to the page's parent list, as before.
//
// How "is there an in-app previous page" is known: every history entry the
// app pushes carries a depth marker in history.state (__aimsNavDepth = the
// previous entry's depth + 1); a replace keeps the depth of the entry it
// replaces. The first entry of a tab has no marker (depth 0). The browser
// keeps history.state across a refresh and on Back / Forward, so the marker
// always matches the entry being shown. document.referrer and history.length
// are not used (both are unreliable for this).

export const NAV_DEPTH_KEY = "__aimsNavDepth";
const INSTALLED = "__aimsNavInstalled";

/** Depth of the history entry being shown (0 = no in-app previous page). */
export function navDepth(state: unknown): number {
  const d = state && typeof state === "object" ? (state as Record<string, unknown>)[NAV_DEPTH_KEY] : undefined;
  return typeof d === "number" && Number.isFinite(d) && d > 0 ? Math.floor(d) : 0;
}

/** The state to store for a push (depth + 1) or a replace (same depth). */
export function stampNavState(kind: "push" | "replace", data: unknown, currentState: unknown): unknown {
  const depth = kind === "push" ? navDepth(currentState) + 1 : navDepth(currentState);
  if (data === null || data === undefined) return { [NAV_DEPTH_KEY]: depth };
  if (typeof data !== "object") return data; // a primitive state: leave it alone
  return { ...(data as Record<string, unknown>), [NAV_DEPTH_KEY]: depth };
}

export type BackAction = { kind: "history" } | { kind: "push"; href: string };

/**
 * What a Back button does. Setting off: always the parent list (unchanged
 * behaviour). Setting on: history back when there is an in-app previous page,
 * else the parent list.
 */
export function backAction(opts: { enabled: boolean; depth: number; fallback: string }): BackAction {
  if (opts.enabled && opts.depth > 0) return { kind: "history" };
  return { kind: "push", href: opts.fallback };
}

type HistoryLike = {
  state: unknown;
  pushState: (data: any, unused: string, url?: string | URL | null) => void;
  replaceState: (data: any, unused: string, url?: string | URL | null) => void;
};

/**
 * Wrap history.pushState / replaceState so every entry gets its depth marker.
 * Idempotent: a second call on the same (still wrapped) history does nothing.
 * Returns true when it installed the wrappers.
 */
export function installAppNavTracker(history: HistoryLike | undefined | null): boolean {
  if (!history) return false;
  const push = history.pushState as any;
  const replace = history.replaceState as any;
  if (push?.[INSTALLED] && replace?.[INSTALLED]) return false;
  const origPush = push.bind(history);
  const origReplace = replace.bind(history);
  const wrappedPush = function pushState(data: any, unused: string, url?: string | URL | null) {
    return origPush(stampNavState("push", data, history.state), unused, url);
  } as any;
  const wrappedReplace = function replaceState(data: any, unused: string, url?: string | URL | null) {
    return origReplace(stampNavState("replace", data, history.state), unused, url);
  } as any;
  wrappedPush[INSTALLED] = true;
  wrappedReplace[INSTALLED] = true;
  history.pushState = wrappedPush;
  history.replaceState = wrappedReplace;
  return true;
}
