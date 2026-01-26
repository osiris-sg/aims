"use client";

import React, { useEffect, useMemo } from "react";
import { Box, Button, Divider, Typography, Grid2, IconButton, Chip } from "@mui/material";
import { useAuth } from "@clerk/nextjs";
import { useForm, useWatch } from "react-hook-form";
import FormInputBox from "@/form-components/FormInputBox";
import FormImage from "@/form-components/FormImage";
import { useOrganization } from "@/app/portal/hooks/useOrganization";
import { uploadImage } from "@/helpers/imageUploader";
import { toast } from "react-toastify";
import { Add as AddIcon, Delete as DeleteIcon } from "@mui/icons-material";

export default function OrganizationSettingsPage() {
  const { organization } = useOrganization();
  const { getToken } = useAuth();

  const defaultValues = useMemo(
    () => ({
      name: organization?.name || "",
      address: organization?.address || "",
      phoneNumber: organization?.phoneNumber || "",
      registrationNumber: organization?.registrationNumber || "",
      taxRate: organization?.taxRate || 9,
      logo: organization?.logo ? [{ data: organization.logo }] : undefined,
      defaultStamp: organization?.defaultStamp ? [{ data: organization.defaultStamp }] : undefined,
      customDocumentTypes: organization?.customDocumentTypes || {},
    }),
    [organization]
  );

  const { control, handleSubmit, reset, setValue } = useForm<any>({ defaultValues });
  const customDocumentTypes = useWatch({ control, name: "customDocumentTypes" }) || {};

  // When organization data becomes available, re-populate the form
  useEffect(() => {
    reset(defaultValues);
  }, [defaultValues, reset]);

  // Available document types that can be customized
  const availableDocumentTypes = [
    { code: "TI", label: "Tax Invoice" },
    { code: "QO1", label: "Quotation 1" },
    { code: "QO2", label: "Quotation 2" },
    { code: "DO", label: "Delivery Order" },
    { code: "RDO", label: "Return Delivery Order" },
    { code: "MSR", label: "Maintenance Service Report" },
  ];

  const addCustomDocumentType = (docType: string) => {
    const newCustomTypes = { ...customDocumentTypes, [docType]: "" };
    setValue("customDocumentTypes", newCustomTypes);
  };

  const removeCustomDocumentType = (docType: string) => {
    const newCustomTypes = { ...customDocumentTypes };
    delete newCustomTypes[docType];
    setValue("customDocumentTypes", newCustomTypes);
  };

  const updateCustomDocumentType = (docType: string, displayName: string) => {
    const newCustomTypes = { ...customDocumentTypes, [docType]: displayName };
    setValue("customDocumentTypes", newCustomTypes);
  };

  const onSubmit = async (data: any) => {
    const token = await getToken();
    if (!token || !organization?.id) {
      toast.error("Missing authentication or organization.");
      return;
    }

    const toastId = toast.loading("Saving organization...");

    // Extract keys from FormImage values
    const payload: any = {
      name: data.name,
      address: data.address,
      phoneNumber: data.phoneNumber,
      registrationNumber: data.registrationNumber,
      taxRate: parseFloat(data.taxRate) || 0,
      customDocumentTypes: data.customDocumentTypes,
    };

    const getFirstItem = (val: any) => (Array.isArray(val) && val[0]?.data ? val[0].data : undefined);
    const logoVal = getFirstItem(data.logo);
    const stampVal = getFirstItem(data.defaultStamp);

    console.log("[OrgSettings] Raw form values", data);
    console.log("[OrgSettings] Extracted logo value:", logoVal);
    console.log("[OrgSettings] Extracted stamp value:", stampVal);

    // Handle logo: if it's a File/Blob, upload and store key; if it's a string, use it directly; if deleted, set to null
    try {
      if (logoVal) {
        if (typeof logoVal === "string") {
          payload.logo = logoVal;
        } else {
          console.log("[OrgSettings] Uploading new logo...");
          const uploadedLogoKey = await uploadImage({ blob: logoVal, folderName: "logos", token });
          console.log("[OrgSettings] Uploaded logo key:", uploadedLogoKey);
          if (uploadedLogoKey) payload.logo = uploadedLogoKey;
        }
      } else {
        // Logo was deleted - explicitly set to null to clear it
        payload.logo = null;
      }
    } catch (e) {
      console.error("[OrgSettings] Logo upload failed", e);
    }

    // Handle default stamp: if it's a File/Blob, upload and store key; if it's a string, use it directly; if deleted, set to null
    try {
      if (stampVal) {
        if (typeof stampVal === "string") {
          payload.defaultStamp = stampVal;
        } else {
          console.log("[OrgSettings] Uploading new default stamp...");
          const uploadedStampKey = await uploadImage({ blob: stampVal, folderName: "stamps", token });
          console.log("[OrgSettings] Uploaded stamp key:", uploadedStampKey);
          if (uploadedStampKey) payload.defaultStamp = uploadedStampKey;
        }
      } else {
        // Stamp was deleted - explicitly set to null to clear it
        payload.defaultStamp = null;
      }
    } catch (e) {
      console.error("[OrgSettings] Stamp upload failed", e);
    }

    console.log("[OrgSettings] Final payload to PATCH:", payload);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_API_URL}/organizations/${organization.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      console.log("[OrgSettings] PATCH response status:", res.status);
      console.log("[OrgSettings] PATCH response body:", json);

      if (res.ok && json?.success !== false) {
        toast.update(toastId, { render: "Organization saved.", type: "success", isLoading: false, autoClose: 2000 });
      } else {
        const msg = json?.message || `Failed to save (status ${res.status})`;
        toast.update(toastId, { render: msg, type: "error", isLoading: false, autoClose: 4000 });
      }
    } catch (e: any) {
      console.error("[OrgSettings] PATCH error", e);
      toast.update(toastId, { render: e?.message || "Save failed", type: "error", isLoading: false, autoClose: 4000 });
    }
    // no hard refresh here; OrganizationContext will continue returning previous values until reload
  };

  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2 }}>
      <Typography variant="h5" sx={{ fontWeight: 700 }}>
        Organization Settings
      </Typography>
      <Divider />

      <Box component="form" onSubmit={handleSubmit(onSubmit)} sx={{ display: "flex", flexDirection: "column", gap: 2, maxWidth: 720 }}>
        <FormInputBox control={control} name="name" label="Organization Name" placeHolder="Enter name" />
        <FormInputBox control={control} name="address" label="Address" placeHolder="Enter address" />
        <FormInputBox control={control} name="phoneNumber" label="Phone Number" placeHolder="Enter phone" />
        <FormInputBox control={control} name="registrationNumber" label="Registration No" placeHolder="Enter registration number" />
        <FormInputBox
          control={control}
          name="taxRate"
          label="Tax Rate (%)"
          placeHolder="Enter tax rate (e.g., 9 for 9%)"
          type="number"
          min={0}
        />

        <Box>
          <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 600 }}>
            Logo
          </Typography>
          <FormImage control={control} name="logo" numberOfUploaders={1} />
        </Box>

        <Box>
          <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 600 }}>
            Default Company Stamp
          </Typography>
          <FormImage control={control} name="defaultStamp" numberOfUploaders={1} />
        </Box>

        <Box>
          <Typography variant="subtitle1" sx={{ mb: 2, fontWeight: 600 }}>
            Custom Document Type Names
          </Typography>
          <Typography variant="body2" sx={{ mb: 2, color: "text.secondary" }}>
            Customize how document types appear to your users. For example, change "Invoice" to "BI2025" for your organization.
          </Typography>

          {/* Current custom document types */}
          {Object.entries(customDocumentTypes).map(([docType, displayName]) => {
            const docInfo = availableDocumentTypes.find((d) => d.code === docType);
            return (
              <Box key={docType} sx={{ mb: 2, p: 2, border: 1, borderColor: "divider", borderRadius: 1 }}>
                <Grid2 container spacing={2} alignItems="center">
                  <Grid2 size={3}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {docInfo?.label || docType}
                    </Typography>
                    <Typography variant="caption" sx={{ color: "text.secondary" }}>
                      Code: {docType}
                    </Typography>
                  </Grid2>
                  <Grid2 size={7}>
                    <FormInputBox control={control} name={`customDocumentTypes.${docType}`} label="Custom Display Name" placeHolder={`e.g., BI2025, Custom ${docInfo?.label || docType}`} size="small" onChange={(e) => updateCustomDocumentType(docType, e.target.value)} />
                  </Grid2>
                  <Grid2 size={2}>
                    <IconButton onClick={() => removeCustomDocumentType(docType)} color="error" size="small">
                      <DeleteIcon />
                    </IconButton>
                  </Grid2>
                </Grid2>
              </Box>
            );
          })}

          {/* Add new document type */}
          <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
            {availableDocumentTypes
              .filter((docType) => !customDocumentTypes[docType.code])
              .map((docType) => (
                <Chip key={docType.code} label={`Add ${docType.label}`} onClick={() => addCustomDocumentType(docType.code)} icon={<AddIcon />} variant="outlined" clickable sx={{ mb: 1 }} />
              ))}
          </Box>
        </Box>

        <Button type="submit" variant="contained" color="primary" sx={{ alignSelf: "flex-start" }}>
          Save
        </Button>
      </Box>
    </Box>
  );
}
