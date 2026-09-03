"use client";

// Designer counter-signature (CIEL 09-01): after the client signs, the
// designer adds their own signature to the confirmed LOI. Draw once and tick
// "Save as my signature" — next time it's one tap ("Use saved signature").

import React, { useEffect, useRef, useState } from "react";
import { Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import SignatureCanvas from "react-signature-canvas";
import { toast } from "react-toastify";
import { useIdQuoteApi } from "../_lib/api";

export default function DesignerSignDialog({ open, docId, defaultName, onClose, onSigned }: { open: boolean; docId: string; defaultName: string; onClose: () => void; onSigned: () => void }) {
  const api = useIdQuoteApi();
  const sig = useRef<SignatureCanvas>(null);
  const [name, setName] = useState(defaultName);
  const [saved, setSaved] = useState<string | null>(null);
  const [mode, setMode] = useState<"saved" | "draw">("draw");
  const [saveToProfile, setSaveToProfile] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(defaultName);
    api
      .getOwnProfile()
      .then((p) => {
        setSaved(p?.signatureImage || null);
        setMode(p?.signatureImage ? "saved" : "draw");
      })
      .catch(() => setSaved(null));
  }, [open, defaultName, api]);

  const submit = async () => {
    let image: string | null = null;
    if (mode === "saved") image = saved;
    else if (sig.current && !sig.current.isEmpty()) image = sig.current.getTrimmedCanvas().toDataURL("image/png");
    if (!image) {
      toast.warn("Draw your signature first");
      return;
    }
    setBusy(true);
    try {
      await api.designerSign(docId, { signatureImage: image, name: name.trim() || undefined, saveToProfile: mode === "draw" && saveToProfile });
      toast.success("Signed — your signature now appears on the document");
      onSigned();
      onClose();
    } catch (e: any) {
      toast.error(e.message || "Could not sign");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Sign as designer</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          <TextField size="small" label="Name on the document" value={name} onChange={(e) => setName(e.target.value)} />
          {saved && (
            <ToggleButtonGroup size="small" exclusive value={mode} onChange={(_, v) => v && setMode(v)} fullWidth>
              <ToggleButton value="saved" sx={{ textTransform: "none" }}>
                Use saved signature
              </ToggleButton>
              <ToggleButton value="draw" sx={{ textTransform: "none" }}>
                Draw new
              </ToggleButton>
            </ToggleButtonGroup>
          )}
          {mode === "saved" && saved ? (
            <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1.5, p: 2, textAlign: "center", bgcolor: "#fff" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={saved} alt="Saved signature" style={{ maxHeight: 72, maxWidth: "100%" }} />
            </Box>
          ) : (
            <>
              <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1.5, bgcolor: "#fff", position: "relative" }}>
                <SignatureCanvas ref={sig} penColor="#111" canvasProps={{ width: 380, height: 140, style: { width: "100%", height: 140, display: "block" } }} />
                <Button size="small" onClick={() => sig.current?.clear()} sx={{ position: "absolute", right: 4, bottom: 2, textTransform: "none", color: "text.secondary", fontSize: 11 }}>
                  Clear
                </Button>
              </Box>
              <FormControlLabel control={<Checkbox size="small" checked={saveToProfile} onChange={(e) => setSaveToProfile(e.target.checked)} />} label={<Typography variant="body2">Save as my signature for next time</Typography>} />
            </>
          )}
          <Alert severity="info" sx={{ py: 0.25 }}>
            Your signature is stamped in the "Prepared by" block of the signed document.
          </Alert>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} sx={{ textTransform: "none" }}>
          Cancel
        </Button>
        <Button variant="contained" onClick={submit} disabled={busy} sx={{ textTransform: "none" }}>
          Sign document
        </Button>
      </DialogActions>
    </Dialog>
  );
}
