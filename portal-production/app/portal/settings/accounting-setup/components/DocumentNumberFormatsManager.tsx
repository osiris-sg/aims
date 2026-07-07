"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
  alpha,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import CloseIcon from "@mui/icons-material/Close";
import { useAuth } from "@clerk/nextjs";
import { toast } from "react-toastify";

// Canonical document types — MUST match the values the create picker uses.
export const NUMBERING_DOC_TYPES: { value: string; label: string }[] = [
  { value: "QUOTATION", label: "Quotation" },
  { value: "SALES_ORDER", label: "Sales Order" },
  { value: "DELIVERY_ORDER", label: "Delivery Order" },
  { value: "INVOICE", label: "Invoice" },
  { value: "CREDIT_NOTE", label: "Credit Note" },
  { value: "DEBIT_NOTE", label: "Debit Note" },
  { value: "PROFORMA", label: "Proforma" },
  { value: "PURCHASE_ORDER", label: "Purchase Order" },
  { value: "PURCHASE_RETURN", label: "Purchase Return" },
  { value: "STOCK_ADJUSTMENT", label: "Stock Adjustment" },
  { value: "PAYMENT_VOUCHER", label: "Payment Voucher" },
  { value: "RECEIPT", label: "Receipt" },
];
const labelOf = (v: string) => NUMBERING_DOC_TYPES.find((d) => d.value === v)?.label || v;

// Short code per type — mirrors the backend {DOC} token.
export const DOC_CODE: Record<string, string> = {
  QUOTATION: "QO", SALES_ORDER: "SO", DELIVERY_ORDER: "DO", INVOICE: "INV",
  CREDIT_NOTE: "CN", DEBIT_NOTE: "DN", PROFORMA: "PF", PURCHASE_ORDER: "PO",
  PURCHASE_RETURN: "PR", STOCK_ADJUSTMENT: "SA", PAYMENT_VOUCHER: "PV", RECEIPT: "RCP",
};

// ---------- block builder <-> pattern ----------
type Seg = { kind: "text" | "year" | "month" | "day" | "serial" | "doc"; value?: string; pad?: number };

function segsToPattern(segs: Seg[]): string {
  return segs
    .map((s) => {
      switch (s.kind) {
        case "text": return s.value || "";
        case "year": return "{YYYY}";
        case "month": return "{MM}";
        case "day": return "{DD}";
        case "doc": return "{DOC}";
        case "serial": return "{" + "#".repeat(s.pad || 4) + "}";
        default: return "";
      }
    })
    .join("");
}

function patternToSegs(pattern: string): Seg[] {
  const segs: Seg[] = [];
  const re = /\{([^}]+)\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(pattern))) {
    if (m.index > last) segs.push({ kind: "text", value: pattern.slice(last, m.index) });
    const tok = m[1];
    if (/^#+$/.test(tok)) segs.push({ kind: "serial", pad: tok.length });
    else if (tok === "DOC") segs.push({ kind: "doc" });
    else if (/^Y{2,4}(MM)?(DD)?$/.test(tok) || /^(YY|YYYY)?(MM)?(DD)?$/.test(tok)) {
      // split a combined date token like YYYYMMDD into individual chips
      if (/Y/.test(tok)) segs.push({ kind: "year" });
      if (/MM/.test(tok)) segs.push({ kind: "month" });
      if (/DD/.test(tok)) segs.push({ kind: "day" });
    } else segs.push({ kind: "text", value: "{" + tok + "}" });
    last = re.lastIndex;
  }
  if (last < pattern.length) segs.push({ kind: "text", value: pattern.slice(last) });
  return segs;
}

// Live preview — mirror of the backend engine.
export function formatPattern(pattern: string, serial: number, date: Date, docCode = ""): string {
  const YYYY = String(date.getFullYear());
  const YY = YYYY.slice(2);
  const MM = String(date.getMonth() + 1).padStart(2, "0");
  const DD = String(date.getDate()).padStart(2, "0");
  return (pattern || "").replace(/\{([^}]+)\}/g, (_m, tok: string) => {
    if (/^#+$/.test(tok)) return String(serial).padStart(tok.length, "0");
    if (tok === "DOC") return docCode;
    return tok.replace(/YYYY/g, YYYY).replace(/YY/g, YY).replace(/MM/g, MM).replace(/DD/g, DD);
  });
}

type Format = {
  id: string;
  documentType: string;
  label: string;
  pattern: string;
  resetPolicy: string;
  nextSerial: number;
  isActive: boolean;
};
const RESETS = [
  { value: "never", label: "Never" },
  { value: "yearly", label: "Yearly" },
  { value: "monthly", label: "Monthly" },
  { value: "daily", label: "Daily" },
];

export default function DocumentNumberFormatsManager() {
  const { getToken } = useAuth();
  const [formats, setFormats] = useState<Format[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Format | null>(null);
  const [saving, setSaving] = useState(false);

  // dialog form
  const [documentType, setDocumentType] = useState("INVOICE");
  const [label, setLabel] = useState("");
  const [segs, setSegs] = useState<Seg[]>([]);
  const [resetPolicy, setResetPolicy] = useState("never");
  const [nextSerial, setNextSerial] = useState(1);
  const [isActive, setIsActive] = useState(true);
  const [applyAll, setApplyAll] = useState(false);

  const authedFetch = useCallback(async (path: string, init?: RequestInit) => {
    const token = await getToken();
    const headers: Record<string, string> = { ...(init?.headers as any), "Content-Type": "application/json", Authorization: `Bearer ${token}` };
    if (typeof window !== "undefined") {
      const activeOrgId = window.sessionStorage.getItem("aims-admin-active-org");
      if (activeOrgId) headers["X-Active-Org-Id"] = activeOrgId;
    }
    return fetch(`${process.env.NEXT_PUBLIC_BACKEND_API_URL}${path}`, { ...init, headers });
  }, [getToken]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authedFetch("/document-numbering");
      const json = await res.json();
      const list = json?.data ?? json;
      setFormats(Array.isArray(list) ? list : []);
    } catch {
      toast.error("Failed to load numbering formats");
    } finally {
      setLoading(false);
    }
  }, [authedFetch]);
  useEffect(() => { load(); }, [load]);

  const openNew = () => {
    setEditing(null);
    setDocumentType("INVOICE"); setLabel(""); setSegs([]); setResetPolicy("never"); setNextSerial(1); setIsActive(true); setApplyAll(false);
    setOpen(true);
  };
  const openEdit = (f: Format) => {
    setEditing(f);
    setDocumentType(f.documentType); setLabel(f.label); setSegs(patternToSegs(f.pattern));
    setResetPolicy(f.resetPolicy); setNextSerial(f.nextSerial); setIsActive(f.isActive); setApplyAll(false);
    setOpen(true);
  };

  const pattern = useMemo(() => segsToPattern(segs), [segs]);
  const preview = useMemo(() => formatPattern(pattern, Number(nextSerial) || 1, new Date(), DOC_CODE[documentType] || ""), [pattern, nextSerial, documentType]);

  const addSeg = (s: Seg) => setSegs((p) => [...p, s]);
  const removeSeg = (i: number) => setSegs((p) => p.filter((_, x) => x !== i));
  const setSegVal = (i: number, patch: Partial<Seg>) => setSegs((p) => p.map((s, x) => (x === i ? { ...s, ...patch } : s)));
  // Drop an editable separator (defaults to "-") between blocks at index i.
  const insertDash = (i: number) => setSegs((p) => [...p.slice(0, i), { kind: "text", value: "-" }, ...p.slice(i)]);

  const save = async () => {
    if (!label.trim()) { toast.warn("Give the variant a name (e.g. EW)"); return; }
    if (!pattern.trim()) { toast.warn("Build the format — add at least some text or a number"); return; }
    setSaving(true);
    try {
      const payload = { documentType, label: label.trim(), pattern, resetPolicy, nextSerial: Number(nextSerial) || 1, isActive };
      const res = editing
        ? await authedFetch(`/document-numbering/${editing.id}`, { method: "PATCH", body: JSON.stringify(payload) })
        : applyAll
          ? await authedFetch("/document-numbering/apply-all", { method: "POST", body: JSON.stringify(payload) })
          : await authedFetch("/document-numbering", { method: "POST", body: JSON.stringify(payload) });
      if (!res.ok) throw new Error();
      toast.success(editing ? "Updated" : applyAll ? "Added to all document types" : "Variant added");
      setOpen(false);
      load();
    } catch {
      toast.error("Save failed");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (f: Format) => {
    if (!confirm(`Delete "${labelOf(f.documentType)} · ${f.label}"?`)) return;
    try {
      const res = await authedFetch(`/document-numbering/${f.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success("Deleted");
      load();
    } catch {
      toast.error("Delete failed");
    }
  };

  const grouped = useMemo(() => {
    const m = new Map<string, Format[]>();
    for (const f of formats) { if (!m.has(f.documentType)) m.set(f.documentType, []); m.get(f.documentType)!.push(f); }
    return m;
  }, [formats]);
  const now = new Date();

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
        <Box>
          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>Document number sequences</Typography>
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            Build one or more numbering <b>variants</b> per document type. When a type has more than one, staff choose which at create time.
          </Typography>
        </Box>
        <Button size="small" startIcon={<AddIcon />} variant="contained" onClick={openNew} sx={{ whiteSpace: "nowrap" }}>Add variant</Button>
      </Stack>

      {loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", p: 4 }}><CircularProgress /></Box>
      ) : formats.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 3, textAlign: "center", borderRadius: 2, color: "text.secondary" }}>
          <Typography variant="body2">No custom formats yet — documents use the default numbering. Add a variant to customise.</Typography>
        </Paper>
      ) : (
        <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2 }}>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: (t) => alpha(t.palette.text.primary, 0.03) }}>
                <TableCell sx={{ fontWeight: 700 }}>Document type</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Variant</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Example</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Reset</TableCell>
                <TableCell sx={{ fontWeight: 700 }} align="center">Active</TableCell>
                <TableCell sx={{ fontWeight: 700 }} align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {Array.from(grouped.entries()).map(([type, list]) =>
                list.map((f, i) => (
                  <TableRow key={f.id}>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: i === 0 ? 600 : 400, color: i === 0 ? "text.primary" : "text.secondary" }}>
                        {labelOf(type)}
                      </Typography>
                    </TableCell>
                    <TableCell><Chip size="small" label={f.label} /></TableCell>
                    <TableCell sx={{ fontFamily: "monospace", fontSize: 12, color: "primary.main" }}>{formatPattern(f.pattern, f.nextSerial, now, DOC_CODE[f.documentType])}</TableCell>
                    <TableCell><Typography variant="caption">{RESETS.find((r) => r.value === f.resetPolicy)?.label}</Typography></TableCell>
                    <TableCell align="center">{f.isActive ? <Chip size="small" color="success" label="On" /> : <Chip size="small" label="Off" />}</TableCell>
                    <TableCell align="right">
                      <Tooltip title="Edit"><IconButton size="small" onClick={() => openEdit(f)}><EditIcon fontSize="small" /></IconButton></Tooltip>
                      <Tooltip title="Delete"><IconButton size="small" onClick={() => remove(f)}><DeleteOutlineIcon fontSize="small" /></IconButton></Tooltip>
                    </TableCell>
                  </TableRow>
                )),
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Dialog open={open} onClose={() => !saving && setOpen(false)} fullWidth maxWidth="md">
        <DialogTitle>{editing ? "Edit variant" : "Add numbering variant"}</DialogTitle>
        <DialogContent dividers>
          <Stack gap={2} sx={{ mt: 0.5 }}>
            <Stack direction="row" gap={2}>
              <TextField select label="Document type" size="small" fullWidth value={documentType} disabled={applyAll} helperText={applyAll ? "Applies to every type" : undefined} onChange={(e) => setDocumentType(e.target.value)}>
                {NUMBERING_DOC_TYPES.map((d) => (<MenuItem key={d.value} value={d.value}>{d.label}</MenuItem>))}
              </TextField>
              <TextField label="Variant name" size="small" fullWidth value={label} placeholder="e.g. EW / JPSG" onChange={(e) => setLabel(e.target.value)} />
            </Stack>

            {!editing && (
              <Stack direction="row" alignItems="center" gap={1} sx={{ p: 1, borderRadius: 1.5, bgcolor: (t) => alpha(t.palette.info.main, applyAll ? 0.1 : 0.04) }}>
                <Switch color="info" checked={applyAll} onChange={(_, v) => setApplyAll(v)} />
                <Box>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>Apply to all document types</Typography>
                  <Typography variant="caption" sx={{ color: "text.secondary" }}>
                    Creates this variant for every type at once. Add a <b>Doc Code</b> block and it fills in INV / QO / DO per type — each with its own counter.
                  </Typography>
                </Box>
              </Stack>
            )}

            {/* ---------- visual block builder ---------- */}
            <Box>
              <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>Build the format</Typography>
              <Typography variant="caption" sx={{ color: "text.secondary", display: "block", mb: 1 }}>
                Type your text, then tap the buttons to drop in the date or the running number — in any order.
              </Typography>
              <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, minHeight: 64, display: "flex", flexWrap: "wrap", gap: 1, alignItems: "center" }}>
                {segs.length === 0 && <Typography variant="body2" sx={{ color: "text.disabled", px: 1 }}>Add text and blocks below…</Typography>}
                {segs.map((s, i) => (
                  <Box key={i} sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
                    <Tooltip title="Insert dash / separator here">
                      <IconButton size="small" onClick={() => insertDash(i)} sx={{ p: 0.15, opacity: 0.35, "&:hover": { opacity: 1, bgcolor: "action.hover" } }}><AddIcon sx={{ fontSize: 14 }} /></IconButton>
                    </Tooltip>
                    {s.kind === "text" ? (
                      <Box sx={{ display: "inline-flex", alignItems: "center", bgcolor: (t) => alpha(t.palette.text.primary, 0.03), borderRadius: 1.5, pr: 0.25 }}>
                        <TextField
                          size="small"
                          value={s.value || ""}
                          placeholder="type text…"
                          onChange={(e) => setSegVal(i, { value: e.target.value })}
                          sx={{ width: `${Math.max(10, (s.value?.length || 6) + 4)}ch`, "& .MuiOutlinedInput-notchedOutline": { border: "none" } }}
                        />
                        <IconButton size="small" onClick={() => removeSeg(i)} sx={{ p: 0.4 }}><CloseIcon sx={{ fontSize: 16 }} /></IconButton>
                      </Box>
                    ) : s.kind === "serial" ? (
                      <Chip
                        color="primary"
                        variant="outlined"
                        onDelete={() => removeSeg(i)}
                        sx={{ height: 36, fontSize: 13, "& .MuiChip-label": { pr: 0.5 } }}
                        label={
                          <Stack direction="row" alignItems="center" gap={0.5}>
                            <span>Number</span>
                            <Select variant="standard" disableUnderline value={s.pad || 4} onChange={(e) => setSegVal(i, { pad: Number(e.target.value) })} sx={{ fontSize: 13, fontWeight: 700 }}>
                              {[2, 3, 4, 5, 6].map((n) => (<MenuItem key={n} value={n}>{"0".repeat(n)}</MenuItem>))}
                            </Select>
                          </Stack>
                        }
                      />
                    ) : (
                      <Chip
                        color={s.kind === "doc" ? "info" : "secondary"}
                        variant="outlined"
                        onDelete={() => removeSeg(i)}
                        sx={{ height: 36, fontSize: 13 }}
                        label={s.kind === "year" ? "Year (YYYY)" : s.kind === "month" ? "Month (MM)" : s.kind === "day" ? "Day (DD)" : `Doc Code (${DOC_CODE[documentType] || "?"})`}
                      />
                    )}
                  </Box>
                ))}
                {segs.length > 0 && (
                  <Tooltip title="Insert dash / separator at end">
                    <IconButton size="small" onClick={() => insertDash(segs.length)} sx={{ p: 0.15, opacity: 0.35, "&:hover": { opacity: 1, bgcolor: "action.hover" } }}><AddIcon sx={{ fontSize: 14 }} /></IconButton>
                  </Tooltip>
                )}
              </Paper>
              <Stack direction="row" gap={1} flexWrap="wrap" sx={{ mt: 1 }}>
                <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={() => addSeg({ kind: "text", value: "" })}>Text</Button>
                <Button size="small" variant="outlined" onClick={() => addSeg({ kind: "text", value: "-" })}>– Dash</Button>
                <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={() => addSeg({ kind: "year" })}>Year</Button>
                <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={() => addSeg({ kind: "month" })}>Month</Button>
                <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={() => addSeg({ kind: "day" })}>Day</Button>
                <Button size="small" variant="outlined" color="info" startIcon={<AddIcon />} onClick={() => addSeg({ kind: "doc" })}>Doc Code</Button>
                <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={() => addSeg({ kind: "serial", pad: 4 })}>Number</Button>
              </Stack>
            </Box>

            <Box sx={{ p: 1.5, borderRadius: 1, bgcolor: (t) => alpha(t.palette.primary.main, 0.06) }}>
              <Typography variant="caption" sx={{ color: "text.secondary" }}>This becomes</Typography>
              <Typography sx={{ fontFamily: "monospace", fontWeight: 700 }}>{preview || "—"}</Typography>
            </Box>

            <Stack direction="row" gap={2} alignItems="center">
              <TextField select label="Reset number" size="small" sx={{ width: 160 }} value={resetPolicy} onChange={(e) => setResetPolicy(e.target.value)}>
                {RESETS.map((r) => (<MenuItem key={r.value} value={r.value}>{r.label}</MenuItem>))}
              </TextField>
              <TextField label="Start at" size="small" type="number" sx={{ width: 120 }} value={nextSerial} onChange={(e) => setNextSerial(Number(e.target.value))} />
              <Stack direction="row" alignItems="center" gap={0.5}>
                <Switch checked={isActive} onChange={(_, v) => setIsActive(v)} />
                <Typography variant="body2">Active</Typography>
              </Stack>
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
          <Button variant="contained" onClick={save} disabled={saving} startIcon={saving ? <CircularProgress size={14} color="inherit" /> : undefined}>{editing ? "Save" : "Add"}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
