// Job links open in a new tab (WCT group, 2026-11-25): the calendar stays where it was. A tab's company lives in
// sessionStorage, which a new tab does not get, so a link goes through /portal/open-in-org with the company it belongs
// to (another company's document) or the tab's current company; a single-company user gets the plain link.
import { ACTIVE_ORG_KEY } from "./multiOrg";
import { crossOrgHref, safeOpenInOrg } from "./crossOrg";

/** The href for a new tab: in `orgId` when given, else in the tab's current company. */
export function newTabHref(href: string, orgId?: string | null, active?: string | null): string {
  let org = orgId || active || null;
  if (!org && typeof window !== "undefined") {
    try {
      org = window.sessionStorage.getItem(ACTIVE_ORG_KEY);
    } catch {
      org = null;
    }
  }
  return org && safeOpenInOrg(org, href) ? crossOrgHref(org, href) : href;
}

/** Props for an <a> that opens in a new tab. */
export const newTabProps = { target: "_blank", rel: "noopener noreferrer" } as const;
