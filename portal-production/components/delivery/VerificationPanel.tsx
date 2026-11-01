"use client";

import React, { useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from "@mui/material";
import { request } from "@/helpers/request";
import { uploadImage } from "@/helpers/imageUploader";
import { photoSrc } from "@/components/maintenance/ReportPhotos";
import PhotoCaptureField, { CapturedPhoto } from "@/components/delivery/PhotoCaptureField";
import { VERIFICATION_COLOR, VerificationState, completionModeLabel, rejectProblem, verificationLabel } from "@/helpers/wctFinishModes";

/**
 * WCT finish modes (enableWctFinishModes, 2026-11-01): a job's verification
 * block — how it was finished, the stamped-DO photo(s) / note, and the office
 * check. `canDecide` (office) shows Verify / Reject; a rejected job shows the
 * reason and "Send new evidence" (worker or office), which puts it back to
 * "Awaiting verification".
 */
export interface JobVerification {
  id: string;
  deliveryNumber: number;
  completionMode: string | null;
  completionNote: string | null;
  photos: string[];
  verificationState: VerificationState | null;
  verificationNote: string | null;
  verifiedAt: string | null;
  verifiedByName: string | null;
}

export default function VerificationPanel({
  verification: v,
  canDecide,
  onChanged,
}: {
  verification: JobVerification;
  canDecide: boolean;
  onChanged: (next: JobVerification | null) => void;
}) {
  const { getToken } = useAuth();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [resubmitOpen, setResubmitOpen] = useState(false);
  const [photos, setPhotos] = useState<CapturedPhoto[]>([]);
  const [note, setNote] = useState("");

  const call = async (path: string, body: any) => {
    setWorking(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const res = await request({ path, method: "POST" }, body, token);
      if (res?.success === false) throw new Error(res?.message || "Could not save");
      onChanged((res?.data ?? res) as JobVerification);
      return true;
    } catch (e: any) {
      const m = e?.message;
      setError((Array.isArray(m) ? m.join(". ") : m) || "Could not save");
      return false;
    } finally {
      setWorking(false);
    }
  };

  const state = v.verificationState;
  const pendingOrRejected = state === "pending" || state === "rejected";
  return (
    <Box sx={{ border: 1, borderColor: state === "rejected" ? "error.main" : "divider", borderRadius: 1.5, p: 2 }} data-tour="job-verification">
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          Sign-off
        </Typography>
        {state && <Chip size="small" color={VERIFICATION_COLOR[state]} label={verificationLabel(state)} />}
        <Typography variant="body2" color="text.secondary">
          {completionModeLabel(v.completionMode)}
        </Typography>
      </Stack>
      {v.completionNote && (
        <Typography variant="body2" sx={{ mb: 1 }}>
          Note: {v.completionNote}
        </Typography>
      )}
      {v.photos.length > 0 && (
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
          {v.photos.map((k) => (
            <a key={k} href={photoSrc(k)} target="_blank" rel="noopener noreferrer">
              <Box component="img" src={photoSrc(k)} alt="Stamped DO" sx={{ width: 120, height: 120, objectFit: "cover", borderRadius: 1, border: 1, borderColor: "divider" }} />
            </a>
          ))}
        </Stack>
      )}
      {state === "rejected" && v.verificationNote && (
        <Alert severity="error" sx={{ mb: 1 }}>
          Rejected{v.verifiedByName ? ` by ${v.verifiedByName}` : ""}: {v.verificationNote}
        </Alert>
      )}
      {state === "verified" && v.verifiedByName && (
        <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1 }}>
          Verified by {v.verifiedByName}
          {v.verifiedAt ? ` on ${new Date(v.verifiedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Singapore" })}` : ""}
        </Typography>
      )}
      {error && (
        <Alert severity="warning" sx={{ mb: 1 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {pendingOrRejected && (
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {canDecide && (
            <>
              <Button size="small" variant="contained" color="success" disableElevation disabled={working} onClick={() => void call(`/deliveries/${v.id}/verify`, {})}>
                {working ? <CircularProgress size={16} /> : "Verify"}
              </Button>
              {state === "pending" && (
                <Button size="small" variant="outlined" color="error" disabled={working} onClick={() => setRejectOpen(true)}>
                  Reject
                </Button>
              )}
            </>
          )}
          {state === "rejected" && (
            <Button size="small" variant="outlined" disabled={working} onClick={() => setResubmitOpen(true)}>
              Send new evidence
            </Button>
          )}
        </Stack>
      )}

      <Dialog open={rejectOpen} onClose={() => setRejectOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>Reject job #{v.deliveryNumber}</DialogTitle>
        <DialogContent>
          <TextField autoFocus fullWidth multiline minRows={2} label="Reason (the worker sees this)" value={reason} onChange={(e) => setReason(e.target.value)} sx={{ mt: 1 }} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRejectOpen(false)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            disableElevation
            disabled={working}
            onClick={async () => {
              const p = rejectProblem(reason);
              if (p) return setError(p);
              if (await call(`/deliveries/${v.id}/reject`, { reason: reason.trim() })) {
                setRejectOpen(false);
                setReason("");
              }
            }}
          >
            Reject
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={resubmitOpen} onClose={() => setResubmitOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>New evidence for job #{v.deliveryNumber}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <PhotoCaptureField
              label="Photo of the stamped DO"
              photos={photos}
              onChange={setPhotos}
              upload={async (blob) => {
                const token = await getToken();
                return token ? uploadImage({ blob, folderName: "do-stamped", token }) : null;
              }}
              onError={(m) => setError(m || null)}
              onUploadingChange={setWorking}
            />
            <TextField fullWidth multiline minRows={2} label="Note" value={note} onChange={(e) => setNote(e.target.value)} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setResubmitOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            disableElevation
            disabled={working || (!photos.length && !note.trim())}
            onClick={async () => {
              if (await call(`/deliveries/${v.id}/resubmit-evidence`, { photos: photos.map((p) => p.key), note: note.trim() || undefined })) {
                setResubmitOpen(false);
                setPhotos([]);
                setNote("");
              }
            }}
          >
            Send for verification
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
