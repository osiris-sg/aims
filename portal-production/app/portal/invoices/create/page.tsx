"use client";

import React, { useState, useEffect } from "react";
import MainCard from "@/components/MainCard";
import { Typography, Stack, Box, Button, Alert, Chip } from "@mui/material";
import FormSelect from "@/form-components/FormSelect";
import { useGetDocumentTemplates } from "./hooks/useGetDocumentTemplates";
import { ROUTES } from "@/routes";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import * as yup from "yup";
import { yupResolver } from "@hookform/resolvers/yup";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { request } from "@/helpers/request";
import { Receipt as InvoiceIcon } from "@mui/icons-material";

export default function CreateDocument() {
  const { availableDocumentTypes } = useGetDocumentTemplates();
  const router = useRouter();
  const { organization } = useOrganization();
  const organizationId = organization?.id;
  const documentTemplateSchema = yup.object().shape({
    documentType: yup.string().required(),
  });

  const {
    control,
    handleSubmit,
    formState: { isDirty },
  } = useForm({
    mode: "onChange",
    defaultValues: {
      documentType: "",
    },
    resolver: yupResolver(documentTemplateSchema),
  });

  const [isDocumentTemplateUpdating, setIsDocumentTemplateUpdating] = useState(false);
  const [msrData, setMsrData] = useState<any>(null);
  const { getToken } = useAuth();

  // Check for MSR data on component mount
  useEffect(() => {
    const storedMsrData = sessionStorage.getItem("invoiceFromMSR");
    if (storedMsrData) {
      try {
        const parsedData = JSON.parse(storedMsrData);
        setMsrData(parsedData);
        console.log("Found MSR data for invoice creation:", parsedData);
      } catch (error) {
        console.error("Error parsing MSR data:", error);
        sessionStorage.removeItem("invoiceFromMSR");
      }
    }
  }, []);

  const getTemplateIdByType = async (type: string, token: string): Promise<string> => {
    const response = await request(
      {
        path: `/documentTemplates/type/${type}`,
        method: "GET",
      },
      {},
      token
    );
    return response?.data?.id;
  };

  const onSubmit = async (data: any) => {
    try {
      setIsDocumentTemplateUpdating(true);
      const token = await getToken();
      const documentTemplateId = await getTemplateIdByType(data.documentType, token ?? "");
      console.log("Selected Document Type:", organizationId);

      // Prepare config with MSR data if available
      let config = {};
      if (msrData && msrData.items) {
        // Convert MSR items to invoice items format
        const invoiceItems = msrData.items.map((item: any, index: number) => ({
          inventoryItemId: null, // MSR items don't have inventory IDs
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          tax: "0", // Default tax
          // Add labor as separate line items if present
          ...(item.laborHours && item.laborRate
            ? {
                laborDescription: `Labor for ${item.description}`,
                laborHours: item.laborHours,
                laborRate: item.laborRate,
              }
            : {}),
        }));

        // Add labor as separate items
        const laborItems = msrData.items
          .filter((item: any) => item.laborHours && item.laborRate)
          .map((item: any) => ({
            inventoryItemId: null,
            description: `Labor: ${item.description}`,
            quantity: item.laborHours,
            unitPrice: item.laborRate,
            tax: "0",
          }));

        config = {
          items: [...invoiceItems, ...laborItems],
          msrSource: {
            sourceId: msrData.sourceId,
            reportDetails: msrData.reportDetails,
          },
        };
      }

      const response = await request(
        {
          path: "/documents/basic",
          method: "POST",
        },
        {
          type: data.documentType,
          config: config,
          documentTemplateId: documentTemplateId,
          organizationId: organizationId,
        },
        token ?? undefined
      );

      const createdDocumentId = response?.data.id;
      console.log("Created Document ID:", createdDocumentId);

      // Clear MSR data from sessionStorage
      if (msrData) {
        sessionStorage.removeItem("invoiceFromMSR");
      }

      router.push(`/portal/documents/${data.documentType}/${documentTemplateId}/${createdDocumentId}`);
    } catch (error) {
      console.error("Error submitting form:", error);
    } finally {
      setIsDocumentTemplateUpdating(false);
    }
  };

  return (
    <MainCard>
      <Box display="flex" justifyContent="center" width="100%" height="100%">
        <form onSubmit={handleSubmit(onSubmit)} style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "flex-end", justifyContent: "center", maxWidth: 600 }}>
          <Stack direction="column" justifyContent="center" width="100%" height="100%" alignContent="center">
            <Typography variant="h2" textAlign="center">
              Choose a Document
            </Typography>
            <Typography variant="body1" color="text.secondary" marginBottom="var(--default-gap)" textAlign="center">
              Select a document type you wish to create
            </Typography>

            {/* MSR Data Preview */}
            {msrData && (
              <Alert severity="info" icon={<InvoiceIcon />} sx={{ mb: 3, textAlign: "left" }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                  Creating Invoice from Maintenance Service Report
                </Typography>
                <Typography variant="body2" sx={{ mb: 1 }}>
                  Equipment: {msrData.reportDetails?.equipmentId} | Location: {msrData.reportDetails?.location}
                </Typography>
                <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                  <Chip label={`${msrData.items?.length || 0} chargeable items`} size="small" color="success" />
                  <Chip label={`Total: $${msrData.items?.reduce((sum: number, item: any) => sum + item.unitPrice * item.quantity + (item.laborHours || 0) * (item.laborRate || 0), 0).toFixed(2)}`} size="small" variant="outlined" />
                </Box>
              </Alert>
            )}

            <FormSelect control={control} menuItems={availableDocumentTypes.map((doc) => ({ label: doc.label, value: doc.value }))} label="Document" name="documentType" menuTitle="Choose a document" />
          </Stack>

          <Stack direction="row" justifyContent="space-between" width="100%">
            <Button variant="outlined" color="primary" onClick={() => router.push(ROUTES.DOCUMENTS)}>
              Cancel
            </Button>
            <Button variant="contained" color="primary" type="submit" loading={isDocumentTemplateUpdating} disabled={!isDirty}>
              {msrData ? "Create Invoice from MSR" : "Confirm"}
            </Button>
          </Stack>
        </form>
      </Box>
    </MainCard>
  );
}
