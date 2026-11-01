"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Button, Divider, FormControlLabel, MenuItem, Select, Switch, TextField, Typography, Grid2, IconButton, Chip, Tabs, Tab } from "@mui/material";
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
import { request } from "@/helpers/request";
import { toast } from "react-toastify";
import { uploadFile } from "@/helpers/fileUploader";
import { Add as AddIcon, Delete as DeleteIcon } from "@mui/icons-material";
import { useTranslations } from "next-intl";

export default function OrganizationSettingsPage() {
  const t = useTranslations("settings.companyProfile");
  const { organization } = useOrganization();
  const { getToken } = useAuth();

  const defaultValues = useMemo(
    () => ({
      name: organization?.name || "",
      address: organization?.address || "",
      phoneNumber: organization?.phoneNumber || "",
      registrationNumber: organization?.registrationNumber || "",
      // Letterhead contact lines (printed by client layouts such as WCT's).
      email: (organization as any)?.email || "",
      website: (organization as any)?.website || "",
      taxRate: organization?.taxRate ?? 9,
      // Org-wide defaults for the per-document tax toggles. The doc editor
      // seeds new docs from these (documentInfo.taxApplicable / .absorbTax).
      taxApplicable: (organization as any)?.taxApplicable ?? true,
      absorbTax: (organization as any)?.absorbTax ?? false,
      defaultCurrency: (organization as any)?.defaultCurrency || "SGD",
      // Per-doc-type defaults (keyed by canonical doc type code).
      // { [code]: { tnc, notes, footerMessage } }
      docTypeDefaults: (organization as any)?.docTypeDefaults || {},
      bankAccountName: organization?.bankDetails?.accountName || "",
      bankAccountNumber: organization?.bankDetails?.accountNumber || "",
      bankName: organization?.bankDetails?.bankName || "",
      bankSwiftCode: organization?.bankDetails?.swiftCode || "",
      bankBranchCode: organization?.bankDetails?.branchCode || "",
      bankCode: organization?.bankDetails?.bankCode || "",
      bankCurrencyCode: organization?.bankDetails?.currencyCode || "SGD",
      // PayNow UEN printed on the letterhead (bankDetails JSON, no schema change).
      paynowUen: (organization as any)?.bankDetails?.paynowUen || "",
      logo: organization?.logo ? [{ data: organization.logo }] : undefined,
      defaultStamp: organization?.defaultStamp ? [{ data: organization.defaultStamp }] : undefined,
      customDocumentTypes: organization?.customDocumentTypes || {},
    }),
    [organization]
  );

  const { control, handleSubmit, reset, setValue } = useForm<any>({ defaultValues });
  const customDocumentTypes = useWatch({ control, name: "customDocumentTypes" }) || {};

  const [activeTab, setActiveTab] = useState<"general" | "bank" | "branding" | "documents" | "docDefaults">("general");
  // PayNow QR (public Click-to-pay page) — stored inside bankDetails JSON.
  const [paynowQrKey, setPaynowQrKey] = useState<string>("");
  // Additional banks (guru 2026-09-09): extra accounts printed below the
  // first bank on documents, separated by "OR". Stored as
  // bankDetails.additionalBanks — same JSON blob, no schema change.
  const emptyBank = { accountName: "", accountNumber: "", bankName: "", swiftCode: "", branchCode: "", bankCode: "", currencyCode: "SGD" };
  const [additionalBanks, setAdditionalBanks] = useState<Array<Record<string, string>>>([]);
  const setBankField = (i: number, key: string, val: string) =>
    setAdditionalBanks((arr) => arr.map((b, j) => (j === i ? { ...b, [key]: val } : b)));
  const [qrUploading, setQrUploading] = useState(false);
  const qrFileRef = useRef<HTMLInputElement | null>(null);

  // When organization data becomes available, re-populate the form
  useEffect(() => {
    reset(defaultValues);
    setPaynowQrKey((organization as any)?.bankDetails?.paynowQrKey || "");
    setAdditionalBanks(
      Array.isArray((organization as any)?.bankDetails?.additionalBanks)
        ? (organization as any).bankDetails.additionalBanks
        : []
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultValues, reset]);

  // Available document types that can be customized (labels: settings.companyProfile.docNames.<code>)
  const docName = (code: string) => t(`docNames.${code}`);
  const availableDocumentTypes: Array<{ code: string }> = [
    { code: "TI" },
    { code: "QO1" },
    { code: "QO2" },
    { code: "DO" },
    { code: "RDO" },
    { code: "MSR" },
    { code: "PO" },
    { code: "PR" },
    { code: "SO" },
    { code: "DN" },
    { code: "CN" },
    { code: "SAI" },
    { code: "SAO" },
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
      toast.error(t("missingAuth"));
      return;
    }

    const toastId = toast.loading(t("saving"));

    // Extract keys from FormImage values
    const payload: any = {
      name: data.name,
      address: data.address,
      phoneNumber: data.phoneNumber,
      registrationNumber: data.registrationNumber,
      email: (data.email || "").trim(),
      website: (data.website || "").trim(),
      // Tax rate + inclusive/exclusive now live in Accounting Setup → Financial
      // Settings (single source of truth). Only the per-doc "tax applicable"
      // default remains org-level.
      taxApplicable: !!data.taxApplicable,
      defaultCurrency: (data.defaultCurrency || "SGD").toUpperCase(),
      docTypeDefaults: data.docTypeDefaults || {},
      customDocumentTypes: data.customDocumentTypes,
      bankDetails: {
        accountName: data.bankAccountName || "",
        accountNumber: data.bankAccountNumber || "",
        bankName: data.bankName || "",
        swiftCode: data.bankSwiftCode || "",
        branchCode: data.bankBranchCode || "",
        bankCode: data.bankCode || "",
        currencyCode: data.bankCurrencyCode || "SGD",
        // PayNow QR for the public Click-to-pay page.
        paynowQrKey: paynowQrKey || "",
        paynowUen: (data.paynowUen || "").trim(),
        // Extra accounts printed with "OR" separators; drop all-empty rows.
        additionalBanks: additionalBanks.filter((b) =>
          Object.entries(b).some(([k, v]) => k !== "currencyCode" && String(v || "").trim())
        ),
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
        toast.update(toastId, { render: t("saved"), type: "success", isLoading: false, autoClose: 2000 });
      } else {
        const msg = json?.message || t("failedStatus", { status: res.status });
        toast.update(toastId, { render: msg, type: "error", isLoading: false, autoClose: 4000 });
      }
    } catch (e: any) {
      console.error("[OrgSettings] PATCH error", e);
      toast.update(toastId, { render: e?.message || t("saveFailed"), type: "error", isLoading: false, autoClose: 4000 });
    }
    // no hard refresh here; OrganizationContext will continue returning previous values until reload
  };

  const tabs: { value: typeof activeTab; label: string }[] = [
    { value: "general", label: t("tabs.general") },
    { value: "bank", label: t("tabs.bank") },
    { value: "branding", label: t("tabs.branding") },
    { value: "documents", label: t("tabs.documents") },
    { value: "docDefaults", label: t("tabs.docDefaults") },
  ];

  return (
    <Box sx={{ p: { xs: 1.5, md: 3 }, display: "flex", flexDirection: "column", gap: 2 }}>
      <Typography variant="h5" sx={{ fontWeight: 700 }}>
        {t("title")}
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
          {tabs.map((tab) => (
            <Tab key={tab.value} value={tab.value} label={tab.label} />
          ))}
        </Tabs>
      </Box>

      <Box component="form" onSubmit={handleSubmit(onSubmit)} sx={{ display: "flex", flexDirection: "column", gap: 2, maxWidth: 720 }}>
        {activeTab === "general" && (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <FormInputBox control={control} name="name" label={t("orgName")} placeHolder={t("orgNamePh")} />
            <FormInputBox control={control} name="address" label={t("address")} placeHolder={t("addressPh")} />
            <FormInputBox control={control} name="phoneNumber" label={t("phone")} placeHolder={t("phonePh")} />
            <FormInputBox control={control} name="registrationNumber" label={t("regNo")} placeHolder={t("regNoPh")} />
            <FormInputBox control={control} name="email" label={t("email")} placeHolder={t("emailPh")} />
            <FormInputBox control={control} name="website" label={t("website")} placeHolder={t("websitePh")} />
            <FormSelect
              control={control}
              name="defaultCurrency"
              label={t("defaultCurrency")}
              menuTitle={t("defaultCurrency")}
              placeHolder={t("defaultCurrencyPh")}
              menuItems={CURRENCY_OPTIONS.map((o) => ({ ...o, label: t(`currencies.${o.value}`) }))}
            />
          </Box>
        )}

        {activeTab === "bank" && (
          <Box>
            <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 600 }}>
              {t("tabs.bank")}
            </Typography>
            <Typography variant="body2" sx={{ mb: 2, color: "text.secondary" }}>
              {t("bankHint")}
            </Typography>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
              <FormInputBox control={control} name="bankAccountName" label={t("accountName")} placeHolder={t("accountNamePh")} />
              <FormInputBox control={control} name="bankAccountNumber" label={t("accountNumber")} placeHolder={t("accountNumberPh")} />
              <FormInputBox control={control} name="bankName" label={t("bankName")} placeHolder={t("bankNamePh")} />
              <FormInputBox control={control} name="bankSwiftCode" label={t("swift")} placeHolder={t("swiftPh")} />
              <Box sx={{ display: "flex", gap: 2, flexDirection: { xs: "column", sm: "row" } }}>
                <Box sx={{ flex: 1 }}>
                  <FormInputBox control={control} name="bankBranchCode" label={t("branchCode")} placeHolder={t("branchCodePh")} />
                </Box>
                <Box sx={{ flex: 1 }}>
                  <FormInputBox control={control} name="bankCode" label={t("bankCode")} placeHolder={t("bankCodePh")} />
                </Box>
                <Box sx={{ flex: 1 }}>
                  <FormInputBox control={control} name="bankCurrencyCode" label={t("currencyCode")} placeHolder={t("currencyCodePh")} />
                </Box>
                <Box sx={{ flex: 1 }}>
                  <FormInputBox control={control} name="paynowUen" label="PayNow UEN" placeHolder={t("uenPh")} />
                </Box>
              </Box>

              {/* Additional banks — printed under the first bank with an "OR"
                  between each on invoices/documents (guru 2026-09-09). */}
              <Box sx={{ mt: 2 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>{t("additionalBanks")}</Typography>
                <Typography variant="body2" sx={{ color: "text.secondary", mb: 1 }}>
                  {t("additionalBanksHint")}
                </Typography>
                {additionalBanks.map((b, i) => (
                  <Box key={i} sx={{ border: 1, borderColor: "divider", borderRadius: 2, p: 2, mb: 1.5 }}>
                    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1 }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>{t("bankN", { n: i + 2 })}</Typography>
                      <Button size="small" color="error" startIcon={<DeleteIcon />} onClick={() => setAdditionalBanks((arr) => arr.filter((_, j) => j !== i))}>
                        {t("remove")}
                      </Button>
                    </Box>
                    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
                      <TextField size="small" fullWidth label={t("accountName")} value={b.accountName || ""} onChange={(e) => setBankField(i, "accountName", e.target.value)} />
                      <TextField size="small" fullWidth label={t("accountNumber")} value={b.accountNumber || ""} onChange={(e) => setBankField(i, "accountNumber", e.target.value)} />
                      <TextField size="small" fullWidth label={t("bankName")} value={b.bankName || ""} onChange={(e) => setBankField(i, "bankName", e.target.value)} />
                      <TextField size="small" fullWidth label={t("swift")} value={b.swiftCode || ""} onChange={(e) => setBankField(i, "swiftCode", e.target.value)} />
                      <Box sx={{ display: "flex", gap: 2, flexDirection: { xs: "column", sm: "row" } }}>
                        <TextField size="small" sx={{ flex: 1 }} label={t("branchCode")} value={b.branchCode || ""} onChange={(e) => setBankField(i, "branchCode", e.target.value)} />
                        <TextField size="small" sx={{ flex: 1 }} label={t("bankCode")} value={b.bankCode || ""} onChange={(e) => setBankField(i, "bankCode", e.target.value)} />
                        <TextField size="small" sx={{ flex: 1 }} label={t("currencyCode")} value={b.currencyCode || ""} onChange={(e) => setBankField(i, "currencyCode", e.target.value)} />
                      </Box>
                    </Box>
                  </Box>
                ))}
                <Button variant="outlined" startIcon={<AddIcon />} onClick={() => setAdditionalBanks((arr) => [...arr, { ...emptyBank }])}>
                  {t("addBank")}
                </Button>
              </Box>

              {/* PayNow QR — shown on the public Click-to-pay page linked from
                  invoice emails (guru 2026-08-06; moved here from Accounting
                  Setup so all payment info lives in one place). */}
              <Box sx={{ mt: 1 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>PayNow QR</Typography>
                <Typography variant="body2" sx={{ color: "text.secondary", mb: 1 }}>
                  {t("qrHint")}
                </Typography>
                <input
                  hidden
                  ref={qrFileRef}
                  type="file"
                  accept="image/*"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (!f) return;
                    setQrUploading(true);
                    try {
                      const token = await getToken();
                      if (!token) throw new Error(t("notAuthenticated"));
                      const up: any = await uploadFile({ file: f, folder: "payment-details", token });
                      setPaynowQrKey(up?.fileKey || up?.key || "");
                      toast.success(t("qrUploaded"));
                    } catch (err: any) {
                      toast.error(err?.message || t("uploadFailed"));
                    } finally {
                      setQrUploading(false);
                    }
                  }}
                />
                <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
                  <Button variant="outlined" disabled={qrUploading} onClick={() => qrFileRef.current?.click()}>
                    {qrUploading ? t("uploading") : paynowQrKey ? t("replaceQr") : t("uploadQr")}
                  </Button>
                  {paynowQrKey && (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`${process.env.NEXT_PUBLIC_RESOURCE_URL ?? "https://aims-osiris.s3.ap-southeast-1.amazonaws.com/"}${paynowQrKey}`}
                        alt="PayNow QR"
                        style={{ maxHeight: 110, borderRadius: 8 }}
                      />
                      <Button size="small" color="error" onClick={() => setPaynowQrKey("")}>{t("remove")}</Button>
                    </>
                  )}
                </Box>
              </Box>
            </Box>
          </Box>
        )}

        {activeTab === "branding" && (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <Box>
              <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 600 }}>
                {t("logo")}
              </Typography>
              <FormImage control={control} name="logo" numberOfUploaders={1} />
            </Box>

            <Box>
              <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 600 }}>
                {t("stamp")}
              </Typography>
              <FormImage control={control} name="defaultStamp" numberOfUploaders={1} />
            </Box>
          </Box>
        )}

        {activeTab === "documents" && (
          <Box>
            <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 600 }}>
              {t("customNames")}
            </Typography>
            <Typography variant="body2" sx={{ mb: 2, color: "text.secondary" }}>
              {t("customNamesHint")}
            </Typography>

            {Object.entries(customDocumentTypes).map(([docType]) => {
              const docInfo = availableDocumentTypes.find((d) => d.code === docType);
              return (
                <Box key={docType} sx={{ mb: 2, p: 2, border: 1, borderColor: "divider", borderRadius: 1 }}>
                  <Grid2 container spacing={2} alignItems="center">
                    <Grid2 size={3}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {docInfo ? docName(docInfo.code) : docType}
                      </Typography>
                      <Typography variant="caption" sx={{ color: "text.secondary" }}>
                        {t("code", { code: docType })}
                      </Typography>
                    </Grid2>
                    <Grid2 size={7}>
                      <FormInputBox control={control} name={`customDocumentTypes.${docType}`} label={t("customDisplayName")} placeHolder={t("customDisplayNamePh", { name: docInfo ? docName(docInfo.code) : docType })} size="small" onChange={(e) => updateCustomDocumentType(docType, e.target.value)} />
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
                  <Chip key={docType.code} label={t("addDocType", { name: docName(docType.code) })} onClick={() => addCustomDocumentType(docType.code)} icon={<AddIcon />} variant="outlined" clickable sx={{ mb: 1 }} />
                ))}
            </Box>
          </Box>
        )}

        {activeTab === "docDefaults" && <DocDefaultsTab control={control} setValue={setValue} />}

        <Divider sx={{ mt: 1 }} />
        <Button type="submit" variant="contained" color="primary" sx={{ alignSelf: "flex-start" }}>
          {t("save")}
        </Button>
      </Box>
    </Box>
  );
}

/**
 * Per-doc-type default editor. User picks a doc type from the dropdown,
 * fills T&Cs / Notes / Footer for THAT type, and moves on; saving on the
 * outer form persists the whole `docTypeDefaults` map onto the org.
 *
 * Local state holds the in-progress map; `setValue("docTypeDefaults", …)`
 * keeps the form payload synced so the outer "Save" button picks it up.
 */
function DocDefaultsTab({ control, setValue }: { control: any; setValue: (n: string, v: any) => void }) {
  const t = useTranslations("settings.companyProfile.docDefaults");
  const { getToken } = useAuth();
  // Watch the current docTypeDefaults so we hydrate the visible fields when
  // the user switches type. Direct subscription via useWatch from react-hook-form.
  const all = useWatch({ control, name: "docTypeDefaults" }) || {};
  const [selectedType, setSelectedType] = useState<string>("");
  const [docTypes, setDocTypes] = useState<{ code: string; label: string }[]>([]);
  const [loadingTypes, setLoadingTypes] = useState(true);

  // Friendly labels for the well-known codes. Anything not in this map gets
  // the template's actual `name` field as a fallback, with the raw code in
  // parens so the user can still tell what it is.
  const KNOWN_LABELS: Record<string, string> = {
    QUOTATION: "Quotation",
    QO1: "Quotation — Style 1",
    QO2: "Quotation — Style 2",
    QT: "Quotation",
    QF: "FCU-CU Quotation",
    SO: "Sales Order",
    PO: "Purchase Order",
    PURCHASE_ORDER: "Purchase Order",
    PR: "Purchase Return",
    DO: "Delivery Order",
    DELIVERY_ORDER: "Delivery Order",
    RDO: "Return Delivery Order",
    INVOICE: "Invoice",
    TI: "Tax Invoice — Style 1",
    TI2: "Tax Invoice — Style 2",
    DN: "Debit Note",
    CN: "Credit Note",
    MSR: "Maintenance Service Report",
    SAI: "Stock Adjustment In",
    SAO: "Stock Adjustment Out",
  };

  // Fetch the activated DocumentTemplates for this org (the list endpoint
  // accepts a paged search; bump the limit high so we get them all in one
  // round-trip — orgs rarely have more than ~30 templates). Dedupe by type
  // so a multi-style invoice template (TI + TI2) shows as both entries.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        const res = await request(
          { path: "/documentTemplates", method: "POST" },
          { limit: 200, page: 1 },
          token ?? undefined,
        );
        const docs: any[] = res?.data?.docs || [];
        const seen = new Set<string>();
        const list: { code: string; label: string }[] = [];
        for (const tpl of docs) {
          const code = String(tpl?.type || "").trim();
          if (!code || seen.has(code)) continue;
          seen.add(code);
          const friendly = KNOWN_LABELS[code] ? t(`known.${code}`) : undefined;
          const label = friendly || (tpl?.name ? `${tpl.name} (${code})` : code);
          list.push({ code, label });
        }
        list.sort((a, b) => a.label.localeCompare(b.label));
        if (!cancelled) setDocTypes(list);
      } catch (err) {
        console.warn("Failed to load doc templates:", err);
      } finally {
        if (!cancelled) setLoadingTypes(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = (selectedType && all[selectedType]) || { tnc: "", notes: "", footerMessage: "" };

  const updateField = (key: "tnc" | "notes" | "footerMessage", value: string) => {
    if (!selectedType) return;
    const next = {
      ...all,
      [selectedType]: { ...current, [key]: value },
    };
    setValue("docTypeDefaults", next);
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
        {t("title")}
      </Typography>
      <Typography variant="body2" sx={{ color: "text.secondary" }}>
        {t("intro")}
      </Typography>

      <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
        <Typography variant="caption" color="text.secondary">{t("docType")}</Typography>
        {loadingTypes ? (
          <Typography variant="caption" color="text.disabled">{t("loadingTemplates")}</Typography>
        ) : docTypes.length === 0 ? (
          <Typography variant="caption" color="warning.main">
            {t("noTemplates")}
          </Typography>
        ) : (
        <Select
          size="small"
          value={selectedType}
          onChange={(e) => setSelectedType(e.target.value as string)}
          displayEmpty
        >
          <MenuItem value=""><em>{t("selectType")}</em></MenuItem>
          {docTypes.map((d) => {
            const hasContent =
              !!all[d.code]?.tnc?.trim() ||
              !!all[d.code]?.notes?.trim() ||
              !!all[d.code]?.footerMessage?.trim();
            return (
              <MenuItem key={d.code} value={d.code}>
                {d.label}
                {hasContent && (
                  <Chip
                    size="small"
                    label={t("set")}
                    variant="outlined"
                    color="success"
                    sx={{ ml: 1, height: 18, fontSize: "0.65rem" }}
                  />
                )}
              </MenuItem>
            );
          })}
        </Select>
        )}
      </Box>

      {selectedType ? (
        <>
          <TextField
            label={t("tnc")}
            multiline
            minRows={4}
            value={current.tnc || ""}
            onChange={(e) => updateField("tnc", e.target.value)}
            placeholder={t("tncPh")}
            fullWidth
          />
          <TextField
            label={t("notes")}
            multiline
            minRows={3}
            value={current.notes || ""}
            onChange={(e) => updateField("notes", e.target.value)}
            placeholder={t("notesPh")}
            fullWidth
          />
          <TextField
            label={t("footer")}
            multiline
            minRows={2}
            value={current.footerMessage || ""}
            onChange={(e) => updateField("footerMessage", e.target.value)}
            placeholder={t("footerPh")}
            fullWidth
          />
          <Box>
            <Button
              size="small"
              color="error"
              onClick={() => {
                if (!selectedType) return;
                const next = { ...all };
                delete next[selectedType];
                setValue("docTypeDefaults", next);
              }}
            >
              {t("clear")}
            </Button>
          </Box>
        </>
      ) : (
        <Typography variant="caption" color="text.secondary">
          {t("pick")}
        </Typography>
      )}
    </Box>
  );
}
