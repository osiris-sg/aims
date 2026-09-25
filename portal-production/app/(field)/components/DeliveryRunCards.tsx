"use client";

import React from "react";
import { Box, Button, Card, CardActionArea, CardContent, Chip, CircularProgress, Stack, Typography } from "@mui/material";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PlaceIcon from "@mui/icons-material/Place";
import { RunSummary, completedRunTime, itemLabel, relTime } from "../lib/deliveryLists";

/**
 * Run cards shared by the Deliveries home (/scan) and the standalone list
 * pages. Each card only RENDERS; the caller owns the tap target so both
 * surfaces route identically.
 */

const STATUS_CHIP: Record<string, { label: string; color: "warning" | "info" | "success" | "default" }> = {
  in_progress: { label: "In progress", color: "warning" },
  delivered: { label: "Delivered", color: "info" },
  completed: { label: "Completed", color: "success" },
  cancelled: { label: "Cancelled", color: "default" },
};

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
 * Office-scheduled run (Pending). OUTBOUND runs are enterable: tapping the
 * card or "Start this delivery" opens the run's walk-through. That is READ-ONLY
 * NAVIGATION; the run is claimed by the first scan, not here. RETURN runs stay
 * informational (see scan/deliveries/scheduled for why).
 */
export function ScheduledRunCard({
  run: r,
  onStart,
  onViewDo,
}: {
  run: RunSummary;
  onStart: () => void;
  onViewDo: (assetId: string, docId: string) => void;
}) {
  const isReturn = r.direction === "RETURN";
  // Deliveries: show still-open (unbound) slots; a bound item means someone
  // already started picking it up. Returns are unit-bound from birth, so their
  // manifest IS the units to collect.
  const open = r.items.filter((i) => !i.inventoryId);
  const rows = isReturn ? r.items : open.length ? open : r.items;
  const enterable = !isReturn;
  const context = r.project?.name ?? r.customer?.name ?? r.siteAddress ?? null;
  const viewDo = !isReturn && r.document?.id && r.items[0]?.assetId ? { assetId: r.items[0].assetId, docId: r.document.id } : null;

  const body = (
    <CardContent sx={{ display: "flex", flexDirection: "column", gap: 0.75, pb: enterable || viewDo ? 1 : undefined }}>
      <Stack direction="row" alignItems="center" spacing={1}>
        <Typography variant="subtitle2" fontWeight={700} sx={{ fontFamily: "monospace" }}>
          #{r.deliveryNumber}
        </Typography>
        <Chip size="small" color={isReturn ? "secondary" : "primary"} variant="outlined" label={isReturn ? "Return" : "Delivery"} />
        <Chip size="small" color="primary" label={fmtScheduled(r.scheduledFor)} />
      </Stack>
      {context && (
        <Typography variant="body2" color="text.secondary">
          {context}
        </Typography>
      )}
      <SiteAddress run={r} context={context} />
      {r.document?.poNo && (
        <Typography variant="body2">
          <b>PO No.:</b> {r.document.poNo}
        </Typography>
      )}
      {isReturn && (
        <Typography variant="caption" color="text.secondary">Collect:</Typography>
      )}
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
    </CardContent>
  );

  return (
    <Card variant="outlined" sx={enterable ? { borderColor: "primary.main" } : undefined}>
      {enterable ? <CardActionArea onClick={onStart}>{body}</CardActionArea> : body}
      {(enterable || viewDo) && (
        <Stack direction="row" spacing={1} sx={{ px: 2, pb: 2, flexWrap: "wrap", rowGap: 1 }}>
          {/* Navigation only: the run is NOT claimed until the first scan
              lands in claimScheduled. */}
          {enterable && (
            <Button
              size="small"
              variant="contained"
              startIcon={<PlayArrowIcon />}
              sx={{ textTransform: "none", minHeight: 40 }}
              onClick={onStart}
            >
              Start this delivery
            </Button>
          )}
          {viewDo && (
            <Button
              size="small"
              variant="text"
              sx={{ textTransform: "none", minHeight: 40 }}
              onClick={() => onViewDo(viewDo.assetId, viewDo.docId)}
            >
              View full DO
            </Button>
          )}
        </Stack>
      )}
    </Card>
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
  const chip = STATUS_CHIP[r.status] ?? { label: r.status, color: "default" as const };
  // Customer/project only when present: pre-ack standalone runs have neither,
  // so the item label + time carry the identity instead.
  const context = r.project?.name ?? r.customer?.name ?? r.document?.name ?? null;
  const done = r.items.filter((i) => i.deliveryStatus === "completed").length;
  return (
    <Card variant="outlined">
      <CardActionArea onClick={onOpen} disabled={disabled}>
        <CardContent sx={{ py: 1.75 }}>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
            <Typography variant="subtitle1" fontWeight={700} sx={{ fontFamily: "monospace" }}>
              #{r.deliveryNumber}
            </Typography>
            <Chip size="small" label={chip.label} color={chip.color} />
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
        <CardContent sx={{ py: 1.75 }}>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
            <Typography variant="subtitle1" fontWeight={700} sx={{ fontFamily: "monospace" }}>
              #{r.deliveryNumber}
            </Typography>
            <Chip size="small" label="Completed" color="success" />
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
