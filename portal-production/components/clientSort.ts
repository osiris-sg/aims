"use client";

// Client-side full-dataset sorting for pages that paginate by slicing
// (guru 2026-09-09: header sort must reorder the WHOLE list, not just the
// visible page). The shared Table's internal sort only ever saw the current
// page's slice, so sorting silently did nothing across pages.
//
// Usage:
//   const { sorted, sortingProps } = useClientSort(visibleRows, {
//     outstanding: (r) => total(r) - paid(r),          // computed columns
//     createdAt:   (r) => r.config?.date ?? r.createdAt,
//   });
//   <PageTable data={sorted.slice((page-1)*limit, page*limit)} {...sortingProps} ... />
//
// Columns without a getter fall back to row[columnId]. Values are compared
// numerically when both parse as numbers, as dates when both parse as dates,
// otherwise as natural-order strings ("BI…035" < "BI…089", case-insensitive).

import { useMemo, useState } from "react";

export type SortGetters = Record<string, (row: any) => any>;

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function compareValues(a: any, b: any): number {
  const an = typeof a === "number" ? a : Number(a);
  const bn = typeof b === "number" ? b : Number(b);
  if (!Number.isNaN(an) && !Number.isNaN(bn)) return an - bn;
  const ad = a instanceof Date ? a.getTime() : Date.parse(a);
  const bd = b instanceof Date ? b.getTime() : Date.parse(b);
  // Date.parse is permissive; only trust it when BOTH parse and at least one
  // side isn't a plain string of digits/letters (ISO-ish input).
  if (!Number.isNaN(ad) && !Number.isNaN(bd) && (a instanceof Date || b instanceof Date || /[-/:]/.test(String(a)))) {
    return ad - bd;
  }
  return collator.compare(String(a), String(b));
}

const isEmpty = (v: any) => v === null || v === undefined || v === "";

export function sortRows<T>(rows: T[], sorting: { id: string; desc: boolean }[], getters?: SortGetters): T[] {
  const s = sorting?.[0];
  if (!s) return rows;
  const get = getters?.[s.id] ?? ((row: any) => row?.[s.id]);
  const dir = s.desc ? -1 : 1;
  return [...rows].sort((a, b) => {
    const av = get(a);
    const bv = get(b);
    // Empties sink to the bottom in BOTH directions (outside the dir flip).
    if (isEmpty(av) && isEmpty(bv)) return 0;
    if (isEmpty(av)) return 1;
    if (isEmpty(bv)) return -1;
    return dir * compareValues(av, bv);
  });
}

export function useClientSort<T>(rows: T[], getters?: SortGetters) {
  const [sorting, setSorting] = useState<{ id: string; desc: boolean }[]>([]);
  const sorted = useMemo(() => sortRows(rows, sorting, getters), [rows, sorting, getters]);
  return {
    sorted,
    sorting,
    // Spread onto <PageTable> / <Table>: the table stops sorting its slice and
    // the header arrows drive THIS hook instead.
    sortingProps: { manualSorting: true, sorting, onSortingChange: setSorting as any },
  };
}
