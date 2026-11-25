// Jobs calendar cache (calendar speed, 2026-11-25): React Query keys for GET /dashboard/jobs-calendar. One entry per
// org + range on screen; every change made on the calendar invalidates JOBS_CALENDAR_QUERY_KEY (all ranges).

import { ACTIVE_ORG_KEY } from "@/helpers/multiOrg";

export const JOBS_CALENDAR_QUERY_KEY = ["jobs-calendar"] as const;

/** The admin "Viewing as org" pick (sent as X-Active-Org-Id), "" when none or when storage is blocked. */
export function activeOrgOf(): string {
  try {
    return (typeof window !== "undefined" && window.sessionStorage.getItem(ACTIVE_ORG_KEY)) || "";
  } catch {
    return "";
  }
}

/** One range's key: the org on screen, the SiteClock-hidden flag (changes the payload) and the range. */
export function jobsCalendarKey(from: string, to: string, hideSiteClock: boolean, org: string = activeOrgOf()) {
  return [...JOBS_CALENDAR_QUERY_KEY, org, hideSiteClock, from, to] as const;
}
