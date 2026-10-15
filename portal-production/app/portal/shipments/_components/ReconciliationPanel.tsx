/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Step 13 "Prepare data for Xero reconciliation": the order's money in one
// panel — PI / CI paid, Invoice #1 (goods + tax), SG→JP IV/PL total, import
// tax estimate vs actual, Invoice #2 lines (or the single invoice), costs — and
//   profit = d − a − b − c
// (a PI paid, b CI paid, c costs, d what the customer pays in total).
// Document figures are read from the order's finalized documents; payments,
// FX and actual costs are typed here (saved on blur).

import React, { useEffect, useState } from "react";
import { Alert, Box, CircularProgress, Grid, InputAdornment, Paper, Stack, TextField, Typography } from "@mui/material";
import { useReconciliation, useTradeMutation } from "../_lib/hooks";
import { fmtUsd, fmtYen } from "../_lib/format";
import { toast } from "../_lib/toast";

export default function ReconciliationPanel({ orderId, canEdit }: { orderId: string; canEdit: boolean }) {
  const q = useReconciliation(orderId);
  const save = useTradeMutation((a, body: Record<string, number | null>) => a.updateReconciliation(orderId, body));
  const r = q.data;
  if (q.isLoading) return <CircularProgress size={22} />;
  if (q.isError || !r) return <Alert severity="error">{(q.error as Error)?.message || "Could not load the reconciliation"}</Alert>;
  const put = async (k: string, v: number | null) => {
    try {
      await save.mutateAsync({ [k]: v });
    } catch (e: any) {
      toast.error(e?.message || "Could not save");
    }
  };
  const inv1 = r.docs.invoice1;
  const inv2 = r.docs.invoice2;
  const single = r.docs.single;
  return (
    <Paper variant="outlined" sx={{ p: { xs: 1.5, md: 2 } }} data-tour="order-reconciliation">
      <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
        Reconciliation {r.label}
      </Typography>
      <Grid container spacing={2} sx={{ mt: 0.5 }}>
        <Grid item xs={12} md={6}>
          <Section title="Documents (finalized)">
            <Line k="Invoice #1 — goods" v={inv1 ? fmtUsd(inv1.goods) : "—"} sub={inv1?.number ?? undefined} />
            <Line k="Invoice #1 — tax" v={inv1 ? fmtUsd(inv1.tax) : "—"} />
            <Line k="SG→JP IV/PL total" v={fmtUsd(r.docs.sgjpTotal)} />
            {single ? (
              <Line k="Single invoice total" v={fmtUsd(single.total)} sub={single.number ?? undefined} bold />
            ) : (
              <>
                {(inv2?.lines ?? []).map((l, i) => (
                  <Line key={i} k={`Invoice #2 · ${l.description.split("\n")[0].slice(0, 48)}`} v={fmtUsd(l.amount)} small />
                ))}
                <Line k="Invoice #2 total (合計)" v={inv2 ? fmtUsd(inv2.total) : "—"} sub={inv2?.numbers.join(", ")} bold />
              </>
            )}
          </Section>
          <Section title="Import tax">
            <Line k="Estimate" v={fmtYen(r.importTax.estimateJpy)} />
            <Line k="Actual (import permit)" v={fmtYen(r.importTax.actualJpy)} />
            <Line k="Variance" v={r.importTax.varianceJpy === null ? "—" : fmtYen(r.importTax.varianceJpy)} />
          </Section>
        </Grid>
        <Grid item xs={12} md={6}>
          <Section title="Payments and costs">
            <Grid container spacing={1.25}>
              <In label="a · PI paid (USD)" value={r.inputs.piPaid} placeholder={r.a} disabled={!canEdit} onSave={(v) => put("piPaid", v)} />
              <In label="b · CI paid (USD)" value={r.inputs.ciPaid} placeholder={r.b} disabled={!canEdit} onSave={(v) => put("ciPaid", v)} />
              <In label="FX (円/USD)" value={r.inputs.fxRate} placeholder={r.importTax.fxRate} disabled={!canEdit} onSave={(v) => put("fxRate", v)} />
              <In label="Import tax estimate (¥)" value={r.inputs.importTaxEstimateJpy} disabled={!canEdit} onSave={(v) => put("importTaxEstimateJpy", v)} />
              <In label="Import tax actual (¥)" value={r.inputs.importTaxActualJpy} placeholder={r.importTax.actualJpy} disabled={!canEdit} onSave={(v) => put("importTaxActualJpy", v)} />
              <In label="Mitsui Soko actuals (¥)" value={r.inputs.mitsuiActualsJpy} disabled={!canEdit} onSave={(v) => put("mitsuiActualsJpy", v)} />
              <In label="Other costs (¥)" value={r.inputs.otherCostsJpy} disabled={!canEdit} onSave={(v) => put("otherCostsJpy", v)} />
              <In label="Other costs (USD)" value={r.inputs.otherCostsUsd} disabled={!canEdit} onSave={(v) => put("otherCostsUsd", v)} />
            </Grid>
          </Section>
          <Paper variant="outlined" sx={{ p: 1.5, mt: 1.5, bgcolor: "action.hover" }}>
            <Line k="d · customer total" v={fmtUsd(r.d)} />
            <Line k="a · PI paid" v={fmtUsd(r.a)} />
            <Line k="b · CI paid" v={fmtUsd(r.b)} />
            <Line k={`c · costs (import tax ${fmtUsd(r.costs.importTaxUsd)} + Mitsui ${fmtUsd(r.costs.mitsuiUsd)} + other ${fmtUsd(r.costs.otherUsd)})`} v={fmtUsd(r.c)} />
            <Box sx={{ borderTop: 1, borderColor: "divider", mt: 0.75, pt: 0.75 }}>
              <Line k="Profit = d − a − b − c" v={fmtUsd(r.profit)} bold />
            </Box>
          </Paper>
        </Grid>
      </Grid>
    </Paper>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box sx={{ mb: 1.5 }}>
      <Typography variant="overline" color="text.secondary">
        {title}
      </Typography>
      {children}
    </Box>
  );
}

function Line({ k, v, sub, bold, small }: { k: string; v: string; sub?: string; bold?: boolean; small?: boolean }) {
  return (
    <Stack direction="row" spacing={2} justifyContent="space-between" sx={{ py: 0.25 }}>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant={small ? "caption" : "body2"} sx={{ fontWeight: bold ? 700 : 400 }} color={small ? "text.secondary" : undefined}>
          {k}
        </Typography>
        {sub && (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
            {sub}
          </Typography>
        )}
      </Box>
      <Typography variant={small ? "caption" : "body2"} sx={{ fontWeight: bold ? 700 : 400, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
        {v}
      </Typography>
    </Stack>
  );
}

function In({ label, value, placeholder, disabled, onSave }: { label: string; value: unknown; placeholder?: number | null; disabled?: boolean; onSave: (v: number | null) => void }) {
  const cur = value === null || value === undefined || value === "" ? "" : String(value);
  const [v, setV] = useState(cur);
  useEffect(() => setV(cur), [cur]);
  return (
    <Grid item xs={6}>
      <TextField
        fullWidth
        size="small"
        label={label}
        value={v}
        disabled={disabled}
        placeholder={placeholder !== null && placeholder !== undefined ? String(placeholder) : undefined}
        InputLabelProps={{ shrink: true }}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => {
          const n = v.trim() === "" ? null : Number(v.replace(/,/g, ""));
          if (n !== null && !Number.isFinite(n)) return toast.error(`${label}: enter a number`);
          if (String(n ?? "") !== cur) onSave(n);
        }}
        InputProps={placeholder !== null && placeholder !== undefined && !v ? { endAdornment: <InputAdornment position="end">default</InputAdornment> } : undefined}
      />
    </Grid>
  );
}
