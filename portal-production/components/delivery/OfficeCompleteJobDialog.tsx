"use client";

import React, { useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { Alert, Autocomplete, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import DrawIcon from "@mui/icons-material/DrawOutlined";
import { request } from "@/helpers/request";
import { uploadFile } from "@/helpers/fileUploader";
import DoSignLinkDialog from "./DoSignLinkDialog";

// "confirm" = completed without a signature; "stamped_do" = the signed copy attached; "sign_link" = sent for signature.
type Mode = "confirm" | "stamped_do" | "sign_link";

/** A product line still waiting for its unit(s): one in-stock unit is picked per quantity. */
export type ProductSlot = { assetId: string; name: string; quantity: number };
type Unit = { id: string; sku: string; serialNumber: string | null; assetId: string };

/**
 * Manual order flow (enableManualOrderFlow): completing a job or a DO in the office. Since 2026-11-25 it mirrors
 * the quotation's Send / Confirm (the 3-tab pop-up "sign here / upload / sign link" is gone):
 *   Send for signature  the quotation's sign link + public sign page, DO version (DoSignLinkDialog). Signing
 *                       completes the DO / job the same way the on-screen signature did.
 *   Confirm             completed now, without a signature (product lines: pick their units first).
 * Opened with initialMode "stamped_do" (the order page's "Attach signed copy", the DO's "Attach signed copy") it
 * attaches the signed copy and completes the DO.
 * The on-screen "Customer signs here" is no longer offered in the office: the field apps keep their own sign-off.
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
  initialMode,
  signDocId,
  signCustomer,
}: {
  open: boolean;
  onClose: () => void;
  deliveryId: string;
  jobLabel: string;
  defaultName?: string | null;
  /** Product lines with no unit yet: the office picks the units here (same stock path as the field app). */
  productSlots?: ProductSlot[];
  onDone: (mode: Mode) => void;
  /** DO first (manual flow, 2026-11-13): complete this DO (deliveryId is unused then; the server uses its job if it has a scheduled one). */
  doId?: string;
  /** "stamped_do": attach the signed copy (the order page's "Attach signed copy", the DO's "Attach signed copy"). */
  initialMode?: "stamped_do" | string;
  /** The DO a job's "Send for signature" signs (its job's DO). Defaults to doId. */
  signDocId?: string | null;
  signCustomer?: { name?: string | null; phone?: string | null; email?: string | null } | null;
}) {
  const isDo = !!doId;
  const attach = initialMode === "stamped_do";
  const { getToken } = useAuth();
  const fileInput = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signOpen, setSignOpen] = useState(false);
  // One pick per unit needed, keyed by the slot's position too: one product can sit on several slots.
  const sameProduct = (assetId: string) => productSlots.filter((x) => x.assetId === assetId).reduce((t, x) => t + Math.max(1, x.quantity), 0);
  const needed = productSlots
    .flatMap((s, i) => Array.from({ length: Math.max(1, s.quantity) }, (_, n) => ({ key: `${i}:${s.assetId}#${n}`, assetId: s.assetId, name: s.name })))
    .map((n, idx, all) => {
      const total = sameProduct(n.assetId);
      const nth = all.slice(0, idx + 1).filter((x) => x.assetId === n.assetId).length;
      return { key: n.key, assetId: n.assetId, label: total > 1 ? `${n.name} (${nth} of ${total})` : n.name };
    });
  const [units, setUnits] = useState<Unit[] | null>(null);
  const [picked, setPicked] = useState<Record<string, Unit | null>>({});
  const signId = signDocId ?? doId ?? null;

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
    setFiles([]);
    setError(null);
    setSignOpen(false);
  }, [open, defaultName, initialMode]);

  const submit = async (mode: "confirm" | "stamped_do") => {
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
      if (mode === "stamped_do") {
        if (!files.length) throw new Error("Choose the signed copy");
        const keys: string[] = [];
        for (const f of files) keys.push((await uploadFile({ file: f, folder: isDo ? `documents/${doId}/signed-do` : `deliveries/${deliveryId}/signed-do`, token })).fileKey);
        body.files = keys;
      }
      const res: any = await request({ path: isDo ? `/deliveries/order-dos/${doId}/complete` : `/deliveries/${deliveryId}/office-complete`, method: "POST", ownError: true }, body, token);
      if (res?.success === false) throw new Error(res.message || (isDo ? "Could not complete the DO" : "Could not complete the job"));
      onDone(mode);
    } catch (e: any) {
      setError(e?.message ?? (isDo ? "Could not complete the DO" : "Could not complete the job"));
    } finally {
      setBusy(false);
    }
  };

  if (signOpen && signId) {
    return <DoSignLinkDialog open documentId={signId} doName={isDo ? jobLabel : null} customer={signCustomer ?? { name: defaultName }} onClose={onClose} />;
  }

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{attach ? `Attach signed copy: ${jobLabel}` : `Complete ${jobLabel}`}</DialogTitle>
      <DialogContent>
        {needed.length > 0 && (
          <Stack spacing={1.25} sx={{ mb: 2, mt: 0.5 }}>
            <Typography variant="subtitle2">Units delivered</Typography>
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

        {attach && (
          <Stack spacing={1} sx={{ mt: 0.5 }}>
            <input ref={fileInput} type="file" hidden multiple accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
            <Button variant="outlined" onClick={() => fileInput.current?.click()}>
              {files.length ? `${files.length} file${files.length === 1 ? "" : "s"} chosen` : "Choose the signed copy"}
            </Button>
            {files.map((f) => (
              <Typography key={f.name} variant="caption" color="text.secondary">
                {f.name}
              </Typography>
            ))}
          </Stack>
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
        {attach ? (
          <Button variant="contained" onClick={() => void submit("stamped_do")} disabled={busy} startIcon={busy ? <CircularProgress size={16} color="inherit" /> : undefined} data-tour="office-complete-attach">
            Attach and complete
          </Button>
        ) : (
          <>
            <Button variant="outlined" startIcon={<DrawIcon />} onClick={() => setSignOpen(true)} disabled={busy || !signId} data-tour="office-complete-send-signature">
              Send for signature
            </Button>
            <Button
              variant="contained"
              color="success"
              onClick={() => void submit("confirm")}
              disabled={busy}
              startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <CheckCircleIcon />}
              data-tour="office-complete-job-submit"
            >
              Confirm
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
