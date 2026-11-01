// Documents hub tabs (round L): Shipments-style underlined tabs with counts. Round AZ: labels in the portal language.

import { currentLang, type UiLang } from "@/i18n/lang";

/** The tabs (short labels, like the Shipments tabs); a tab with no documents is hidden — All always shows. */
export const DOC_TABS: Array<{ code: string; label: string; ja: string }> = [
  { code: "", label: "All", ja: "すべて" },
  { code: "SUPPLIER", label: "Supplier", ja: "仕入先" },
  { code: "CUSTOMER", label: "Customer", ja: "顧客" },
  { code: "INVOICES", label: "Invoices", ja: "請求書" },
  { code: "CUSTOMS_LOGISTICS", label: "Customs & logistics", ja: "通関・物流" },
  { code: "PAYMENTS", label: "Payments", ja: "支払い" },
  { code: "OTHER", label: "Other", ja: "その他" },
];
export const visibleTabs = (counts: Record<string, number>, allCount: number, current: string, lang: UiLang = currentLang()) =>
  DOC_TABS.filter((t) => !t.code || (counts[t.code] ?? 0) > 0 || t.code === current).map(({ ja, ...t }) => ({ ...t, label: lang === "ja" ? ja : t.label, count: t.code ? (counts[t.code] ?? 0) : allCount }));
