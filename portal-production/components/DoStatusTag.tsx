"use client";

import React from "react";
import { Chip } from "@mui/material";
import { DO_TAG_COLOR, type DoStatusTag as Tag } from "@/helpers/doStatusTag";
import { flowDocStatus } from "@/helpers/wctStatusFlow";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";

/**
 * The Pending / Completed / Cancelled tag shown next to a DO number
 * (enableRealDoOnSchedule orgs). Callers render it only when the flag is on.
 *
 * WCT group wording (enableWctStatusFlow, 2026-11-19): a finished DO reads "Accepted"
 * (delivered and signed), and with the DO itself in hand (`doc`) one the system made
 * that nobody has saved yet reads "Draft". Same colours.
 */
export default function DoStatusTag({ tag, size = "small", doc }: { tag: Tag; size?: "small" | "medium"; doc?: { status?: string | null; config?: any; cancelled?: boolean | null } | null }) {
  const { isWctStatusFlowEnabled } = useOrganizationFeatures();
  const flow = isWctStatusFlowEnabled && doc ? flowDocStatus({ ...doc, type: "DELIVERY_ORDER" }) : null;
  const label = !isWctStatusFlowEnabled ? tag : flow ? flow.label : tag === "Completed" ? "Accepted" : tag;
  return (
    <Chip
      size={size}
      variant={tag === "Completed" ? "filled" : "outlined"}
      color={label === "Draft" ? "default" : DO_TAG_COLOR[tag]}
      label={label}
      data-testid="do-status-tag"
      title={`Delivery Order: ${label.toLowerCase()}`}
      sx={{ fontWeight: 600, ...(tag === "Cancelled" ? { textDecoration: "line-through" } : {}) }}
    />
  );
}
