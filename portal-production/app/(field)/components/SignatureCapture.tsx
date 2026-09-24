"use client";

import React, { useCallback, useRef, useState } from "react";
import SignatureCanvas from "react-signature-canvas";
import { Box, Button, CircularProgress, Stack, TextField, Typography } from "@mui/material";

/**
 * THE SIGNATURE PAD PAIR — technician, then client.
 *
 * Lifted verbatim out of the single-report sign screen so the batch screen can
 * reuse it instead of a second signing surface being built beside it. Both
 * callers get the same two steps, the same certification wording, the same
 * client-name field and the same "drawn?" gating, because it is literally the
 * same component. Nothing about the single-report flow changed in the move.
 *
 * The parent owns what happens afterwards (upload + which reports to sign);
 * this owns only the capture and hands back two PNG data URLs and the name.
 */

export interface CapturedSignatures {
  techDataUrl: string;
  clientDataUrl: string;
  clientName: string;
}

export default function SignatureCapture({
  initialClientName = "",
  submitLabel = "Sign and finish",
  submitting = false,
  onComplete,
  onBackFromTech,
}: {
  initialClientName?: string;
  submitLabel?: string;
  submitting?: boolean;
  onComplete: (captured: CapturedSignatures) => void;
  /** Optional: rendered as a "Back" on the FIRST step (the client step has its own). */
  onBackFromTech?: () => void;
}) {
  const [step, setStep] = useState<"tech" | "client">("tech");
  const techRef = useRef<SignatureCanvas>(null);
  const clientRef = useRef<SignatureCanvas>(null);
  const [techUrl, setTechUrl] = useState<string | null>(null);
  const [techDrawn, setTechDrawn] = useState(false);
  const [clientDrawn, setClientDrawn] = useState(false);
  const [clientName, setClientName] = useState(initialClientName);

  // Read the pad DIRECTLY rather than trusting a state flag set in the same
  // tick — the same race that once rejected a client signature while it was
  // visible on screen (2026-09-23). The drawn flags gate the BUTTON; the pad
  // itself is the source of truth at the moment of submit.
  const finish = useCallback(() => {
    if (!techUrl) { setStep("tech"); return; }
    if (!clientRef.current || clientRef.current.isEmpty()) return;
    onComplete({
      techDataUrl: techUrl,
      clientDataUrl: clientRef.current.getTrimmedCanvas().toDataURL("image/png"),
      clientName,
    });
  }, [techUrl, clientName, onComplete]);

  if (step === "tech") {
    return (
      <Stack spacing={1.5}>
        <Typography variant="body2" fontWeight={600}>Service technician signature</Typography>
        <Box sx={{ border: "1px dashed", borderColor: "divider", borderRadius: 1, touchAction: "none" }}>
          <SignatureCanvas
            ref={techRef}
            penColor="black"
            onEnd={() => setTechDrawn(true)}
            canvasProps={{ width: 360, height: 200, style: { width: "100%", height: 200 } }}
          />
        </Box>
        <Stack direction="row" spacing={1}>
          <Button size="small" onClick={() => { techRef.current?.clear(); setTechDrawn(false); }}>Clear</Button>
          {onBackFromTech && <Button size="small" onClick={onBackFromTech}>Back</Button>}
        </Stack>
        <Button
          variant="contained"
          disabled={!techDrawn}
          onClick={() => {
            if (!techRef.current || techRef.current.isEmpty()) return;
            setTechUrl(techRef.current.getTrimmedCanvas().toDataURL("image/png"));
            setStep("client");
          }}
          sx={{ minHeight: 48 }}
        >
          Next
        </Button>
      </Stack>
    );
  }

  return (
    <Stack spacing={1.5}>
      <Typography variant="body2" sx={{ lineHeight: 1.5 }}>
        I / WE, the undersigned, certify that the above services are satisfied &amp; have
        examined the said machines are in good and proper condition.
      </Typography>
      <TextField label="Client name" value={clientName} onChange={(e) => setClientName(e.target.value)} fullWidth />
      <Box sx={{ border: "1px dashed", borderColor: "divider", borderRadius: 1, touchAction: "none" }}>
        <SignatureCanvas
          ref={clientRef}
          penColor="black"
          onEnd={() => setClientDrawn(true)}
          canvasProps={{ width: 360, height: 200, style: { width: "100%", height: 200 } }}
        />
      </Box>
      <Stack direction="row" spacing={1}>
        <Button size="small" onClick={() => { clientRef.current?.clear(); setClientDrawn(false); }}>Clear</Button>
        <Button size="small" onClick={() => setStep("tech")}>Back</Button>
      </Stack>
      <Button
        variant="contained"
        disabled={!clientDrawn || submitting}
        onClick={finish}
        sx={{ minHeight: 48 }}
      >
        {submitting ? <CircularProgress size={20} color="inherit" /> : submitLabel}
      </Button>
    </Stack>
  );
}
