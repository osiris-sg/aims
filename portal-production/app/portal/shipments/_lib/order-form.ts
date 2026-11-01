// New / edit order form helpers (round N) — pure, tested in helpers/orderForm.test.mjs.
import type { PremiumRow } from "./api";

/** "2026-07" + 2 → "2026-09". */
export function addMonths(month: string, k: number): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7)) - 1 + k;
  return `${y + Math.floor(m / 12)}-${String(((m % 12) + 12) % 12 + 1).padStart(2, "0")}`;
}

/** Delivery month default: the ship month + the customer's lag (SUS and Kato: 2 months, like "+ New monthly order"). */
export function defaultDeliveryMonth(shipMonth: string | null | undefined, lagMonths = 2): string {
  return shipMonth && /^\d{4}-\d{2}$/.test(shipMonth) ? addMonths(shipMonth, lagMonths) : "";
}

/** The contract's premium row for a month and grade (mirrors the API's premiumAt): its own grade's row, else an every-grade row. */
export function premiumRowFor(schedule: PremiumRow[] | null | undefined, month: string | null | undefined, grade: string | null | undefined): PremiumRow | null {
  if (!month || !Array.isArray(schedule)) return null;
  const rows = schedule.filter((r) => r.from <= month && (r.to === null || r.to === undefined || r.to >= month));
  const g = (grade ?? "").trim().toUpperCase();
  const own = (r: PremiumRow) => !!r.grade && !!g && (g === r.grade.toUpperCase() || g.startsWith(`${r.grade.toUpperCase()} `));
  return rows.find(own) ?? rows.find((r) => !r.grade) ?? null;
}

const sign = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${n >= 0 ? "+" : ""}${n}`);

/** Helper texts under the premium fields — the selected grade's contract values, never another grade's. */
export function premiumHelp(contractNo: string | null | undefined, row: PremiumRow | null, grade: string | null | undefined, lang: "en" | "ja" = "en"): { supplier: string; client: string } {
  const ja = lang === "ja";
  const g = (grade ?? "").trim() || (ja ? "このグレード" : "this grade");
  if (!contractNo) return ja ? { supplier: "固定部分：PIのプレミアム = 当該四半期のQMJP + この値", client: "顧客に請求する固定部分" } : { supplier: "Fixed part: a PI's premium = QMJP of the quarter + this", client: "Fixed part billed to the customer" };
  if (!row) {
    const none = ja ? `契約 ${contractNo} に ${g} の行がありません — 入力してください` : `Contract ${contractNo} has no ${g} row — enter it`;
    return { supplier: none, client: none };
  }
  return ja
    ? { supplier: `契約 ${contractNo}、${g}：仕入先 ${sign(row.supplierPremium)}（PIプレミアム = QMJP + この値）`, client: `契約 ${contractNo}、${g}：顧客 ${sign(row.clientPremium)}` }
    : {
        supplier: `Contract ${contractNo}, ${g}: supplier ${sign(row.supplierPremium)} (PI premium = QMJP + this)`,
        client: `Contract ${contractNo}, ${g}: client ${sign(row.clientPremium)}`,
      };
}
