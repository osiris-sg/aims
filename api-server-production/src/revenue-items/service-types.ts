// Service types (guru 2026-11-26, flag enableServiceTypes: the WCT group).
//
// A WCT service is one of a few job types: MV, CD, AA/VO, TS. Each type IS one of the company's
// sales accounts, so the office maps a service to its type and never sees an account code:
// AIMS writes the account behind it. The table is per org, in OrganizationUIConfig.features:
//     serviceTypes: [{ code: "CD", accountCode: "4-2000" }, …]
// (WCT (S): MV 4-1000 · CD 4-2000 · AA/VO 4-3000 · TS 4-3500; BC Air's accounts are numbered
// differently; set by scripts/wct-service-types.js). A service's type is DERIVED from its account,
// there is no second column to keep in step. AA and VO share one account in WCT's books, so they
// are one type here ("AA/VO"), named as the account is.
//
// A service with no account ("" in RevenueItem.accountCode, which is NOT NULL) is "not mapped".

export const SERVICE_TYPES_FLAG = 'enableServiceTypes';

export interface ServiceType {
  code: string;
  accountCode: string;
}

/** The org's type table, or [] when the feature is off or the table is missing / malformed. */
export function serviceTypesOf(features: any): ServiceType[] {
  if (!features || features[SERVICE_TYPES_FLAG] !== true || !Array.isArray(features.serviceTypes)) return [];
  const seen = new Set<string>();
  const out: ServiceType[] = [];
  for (const t of features.serviceTypes) {
    const code = String(t?.code ?? '').trim();
    const accountCode = String(t?.accountCode ?? '').trim();
    if (!code || !accountCode || seen.has(code)) continue;
    seen.add(code);
    out.push({ code, accountCode });
  }
  return out;
}

/** The type a service is mapped to (by its account), or null when it is not mapped to one. */
export function serviceTypeOfAccount(types: ServiceType[], accountCode: string | null | undefined): string | null {
  const a = String(accountCode ?? '').trim();
  if (!a) return null;
  return types.find((t) => t.accountCode === a)?.code ?? null;
}
