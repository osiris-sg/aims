"use client";
import React from "react";
import { Button, Stack } from "@mui/material";

// The legacy editors' left module rail (Official Receipt, Payment Voucher,
// Journal Voucher). Guru 2026-11-11: the buttons wear the list pages' Create
// button look — contained primary, icon on the left, label inline — instead of
// the old square icon-over-label tiles. Keep the rail on the LEFT.
export type EditorRailButton = { label: string; icon: React.ReactNode; onClick: () => void; "data-tour"?: string };

// `responsive` (the framed legacy editors): the column of buttons only from the lg breakpoint, where the
// rail has its 204px gutter to sit in; below that (split screen) a wrapping row above the content
// (helpers/wctDocUi.ts docRailSx, guru 2026-11-26).
export default function EditorRail({ buttons, responsive = false }: { buttons: EditorRailButton[]; responsive?: boolean }) {
  return (
    <Stack
      spacing={1}
      direction={responsive ? { xs: "row", lg: "column" } : "column"}
      useFlexGap
      sx={responsive ? { width: { xs: "auto", lg: 172 }, flexWrap: "wrap", flexShrink: 0, pt: 0.5 } : { width: 172, flexShrink: 0, pt: 0.5 }}
    >
      {buttons.map((b) => (
        <Button
          key={b.label}
          data-tour={b["data-tour"]}
          variant="contained"
          color="primary"
          startIcon={b.icon}
          onClick={b.onClick}
          fullWidth={!responsive}
          // A long module name wraps onto two lines (the invoice's "Unconfirm
          // Invoice Listing By Customer") instead of being clipped.
          sx={{ justifyContent: "flex-start", whiteSpace: "normal", textAlign: "left", lineHeight: 1.25, "& .MuiButton-startIcon": { ml: 0, flexShrink: 0 }, ...(responsive ? { width: { xs: "auto", lg: "100%" } } : {}) }}
        >
          {b.label}
        </Button>
      ))}
    </Stack>
  );
}
