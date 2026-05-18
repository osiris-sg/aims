"use client";

import GoToLatestDocument from "@/app/portal/components/GoToLatestDocument";
import { SALES_DOCUMENT_TYPES } from "../constants";

export default function InvoicesPage() {
  const config = SALES_DOCUMENT_TYPES.INVOICE;

  return (
    <GoToLatestDocument
      documentTypes={config.types}
      documentLabel={config.label}
      pluralLabel={config.pluralLabel}
      createDocumentType={config.createDocumentType}
    />
  );
}
