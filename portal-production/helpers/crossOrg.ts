// Cross-company documents (WCT group, 2026-11-23). A BC Air order shows the WCT (S) invoices billed against its
// quotation as read-only pills "I-012345 · WCT (S)"; they open in WCT (S) through /portal/open-in-org for a person
// who belongs to WCT (S), else they are plain text. Pure helpers, tested by helpers/crossOrg.test.mjs.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The link that switches the tab to `orgId` and opens `path` there. */
export const crossOrgHref = (orgId: string, path: string): string => `/portal/open-in-org?org=${encodeURIComponent(orgId)}&to=${encodeURIComponent(path)}`;

/** The open-in-org target, only for a real org id and an in-app portal path (never another site). */
export function safeOpenInOrg(org: string | null | undefined, to: string | null | undefined): { org: string; to: string } | null {
  const o = String(org ?? "").trim();
  const t = String(to ?? "").trim();
  if (!UUID.test(o) || !/^\/portal\/[A-Za-z0-9/_-]+$/.test(t)) return null;
  return { org: o, to: t };
}

/** "I-012345 · WCT (S)" */
export const crossOrgLabel = (name: string | null | undefined, orgName: string | null | undefined): string => [name || "Invoice", orgName || "other company"].join(" · ");
