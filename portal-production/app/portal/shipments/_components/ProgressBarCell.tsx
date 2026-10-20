"use client";

// The Orders list's progress (round K): a segmented bar, one segment per
// applicable step (N/A hidden), coloured like the pipeline grid — done /
// in progress / overdue / not started — with "Step 7 · Customs documents &
// tax estimate" and "9/14" under it. An order with several shipments shows its
// overall bar; hovering it shows each shipment's own bar (#19-1 8/10, #19-2 6/10).

import React from "react";
import { Box, Stack, Tooltip, Typography } from "@mui/material";
import type { ProgressBar, SegmentState } from "../_lib/api";

const SEG: Record<SegmentState, { color: string; label: string }> = {
  done: { color: "success.main", label: "Done" },
  in_progress: { color: "warning.main", label: "In progress" },
  overdue: { color: "error.main", label: "Overdue" },
  not_started: { color: "action.disabledBackground", label: "Not started" },
};

export function SegmentBar({ bar, height = 8 }: { bar: ProgressBar; height?: number }) {
  if (!bar.total) return null;
  return (
    <Stack direction="row" spacing="2px" sx={{ width: "100%", minWidth: 120 }} data-tour="orders-progress-bar" aria-label={`${bar.done} of ${bar.total} steps done`}>
      {bar.segments.map((s, i) => (
        <Box
          key={`${s.no}-${i}`}
          title={`${s.no ? `${s.no}. ` : ""}${s.title} — ${SEG[s.state].label}`}
          sx={{ flex: 1, height, borderRadius: 0.5, bgcolor: SEG[s.state].color, border: s.state === "not_started" ? 1 : 0, borderColor: "divider" }}
        />
      ))}
    </Stack>
  );
}

type Shipment = { ref: string; bar?: ProgressBar & { label: string | null } };

export default function ProgressBarCell({ bar, shipments }: { bar?: (ProgressBar & { label: string | null }) | null; shipments?: Shipment[] }) {
  if (!bar) return <Typography variant="body2">—</Typography>;
  const body = (
    <Box sx={{ width: "100%", minWidth: 160, maxWidth: 340 }}>
      <SegmentBar bar={bar} />
      <Stack direction="row" spacing={1} alignItems="baseline" sx={{ mt: 0.5 }}>
        <Typography variant="caption" sx={{ flex: 1, minWidth: 0, whiteSpace: "normal", wordBreak: "break-word", lineHeight: 1.3 }}>
          {bar.label ?? (bar.total ? "All steps done" : "No steps")}
        </Typography>
        {bar.total > 0 && (
          <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
            {bar.done}/{bar.total}
          </Typography>
        )}
      </Stack>
    </Box>
  );
  const ships = (shipments ?? []).filter((s) => s.bar && s.bar.total);
  if (ships.length < 2) return body;
  return (
    <Tooltip
      placement="bottom-start"
      title={
        <Stack spacing={1} sx={{ py: 0.5, minWidth: 220 }}>
          {ships.map((s) => (
            <Box key={s.ref}>
              <Stack direction="row" spacing={1} sx={{ mb: 0.25 }}>
                <Typography variant="caption" sx={{ fontWeight: 700, flex: 1 }}>
                  {s.ref}
                </Typography>
                <Typography variant="caption" sx={{ fontVariantNumeric: "tabular-nums" }}>
                  {s.bar!.done}/{s.bar!.total}
                </Typography>
              </Stack>
              <SegmentBar bar={s.bar!} height={6} />
              {s.bar!.label && (
                <Typography variant="caption" component="div" sx={{ opacity: 0.85, mt: 0.25 }}>
                  {s.bar!.label}
                </Typography>
              )}
            </Box>
          ))}
        </Stack>
      }
    >
      {body}
    </Tooltip>
  );
}
