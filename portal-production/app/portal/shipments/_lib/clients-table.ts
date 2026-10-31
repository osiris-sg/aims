// Round AY part 3 — Clients tables (Customers, Suppliers, Shipping lines): sort, search and CSV of the chosen rows. Pure.

export type SortDir = "asc" | "desc";
export type ColValue = string | number | null | undefined;

/** Sort by a column's value: numbers numerically, text case-insensitively (Japanese too); empty values last. */
export function sortRows<T>(rows: T[], value: (r: T) => ColValue, dir: SortDir): T[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = value(a);
    const y = value(b);
    const ex = x === null || x === undefined || x === "";
    const ey = y === null || y === undefined || y === "";
    if (ex || ey) return ex === ey ? 0 : ex ? 1 : -1;
    if (typeof x === "number" && typeof y === "number") return (x - y) * sign;
    return String(x).localeCompare(String(y), ["en", "ja"], { sensitivity: "base", numeric: true }) * sign;
  });
}

/** Every word of the search must appear somewhere in the row's text (case- and width-insensitive). */
export function searchRows<T>(rows: T[], q: string, text: (r: T) => string): T[] {
  const words = q.normalize("NFKC").toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return rows;
  return rows.filter((r) => {
    const t = text(r).normalize("NFKC").toLowerCase();
    return words.every((w) => t.includes(w));
  });
}

const cell = (v: ColValue) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
/** CSV (UTF-8 with BOM so Excel opens Japanese correctly). */
export function csvOf<T>(rows: T[], cols: Array<{ label: string; value: (r: T) => ColValue }>): string {
  return "﻿" + [cols.map((c) => cell(c.label)).join(","), ...rows.map((r) => cols.map((c) => cell(c.value(r))).join(","))].join("\r\n");
}
