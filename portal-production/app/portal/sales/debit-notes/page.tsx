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
    />
  );
}
