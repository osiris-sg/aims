// Multi-organisation users (2026-11-02): pure helpers for the portal and the
// field app. Tested by helpers/multiOrg.test.mjs.

/** The sessionStorage key the request helper sends as X-Active-Org-Id (kept from the admin-only days). */
export const ACTIVE_ORG_KEY = "aims-admin-active-org";

/** A member's stored org for this tab counts only when it is one of their orgs and not already the default. */
export function memberOverride(storedId: string | null, defaultId: string | null, myOrgIds: string[]): string | null {
  if (!storedId || storedId === defaultId) return null;
  return myOrgIds.includes(storedId) ? storedId : null;
}

/** A push from another of my orgs: the org to switch to when it is tapped (null = stay). */
export function pushOrgSwitch(data: Record<string, unknown> | null | undefined, currentOrgId: string | null, myOrgIds: string[]): string | null {
  const orgId = typeof data?.orgId === "string" ? data.orgId : null;
  if (!orgId || orgId === currentOrgId) return null;
  return myOrgIds.includes(orgId) ? orgId : null;
}

/** "[WCT Racking] New job" for a push that belongs to another of my orgs. */
export function pushTitle(title: string, data: Record<string, unknown> | null | undefined, currentOrgId: string | null): string {
  const orgId = typeof data?.orgId === "string" ? data.orgId : null;
  const orgName = typeof data?.orgName === "string" ? data.orgName : null;
  return orgId && orgName && orgId !== currentOrgId ? `[${orgName}] ${title}` : title;
}

/** The field app asks which org once per session, when the person has 2+. */
export const FIELD_ORG_PICKED_KEY = "aims-field-org-picked";
export const needsFieldOrgPick = (orgCount: number, alreadyPicked: boolean) => orgCount >= 2 && !alreadyPicked;
