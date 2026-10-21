// Round Q: the port free-time countdown in words. It only starts once the
// vessel is in (discharge, else arrival): in-transit rows say "starts on
// arrival". Container = DET (days left to return the empty container before
// detention charges); Port = DEM (days left at the port before demurrage).
// Red at ≤ 3 days. Pure, tested in helpers/uiTrim.test.mjs.
import type { ShipmentListItem } from "./api";

export type FreeDays = { text: string; tone: "normal" | "warn" | "over" | "pending"; title: string };

export const FREE_DAYS_HELP = "Container = days left to return the empty container before detention charges (DET). Port = days left at the port before demurrage (DEM). Counted from discharge, else arrival.";

const d = (n: number) => `${n}d`;

export function freeDays(s: Pick<ShipmentListItem, "freeTime" | "tab">): FreeDays {
  const f = s.freeTime;
  if (!f) return s.tab === "in_transit" ? { text: "starts on arrival", tone: "pending", title: FREE_DAYS_HELP } : { text: "—", tone: "pending", title: FREE_DAYS_HELP };
  const least = Math.min(f.det.daysLeft, f.dem.daysLeft);
  const part = (label: string, x: { ends: string; daysLeft: number }) => (x.daysLeft < 0 ? `${label} ${-x.daysLeft}d over` : `${label} ${d(x.daysLeft)}`);
  return {
    text: `${part("Container", f.det)} · ${part("Port", f.dem)}`,
    tone: least < 0 ? "over" : least <= 3 ? "warn" : "normal",
    title: `${FREE_DAYS_HELP} Container free time ends ${f.det.ends}, port free time ends ${f.dem.ends} (from ${f.from === "discharge" ? "discharge" : "arrival / ETA"}).`,
  };
}
