"use client";

// Commission Report (guru 2026-11-28, flag enableCommissionReport; WCT group).
// What the office did in Excel each month: every customer payment received in the period, before
// GST, split by job type, under the salesperson, times a rate. Here the rates sit in a Rates
// dialog (standard per type, each person's own, who earns on every job, the minimum margin),
// Generate builds the report, and any row can be given its own rate, a job type, or left out.
// Those choices are saved, so the report reads the same when it is opened again.

import React, { useCallback, useMemo, useState } from "react";
import {
  Autocomplete, Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, MenuItem, Stack,
  Table, TableBody, TableCell, TableHead, TableRow, TextField, Tooltip, Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import PercentIcon from "@mui/icons-material/Percent";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import { toast } from "react-toastify";
import { useAccountingApi } from "@/app/portal/accounting/_lib/api";
import ReportShell from "@/app/portal/accounting/_lib/report-shell/ReportShell";
import { fmtDate } from "@/app/portal/accounting/_lib/report-shell/ReportTable";
import { onReportDate } from "@/app/portal/accounting/_lib/report-shell/reportDate";
import type { ReportExportModel } from "@/app/portal/accounting/_lib/report-export";
import DateInput from "@/components/DateInput";

const TYPES = ["CD", "AA", "MV", "VO", "TS"] as const;
const UNTYPED = "UNTYPED";
const money = (n: number) => (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const unwrap = (r: any) => { let o = r; while (o && typeof o === "object" && o.success !== undefined && o.data !== undefined) o = o.data; return o; };
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
// The office runs last month's commission this month.
const lastMonth = () => { const n = new Date(); return { from: iso(new Date(n.getFullYear(), n.getMonth() - 1, 1)), to: iso(new Date(n.getFullYear(), n.getMonth(), 0)) }; };

type Person = { name: string; userId?: string | null; aliases?: string[]; rates?: Record<string, number | string>; allJobs?: boolean };
type Settings = { rates: Record<string, number | string>; minMarginPct: number | string; people: Person[] };
type Row = {
  key: string; person: string; date: string; receipt: string; chequeNo: string; customer: string; quotation: string; invoice: string; invoiceId: string; company: string;
  type: string; typeGuessed: boolean; amount: number; rate: number; commission: number; excluded: boolean; note: string;
  override: { rate: number | null; exclude: boolean; type: string | null };
};
type Report = { from: string; to: string; settings: Settings; group?: boolean; companies?: string[]; people: Array<{ name: string; totalSales: number; totalCommission: number; byCompany?: Record<string, number>; rows: Row[] }>; totals: { payments: number; commission: number }; unknownNames: string[] };

const numBox = { width: 68, "& input": { textAlign: "right" as const, py: 0.5, px: 0.75, fontSize: "0.82rem" } };
const head = { fontWeight: 700, fontSize: "0.72rem", color: "text.secondary", whiteSpace: "nowrap" as const, py: 0.75 };
const cell = { fontSize: "0.82rem", py: 0.5 };

export default function CommissionReport() {
  const { request } = useAccountingApi();
  const [from, setFrom] = useState(lastMonth().from);
  const [to, setTo] = useState(lastMonth().to);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<Report | null>(null);
  const [ratesOpen, setRatesOpen] = useState(false);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  // The organization's user accounts: a salesperson row is tied to one of them.
  const [accounts, setAccounts] = useState<Array<{ userId: string; name: string; aliases: string[] }>>([]);

  const generate = useCallback(async () => {
    setLoading(true);
    try {
      setData(unwrap(await request(`/sales-reports/commission?from=${from}&to=${to}`)));
    } catch (e: any) {
      toast.error(e?.message || "Could not build the commission report");
    } finally {
      setLoading(false);
    }
  }, [request, from, to]);
  // The report is built on Generate, not on every date keystroke: ReportShell re-runs `onUpdate`
  // whenever its identity changes, so it is handed a callback that never does.
  const noAuto = useCallback(() => undefined, []);

  const openRates = async () => {
    try {
      setDraft(unwrap(await request("/sales-reports/commission/settings")));
      setRatesOpen(true);
      // The list of accounts is a convenience: the dialog works without it (names can be typed).
      void request("/sales-reports/commission/people").then((r: any) => setAccounts(unwrap(r)?.people || [])).catch(() => setAccounts([]));
    } catch (e: any) {
      toast.error(e?.message || "Could not load the rates");
    }
  };
  const saveRates = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const people = draft.people.map((p) => ({ ...p, aliases: Array.isArray(p.aliases) ? p.aliases : String(p.aliases || "").split(",").map((a) => a.trim()).filter(Boolean) }));
      await request("/sales-reports/commission/settings", { method: "PUT", body: JSON.stringify({ ...draft, people }) });
      setRatesOpen(false);
      toast.success("Rates saved");
      if (data) void generate();
    } catch (e: any) {
      toast.error(e?.message || "Could not save the rates");
    } finally {
      setSaving(false);
    }
  };
  const patchPerson = (i: number, patch: Partial<Person>) => setDraft((d) => (d ? { ...d, people: d.people.map((p, k) => (k === i ? { ...p, ...patch } : p)) } : d));

  // One row's own rate / job type / leave-out, saved at once and the report rebuilt from the server.
  const saveRow = async (row: Row, patch: { rate?: number | null; exclude?: boolean }, was: { rate: number | null; exclude: boolean; type: string | null }) => {
    try {
      await request("/sales-reports/commission/rows", { method: "PUT", body: JSON.stringify({ rows: [{ key: row.key, date: row.date, rate: was.rate, exclude: was.exclude, ...patch }] }) });
      await generate();
    } catch (e: any) {
      toast.error(e?.message || "Could not save that row");
    }
  };

  // The job type of a payment's share: one choice for everyone who earns on it (key ends in "*").
  const saveType = async (row: Row, type: string | null) => {
    try {
      await request("/sales-reports/commission/rows", { method: "PUT", body: JSON.stringify({ rows: [{ key: row.key.replace(/\|[^|]*$/, "|*"), date: row.date, type }] }) });
      await generate();
    } catch (e: any) {
      toast.error(e?.message || "Could not save the job type");
    }
  };

  // A job AIMS has no salesperson for: the office names one, and it is remembered for the job.
  const assign = async (row: Row, person: string) => {
    try {
      await request("/sales-reports/commission/assign", { method: "PUT", body: JSON.stringify({ invoiceId: row.invoiceId, quotation: row.quotation, person }) });
      await generate();
    } catch (e: any) {
      toast.error(e?.message || "Could not set the salesperson");
    }
  };
  const NOBODY = "(No salesperson)";
  // A group report (a parent company with its child companies) names the company on every row.
  const companies = data?.group ? data.companies || [] : [];
  const names = (data?.settings?.people || []).map((p) => p.name).filter(Boolean);

  const exportModel = (): ReportExportModel | null => {
    if (!data) return null;
    const cos = data.group ? data.companies || [] : [];
    const summary = data.people.map((p) => [p.name, money(p.totalSales), ...cos.map((c) => money(p.byCompany?.[c] || 0)), money(p.totalCommission)]);
    summary.push(["TOTAL", money(data.people.reduce((s, p) => s + p.totalSales, 0)), ...cos.map((c) => money(data.people.reduce((s, p) => s + (p.byCompany?.[c] || 0), 0))), money(data.totals.commission)]);
    return {
      title: "Commission Report",
      orgName: "",
      metaLines: [`From Date : ${fmtDate(data.from)}      To Date : ${fmtDate(data.to)}`],
      landscape: true,
      tables: [
        { heading: "Summary", headers: ["Sales Person", "Total Sales Amount", ...cos, "Total Commission"], rows: summary, boldRows: [summary.length - 1] },
        ...data.people.map((p) => {
          const live = p.rows.filter((r) => !r.excluded);
          const co = (r: Row) => (cos.length ? [r.company] : []);
          const rows = live.map((r) => [...co(r), money(r.amount), r.chequeNo || r.receipt, r.customer, r.quotation, r.invoice, r.type === UNTYPED ? "" : r.type, String(r.rate), money(r.commission)]);
          rows.push([...(cos.length ? [""] : []), money(p.totalSales), "", "", "", "", "", "Total Commission ($)", money(p.totalCommission)]);
          return { heading: p.name, headers: [...(cos.length ? ["Company"] : []), "Payment Amount", "Cheque Nos", "Customer Name", "Quotation No", "Invoices Paid", "Type", "Commission Rate (%)", "Commission Payable"], rows, boldRows: [rows.length - 1] };
        }),
      ],
      note: "Payment amounts are before GST.",
    };
  };

  return (
    <>
      <ReportShell
        title="Commission Report"
        loading={loading}
        onUpdate={noAuto}
        filters={
          <>
            <Box><Typography variant="caption" sx={{ fontWeight: 700 }}>From (payment date)</Typography><DateInput size="small" value={from} onChange={onReportDate(setFrom)} sx={{ width: 160, mt: 0.25, display: "block" }} /></Box>
            <Box><Typography variant="caption" sx={{ fontWeight: 700 }}>To</Typography><DateInput size="small" value={to} onChange={onReportDate(setTo)} sx={{ width: 160, mt: 0.25, display: "block" }} /></Box>
            <Button variant="outlined" startIcon={<PercentIcon />} onClick={openRates} data-tour="commission-rates" sx={{ alignSelf: "flex-end" }}>Rates</Button>
            <Button variant="contained" startIcon={<PlayArrowIcon />} onClick={generate} disabled={loading} data-tour="commission-generate" sx={{ alignSelf: "flex-end" }}>Generate</Button>
          </>
        }
        headerLines={data ? [`From Date : ${fmtDate(data.from)}      To Date : ${fmtDate(data.to)}`] : []}
        footerInfo={data ? `${data.totals.payments} ${data.totals.payments === 1 ? "payment" : "payments"}` : ""}
        getExportModel={exportModel}
      >
        {!data ? null : data.people.length === 0 ? (
          <Typography color="text.secondary" sx={{ py: 4, textAlign: "center" }}>No customer payments were received in this period.</Typography>
        ) : (
          <Stack spacing={3}>
            {data.unknownNames.length > 0 && (
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                <Typography variant="body2" color="warning.main">Not in the rates table:</Typography>
                {data.unknownNames.map((n) => <Chip key={n} size="small" label={n} variant="outlined" color="warning" />)}
              </Stack>
            )}
            <Table size="small" sx={{ maxWidth: companies.length ? 560 + companies.length * 170 : 560 }}>
              <TableHead>
                <TableRow>
                  <TableCell sx={head}>Sales Person</TableCell>
                  <TableCell sx={head} align="right">Total Sales Amount</TableCell>
                  {companies.map((c) => <TableCell key={c} sx={head} align="right">{c}</TableCell>)}
                  <TableCell sx={head} align="right">Total Commission</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.people.map((p) => (
                  <TableRow key={p.name}>
                    <TableCell sx={cell}>{p.name}</TableCell>
                    <TableCell sx={cell} align="right">{money(p.totalSales)}</TableCell>
                    {companies.map((c) => <TableCell key={c} sx={cell} align="right">{money(p.byCompany?.[c] || 0)}</TableCell>)}
                    <TableCell sx={cell} align="right">{money(p.totalCommission)}</TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell sx={{ ...cell, fontWeight: 700 }}>Total</TableCell>
                  <TableCell sx={{ ...cell, fontWeight: 700 }} align="right">{money(data.people.reduce((s, p) => s + p.totalSales, 0))}</TableCell>
                  {companies.map((c) => <TableCell key={c} sx={{ ...cell, fontWeight: 700 }} align="right">{money(data.people.reduce((s, p) => s + (p.byCompany?.[c] || 0), 0))}</TableCell>)}
                  <TableCell sx={{ ...cell, fontWeight: 700 }} align="right">{money(data.totals.commission)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>

            {data.people.map((p) => (
              <Box key={p.name}>
                <Typography sx={{ fontWeight: 700, mb: 0.5 }}>{p.name}</Typography>
                <Box sx={{ overflowX: "auto" }}>
                  <Table size="small" sx={{ minWidth: 1080 }}>
                    <TableHead>
                      <TableRow>
                        <TableCell sx={head} padding="checkbox" />
                        <TableCell sx={head}>Date</TableCell>
                        {companies.length > 0 && <TableCell sx={head}>Company</TableCell>}
                        <TableCell sx={head} align="right">Payment Amount</TableCell>
                        <TableCell sx={head}>Receipt</TableCell>
                        <TableCell sx={head}>Customer Name</TableCell>
                        <TableCell sx={head}>Quotation No</TableCell>
                        <TableCell sx={head}>Invoice</TableCell>
                        <TableCell sx={head}>Type</TableCell>
                        <TableCell sx={head} align="right">Rate %</TableCell>
                        <TableCell sx={head} align="right">Commission</TableCell>
                        <TableCell sx={head}>{p.name === NOBODY ? "Sales Person" : "Remarks"}</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {p.rows.map((r) => {
                        const was = r.override;
                        return (
                          <TableRow key={r.key} sx={{ opacity: r.excluded ? 0.45 : 1 }}>
                            <TableCell padding="checkbox">
                              <Tooltip title={r.excluded ? "Left out. Tick to pay commission on it." : "Untick to leave this payment out"}>
                                <Checkbox size="small" checked={!r.excluded} onChange={(e) => void saveRow(r, { exclude: !e.target.checked }, was)} />
                              </Tooltip>
                            </TableCell>
                            <TableCell sx={cell}>{fmtDate(r.date)}</TableCell>
                            {companies.length > 0 && <TableCell sx={cell}>{r.company}</TableCell>}
                            <TableCell sx={cell} align="right">{money(r.amount)}</TableCell>
                            <TableCell sx={cell}>{r.chequeNo ? `${r.receipt} · ${r.chequeNo}` : r.receipt}</TableCell>
                            <TableCell sx={cell}>{r.customer}</TableCell>
                            <TableCell sx={cell}>{r.quotation || "—"}</TableCell>
                            <TableCell sx={cell}>{r.invoice}</TableCell>
                            <TableCell sx={cell}>
                              <TextField
                                select size="small" variant="standard" value={r.type === UNTYPED ? "" : r.type}
                                onChange={(e) => void saveType(r, e.target.value || null)}
                                SelectProps={{ displayEmpty: true }}
                                sx={{ minWidth: 64, "& .MuiSelect-select": { fontSize: "0.82rem", py: 0.25, color: r.typeGuessed ? "warning.main" : undefined } }}
                              >
                                <MenuItem value=""><em>Pick</em></MenuItem>
                                {TYPES.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
                              </TextField>
                            </TableCell>
                            <TableCell sx={cell} align="right">
                              <TextField
                                key={`${r.key}:${r.rate}`} size="small" defaultValue={r.rate} sx={numBox} inputProps={{ inputMode: "decimal", "aria-label": "Commission rate" }}
                                onBlur={(e) => {
                                  const v = e.target.value.trim();
                                  const n = v === "" ? null : Number(v);
                                  if (n !== null && !Number.isFinite(n)) { e.target.value = String(r.rate); return; }
                                  // Empty = back to the person's standard rate.
                                  if (n === null ? was.rate !== null : n !== r.rate) void saveRow(r, { rate: n }, was);
                                }}
                                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                              />
                            </TableCell>
                            <TableCell sx={{ ...cell, fontWeight: 600 }} align="right">{money(r.commission)}</TableCell>
                            <TableCell sx={{ ...cell, color: "text.secondary" }}>
                              {p.name === NOBODY ? (
                                <TextField
                                  select size="small" variant="standard" value="" onChange={(e) => void assign(r, e.target.value)}
                                  SelectProps={{ displayEmpty: true }} inputProps={{ "aria-label": "Sales person" }}
                                  sx={{ minWidth: 130, "& .MuiSelect-select": { fontSize: "0.82rem", py: 0.25 } }}
                                >
                                  <MenuItem value=""><em>{names.length ? "Choose" : "Add people in Rates"}</em></MenuItem>
                                  {names.map((n) => <MenuItem key={n} value={n}>{n}</MenuItem>)}
                                </TextField>
                              ) : r.note}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      <TableRow>
                        <TableCell />
                        <TableCell sx={{ ...cell, fontWeight: 700 }}>Total</TableCell>
                        {companies.length > 0 && <TableCell />}
                        <TableCell sx={{ ...cell, fontWeight: 700 }} align="right">{money(p.totalSales)}</TableCell>
                        <TableCell colSpan={6} />
                        <TableCell sx={{ ...cell, fontWeight: 700 }} align="right">{money(p.totalCommission)}</TableCell>
                        <TableCell />
                      </TableRow>
                    </TableBody>
                  </Table>
                </Box>
              </Box>
            ))}
          </Stack>
        )}
      </ReportShell>

      <Dialog open={ratesOpen} onClose={() => setRatesOpen(false)} maxWidth="lg" fullWidth>
        <DialogTitle>Commission rates</DialogTitle>
        <DialogContent>
          {draft && (
            <Stack spacing={2.5} sx={{ pt: 1.5 }}>
              <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
                <Typography sx={{ fontWeight: 600, minWidth: 150 }}>Standard rate %</Typography>
                {TYPES.map((t) => (
                  <TextField key={t} size="small" label={t} value={draft.rates[t] ?? ""} sx={{ width: 84 }} inputProps={{ inputMode: "decimal" }}
                    onChange={(e) => setDraft({ ...draft, rates: { ...draft.rates, [t]: e.target.value } })} />
                ))}
                <TextField size="small" label="Minimum margin %" value={draft.minMarginPct} sx={{ width: 150 }} inputProps={{ inputMode: "decimal" }}
                  onChange={(e) => setDraft({ ...draft, minMarginPct: e.target.value })} />
              </Stack>
              <Box sx={{ overflowX: "auto" }}>
                <Table size="small" sx={{ minWidth: 820 }}>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={head}>Sales Person</TableCell>
                      <TableCell sx={head}>Also written as</TableCell>
                      {TYPES.map((t) => <TableCell key={t} sx={head} align="right">{t} %</TableCell>)}
                      <TableCell sx={head} align="center">Every job</TableCell>
                      <TableCell sx={head} />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {draft.people.map((p, i) => (
                      <TableRow key={i}>
                        <TableCell sx={cell}>
                          <Autocomplete
                            freeSolo size="small" autoHighlight
                            options={accounts.filter((a) => !draft.people.some((x, k) => k !== i && x.userId === a.userId))}
                            getOptionLabel={(o) => (typeof o === "string" ? o : o.name)}
                            inputValue={p.name}
                            // Typing a name unties the row from any account; picking one ties it and brings that person's known spellings.
                            onInputChange={(_, v, reason) => { if (reason === "input" || reason === "clear") patchPerson(i, { name: v, userId: null }); }}
                            onChange={(_, o) => {
                              if (o && typeof o !== "string") {
                                const have = (Array.isArray(p.aliases) ? p.aliases : String(p.aliases || "").split(",")).map((a) => a.trim()).filter(Boolean);
                                patchPerson(i, { name: o.name, userId: o.userId, aliases: [...have, ...o.aliases.filter((a) => !have.some((h) => h.toLowerCase() === a.toLowerCase()))] });
                              }
                            }}
                            sx={{ minWidth: 190 }}
                            renderInput={(params) => <TextField {...params} variant="standard" placeholder="Pick a user" inputProps={{ ...params.inputProps, "aria-label": "Sales person name" }} />}
                          />
                        </TableCell>
                        <TableCell sx={cell}>
                          <TextField size="small" variant="standard" placeholder="henry hoo, S003" sx={{ minWidth: 170 }}
                            value={Array.isArray(p.aliases) ? p.aliases.join(", ") : (p.aliases as any) || ""}
                            onChange={(e) => patchPerson(i, { aliases: e.target.value as any })} />
                        </TableCell>
                        {TYPES.map((t) => (
                          <TableCell key={t} sx={cell} align="right">
                            <TextField size="small" sx={numBox} placeholder={String(draft.rates[t] ?? "")} value={p.rates?.[t] ?? ""} inputProps={{ inputMode: "decimal", "aria-label": `${p.name} ${t} rate` }}
                              onChange={(e) => { const rates = { ...(p.rates || {}) }; if (e.target.value === "") delete rates[t]; else rates[t] = e.target.value; patchPerson(i, { rates }); }} />
                          </TableCell>
                        ))}
                        <TableCell align="center"><Checkbox size="small" checked={!!p.allJobs} onChange={(e) => patchPerson(i, { allJobs: e.target.checked })} /></TableCell>
                        <TableCell align="right"><IconButton size="small" aria-label="Remove" onClick={() => setDraft({ ...draft, people: draft.people.filter((_, k) => k !== i) })}><DeleteOutlineIcon fontSize="small" /></IconButton></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                <Button size="small" startIcon={<AddIcon />} onClick={() => setDraft({ ...draft, people: [...draft.people, { name: "", rates: {}, aliases: [] }] })}>Add person</Button>
                {(data?.unknownNames || []).filter((n) => !draft.people.some((p) => p.name.toLowerCase() === n.toLowerCase())).map((n) => (
                  <Chip key={n} size="small" icon={<AddIcon />} label={n} variant="outlined" onClick={() => setDraft({ ...draft, people: [...draft.people, { name: n, rates: {}, aliases: [] }] })} />
                ))}
              </Stack>
            </Stack>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setRatesOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={saveRates} disabled={saving}>Save rates</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
