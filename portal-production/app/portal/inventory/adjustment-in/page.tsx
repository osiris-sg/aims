"use client";

import GoToLatestDocument from "@/app/portal/components/GoToLatestDocument";
import { INVENTORY_DOCUMENT_TYPES } from "../constants";

export default function AdjustmentInPage() {
  const config = INVENTORY_DOCUMENT_TYPES.STOCK_ADJUSTMENT_IN;

  return (
    <GoToLatestDocument
      documentTypes={config.types}
      documentLabel={config.label}
      createDocumentType={config.createDocumentType}
    />
  );
}
