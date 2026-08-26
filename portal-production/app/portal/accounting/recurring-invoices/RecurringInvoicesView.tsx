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
import CloudSyncIcon from "@mui/icons-material/CloudSync";
import LinkIcon from "@mui/icons-material/Link";
import VisibilityIcon from "@mui/icons-material/Visibility";
import CloseIcon from "@mui/icons-material/Close";
import CleanDocumentPreview from "@/containers/DocumentTemplates/components/CleanDocumentPreview";
import { useSearchParams } from "next/navigation";
import { toast } from "react-toastify";
import { useAccountingApi } from "../_lib/api";
import { useGetCustomers } from "@/app/portal/hooks/api";
import { useOrganization } from "@hooks/useOrganization";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";
import SendInvoiceEmailDialog from "@/app/portal/invoices/components/SendInvoiceEmailDialog";

const FREQS = ["DAILY", "WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"] as const;
const TOKENS = ["{MONTH}", "{MONTH YEAR}", "{PERIOD}", "{YEAR}", "{DATE}", "{NEXT MONTH}", "{PREV MONTH}"];
// Token-insert buttons (same interaction as the number-format block builder in
// Accounting Setup — tap to drop a block in, no typing).
const TOKEN_BUTTONS: { token: string; label: string }[] = [
  { token: "{MONTH}", label: "Month" },
  { token: "{MONTH YEAR}", label: "Month Year" },
  { token: "{PERIOD}", label: "Period" },
  { token: "{YEAR}", label: "Year" },
  { token: "{DATE}", label: "Date" },
  { token: "{NEXT MONTH}", label: "Next Month" },
  { token: "{PREV MONTH}", label: "Prev Month" },
  { token: "{MONTH START}", label: "Month Start" },
  { token: "{MONTH END}", label: "Month End" },
  { token: "{PREV MONTH START}", label: "Prev Mth Start" },
  { token: "{PREV MONTH END}", label: "Prev Mth End" },
  { token: "{NTH}", label: "Nth (17th)" },
];

// Client mirror of the backend token resolver — for the live preview.
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const p2 = (n: number) => String(n).padStart(2, "0");
const ordinal = (n: number) => {
  const v = n % 100;
  return `${n}${v >= 11 && v <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th"}`;
};
function resolveText(str: string, d: Date, runNo?: number): string {
  const y = d.getFullYear(), m = d.getMonth();
  const nM = (m + 1) % 12, nY = m === 11 ? y + 1 : y, pM = (m + 11) % 12, pY = m === 0 ? y - 1 : y;
  const map: Record<string, string> = {
    MONTH: MONTHS[m], "MONTH SHORT": MONTHS[m].slice(0, 3), "MONTH YEAR": `${MONTHS[m]} ${y}`,
    PERIOD: `${MONTHS[m].slice(0, 3)} ${y}`, YEAR: String(y), DAY: p2(d.getDate()),
    DATE: `${p2(d.getDate())}/${p2(m + 1)}/${y}`, "NEXT MONTH": MONTHS[nM], "NEXT MONTH YEAR": `${MONTHS[nM]} ${nY}`,
    "PREV MONTH": MONTHS[pM], "PREV MONTH YEAR": `${MONTHS[pM]} ${pY}`,
    "MONTH NO": p2(m + 1), "PREV MONTH NO": p2(pM + 1),
    "MONTH START": `01/${p2(m + 1)}/${y}`, "MONTH END": `${p2(new Date(y, m + 1, 0).getDate())}/${p2(m + 1)}/${y}`,
    "PREV MONTH START": `01/${p2(pM + 1)}/${pY}`, "PREV MONTH END": `${p2(new Date(pY, pM + 1, 0).getDate())}/${p2(pM + 1)}/${pY}`,
    ...(runNo != null ? { NTH: ordinal(runNo), "RUN NO": String(runNo) } : {}),
  };
  return (str || "").replace(/\{([A-Z ]+)\}/g, (w, t) => (t in map ? map[t] : w));
}

// Best-effort tokenizer for the "make recurring from invoice" prefill: swap the
// seed invoice's period wording for tokens so the next run re-dates itself.
// e.g. seed dated July 2026 → "July 2026"→{MONTH YEAR}, "Jul 2026"→{PERIOD},
// "July"→{MONTH}, "08/07/2026"→{DATE}. Anything missed is user-editable.
const unwrapAsset = (r: any) => (r && typeof r === "object" && r.data !== undefined ? r.data : r);

// datetime-local <input> value ⟷ ISO instant (guru 2026-08-06: runs carry a
// TIME, not just a date — "I want to test one now").
const toLocalInput = (iso?: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const nowLocalInput = () => toLocalInput(new Date().toISOString());

// Infer which numbering variant produced a document number: turn the format's
// pattern ("BI{YYYY}{MM}{####}") into an anchored regex and test. Longest
// pattern wins so specific variants beat generic ones.
function matchNumberFormat(docNumber: string, fmts: Array<{ id: string; pattern?: string }>): string {
  if (!docNumber) return "";
  const toRegex = (pattern: string) => {
    const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    let out = "^";
    const re = /\{(YYYY|YY|MM|DD|DOC|#+)\}/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(pattern))) {
      out += esc(pattern.slice(last, m.index));
      const tok = m[1];
      out += tok === "YYYY" ? "\\d{4}" : tok === "YY" || tok === "MM" || tok === "DD" ? "\\d{2}" : tok === "DOC" ? "[A-Za-z/]{1,6}" : `\\d{${tok.length}}`;
      last = m.index + m[0].length;
    }
    out += esc(pattern.slice(last)) + "$";
    return new RegExp(out);
  };
  const sorted = [...fmts].filter((fm) => fm.pattern).sort((a, b) => (b.pattern!.length || 0) - (a.pattern!.length || 0));
  for (const fm of sorted) {
    try {
      if (toRegex(fm.pattern!).test(docNumber)) return fm.id;
    } catch {
      /* bad pattern — skip */
    }
  }
  return "";
}

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

type Row = { description: string; quantity: number; unitPrice: number; accountCode?: string };
type Template = {
  id: string; name: string; customerId: string; frequency: string; nextRunDate: string;
  endDate?: string | null; autoSend: boolean; isActive: boolean; lastRunAt?: string | null; lastRunDocumentId?: string | null; nextRunNo?: number; code?: string | null;
  documentTemplateId: string; numberFormatId?: string | null; config: any;
  projectId?: string | null; projectDeploymentId?: string | null; sourceDocumentId?: string | null;
};

// Draft-first by default: autoSend=false means each run creates a DRAFT invoice
// for review (fill meter readings etc.), not a confirmed+emailed one.
const blank = { name: "", customerId: "", documentTemplateId: "", numberFormatId: "", frequency: "MONTHLY", nextRunDate: "", endDate: "", autoSend: false, isActive: true, notes: "", reference: "", nextRunNo: 1, emailOverrides: null as any, items: [{ description: "", quantity: 1, unitPrice: 0, accountCode: "" }] as Row[], projectId: "", projectDeploymentId: "", sourceDocumentId: "", projectName: "" };

export default function RecurringInvoicesView() {
  const { request } = useAccountingApi();
  const { customers } = useGetCustomers();
  const searchParams = useSearchParams();
  const [items, setItems] = useState<Template[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [formats, setFormats] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [editing, setEditing] = useState<Template | null>(null);
  const [form, setForm] = useState<any>(blank);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const prefilledFromRef = useRef<string | null>(null);
  const { organization } = useOrganization();
  const { isXeroDocSyncEnabled } = useOrganizationFeatures();
  const [syncingId, setSyncingId] = useState<string | null>(null);
  // Which text field receives inserted tokens: an item row or the notes box.
  const tokenTargetRef = useRef<{ kind: "item"; index: number } | { kind: "notes" }>({ kind: "item", index: 0 });
  const [emailPreviewOpen, setEmailPreviewOpen] = useState(false);

  const insertToken = (token: string) => {
    const t = tokenTargetRef.current;
    if ((t as any).kind === "reference") {
      setForm((f: any) => ({ ...f, reference: `${f.reference || ""}${f.reference && !f.reference.endsWith(" ") ? " " : ""}${token}` }));
    } else if (t.kind === "notes") {
      setForm((f: any) => ({ ...f, notes: `${f.notes || ""}${f.notes && !f.notes.endsWith(" ") ? " " : ""}${token}` }));
    } else {
      setForm((f: any) => ({
        ...f,
        items: f.items.map((r: Row, x: number) =>
          x === t.index ? { ...r, description: `${r.description || ""}${r.description && !r.description.endsWith(" ") ? " " : ""}${token}` } : r,
        ),
      }));
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      await request("/recurring-invoices/run-due", { method: "POST" }).catch(() => {}); // generate any due
      const [list, tpls, fmts, accs] = await Promise.all([
        request<Template[]>("/recurring-invoices"),
        // Org-scoped: only templates ACTIVATED for this org (shared pool
        // otherwise leaks every org's variants — guru 2026-08-06).
        request<any>("/documentTemplates/active/INVOICE").catch(() => null),
        request<any[]>("/document-numbering?documentType=INVOICE").catch(() => []),
        // Chart of accounts for the line Account dropdown (same source +
        // filter as the bill editor — guru 2026-08-06).
        request<any[]>("/accounting/accounts").catch(() => []),
      ]);
      setItems(list || []);
      const raw = tpls?.data ?? tpls ?? [];
      const docs = (Array.isArray(raw) ? raw : raw?.docs ?? []).filter((t: any) => t.type === "INVOICE");
      setTemplates(docs);
      setFormats((fmts || []).filter((f: any) => f.isActive));
      setAccounts(((accs as any[]) || []).filter((a: any) => a.isActive).sort((a: any, b: any) => String(a.code).localeCompare(String(b.code))));
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
        const seedItems = (Array.isArray(cfg.items) ? cfg.items : []).filter((it: any) => (it?.description || "").trim());
        // Account prefill (guru 2026-08-05): the line's own accountCode wins;
        // otherwise pull the linked item's attached revenue account
        // (rentalAccountCode first — recurring is overwhelmingly rentals —
        // then salesAccountCode).
        const itemAccounts = new Map<string, string>();
        await Promise.all(
          Array.from(new Set(seedItems.map((it: any) => it.inventoryItemId).filter(Boolean))).map(async (assetId: any) => {
            try {
              const a: any = unwrapAsset(await request<any>(`/assets/${assetId}`));
              const code = a?.rentalAccountCode || a?.salesAccountCode || "";
              if (code) itemAccounts.set(assetId, code);
            } catch {
              /* item lookup is best-effort */
            }
          }),
        );
        const rows: Row[] = seedItems.map((it: any) => ({
          description: tokenizeText(String(it.description || ""), seedDate).replace(/(\d{1,3})(st|nd|rd|th)(\s+mth)/gi, "{NTH}$3"),
          quantity: Number(it.quantity) || 1,
          unitPrice: Number(it.unitPrice ?? it.price) || 0,
          accountCode: it.accountCode || (it.inventoryItemId && itemAccounts.get(it.inventoryItemId)) || "",
        }));
        // Rental month counter: seed text like "17th mth" → {NTH} token, and
        // the schedule continues from the NEXT number.
        const nthMatch = JSON.stringify(cfg).match(/(\d{1,3})(?:st|nd|rd|th)\s+mth/i);
        const seedRunNo = nthMatch ? parseInt(nthMatch[1], 10) : null;
        // Number format carries over (guru 2026-08-06): explicit id on the
        // seed when present, else inferred by matching the invoice number
        // against each active variant's pattern.
        let numberFormatId = cfg.numberFormatId || "";
        if (!numberFormatId) {
          try {
            const fmts: any[] = (await request<any[]>(`/document-numbering?documentType=INVOICE`)) || [];
            numberFormatId = matchNumberFormat(String(doc.name || ""), fmts.filter((fm: any) => fm.isActive));
          } catch {
            /* inference is best-effort */
          }
        }
        setEditing(null);
        setForm({
          ...blank,
          name: `Recurring — ${doc.name || "invoice"}`,
          customerId: cfg.customerId || cfg.customer?.id || "",
          documentTemplateId: doc.documentTemplateId || "",
          numberFormatId,
          frequency: "MONTHLY",
          // First run = TODAY (guru 2026-08-05): "confirm & make recurring"
          // means the schedule takes over sending from now — the first run
          // fires immediately on activate, then advances one period per run.
          nextRunDate: nowLocalInput(),
          autoSend: false,
          notes: tokenizeText(String(cfg.notes || ""), seedDate),
          reference: tokenizeText(String(cfg.reference || cfg.referenceNo || ""), seedDate).replace(/(\d{1,3})(st|nd|rd|th)(\s+mth)/gi, "{NTH}$3"),
          nextRunNo: seedRunNo != null ? seedRunNo + 1 : 1,
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

  const openNew = () => { setEditing(null); setForm({ ...blank, nextRunDate: nowLocalInput() }); setOpen(true); };
  const openEdit = (t: Template) => {
    setEditing(t);
    setForm({
      name: t.name, customerId: t.customerId, documentTemplateId: t.documentTemplateId, numberFormatId: t.numberFormatId || "",
      frequency: t.frequency, nextRunDate: toLocalInput(t.nextRunDate), endDate: t.endDate?.slice(0, 10) || "",
      autoSend: t.autoSend, isActive: t.isActive, notes: t.config?.notes || "", reference: t.config?.reference || "", nextRunNo: t.nextRunNo ?? 1, emailOverrides: t.config?.email || null,
      items: Array.isArray(t.config?.items) && t.config.items.length ? t.config.items.map((i: any) => ({ description: i.description || "", quantity: i.quantity ?? 1, unitPrice: i.unitPrice ?? 0, accountCode: i.accountCode || "" })) : blank.items,
      projectId: t.projectId || "", projectDeploymentId: t.projectDeploymentId || "", sourceDocumentId: t.sourceDocumentId || "", projectName: "",
    });
    setOpen(true);
  };

  const setRow = (i: number, patch: Partial<Row>) => setForm((f: any) => ({ ...f, items: f.items.map((r: Row, x: number) => (x === i ? { ...r, ...patch } : r)) }));
  const addRow = () => setForm((f: any) => ({ ...f, items: [...f.items, { description: "", quantity: 1, unitPrice: 0, accountCode: "" }] }));
  const delRow = (i: number) => setForm((f: any) => ({ ...f, items: f.items.filter((_: Row, x: number) => x !== i) }));

  // asDraft: save with isActive=false — editable later, never runs until
  // activated from the list (guru 2026-08-05).
  const save = async (asDraft = false) => {
    if (!form.name.trim()) return toast.warn("Name is required");
    if (!form.customerId) return toast.warn("Pick a customer");
    if (!form.documentTemplateId) return toast.warn("Pick an invoice template");
    if (!form.nextRunDate) return toast.warn("Set the first run date");
    setSaving(true);
    try {
      const config = {
        notes: form.notes,
        // Free-text Reference (tokens allowed) — lands on every generated
        // invoice and shows in the list's Reference column.
        ...(form.reference?.trim() ? { reference: form.reference.trim() } : {}),
        // Saved email settings (recipients/subject/body) for auto-send runs —
        // tokens in subject/body resolve per run.
        ...(form.emailOverrides ? { email: form.emailOverrides } : {}),
        items: form.items.filter((r: Row) => r.description.trim()).map((r: Row) => ({
          itemCode: "", description: r.description, quantity: Number(r.quantity) || 1, unitPrice: Number(r.unitPrice) || 0,
          amount: (Number(r.quantity) || 1) * (Number(r.unitPrice) || 0), ...(r.accountCode ? { accountCode: r.accountCode } : {}),
        })),
      };
      const payload = {
        name: form.name.trim(), customerId: form.customerId, documentTemplateId: form.documentTemplateId,
        numberFormatId: form.numberFormatId || null, frequency: form.frequency, nextRunDate: new Date(form.nextRunDate).toISOString(),
        endDate: form.endDate || null, autoSend: form.autoSend, isActive: asDraft ? false : form.isActive, config,
        nextRunNo: Number(form.nextRunNo) || 1,
        projectId: form.projectId || null,
        projectDeploymentId: form.projectDeploymentId || null,
        sourceDocumentId: form.sourceDocumentId || null,
      };
      if (editing) await request(`/recurring-invoices/${editing.id}`, { method: "PATCH", body: JSON.stringify(payload) });
      else await request("/recurring-invoices", { method: "POST", body: JSON.stringify(payload) });
      toast.success(asDraft ? "Saved as draft — it won't run until you switch it Active in the list" : editing ? "Updated" : "Recurring invoice created");
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
  // Push the schedule's LATEST generated invoice to Xero — same endpoint,
  // flag and toasts as the bill editor's Sync to Xero (guru 2026-08-07).
  const syncToXero = async (t: Template) => {
    if (!t.lastRunDocumentId) return toast.warn("No generated invoice yet — run the schedule first");
    setSyncingId(t.id);
    try {
      const res: any = await request(`/documents/${t.lastRunDocumentId}/sync-to-xero`, { method: "POST" });
      if (res?.success ?? true) {
        toast.success(`${res?.action === "updated" ? "Updated in Xero" : "Created in Xero"}: ${res?.xeroInvoiceNumber || "(auto number)"} — ${res?.xeroStatus || "DRAFT"}`);
      } else {
        throw new Error(res?.message || "Xero sync failed");
      }
    } catch (e: any) {
      toast.error(e?.message || "Failed to sync to Xero");
    } finally {
      setSyncingId(null);
    }
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
                <TableCell sx={{ fontWeight: 700 }}>ID</TableCell>
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
                  <TableCell sx={{ whiteSpace: "nowrap" }}>
                    <Typography variant="body2" sx={{ fontWeight: 700, fontFamily: "monospace" }}>{t.code || "—"}</Typography>
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" alignItems="center" gap={0.75}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>{t.name}</Typography>
                      {!t.isActive && !t.lastRunAt && <Chip size="small" color="warning" variant="outlined" label="DRAFT" />}
                      {t.projectDeploymentId && (
                        <Tooltip title="Linked to a project deployment — generated invoices appear on its deployment card">
                          <Chip size="small" icon={<LinkIcon sx={{ fontSize: 14 }} />} label="Deployment" variant="outlined" />
                        </Tooltip>
                      )}
                    </Stack>
                  </TableCell>
                  <TableCell>{custName(t.customerId)}</TableCell>
                  <TableCell><Chip size="small" label={t.frequency.toLowerCase()} /></TableCell>
                  <TableCell>{toLocalInput(t.nextRunDate).replace("T", " ")}</TableCell>
                  <TableCell align="center">{t.autoSend ? <Chip size="small" color="info" label="Auto (email)" /> : <Chip size="small" label="Draft" />}</TableCell>
                  <TableCell align="center"><Switch size="small" checked={t.isActive} onChange={() => toggle(t)} /></TableCell>
                  <TableCell align="right">
                    <Tooltip title="Generate now"><span><IconButton size="small" disabled={busyId === t.id} onClick={() => generateNow(t)}>{busyId === t.id ? <CircularProgress size={16} /> : <PlayArrowIcon fontSize="small" />}</IconButton></span></Tooltip>
                    {isXeroDocSyncEnabled && (
                      <Tooltip title={t.lastRunDocumentId ? "Sync the latest generated invoice to Xero (DRAFT)" : "No generated invoice yet — run the schedule first"}>
                        <span>
                          <IconButton size="small" disabled={syncingId === t.id || !t.lastRunDocumentId} onClick={() => syncToXero(t)}>
                            {syncingId === t.id ? <CircularProgress size={16} /> : <CloudSyncIcon fontSize="small" />}
                          </IconButton>
                        </span>
                      </Tooltip>
                    )}
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
              <TextField label="First run" size="small" type="datetime-local" InputLabelProps={{ shrink: true }} value={form.nextRunDate} onChange={(e) => setForm((f: any) => ({ ...f, nextRunDate: e.target.value }))} sx={{ minWidth: 210 }} />
              <TextField label="End date (optional)" size="small" type="date" InputLabelProps={{ shrink: true }} value={form.endDate} onChange={(e) => setForm((f: any) => ({ ...f, endDate: e.target.value }))} />
              <Tooltip title={'Rental month counter for the {NTH} token — e.g. 17 renders "17th" on the next run, then 18th, 19th…'}>
                <TextField label="Period no." size="small" type="number" sx={{ width: 100 }} inputProps={{ min: 1 }} value={form.nextRunNo} onChange={(e) => setForm((f: any) => ({ ...f, nextRunNo: Number(e.target.value) || 1 }))} />
              </Tooltip>
              <Tooltip title={form.autoSend ? "Each run confirms (posts to the GL) and emails the customer automatically" : "Each run creates a draft invoice for review — fill in meter readings etc., then confirm manually"}>
                <Stack direction="row" alignItems="center"><Switch checked={form.autoSend} onChange={(_, v) => setForm((f: any) => ({ ...f, autoSend: v }))} /><Typography variant="body2">{form.autoSend ? "Fully automatic (confirm + email)" : "Draft for review"}</Typography></Stack>
              </Tooltip>
              {form.autoSend && (
                <Button size="small" variant="outlined" onClick={() => {
                  if (!form.customerId) { toast.warn("Pick a customer first"); return; }
                  setEmailPreviewOpen(true);
                }}>
                  Preview email
                </Button>
              )}
            </Stack>

            {/* Line items */}
            <Box>
              <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>Line items</Typography>
              <Typography variant="caption" color="text.secondary">Click a line description (or Notes), then tap a button to drop in a date token — it resolves to each run&apos;s date.</Typography>
              <Stack direction="row" gap={1} flexWrap="wrap" sx={{ mt: 1 }}>
                {TOKEN_BUTTONS.map((tb) => (
                  <Button key={tb.token} size="small" variant="outlined" startIcon={<AddIcon />} onMouseDown={(e) => e.preventDefault()} onClick={() => insertToken(tb.token)}>
                    {tb.label}
                  </Button>
                ))}
              </Stack>
              <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2, mt: 1 }}>
                <Table size="small">
                  <TableHead><TableRow>
                    <TableCell>Description</TableCell><TableCell align="right" sx={{ width: 80 }}>Qty</TableCell>
                    <TableCell align="right" sx={{ width: 110 }}>Unit price</TableCell><TableCell sx={{ width: 200 }}>Account</TableCell><TableCell />
                  </TableRow></TableHead>
                  <TableBody>
                    {form.items.map((r: Row, i: number) => (
                      <TableRow key={i}>
                        <TableCell><TextField fullWidth size="small" multiline maxRows={6} value={r.description} placeholder="Services for {MONTH YEAR}" onFocus={() => { tokenTargetRef.current = { kind: "item", index: i }; }} onChange={(e) => setRow(i, { description: e.target.value })} /></TableCell>
                        <TableCell><TextField size="small" type="number" value={r.quantity} onChange={(e) => setRow(i, { quantity: Number(e.target.value) })} /></TableCell>
                        <TableCell><TextField size="small" type="number" value={r.unitPrice} onChange={(e) => setRow(i, { unitPrice: Number(e.target.value) })} /></TableCell>
                        <TableCell>
                          <Autocomplete
                            size="small"
                            options={accounts}
                            value={accounts.find((a: any) => a.code === r.accountCode) || null}
                            onChange={(_, v: any) => setRow(i, { accountCode: v?.code || "" })}
                            getOptionLabel={(o: any) => `${o.code} — ${o.name}`}
                            renderOption={(props, o: any) => (<li {...props} key={o.id}>{o.code} — {o.name}</li>)}
                            renderInput={(params) => <TextField {...params} placeholder="Auto" />}
                            sx={{ minWidth: 180 }}
                          />
                        </TableCell>
                        <TableCell><IconButton size="small" onClick={() => delRow(i)}><DeleteOutlineIcon fontSize="small" /></IconButton></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
              <Button size="small" startIcon={<AddIcon />} onClick={addRow} sx={{ mt: 1 }}>Add line</Button>
            </Box>

            <TextField label="Reference (optional, tokens allowed)" size="small" fullWidth value={form.reference} placeholder="e.g. Rental {MONTH YEAR}" onFocus={() => { tokenTargetRef.current = { kind: "reference" } as any; }} onChange={(e) => setForm((f: any) => ({ ...f, reference: e.target.value }))} />
            <TextField label="Notes (optional, tokens allowed)" size="small" fullWidth multiline minRows={2} value={form.notes} onFocus={() => { tokenTargetRef.current = { kind: "notes" }; }} onChange={(e) => setForm((f: any) => ({ ...f, notes: e.target.value }))} />

            {/* Live preview */}
            <Box sx={{ p: 1.5, borderRadius: 1, bgcolor: (t) => alpha(t.palette.info.main, 0.06) }}>
              <Typography variant="caption" color="text.secondary">Preview for {previewDate.toLocaleDateString()}:</Typography>
              {form.items.filter((r: Row) => r.description.trim()).map((r: Row, i: number) => (
                <Typography key={i} variant="body2" sx={{ fontWeight: 600, whiteSpace: "pre-line" }}>• {resolveText(r.description, previewDate, Number(form.nextRunNo) || 1)}</Typography>
              ))}
              {form.notes && <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{resolveText(form.notes, previewDate, Number(form.nextRunNo) || 1)}</Typography>}
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
          <Button variant="outlined" startIcon={<VisibilityIcon />} onClick={() => setPreviewOpen(true)} disabled={saving}>Preview</Button>
          <Button variant="outlined" onClick={() => save(true)} disabled={saving}>Save as draft</Button>
          <Button variant="contained" onClick={() => save(false)} disabled={saving} startIcon={saving ? <CircularProgress size={14} color="inherit" /> : undefined}>{editing ? "Save" : "Create & activate"}</Button>
        </DialogActions>
      </Dialog>

      {/* Live preview of the NEXT generated invoice: tokens resolved against
          the form's next-run date + {NTH} counter (guru 2026-08-27). */}
      <Dialog open={previewOpen} onClose={() => setPreviewOpen(false)} fullWidth maxWidth="lg">
        <DialogTitle sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          Preview — next run ({previewDate.toLocaleDateString("en-SG")})
          <IconButton size="small" onClick={() => setPreviewOpen(false)}><CloseIcon fontSize="small" /></IconButton>
        </DialogTitle>
        <DialogContent dividers sx={{ bgcolor: "grey.100" }}>
          {(() => {
            const runNo = Number(form.nextRunNo) || 1;
            const rows = (form.items || []).map((it: any) => {
              const qty = it.quantity === null || it.quantity === "" ? null : Number(it.quantity);
              const up = it.unitPrice === null || it.unitPrice === "" ? null : Number(it.unitPrice);
              const amt = up != null && qty != null ? Math.round(qty * up * 100) / 100 : (up != null ? up : null);
              return {
                description: resolveText(it.description || "", previewDate, runNo),
                quantity: qty, unitPrice: up, amount: amt,
                accountCode: it.accountCode || null,
                taxAmount: amt ? Math.round(amt * 9) / 100 : null,
              };
            });
            const sub = rows.reduce((t: number, r: any) => t + (Number(r.amount) || 0), 0);
            const gst = Math.round(sub * 9) / 100;
            const tplCfg: any = editing?.config || {};
            const data = {
              ...tplCfg,
              items: rows,
              date: previewDate.toISOString().slice(0, 10),
              documentNumber: "(assigned on generation)",
              reference: resolveText(form.reference || tplCfg.reference || "", previewDate, runNo),
              customerName: custName(form.customerId),
              customer: { name: custName(form.customerId) },
              subTotal: Math.round(sub * 100) / 100,
              gstAmount: gst,
              nettTotal: Math.round((sub + gst) * 100) / 100,
              documentInfo: {
                ...(tplCfg.documentInfo || {}),
                referenceNo: resolveText(form.reference || tplCfg.reference || "", previewDate, runNo),
                currency: "SGD", gstPercent: 9,
              },
              notes: resolveText(form.notes || "", previewDate, runNo),
            };
            return <CleanDocumentPreview documentType="INVOICE" data={data} />;
          })()}
        </DialogContent>
      </Dialog>

      {/* Email preview — the exact dialog used when sending an invoice email
          (CleanDocumentPreview / editor), in preview-only mode with this
          schedule's next run resolved in. */}
      {emailPreviewOpen && (
        <SendInvoiceEmailDialog
          open={emailPreviewOpen}
          onClose={() => setEmailPreviewOpen(false)}
          onSent={() => setEmailPreviewOpen(false)}
          previewOnly
          templateId={form.documentTemplateId || undefined}
          initialOverrides={form.emailOverrides}
          onSaveOverrides={(o) => {
            setForm((f: any) => ({ ...f, emailOverrides: o }));
            toast.success("Email settings stored — they take effect when you save this schedule");
          }}
          organizationName={organization?.name}
          invoice={{
            id: "",
            // The ACTUAL number the next run will mint (backend attaches
            // `preview` per numbering variant); default scheme → placeholder.
            name: formats.find((fm: any) => fm.id === form.numberFormatId)?.preview || "(auto number)",
            type: "INVOICE",
            status: "unconfirmed",
            organizationId: organization?.id || "",
            config: {
              items: form.items
                .filter((r: Row) => r.description.trim())
                .map((r: Row) => ({
                  description: resolveText(r.description, previewDate, Number(form.nextRunNo) || 1),
                  quantity: Number(r.quantity) || 1,
                  unitPrice: Number(r.unitPrice) || 0,
                  amount: (Number(r.quantity) || 1) * (Number(r.unitPrice) || 0),
                })),
              notes: resolveText(form.notes || "", previewDate, Number(form.nextRunNo) || 1),
              date: form.nextRunDate,
              customerId: form.customerId,
              company: { name: organization?.name },
            },
          }}
          customer={{
            id: form.customerId,
            name: custName(form.customerId),
            email: (customers || []).find((c: any) => c.id === form.customerId)?.email,
          }}
        />
      )}
    </Box>
  );
}
