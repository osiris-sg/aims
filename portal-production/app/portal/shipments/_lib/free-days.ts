// Round Q: the port free-time countdown in words. It only starts once the
// vessel is in (discharge, else arrival): in-transit rows say "starts on
// arrival". Container = DET (days left to return the empty container before
// detention charges); Port = DEM (days left at the port before demurrage).
// Red at ≤ 3 days. Pure, tested in helpers/uiTrim.test.mjs. Round AZ: an
// optional `lang` ("en" default) gives the Japanese wording.
import type { ShipmentListItem } from "./api";

export type FreeDays = { text: string; tone: "normal" | "warn" | "over" | "pending"; title: string };

export const FREE_DAYS_HELP = "Container = days left to return the empty container before detention charges (DET). Port = days left at the port before demurrage (DEM). Counted from discharge, else arrival.";
export const FREE_DAYS_HELP_JA = "コンテナ = DET（返却期限）までの残り日数。港 = DEM（デマレージ発生）までの残り日数。荷揚日（なければ到着日）から計算。";

const L = {
  en: {
    help: FREE_DAYS_HELP,
    pending: "starts on arrival",
    container: "Container",
    port: "Port",
    days: (n: number) => `${n}d`,
    over: (n: number) => `${n}d over`,
    ends: (det: string, dem: string, from: "discharge" | "eta") => `Container free time ends ${det}, port free time ends ${dem} (from ${from === "discharge" ? "discharge" : "arrival / ETA"}).`,
  },
  ja: {
    help: FREE_DAYS_HELP_JA,
    pending: "到着後に開始",
    container: "コンテナ",
    port: "港",
    days: (n: number) => `${n}日`,
    over: (n: number) => `${n}日超過`,
    ends: (det: string, dem: string, from: "discharge" | "eta") => `コンテナのフリータイム終了 ${det}、港のフリータイム終了 ${dem}（${from === "discharge" ? "荷揚日" : "到着日 / ETA"}から）。`,
  },
};

export function freeDays(s: Pick<ShipmentListItem, "freeTime" | "tab">, lang: "en" | "ja" = "en"): FreeDays {
  const t = L[lang];
  const f = s.freeTime;
  if (!f) return s.tab === "in_transit" ? { text: t.pending, tone: "pending", title: t.help } : { text: "—", tone: "pending", title: t.help };
  const least = Math.min(f.det.daysLeft, f.dem.daysLeft);
  const part = (label: string, x: { ends: string; daysLeft: number }) => (x.daysLeft < 0 ? `${label} ${t.over(-x.daysLeft)}` : `${label} ${t.days(x.daysLeft)}`);
  return {
    text: `${part(t.container, f.det)} · ${part(t.port, f.dem)}`,
    tone: least < 0 ? "over" : least <= 3 ? "warn" : "normal",
    title: `${t.help} ${t.ends(f.det.ends, f.dem.ends, f.from === "discharge" ? "discharge" : "eta")}`,
  };
}
