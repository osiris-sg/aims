"use client";

import GoToLatestDocument from "@/app/portal/components/GoToLatestDocument";
import { SALES_DOCUMENT_TYPES } from "../constants";

export default function SalesOrdersPage() {
  const config = SALES_DOCUMENT_TYPES.SALES_ORDER;

  return (
    <GoToLatestDocument
      documentTypes={config.types}
      documentLabel={config.label}
      createDocumentType={config.createDocumentType}
    />
  );
}
