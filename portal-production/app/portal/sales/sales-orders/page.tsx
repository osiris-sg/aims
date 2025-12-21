"use client";

import SalesDocumentList from "../components/SalesDocumentList";
import { SALES_DOCUMENT_TYPES } from "../constants";

export default function SalesOrdersPage() {
  const config = SALES_DOCUMENT_TYPES.SALES_ORDER;

  return (
    <SalesDocumentList
      documentTypes={config.types}
      title={`${config.label} List`}
      subtitle={`${config.label} Detail Information`}
      createButtonLabel={`Create ${config.label}`}
      createPath={config.createPath}
    />
  );
}
