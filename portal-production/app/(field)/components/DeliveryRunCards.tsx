"use client";

import React, { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from "@mui/material";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import AssignmentReturnIcon from "@mui/icons-material/AssignmentReturn";
import PlaceIcon from "@mui/icons-material/Place";
import { RunSummary, completedRunTime, itemLabel, relTime } from "../lib/deliveryLists";
import { StatusChip } from "./fieldUi";
import type { FieldTone } from "@/themes/fieldTheme";

/**
 * Run cards shared by the Deliveries home (/scan) and the standalone list
 * pages. Each card only RENDERS; the caller owns the tap target so both
 * surfaces route identically.
 */

const STATUS_CHIP: Record<string, { label: string; tone: FieldTone }> = {
  in_progress: { label: "In progress", tone: "warn" },
  delivered: { label: "Delivered", tone: "info" },
  completed: { label: "Completed", tone: "good" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

/** Run number: card title, 15 / w700. */
function RunNo({ n }: { n: React.ReactNode }) {
  return (
    <Typography sx={{ fontSize: 15, fontWeight: 700, letterSpacing: "-0.01em" }}>
      #{n}
    </Typography>
  );
}

/**
 * The run's drop site, from Delivery.siteAddress: the office-typed delivery
 * address (else the project name) written at scheduling time, the same string
 * the draft DO's "Deliver To" is built from. Hidden when empty or when it would
 * only repeat the context line already on the card (a run with no typed address
 * falls back to its project name). Clamped to 2 lines.
 */
function SiteAddress({ run, context, mt }: { run: RunSummary; context: string | null; mt?: number }) {
  const addr = run.siteAddress?.trim();
  if (!addr || addr === context?.trim()) return null;
  return (
    <Stack direction="row" spacing={0.5} alignItems="flex-start" sx={{ mt }}>
      <PlaceIcon fontSize="small" color="action" sx={{ mt: "1px" }} />
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
          wordBreak: "break-word",
        }}
      >
        {addr}
      </Typography>
    </Stack>
  );
}

const fmtScheduled = (d: string | null | undefined) =>
  d
    ? new Date(d).toLocaleString("en-GB", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
    : "No date";

/**
 * Office-scheduled run (Pending).
 *
 * OUTBOUND: tapping the card or "Start this delivery" opens the run's
 * walk-through. That is READ-ONLY NAVIGATION; the run is claimed by the first
 * scan, not here.
 *
 * RETURN (2026-10-21, run #82): "Start this return" CLAIMS the run (the caller
 * does it, via claimReturnRun) and opens its walk: scan each unit -> condition
 * photos -> collect, free-typed lines through their own page, then the one
 * customer signature. A return cannot be claimed by its first scan the way a
 * delivery is (its lines are unit-bound or free-typed, never open slots), and a
 * run whose only line is free-typed has nothing to scan at all. Tapping the
 * card body opens "View details" instead, so a stray tap never claims a run.
 */
export function ScheduledRunCard({
  run: r,
  onStart,
  onViewDo,
}: {
  run: RunSummary;
  onStart: () => void | Promise<void>;
  onViewDo: (assetId: string, docId: string) => void;
}) {
  const isReturn = r.direction === "RETURN";
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  // Deliveries: show still-open (unbound) slots; a bound item means someone
  // already started picking it up. Returns are unit-bound from birth, so their
  // manifest IS the units to collect.
  const open = r.items.filter((i) => !i.inventoryId);
  const rows = isReturn ? r.items : open.length ? open : r.items;
  const context = r.project?.name ?? r.customer?.name ?? r.siteAddress ?? null;
  const viewDo = !isReturn && r.document?.id && r.items[0]?.assetId ? { assetId: r.items[0].assetId, docId: r.document.id } : null;
  // Where a return is collected FROM: the run's siteAddress (the office copies
  // it from the project's address when the return is scheduled). Hidden when
  // the office left none.
  const collectFrom = isReturn ? r.siteAddress?.trim() || null : null;

  const start = async () => {
    if (starting) return;
    setStartError(null);
    setStarting(true);
    try {
      await onStart();
    } catch (e: any) {
      setStartError(e?.message ?? "Could not start");
    } finally {
      setStarting(false);
    }
  };

  const itemRows = (
    <Stack spacing={0.25} sx={{ mt: 0.5 }}>
      {rows.map((i) => {
        // Same precedence the walk-through uses (description first). A
        // unit-backed line shows its serial; an office slot with no unit
        // scanned in yet shows the asset name alone.
        const label = i.description || "Item";
        const suffix = i.sku ? ` · ${i.sku}` : "";
        return (
          <Typography key={i.id} variant="body2">
            • {label}
            {i.quantity && i.quantity > 1 ? ` ×${i.quantity}` : ""}
            {suffix && (
              <Typography component="span" variant="body2" color="text.secondary">
                {suffix}
              </Typography>
            )}
          </Typography>
        );
      })}
    </Stack>
  );

  const body = (
    <CardContent sx={{ display: "flex", flexDirection: "column", gap: 0.75, pb: 1 }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ flexWrap: "wrap", rowGap: 0.5 }}>
        <RunNo n={r.deliveryNumber} />
        <StatusChip tone={isReturn ? "warn" : "neutral"} label={isReturn ? "RETURN" : "DELIVERY"} />
        <Box sx={{ flexGrow: 1 }} />
        <StatusChip tone="info" label={fmtScheduled(r.scheduledFor)} />
      </Stack>
      {context && (
        <Typography variant="body2" color="text.secondary">
          {context}
        </Typography>
      )}
      {isReturn ? (
        collectFrom && (
          <Stack direction="row" spacing={0.5} alignItems="flex-start">
            <PlaceIcon fontSize="small" color="action" sx={{ mt: "1px" }} />
            <Typography variant="body2" sx={{ wordBreak: "break-word" }}>
              <Typography component="span" variant="body2" color="text.secondary">
                Collect from:{" "}
              </Typography>
              {collectFrom}
            </Typography>
          </Stack>
        )
      ) : (
        <SiteAddress run={r} context={context} />
      )}
      {r.document?.poNo && (
        <Typography variant="body2">
          <b>PO No.:</b> {r.document.poNo}
        </Typography>
      )}
      {itemRows}
    </CardContent>
  );

  return (
    <Card variant="outlined">
      <CardActionArea onClick={isReturn ? () => setDetailsOpen(true) : start}>{body}</CardActionArea>
      <Stack direction="row" spacing={1} sx={{ px: 1.75, pb: 1.75, flexWrap: "wrap", rowGap: 1 }}>
        {/* OUTBOUND: navigation only, the run is NOT claimed until the first
            scan lands in claimScheduled. RETURN: the caller claims the run. */}
        <Button
          variant="contained"
          startIcon={starting ? <CircularProgress size={18} color="inherit" /> : isReturn ? <AssignmentReturnIcon /> : <PlayArrowIcon />}
          sx={{ minHeight: 44, flex: 1 }}
          onClick={start}
          disabled={starting}
        >
          {isReturn ? "Start this return" : "Start this delivery"}
        </Button>
        {isReturn && (
          <Button variant="text" sx={{ minHeight: 44 }} onClick={() => setDetailsOpen(true)}>
            View details
          </Button>
        )}
        {viewDo && (
          <Button
            variant="text"
            sx={{ minHeight: 44 }}
            onClick={() => onViewDo(viewDo.assetId, viewDo.docId)}
          >
            View full DO
          </Button>
        )}
      </Stack>
      {startError && (
        <Alert severity="error" sx={{ mx: 1.75, mb: 1.75 }} onClose={() => setStartError(null)}>
          {startError}
        </Alert>
      )}

      {isReturn && (
        <Dialog open={detailsOpen} onClose={() => setDetailsOpen(false)} fullWidth maxWidth="xs">
          <DialogTitle>Return #{r.deliveryNumber}</DialogTitle>
          <DialogContent>
            <Stack spacing={1.25}>
              <DetailRow label="Scheduled" value={fmtScheduled(r.scheduledFor)} />
              <DetailRow label="Customer" value={r.customer?.name} />
              <DetailRow label="Project" value={r.project?.name} />
              <DetailRow label="Collect from" value={collectFrom} />
              <DetailRow label="Notes" value={r.notes?.trim() || null} />
              <Box>
                <Typography variant="caption" color="text.secondary">
                  To collect ({r.items.length})
                </Typography>
                {itemRows}
              </Box>
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button variant="text" onClick={() => setDetailsOpen(false)}>
              Close
            </Button>
            <Button
              variant="contained"
              startIcon={starting ? <CircularProgress size={18} color="inherit" /> : <AssignmentReturnIcon />}
              disabled={starting}
              onClick={() => {
                setDetailsOpen(false);
                void start();
              }}
            >
              Start this return
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </Card>
  );
}

/** One label / value line in the run details dialog; hidden when empty. */
function DetailRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" display="block">
        {label}
      </Typography>
      <Typography variant="body2" sx={{ wordBreak: "break-word" }}>
        {value}
      </Typography>
    </Box>
  );
}

/** A run the rider started and hasn't finished (In progress). */
export function InProgressRunCard({
  run: r,
  opening,
  disabled,
  onOpen,
}: {
  run: RunSummary;
  opening: boolean;
  disabled: boolean;
  onOpen: () => void;
}) {
  const chip = STATUS_CHIP[r.status] ?? { label: String(r.status ?? "").replace(/_/g, " "), tone: "neutral" as const };
  // Customer/project only when present: pre-ack standalone runs have neither,
  // so the item label + time carry the identity instead.
  const context = r.project?.name ?? r.customer?.name ?? r.document?.name ?? null;
  const done = r.items.filter((i) => i.deliveryStatus === "completed").length;
  return (
    <Card variant="outlined">
      <CardActionArea onClick={onOpen} disabled={disabled}>
        <CardContent>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
            <RunNo n={r.deliveryNumber} />
            <StatusChip label={chip.label.toUpperCase()} tone={chip.tone} />
            <Box sx={{ flexGrow: 1 }} />
            {opening ? (
              <CircularProgress size={16} />
            ) : (
              <Typography variant="caption" color="text.secondary">
                {relTime(r.startedAt ?? r.createdAt)}
              </Typography>
            )}
          </Stack>
          <Typography variant="body2" fontWeight={600} noWrap>
            {itemLabel(r.items)}
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block">
            {`${done} of ${r.items.length} delivered`}
            {context ? ` · ${context}` : ""}
          </Typography>
          <SiteAddress run={r} context={context} mt={0.5} />
        </CardContent>
      </CardActionArea>
    </Card>
  );
}

/** A run the rider completed in the last 7 days (Completed / reprint). */
export function CompletedRunCard({ run: r, onOpen }: { run: RunSummary; onOpen: () => void }) {
  const context = r.project?.name ?? r.customer?.name ?? r.document?.name ?? null;
  return (
    <Card variant="outlined">
      <CardActionArea onClick={onOpen}>
        <CardContent>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
            <RunNo n={r.deliveryNumber} />
            <StatusChip label="COMPLETED" tone="good" />
            <Box sx={{ flexGrow: 1 }} />
            <Typography variant="caption" color="text.secondary">
              {relTime(completedRunTime(r))}
            </Typography>
          </Stack>
          <Typography variant="body2" fontWeight={600} noWrap>
            {itemLabel(r.items)}
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block">
            {r.items.length} item{r.items.length === 1 ? "" : "s"}
            {context ? ` · ${context}` : ""}
          </Typography>
        </CardContent>
      </CardActionArea>
    </Card>
  );
}
