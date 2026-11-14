"use client";
import React from "react";
import { Button, Stack } from "@mui/material";

// The legacy editors' left module rail (Official Receipt, Payment Voucher,
// Journal Voucher). Guru 2026-11-11: the buttons wear the list pages' Create
// button look — contained primary, icon on the left, label inline — instead of
// the old square icon-over-label tiles. Keep the rail on the LEFT.
export type EditorRailButton = { label: string; icon: React.ReactNode; onClick: () => void; "data-tour"?: string };

export default function EditorRail({ buttons }: { buttons: EditorRailButton[] }) {
  return (
    <Stack spacing={1} sx={{ width: 172, flexShrink: 0, pt: 0.5 }}>
      {buttons.map((b) => (
        <Button
          key={b.label}
          data-tour={b["data-tour"]}
          variant="contained"
          color="primary"
          startIcon={b.icon}
          onClick={b.onClick}
          fullWidth
          // A long module name wraps onto two lines (the invoice's "Unconfirm
          // Invoice Listing By Customer") instead of being clipped.
          sx={{ justifyContent: "flex-start", whiteSpace: "normal", textAlign: "left", lineHeight: 1.25, "& .MuiButton-startIcon": { ml: 0, flexShrink: 0 } }}
        >
          {b.label}
        </Button>
      ))}
    </Stack>
  );
}
