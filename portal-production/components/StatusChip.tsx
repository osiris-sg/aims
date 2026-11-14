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

const num = (v: any): number | null => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// Money stamped on the document by the server after every payment
// (common/document-money.ts: canonical paidToDate / outstandingBalance,
// legacy xeroAmountPaid / xeroBalance twins).
export const docPaidOf = (config: any): number | null => num(config?.paidToDate) ?? num(config?.xeroAmountPaid);
export const docOutstandingOf = (config: any): number | null => num(config?.outstandingBalance) ?? num(config?.xeroBalance);

// A partly paid invoice stays `pending_payment` in the database (there is no
// such enum value); what makes it "partially paid" is money stamped on it:
// something paid AND something still owed. Derive the display status here so
// every list reads the same (guru 2026-11-06, BIPL-JPSG-20260929-0002: a part
// payment showed as plain "Awaiting Payment").
export const PARTIALLY_PAID = "partially_paid";
// An invoice is never "Confirmed" (guru 2026-11-14): once confirmed it is
// AWAITING PAYMENT until it is paid. Rows that still carry the generic
// `confirmed` status (imported books) read as Awaiting Payment here, and the
// same rule drives the list filters.
const INVOICE_TYPES = new Set(["INVOICE", "TI", "TI2"]);
export const isInvoiceType = (t?: string | null) => INVOICE_TYPES.has(String(t || "").toUpperCase());
export function docDisplayStatus(doc: { status?: string | null; config?: any; type?: string | null } | null | undefined): string {
  let s = (doc?.status || "unconfirmed").toLowerCase();
  if (s === "confirmed" && isInvoiceType(doc?.type)) s = "pending_payment";
  if (["paid", "cancelled", "voided", "returned"].includes(s)) return s;
  const c = doc?.config || {};
  if (c.voided) return s;
  const paid = docPaidOf(c);
  const outstanding = docOutstandingOf(c);
  if (paid !== null && paid > 0.005 && outstanding !== null && outstanding > 0.005) return PARTIALLY_PAID;
  return s;
}

const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function StatusChip({ status, doc }: { status?: string | null; doc?: { status?: string | null; config?: any; type?: string | null } | null }) {
  // With the document in hand the chip derives "Partially Paid" itself.
  const s = doc ? docDisplayStatus({ status: status ?? doc.status, config: doc.config, type: doc.type }) : (status || "unconfirmed").toLowerCase();
  const label =
    STATUS_LABEL[s] ||
    s
      .split("_")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  const chip = (
    <Chip
      size="small"
      variant="outlined"
      color={STATUS_COLOR[s] || "default"}
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
  if (s !== PARTIALLY_PAID || !doc) return chip;
  // Hover shows how much came in and how much is still owed.
  const paid = docPaidOf(doc.config) ?? 0;
  const outstanding = docOutstandingOf(doc.config) ?? 0;
  return (
    <Tooltip title={`Paid ${money(paid)} · Outstanding ${money(outstanding)}`} arrow>
      <span style={{ display: "inline-flex" }}>{chip}</span>
    </Tooltip>
  );
}
