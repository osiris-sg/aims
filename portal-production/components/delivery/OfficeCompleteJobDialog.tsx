"use client";

import React, { useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import SignatureCanvas from "react-signature-canvas";
import { request } from "@/helpers/request";
import { uploadFile } from "@/helpers/fileUploader";

type Mode = "signature" | "stamped_do" | "sign_link";

/** A product line still waiting for its unit(s): one in-stock unit is picked per quantity. */
export type ProductSlot = { assetId: string; name: string; quantity: number };
type Unit = { id: string; sku: string; serialNumber: string | null; assetId: string };

/**
 * Manual order flow (enableManualOrderFlow, 2026-11-12): the office finishes a
 * job in the dashboard, one of three ways.
 *   Customer signs here   the customer signs on this screen; done at once.
 *   Upload signed DO      the signed / stamped DO (PDF or photo); done at once.
 *   Send sign link        done now, the customer signs the DO by link later;
 *                         the order is invoiced once they have signed.
 */
export default function OfficeCompleteJobDialog({
  open,
  onClose,
  deliveryId,
  jobLabel,
  defaultName,
  productSlots = [],
  onDone,
  doId,
}: {
  open: boolean;
  onClose: () => void;
  deliveryId: string;
  jobLabel: string;
  defaultName?: string | null;
  /** Product lines with no unit yet: the office picks the units here (same stock path as the field app). */
  productSlots?: ProductSlot[];
  onDone: (mode: Mode) => void;
  /** DO first (manual flow, 2026-11-13): complete this DO, which has no job (deliveryId is unused then). */
  doId?: string;
}) {
  const isDo = !!doId;
  const { getToken } = useAuth();
  const sig = useRef<SignatureCanvas>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<Mode>("signature");
  const [name, setName] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One pick per unit needed, keyed "<assetId>#<n>".
  // Keyed by the slot's position too: one product can sit on several slots (one row per unit).
  const sameProduct = (assetId: string) => productSlots.filter((x) => x.assetId === assetId).reduce((t, x) => t + Math.max(1, x.quantity), 0);
  const needed = productSlots.flatMap((s, i) =>
    Array.from({ length: Math.max(1, s.quantity) }, (_, n) => ({ key: `${i}:${s.assetId}#${n}`, assetId: s.assetId, name: s.name })),
  ).map((n, idx, all) => {
    const total = sameProduct(n.assetId);
    const nth = all.slice(0, idx + 1).filter((x) => x.assetId === n.assetId).length;
    return { key: n.key, assetId: n.assetId, label: total > 1 ? `${n.name} (${nth} of ${total})` : n.name };
  });
  const [units, setUnits] = useState<Unit[] | null>(null);
  const [picked, setPicked] = useState<Record<string, Unit | null>>({});

  useEffect(() => {
    if (!open || !needed.length) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const res: any = await request({ path: "/inventories/by-status", method: "POST" }, { status: "instock" }, token);
        const rows: any[] = Array.isArray(res?.data ?? res) ? (res?.data ?? res) : [];
        if (!cancelled) setUnits(rows.map((u) => ({ id: u.id, sku: u.sku, serialNumber: u.serialNumber ?? null, assetId: u.assetId ?? u.asset?.id })));
      } catch {
        if (!cancelled) setUnits([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, needed.length, getToken]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    setPicked({});
    setMode("signature");
    setName(defaultName ?? "");
    setFiles([]);
    setError(null);
  }, [open, defaultName]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const body: Record<string, any> = { mode };
      if (needed.length) {
        const missing = needed.filter((n) => !picked[n.key]);
        if (missing.length) throw new Error(`Pick a unit for ${missing.map((m) => m.label).join(", ")}`);
        body.units = needed.map((n) => ({ assetId: n.assetId, inventoryId: picked[n.key]!.id }));
      }
      if (mode === "signature") {
        if (!sig.current || sig.current.isEmpty()) throw new Error("Ask the customer to sign in the box");
        if (!name.trim()) throw new Error("Enter the customer's name");
        body.signature = sig.current.getTrimmedCanvas().toDataURL("image/png");
        body.recipientName = name.trim();
      }
      if (mode === "stamped_do") {
        if (!files.length) throw new Error("Choose the signed or stamped DO");
        const keys: string[] = [];
        for (const f of files) keys.push((await uploadFile({ file: f, folder: isDo ? `documents/${doId}/signed-do` : `deliveries/${deliveryId}/signed-do`, token })).fileKey);
        body.files = keys;
      }
      const res: any = await request({ path: isDo ? `/deliveries/order-dos/${doId}/complete` : `/deliveries/${deliveryId}/office-complete`, method: "POST" }, body, token);
      if (res?.success === false) throw new Error(res.message || (isDo ? "Could not complete the DO" : "Could not complete the job"));
      onDone(mode);
    } catch (e: any) {
      setError(e?.message ?? (isDo ? "Could not complete the DO" : "Could not complete the job"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Complete {jobLabel}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {isDo ? "The DO is completed. Choose how the customer signs off." : "Every item on the job is marked as done and the DO is completed. Choose how the customer signs off."}
        </Typography>
        {needed.length > 0 && (
          <Stack spacing={1.25} sx={{ mb: 2 }}>
            <Typography variant="subtitle2">Units delivered</Typography>
            <Typography variant="caption" color="text.secondary">
              Pick the unit for each product line. Stock moves the same way as when a worker scans it in the field app.
            </Typography>
            {needed.map((n) => {
              const taken = new Set(Object.entries(picked).filter(([k, u]) => k !== n.key && u).map(([, u]) => u!.id));
              const options = (units ?? []).filter((u) => u.assetId === n.assetId && !taken.has(u.id));
              return (
                <Autocomplete
                  key={n.key}
                  size="small"
                  loading={units === null}
                  options={options}
                  value={picked[n.key] ?? null}
                  onChange={(_, v) => setPicked((p) => ({ ...p, [n.key]: v }))}
                  getOptionLabel={(u) => (u.serialNumber ? `${u.sku} · S/No ${u.serialNumber}` : u.sku)}
                  isOptionEqualToValue={(a, b) => a.id === b.id}
                  noOptionsText="No unit of this product in stock"
                  renderInput={(params) => <TextField {...params} label={n.label} />}
                />
              );
            })}
          </Stack>
        )}
        <ToggleButtonGroup exclusive fullWidth size="small" value={mode} onChange={(_, v) => v && setMode(v)} sx={{ mb: 2 }}>
          <ToggleButton value="signature">Customer signs here</ToggleButton>
          <ToggleButton value="stamped_do">Upload signed DO</ToggleButton>
          <ToggleButton value="sign_link">Send sign link</ToggleButton>
        </ToggleButtonGroup>

        {mode === "signature" && (
          <Stack spacing={1.5}>
            <TextField size="small" label="Customer name" value={name} onChange={(e) => setName(e.target.value)} fullWidth />
            <Box sx={{ position: "relative", border: 1, borderColor: "divider", borderRadius: 1, bgcolor: "#fff" }}>
              <SignatureCanvas ref={sig} penColor="#111" canvasProps={{ width: 520, height: 160, style: { width: "100%", height: 160, display: "block" } }} />
              <Button size="small" onClick={() => sig.current?.clear()} sx={{ position: "absolute", right: 4, bottom: 2, color: "text.secondary" }}>
                Clear
              </Button>
            </Box>
            <Typography variant="caption" color="text.secondary">
              The signature prints on the DO. The job is done and the order is invoiced once every job is done.
            </Typography>
          </Stack>
        )}

        {mode === "stamped_do" && (
          <Stack spacing={1}>
            <input
              ref={fileInput}
              type="file"
              hidden
              multiple
              accept="application/pdf,image/jpeg,image/png,image/webp"
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            />
            <Button variant="outlined" onClick={() => fileInput.current?.click()}>
              {files.length ? `${files.length} file${files.length === 1 ? "" : "s"} chosen` : "Choose the signed / stamped DO"}
            </Button>
            {files.map((f) => (
              <Typography key={f.name} variant="caption" color="text.secondary">
                {f.name}
              </Typography>
            ))}
            <Typography variant="caption" color="text.secondary">
              The file is attached to the DO. The job is done and the order is invoiced once every job is done.
            </Typography>
          </Stack>
        )}

        {mode === "sign_link" && (
          <Alert severity="info" variant="outlined">
            {isDo
              ? "The DO waits for the customer. Copy the DO sign link (shown next) and send it. When the customer signs, the DO is completed and the order is invoiced once every DO is done."
              : "The job is marked done now. Then copy the customer sign link on this page and send it. When the customer signs the DO, the job is verified and the order is invoiced once every job is done."}
          </Alert>
        )}

        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="contained" onClick={() => void submit()} disabled={busy} startIcon={busy ? <CircularProgress size={16} color="inherit" /> : undefined} data-tour="office-complete-job-submit">
          {isDo ? "Complete DO" : "Complete job"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
