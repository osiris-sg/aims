"use client";

// Add / edit one costing-ledger row. "Upload invoice" sends the photo/PDF to
// the API, which stores it and AI-extracts supplier, invoice no, date and
// amount into the form for the user to confirm.

import React, { useEffect, useRef, useState } from "react";
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Grid, IconButton, LinearProgress, MenuItem, Stack, TextField, Typography } from "@mui/material";
import UploadFileIcon from "@mui/icons-material/UploadFileOutlined";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import ClearIcon from "@mui/icons-material/Close";
import { toast } from "react-toastify";
import { useIdProjectApi, type Cost } from "./api";

interface Props {
  open: boolean;
  projectId: string;
  sections: Array<{ id: string; letter: string | null; title: string }>;
  editing: Cost | null;
  onClose: () => void;
  onSaved: () => void;
}

type Form = { date: string; supplierName: string; description: string; invoiceNo: string; amount: string; sectionId: string; notes: string; attachmentUrl: string; attachmentKey: string; status: string };
const today = () => new Date().toISOString().slice(0, 10);
const blank = (): Form => ({ date: today(), supplierName: "", description: "", invoiceNo: "", amount: "", sectionId: "", notes: "", attachmentUrl: "", attachmentKey: "", status: "approved" });

export default function CostDialog({ open, projectId, sections, editing, onClose, onSaved }: Props) {
  const api = useIdProjectApi();
  const [form, setForm] = useState<Form>(blank());
  const [saving, setSaving] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [extractNote, setExtractNote] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setExtractNote(null);
    setForm(
      editing
        ? {
            date: editing.date ? editing.date.slice(0, 10) : today(),
            supplierName: editing.supplierName || "",
            description: editing.description || "",
            invoiceNo: editing.invoiceNo || "",
            amount: editing.amount != null ? String(editing.amount) : "",
            sectionId: editing.sectionId || "",
            notes: editing.notes || "",
            attachmentUrl: editing.attachmentUrl || "",
            attachmentKey: editing.attachmentKey || "",
            status: editing.status || "approved",
          }
        : blank(),
    );
  }, [open, editing]);

  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));

  const onFile = async (file: File) => {
    if (file.size > 12 * 1024 * 1024) {
      toast.error("File too large (max 12 MB)");
      return;
    }
    setExtracting(true);
    setExtractNote(null);
    try {
      const dataUrl: string = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result));
        r.onerror = () => rej(new Error("Could not read file"));
        r.readAsDataURL(file);
      });
      const x = await api.extractCost(projectId, dataUrl, file.name);
      set({
        attachmentUrl: x.attachmentUrl || "",
        attachmentKey: x.attachmentKey || "",
        supplierName: form.supplierName || x.supplierName || "",
        invoiceNo: form.invoiceNo || x.invoiceNo || "",
        date: x.date || form.date,
        amount: form.amount || (x.amount != null ? String(x.amount) : ""),
        description: form.description || x.description || "",
      });
      setExtractNote(x.extracted ? "Details read from the invoice — please check them before saving." : "Attached. Could not read the invoice automatically; fill in the details.");
    } catch (e: any) {
      toast.error(e.message || "Upload failed");
    } finally {
      setExtracting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const submit = async () => {
    if (!form.description.trim() || !(Number(form.amount) > 0)) {
      toast.error("Description and an amount above zero are required");
      return;
    }
    setSaving(true);
    const body = {
      date: form.date || null,
      supplierName: form.supplierName || null,
      description: form.description.trim(),
      invoiceNo: form.invoiceNo || null,
      amount: Number(form.amount),
      sectionId: form.sectionId || null,
      notes: form.notes || null,
      attachmentUrl: form.attachmentUrl || null,
      attachmentKey: form.attachmentKey || null,
      status: form.status,
      source: form.attachmentKey ? "extract" : "portal",
    };
    try {
      if (editing) await api.updateCost(editing.id, body);
      else await api.addCost(projectId, body);
      toast.success(editing ? "Cost updated" : "Cost added");
      onSaved();
      onClose();
    } catch (e: any) {
      toast.error(e.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" PaperProps={{ sx: { borderRadius: 2 } }}>
      <DialogTitle>{editing ? "Edit cost" : "Add cost"}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1.5}>
          <Box sx={{ p: 1.5, border: 1, borderColor: "divider", borderStyle: "dashed", borderRadius: 1.5, bgcolor: "action.hover" }}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Button size="small" variant="outlined" startIcon={<UploadFileIcon />} onClick={() => fileRef.current?.click()} disabled={extracting} sx={{ textTransform: "none" }}>
                {form.attachmentUrl ? "Replace invoice" : "Upload supplier invoice"}
              </Button>
              <input ref={fileRef} type="file" hidden accept="image/*,application/pdf" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
              {form.attachmentUrl && (
                <>
                  <Button size="small" endIcon={<OpenInNewIcon />} href={form.attachmentUrl} target="_blank" rel="noreferrer" sx={{ textTransform: "none" }}>
                    View attachment
                  </Button>
                  <IconButton size="small" onClick={() => set({ attachmentUrl: "", attachmentKey: "" })}>
                    <ClearIcon fontSize="small" />
                  </IconButton>
                </>
              )}
              <Box sx={{ flex: 1 }} />
              <Typography variant="caption" sx={{ color: "text.secondary" }}>
                photo or PDF · details are read automatically
              </Typography>
            </Stack>
            {extracting && <LinearProgress sx={{ mt: 1 }} />}
            {extractNote && (
              <Alert severity="info" sx={{ mt: 1, py: 0 }}>
                {extractNote}
              </Alert>
            )}
          </Box>
          <Grid container spacing={1.5}>
            <Grid item xs={6}>
              <TextField label="Date" type="date" size="small" fullWidth InputLabelProps={{ shrink: true }} value={form.date} onChange={(e) => set({ date: e.target.value })} />
            </Grid>
            <Grid item xs={6}>
              <TextField label="Amount (S$)" size="small" fullWidth value={form.amount} onChange={(e) => set({ amount: e.target.value })} inputProps={{ inputMode: "decimal" }} />
            </Grid>
            <Grid item xs={7}>
              <TextField label="Subcontractor / supplier" size="small" fullWidth value={form.supplierName} onChange={(e) => set({ supplierName: e.target.value })} />
            </Grid>
            <Grid item xs={5}>
              <TextField label="Invoice no." size="small" fullWidth value={form.invoiceNo} onChange={(e) => set({ invoiceNo: e.target.value })} />
            </Grid>
            <Grid item xs={12}>
              <TextField label="Description" size="small" fullWidth multiline minRows={2} value={form.description} onChange={(e) => set({ description: e.target.value })} />
            </Grid>
            <Grid item xs={7}>
              <TextField select label="Trade section (for the quote tally)" size="small" fullWidth value={form.sectionId} onChange={(e) => set({ sectionId: e.target.value })}>
                <MenuItem value="">— none —</MenuItem>
                {sections.map((s) => (
                  <MenuItem key={s.id} value={s.id}>
                    {s.letter} · {s.title}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid item xs={5}>
              <TextField select label="Status" size="small" fullWidth value={form.status} onChange={(e) => set({ status: e.target.value })}>
                <MenuItem value="approved">Approved</MenuItem>
                <MenuItem value="pending">Pending approval</MenuItem>
                <MenuItem value="rejected">Rejected</MenuItem>
              </TextField>
            </Grid>
            <Grid item xs={12}>
              <TextField label="Notes" size="small" fullWidth value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
            </Grid>
          </Grid>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={saving || extracting} onClick={submit}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
