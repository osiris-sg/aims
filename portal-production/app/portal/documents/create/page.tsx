"use client";

import React, { useState } from "react";
import MainCard from "@/components/MainCard";
import { Typography, Stack, Box, Button } from "@mui/material";
import FormSelect from "@/form-components/FormSelect";
import { useGetDocumentTemplates } from "./hooks/useGetDocumentTemplates";
import { ROUTES } from "@/routes";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import * as yup from "yup";
import { yupResolver } from "@hookform/resolvers/yup";
import { useAuth, useOrganization } from "@clerk/nextjs";
import { request } from "@/helpers/request";

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
  const { getToken } = useAuth();

  const typeToIdMap: Record<string, string> = {
    DO: "36c25729-34a0-419a-8a93-cdda243168ab",
    RDO: "89e5fd4b-e837-44ad-982e-80559a3274e0",
    TI: "tax_invoice",
    MSR: "maintenance_service_report",
  };

  const onSubmit = async (data: any) => {
    try {
      setIsDocumentTemplateUpdating(true);
      const token = await getToken();
      const documentTemplateId = typeToIdMap[data.documentType] || data.documentType;
      console.log("Selected Document Type:", organizationId);
      const response = await request(
        {
          path: "/documents/basic",
          method: "POST",
        },
        {
          type: data.documentType,
          config: {},
          documentTemplateId: documentTemplateId,
          organizationId: organizationId,
        },
        token ?? undefined
      );

      const createdDocumentId = response?.data.id;
      console.log("Created Document ID:", createdDocumentId);
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
            <FormSelect control={control} menuItems={availableDocumentTypes.map((doc) => ({ label: doc.label, value: doc.value }))} label="Document" name="documentType" menuTitle="Choose a document" />
          </Stack>

          <Stack direction="row" justifyContent="space-between" width="100%">
            <Button variant="outlined" color="primary" onClick={() => router.push(ROUTES.DOCUMENTS)}>
              Cancel
            </Button>
            <Button variant="contained" color="primary" type="submit" loading={isDocumentTemplateUpdating} disabled={!isDirty}>
              Confirm
            </Button>
          </Stack>
        </form>
      </Box>
    </MainCard>
  );
}
