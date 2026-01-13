"use client";

import GoToLatestDocument from "@/app/portal/components/GoToLatestDocument";
import { INVENTORY_DOCUMENT_TYPES } from "../constants";

export default function PurchasesPage() {
  const config = INVENTORY_DOCUMENT_TYPES.PURCHASE_ORDER;

  return (
    <GoToLatestDocument
      documentTypes={config.types}
      documentLabel={config.label}
      createDocumentType={config.createDocumentType}
    />
  );
}
