"use client";

import { useParams } from "next/navigation";
import ReturnDeliveryOrderTemplate from "./components/ReturnDeliveryOrderTemplate";
import { Typography } from "@mui/material";
import { IDocumentTemplates } from "./slice/constants";
import DeliveryOrderTemplate from "./components/DeliveryOrderTemplate";
import InvoiceTemplate from "./components/InvoiceTemplate";
import Quotation1Template from "./components/Quotation1Template";
import Quotation2Template from "./components/Quotation2Template";

export default function DocumentTemplates({ viewMode }: { viewMode: boolean }) {
  const { type }: { type: keyof typeof IDocumentTemplates } = useParams();

  const components = {
    [IDocumentTemplates.RDO]: ReturnDeliveryOrderTemplate,
    [IDocumentTemplates.DO]: DeliveryOrderTemplate,
    [IDocumentTemplates.TI]: InvoiceTemplate,
    [IDocumentTemplates.QO1]: Quotation1Template,
    [IDocumentTemplates.QO2]: Quotation2Template,
  };

  const ComponentToRender = components[type];

  if (!ComponentToRender) {
    return <Typography>Invalid Document Type</Typography>;
  }

  return <ComponentToRender viewMode={viewMode} />;
}
