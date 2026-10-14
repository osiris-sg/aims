"use client";

// Stand-alone "Invoices" module (catalog code INVOICES, per-org route
// /portal/invoicing — ADH Japan). Reuses the shared Sales invoice list and the
// document editor; it only differs from Sales → Invoice in always showing the
// list (no auto-open of the latest invoice) and in returning here from the
// editor (?from=/portal/invoicing), and in listing by issue date (newest first)
// rather than the created date.

import DocumentListView from "@/app/portal/components/DocumentListView";
import { SALES_DOCUMENT_TYPES } from "@/app/portal/sales/constants";

export default function InvoicingPage() {
  const config = SALES_DOCUMENT_TYPES.INVOICE;
  return (
    <DocumentListView
      documentTypes={config.types}
      documentLabel={config.label}
      pluralLabel={config.pluralLabel}
      createDocumentType={config.createDocumentType}
      fromPath="/portal/invoicing"
      hideSubtitle
      dateColumn="issue"
    />
  );
}
