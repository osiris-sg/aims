"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Autocomplete, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, MenuItem, Paper, Stack, Switch, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, TextField, Tooltip, Typography, alpha,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import LinkIcon from "@mui/icons-material/Link";
import { useSearchParams } from "next/navigation";
import { toast } from "react-toastify";
import { useAccountingApi } from "../_lib/api";
import { useGetCustomers } from "@/app/portal/hooks/api";

const FREQS = ["DAILY", "WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"] as const;
const TOKENS = ["{MONTH}", "{MONTH YEAR}", "{PERIOD}", "{YEAR}", "{DATE}", "{NEXT MONTH}", "{PREV MONTH}"];

// Client mirror of the backend token resolver — for the live preview.
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const p2 = (n: number) => String(n).padStart(2, "0");
function resolveText(str: string, d: Date): string {
  const y = d.getFullYear(), m = d.getMonth();
  const nM = (m + 1) % 12, nY = m === 11 ? y + 1 : y, pM = (m + 11) % 12, pY = m === 0 ? y - 1 : y;
  const map: Record<string, string> = {
    MONTH: MONTHS[m], "MONTH SHORT": MONTHS[m].slice(0, 3), "MONTH YEAR": `${MONTHS[m]} ${y}`,
    PERIOD: `${MONTHS[m].slice(0, 3)} ${y}`, YEAR: String(y), DAY: p2(d.getDate()),
    DATE: `${p2(d.getDate())}/${p2(m + 1)}/${y}`, "NEXT MONTH": MONTHS[nM], "NEXT MONTH YEAR": `${MONTHS[nM]} ${nY}`,
    "PREV MONTH": MONTHS[pM], "PREV MONTH YEAR": `${MONTHS[pM]} ${pY}`,
  };
  return (str || "").replace(/\{([A-Z ]+)\}/g, (w, t) => (t in map ? map[t] : w));
}

// Best-effort tokenizer for the "make recurring from invoice" prefill: swap the
// seed invoice's period wording for tokens so the next run re-dates itself.
// e.g. seed dated July 2026 → "July 2026"→{MONTH YEAR}, "Jul 2026"→{PERIOD},
// "July"→{MONTH}, "08/07/2026"→{DATE}. Anything missed is user-editable.
function tokenizeText(str: string, d: Date): string {
  if (!str) return str;
  const month = MONTHS[d.getMonth()], mon = month.slice(0, 3), y = String(d.getFullYear());
  const date = `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${y}`;
  return str
    .replace(new RegExp(`${month}\\s+${y}`, "gi"), "{MONTH YEAR}")
    .replace(new RegExp(`${mon}\\s+${y}`, "gi"), "{PERIOD}")
    .replace(new RegExp(date.replace(/\//g, "\\/"), "g"), "{DATE}")
    .replace(new RegExp(`\\b${month}\\b`, "gi"), "{MONTH}");
}

function addMonths(d: Date, n: number): Date {
  const next = new Date(d);
  next.setMonth(next.getMonth() + n);
  return next;
}

type Row = { description: string; quantity: number; unitPrice: number; accountCode?: string };
type Template = {
  id: string; name: string; customerId: string; frequency: string; nextRunDate: string;
  endDate?: string | null; autoSend: boolean; isActive: boolean; lastRunAt?: string | null;
  documentTemplateId: string; numberFormatId?: string | null; config: any;
  projectId?: string | null; projectDeploymentId?: string | null; sourceDocumentId?: string | null;
};

// Draft-first by default: autoSend=false means each run creates a DRAFT invoice
// for review (fill meter readings etc.), not a confirmed+emailed one.
const blank = { name: "", customerId: "", documentTemplateId: "", numberFormatId: "", frequency: "MONTHLY", nextRunDate: "", endDate: "", autoSend: false, isActive: true, notes: "", items: [{ description: "", quantity: 1, unitPrice: 0, accountCode: "" }] as Row[], projectId: "", projectDeploymentId: "", sourceDocumentId: "", projectName: "" };

export default function RecurringInvoicesView() {
  const { request } = useAccountingApi();
  const { customers } = useGetCustomers();
  const searchParams = useSearchParams();
  const [items, setItems] = useState<Template[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [formats, setFormats] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Template | null>(null);
  const [form, setForm] = useState<any>(blank);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const prefilledFromRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      await request("/recurring-invoices/run-due", { method: "POST" }).catch(() => {}); // generate any due
      const [list, tpls, fmts] = await Promise.all([
        request<Template[]>("/recurring-invoices"),
        request<any>("/documentTemplates", { method: "POST", body: JSON.stringify({ page: 1, limit: 100, search: "", filters: { type: "INVOICE" } }) }).catch(() => null),
        request<any[]>("/document-numbering?documentType=INVOICE").catch(() => []),
      ]);
      setItems(list || []);
      const docs = (tpls?.docs ?? tpls ?? []).filter((t: any) => t.type === "INVOICE");
      setTemplates(docs);
      setFormats((fmts || []).filter((f: any) => f.isActive));
    } catch (e: any) {
      toast.error(e?.message || "Failed to load recurring invoices");
    } finally {
      setLoading(false);
    }
  }, [request]);
  useEffect(() => { load(); }, [load]);

  // "Confirm & make recurring" landing: ?fromInvoice=<docId> prefills a new
  // template from that invoice — customer, template, number format, lines
  // (period wording auto-tokenized), project + deployment linkage.
  const fromInvoiceId = searchParams?.get("fromInvoice") || null;
  useEffect(() => {
    if (!fromInvoiceId || prefilledFromRef.current === fromInvoiceId) return;
    prefilledFromRef.current = fromInvoiceId;
    (async () => {
      try {
        const res: any = await request<any>(`/documents/${fromInvoiceId}`);
        const doc = res?.data ?? res;
        if (!doc?.id) { toast.error("Could not load the source invoice"); return; }
        const cfg: any = doc.config || {};
        const seedDate = cfg.date ? new Date(cfg.date) : new Date(doc.createdAt || Date.now());
        const rows: Row[] = (Array.isArray(cfg.items) ? cfg.items : [])
          .filter((it: any) => (it?.description || "").trim())
          .map((it: any) => ({
            description: tokenizeText(String(it.description || ""), seedDate),
            quantity: Number(it.quantity) || 1,
            unitPrice: Number(it.unitPrice ?? it.price) || 0,
            accountCode: it.accountCode || "",
          }));
        setEditing(null);
        setForm({
          ...blank,
          name: `Recurring — ${doc.name || "invoice"}`,
          customerId: cfg.customerId || cfg.customer?.id || "",
          documentTemplateId: doc.documentTemplateId || "",
          numberFormatId: cfg.numberFormatId || "",
          frequency: "MONTHLY",
          nextRunDate: addMonths(seedDate, 1).toISOString().slice(0, 10),
          autoSend: false,
          notes: tokenizeText(String(cfg.notes || ""), seedDate),
          items: rows.length ? rows : blank.items,
          projectId: doc.projectId || "",
          projectDeploymentId: doc.projectDeploymentId || "",
          sourceDocumentId: doc.id,
          projectName: doc.project?.name || "",
        });
        setOpen(true);
        if (!doc.projectDeploymentId) {
          toast.info("This invoice isn't linked to a project deployment — the schedule will still run, but generated invoices won't appear on a deployment card.");
        }
      } catch (e: any) {
        toast.error(e?.message || "Failed to prefill from invoice");
      }
    })();
  }, [fromInvoiceId, request]);

  const custName = (id: string) => customers?.find((c: any) => c.id === id)?.name || "—";
  const previewDate = useMemo(() => (form.nextRunDate ? new Date(form.nextRunDate) : new Date()), [form.nextRunDate]);

  const openNew = () => { setEditing(null); setForm({ ...blank, nextRunDate: new Date().toISOString().slice(0, 10) }); setOpen(true); };
  const openEdit = (t: Template) => {
    setEditing(t);
    setForm({
      name: t.name, customerId: t.customerId, documentTemplateId: t.documentTemplateId, numberFormatId: t.numberFormatId || "",
      frequency: t.frequency, nextRunDate: t.nextRunDate?.slice(0, 10) || "", endDate: t.endDate?.slice(0, 10) || "",
      autoSend: t.autoSend, isActive: t.isActive, notes: t.config?.notes || "",
      items: Array.isArray(t.config?.items) && t.config.items.length ? t.config.items.map((i: any) => ({ description: i.description || "", quantity: i.quantity ?? 1, unitPrice: i.unitPrice ?? 0, accountCode: i.accountCode || "" })) : blank.items,
      projectId: t.projectId || "", projectDeploymentId: t.projectDeploymentId || "", sourceDocumentId: t.sourceDocumentId || "", projectName: "",
    });
    setOpen(true);
  };

  const setRow = (i: number, patch: Partial<Row>) => setForm((f: any) => ({ ...f, items: f.items.map((r: Row, x: number) => (x === i ? { ...r, ...patch } : r)) }));
  const addRow = () => setForm((f: any) => ({ ...f, items: [...f.items, { description: "", quantity: 1, unitPrice: 0, accountCode: "" }] }));
  const delRow = (i: number) => setForm((f: any) => ({ ...f, items: f.items.filter((_: Row, x: number) => x !== i) }));

  const save = async () => {
    if (!form.name.trim()) return toast.warn("Name is required");
    if (!form.customerId) return toast.warn("Pick a customer");
    if (!form.documentTemplateId) return toast.warn("Pick an invoice template");
    if (!form.nextRunDate) return toast.warn("Set the first run date");
    setSaving(true);
    try {
      const config = {
        notes: form.notes,
        items: form.items.filter((r: Row) => r.description.trim()).map((r: Row) => ({
          itemCode: "", description: r.description, quantity: Number(r.quantity) || 1, unitPrice: Number(r.unitPrice) || 0,
          amount: (Number(r.quantity) || 1) * (Number(r.unitPrice) || 0), ...(r.accountCode ? { accountCode: r.accountCode } : {}),
        })),
      };
      const payload = {
        name: form.name.trim(), customerId: form.customerId, documentTemplateId: form.documentTemplateId,
        numberFormatId: form.numberFormatId || null, frequency: form.frequency, nextRunDate: form.nextRunDate,
        endDate: form.endDate || null, autoSend: form.autoSend, isActive: form.isActive, config,
        projectId: form.projectId || null,
        projectDeploymentId: form.projectDeploymentId || null,
        sourceDocumentId: form.sourceDocumentId || null,
      };
      if (editing) await request(`/recurring-invoices/${editing.id}`, { method: "PATCH", body: JSON.stringify(payload) });
      else await request("/recurring-invoices", { method: "POST", body: JSON.stringify(payload) });
      toast.success(editing ? "Updated" : "Recurring invoice created");
      setOpen(false); load();
    } catch (e: any) { toast.error(e?.message || "Save failed"); } finally { setSaving(false); }
  };

  const remove = async (t: Template) => {
    if (!confirm(`Delete "${t.name}"?`)) return;
    try { await request(`/recurring-invoices/${t.id}`, { method: "DELETE" }); toast.success("Deleted"); load(); }
    catch (e: any) { toast.error(e?.message || "Delete failed"); }
  };
  const toggle = async (t: Template) => {
    try { await request(`/recurring-invoices/${t.id}`, { method: "PATCH", body: JSON.stringify({ isActive: !t.isActive }) }); load(); }
    catch (e: any) { toast.error(e?.message || "Failed"); }
  };
  const generateNow = async (t: Template) => {
    const what = t.autoSend ? "creates, posts to the GL and emails an invoice" : "creates a DRAFT invoice for review";
    if (!confirm(`Generate "${t.name}" now (${what})?`)) return;
    setBusyId(t.id);
    try { await request<any>(`/recurring-invoices/${t.id}/generate-now`, { method: "POST" }); toast.success(t.autoSend ? "Invoice generated and posted" : "Draft invoice generated — review it in the invoice list"); load(); }
    catch (e: any) { toast.error(e?.message || "Generate failed"); } finally { setBusyId(null); }
  };

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>Recurring Invoices</Typography>
          <Typography variant="body2" color="text.secondary">Generate an invoice on a schedule — as a draft for review (default) or fully automatic (confirm + email). Text tokens (e.g. <code>{"{MONTH YEAR}"}</code>) update each period. Create one from a confirmed invoice via its Confirm menu.</Typography>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openNew}>New recurring invoice</Button>
      </Stack>

      {loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", p: 6 }}><CircularProgress /></Box>
      ) : items.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 5, textAlign: "center", borderRadius: 2, color: "text.secondary" }}>
          <Typography variant="body2" sx={{ mb: 2 }}>No recurring invoices yet.</Typography>
          <Button variant="outlined" startIcon={<AddIcon />} onClick={openNew}>Create your first</Button>
        </Paper>
      ) : (
        <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2 }}>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: (t) => alpha(t.palette.text.primary, 0.03) }}>
                <TableCell sx={{ fontWeight: 700 }}>Name</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Customer</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Every</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Next run</TableCell>
                <TableCell sx={{ fontWeight: 700 }} align="center">Mode</TableCell>
                <TableCell sx={{ fontWeight: 700 }} align="center">Active</TableCell>
                <TableCell sx={{ fontWeight: 700 }} align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {items.map((t) => (
                <TableRow key={t.id}>
                  <TableCell>
                    <Stack direction="row" alignItems="center" gap={0.75}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>{t.name}</Typography>
                      {t.projectDeploymentId && (
                        <Tooltip title="Linked to a project deployment — generated invoices appear on its deployment card">
                          <Chip size="small" icon={<LinkIcon sx={{ fontSize: 14 }} />} label="Deployment" variant="outlined" />
                        </Tooltip>
                      )}
                    </Stack>
                  </TableCell>
                  <TableCell>{custName(t.customerId)}</TableCell>
                  <TableCell><Chip size="small" label={t.frequency.toLowerCase()} /></TableCell>
                  <TableCell>{t.nextRunDate?.slice(0, 10)}</TableCell>
                  <TableCell align="center">{t.autoSend ? <Chip size="small" color="info" label="Auto (email)" /> : <Chip size="small" label="Draft" />}</TableCell>
                  <TableCell align="center"><Switch size="small" checked={t.isActive} onChange={() => toggle(t)} /></TableCell>
                  <TableCell align="right">
                    <Tooltip title="Generate now"><span><IconButton size="small" disabled={busyId === t.id} onClick={() => generateNow(t)}>{busyId === t.id ? <CircularProgress size={16} /> : <PlayArrowIcon fontSize="small" />}</IconButton></span></Tooltip>
                    <Tooltip title="Edit"><IconButton size="small" onClick={() => openEdit(t)}><EditIcon fontSize="small" /></IconButton></Tooltip>
                    <Tooltip title="Delete"><IconButton size="small" onClick={() => remove(t)}><DeleteOutlineIcon fontSize="small" /></IconButton></Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Dialog open={open} onClose={() => !saving && setOpen(false)} fullWidth maxWidth="md">
        <DialogTitle>{editing ? "Edit recurring invoice" : "New recurring invoice"}</DialogTitle>
        <DialogContent dividers>
          <Stack gap={2} sx={{ mt: 0.5 }}>
            {form.projectDeploymentId && (
              <Box sx={{ p: 1.25, borderRadius: 1, bgcolor: (t) => alpha(t.palette.success.main, 0.08), display: "flex", alignItems: "center", gap: 1 }}>
                <LinkIcon fontSize="small" />
                <Typography variant="body2">
                  Linked to a project deployment{form.projectName ? <> under <b>{form.projectName}</b></> : ""}. Generated invoices appear on the deployment card and count toward the project's billed totals. Off-hiring the deployment pauses this schedule.
                </Typography>
              </Box>
            )}
            <Stack direction={{ xs: "column", sm: "row" }} gap={2}>
              <TextField label="Name" size="small" fullWidth value={form.name} onChange={(e) => setForm((f: any) => ({ ...f, name: e.target.value }))} placeholder="China Railway monthly retainer" />
              {/* Searchable — the full customer list is far too long for a plain select. */}
              <Autocomplete
                size="small"
                fullWidth
                options={(customers || []) as any[]}
                getOptionLabel={(c: any) => c?.name ?? ""}
                isOptionEqualToValue={(o: any, v: any) => o.id === v.id}
                value={((customers || []) as any[]).find((c: any) => c.id === form.customerId) ?? null}
                onChange={(_, c: any) => setForm((f: any) => ({ ...f, customerId: c ? c.id : "" }))}
                renderOption={(props, c: any) => (<li {...props} key={c.id}>{c.name}</li>)}
                ListboxProps={{ sx: { maxHeight: 320 } }}
                renderInput={(params) => <TextField {...params} label="Customer" placeholder="Search customer..." />}
                autoHighlight
              />
            </Stack>
            <Stack direction={{ xs: "column", sm: "row" }} gap={2}>
              <TextField select label="Invoice template" size="small" fullWidth value={form.documentTemplateId} onChange={(e) => setForm((f: any) => ({ ...f, documentTemplateId: e.target.value }))}>
                {templates.map((t: any) => (<MenuItem key={t.id} value={t.id}>{t.name || t.templateVariant || "Invoice"}</MenuItem>))}
              </TextField>
              <TextField select label="Number format (optional)" size="small" fullWidth value={form.numberFormatId} onChange={(e) => setForm((f: any) => ({ ...f, numberFormatId: e.target.value }))}>
                <MenuItem value=""><em>Default</em></MenuItem>
                {formats.map((f: any) => (<MenuItem key={f.id} value={f.id}>{f.label}</MenuItem>))}
              </TextField>
            </Stack>
            <Stack direction={{ xs: "column", sm: "row" }} gap={2} alignItems="center">
              <TextField select label="Every" size="small" sx={{ minWidth: 140 }} value={form.frequency} onChange={(e) => setForm((f: any) => ({ ...f, frequency: e.target.value }))}>
                {FREQS.map((fr) => (<MenuItem key={fr} value={fr}>{fr.toLowerCase()}</MenuItem>))}
              </TextField>
              <TextField label="First run" size="small" type="date" InputLabelProps={{ shrink: true }} value={form.nextRunDate} onChange={(e) => setForm((f: any) => ({ ...f, nextRunDate: e.target.value }))} />
              <TextField label="End date (optional)" size="small" type="date" InputLabelProps={{ shrink: true }} value={form.endDate} onChange={(e) => setForm((f: any) => ({ ...f, endDate: e.target.value }))} />
              <Tooltip title={form.autoSend ? "Each run confirms (posts to the GL) and emails the customer automatically" : "Each run creates a draft invoice for review — fill in meter readings etc., then confirm manually"}>
                <Stack direction="row" alignItems="center"><Switch checked={form.autoSend} onChange={(_, v) => setForm((f: any) => ({ ...f, autoSend: v }))} /><Typography variant="body2">{form.autoSend ? "Fully automatic (confirm + email)" : "Draft for review"}</Typography></Stack>
              </Tooltip>
            </Stack>

            {/* Line items */}
            <Box>
              <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>Line items</Typography>
              <Typography variant="caption" color="text.secondary">Use tokens in the description — they resolve to the run date: {TOKENS.join("  ")}</Typography>
              <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2, mt: 1 }}>
                <Table size="small">
                  <TableHead><TableRow>
                    <TableCell>Description</TableCell><TableCell align="right" sx={{ width: 80 }}>Qty</TableCell>
                    <TableCell align="right" sx={{ width: 110 }}>Unit price</TableCell><TableCell sx={{ width: 110 }}>Account</TableCell><TableCell />
                  </TableRow></TableHead>
                  <TableBody>
                    {form.items.map((r: Row, i: number) => (
                      <TableRow key={i}>
                        <TableCell><TextField fullWidth size="small" multiline maxRows={6} value={r.description} placeholder="Services for {MONTH YEAR}" onChange={(e) => setRow(i, { description: e.target.value })} /></TableCell>
                        <TableCell><TextField size="small" type="number" value={r.quantity} onChange={(e) => setRow(i, { quantity: Number(e.target.value) })} /></TableCell>
                        <TableCell><TextField size="small" type="number" value={r.unitPrice} onChange={(e) => setRow(i, { unitPrice: Number(e.target.value) })} /></TableCell>
                        <TableCell><TextField size="small" value={r.accountCode || ""} placeholder="e.g. 200" onChange={(e) => setRow(i, { accountCode: e.target.value })} /></TableCell>
                        <TableCell><IconButton size="small" onClick={() => delRow(i)}><DeleteOutlineIcon fontSize="small" /></IconButton></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
              <Button size="small" startIcon={<AddIcon />} onClick={addRow} sx={{ mt: 1 }}>Add line</Button>
            </Box>

            <TextField label="Notes (optional, tokens allowed)" size="small" fullWidth multiline minRows={2} value={form.notes} onChange={(e) => setForm((f: any) => ({ ...f, notes: e.target.value }))} />

            {/* Live preview */}
            <Box sx={{ p: 1.5, borderRadius: 1, bgcolor: (t) => alpha(t.palette.info.main, 0.06) }}>
              <Typography variant="caption" color="text.secondary">Preview for {previewDate.toLocaleDateString()}:</Typography>
              {form.items.filter((r: Row) => r.description.trim()).map((r: Row, i: number) => (
                <Typography key={i} variant="body2" sx={{ fontWeight: 600, whiteSpace: "pre-line" }}>• {resolveText(r.description, previewDate)}</Typography>
              ))}
              {form.notes && <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{resolveText(form.notes, previewDate)}</Typography>}
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
          <Button variant="contained" onClick={save} disabled={saving} startIcon={saving ? <CircularProgress size={14} color="inherit" /> : undefined}>{editing ? "Save" : "Create"}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
