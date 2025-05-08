"use client";

import React from "react";
import { Typography, Stack, Box, Button } from "@mui/material";
import FormSelect from "@/form-components/FormSelect";
import { useGetAssets } from "./hooks/useGetAssets";
import { useGetDocuments } from "./hooks/useGetDocuments";
import useCreateDocumentFormHandler from "./hooks/useCreateDocumentFormHandler";
import { ROUTES } from "@/routes";
import { useRouter } from "next/navigation";
export default function CreateDocument() {
  const { control, watch, handleSubmit, onSubmit, isDocumentTemplateUpdating, isDirty } = useCreateDocumentFormHandler();
  const { assets } = useGetAssets();
  const { availableDocumentTypes } = useGetDocuments();
  const selectedDocumentType = watch("type");
  const router = useRouter();

  return (
    <Box display="flex" justifyContent="center" width="100%" height="100%">
      <form onSubmit={handleSubmit(onSubmit)} style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "flex-end", justifyContent: "center", maxWidth: 600 }}>
        <Stack direction="column" justifyContent="center" width="100%" height="100%" alignContent="center">
          <Typography variant="h2" textAlign="center">
            {selectedDocumentType === "MSR" ? "Choose an Asset" : "Choose a Document"}
          </Typography>
          <Typography variant="body1" color="text.secondary" marginBottom="var(--default-gap)" textAlign="center">
            {selectedDocumentType === "MSR" ? "Select an asset you wish to customize." : "Select a document that you wish to customize."}
          </Typography>
          {selectedDocumentType === "MSR" ? (
            <FormSelect control={control} menuItems={assets.docs.map((asset) => ({ label: asset.name, value: asset.id }))} label="Asset" name="assetId" menuTitle="Choose an asset" />
          ) : (
            <FormSelect control={control} menuItems={availableDocumentTypes} label="Document" name="type" menuTitle="Choose a document" />
          )}
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
  );
}
