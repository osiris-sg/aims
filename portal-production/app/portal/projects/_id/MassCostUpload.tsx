"use client";

// Mass invoice upload (guru 2026-10-02): drop many photos/PDFs — or a whole
// .zip — and they extract in the background (2 at a time). As soon as the
// first results are ready the review pane opens: supplier/amount editable,
// project pre-matched by the invoice's site address (same scorer as the
// WhatsApp agent), Confirm files the cost and the pane rolls to the next one
// while the rest keep extracting.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert, Autocomplete, Box, Button, Chip, CircularProgress, Dialog, DialogActions,
  DialogContent, DialogTitle, LinearProgress, Stack, TextField, Typography,
} from "@mui/material";
import UploadFileIcon from "@mui/icons-material/UploadFileOutlined";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import { toast } from "react-toastify";
import { useIdProjectApi } from "./api";

type QItem = {
  key: string;
  name: string;
  dataUri?: string;
  status: "reading" | "queued" | "extracting" | "ready" | "saving" | "done" | "skipped" | "failed";
  error?: string;
  extract?: any;
  // editable review fields
  supplierName?: string;
  invoiceNo?: string;
  date?: string;
  amount?: string;
  description?: string;
  projectId?: string | null;
};

const EXTRACT_CONCURRENCY = 2;

export default function MassCostUpload({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const api = useIdProjectApi();
  const [items, setItems] = useState<QItem[]>([]);
  const itemsRef = useRef<QItem[]>([]);
  itemsRef.current = items;
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const runningRef = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setItems([]);
    api.list({ page: 1, limit: 100 }).then((r) => setProjects((r.docs || []).map((p: any) => ({ id: p.id, name: p.name })))).catch(() => {});
  }, [open, api]);

  const patchItem = useCallback((key: string, patch: Partial<QItem>) => {
    setItems((ls) => ls.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  }, []);

  // ── background extraction workers ───────────────────────────────────────
  const pump = useCallback(() => {
    while (runningRef.current < EXTRACT_CONCURRENCY) {
      const next = itemsRef.current.find((it) => it.status === "queued" && it.dataUri);
      if (!next) return;
      runningRef.current += 1;
      patchItem(next.key, { status: "extracting" });
      api
        .request<any>(`/projects/costs/extract-any`, { method: "POST", body: JSON.stringify({ file: next.dataUri, filename: next.name }) })
        .then((r) => {
          patchItem(next.key, {
            status: "ready",
            extract: r,
            supplierName: r.supplierName || "",
            invoiceNo: r.invoiceNo || "",
            date: r.date || "",
            amount: r.amount != null ? String(r.amount) : "",
            description: r.description || "",
            projectId: r.matchedProjectId || r.candidates?.[0]?.id || null,
          });
        })
        .catch((e: any) => patchItem(next.key, { status: "failed", error: e.message || "Extraction failed" }))
        .finally(() => {
          runningRef.current -= 1;
          setTimeout(pump, 50);
        });
    }
  }, [api, patchItem]);

  useEffect(() => {
    if (open) pump();
  }, [items.length, open, pump]);

  // ── intake: files + zip expansion ───────────────────────────────────────
  const addFiles = async (files: File[]) => {
    const accepted: Array<{ name: string; blob: Blob }> = [];
    for (const f of files) {
      if (/\.zip$/i.test(f.name)) {
        try {
          const JSZip = (await import("jszip")).default;
          const zip = await JSZip.loadAsync(f);
          for (const entry of Object.values(zip.files)) {
            if ((entry as any).dir) continue;
            if (!/\.(pdf|png|jpe?g|webp)$/i.test(entry.name)) continue;
            const blob = await (entry as any).async("blob");
            accepted.push({ name: entry.name.split("/").pop() || entry.name, blob });
          }
        } catch {
          toast.error(`Couldn't read ${f.name}`);
        }
      } else if (/\.(pdf|png|jpe?g|webp)$/i.test(f.name) || /image|pdf/.test(f.type)) {
        accepted.push({ name: f.name, blob: f });
      }
    }
    if (!accepted.length) return toast.error("No invoices found — PDF, photo or a .zip of them");
    const newItems: QItem[] = accepted.map((a, i) => ({ key: `${Date.now()}-${i}-${a.name}`, name: a.name, status: "reading" }));
    setItems((ls) => [...ls, ...newItems]);
    accepted.forEach((a, i) => {
      const reader = new FileReader();
      const mime = a.blob.type || (/\.pdf$/i.test(a.name) ? "application/pdf" : "image/jpeg");
      reader.onload = () => {
        let uri = String(reader.result || "");
        if (!uri.startsWith("data:") || uri.startsWith("data:application/octet-stream")) uri = uri.replace(/^data:[^;]*/, `data:${mime}`);
        patchItem(newItems[i].key, { dataUri: uri, status: "queued" });
      };
      reader.readAsDataURL(a.blob);
    });
  };

  // ── review: the first ready item ────────────────────────────────────────
  const current = items.find((it) => it.status === "ready");
  const counts = useMemo(() => {
    const c = { total: items.length, done: 0, failed: 0, pending: 0, ready: 0, skipped: 0 };
    for (const it of items) {
      if (it.status === "done") c.done++;
      else if (it.status === "failed") c.failed++;
      else if (it.status === "ready") c.ready++;
      else if (it.status === "skipped") c.skipped++;
      else c.pending++;
    }
    return c;
  }, [items]);

  const confirmCurrent = async () => {
    if (!current?.projectId) return toast.error("Pick a project first");
    patchItem(current.key, { status: "saving" });
    try {
      await api.addCost(current.projectId, {
        supplierName: current.supplierName || null,
        invoiceNo: current.invoiceNo || null,
        date: current.date || null,
        amount: Number(current.amount) || 0,
        description: current.description || current.supplierName || "Invoice",
        attachmentUrl: current.extract?.attachmentUrl || null,
        attachmentKey: current.extract?.attachmentKey || null,
        status: "approved",
        source: "portal",
      });
      patchItem(current.key, { status: "done" });
    } catch (e: any) {
      toast.error(e.message || "Could not save the cost");
      patchItem(current.key, { status: "ready" });
    }
  };

  const allSettled = items.length > 0 && items.every((it) => ["done", "skipped", "failed"].includes(it.status));

  const close = () => {
    if (counts.done > 0) onSaved();
    onClose();
  };

  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="sm" PaperProps={{ sx: { borderRadius: 2 } }}>
      <DialogTitle>Upload supplier invoices</DialogTitle>
      <DialogContent dividers>
        {items.length === 0 ? (
          <Box
            onClick={() => fileInput.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              addFiles(Array.from(e.dataTransfer.files || []));
            }}
            sx={{ border: "2px dashed", borderColor: "divider", borderRadius: 2, p: 5, textAlign: "center", cursor: "pointer", "&:hover": { borderColor: "primary.main" } }}
          >
            <UploadFileIcon sx={{ fontSize: 36, color: "text.secondary" }} />
            <Typography variant="body2" sx={{ mt: 1 }}>
              Drop invoices here — photos, PDFs, or a whole .zip
            </Typography>
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              Each one is read by AI and matched to its project by the site address
            </Typography>
          </Box>
        ) : (
          <Stack spacing={2}>
            <Box>
              <LinearProgress variant="determinate" value={items.length ? ((counts.done + counts.skipped + counts.failed) / items.length) * 100 : 0} sx={{ height: 8, borderRadius: 4 }} />
              <Typography variant="caption" sx={{ color: "text.secondary" }}>
                {counts.done} filed · {counts.ready} ready to confirm · {counts.pending} extracting · {counts.failed} failed {counts.skipped ? `· ${counts.skipped} skipped` : ""} — of {counts.total}
              </Typography>
            </Box>

            {current ? (
              <Box sx={{ border: 1, borderColor: "divider", borderRadius: 2, p: 2 }}>
                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
                  <Chip size="small" label={current.name} sx={{ maxWidth: 260 }} />
                  {current.extract?.siteAddress && (
                    <Typography variant="caption" sx={{ color: "text.secondary", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      📍 {current.extract.siteAddress}
                    </Typography>
                  )}
                </Stack>
                <Stack spacing={1.5}>
                  <Autocomplete
                    size="small"
                    options={projects}
                    getOptionLabel={(o: any) => o.name}
                    value={projects.find((p) => p.id === current.projectId) || null}
                    onChange={(_, v: any) => patchItem(current.key, { projectId: v?.id || null })}
                    renderInput={(p) => <TextField {...p} label="Project" helperText={current.extract?.matchedProjectId ? "Matched by site address — change if wrong" : current.extract?.candidates?.length ? "Best guesses by address — please confirm" : "No address match — pick the project"} />}
                  />
                  <Stack direction="row" spacing={1}>
                    <TextField label="Supplier" size="small" fullWidth value={current.supplierName} onChange={(e) => patchItem(current.key, { supplierName: e.target.value })} />
                    <TextField label="Invoice no." size="small" value={current.invoiceNo} onChange={(e) => patchItem(current.key, { invoiceNo: e.target.value })} sx={{ width: 160 }} />
                  </Stack>
                  <Stack direction="row" spacing={1}>
                    <TextField label="Amount (S$)" size="small" value={current.amount} onChange={(e) => { if (/^[0-9]*\.?[0-9]*$/.test(e.target.value)) patchItem(current.key, { amount: e.target.value }); }} inputProps={{ inputMode: "decimal" }} sx={{ width: 160 }} />
                    <TextField label="Date" size="small" value={current.date} onChange={(e) => patchItem(current.key, { date: e.target.value })} sx={{ width: 160 }} />
                    {current.extract?.attachmentUrl && (
                      <Button size="small" href={current.extract.attachmentUrl} target="_blank" rel="noreferrer" sx={{ textTransform: "none" }}>
                        View file
                      </Button>
                    )}
                  </Stack>
                  <TextField label="Description" size="small" fullWidth multiline minRows={2} value={current.description} onChange={(e) => patchItem(current.key, { description: e.target.value })} />
                  <Stack direction="row" spacing={1} justifyContent="flex-end">
                    <Button size="small" onClick={() => patchItem(current.key, { status: "skipped" })} sx={{ textTransform: "none", color: "text.secondary" }}>
                      Skip
                    </Button>
                    <Button size="small" variant="contained" onClick={confirmCurrent} disabled={!current.projectId || !Number(current.amount)} sx={{ textTransform: "none" }}>
                      Confirm cost → next
                    </Button>
                  </Stack>
                </Stack>
              </Box>
            ) : allSettled ? (
              <Alert icon={<CheckCircleIcon fontSize="inherit" />} severity="success">
                All done — {counts.done} cost{counts.done === 1 ? "" : "s"} filed{counts.failed ? `, ${counts.failed} failed (re-upload those)` : ""}{counts.skipped ? `, ${counts.skipped} skipped` : ""}.
              </Alert>
            ) : (
              <Stack alignItems="center" sx={{ py: 3 }} spacing={1}>
                <CircularProgress size={22} />
                <Typography variant="caption" sx={{ color: "text.secondary" }}>
                  Reading the next invoice…
                </Typography>
              </Stack>
            )}

            {counts.failed > 0 && (
              <Typography variant="caption" sx={{ color: "error.main" }}>
                Failed: {items.filter((i) => i.status === "failed").map((i) => i.name).join(", ")}
              </Typography>
            )}
            <Button size="small" startIcon={<UploadFileIcon />} onClick={() => fileInput.current?.click()} sx={{ alignSelf: "flex-start", textTransform: "none" }}>
              Add more files
            </Button>
          </Stack>
        )}
        <input ref={fileInput} type="file" hidden multiple accept="image/*,application/pdf,.zip" onChange={(e) => { addFiles(Array.from(e.target.files || [])); e.target.value = ""; }} />
      </DialogContent>
      <DialogActions>
        <Button onClick={close} sx={{ textTransform: "none" }}>
          {allSettled || items.length === 0 ? "Close" : "Close (keeps filing nothing — extractions stop)"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
