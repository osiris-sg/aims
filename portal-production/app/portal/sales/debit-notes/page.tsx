"use client";

import GoToLatestDocument from "@/app/portal/components/GoToLatestDocument";
import { SALES_DOCUMENT_TYPES } from "../constants";

export default function DebitNotesPage() {
  const config = SALES_DOCUMENT_TYPES.DEBIT_NOTE;

  return (
    <GoToLatestDocument
      documentTypes={config.types}
      documentLabel={config.label}
      pluralLabel={config.pluralLabel}
      createDocumentType={config.createDocumentType}
      // Sales shows only the notes WE issue to a customer. A supplier's credit
      // note is a purchase-side document and belongs in the purchase journal
      // under AP (guru 2026-11-12) — both kinds share one document type, so
      // the list has to say which side it wants.
      counterparty="CUSTOMER"
    />
  );
}
