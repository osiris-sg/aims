"use client";

// Variation Order editor (CIEL 09-01): one main quotation per project — every
// change after signing is a VO. Mirrors their VO sheet: Additional Items and
// Removal of Items (amount or Complimentary), a live consolidation panel
// (latest quantum + additions − removals = new quantum, collected, balance),
// Print in the sheet layout, and Confirm which locks the VO and adds its net
// to the contract sum as a `vo` milestone.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert, Box, Button, Checkbox, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, Divider, IconButton, Stack, TextField, Tooltip, Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/DeleteOutline";
import PrintIcon from "@mui/icons-material/PrintOutlined";
import CheckCircleIcon from "@mui/icons-material/CheckCircleOutline";
import { toast } from "react-toastify";
import { money, useIdProjectApi, type Summary } from "./api";

type VoLine = { id: string; description: string; amount: number | null; complimentary: boolean };
const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
const sum = (list: VoLine[]) => list.reduce((s, l) => s + (l.complimentary ? 0 : Number(l.amount) || 0), 0);

function LineList({ title, lines, readOnly, onChange }: { title: string; lines: VoLine[]; readOnly: boolean; onChange: (next: VoLine[]) => void }) {
  return (
    <Box sx={{ mb: 2 }}>
      <Stack direction="row" alignItems="center" sx={{ mb: 0.5 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, flex: 1 }}>
          {title}
        </Typography>
        <Typography variant="body2" sx={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
          {money(sum(lines))}
        </Typography>
      </Stack>
      <Stack spacing={0.75}>
        {lines.map((l, i) => (
          <Stack key={l.id} direction="row" spacing={1} alignItems="flex-start">
            <Typography variant="body2" sx={{ width: 20, textAlign: "right", pt: 1, color: "text.secondary" }}>
              {i + 1}
            </Typography>
            <TextField size="small" fullWidth multiline minRows={1} placeholder="Describe the change…" value={l.description} disabled={readOnly} onChange={(e) => onChange(lines.map((x) => (x.id === l.id ? { ...x, description: e.target.value } : x)))} />
            <TextField
              size="small"
              placeholder="0.00"
              value={l.complimentary ? "" : l.amount ?? ""}
              disabled={readOnly || l.complimentary}
              onChange={(e) => onChange(lines.map((x) => (x.id === l.id ? { ...x, amount: e.target.value === "" ? null : Number(e.target.value) || 0 } : x)))}
              inputProps={{ inputMode: "decimal", style: { textAlign: "right", width: 84 } }}
            />
            <Tooltip title="Complimentary (no charge)">
              <Checkbox size="small" checked={l.complimentary} disabled={readOnly} onChange={(e) => onChange(lines.map((x) => (x.id === l.id ? { ...x, complimentary: e.target.checked, amount: e.target.checked ? null : x.amount } : x)))} sx={{ mt: 0.25 }} />
            </Tooltip>
            {!readOnly && (
              <IconButton size="small" onClick={() => onChange(lines.filter((x) => x.id !== l.id))} sx={{ color: "text.disabled", "&:hover": { color: "error.main" }, mt: 0.25 }}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            )}
          </Stack>
        ))}
      </Stack>
      {!readOnly && (
        <Button size="small" startIcon={<AddIcon />} onClick={() => onChange([...lines, { id: newId(), description: "", amount: null, complimentary: false }])} sx={{ textTransform: "none", mt: 0.5, color: "text.secondary" }}>
          Add line
        </Button>
      )}
    </Box>
  );
}

export default function VoDialog({ docId, summary, onClose, onChanged }: { docId: string | null; summary: Summary; onClose: () => void; onChanged: () => void }) {
  const api = useIdProjectApi();
  const [doc, setDoc] = useState<any | null>(null);
  const [additions, setAdditions] = useState<VoLine[]>([]);
  const [removals, setRemovals] = useState<VoLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!docId) return;
    setDoc(null);
    api
      .getDocument(docId)
      .then((d) => {
        setDoc(d);
        const norm = (list: any[]): VoLine[] => (Array.isArray(list) ? list : []).map((l) => ({ id: l.id || newId(), description: l.description || "", amount: l.amount ?? null, complimentary: !!l.complimentary }));
        setAdditions(norm(d?.config?.vo?.additions));
        setRemovals(norm(d?.config?.vo?.removals));
        setDirty(false);
      })
      .catch((e) => toast.error(e.message || "Failed to load VO"));
  }, [api, docId]);

  const readOnly = doc?.status === "confirmed";
  const addTotal = sum(additions);
  const remTotal = sum(removals);
  const net = addTotal - remTotal;
  // This VO's milestone doesn't exist until Confirm, so contractTotal is the
  // "latest revised quantum" for a draft; once confirmed, use the snapshot.
  const cons = readOnly && doc?.config?.consolidation ? doc.config.consolidation : {
    previousQuantum: summary.totals.contractTotal,
    additions: addTotal,
    removals: remTotal,
    newQuantum: summary.totals.contractTotal + net,
    collected: summary.totals.collected,
    balance: summary.totals.contractTotal + net - summary.totals.collected,
  };

  const buildConfig = useCallback(() => ({
    ...(doc?.config || {}),
    vo: { ...(doc?.config?.vo || {}), additions, removals },
    consolidation: cons,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [doc, additions, removals, addTotal, remTotal]);

  const save = async (): Promise<boolean> => {
    if (!doc) return false;
    try {
      const res = await api.saveDocument({ id: doc.id, type: doc.type, version: doc.version, config: buildConfig() });
      setDoc((d: any) => (d ? { ...d, version: typeof res?.version === "number" ? res.version : (d.version || 0) + 1, config: buildConfig() } : d));
      setDirty(false);
      return true;
    } catch (e: any) {
      toast.error(e.message || "Save failed");
      return false;
    }
  };

  const confirm = async () => {
    if (!doc) return;
    if (!additions.length && !removals.length) {
      toast.warn("Add at least one line before confirming");
      return;
    }
    setBusy(true);
    try {
      if (dirty && !(await save())) return;
      const r = await api.confirmVo(doc.id);
      toast.success(`${doc.name || "VO"} confirmed — contract is now S$ ${money(r.newQuantum)}`);
      onChanged();
      onClose();
    } catch (e: any) {
      toast.error(e.message || "Confirm failed");
    } finally {
      setBusy(false);
    }
  };

  const print = async () => {
    if (!doc) return;
    try {
      if (dirty && !readOnly) await save();
      const { html } = await api.getDocHtml(doc.id);
      const f = document.createElement("iframe");
      f.style.position = "fixed";
      f.style.width = "0";
      f.style.height = "0";
      f.style.border = "0";
      document.body.appendChild(f);
      f.srcdoc = html;
      f.onload = () => {
        f.contentWindow?.print();
        setTimeout(() => document.body.removeChild(f), 60000);
      };
    } catch (e: any) {
      toast.error(e.message || "Print failed");
    }
  };

  const K = ({ k, v, strong }: { k: string; v: React.ReactNode; strong?: boolean }) => (
    <Stack direction="row" justifyContent="space-between" sx={{ py: 0.25 }}>
      <Typography variant="body2" sx={{ color: strong ? "text.primary" : "text.secondary", fontWeight: strong ? 700 : 400 }}>{k}</Typography>
      <Typography variant="body2" sx={{ fontWeight: strong ? 800 : 600, fontVariantNumeric: "tabular-nums" }}>{v}</Typography>
    </Stack>
  );

  return (
    <Dialog open={!!docId} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        {doc?.name || "Variation order"}
        {readOnly && <Chip size="small" color="primary" variant="outlined" label="Confirmed" />}
        <Box sx={{ flex: 1 }} />
        <Button size="small" variant="outlined" startIcon={<PrintIcon />} onClick={print} sx={{ textTransform: "none" }}>
          Print / PDF
        </Button>
      </DialogTitle>
      <DialogContent dividers>
        {!doc ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
            <CircularProgress />
          </Box>
        ) : (
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "minmax(0,1fr) 260px" }, gap: 2.5 }}>
            <Box sx={{ minWidth: 0 }}>
              {readOnly && <Alert severity="info" sx={{ mb: 1.5 }}>Confirmed VOs are locked — raise another VO for further changes.</Alert>}
              <LineList title="Additional Items" lines={additions} readOnly={readOnly} onChange={(n) => { setAdditions(n); setDirty(true); }} />
              <LineList title="Removal of Items" lines={removals} readOnly={readOnly} onChange={(n) => { setRemovals(n); setDirty(true); }} />
            </Box>
            <Box>
              <Typography variant="overline" sx={{ color: "text.secondary" }}>Consolidation</Typography>
              <K k="Latest quantum" v={money(cons.previousQuantum)} />
              <K k="Additional items" v={money(cons.additions)} />
              <K k="Deducted items" v={`(${money(cons.removals)})`} />
              <Divider sx={{ my: 0.5 }} />
              <K k="New quantum" v={`S$ ${money(cons.newQuantum)}`} strong />
              <K k="Collected to date" v={money(cons.collected)} />
              <K k="Balance payable" v={`S$ ${money(cons.balance)}`} strong />
              {!readOnly && (
                <Typography variant="caption" sx={{ color: "text.disabled", display: "block", mt: 1 }}>
                  Confirm adds the net {money(net)} to the contract sum as a VO line in Payments.
                </Typography>
              )}
            </Box>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} sx={{ textTransform: "none" }}>Close</Button>
        {doc && !readOnly && (
          <>
            <Button onClick={() => save().then((ok) => ok && toast.success("Saved"))} disabled={busy || !dirty} sx={{ textTransform: "none" }}>
              Save draft
            </Button>
            <Button variant="contained" startIcon={<CheckCircleIcon />} onClick={confirm} disabled={busy} sx={{ textTransform: "none" }}>
              Confirm VO
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
