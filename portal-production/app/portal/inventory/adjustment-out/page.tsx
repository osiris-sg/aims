"use client";

import GoToLatestDocument from "@/app/portal/components/GoToLatestDocument";
import { INVENTORY_DOCUMENT_TYPES } from "../constants";

export default function AdjustmentOutPage() {
  const config = INVENTORY_DOCUMENT_TYPES.STOCK_ADJUSTMENT_OUT;

  return (
    <GoToLatestDocument
      documentTypes={config.types}
      documentLabel={config.label}
      pluralLabel={config.pluralLabel}
      createDocumentType={config.createDocumentType}
    />
  );
}
