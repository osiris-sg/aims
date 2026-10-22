"use client";

// Detail-page header for a contract or shipment: title, status, subtitle and
// the Complete / Cancel / Reopen actions in a ⋮ menu (each behind a confirm
// dialog that shows the backend's refusal, e.g. the steps still open). A record
// normally completes itself when its last step is done; manual Complete stays
// disabled until every non-ongoing step is Done and nothing else blocks it
// (a contract: its open shipments); what is missing is written under the title.

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Box, IconButton, ListItemText, Menu, MenuItem, Stack, Typography } from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import { toast } from "../_lib/toast";
import type { CurrentStep, RecordStatus, TradeStep } from "../_lib/api";
import { stepLabel } from "../_lib/format";
import { ConfirmDialog, ProgressCell, RecordStatusChip } from "./bits";
import { headerStepText } from "../_lib/order-focus";

type Act = "complete" | "cancel" | "reopen";

const kindLabel = (k: string) => (k === "contract" ? "Contract" : k === "order" ? "Order" : k === "supplierOrder" ? "Supplier order" : "Shipment");

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
  extraMenu,
  badge,
  blockers = [],
  onActed,
}: {
  kind: "contract" | "shipment" | "order" | "supplierOrder";
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
  /** Round N: more ⋮ items (e.g. "Mark as test" for ADH Managers). */
  extraMenu?: Array<{ label: string; hint?: string; onClick: () => void }>;
  /** Round AB: a small chip after the status (an order's "Unconfirmed"). */
  badge?: React.ReactNode;
  /** Other things Complete waits for (a contract: "shipment 198GX04822"). */
  blockers?: string[];
  /** Called before a manual action runs (so the page can tell it from an auto-complete). */
  onActed?: (act: Act) => void;
}) {
  const router = useRouter();
  const [confirm, setConfirm] = useState<Act | null>(null);
  const [menu, setMenu] = useState<{ left: number; top: number } | null>(null);
  const pick = (a: Act) => {
    setMenu(null);
    setConfirm(a);
  };

  const text: Record<Act, { title: string; label: string; run: () => Promise<unknown>; done: string | ((result: unknown) => string); destructive?: boolean }> = {
    complete: {
      title: `Complete ${kind} ${title}?`,
      label: `Complete ${kind}`,
      run: onComplete,
      done: `${kindLabel(kind)} completed`,
    },
    cancel: {
      title: `Cancel ${kind} ${title}?`,
      label: `Cancel ${kind}`,
      run: onCancel,
      done: `${kindLabel(kind)} cancelled`,
      destructive: true,
    },
    reopen: {
      title: `Reopen ${kind} ${title}?`,
      label: "Reopen",
      run: onReopen,
      // Reopening a shipment also reopens its completed contract (the API reports it).
      done: (r) => {
        const reopened = (r as { reopenedContract?: string | null } | undefined)?.reopenedContract;
        return reopened ? `Shipment reopened — contract ${reopened} was completed, so it was reopened too` : `${kindLabel(kind)} reopened`;
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
        {badge}
        {progress && <ProgressCell progress={progress} width={100} />}
        {progress && currentStep !== undefined && (
          // Round R: "Step 4 · Customer docs" right after the bar — no caption.
          <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 0 }} data-tour="record-current-step">
            {headerStepText(currentStep, progress.total)}
          </Typography>
        )}
        <Box sx={{ flex: 1 }} />
        <IconButton aria-label={`${kind === "contract" ? "Deal" : kindLabel(kind)} actions`} data-tour="deal-actions-menu" onClick={(e) => setMenu({ left: e.clientX, top: e.clientY })}>
          <MoreVertIcon />
        </IconButton>
      </Stack>
      <Menu anchorReference="anchorPosition" anchorPosition={menu ?? undefined} open={!!menu} onClose={() => setMenu(null)}>
        {status === "OPEN" && (
          <MenuItem disabled={waiting.length > 0} onClick={() => pick("complete")}>
            <ListItemText primary={`Complete ${kind}`} secondary={waiting.length ? "Finish the open steps first" : undefined} />
          </MenuItem>
        )}
        {status === "OPEN" && (
          <MenuItem sx={{ color: "error.main" }} onClick={() => pick("cancel")}>
            Cancel {kind}
          </MenuItem>
        )}
        {status !== "OPEN" && <MenuItem onClick={() => pick("reopen")}>Reopen {kind}</MenuItem>}
        {(extraMenu ?? []).map((x) => (
          <MenuItem
            key={x.label}
            onClick={() => {
              setMenu(null);
              x.onClick();
            }}
          >
            <ListItemText primary={x.label} secondary={x.hint} />
          </MenuItem>
        ))}
      </Menu>
      {subtitle && <Box sx={{ mt: 0.75, ml: { xs: 0, md: 5 } }}>{subtitle}</Box>}
      {/* Round R: no "To complete the order: finish step 11 …" line — the ⋮ Complete item says "Finish the open steps first". */}

      <ConfirmDialog
        open={!!c}
        title={c?.title ?? ""}
        confirmLabel={c?.label}
        destructive={c?.destructive}
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          onActed?.(confirm!);
          const result = await c!.run();
          toast.success(typeof c!.done === "function" ? c!.done(result) : c!.done);
        }}
      />
    </Box>
  );
}
