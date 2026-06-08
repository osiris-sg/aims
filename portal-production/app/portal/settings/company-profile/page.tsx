"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Box, Button, Divider, FormControlLabel, Switch, Typography, Grid2, IconButton, Chip, Tabs, Tab } from "@mui/material";
import { Controller } from "react-hook-form";
import { useAuth } from "@clerk/nextjs";
import { useForm, useWatch } from "react-hook-form";
import FormInputBox from "@/form-components/FormInputBox";
import FormSelect from "@/form-components/FormSelect";
import FormImage from "@/form-components/FormImage";

/**
 * Short list of common operating currencies for the Default Currency picker
 * on Company Profile. Stored as the ISO code; the label shows the symbol +
 * full name for clarity. Add more as your client base grows.
 */
const CURRENCY_OPTIONS = [
  { value: "SGD", label: "SGD — Singapore Dollar" },
  { value: "USD", label: "USD — US Dollar" },
  { value: "MYR", label: "MYR — Malaysian Ringgit" },
  { value: "IDR", label: "IDR — Indonesian Rupiah" },
  { value: "THB", label: "THB — Thai Baht" },
  { value: "PHP", label: "PHP — Philippine Peso" },
  { value: "VND", label: "VND — Vietnamese Dong" },
  { value: "HKD", label: "HKD — Hong Kong Dollar" },
  { value: "CNY", label: "CNY — Chinese Yuan" },
  { value: "JPY", label: "JPY — Japanese Yen" },
  { value: "KRW", label: "KRW — Korean Won" },
  { value: "TWD", label: "TWD — Taiwan Dollar" },
  { value: "INR", label: "INR — Indian Rupee" },
  { value: "AUD", label: "AUD — Australian Dollar" },
  { value: "NZD", label: "NZD — New Zealand Dollar" },
  { value: "EUR", label: "EUR — Euro" },
  { value: "GBP", label: "GBP — British Pound" },
  { value: "CHF", label: "CHF — Swiss Franc" },
  { value: "CAD", label: "CAD — Canadian Dollar" },
  { value: "AED", label: "AED — UAE Dirham" },
];
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
      taxRate: organization?.taxRate ?? 9,
      // Org-wide defaults for the per-document tax toggles. The doc editor
      // seeds new docs from these (documentInfo.taxApplicable / .absorbTax).
      taxApplicable: (organization as any)?.taxApplicable ?? true,
      absorbTax: (organization as any)?.absorbTax ?? false,
      defaultCurrency: (organization as any)?.defaultCurrency || "SGD",
      bankAccountName: organization?.bankDetails?.accountName || "",
      bankAccountNumber: organization?.bankDetails?.accountNumber || "",
      bankName: organization?.bankDetails?.bankName || "",
      bankSwiftCode: organization?.bankDetails?.swiftCode || "",
      bankBranchCode: organization?.bankDetails?.branchCode || "",
      bankCode: organization?.bankDetails?.bankCode || "",
      bankCurrencyCode: organization?.bankDetails?.currencyCode || "SGD",
      logo: organization?.logo ? [{ data: organization.logo }] : undefined,
      defaultStamp: organization?.defaultStamp ? [{ data: organization.defaultStamp }] : undefined,
      customDocumentTypes: organization?.customDocumentTypes || {},
    }),
    [organization]
  );

  const { control, handleSubmit, reset, setValue } = useForm<any>({ defaultValues });
  const customDocumentTypes = useWatch({ control, name: "customDocumentTypes" }) || {};

  const [activeTab, setActiveTab] = useState<"general" | "tax" | "bank" | "branding" | "documents">("general");

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
    { code: "PO", label: "Purchase Order" },
    { code: "PR", label: "Purchase Return" },
    { code: "SO", label: "Sales Order" },
    { code: "DN", label: "Debit Note" },
    { code: "CN", label: "Credit Note" },
    { code: "SAI", label: "Stock Adjustment In" },
    { code: "SAO", label: "Stock Adjustment Out" },
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
      taxApplicable: !!data.taxApplicable,
      absorbTax: !!data.absorbTax,
      defaultCurrency: (data.defaultCurrency || "SGD").toUpperCase(),
      customDocumentTypes: data.customDocumentTypes,
      bankDetails: {
        accountName: data.bankAccountName || "",
        accountNumber: data.bankAccountNumber || "",
        bankName: data.bankName || "",
        swiftCode: data.bankSwiftCode || "",
        branchCode: data.bankBranchCode || "",
        bankCode: data.bankCode || "",
        currencyCode: data.bankCurrencyCode || "SGD",
      },
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

  const tabs: { value: typeof activeTab; label: string }[] = [
    { value: "general", label: "General" },
    { value: "tax", label: "Tax Defaults" },
    { value: "bank", label: "Bank Details" },
    { value: "branding", label: "Branding" },
    { value: "documents", label: "Document Names" },
  ];

  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2 }}>
      <Typography variant="h5" sx={{ fontWeight: 700 }}>
        Company Profile
      </Typography>

      <Box sx={{ borderBottom: 1, borderColor: "divider" }}>
        <Tabs
          value={activeTab}
          onChange={(_, v) => setActiveTab(v)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{
            "& .MuiTab-root": {
              textTransform: "none",
              fontWeight: 500,
              fontSize: "0.9rem",
              minHeight: 44,
            },
            "& .Mui-selected": { color: "primary.main" },
            "& .MuiTabs-indicator": { backgroundColor: "primary.main" },
          }}
        >
          {tabs.map((t) => (
            <Tab key={t.value} value={t.value} label={t.label} />
          ))}
        </Tabs>
      </Box>

      <Box component="form" onSubmit={handleSubmit(onSubmit)} sx={{ display: "flex", flexDirection: "column", gap: 2, maxWidth: 720 }}>
        {activeTab === "general" && (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <FormInputBox control={control} name="name" label="Organization Name" placeHolder="Enter name" />
            <FormInputBox control={control} name="address" label="Address" placeHolder="Enter address" />
            <FormInputBox control={control} name="phoneNumber" label="Phone Number" placeHolder="Enter phone" />
            <FormInputBox control={control} name="registrationNumber" label="Registration No" placeHolder="Enter registration number" />
            <FormSelect
              control={control}
              name="defaultCurrency"
              label="Default Currency"
              menuTitle="Default Currency"
              placeHolder="Select default currency"
              menuItems={CURRENCY_OPTIONS}
            />
          </Box>
        )}

        {activeTab === "tax" && (
          <Box>
            <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 600 }}>
              Tax Defaults
            </Typography>
            <Typography variant="body2" sx={{ mb: 2, color: "text.secondary" }}>
              New documents inherit these settings. You can still override per-document inside the editor.
            </Typography>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
              <Controller
                control={control}
                name="taxApplicable"
                render={({ field }) => (
                  <FormControlLabel
                    control={<Switch checked={!!field.value} onChange={(e) => field.onChange(e.target.checked)} />}
                    label="Tax Applicable by default"
                  />
                )}
              />
              <FormInputBox control={control} name="taxRate" label="Tax Rate (%)" placeHolder="Enter tax rate (e.g., 9 for 9%)" type="number" min={0} />
              <Controller
                control={control}
                name="absorbTax"
                render={({ field }) => (
                  <FormControlLabel
                    control={<Switch checked={!!field.value} onChange={(e) => field.onChange(e.target.checked)} />}
                    label="Absorb Tax in Total (tax-inclusive pricing)"
                  />
                )}
              />
            </Box>
          </Box>
        )}

        {activeTab === "bank" && (
          <Box>
            <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 600 }}>
              Bank Details
            </Typography>
            <Typography variant="body2" sx={{ mb: 2, color: "text.secondary" }}>
              Bank details will appear on invoices and other documents.
            </Typography>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
              <FormInputBox control={control} name="bankAccountName" label="Account Name" placeHolder="Enter account name" />
              <FormInputBox control={control} name="bankAccountNumber" label="Account Number" placeHolder="Enter account number" />
              <FormInputBox control={control} name="bankName" label="Bank Name" placeHolder="Enter bank name" />
              <FormInputBox control={control} name="bankSwiftCode" label="SWIFT/BIC Code" placeHolder="Enter SWIFT/BIC code" />
              <Box sx={{ display: "flex", gap: 2 }}>
                <Box sx={{ flex: 1 }}>
                  <FormInputBox control={control} name="bankBranchCode" label="Branch Code" placeHolder="Enter branch code" />
                </Box>
                <Box sx={{ flex: 1 }}>
                  <FormInputBox control={control} name="bankCode" label="Bank Code" placeHolder="Enter bank code" />
                </Box>
                <Box sx={{ flex: 1 }}>
                  <FormInputBox control={control} name="bankCurrencyCode" label="Currency Code" placeHolder="Enter currency" />
                </Box>
              </Box>
            </Box>
          </Box>
        )}

        {activeTab === "branding" && (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
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
          </Box>
        )}

        {activeTab === "documents" && (
          <Box>
            <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 600 }}>
              Custom Document Type Names
            </Typography>
            <Typography variant="body2" sx={{ mb: 2, color: "text.secondary" }}>
              Customize how document types appear to your users. For example, change &quot;Invoice&quot; to &quot;BI2025&quot; for your organization.
            </Typography>

            {Object.entries(customDocumentTypes).map(([docType]) => {
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

            <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
              {availableDocumentTypes
                .filter((docType) => !customDocumentTypes[docType.code])
                .map((docType) => (
                  <Chip key={docType.code} label={`Add ${docType.label}`} onClick={() => addCustomDocumentType(docType.code)} icon={<AddIcon />} variant="outlined" clickable sx={{ mb: 1 }} />
                ))}
            </Box>
          </Box>
        )}

        <Divider sx={{ mt: 1 }} />
        <Button type="submit" variant="contained" color="primary" sx={{ alignSelf: "flex-start" }}>
          Save
        </Button>
      </Box>
    </Box>
  );
}
