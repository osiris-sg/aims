"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  Radio,
  RadioGroup,
  Stack,
  Step,
  StepLabel,
  Stepper,
  TextField,
  Typography,
  alpha,
} from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import LockIcon from "@mui/icons-material/Lock";
import CloseIcon from "@mui/icons-material/Close";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import Link from "next/link";
import { toast } from "react-toastify";
import { useAccountingApi } from "./api";

type CloseType = "MONTH_END" | "YEAR_END";

type PreflightItem = {
  key: string;
  label: string;
  status: "pass" | "warn" | "fail";
  detail?: string;
  count?: number;
  action?: { label: string; link: string };
};

type Preflight = {
  cutOffDate: string;
  alreadyLockedThrough: string | null;
  canClose: boolean;
  items: PreflightItem[];
};

type RunResult = {
  success: boolean;
  type: CloseType;
  lockedThrough: string;
  yearEndJournalEntryId: string | null;
};

const today = () => new Date().toISOString().slice(0, 10);
// End of last month — sensible default for Month-End Close.
const endOfLastMonth = () => {
  const d = new Date();
  const last = new Date(d.getFullYear(), d.getMonth(), 0);
  return last.toISOString().slice(0, 10);
};

export default function CloseWizardDialog({
  open,
  onClose,
  onCompleted,
  defaultCutOffDate,
  defaultType = "MONTH_END",
}: {
  open: boolean;
  onClose: () => void;
  onCompleted?: (result: RunResult) => void;
  defaultCutOffDate?: string;
  defaultType?: CloseType;
}) {
  const { request } = useAccountingApi();
  const [step, setStep] = useState(0); // 0: config, 1: preflight, 2: review, 3: done
  const [type, setType] = useState<CloseType>(defaultType);
  const [cutOffDate, setCutOffDate] = useState<string>(defaultCutOffDate || endOfLastMonth());
  const [preflight, setPreflight] = useState<Preflight | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [skipWarnings, setSkipWarnings] = useState(false);

  useEffect(() => {
    if (open) {
      // Reset on open
      setStep(0);
      setType(defaultType);
      setCutOffDate(defaultCutOffDate || endOfLastMonth());
      setPreflight(null);
      setResult(null);
      setSkipWarnings(false);
    }
  }, [open, defaultCutOffDate, defaultType]);

  const runPreflight = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ cutOffDate });
      const res = await request<Preflight>(`/close/preflight?${params.toString()}`);
      setPreflight(res);
      setStep(1);
    } catch (e: any) {
      toast.error(e?.message || "Preflight failed");
    } finally {
      setLoading(false);
    }
  }, [cutOffDate, request]);

  const executeClose = useCallback(async () => {
    setRunning(true);
    try {
      const res = await request<RunResult>("/close/run", {
        method: "POST",
        body: JSON.stringify({ cutOffDate, type, skipWarnings }),
      });
      setResult(res);
      setStep(3);
      toast.success(`${type === "YEAR_END" ? "Year" : "Period"} closed through ${new Date(res.lockedThrough).toLocaleDateString()}`);
      onCompleted?.(res);
    } catch (e: any) {
      toast.error(e?.message || "Close failed");
    } finally {
      setRunning(false);
    }
  }, [cutOffDate, type, skipWarnings, request, onCompleted]);

  const warningCount = preflight?.items.filter((i) => i.status === "warn").length ?? 0;
  const failCount = preflight?.items.filter((i) => i.status === "fail").length ?? 0;
  const canProceed = !!preflight?.canClose && (warningCount === 0 || skipWarnings);

  return (
    <Dialog open={open} onClose={() => !running && onClose()} fullWidth maxWidth="md">
      <DialogTitle>
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Stack direction="row" alignItems="center" gap={1}>
            <LockIcon sx={{ color: "primary.main" }} />
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              Smart Close Wizard
            </Typography>
          </Stack>
          <IconButton onClick={onClose} size="small" disabled={running}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Stack>
      </DialogTitle>

      <DialogContent dividers>
        <Stepper activeStep={step} sx={{ mb: 3 }}>
          <Step>
            <StepLabel>Configure</StepLabel>
          </Step>
          <Step>
            <StepLabel>Preflight</StepLabel>
          </Step>
          <Step>
            <StepLabel>Confirm & Close</StepLabel>
          </Step>
          <Step>
            <StepLabel>Done</StepLabel>
          </Step>
        </Stepper>

        {/* Step 0: Configure */}
        {step === 0 && (
          <Stack gap={3} sx={{ maxWidth: 480 }}>
            <Box>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                Close Type
              </Typography>
              <RadioGroup value={type} onChange={(e) => setType(e.target.value as CloseType)}>
                <FormControlLabel
                  value="MONTH_END"
                  control={<Radio size="small" />}
                  label={
                    <Box>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        Month-End Close
                      </Typography>
                      <Typography variant="caption" sx={{ color: "text.secondary" }}>
                        Locks the period — no further postings allowed on or before the cut-off date.
                      </Typography>
                    </Box>
                  }
                />
                <FormControlLabel
                  value="YEAR_END"
                  control={<Radio size="small" />}
                  label={
                    <Box>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        Year-End Close
                      </Typography>
                      <Typography variant="caption" sx={{ color: "text.secondary" }}>
                        Posts a rollover entry that zeros all P&L accounts to Retained Earnings, then locks the period.
                      </Typography>
                    </Box>
                  }
                />
              </RadioGroup>
            </Box>

            <TextField
              size="small"
              type="date"
              label="Cut-Off Date"
              InputLabelProps={{ shrink: true }}
              value={cutOffDate}
              onChange={(e) => setCutOffDate(e.target.value)}
              helperText={
                type === "MONTH_END"
                  ? "All entries on or before this date will be locked."
                  : "Closes the year through this date. Default: end of last month."
              }
            />
          </Stack>
        )}

        {/* Step 1: Preflight results */}
        {step === 1 && preflight && (
          <Box>
            <Stack direction="row" gap={2} sx={{ mb: 2 }}>
              <Chip
                size="small"
                variant="outlined"
                color={preflight.canClose ? "success" : "error"}
                label={preflight.canClose ? `Ready to close` : `${failCount} blocker${failCount === 1 ? "" : "s"}`}
                sx={{ fontWeight: 700 }}
              />
              {warningCount > 0 && (
                <Chip
                  size="small"
                  variant="outlined"
                  color="warning"
                  label={`${warningCount} warning${warningCount === 1 ? "" : "s"}`}
                />
              )}
            </Stack>

            <Stack gap={1}>
              {preflight.items.map((item) => (
                <Box
                  key={item.key}
                  sx={{
                    p: 1.5,
                    border: 1,
                    borderColor: "divider",
                    borderRadius: 1.5,
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 1.5,
                  }}
                >
                  <Box
                    sx={{
                      color:
                        item.status === "pass"
                          ? "success.main"
                          : item.status === "warn"
                          ? "warning.main"
                          : "error.main",
                      mt: 0.25,
                      "& svg": { fontSize: "1.25rem" },
                    }}
                  >
                    {item.status === "pass" ? <CheckCircleIcon /> : item.status === "warn" ? <WarningAmberIcon /> : <ErrorOutlineIcon />}
                  </Box>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {item.label}
                    </Typography>
                    {item.detail && (
                      <Typography variant="caption" sx={{ color: "text.secondary", display: "block", mt: 0.25 }}>
                        {item.detail}
                      </Typography>
                    )}
                    {item.action && (
                      <Button
                        component={Link}
                        href={item.action.link}
                        size="small"
                        endIcon={<OpenInNewIcon sx={{ fontSize: "0.875rem !important" }} />}
                        sx={{ mt: 0.5, textTransform: "none", p: 0, minWidth: 0 }}
                      >
                        {item.action.label}
                      </Button>
                    )}
                  </Box>
                </Box>
              ))}
            </Stack>

            {warningCount > 0 && preflight.canClose && (
              <Box
                sx={{
                  mt: 2,
                  p: 1.5,
                  borderRadius: 1.5,
                  bgcolor: (t) => alpha(t.palette.warning.main, 0.08),
                }}
              >
                <FormControlLabel
                  control={
                    <Radio
                      checked={skipWarnings}
                      onClick={() => setSkipWarnings((v) => !v)}
                      size="small"
                    />
                  }
                  label={
                    <Typography variant="body2">
                      <strong>Proceed anyway</strong> — I've reviewed the warnings and want to close.
                    </Typography>
                  }
                />
              </Box>
            )}
          </Box>
        )}

        {/* Step 2: Confirm */}
        {step === 2 && preflight && (
          <Stack gap={2} sx={{ maxWidth: 520 }}>
            <Box
              sx={{
                p: 2,
                borderRadius: 1.5,
                bgcolor: (t) => alpha(t.palette.primary.main, 0.04),
                border: 1,
                borderColor: (t) => alpha(t.palette.primary.main, 0.2),
              }}
            >
              <Typography variant="body2" sx={{ fontWeight: 700, mb: 1 }}>
                You are about to {type === "YEAR_END" ? "close the year" : "close the period"}.
              </Typography>
              <Stack gap={0.5}>
                <Typography variant="body2">
                  <strong>Cut-off date:</strong> {new Date(cutOffDate).toLocaleDateString()}
                </Typography>
                <Typography variant="body2">
                  <strong>Type:</strong>{" "}
                  {type === "YEAR_END"
                    ? "Year-End — posts retained-earnings rollover, then locks"
                    : "Month-End — locks period (no rollover)"}
                </Typography>
                {warningCount > 0 && (
                  <Typography variant="body2" sx={{ color: "warning.main" }}>
                    <strong>{warningCount} warning(s)</strong> acknowledged and skipped.
                  </Typography>
                )}
              </Stack>
            </Box>

            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              After closing, journal entries dated on or before the cut-off will be rejected. An admin
              can unlock via <code>POST /close/unlock</code> if needed.
            </Typography>
          </Stack>
        )}

        {/* Step 3: Done */}
        {step === 3 && result && (
          <Stack alignItems="center" gap={2} sx={{ py: 4 }}>
            <Box
              sx={{
                width: 64,
                height: 64,
                borderRadius: "50%",
                bgcolor: (t) => alpha(t.palette.success.main, 0.12),
                color: "success.main",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <CheckCircleIcon sx={{ fontSize: 36 }} />
            </Box>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              {result.type === "YEAR_END" ? "Year" : "Period"} closed
            </Typography>
            <Typography variant="body2" sx={{ color: "text.secondary", textAlign: "center" }}>
              Locked through <strong>{new Date(result.lockedThrough).toLocaleDateString()}</strong>.
              {result.yearEndJournalEntryId && (
                <>
                  <br />
                  Retained-earnings rollover JE posted.
                </>
              )}
            </Typography>
          </Stack>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2 }}>
        {step === 0 && (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button
              variant="contained"
              onClick={runPreflight}
              disabled={loading || !cutOffDate}
              startIcon={loading ? <CircularProgress size={14} color="inherit" /> : undefined}
            >
              Run Preflight
            </Button>
          </>
        )}
        {step === 1 && preflight && (
          <>
            <Button onClick={() => setStep(0)} disabled={loading}>
              Back
            </Button>
            <Button
              variant="contained"
              onClick={() => setStep(2)}
              disabled={!canProceed}
            >
              {canProceed ? "Continue" : failCount > 0 ? "Fix blockers" : "Acknowledge warnings"}
            </Button>
          </>
        )}
        {step === 2 && (
          <>
            <Button onClick={() => setStep(1)} disabled={running}>
              Back
            </Button>
            <Button
              variant="contained"
              color="primary"
              onClick={executeClose}
              disabled={running}
              startIcon={running ? <CircularProgress size={14} color="inherit" /> : <LockIcon />}
            >
              {running ? "Closing..." : `Close ${type === "YEAR_END" ? "Year" : "Period"}`}
            </Button>
          </>
        )}
        {step === 3 && <Button variant="contained" onClick={onClose}>Done</Button>}
      </DialogActions>
    </Dialog>
  );
}
