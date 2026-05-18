"use client";

import GoToLatestDocument from "@/app/portal/components/GoToLatestDocument";
import { INVENTORY_DOCUMENT_TYPES } from "../constants";

export default function PurchasesReturnPage() {
  const config = INVENTORY_DOCUMENT_TYPES.PURCHASE_RETURN;

  return (
    <GoToLatestDocument
      documentTypes={config.types}
      documentLabel={config.label}
      pluralLabel={config.pluralLabel}
      createDocumentType={config.createDocumentType}
    />
  );
}
