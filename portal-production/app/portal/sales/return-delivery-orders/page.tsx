"use client";

import GoToLatestDocument from "@/app/portal/components/GoToLatestDocument";
import { SALES_DOCUMENT_TYPES } from "../constants";

export default function ReturnDeliveryOrdersPage() {
  const config = SALES_DOCUMENT_TYPES.RETURN_DELIVERY_ORDER;

  return (
    <GoToLatestDocument
      documentTypes={config.types}
      documentLabel={config.label}
      pluralLabel={config.pluralLabel}
      createDocumentType={config.createDocumentType}
    />
  );
}
