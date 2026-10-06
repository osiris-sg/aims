"use client";

import React, { useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";

/**
 * The field app's bottom "Back" (2026-10-06): every screen leaves the rider a
 * way out at the bottom, within thumb reach.
 *
 * Default: back through history, or the Deliveries home on a cold deep link
 * (the same rule as the scanner page's back arrow). `to` sends it to a fixed
 * screen instead, for screens where history would re-enter a finished step:
 * a signature page whose report already exists, or a list the rider lands on
 * after signing. Where the screen also has a Back at the top, `to` matches it.
 */
export default function FieldBackButton({
  to,
  disabled,
  sx,
}: {
  to?: string;
  disabled?: boolean;
  sx?: SxProps<Theme>;
}) {
  const router = useRouter();
  const goBack = useCallback(() => {
    if (to) router.push(to);
    else if (typeof window !== "undefined" && window.history.length > 1) router.back();
    else router.replace("/scan");
  }, [router, to]);

  return (
    <Button
      variant="outlined"
      color="inherit"
      fullWidth
      startIcon={<ArrowBackIcon />}
      onClick={goBack}
      disabled={disabled}
      sx={[{ minHeight: 48, color: "text.secondary", borderColor: "divider" }, ...(Array.isArray(sx) ? sx : [sx])]}
    >
      Back
    </Button>
  );
}
