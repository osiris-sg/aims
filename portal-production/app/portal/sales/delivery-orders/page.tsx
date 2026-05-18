"use client";

import GoToLatestDocument from "@/app/portal/components/GoToLatestDocument";
import { SALES_DOCUMENT_TYPES } from "../constants";

export default function DeliveryOrdersPage() {
  const config = SALES_DOCUMENT_TYPES.DELIVERY_ORDER;

  return (
    <GoToLatestDocument
      documentTypes={config.types}
      documentLabel={config.label}
      pluralLabel={config.pluralLabel}
      createDocumentType={config.createDocumentType}
    />
  );
}
