"use client";

import GoToLatestDocument from "@/app/portal/components/GoToLatestDocument";
import { SALES_DOCUMENT_TYPES } from "../constants";

export default function CreditNotesPage() {
  const config = SALES_DOCUMENT_TYPES.CREDIT_NOTE;

  return (
    <GoToLatestDocument
      documentTypes={config.types}
      documentLabel={config.label}
      createDocumentType={config.createDocumentType}
    />
  );
}
