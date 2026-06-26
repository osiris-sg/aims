"use client";

import React, { useState } from "react";
import MainCard from "@/components/MainCard";
import {
  Typography,
  Stack,
  Box,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  RadioGroup,
  FormControlLabel,
  Radio,
  Chip,
  CircularProgress,
} from "@mui/material";
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

async function getDocumentTemplateIdByType(documentType: string, token: string) {
  try {
    const response = await request(
      {
        path: `/documentTemplates/type/${documentType}`,
        method: "GET",
      },
      {},
      token
    );
    if (response.success && response.data?.id) {
      return response.data.id;
    }
    console.error("No document template found for type:", documentType);
    return null;
  } catch (error) {
    console.error("Error fetching document template by type:", error);
    return null;
  }
}

// Active templates available to the user's org for a type (org selections ∪
// Standard). Used to decide between straight-in (1) and the picker (>1).
async function getActiveTemplatesByType(documentType: string, token: string) {
  try {
    const response = await request(
      { path: `/documentTemplates/active/${documentType}`, method: "GET" },
      {},
      token
    );
    const list = response.success !== false ? response.data || response || [] : [];
    return Array.isArray(list) ? list : [];
  } catch (error) {
    console.error("Error fetching active templates by type:", error);
    return [];
  }
}

// Document types that support the multi-active template picker. Everything else
// keeps the single-active straight-in behavior.
const PICKER_TYPES = new Set(["QUOTATION"]);

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

  // Picker state (shown only when >1 template is active for a picker-enabled type)
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerTemplates, setPickerTemplates] = useState<any[]>([]);
  const [pendingType, setPendingType] = useState<string>("");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");

  // Shared tail: create the doc with the resolved template, then route into the editor.
  const proceedCreate = async (type: string, documentTemplateId: string, token: string) => {
    const response = await request(
      { path: "/documents/basic", method: "POST" },
      { type, config: {}, documentTemplateId, organizationId },
      token || undefined
    );
    const createdDocumentId = response?.data.id;
    router.push(`/portal/documents/${type}/${documentTemplateId}/${createdDocumentId}`);
  };

  const onSubmit = async (data: { documentType: string }) => {
    const type = data.documentType;
    setIsDocumentTemplateUpdating(true);
    try {
      const token = (await getToken()) ?? "";

      // Picker-enabled types: branch on how many templates are active.
      if (PICKER_TYPES.has(type)) {
        const active = await getActiveTemplatesByType(type, token);
        if (active.length > 1) {
          // >1 active → let the user choose; pre-select the primary.
          setPendingType(type);
          setPickerTemplates(active);
          setSelectedTemplateId(active.find((t: any) => t.isPrimary)?.id || active[0].id);
          setPickerOpen(true);
          setIsDocumentTemplateUpdating(false);
          return;
        }
        if (active.length === 1) {
          await proceedCreate(type, active[0].id, token);
          return;
        }
        // 0 active → fall through to the default single resolution below.
      }

      // Default (non-picker types, or no active templates): resolve a single one.
      const fetchedId = await getDocumentTemplateIdByType(type, token);
      const documentTemplateId = fetchedId || type;
      await proceedCreate(type, documentTemplateId, token);
    } catch (error) {
      console.error("Error submitting form:", error);
    } finally {
      setIsDocumentTemplateUpdating(false);
    }
  };

  const onPickerConfirm = async () => {
    if (!selectedTemplateId || !pendingType) return;
    setIsDocumentTemplateUpdating(true);
    try {
      const token = (await getToken()) ?? "";
      await proceedCreate(pendingType, selectedTemplateId, token);
      setPickerOpen(false);
    } catch (error) {
      console.error("Error creating document from picker:", error);
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

      {/* Template picker — shown only when >1 template is active for the chosen
          type (e.g. QUOTATION). Lists the org's own active templates ∪ Standard;
          pre-selects the primary. */}
      <Dialog open={pickerOpen} onClose={() => !isDocumentTemplateUpdating && setPickerOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Choose a template</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            More than one template is available for this document. Pick which one to use.
          </Typography>
          <RadioGroup value={selectedTemplateId} onChange={(e) => setSelectedTemplateId(e.target.value)}>
            {pickerTemplates.map((t) => (
              <FormControlLabel
                key={t.id}
                value={t.id}
                control={<Radio />}
                label={
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <Typography variant="body1">{t.name || t.designName || "Untitled template"}</Typography>
                    {t.isPrimary && <Chip label="Default" color="success" size="small" />}
                    {t.isDefault && <Chip label="Standard" color="info" size="small" variant="outlined" />}
                  </Box>
                }
              />
            ))}
          </RadioGroup>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPickerOpen(false)} disabled={isDocumentTemplateUpdating}>
            Cancel
          </Button>
          <Button variant="contained" onClick={onPickerConfirm} disabled={!selectedTemplateId || isDocumentTemplateUpdating}>
            {isDocumentTemplateUpdating ? <CircularProgress size={22} /> : "Create"}
          </Button>
        </DialogActions>
      </Dialog>
    </MainCard>
  );
}
