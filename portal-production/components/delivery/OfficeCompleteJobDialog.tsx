"use client";

import React, { useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import {
  Alert,
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
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  deliveryId: string;
  jobLabel: string;
  defaultName?: string | null;
  onDone: (mode: Mode) => void;
}) {
  const { getToken } = useAuth();
  const sig = useRef<SignatureCanvas>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<Mode>("signature");
  const [name, setName] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
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
      if (mode === "signature") {
        if (!sig.current || sig.current.isEmpty()) throw new Error("Ask the customer to sign in the box");
        if (!name.trim()) throw new Error("Enter the customer's name");
        body.signature = sig.current.getTrimmedCanvas().toDataURL("image/png");
        body.recipientName = name.trim();
      }
      if (mode === "stamped_do") {
        if (!files.length) throw new Error("Choose the signed or stamped DO");
        const keys: string[] = [];
        for (const f of files) keys.push((await uploadFile({ file: f, folder: `deliveries/${deliveryId}/signed-do`, token })).fileKey);
        body.files = keys;
      }
      const res: any = await request({ path: `/deliveries/${deliveryId}/office-complete`, method: "POST" }, body, token);
      if (res?.success === false) throw new Error(res.message || "Could not complete the job");
      onDone(mode);
    } catch (e: any) {
      setError(e?.message ?? "Could not complete the job");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Complete {jobLabel}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Every item on the job is marked as done and the DO is completed. Choose how the customer signs off.
        </Typography>
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
            The job is marked done now. Then copy the customer sign link on this page and send it. When the customer signs the DO, the job is verified and the order is
            invoiced once every job is done.
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
          Complete job
        </Button>
      </DialogActions>
    </Dialog>
  );
}
