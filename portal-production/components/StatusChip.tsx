"use client";

import React from "react";
import { Chip, Tooltip } from "@mui/material";

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
  // Round 35: an old ERP draft quotation (more than 6 months): grey, never pending.
  expired: "default",
};

// Display overrides (guru 2026-07-24 status model): drafts READ as
// Unconfirmed, pending_payment reads as "Awaiting payment".
const STATUS_LABEL: Record<string, string> = {
  draft: "Unconfirmed",
  unconfirmed: "Unconfirmed",
  pending_payment: "Awaiting Payment",
  posted: "Awaiting Payment", // bills: POSTED = confirmed, awaiting payment
  partially_paid: "Partially Paid",
};

import { wctStatusColor, wctStatusLabel } from "@/helpers/wctStatuses";
import { docDisplayStatus, docOutstandingOf, docPaidOf, erpQuotationDisplayStatus, erpQuotationTag, PARTIALLY_PAID } from "@/helpers/docStatus";
export { docPaidOf, docOutstandingOf, PARTIALLY_PAID, isInvoiceType, docDisplayStatus, isVoidedWithOrder, erpQuotationTag } from "@/helpers/docStatus";

const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function StatusChip({ status, doc }: { status?: string | null; doc?: { status?: string | null; config?: any; type?: string | null; documentType?: string | null; wctStatus?: string | null; erpQuoteStatus?: string | null } | null }) {
  // WCT imported quotation (helpers/docStatus.ts): its status comes from the ERP. List rows carry the type as
  // documentType; it is read for this rule only, so every other chip derives exactly as before. A list row carries
  // the server's reading (erpQuoteStatus, round 35: the 6-month cut on the server's Singapore date).
  const erpQuote = doc ? (doc.erpQuoteStatus || erpQuotationDisplayStatus(doc.type ?? doc.documentType, doc.config)) : null;
  // WCT group (enableWctStatuses): the API sends the row's status in the WCT set (helpers/wctStatuses.ts).
  const wct = doc?.wctStatus || null;
  // With the document in hand the chip derives "Partially Paid" itself.
  const s = wct ?? erpQuote ?? (doc ? docDisplayStatus({ status: status ?? doc.status, config: doc.config, type: doc.type }) : (status || "unconfirmed").toLowerCase());
  const label = wct
    ? wctStatusLabel(wct)
    : STATUS_LABEL[s] ||
      s
        .split("_")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
  const chip = (
    <Chip
      size="small"
      variant="outlined"
      color={wct ? wctStatusColor(wct) : STATUS_COLOR[s] || "default"}
      label={label}
      // Long statuses ("Delivered Installed") WRAP to a second line instead of
      // ellipsizing inside a fixed-width column (guru 2026-08-27: no "…").
      sx={{
        fontSize: "0.7rem",
        // One text line tall (22px) so a chip never grows a list row past
        // the GL/AR/AP density; long labels still wrap and grow it.
        height: "auto",
        minHeight: 22,
        py: 0,
        "& .MuiChip-label": { whiteSpace: "normal", display: "block", textAlign: "center", lineHeight: 1.3 },
      }}
    />
  );
  // WCT imported quotation still open in the ERP: a small "ERP draft" / "ERP sent" tag beside the status.
  const erpTag = doc ? (doc.erpQuoteStatus === "unconfirmed" || doc.erpQuoteStatus === "expired" ? `ERP ${String(doc.config?.erpImport?.status ?? "").trim().toLowerCase()}` : erpQuotationTag(doc.type ?? doc.documentType, doc.config)) : null;
  if (erpTag)
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
        {chip}
        <Chip size="small" label={erpTag} sx={{ fontSize: "0.65rem", height: 18, bgcolor: "action.hover", color: "text.secondary", "& .MuiChip-label": { px: 0.75 } }} />
      </span>
    );
  if ((s !== PARTIALLY_PAID && wct !== "part_paid") || !doc) return chip;
  // Hover shows how much came in and how much is still owed.
  const paid = docPaidOf(doc.config) ?? 0;
  const outstanding = docOutstandingOf(doc.config) ?? 0;
  return (
    <Tooltip title={`Paid ${money(paid)} · Outstanding ${money(outstanding)}`} arrow>
      <span style={{ display: "inline-flex" }}>{chip}</span>
    </Tooltip>
  );
}
