"use client";

// Project quest (CIEL 09-12): the 10-step client journey, gamified. Steps run
// IN ORDER — only the first pending step is actionable. Completing needs proof
// where the step requires it; skipping always needs a reason. Points accrue
// per step once guru defines the structure (0 until then).

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, LinearProgress, Link, Paper, Stack, TextField, Tooltip, Typography,
} from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import RedoIcon from "@mui/icons-material/RemoveDone";
import SkipNextIcon from "@mui/icons-material/SkipNext";
import LockIcon from "@mui/icons-material/LockOutlined";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import EmojiEventsIcon from "@mui/icons-material/EmojiEventsOutlined";
import { toast } from "react-toastify";
import { fmtDate, useIdProjectApi, type QuestStep } from "./api";

const readFile = (f: File): Promise<string> =>
  new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = rej;
    r.readAsDataURL(f);
  });

export default function QuestTab({ projectId }: { projectId: string }) {
  const api = useIdProjectApi();
  const [steps, setSteps] = useState<QuestStep[]>([]);
  const [progress, setProgress] = useState<{ done: number; skipped: number; total: number; points: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [completeFor, setCompleteFor] = useState<QuestStep | null>(null);
  const [skipFor, setSkipFor] = useState<QuestStep | null>(null);
  const [notes, setNotes] = useState("");
  const [reason, setReason] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.questSteps(projectId);
      setSteps(r.steps);
      setProgress(r.progress);
    } catch (e: any) {
      toast.error(e.message || "Failed to load the quest");
    } finally {
      setLoading(false);
    }
  }, [api, projectId]);
  useEffect(() => {
    load();
  }, [load]);

  const activeNo = steps.find((s) => s.status === "pending")?.stepNo ?? null;
  const lastClosedNo = [...steps].reverse().find((s) => s.status !== "pending")?.stepNo ?? null;

  const complete = async () => {
    if (!completeFor) return;
    if (completeFor.requiresProof && !file) {
      toast.warn("This step needs proof — attach a photo, video or document");
      return;
    }
    setBusy(true);
    try {
      const proof = file ? await readFile(file) : undefined;
      await api.completeQuestStep(completeFor.id, { proof, filename: file?.name, notes: notes.trim() || undefined });
      toast.success(`Step ${completeFor.stepNo} done ✓`);
      setCompleteFor(null);
      setNotes("");
      setFile(null);
      load();
    } catch (e: any) {
      toast.error(e.message || "Could not complete the step");
    } finally {
      setBusy(false);
    }
  };

  const skip = async () => {
    if (!skipFor) return;
    setBusy(true);
    try {
      await api.skipQuestStep(skipFor.id, reason.trim());
      setSkipFor(null);
      setReason("");
      load();
    } catch (e: any) {
      toast.error(e.message || "Could not skip the step");
    } finally {
      setBusy(false);
    }
  };

  const undo = async (s: QuestStep) => {
    setBusy(true);
    try {
      await api.resetQuestStep(s.id);
      load();
    } catch (e: any) {
      toast.error(e.message || "Could not undo");
    } finally {
      setBusy(false);
    }
  };

  if (loading)
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
        <CircularProgress />
      </Box>
    );

  const closed = (progress?.done || 0) + (progress?.skipped || 0);
  const pct = progress?.total ? (closed / progress.total) * 100 : 0;

  return (
    <Box sx={{ width: "100%", minWidth: 0 }}>
      {/* progress header */}
      <Paper variant="outlined" sx={{ p: 1.75, borderRadius: 2, mb: 2 }}>
        <Stack direction="row" alignItems="center" spacing={2}>
          <EmojiEventsIcon color={pct >= 100 ? "success" : "action"} />
          <Box sx={{ flex: 1 }}>
            <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                Project quest · {closed}/{progress?.total ?? 10} steps
              </Typography>
              <Typography variant="caption" sx={{ color: "text.secondary" }}>
                {progress?.done ?? 0} done · {progress?.skipped ?? 0} skipped
              </Typography>
            </Stack>
            <LinearProgress variant="determinate" value={pct} sx={{ height: 8, borderRadius: 4 }} color={pct >= 100 ? "success" : "primary"} />
          </Box>
          <Tooltip title="Points structure coming — steps will earn points once management sets the rules">
            <Chip size="small" variant="outlined" label={`${progress?.points ?? 0} pts`} />
          </Tooltip>
        </Stack>
      </Paper>

      {/* steps */}
      <Stack spacing={1}>
        {steps.map((s) => {
          const isActive = s.stepNo === activeNo;
          const isLocked = s.status === "pending" && !isActive;
          const canUndo = s.status !== "pending" && s.stepNo === lastClosedNo;
          return (
            <Paper
              key={s.id}
              variant="outlined"
              sx={{
                p: 1.5,
                borderRadius: 2,
                borderColor: isActive ? "primary.main" : "divider",
                opacity: isLocked ? 0.55 : 1,
                transition: "border-color .15s, opacity .15s",
              }}
            >
              <Stack direction="row" spacing={1.5} alignItems="flex-start">
                <Box sx={{ width: 30, textAlign: "center", pt: 0.25 }}>
                  {s.status === "done" ? (
                    <CheckCircleIcon color="success" fontSize="small" />
                  ) : s.status === "skipped" ? (
                    <SkipNextIcon fontSize="small" sx={{ color: "text.disabled" }} />
                  ) : isLocked ? (
                    <LockIcon fontSize="small" sx={{ color: "text.disabled" }} />
                  ) : (
                    <Typography sx={{ fontWeight: 800, color: "primary.main" }}>{s.stepNo}</Typography>
                  )}
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                    <Typography variant="body2" sx={{ fontWeight: 700, textDecoration: s.status === "skipped" ? "line-through" : "none" }}>
                      Step {s.stepNo} · {s.title}
                    </Typography>
                    {s.paymentTag && <Chip size="small" color="warning" variant="outlined" label={`collect ${s.paymentTag}`} sx={{ height: 20 }} />}
                    {s.requiresProof && s.status === "pending" && <Chip size="small" variant="outlined" label="proof needed" sx={{ height: 20, color: "text.secondary" }} />}
                  </Stack>
                  <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }}>
                    {s.description}
                  </Typography>
                  {s.status !== "pending" && (
                    <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mt: 0.5 }} flexWrap="wrap" useFlexGap>
                      <Typography variant="caption" sx={{ color: s.status === "done" ? "success.main" : "text.disabled", fontWeight: 600 }}>
                        {s.status === "done" ? "Done" : "Skipped"}
                        {s.completedByName ? ` · ${s.completedByName}` : ""}
                        {s.completedAt ? ` · ${fmtDate(s.completedAt)}` : ""}
                      </Typography>
                      {s.proofUrl && (
                        <Link href={s.proofUrl} target="_blank" rel="noreferrer" variant="caption" sx={{ display: "inline-flex", alignItems: "center", gap: 0.25 }}>
                          <AttachFileIcon sx={{ fontSize: 13 }} /> proof
                        </Link>
                      )}
                      {s.notes && (
                        <Typography variant="caption" sx={{ color: "text.secondary", fontStyle: "italic" }}>
                          {s.notes}
                        </Typography>
                      )}
                      {s.skipReason && (
                        <Typography variant="caption" sx={{ color: "warning.main", fontStyle: "italic" }}>
                          why: {s.skipReason}
                        </Typography>
                      )}
                    </Stack>
                  )}
                </Box>
                <Stack direction="row" spacing={0.5} sx={{ flexShrink: 0 }}>
                  {isActive && (
                    <>
                      <Button size="small" variant="contained" disabled={busy} onClick={() => setCompleteFor(s)} sx={{ textTransform: "none" }}>
                        Complete
                      </Button>
                      <Button size="small" disabled={busy} onClick={() => setSkipFor(s)} sx={{ textTransform: "none", color: "text.secondary" }}>
                        Skip
                      </Button>
                    </>
                  )}
                  {canUndo && (
                    <Tooltip title="Reopen this step">
                      <Button size="small" startIcon={<RedoIcon />} disabled={busy} onClick={() => undo(s)} sx={{ textTransform: "none", color: "text.secondary" }}>
                        Undo
                      </Button>
                    </Tooltip>
                  )}
                </Stack>
              </Stack>
            </Paper>
          );
        })}
      </Stack>

      {/* complete dialog */}
      <Dialog open={!!completeFor} onClose={() => setCompleteFor(null)} maxWidth="xs" fullWidth>
        <DialogTitle>
          Step {completeFor?.stepNo} · {completeFor?.title}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            {completeFor?.requiresProof ? (
              <Alert severity="info" sx={{ py: 0.25 }}>
                This step needs proof — a photo, video or document.
              </Alert>
            ) : (
              <Typography variant="body2" sx={{ color: "text.secondary" }}>
                Proof is optional for this step.
              </Typography>
            )}
            <input ref={fileRef} type="file" accept="image/*,video/mp4,application/pdf" hidden onChange={(e) => setFile(e.target.files?.[0] || null)} />
            <Button variant="outlined" startIcon={<AttachFileIcon />} onClick={() => fileRef.current?.click()} sx={{ textTransform: "none", justifyContent: "flex-start" }}>
              {file ? file.name : "Attach proof"}
            </Button>
            <TextField size="small" label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} multiline minRows={2} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCompleteFor(null)} sx={{ textTransform: "none" }}>
            Cancel
          </Button>
          <Button variant="contained" onClick={complete} disabled={busy} sx={{ textTransform: "none" }}>
            Mark done
          </Button>
        </DialogActions>
      </Dialog>

      {/* skip dialog */}
      <Dialog open={!!skipFor} onClose={() => setSkipFor(null)} maxWidth="xs" fullWidth>
        <DialogTitle>
          Skip step {skipFor?.stepNo} · {skipFor?.title}
        </DialogTitle>
        <DialogContent>
          <TextField autoFocus fullWidth size="small" label="Why is this step being skipped?" value={reason} onChange={(e) => setReason(e.target.value)} multiline minRows={2} sx={{ mt: 0.5 }} helperText="A reason is required — it shows on the step for management" />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSkipFor(null)} sx={{ textTransform: "none" }}>
            Cancel
          </Button>
          <Button variant="contained" color="warning" onClick={skip} disabled={busy || !reason.trim()} sx={{ textTransform: "none" }}>
            Skip step
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
