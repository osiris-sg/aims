"use client";

import React from "react";
import { Chip } from "@mui/material";
import { DO_TAG_COLOR, type DoStatusTag as Tag } from "@/helpers/doStatusTag";

/**
 * The Pending / Completed / Cancelled tag shown next to a DO number
 * (enableRealDoOnSchedule orgs). Callers render it only when the flag is on.
 */
export default function DoStatusTag({ tag, size = "small" }: { tag: Tag; size?: "small" | "medium" }) {
  return (
    <Chip
      size={size}
      variant={tag === "Completed" ? "filled" : "outlined"}
      color={DO_TAG_COLOR[tag]}
      label={tag}
      title={`Delivery Order: ${tag.toLowerCase()}`}
      sx={{ fontWeight: 600, ...(tag === "Cancelled" ? { textDecoration: "line-through" } : {}) }}
    />
  );
}
