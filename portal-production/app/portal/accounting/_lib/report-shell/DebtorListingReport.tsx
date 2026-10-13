"use client";

// Debtor / Creditor Listing (legacy screenshots 69/70 — guru 2026-07-20: Xero
// style, legacy words verbatim; AP twin added 2026-10-14 per guru "do the rest
// for AP, mirror the AR set"): every party's balance as at the cut-off date —
// Code | Name | Curr | Local Amount (DR/CR) | Curr | Foreign Amount (DR/CR)
// — with the TOTAL row. From/To range defaults to first → last code.
// Data: the aged summary (same engine as the AR/AP homes' balance tables).
// Accounting: a debtor's outstanding is a DR balance, a creditor's a CR
// balance — the suffix flips per side; an overpaid/credit position flips back.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Autocomplete, Box, TextField, Typography } from "@mui/material";
import { toast } from "react-toastify";
import { useAccountingApi } from "../api";
import ReportShell, { downloadCsv } from "./ReportShell";
import ReportTable, { ReportRow, fmtDate } from "./ReportTable";
import { useSideContacts, type ReportSide } from "./side";

const R = (n: number) => Math.round(n * 100) / 100;
const fmtAbs = (n: number) =>
  Math.abs(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const unwrap = (r: any) => {
  let out = r;
  while (out && typeof out === "object" && out.success !== undefined && out.data !== undefined) out = out.data;
  return out;
};

const toISO = (y: number, m0: number, day: number) =>
  `${y}-${String(m0 + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
const monthEndISO = (iso: string) => {
  const d = new Date(iso);
  return toISO(d.getFullYear(), d.getMonth(), new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate());
};

type AgedRow = { contactId: string; contactName: string; total: number; currency: string | null; foreignTotal: number | null };

export default function DebtorListingReport({ side = "receivable" }: { side?: ReportSide }) {
  const { request } = useAccountingApi();
  const { sorted: sortedContacts, byId: contactById, codeOf, words } = useSideContacts(side);
  // Positive outstanding is DR for a debtor, CR for a creditor.
  const drcr = (n: number) =>
    side === "payable" ? (n < -0.005 ? "DR" : "CR") : (n < -0.005 ? "CR" : "DR");

  const [fromContact, setFromContact] = useState<any>(null);
  const [toContact, setToContact] = useState<any>(null);
  const [cutOff, setCutOff] = useState(() => monthEndISO(new Date().toISOString().slice(0, 10)));
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<AgedRow[] | null>(null);

  // Legacy default: the range runs from the FIRST to the LAST code.
  useEffect(() => {
    if (!sortedContacts.length) return;
    setFromContact((prev: any) => prev || sortedContacts[0]);
    setToContact((prev: any) => prev || sortedContacts[sortedContacts.length - 1]);
  }, [sortedContacts]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await request(`/statements/aged?side=${words.agedSide}&asOf=${cutOff}&level=summary`);
      setRows(unwrap(res)?.rows || []);
    } catch (e: any) {
      toast.error(e?.message || `Failed to load the ${words.party.toLowerCase()} listing`);
    } finally {
      setLoading(false);
    }
  }, [request, cutOff, words.agedSide, words.party]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    if (!rows) return null;
    const withCode = rows.map((r) => ({ ...r, code: codeOf(contactById.get(r.contactId)) }));
    let out = withCode;
    if (fromContact || toContact) {
      const a = codeOf(fromContact || toContact);
      const b = codeOf(toContact || fromContact);
      const [lo, hi] = a.localeCompare(b) <= 0 ? [a, b] : [b, a];
      out = withCode.filter((r) => r.code && r.code.localeCompare(lo) >= 0 && r.code.localeCompare(hi) <= 0);
    }
    return out.sort((x, y) => x.code.localeCompare(y.code) || x.contactName.localeCompare(y.contactName));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, fromContact, toContact, contactById]);

  // Columns word-for-word from the legacy sheet.
  const columns = useMemo(
    () => [
      { key: "code", label: "Code", align: "left" as const, width: 90 },
      { key: "name", label: "Name", align: "left" as const },
      { key: "lcurr", label: "Curr", align: "left" as const, width: 70 },
      { key: "local", label: "Local Amount", align: "right" as const, width: 150 },
      { key: "fcurr", label: "Curr", align: "left" as const, width: 70 },
      { key: "foreign", label: "Foreign Amount", align: "right" as const, width: 160 },
    ],
    [],
  );

  const total = R((filtered || []).reduce((s, r) => s + (Number(r.total) || 0), 0));

  const tableRows = useMemo<ReportRow[]>(() => {
    if (!filtered) return [];
    const out: ReportRow[] = filtered.map((r) => {
      const foreignCurr = (r.currency || contactById.get(r.contactId)?.currency || "SGD").toUpperCase();
      const foreign = r.currency ? Number(r.foreignTotal) || 0 : Number(r.total) || 0;
      return {
        kind: "row",
        key: r.contactId,
        cells: [
          r.code,
          r.contactName,
          "SGD",
          `${fmtAbs(r.total)} ${drcr(r.total)}`,
          foreignCurr,
          `${fmtAbs(foreign)} ${drcr(foreign)}`,
        ],
      };
    });
    out.push({ kind: "total", key: "__total", cells: ["TOTAL", "", "", `${fmtAbs(total)} ${drcr(total)}`, "", ""] });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, total, contactById]);

  const exportCsv = () => {
    if (!filtered) return;
    downloadCsv(`${words.party}-Listing-${cutOff}.csv`, [
      ["Code", "Name", "Curr", "Local Amount", "DR/CR", "Curr", "Foreign Amount", "DR/CR"],
      ...filtered.map((r) => {
        const foreignCurr = (r.currency || contactById.get(r.contactId)?.currency || "SGD").toUpperCase();
        const foreign = r.currency ? Number(r.foreignTotal) || 0 : Number(r.total) || 0;
        return [r.code, r.contactName, "SGD", fmtAbs(r.total), drcr(r.total), foreignCurr, fmtAbs(foreign), drcr(foreign)];
      }),
      ["TOTAL", "", "SGD", fmtAbs(total), drcr(total), "", "", ""],
    ]);
  };

  const contactPicker = (label: string, value: any, onChange: (v: any) => void) => (
    <Box>
      <Typography variant="caption" sx={{ fontWeight: 700 }}>
        {label}
      </Typography>
      <Autocomplete
        size="small"
        sx={{ width: 260, mt: 0.25 }}
        options={sortedContacts}
        getOptionLabel={(o: any) => `${codeOf(o) ? `${codeOf(o)} — ` : ""}${o.name || ""}`}
        isOptionEqualToValue={(o: any, v: any) => o?.id === v?.id}
        value={value}
        onChange={(_, v) => onChange(v)}
        renderInput={(p) => <TextField {...p} placeholder={`Search ${words.contactNoun}`} />}
      />
    </Box>
  );

  return (
    <ReportShell
      title={`${words.party} Listing`}
      loading={loading}
      onUpdate={() => load()}
      filters={
        <>
          <Box>
            <Typography variant="caption" sx={{ fontWeight: 700 }}>
              Cut-Off-Date
            </Typography>
            <TextField
              size="small"
              type="date"
              value={cutOff}
              onChange={(e) => e.target.value && setCutOff(e.target.value)}
              sx={{ width: 170, mt: 0.25, display: "block" }}
            />
          </Box>
          {contactPicker(`From ${words.party}`, fromContact, setFromContact)}
          {contactPicker(`To ${words.party}`, toContact, setToContact)}
        </>
      }
      headerLines={
        filtered
          ? [
              `Period Ending : ${fmtDate(cutOff)}`,
              `From ${words.party} : ${codeOf(fromContact) || "—"}   To ${words.party} : ${codeOf(toContact) || "—"}`,
            ]
          : []
      }
      footerInfo={filtered ? `${filtered.length} ${filtered.length === 1 ? words.party.toLowerCase() : words.partyPlural}` : ""}
      onExportCsv={filtered?.length ? exportCsv : undefined}
    >
      {filtered ? <ReportTable columns={columns} rows={tableRows} /> : null}
    </ReportShell>
  );
}
