/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// ADH 請求書 (Invoice #1 / Invoice #2) form. Header fields (number is assigned
// on Finalize from the org's invoice numbering), lines with an optional
// pricing helper (LME + QMJP + premium + upcharge → unit price, remarks text),
// negative lines for adjustments, and live totals incl. the JPY breakdown.
// Invoice #1 can bill lines of the customer's other open contracts too.

import React, { useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Grid2,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/DeleteOutline";
import PlaylistAddIcon from "@mui/icons-material/PlaylistAdd";
import { useContract, useContracts, useTradeSettings } from "@/app/portal/shipments/_lib/hooks";
import { useShipmentsApi } from "@/app/portal/shipments/_lib/api";
import { lineLabel } from "@/app/portal/shipments/_lib/format";
import type { DocFormProps } from "./types";
import { amountOf, awaitingLme, helperRemarks, helperUsed, invoiceTotals, lineFromContractLine, roundTo, toNum, unitPriceOf, usd, type InvoiceLine } from "./invoiceCalc";
import { guardDate, tradeDateError } from "@/app/portal/shipments/_lib/dates";

type InvoiceHeader = {
  title: string;
  invoiceNo: string | null;
  issueDate: string;
  registrationNo: string;
  toName: string;
  toSuffix: string;
  subject: string;
  fromBlock: string;
  dueDate: string;
  /** Payment due date typed by hand: it no longer follows the issue date. */
  dueDateManual?: boolean;
  dueLine: string;
  taxRate: number;
  fxRate: number | null;
  fxNote: string;
  lmeMonth: string;
  conditions: string;
  paymentTerms: string;
  bankBlock: string;
  bankId?: string | null;
  showSeal?: boolean;
  currency: string;
  /** Invoice #2 (final price): totals end with １回目の金額 and the 差額. */
  variant?: "final";
  invoice1Amount?: number | null;
  invoice1No?: string | null;
};

const blankLine = (dueDate: string | null, unit: string): InvoiceLine => ({ description: "", quantity: null, unit, unitPrice: null, amountOverride: null, remarks: "", dueDate, autoRemarks: false });

export default function InvoiceDocForm({ doc, header: h, rows, disabled, setHeader, setRows }: DocFormProps<InvoiceHeader, InvoiceLine>) {
  const settings = useTradeSettings();
  const dd = (settings.data as any)?.docDefaults ?? {};
  const isFinal2 = h.variant === "final";
  // Invoice #2 quotes the shipment month's LME in its own wording.
  const remarksTpl: string | undefined = (doc.docType === "INVOICE_2" && dd.invoice2RemarksTemplate) || dd.invoiceRemarksTemplate;
  const upTpl: string | undefined = dd.invoiceUpchargeTemplate;
  const banks: Array<{ id: string; label: string; block: string }> = Array.isArray(dd.banks) && dd.banks.length ? dd.banks : dd.invoiceBankBlock ? [{ id: "default", label: String(dd.invoiceBankBlock).split("\n")[0], block: dd.invoiceBankBlock }] : [];
  const unit: string = dd.invoiceUnit ?? "トン";
  const [pick, setPick] = useState(false);
  const totals = useMemo(() => invoiceTotals(rows, h.taxRate, h.fxRate, isFinal2 ? "final" : undefined), [rows, h.taxRate, h.fxRate, isFinal2]);
  /** Subject from the billed grades with the org's template: "{grade}" gives one line per grade, "{grades}" joins them ("6005・6063"). Mirrors the API's invoiceSubject. */
  const autoSubject = (lines: InvoiceLine[]) => {
    const grades = [...new Set(lines.map((l) => l.grade).filter((g): g is string => !!g))];
    const product = dd.productJa?.["Aluminium Billet"] ?? "";
    const tpl = String(dd.invoiceSubjectTemplate ?? "{grade}{product}");
    if (tpl.includes("{grade}")) return (grades.length ? grades : [""]).map((g) => tpl.split("{grade}").join(g).split("{product}").join(product)).join("\n");
    return tpl.split("{grades}").join(grades.join("・")).split("{product}").join(product);
  };

  // Invoice #1 may also bill the same customer's other open contracts.
  const own = useContract(doc.contractId ?? undefined);
  const customerId = own.data?.customerId;
  const others = useContracts({ customerId, status: "OPEN", pageSize: 100 }, !!customerId && pick);

  const setLine = (i: number, patch: Partial<InvoiceLine>) =>
    setRows((rs) =>
      rs.map((l, j) => {
        if (j !== i) return l;
        const next = { ...l, ...patch };
        // Remarks follow the pricing helper until the user types their own.
        if ("remarks" in patch) next.autoRemarks = false;
        else if (next.autoRemarks !== false && ["lme", "qmjp", "premium", "upcharge"].some((k) => k in patch)) next.remarks = helperRemarks(next, h.lmeMonth, remarksTpl, upTpl);
        return next;
      }),
    );
  const setH = (patch: Partial<InvoiceHeader>) => {
    setHeader(patch);
    if (patch.lmeMonth !== undefined) setRows((rs) => rs.map((l) => (l.autoRemarks !== false && helperUsed(l) ? { ...l, remarks: helperRemarks(l, patch.lmeMonth!, remarksTpl, upTpl) } : l)));
  };

  // Dates follow each other until typed by hand ("auto"): issue date → payment
  // due date (the org's business days — Invoice #1 7, Invoice #2 6 — Japanese
  // holidays skipped, computed by the API) → each line's 取引年月日.
  const api = useShipmentsApi();
  const dueSeq = useRef(0);
  const followDue = (due: string) => setRows((rs) => rs.map((l) => (l.dueDateManual ? l : { ...l, dueDate: due })));
  const autoDueFrom = async (issueDate: string) => {
    if (!issueDate || tradeDateError(issueDate)) return;
    const seq = ++dueSeq.current;
    try {
      const r = await api.invoiceDueDate(issueDate, doc.docType);
      if (seq !== dueSeq.current) return; // a later issue date won
      setHeader({ dueDate: r.dueDate, dueDateManual: false });
      followDue(r.dueDate);
    } catch {
      /* keep the current due date */
    }
  };
  const onIssueDate = (v: string) => {
    setH({ issueDate: v });
    if (!h.dueDateManual) void autoDueFrom(v);
  };
  const onDueDate = (v: string) => {
    dueSeq.current++; // drop an in-flight auto value
    setH({ dueDate: v, dueDateManual: true });
    if (v && !tradeDateError(v)) followDue(v);
  };
  const autoChip = (manual: boolean | undefined, reset: () => void) =>
    manual ? (
      <Tooltip title="Typed by hand — click to follow the dates again">
        <Chip size="small" variant="outlined" label="manual · reset" onClick={disabled ? undefined : reset} sx={{ height: 20, fontSize: 11 }} />
      </Tooltip>
    ) : (
      <Tooltip title="Follows the issue date — type a date to override">
        <Chip size="small" color="info" variant="outlined" label="auto" sx={{ height: 20, fontSize: 11 }} />
      </Tooltip>
    );

  const tf = (k: keyof InvoiceHeader, label: string, extra: Record<string, any> = {}) => (
    <TextField size="small" fullWidth label={label} value={(h[k] as any) ?? ""} disabled={disabled} onChange={(e) => setH({ [k]: e.target.value } as any)} {...guardDate(extra, h[k])} />
  );
  const numTf = (k: "taxRate" | "fxRate" | "invoice1Amount", label: string, extra: Record<string, any> = {}) => (
    <TextField size="small" fullWidth type="number" label={label} value={h[k] ?? ""} disabled={disabled} onChange={(e) => setH({ [k]: toNum(e.target.value) } as any)} {...extra} />
  );
  const cell = (i: number, k: keyof InvoiceLine, label: string, extra: Record<string, any> = {}) => (
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
        <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
          請求書 — header
        </Typography>
        <Grid2 container spacing={1.5}>
          <Grid2 size={{ xs: 12, sm: 4 }}>
            <TextField size="small" fullWidth label="Invoice no." value={h.invoiceNo ?? ""} placeholder="Assigned on Finalize" disabled InputLabelProps={{ shrink: true }} />
          </Grid2>
          <Grid2 size={{ xs: 12, sm: 4 }}>{tf("issueDate", "Issue date", { type: "date", InputLabelProps: { shrink: true }, onChange: (e: any) => onIssueDate(e.target.value) })}</Grid2>
          <Grid2 size={{ xs: 12, sm: 4 }}>{tf("registrationNo", "Registration no. (登録番号)")}</Grid2>
          <Grid2 size={{ xs: 12, sm: 9 }}>{tf("toName", "To (customer)")}</Grid2>
          <Grid2 size={{ xs: 12, sm: 3 }}>{tf("toSuffix", "Suffix")}</Grid2>
          <Grid2 size={12}>{tf("subject", "Subject / 件名", { multiline: true, minRows: 1 })}</Grid2>
          <Grid2 size={12}>{tf("fromBlock", "From", { multiline: true, minRows: 2 })}</Grid2>
          <Grid2 size={{ xs: 12, sm: 4 }}>
            {tf("dueDate", "Payment due date", {
              type: "date",
              InputLabelProps: { shrink: true },
              onChange: (e: any) => onDueDate(e.target.value),
              InputProps: { endAdornment: autoChip(h.dueDateManual, () => void autoDueFrom(h.issueDate)) },
            })}
          </Grid2>
          <Grid2 size={{ xs: 12, sm: 8 }}>{tf("dueLine", "Due line ({date} = due date)")}</Grid2>
          <Grid2 size={{ xs: 6, sm: 2 }}>{numTf("taxRate", "Tax %")}</Grid2>
          <Grid2 size={{ xs: 6, sm: 3 }}>{numTf("fxRate", "FX JPY / USD", { inputProps: { step: "0.01" } })}</Grid2>
          <Grid2 size={{ xs: 12, sm: 7 }}>{tf("fxNote", "FX source note")}</Grid2>
          <Grid2 size={{ xs: 12, sm: 4 }}>{tf("lmeMonth", "LME average month (remarks)", { type: "month", InputLabelProps: { shrink: true } })}</Grid2>
          <Grid2 size={12}>{tf("conditions", "Conditions / 条件", { multiline: true, minRows: 2 })}</Grid2>
          <Grid2 size={12}>{tf("paymentTerms", "Payment terms / 支払い条件", { multiline: true, minRows: 1 })}</Grid2>
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
                helperText={h.bankId && !banks.some((b) => b.id === h.bankId) ? "This account is no longer in the settings — the text below is kept" : undefined}
              >
                {banks.map((b) => (
                  <MenuItem key={b.id} value={b.id}>
                    {b.label}
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
          {isFinal2 && (
            <>
              <Grid2 size={{ xs: 12, sm: 6 }}>{tf("invoice1No", "Invoice #1 no. (１回目)")}</Grid2>
              <Grid2 size={{ xs: 12, sm: 6 }}>{numTf("invoice1Amount", "１回目の金額 (tax incl., US$)", {
                  inputProps: { step: "0.01" },
                  FormHelperTextProps: h.invoice1Amount == null ? { sx: { color: "warning.main" } } : undefined,
                  helperText:
                    h.invoice1Amount == null
                      ? "No matching Invoice #1 line was found — enter what Invoice #1 billed for this product (tax incl.)"
                      : "From Invoice #1's line for this product (tax incl.); ２回目 = 合計 − this",
                })}</Grid2>
            </>
          )}
        </Grid2>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
          <Typography variant="subtitle2">Lines</Typography>
          <Box sx={{ flex: 1 }} />
          {!disabled && doc.docType === "INVOICE_1" && (
            <Button size="small" startIcon={<PlaylistAddIcon />} onClick={() => setPick(true)} disabled={!customerId}>
              Add lines from another contract
            </Button>
          )}
          {!disabled && (
            <Button size="small" startIcon={<AddIcon />} onClick={() => setRows((rs) => [...rs, blankLine(h.dueDate, unit)])}>
              Add line
            </Button>
          )}
        </Stack>
        <Stack spacing={1.5}>
          {rows.map((l, i) => {
            const helper = helperUsed(l);
            const price = unitPriceOf(l);
            return (
              <Box key={i} sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1.5 }}>
                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                  <Typography variant="caption" color="text.secondary">
                    Line {i + 1}
                  </Typography>
                  {l.contractNo && <Chip size="small" variant="outlined" label={`Contract ${l.contractNo}`} />}
                  {l.grade && <Chip size="small" variant="outlined" label={l.grade} />}
                  <Box sx={{ flex: 1 }} />
                  <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>
                    US$ {usd(amountOf(l))}
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
                  <Grid2 size={{ xs: 12, md: 7 }}>
                    <TextField size="small" fullWidth multiline minRows={2} label="摘要 / Description" value={l.description} disabled={disabled} onChange={(e) => setLine(i, { description: e.target.value })} />
                  </Grid2>
                  <Grid2 size={{ xs: 12, md: 5 }}>
                    <TextField
                      size="small"
                      fullWidth
                      multiline
                      minRows={2}
                      label="備考 / Remarks"
                      value={l.remarks}
                      disabled={disabled}
                      onChange={(e) => setLine(i, { remarks: e.target.value })}
                    />
                  </Grid2>
                  <Grid2 size={{ xs: 6, sm: 2 }}>{cell(i, "quantity", "Qty")}</Grid2>
                  <Grid2 size={{ xs: 6, sm: 2 }}>
                    <TextField size="small" fullWidth label="Unit" value={l.unit} disabled={disabled} onChange={(e) => setLine(i, { unit: e.target.value })} />
                  </Grid2>
                  <Grid2 size={{ xs: 6, sm: 3 }}>
                    {helper ? (
                      <TextField
                        size="small"
                        fullWidth
                        label="Unit price US$/MT"
                        // Blank until the LME is typed — QMJP + premium alone is not a price.
                        value={awaitingLme(l) ? "" : usd(price)}
                        placeholder="enter LME"
                        helperText={awaitingLme(l) ? "enter LME" : undefined}
                        InputLabelProps={{ shrink: true }}
                        disabled
                        inputProps={{ style: { textAlign: "right" } }}
                      />
                    ) : (
                      cell(i, "unitPrice", "Unit price US$/MT")
                    )}
                  </Grid2>
                  <Grid2 size={{ xs: 6, sm: 3 }}>{cell(i, "amountOverride", "Amount override", { placeholder: usd(price !== null && l.quantity !== null ? Number(l.quantity) * price : 0), InputLabelProps: { shrink: true }, helperText: "Blank = qty × price" })}</Grid2>
                  <Grid2 size={{ xs: 12, sm: 2 }}>
                    <TextField
                      size="small"
                      fullWidth
                      label="取引年月日"
                      InputLabelProps={{ shrink: true }}
                      value={l.dueDate ?? ""}
                      disabled={disabled}
                      onChange={(e) => setLine(i, { dueDate: e.target.value || null, dueDateManual: true })}
                      // The narrow line field shows its auto / manual marker underneath.
                      {...guardDate({ type: "date", FormHelperTextProps: { component: "div" }, helperText: autoChip(l.dueDateManual, () => setLine(i, { dueDate: h.dueDate || null, dueDateManual: false })) }, l.dueDate)}
                    />
                  </Grid2>
                  <Grid2 size={12}>
                    <FormControlLabel
                      control={<Checkbox size="small" checked={l.taxable !== false} disabled={disabled} onChange={(e) => setLine(i, { taxable: e.target.checked })} />}
                      label={<Typography variant="body2">課税対象 (consumption tax {h.taxRate ?? 0}%)</Typography>}
                    />
                  </Grid2>
                  <Grid2 size={12}>
                    <Typography variant="caption" color="text.secondary">
                      Pricing helper (US$/MT, optional)
                    </Typography>
                  </Grid2>
                  <Grid2 size={{ xs: 6, sm: 3 }}>{cell(i, "lme", "LME")}</Grid2>
                  <Grid2 size={{ xs: 6, sm: 3 }}>{cell(i, "qmjp", "QMJP")}</Grid2>
                  <Grid2 size={{ xs: 6, sm: 3 }}>{cell(i, "premium", "Billet premium")}</Grid2>
                  <Grid2 size={{ xs: 6, sm: 3 }}>{cell(i, "upcharge", "Upcharge")}</Grid2>
                </Grid2>
              </Box>
            );
          })}
          {!rows.length && <Alert severity="info">No lines yet</Alert>}
        </Stack>

        <Table size="small" sx={{ mt: 2, maxWidth: 520, ml: "auto", "& td": { fontVariantNumeric: "tabular-nums" } }}>
          {isFinal2 ? (
            <TableBody>
              {(
                [
                  ["課税対象金額 Taxable", totals.taxable],
                  [`消費税 (${h.taxRate ?? 0}%)`, totals.tax],
                  ["課税以外金額 Not taxable", totals.nonTaxable],
                  ["合計 Total", totals.total],
                  ["１回目の金額 Invoice #1", h.invoice1Amount ?? null],
                  ["２回目の金額(差額) Balance", roundTo(totals.total - (Number(h.invoice1Amount) || 0), 2)],
                ] as Array<[string, number | null]>
              ).map(([k, v], j) => (
                <TableRow key={k} sx={j === 3 || j === 5 ? { "& td": { fontWeight: 700 } } : undefined}>
                  <TableCell>{k}</TableCell>
                  <TableCell align="right">US$ {usd(v)}</TableCell>
                  <TableCell align="right">{j === 0 && totals.jpy ? `¥${usd(totals.jpy.subtotal, 0)}` : j === 1 && totals.jpy ? `¥${usd(totals.jpy.tax, 0)}` : ""}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          ) : (
          <TableBody>
            <TableRow>
              <TableCell>小計 Subtotal</TableCell>
              <TableCell align="right">US$ {usd(totals.subtotal)}</TableCell>
              <TableCell align="right">{totals.jpy ? `¥${usd(totals.jpy.subtotal, 0)}` : ""}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>消費税 ({h.taxRate ?? 0}%)</TableCell>
              <TableCell align="right">US$ {usd(totals.tax)}</TableCell>
              <TableCell align="right">{totals.jpy ? `¥${usd(totals.jpy.tax, 0)}` : ""}</TableCell>
            </TableRow>
            <TableRow sx={{ "& td": { fontWeight: 700 } }}>
              <TableCell>合計 Total</TableCell>
              <TableCell align="right">US$ {usd(totals.total)}</TableCell>
              <TableCell align="right">{totals.jpy ? `¥${usd(totals.jpy.total, 0)}` : "Set an FX rate for JPY"}</TableCell>
            </TableRow>
          </TableBody>
          )}
        </Table>
      </Paper>

      <Dialog open={pick} onClose={() => setPick(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add lines from another contract</DialogTitle>
        <DialogContent dividers>
          <List dense disablePadding>
            {(others.data?.items ?? [])
              .filter((c) => c.id !== doc.contractId)
              .map((c) => (
                <ListItemButton
                  key={c.id}
                  onClick={() => {
                    const added = c.lines.map((l) => lineFromContractLine({ id: c.id, contractNo: c.contractNo }, l, { template: dd.invoiceLineTemplate, unit, dueDate: h.dueDate, sizeInch: dd.sizeInch }));
                    // The subject follows the billed grades unless the user has typed their own.
                    if (h.subject === autoSubject(rows)) setH({ subject: autoSubject([...rows, ...added]) });
                    setRows((rs) => [...rs, ...added]);
                    setPick(false);
                  }}
                >
                  <ListItemText primary={c.contractNo} secondary={c.lines.map((l) => lineLabel(l)).join(", ") || "No product lines"} />
                </ListItemButton>
              ))}
            {others.data && !others.data.items.filter((c) => c.id !== doc.contractId).length && (
              <Typography variant="body2" color="text.secondary">
                No other open contracts for this customer.
              </Typography>
            )}
          </List>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPick(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
