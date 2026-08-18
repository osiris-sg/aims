// Shared grouping for flat GL-account dropdowns: orders a chart of accounts
// by high-level account type (assets → liabilities → equity → P&L) and gives
// each type a human label for Autocomplete groupBy headers (guru 2026-08-18).

const TYPE_ORDER: string[] = [
  "FIXED_ASSET",
  "INTANGIBLE_ASSET",
  "CURRENT_ASSET",
  "DEPRECIATION_PROVISION",
  "CURRENT_LIABILITY",
  "MEDIUM_TERM_LIABILITY",
  "LONG_TERM_LIABILITY",
  "TAX_LIABILITY",
  "SHARE_CAPITAL",
  "CAPITAL_RESERVE",
  "RETAINED_PROFIT",
  "DIVIDEND",
  "SALES",
  "INCOME",
  "PURCHASE",
  "EXPENSE",
  "EXCHANGE_GAIN_LOSS",
  "EXTRAORDINARY",
  "TAX",
];

const TYPE_LABELS: Record<string, string> = {
  FIXED_ASSET: "Fixed Assets",
  INTANGIBLE_ASSET: "Intangible Assets",
  CURRENT_ASSET: "Current Assets",
  DEPRECIATION_PROVISION: "Depreciation Provision",
  CURRENT_LIABILITY: "Current Liabilities",
  MEDIUM_TERM_LIABILITY: "Medium-Term Liabilities",
  LONG_TERM_LIABILITY: "Long-Term Liabilities",
  TAX_LIABILITY: "Tax Liabilities",
  SHARE_CAPITAL: "Share Capital",
  CAPITAL_RESERVE: "Capital Reserves",
  RETAINED_PROFIT: "Retained Profits",
  DIVIDEND: "Dividends",
  SALES: "Sales",
  INCOME: "Other Income",
  PURCHASE: "Purchases",
  EXPENSE: "Expenses",
  EXCHANGE_GAIN_LOSS: "Exchange Gain/Loss",
  EXTRAORDINARY: "Extraordinary Items",
  TAX: "Tax",
};

export function accountTypeLabel(accountType?: string | null): string {
  if (!accountType) return "Other";
  return (
    TYPE_LABELS[accountType] ||
    accountType
      .toLowerCase()
      .split("_")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ")
  );
}

// MUI Autocomplete's groupBy needs options pre-sorted so each group renders
// once — sort by type order first, then code within the type.
export function sortAccountsByType<T extends { code: string; accountType?: string | null }>(accounts: T[]): T[] {
  const idx = (t?: string | null) => {
    const i = TYPE_ORDER.indexOf(String(t || ""));
    return i === -1 ? TYPE_ORDER.length : i;
  };
  return [...(accounts || [])].sort(
    (a, b) => idx(a.accountType) - idx(b.accountType) || String(a.code).localeCompare(String(b.code), undefined, { numeric: true })
  );
}
