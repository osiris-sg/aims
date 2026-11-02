"use client";

import { newDocumentUrl } from "@/helpers/newDocument";
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
import { useTemplatePicker } from "@/app/portal/components/useTemplatePicker";

export default function CreateDocument() {
  const { availableDocumentTypes } = useGetDocumentTemplates();
  const router = useRouter();
  const { resolveTemplate, dialog: templatePickerDialog } = useTemplatePicker();
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

  const onSubmit = async (data: { documentType: string }) => {
    const type = data.documentType;
    setIsDocumentTemplateUpdating(true);
    try {
      // Shared picker: 1 active → straight through, >1 → popup, 0 → single-resolve.
      // null = no template OR the user cancelled the popup → abort without creating.
      const documentTemplateId = await resolveTemplate(type);
      if (!documentTemplateId) return;

      // Open "New <type> (number on save)": nothing is created until it is saved.
      router.push(newDocumentUrl({ type, templateId: documentTemplateId }));
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

      {templatePickerDialog}
    </MainCard>
  );
}
