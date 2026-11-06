// Round BG — 出庫・納入依頼書 Deliveries: fast entry of truck days. Pure: no React, no imports.
//  - working days: not Saturday / Sunday / a Japanese public holiday (the list comes from the API: @holiday-jp/holiday_jp);
//  - 出荷日 = 納入日 − 1 working day (a Monday delivery ships the Friday before);
//  - "Paste from Excel": 納品日 · LOT · バンドル数/台 (one line per truck; any column order, header optional,
//    "11/9(月)" dates, a blank date / LOT = the one above) → one row per delivery day + LOT;
//  - "Fill days…", totals vs the B/L, weights per row.

export type SiRow = {
  shipDate: string;
  deliveryDate: string;
  destination: string;
  billet: string;
  bundles: number | null;
  lot?: string | null;
  trucks?: number | null;
  shipDateEdited?: boolean;
  netMt?: number | null;
  grossMt?: number | null;
  delivered?: boolean;
};
export type SiLot = { lot: string; billet: string; bundles: number; netMt: number; grossMt: number; avgNetMt: number | null; avgGrossMt: number | null; missing?: number; shipments?: Array<{ ref: string; bundles: number | null }> };

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const toDate = (ymd: string) => new Date(`${ymd}T00:00:00Z`);
const toYmd = (d: Date) => d.toISOString().slice(0, 10);
const add = (ymd: string, n: number) => {
  const d = toDate(ymd);
  d.setUTCDate(d.getUTCDate() + n);
  return toYmd(d);
};

export const isWorkingDay = (ymd: string, holidays: Set<string>) => {
  const w = toDate(ymd).getUTCDay();
  return w !== 0 && w !== 6 && !holidays.has(ymd);
};
export function prevWorkingDay(ymd: string, holidays: Set<string>): string {
  let d = add(ymd, -1);
  for (let i = 0; i < 30 && !isWorkingDay(d, holidays); i++) d = add(d, -1);
  return d;
}
export function nextWorkingDay(ymd: string, holidays: Set<string>): string {
  let d = add(ymd, 1);
  for (let i = 0; i < 30 && !isWorkingDay(d, holidays); i++) d = add(d, 1);
  return d;
}
/** 出荷日 for a 納入日: the working day before (Monday → the previous Friday; holidays skipped). */
export const shipDateFor = (delivery: string, holidays: Set<string>) => (ISO.test(delivery) ? prevWorkingDay(delivery, holidays) : "");

/** Every working day (or every day) from → to, inclusive. */
export function daysBetween(from: string, to: string, holidays: Set<string>, skip = true): string[] {
  if (!ISO.test(from) || !ISO.test(to) || from > to) return [];
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 120; d = add(d, 1)) if (!skip || isWorkingDay(d, holidays)) out.push(d);
  return out;
}

// ── paste from Excel ───────────────────────────────────────────────────────
const DATE_RE = /^(?:(\d{4})\s*[/\-.年]\s*)?(\d{1,2})\s*[/\-.月]\s*(\d{1,2})\s*日?\s*(?:[(（][^)）]*[)）])?$/;
const cellsOf = (line: string) => (line.includes("\t") ? line.split("\t") : line.split(/\s{2,}|,|，/)).map((c) => c.replace(/[　]/g, " ").trim());
const half = (s: string) => s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/／/g, "/");

/** "11/9(月)" / "2026/11/9" / "11月9日" → YYYY-MM-DD (the year from the reference day: a date half a year before it is next year's). */
export function parseDay(cell: string, ref: string): string | null {
  const m = DATE_RE.exec(half(cell).trim());
  if (!m) return null;
  const mo = Number(m[2]);
  const da = Number(m[3]);
  if (mo < 1 || mo > 12 || da < 1 || da > 31) return null;
  let y = m[1] ? Number(m[1]) : Number(ref.slice(0, 4));
  const mk = (yy: number) => `${yy}-${String(mo).padStart(2, "0")}-${String(da).padStart(2, "0")}`;
  if (!m[1] && mk(y) < add(ref, -183)) y += 1;
  const out = mk(y);
  return toYmd(toDate(out)) === out ? out : null;
}
const lotOf = (cell: string, lots: string[]) => {
  const m = /(?:^|\D)(\d{4})(?:\D|$)/.exec(half(cell));
  if (!m) return null;
  return lots.length && !lots.includes(m[1]) && !/^[1-8]\d{3}$/.test(m[1]) ? null : m[1];
};
const bundlesOf = (cell: string) => {
  const m = /^(\d{1,3})\s*(?:束|本|bundles?|b)?$/i.exec(half(cell).trim());
  return m && Number(m[1]) > 0 ? Number(m[1]) : null;
};

export type PasteLine = { line: number; date: string; lot: string; bundles: number };
export type PasteResult = { lines: PasteLine[]; problems: Array<{ line: number; text: string; why: "noDate" | "noLot" | "noBundles" }>; columns: { date: number; lot: number; bundles: number } | null };

/** Parse the pasted 納品日 / LOT / バンドル数 columns (any order, header optional; one line = one truck). */
export function parseSchedule(text: string, ref: string, lots: string[] = []): PasteResult {
  const raw = text.replace(/\r/g, "").split("\n").map((l, i) => ({ i: i + 1, l })).filter((x) => x.l.trim());
  if (!raw.length) return { lines: [], problems: [], columns: null };
  let rows = raw.map((x) => ({ i: x.i, c: cellsOf(x.l) }));
  const width = Math.max(...rows.map((r) => r.c.length));
  let cols: { date: number; lot: number; bundles: number } | null = null;
  // A header row names the columns.
  const head = rows[0].c.map((c) => c.toLowerCase());
  const find = (re: RegExp) => head.findIndex((c) => re.test(c));
  const hd = find(/納品日|納入日|日付|date|配送日/);
  const hl = find(/lot|ロット|品種|合金/);
  const hb = find(/バンドル|束|bundle|数/);
  if (hd >= 0 && hb >= 0) {
    cols = { date: hd, lot: hl, bundles: hb };
    rows = rows.slice(1);
  } else {
    // No header: the column with the most dates, then the most LOTs (4 digits), then the most small numbers.
    const score = (f: (c: string) => boolean, skip: number[]) => {
      let best = -1;
      let bestN = 0;
      for (let k = 0; k < width; k++) {
        if (skip.includes(k)) continue;
        const n = rows.filter((r) => f(r.c[k] ?? "")).length;
        if (n > bestN) [best, bestN] = [k, n];
      }
      return best;
    };
    const d = score((c) => !!parseDay(c, ref), []);
    const l = score((c) => !!lotOf(c, lots) && !bundlesOf(c), [d]);
    const b = score((c) => !!bundlesOf(c), [d, l]);
    cols = d >= 0 && b >= 0 ? { date: d, lot: l, bundles: b } : null;
  }
  if (!cols) return { lines: [], problems: raw.map((x) => ({ line: x.i, text: x.l, why: "noBundles" as const })), columns: null };
  const out: PasteLine[] = [];
  const problems: PasteResult["problems"] = [];
  let lastDate = "";
  let lastLot = lots.length === 1 ? lots[0] : "";
  for (const r of rows) {
    const dc = r.c[cols.date] ?? "";
    const date = dc.trim() ? parseDay(dc, ref) : lastDate;
    const lc = cols.lot >= 0 ? (r.c[cols.lot] ?? "") : "";
    const lot = lc.trim() ? lotOf(lc, lots) : lastLot;
    const bundles = bundlesOf(r.c[cols.bundles] ?? "");
    const text = r.c.join(" · ");
    if (!date) problems.push({ line: r.i, text, why: "noDate" });
    else if (!lot && lots.length > 1) problems.push({ line: r.i, text, why: "noLot" });
    else if (!bundles) problems.push({ line: r.i, text, why: "noBundles" });
    else out.push({ line: r.i, date, lot: lot ?? "", bundles });
    if (date) lastDate = date;
    if (lot) lastLot = lot;
  }
  return { lines: out, problems, columns: cols };
}

export type DayGroup = { deliveryDate: string; lot: string; bundles: number; trucks: number };
/** One group per delivery day + LOT: bundles summed, trucks counted (one pasted line = one truck), by 納入日 then LOT. */
export function groupSchedule(lines: PasteLine[]): DayGroup[] {
  const m = new Map<string, DayGroup>();
  for (const l of lines) {
    const k = `${l.date}|${l.lot}`;
    const g = m.get(k) ?? { deliveryDate: l.date, lot: l.lot, bundles: 0, trucks: 0 };
    g.bundles += l.bundles;
    g.trucks += 1;
    m.set(k, g);
  }
  return [...m.values()].sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate) || a.lot.localeCompare(b.lot));
}

/** SI rows for the groups: 出荷日 from the 納入日, product from the LOT, 納入先 from the delivery site. */
export function rowsFor(groups: DayGroup[], lots: SiLot[], destination: string, holidays: Set<string>): SiRow[] {
  return groups.map((g) => {
    const lot = lots.find((l) => l.lot === g.lot) ?? (lots.length === 1 ? lots[0] : null);
    return { shipDate: shipDateFor(g.deliveryDate, holidays), deliveryDate: g.deliveryDate, destination, billet: lot?.billet ?? g.lot, bundles: g.bundles, lot: lot?.lot ?? (g.lot || null), trucks: g.trucks };
  });
}

/** Rows by 納入日 (then 出荷日); rows without a 納入日 keep their order at the end. */
export function sortRows<T extends { deliveryDate?: string | null; shipDate?: string | null }>(rows: T[]): T[] {
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const da = a.r.deliveryDate && ISO.test(a.r.deliveryDate) ? a.r.deliveryDate : "";
      const db = b.r.deliveryDate && ISO.test(b.r.deliveryDate) ? b.r.deliveryDate : "";
      if (da && db) return da.localeCompare(db) || String(a.r.shipDate ?? "").localeCompare(String(b.r.shipDate ?? "")) || a.i - b.i;
      return da ? -1 : db ? 1 : a.i - b.i;
    })
    .map((x) => x.r);
}

/** An empty row: no date and no bundles (never printed; dropped when rows are added). */
export const isEmptyRow = (r: Partial<SiRow>) => !String(r.shipDate ?? "").trim() && !String(r.deliveryDate ?? "").trim() && !(Number(r.bundles) > 0);

/** "Add row": the next working day after the last row, same product / 納入先 / LOT. */
export function nextRow(rows: SiRow[], holidays: Set<string>, today: string): SiRow {
  const dated = sortRows(rows.filter((r) => ISO.test(r.deliveryDate ?? "")));
  const last = dated[dated.length - 1] ?? rows[rows.length - 1];
  const base = last?.deliveryDate && ISO.test(last.deliveryDate) ? last.deliveryDate : add(today, 0);
  const deliveryDate = last?.deliveryDate && ISO.test(last.deliveryDate) ? nextWorkingDay(base, holidays) : isWorkingDay(base, holidays) ? base : nextWorkingDay(base, holidays);
  return { shipDate: shipDateFor(deliveryDate, holidays), deliveryDate, destination: last?.destination ?? "", billet: last?.billet ?? "", bundles: null, lot: last?.lot ?? null, trucks: null };
}

/** Rows with a new 納入日: 出荷日 follows unless it was typed by hand. */
export function withDelivery(r: SiRow, deliveryDate: string, holidays: Set<string>): SiRow {
  return { ...r, deliveryDate, ...(r.shipDateEdited ? {} : { shipDate: shipDateFor(deliveryDate, holidays) }) };
}

/** Bundles per LOT on the rows vs the B/L(s), and the whole. */
export function bundleTotals(rows: SiRow[], lots: SiLot[]) {
  const onRows = (lot: string | null) => rows.filter((r) => !isEmptyRow(r) && (lot === null || (r.lot ?? lotFromBillet(r.billet, lots)) === lot)).reduce((a, r) => a + (Number(r.bundles) || 0), 0);
  const perLot = lots.map((l) => ({ lot: l.lot, rows: onRows(l.lot), bl: l.bundles, diff: onRows(l.lot) - l.bundles, missing: l.missing ?? 0 }));
  const total = onRows(null);
  const bl = lots.reduce((a, l) => a + l.bundles, 0);
  return { perLot, total, bl, diff: total - bl };
}
const lotFromBillet = (billet: string, lots: SiLot[]) => lots.find((l) => l.billet === billet)?.lot ?? /(\d{4})/.exec(billet ?? "")?.[1] ?? null;

/** Weights per row: bundles × the LOT's average bundle weight (3 dp). */
export function withWeights(r: SiRow, lots: SiLot[]): SiRow {
  const lot = lots.find((l) => l.lot === (r.lot ?? lotFromBillet(r.billet, lots))) ?? (lots.length === 1 ? lots[0] : null);
  const b = Number(r.bundles) || 0;
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  return { ...r, netMt: lot?.avgNetMt && b ? r3(b * lot.avgNetMt) : null, grossMt: lot?.avgGrossMt && b ? r3(b * lot.avgGrossMt) : null };
}
