/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// The single invoice (Kato / Hoei — INVOICE_SINGLE), after ADH's Kato sheet:
// header 番号 (assigned on Finalize) / 発行日 / 件名 / 支払条件 / 有効期限, and
// three kinds of lines —
//   billet (goods): LME of the shipment month + QMJP + premium (+ upcharge) per MT;
//   yen lines: 通関、車輸送料 (taxable) and 通関 (課税対象外) typed / estimated in JPY,
//              converted at the FX (US$ = ROUND(¥ / FX, 2));
//   USD per MT: 他諸掛 (40 USD/MT).
// Totals mirror the server (ROUND to cents / yen): 非課税合計, 課税対象合計,
// 消費税, 今回請求合計額 in US$ and ¥.

import React, { useMemo, useRef } from "react";
import { Alert, Box, Button, Checkbox, Chip, FormControlLabel, Grid2, IconButton, MenuItem, Paper, Stack, Table, TableBody, TableCell, TableRow, TextField, Tooltip, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/DeleteOutline";
import { bankEntity, useShipmentsApi, type IssuingEntity } from "@/app/portal/shipments/_lib/api";
import { useTradeSettings } from "@/app/portal/shipments/_lib/hooks";
import { guardDate, tradeDateError } from "@/app/portal/shipments/_lib/dates";
import type { DocFormProps } from "./types";
import { toNum, usd } from "./invoiceCalc";

export type SingleLine = {
  kind: "goods" | "jpy" | "usd";
  description: string;
  quantity: number | null;
  lme?: number | null;
  qmjp?: number | null;
  premium?: number | null;
  upcharge?: number | null;
  unitPrice?: number | null;
  jpyAmount?: number | null;
  taxable: boolean;
  remarks: string;
  autoRemarks?: boolean;
  grade?: string | null;
  shipmentId?: string | null;
  orderId?: string | null;
};

type SingleHeader = {
  layout: "single";
  title: string;
  invoiceNo: string | null;
  issueDate: string;
  registrationNo: string;
  toName: string;
  toSuffix: string;
  subject: string;
  paymentTerms: string;
  validity: string;
  fromBlock: string;
  fxRate: number | null;
  fxNote: string;
  taxRate: number;
  lmeMonth: string;
  conditions: string;
  paymentBlock: string;
  bankBlock: string;
  bankId?: string | null;
  showSeal?: boolean;
  dueDate: string;
  dueDateManual?: boolean;
  currency: string;
};

const has = (v: unknown) => v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v));
const n = (v: unknown) => (has(v) ? Number(v) : 0);
const round = (v: number, dp: number) => {
  const f = 10 ** dp;
  return (Math.sign(v) * Math.round(Math.abs(v) * f + 1e-9)) / f;
};

/** One line's figures (mirrors the API's singleLineCalc). */
export function lineCalc(l: SingleLine, fx: number | null) {
  const q = has(l.quantity) ? Number(l.quantity) : null;
  const rate = has(fx) && Number(fx) > 0 ? Number(fx) : null;
  if (l.kind === "jpy") {
    const jpy = has(l.jpyAmount) ? Number(l.jpyAmount) : null;
    const amountUsd = jpy === null || rate === null ? 0 : round(jpy / rate, 2);
    return { unitUsd: q ? round(amountUsd / q, 2) : null, amountUsd, unitJpy: jpy === null || !q ? null : round(jpy / q, 0), amountJpy: jpy === null ? null : round(jpy, 0) };
  }
  const unit = l.kind === "goods" ? (has(l.lme) ? round(n(l.lme) + n(l.qmjp) + n(l.premium) + n(l.upcharge), 4) : null) : has(l.unitPrice) ? Number(l.unitPrice) : null;
  return {
    unitUsd: unit,
    amountUsd: unit === null || q === null ? 0 : round(q * unit, 2),
    unitJpy: unit === null || rate === null ? null : unit * rate,
    amountJpy: unit === null || q === null || rate === null ? null : round(q * unit * rate, 0),
  };
}

export function singleTotals(rows: SingleLine[], taxRate: number, fx: number | null) {
  const c = rows.map((l) => lineCalc(l, fx));
  const rate = n(taxRate) / 100;
  const sum = (pick: (x: ReturnType<typeof lineCalc>) => number | null, taxable: boolean) => rows.reduce((a, l, i) => a + (l.taxable === taxable ? (pick(c[i]) ?? 0) : 0), 0);
  const ut = round(sum((x) => x.amountUsd, true), 2);
  const un = round(sum((x) => x.amountUsd, false), 2);
  const tax = round(ut * rate, 2);
  const jt = round(sum((x) => x.amountJpy, true), 0);
  const jn = round(sum((x) => x.amountJpy, false), 0);
  const jtax = round(jt * rate, 0);
  return { lines: c, usd: { nonTaxable: un, taxable: ut, tax, total: round(un + ut + tax, 2) }, jpy: has(fx) && Number(fx) > 0 ? { nonTaxable: jn, taxable: jt, tax: jtax, total: jn + jt + jtax } : null };
}

const LINE_KINDS: Array<{ value: SingleLine["kind"]; label: string }> = [
  { value: "goods", label: "Billet (LME + QMJP + premium)" },
  { value: "jpy", label: "Yen amount (通関 / 車輸送)" },
  { value: "usd", label: "US$ per MT (他諸掛)" },
];

export default function SingleInvoiceForm({ doc, header: h, rows, disabled, setHeader, setRows }: DocFormProps<SingleHeader, SingleLine>) {
  const settings = useTradeSettings();
  const dd = (settings.data as any)?.docDefaults ?? {};
  const allBanks: Array<{ id: string; label: string; block: string; entity?: IssuingEntity }> = Array.isArray(dd.banks) && dd.banks.length ? dd.banks : [];
  // Every account, any entity: an ADH JP invoice may be paid into an ADH SG account (Kato's sample prints CFSB).
  const banks = allBanks;
  const totals = useMemo(() => singleTotals(rows, h.taxRate, h.fxRate), [rows, h.taxRate, h.fxRate]);
  const api = useShipmentsApi();
  const dueSeq = useRef(0);

  const remarksOf = (l: SingleLine, month: string) => {
    if (l.kind !== "goods" || ![l.lme, l.qmjp, l.premium, l.upcharge].some(has)) return l.remarks;
    const m = /^(\d{4})-(\d{2})$/.exec(month ?? "");
    const q = m ? String(Math.ceil(Number(m[2]) / 3)) : "";
    const lme = has(l.lme) ? `(${Number(l.lme)}USD)` : "";
    const up = has(l.upcharge) && Number(l.upcharge) !== 0 ? ` +${Number(l.upcharge)}(Upcharge)` : "";
    return `LME Cash ${m ? `${m[1]}/${Number(m[2])}` : month}月平均${lme} +${n(l.qmjp)}(${q}QMJP) + ${n(l.premium)}(Billet Premium)${up}`;
  };
  const setLine = (i: number, patch: Partial<SingleLine>) =>
    setRows((rs) =>
      rs.map((l, j) => {
        if (j !== i) return l;
        const next = { ...l, ...patch };
        if ("remarks" in patch) next.autoRemarks = false;
        else if (next.autoRemarks !== false && ["lme", "qmjp", "premium", "upcharge"].some((k) => k in patch)) next.remarks = remarksOf(next, h.lmeMonth);
        return next;
      }),
    );
  const setH = (patch: Partial<SingleHeader>) => {
    setHeader(patch);
    if (patch.lmeMonth !== undefined) setRows((rs) => rs.map((l) => (l.kind === "goods" && l.autoRemarks !== false ? { ...l, remarks: remarksOf(l, patch.lmeMonth!) } : l)));
  };
  const onIssueDate = async (v: string) => {
    setH({ issueDate: v });
    if (h.dueDateManual || !v || tradeDateError(v)) return;
    const seq = ++dueSeq.current;
    try {
      const r = await api.invoiceDueDate(v, "INVOICE_SINGLE");
      if (seq === dueSeq.current) setHeader({ dueDate: r.dueDate, dueDateManual: false });
    } catch {
      /* keep the current due date */
    }
  };
  const tf = (k: keyof SingleHeader, label: string, extra: Record<string, any> = {}) => (
    <TextField size="small" fullWidth label={label} value={(h[k] as any) ?? ""} disabled={disabled} onChange={(e) => setH({ [k]: e.target.value } as any)} {...guardDate(extra, h[k])} />
  );
  const cell = (i: number, k: keyof SingleLine, label: string, extra: Record<string, any> = {}) => (
    <TextField
      size="small"
      fullWidth
      type="number"
      label={label}
      value={(rows[i][k] as any) ?? ""}
      disabled={disabled}
      onChange={(e) => setLine(i, { [k]: toNum(e.target.value) } as any)}
      inputProps={{ step: "any", style: { textAlign: "right" } }}
      {...extra}
    />
  );

  return (
    <>
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
          <Typography variant="subtitle2">請求書 (single) — header</Typography>
          {(doc.covers?.length ?? 0) > 0 && <Chip size="small" variant="outlined" label={`Covers ${doc.covers!.map((c) => c.ref).join(", ")}`} />}
        </Stack>
        <Grid2 container spacing={1.5}>
          <Grid2 size={{ xs: 12, sm: 4 }}>
            {/* Blank = the 発行日 as yyyymmdd (Kato's numbering); type to override (e.g. 20260818_2). */}
            <TextField
              size="small"
              fullWidth
              label="番号 / Invoice no."
              value={h.invoiceNo ?? ""}
              placeholder={(h.issueDate ?? "").replace(/-/g, "").slice(0, 8) || "yyyymmdd of the issue date"}
              helperText={h.invoiceNo ? undefined : "Default: the issue date (yyyymmdd)"}
              disabled={disabled}
              onChange={(e) => setH({ invoiceNo: e.target.value || null })}
              InputLabelProps={{ shrink: true }}
            />
          </Grid2>
          <Grid2 size={{ xs: 12, sm: 4 }}>{tf("issueDate", "発行日 / Issue date", { type: "date", InputLabelProps: { shrink: true }, onChange: (e: any) => void onIssueDate(e.target.value) })}</Grid2>
          <Grid2 size={{ xs: 12, sm: 4 }}>{tf("dueDate", "Payment due (5 business days)", { type: "date", InputLabelProps: { shrink: true }, onChange: (e: any) => setH({ dueDate: e.target.value, dueDateManual: true }) })}</Grid2>
          <Grid2 size={{ xs: 12, sm: 9 }}>{tf("toName", "To (customer)")}</Grid2>
          <Grid2 size={{ xs: 12, sm: 3 }}>{tf("toSuffix", "Suffix")}</Grid2>
          <Grid2 size={12}>{tf("subject", "件名 / Subject")}</Grid2>
          <Grid2 size={{ xs: 12, sm: 6 }}>{tf("paymentTerms", "支払条件 / Payment terms")}</Grid2>
          <Grid2 size={{ xs: 12, sm: 6 }}>{tf("validity", "有効期限 / Validity")}</Grid2>
          <Grid2 size={12}>{tf("fromBlock", "From", { multiline: true, minRows: 2 })}</Grid2>
          <Grid2 size={{ xs: 6, sm: 2 }}>
            <TextField size="small" fullWidth type="number" label="Tax %" value={h.taxRate ?? ""} disabled={disabled} onChange={(e) => setH({ taxRate: toNum(e.target.value) ?? 0 })} />
          </Grid2>
          <Grid2 size={{ xs: 6, sm: 3 }}>
            <TextField
              size="small"
              fullWidth
              type="number"
              label="FX 円/USD"
              value={h.fxRate ?? ""}
              disabled={disabled}
              onChange={(e) => setH({ fxRate: toNum(e.target.value) })}
              inputProps={{ step: "0.01" }}
              helperText={h.fxRate ? undefined : "Needed for the yen lines"}
              FormHelperTextProps={{ sx: { color: "warning.main" } }}
            />
          </Grid2>
          <Grid2 size={{ xs: 12, sm: 7 }}>{tf("fxNote", "FX source note (税関 week)")}</Grid2>
          <Grid2 size={{ xs: 12, sm: 4 }}>{tf("lmeMonth", "LME average month (shipment month)", { type: "month", InputLabelProps: { shrink: true } })}</Grid2>
          <Grid2 size={12}>{tf("conditions", "条件 / Conditions", { multiline: true, minRows: 2 })}</Grid2>
          <Grid2 size={12}>{tf("paymentBlock", "支払い条件 / Payment conditions", { multiline: true, minRows: 1 })}</Grid2>
          {banks.length > 0 && (
            <Grid2 size={{ xs: 12, sm: 6 }}>
              <TextField
                select
                size="small"
                fullWidth
                label="Bank account (弊社指定口座)"
                value={banks.some((b) => b.id === h.bankId) ? h.bankId : ""}
                disabled={disabled}
                onChange={(e) => {
                  const b = banks.find((x) => x.id === e.target.value);
                  if (b) setH({ bankId: b.id, bankBlock: b.block });
                }}
              >
                {banks.map((b) => (
                  <MenuItem key={b.id} value={b.id}>
                    {b.label} · {bankEntity(b) === "ADH_JP" ? "ADH JP" : "ADH SG"}
                  </MenuItem>
                ))}
              </TextField>
            </Grid2>
          )}
          {dd.sealImage && (
            <Grid2 size={{ xs: 12, sm: 6 }}>
              <FormControlLabel control={<Checkbox checked={h.showSeal !== false} disabled={disabled} onChange={(e) => setH({ showSeal: e.target.checked })} />} label="Print the company seal" />
            </Grid2>
          )}
          <Grid2 size={12}>{tf("bankBlock", "Bank / 弊社指定口座", { multiline: true, minRows: 3 })}</Grid2>
        </Grid2>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
          <Typography variant="subtitle2">Lines</Typography>
          <Box sx={{ flex: 1 }} />
          {!disabled && (
            <Button size="small" startIcon={<AddIcon />} onClick={() => setRows((rs) => [...rs, { kind: "jpy", description: "", quantity: rs[0]?.quantity ?? null, jpyAmount: null, taxable: true, remarks: "" }])}>
              Add line
            </Button>
          )}
        </Stack>
        <Stack spacing={1.5}>
          {rows.map((l, i) => {
            const c = totals.lines[i];
            return (
              <Box key={i} sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1.5 }}>
                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                  <Typography variant="caption" color="text.secondary">
                    Line {i + 1}
                  </Typography>
                  <TextField select size="small" value={l.kind} disabled={disabled} onChange={(e) => setLine(i, { kind: e.target.value as SingleLine["kind"] })} sx={{ minWidth: 240 }}>
                    {LINE_KINDS.map((k) => (
                      <MenuItem key={k.value} value={k.value}>
                        {k.label}
                      </MenuItem>
                    ))}
                  </TextField>
                  <Box sx={{ flex: 1 }} />
                  <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>
                    US$ {usd(c.amountUsd)}
                    {c.amountJpy !== null ? ` · ¥${usd(c.amountJpy, 0)}` : ""}
                  </Typography>
                  {!disabled && (
                    <Tooltip title="Remove line">
                      <IconButton size="small" aria-label="Remove line" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )}
                </Stack>
                <Grid2 container spacing={1}>
                  <Grid2 size={{ xs: 12, md: 6 }}>
                    <TextField size="small" fullWidth multiline minRows={2} label="摘要 / Description" value={l.description} disabled={disabled} onChange={(e) => setLine(i, { description: e.target.value })} />
                  </Grid2>
                  <Grid2 size={{ xs: 12, md: 6 }}>
                    <TextField size="small" fullWidth multiline minRows={2} maxRows={8} label="備考 / Remarks" value={l.remarks} disabled={disabled} onChange={(e) => setLine(i, { remarks: e.target.value })} />
                  </Grid2>
                  <Grid2 size={{ xs: 6, sm: 3 }}>{cell(i, "quantity", "数量 (MT)")}</Grid2>
                  {l.kind === "goods" && (
                    <>
                      <Grid2 size={{ xs: 6, sm: 3 }}>{cell(i, "lme", "LME (shipment month avg)", { helperText: has(l.lme) ? undefined : "enter LME" })}</Grid2>
                      <Grid2 size={{ xs: 4, sm: 2 }}>{cell(i, "qmjp", "QMJP")}</Grid2>
                      <Grid2 size={{ xs: 4, sm: 2 }}>{cell(i, "premium", "Premium")}</Grid2>
                      <Grid2 size={{ xs: 4, sm: 2 }}>{cell(i, "upcharge", "Upcharge")}</Grid2>
                    </>
                  )}
                  {l.kind === "jpy" && <Grid2 size={{ xs: 6, sm: 4 }}>{cell(i, "jpyAmount", "金額(円)", { helperText: "¥ — converted at the FX" })}</Grid2>}
                  {l.kind === "usd" && <Grid2 size={{ xs: 6, sm: 4 }}>{cell(i, "unitPrice", "単価 US$/MT")}</Grid2>}
                  <Grid2 size={12}>
                    <Typography variant="caption" color="text.secondary">
                      単価 US$ {usd(c.unitUsd)} · 単価 ¥ {c.unitJpy === null ? "—" : usd(round(c.unitJpy, 0), 0)}
                    </Typography>
                    <FormControlLabel
                      sx={{ ml: 2 }}
                      control={<Checkbox size="small" checked={l.taxable !== false} disabled={disabled} onChange={(e) => setLine(i, { taxable: e.target.checked })} />}
                      label={<Typography variant="body2">課税対象 (消費税 {h.taxRate ?? 0}%)</Typography>}
                    />
                  </Grid2>
                </Grid2>
              </Box>
            );
          })}
          {!rows.length && <Alert severity="info">No lines yet</Alert>}
        </Stack>

        <Table size="small" sx={{ mt: 2, maxWidth: 560, ml: "auto", "& td": { fontVariantNumeric: "tabular-nums" } }}>
          <TableBody>
            {(
              [
                ["非課税合計", totals.usd.nonTaxable, totals.jpy?.nonTaxable],
                ["課税対象合計", totals.usd.taxable, totals.jpy?.taxable],
                [`消費税 (${h.taxRate ?? 0}%)`, totals.usd.tax, totals.jpy?.tax],
                ["今回請求合計額", totals.usd.total, totals.jpy?.total],
              ] as Array<[string, number, number | undefined]>
            ).map(([k, u, y], j) => (
              <TableRow key={k} sx={j === 3 ? { "& td": { fontWeight: 700 } } : undefined}>
                <TableCell>{k}</TableCell>
                <TableCell align="right">US$ {usd(u)}</TableCell>
                <TableCell align="right">{y === undefined ? (j === 3 ? "Set an FX rate for JPY" : "") : `¥${usd(y, 0)}`}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>
    </>
  );
}
