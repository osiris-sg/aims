"use client";

// Legacy "Slow Moving Items Analysis" (guru 2026-11-25). Items ranked by how
// little they sold in the window ending at the cut-off: on-hand stock, qty sold
// in the window, and the last date each was sold. Slowest (least sold) first.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Box, MenuItem, TextField, Typography } from "@mui/material";
import { toast } from "react-toastify";
import { useAccountingApi } from "@/app/portal/accounting/_lib/api";
import ReportShell, { downloadCsv } from "@/app/portal/accounting/_lib/report-shell/ReportShell";
import ReportTable, { ReportRow, fmtDate } from "@/app/portal/accounting/_lib/report-shell/ReportTable";
import { onReportDate } from "@/app/portal/accounting/_lib/report-shell/reportDate";
import { todayIso } from "@/helpers/orgToday";
import DateInput from "@/components/DateInput";

const unwrap = (r: any) => { let o = r; while (o && typeof o === "object" && o.success !== undefined && o.data !== undefined) o = o.data; return o; };

type Row = { code: string; description: string; onHand: number; qtySold: number; lastSold: string };

export default function SlowMovingReport() {
  const { request } = useAccountingApi();
  const [asOf, setAsOf] = useState(() => todayIso());
  const [months, setMonths] = useState("6");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<{ rows: Row[]; meta: any } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ asOf, months });
      setData(unwrap(await request(`/sales-reports/slow-moving?${qs.toString()}`)));
    } catch (e: any) {
      toast.error(e?.message || "Failed to load the slow moving analysis");
    } finally {
      setLoading(false);
    }
  }, [request, asOf, months]);

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const columns = useMemo(() => [
    { key: "code", label: "Code", align: "left" as const, width: 130 },
    { key: "desc", label: "Description", align: "left" as const },
    { key: "onhand", label: "On Hand", align: "right" as const, width: 100 },
    { key: "sold", label: "Qty Sold", align: "right" as const, width: 100 },
    { key: "last", label: "Last Sold", align: "left" as const, width: 110 },
  ], []);

  const rows = useMemo<ReportRow[]>(() => {
    if (!data) return [];
    return data.rows.map((r, i) => ({ kind: "row", key: `${r.code || r.description}-${i}`, cells: [r.code || "—", r.description, String(r.onHand), String(r.qtySold), r.lastSold ? fmtDate(r.lastSold) : "never"] }));
  }, [data]);

  const exportCsv = () => {
    if (!data) return;
    downloadCsv("Slow-Moving-Items.csv", [["Code", "Description", "On Hand", "Qty Sold", "Last Sold"], ...data.rows.map((r) => [r.code, r.description, r.onHand, r.qtySold, r.lastSold || "never"])]);
  };

  return (
    <ReportShell
      title="Slow Moving Items Analysis"
      loading={loading}
      onUpdate={load}
      filters={
        <>
          <Box><Typography variant="caption" sx={{ fontWeight: 700 }}>Cut-Off-Date</Typography><DateInput size="small" value={asOf} onChange={onReportDate(setAsOf)} sx={{ width: 170, mt: 0.25, display: "block" }} /></Box>
          <Box>
            <Typography variant="caption" sx={{ fontWeight: 700 }}>Window</Typography>
            <TextField size="small" select value={months} onChange={(e) => setMonths(e.target.value)} sx={{ width: 150, mt: 0.25, display: "block" }}>
              {["3", "6", "12", "24"].map((m) => <MenuItem key={m} value={m}>{`Last ${m} months`}</MenuItem>)}
            </TextField>
          </Box>
        </>
      }
      headerLines={data ? [`Sold in the ${data.meta?.months ?? months} months to ${fmtDate(asOf)} — slowest first`] : []}
      footerInfo={data ? `${data.rows.length} ${data.rows.length === 1 ? "item" : "items"}` : ""}
      onExportCsv={data?.rows.length ? exportCsv : undefined}
    >
      {data ? <ReportTable columns={columns} rows={rows} /> : null}
    </ReportShell>
  );
}
