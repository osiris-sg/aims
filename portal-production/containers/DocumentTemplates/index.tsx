"use client";

import { useParams } from "next/navigation";
import ReturnDeliveryOrderTemplate from "./components/ReturnDeliveryOrderTemplate";
import { Typography } from "@mui/material";
// import TaxInvoiceTemplate from "./components/TaxInvoiceTemplate";
import { IDocumentTemplates } from "./slice/constants";
import DeliveryOrderTemplate from "./components/DeliveryOrderTemplate";

export default function DocumentTemplates({ viewMode }: { viewMode: boolean }) {
  const { type }: { type: keyof typeof IDocumentTemplates } = useParams();

  const components = {
    [IDocumentTemplates.RDO]: ReturnDeliveryOrderTemplate,
    [IDocumentTemplates.DO]: DeliveryOrderTemplate,
    // [IDocumentTemplates.TI]: TaxInvoiceTemplate,
  };

  const ComponentToRender = components[type];

  if (!ComponentToRender) {
    return <Typography>Invalid Document Type</Typography>;
  }

  return <ComponentToRender viewMode={viewMode} />;
}
