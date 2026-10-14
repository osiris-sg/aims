"use client";

// Detail-page header for a contract or shipment: title, status, subtitle and
// the Complete / Cancel / Reopen actions (each behind a confirm dialog that
// shows the backend's refusal, e.g. the steps still open). Complete stays
// disabled until every non-ongoing step is Done and nothing else blocks it
// (a contract: its open shipments); what is missing is written under the title.

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Box, Button, IconButton, Stack, Typography } from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { toast } from "../_lib/toast";
import type { CurrentStep, RecordStatus, TradeStep } from "../_lib/api";
import { stepLabel } from "../_lib/format";
import { ConfirmDialog, CurrentStepCell, ProgressCell, RecordStatusChip } from "./bits";

type Act = "complete" | "cancel" | "reopen";

export default function RecordHeader({
  kind,
  title,
  status,
  subtitle,
  backHref,
  progress,
  currentStep,
  steps,
  onComplete,
  onCancel,
  onReopen,
  blockers = [],
}: {
  kind: "contract" | "shipment";
  title: string;
  status: RecordStatus;
  subtitle?: React.ReactNode;
  backHref: string;
  progress?: { done: number; total: number };
  /** Shown next to the progress bar ("Current step: 9. …" / "Completed"). */
  currentStep?: CurrentStep;
  /** The record's steps: Complete is enabled only when every non-ongoing one is Done. */
  steps: TradeStep[];
  onComplete: () => Promise<unknown>;
  onCancel: () => Promise<unknown>;
  onReopen: () => Promise<unknown>;
  /** Other things Complete waits for (a contract: "shipment 198GX04822"). */
  blockers?: string[];
}) {
  const router = useRouter();
  const [confirm, setConfirm] = useState<Act | null>(null);

  const text: Record<Act, { title: string; label: string; run: () => Promise<unknown>; done: string | ((result: unknown) => string); destructive?: boolean }> = {
    complete: {
      title: `Complete ${kind} ${title}?`,
      label: `Complete ${kind}`,
      run: onComplete,
      done: `${kind === "contract" ? "Contract" : "Shipment"} completed`,
    },
    cancel: {
      title: `Cancel ${kind} ${title}?`,
      label: `Cancel ${kind}`,
      run: onCancel,
      done: `${kind === "contract" ? "Contract" : "Shipment"} cancelled`,
      destructive: true,
    },
    reopen: {
      title: `Reopen ${kind} ${title}?`,
      label: "Reopen",
      run: onReopen,
      // Reopening a shipment also reopens its completed contract (the API reports it).
      done: (r) => {
        const reopened = (r as { reopenedContract?: string | null } | undefined)?.reopenedContract;
        return reopened ? `Shipment reopened — contract ${reopened} was completed, so it was reopened too` : `${kind === "contract" ? "Contract" : "Shipment"} reopened`;
      },
    },
  };

  const c = confirm ? text[confirm] : null;
  const main = steps.filter((s) => !s.isOngoing).sort((a, b) => a.sortOrder - b.sortOrder);
  const notDone = main.filter((s) => s.status !== "DONE").map((s) => stepLabel(s, main.indexOf(s) + 1));
  const waiting = [...notDone.map((n) => `step ${n}`), ...blockers];

  return (
    <Box sx={{ mb: 2 }}>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ flexWrap: { xs: "wrap", md: "nowrap" }, rowGap: 1 }}>
        <IconButton size="small" aria-label="Back" onClick={() => router.push(backHref)}>
          <ArrowBackIcon fontSize="small" />
        </IconButton>
        <Typography variant="h5" sx={{ fontWeight: 800, wordBreak: "break-word" }}>
          {title}
        </Typography>
        <RecordStatusChip status={status} />
        {progress && <ProgressCell progress={progress} width={100} />}
        {progress && currentStep !== undefined && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, minWidth: 0 }}>
            <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: "nowrap" }}>
              Current step
            </Typography>
            <CurrentStepCell step={currentStep} progress={progress} maxWidth={320} />
          </Box>
        )}
        <Box sx={{ flex: 1 }} />
        {status === "OPEN" ? (
          <>
            <Button variant="outlined" color="error" onClick={() => setConfirm("cancel")}>
              Cancel {kind}
            </Button>
            <Button variant="contained" color={waiting.length ? "inherit" : "success"} disabled={waiting.length > 0} onClick={() => setConfirm("complete")}>
              Complete {kind}
            </Button>
          </>
        ) : (
          <Button variant="contained" onClick={() => setConfirm("reopen")}>
            Reopen
          </Button>
        )}
      </Stack>
      {subtitle && <Box sx={{ mt: 0.75, ml: { xs: 0, md: 5 } }}>{subtitle}</Box>}
      {status === "OPEN" && waiting.length > 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5, ml: { xs: 0, md: 5 } }}>
          To complete the {kind}: finish {waiting.length > 3 ? `${waiting.slice(0, 3).join(", ")} and ${waiting.length - 3} more` : waiting.join(", ")}
        </Typography>
      )}

      <ConfirmDialog
        open={!!c}
        title={c?.title ?? ""}
        confirmLabel={c?.label}
        destructive={c?.destructive}
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          const result = await c!.run();
          toast.success(typeof c!.done === "function" ? c!.done(result) : c!.done);
        }}
      />
    </Box>
  );
}
