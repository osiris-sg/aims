"use client";

// A DO's "Send for signature" (manual order flow, WCT 2026-11-25): the quotation's sign link dialog (copy, WhatsApp,
// email the link, revoke) for a delivery order. The customer signs on the same public /sign page; signing completes
// the DO (api: public-sign, DO version).
import React from "react";
import SignLinkDialog from "@/app/portal/sales/quotations/id/_components/SignLinkDialog";

export default function DoSignLinkDialog({
  open,
  documentId,
  doName,
  customer,
  onClose,
}: {
  open: boolean;
  documentId: string;
  doName: string | null;
  customer?: { name?: string | null; phone?: string | null; email?: string | null } | null;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <SignLinkDialog
      open
      documentId={documentId}
      documentNumber={doName}
      clientName={customer?.name || ""}
      clientPhone={customer?.phone || ""}
      clientEmail={customer?.email || ""}
      grandTotal={0}
      wording="do"
      onClose={onClose}
    />
  );
}

/** The customer fields of a DO config for the dialog (attention first, as the quotation's). */
export function doSignCustomerOf(c: any): { name: string; phone: string; email: string } {
  const cfg = c || {};
  return {
    name: String(cfg.customer?.name || cfg.customerName || ""),
    phone: String(cfg.attention?.phoneNumber || cfg.contactNumber || cfg.customer?.mobile || cfg.customer?.phoneNumber || cfg.customer?.phone || ""),
    email: String(cfg.attention?.email || cfg.customerEmail || cfg.customer?.email || ""),
  };
}
