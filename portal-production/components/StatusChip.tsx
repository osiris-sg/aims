"use client";

import React from "react";
import { Chip } from "@mui/material";

// Bills-style status pill, shared by every document table so statuses read the
// same everywhere (outlined chip, uppercase-ish short label, semantic color).
const STATUS_COLOR: Record<string, "default" | "primary" | "success" | "warning" | "info" | "error"> = {
  draft: "default",
  unconfirmed: "default",
  confirmed: "primary",
  posted: "primary",
  paid: "success",
  delivered_installed: "success",
  delivered_not_installed: "info",
  pending_delivery: "warning",
  pending_payment: "warning",
  pending_return: "warning",
  partially_paid: "warning",
  returned: "default",
  cancelled: "error",
  voided: "error",
};

// Display overrides (guru 2026-07-24 status model): drafts READ as
// Unconfirmed, pending_payment reads as "Awaiting payment".
const STATUS_LABEL: Record<string, string> = {
  draft: "Unconfirmed",
  unconfirmed: "Unconfirmed",
  pending_payment: "Awaiting Payment",
  posted: "Awaiting Payment", // bills: POSTED = confirmed, awaiting payment
};

export default function StatusChip({ status }: { status?: string | null }) {
  const s = (status || "unconfirmed").toLowerCase();
  const label =
    STATUS_LABEL[s] ||
    s
      .split("_")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  return <Chip size="small" variant="outlined" color={STATUS_COLOR[s] || "default"} label={label} sx={{ fontSize: "0.7rem" }} />;
}
