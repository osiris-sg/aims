"use client";

// Round AL — "Paste tracking": a screenshot or the pasted text of a carrier's tracking page (Wan Hai B/L Data,
// Maersk, RCL, SITC …) is read and compared with the shipment, field by field (AIMS → tracking). Nothing is written
// until Apply; weights / bundles are notes only; a typed ETA is flagged. Wan Hai can't be fetched by AIMS itself
// (their site blocks automated access), so this is the way to bring a tracking page in.

import React, { useEffect, useRef, useState } from "react";
import { Alert, Box, Button, Checkbox, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from "@mui/material";
import ImageIcon from "@mui/icons-material/Image";
import { useQueryClient } from "@tanstack/react-query";
import { useShipmentsApi, type TrackingRead } from "../_lib/api";
import { SHIPMENT_KEYS } from "../_lib/hooks";
import { toast } from "../_lib/toast";

const fmt = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : (v ?? "—"));
const STATUS: Record<string, { label: string; color: "default" | "info" | "warning" | "success" }> = {
  same: { label: "Same", color: "success" },
  new: { label: "New", color: "info" },
  changed: { label: "Changed", color: "warning" },
  note: { label: "Note only", color: "default" },
};

export default function TrackingPasteDialog({ shipmentId, blNumber, open, onClose }: { shipmentId: string; blNumber: string | null; open: boolean; onClose: () => void }) {
  const api = useShipmentsApi();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [read, setRead] = useState<TrackingRead | null>(null);
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setText("");
      setImage(null);
      setPreview(null);
      setRead(null);
      setError(null);
      setTicked({});
    }
  }, [open]);
  useEffect(() => {
    if (!image) return setPreview(null);
    const u = URL.createObjectURL(image);
    setPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [image]);

  const pick = (f: File | null | undefined) => {
    if (!f) return;
    if (!/^image\/(png|jpe?g|webp|gif)$/i.test(f.type)) return setError("The screenshot must be a PNG, JPEG, WebP or GIF image");
    if (f.size > 8 * 1024 * 1024) return setError("The screenshot is larger than 8 MB");
    setError(null);
    setImage(f);
  };
  // Ctrl/Cmd+V of a screenshot straight into the dialog.
  const onPaste = (e: React.ClipboardEvent) => {
    const item = [...e.clipboardData.items].find((i) => i.type.startsWith("image/"));
    if (item) {
      e.preventDefault();
      pick(item.getAsFile());
    }
  };

  const doRead = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.trackingRead(shipmentId, { text: text.trim() || undefined, image });
      setRead(r);
      setTicked(Object.fromEntries(r.rows.map((x) => [x.field, x.suggested && !x.handTyped])));
    } catch (e: any) {
      setError(e?.message || "Could not read the tracking page");
    } finally {
      setBusy(false);
    }
  };
  const fields = read ? read.rows.filter((r) => ticked[r.field] && (r.status === "new" || r.status === "changed")).map((r) => r.field) : [];
  const apply = async () => {
    if (!read || !fields.length) return;
    setBusy(true);
    try {
      const r = await api.trackingApply(read.id, fields);
      toast.success(r.fields.length ? `${read.ref}: ${r.fields.length} field${r.fields.length > 1 ? "s" : ""} updated from the tracking page` : `${read.ref} was already up to date`);
      await Promise.all([qc.invalidateQueries({ queryKey: SHIPMENT_KEYS.shipments }), qc.invalidateQueries({ queryKey: SHIPMENT_KEYS.orders })]);
      onClose();
    } catch (e: any) {
      setError(e?.message || "Could not apply");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="md" fullWidth onPaste={onPaste}>
      <DialogTitle>Paste tracking{blNumber ? ` · B/L ${blNumber}` : ""}</DialogTitle>
      <DialogContent dividers>
        {!read && (
          <Stack spacing={1.5}>
            <Typography variant="body2" color="text.secondary">
              Open the carrier&apos;s tracking page (Track button), then paste its text here or attach / paste (Ctrl+V) a screenshot. AIMS reads it and shows what would change — nothing is saved until you apply.
            </Typography>
            <TextField multiline minRows={7} maxRows={16} fullWidth label="Tracking page text" placeholder={"B/L No. 198GX06523\nWAN HAI 366 / 51  VIZAG  ETD 2026/10/06\nPORT KLANG NORTH PORT  ETA 2026/10/10\nWAN HAI 365 / N046  ETD 2026/10/20\nYOKOHAMA  ETA 2026/11/01"} value={text} onChange={(e) => setText(e.target.value)} disabled={busy} inputProps={{ style: { fontFamily: "monospace", fontSize: 12.5 } }} />
            <Stack direction="row" spacing={1} alignItems="center">
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => pick(e.target.files?.[0])} />
              <Button size="small" variant="outlined" startIcon={<ImageIcon />} onClick={() => fileRef.current?.click()} disabled={busy}>
                {image ? "Change screenshot" : "Attach screenshot"}
              </Button>
              {image && (
                <Chip size="small" label={image.name || "screenshot"} onDelete={() => setImage(null)} />
              )}
            </Stack>
            {preview && <Box component="img" src={preview} alt="Tracking screenshot" sx={{ maxWidth: "100%", maxHeight: 260, objectFit: "contain", border: 1, borderColor: "divider", borderRadius: 1 }} />}
          </Stack>
        )}
        {read && (
          <Stack spacing={1.5}>
            <Typography variant="body2">
              <b>{read.ref}</b> · {read.snapshot.carrier ?? "carrier"} · B/L {read.snapshot.blNumber ?? "—"} {read.bl === "match" ? "✓" : ""} · {read.source === "SCREENSHOT" ? "from a screenshot" : "from pasted text"}
            </Typography>
            {read.snapshot.legs.length > 0 && (
              <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                {read.snapshot.legs.map((l) => `${l.vessel ?? "?"}${l.voyage ? ` / ${l.voyage}` : ""}: ${l.portOfLoading ?? "?"} ${fmt(l.etd)} → ${l.portOfDischarge ?? "?"} ${fmt(l.eta)}`).join("  ·  ")}
              </Typography>
            )}
            {read.snapshot.dropped.length > 0 && <Alert severity="info">Not used (not found in the pasted text): {read.snapshot.dropped.join(", ")}</Alert>}
            <Box sx={{ overflowX: "auto" }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell padding="checkbox" />
                    <TableCell>Field</TableCell>
                    <TableCell>AIMS</TableCell>
                    <TableCell>Tracking</TableCell>
                    <TableCell>Status</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {read.rows.map((r) => {
                    const can = r.status === "new" || r.status === "changed";
                    return (
                      <TableRow key={r.field} hover={can} sx={{ cursor: can ? "pointer" : "default" }} onClick={() => can && setTicked((t) => ({ ...t, [r.field]: !t[r.field] }))}>
                        <TableCell padding="checkbox">
                          <Checkbox size="small" checked={!!ticked[r.field] && can} disabled={!can} onClick={(e) => e.stopPropagation()} onChange={(e) => setTicked((t) => ({ ...t, [r.field]: e.target.checked }))} />
                        </TableCell>
                        <TableCell sx={{ whiteSpace: "nowrap" }}>{r.label}</TableCell>
                        <TableCell sx={{ fontFamily: "monospace", fontSize: 12.5 }}>{fmt(r.aims)}</TableCell>
                        <TableCell sx={{ fontFamily: "monospace", fontSize: 12.5, fontWeight: can ? 600 : 400 }}>{fmt(r.tracking)}</TableCell>
                        <TableCell>
                          <Stack direction="row" spacing={0.5}>
                            <Chip size="small" variant="outlined" label={STATUS[r.status].label} color={STATUS[r.status].color} />
                            {r.handTyped && <Chip size="small" variant="outlined" color="warning" label="Typed by hand" />}
                          </Stack>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Box>
            <Typography variant="caption" color="text.secondary">
              The ETA keeps its history (source: tracking). Weights and bundles come from the B/L / packing list and are never changed here. A typed ETA is unticked — tick it to replace it.
            </Typography>
          </Stack>
        )}
        {error && (
          <Alert severity="error" sx={{ mt: 1.5 }}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        {read ? (
          <>
            <Button onClick={() => setRead(null)} disabled={busy}>
              Back
            </Button>
            <Button variant="contained" onClick={apply} disabled={busy || !fields.length} startIcon={busy ? <CircularProgress size={14} /> : undefined}>
              {fields.length ? `Apply ${fields.length} field${fields.length > 1 ? "s" : ""}` : "Nothing to apply"}
            </Button>
          </>
        ) : (
          <Button variant="contained" onClick={doRead} disabled={busy || (!text.trim() && !image)} startIcon={busy ? <CircularProgress size={14} /> : undefined}>
            Read
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
