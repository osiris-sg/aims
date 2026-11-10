/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Org Settings → Customers (orgs with the Shipments module): one profile per
// trade customer — how it is billed and served:
//   billing mode   TWO_STAGE (SUS: Invoice #1 provisional, Invoice #2 final − #1)
//                  or SINGLE (Kato, Hoei: one invoice after the B/L, due in 5 business days);
//   import permit  sent to the customer or not (step 10's sub-task);
//   port, truck size, customs rate (the cost estimator);
//   document templates (Customer PL / COA / invoice), the delivery site for the
//   出庫・納入依頼書, the single invoice's 備考 block and email domains (intake).
// A changed profile re-marks the N/A steps of the customer's open orders.

import React, { useEffect, useMemo, useState } from "react";
import { Alert, Box, Button, Chip, CircularProgress, FormControlLabel, Grid2, MenuItem, Paper, Stack, Switch, TextField, Typography } from "@mui/material";
import { useConfiguration } from "@/app/portal/context/ConfigurationContext";
import { showShippingSettings } from "@/helpers/settingsVisibility";
import TradeTheme from "@/app/portal/shipments/_components/TradeTheme";
import { useCustomers, useTradeMutation, useTradeSettings } from "@/app/portal/shipments/_lib/hooks";
import SupplierProfilesPanel from "@/app/portal/shipments/_components/SupplierProfilesPanel";
import { bankEntity, type BankAccount, type CustomerProfile } from "@/app/portal/shipments/_lib/api";
import { toast } from "@/app/portal/shipments/_lib/toast";
import { useTranslations } from "next-intl";

// Labels: settings.customers.templates.<value> in the catalogs.
const PL = [{ value: "CUSTOMER_PL_KATO" }, { value: "CUSTOMER_PL_SUS" }, { value: "CUSTOMER_PL_HOEI" }, { value: "CUSTOMER_PL_SUS_XLS" }];
const COA = [{ value: "CUSTOMER_COA_KATO" }, { value: "CUSTOMER_COA_SUS" }, { value: "CUSTOMER_COA_HOEI" }, { value: "CUSTOMER_COA_SUS_SUMMARY" }];

const blank = (customerId: string): CustomerProfile => ({ customerId, billingMode: "TWO_STAGE", sendImportPermit: true, truckCapacityT: 20, docVariants: {} });

export default function CustomerProfilesPage() {
  const { isModuleEnabled, loading } = useConfiguration() as { isModuleEnabled: (code: string) => boolean; loading?: boolean };
  const t = useTranslations("settings.customers");
  const settings = useTradeSettings();
  const customers = useCustomers();
  if (!loading && !showShippingSettings(isModuleEnabled)) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="info">{t("onlyShipments")}</Alert>
      </Box>
    );
  }
  return (
    <TradeTheme>
      <Box sx={{ p: { xs: 1.5, md: 3 }, maxWidth: 1000, mx: "auto" }}>
        <Typography variant="h5" sx={{ fontWeight: 800 }}>
          {t("title")}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          {t("intro")}
        </Typography>
        {settings.isLoading || customers.isLoading ? (
          <CircularProgress />
        ) : (
          <Stack spacing={2.5}>
            {(customers.data ?? []).map((c) => (
              <ProfileCard key={c.id} customer={c} profile={settings.data?.customerProfiles?.[c.id] ?? null} banks={(settings.data?.docDefaults?.banks as BankAccount[] | undefined) ?? []} />
            ))}
            {!(customers.data ?? []).length && <Alert severity="info">{t("none")}</Alert>}
          </Stack>
        )}
        <Typography variant="h5" sx={{ fontWeight: 800, mt: 5 }}>
          {t("suppliers")}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t("suppliersIntro")}
        </Typography>
        <SupplierProfilesPanel />
      </Box>
    </TradeTheme>
  );
}

function ProfileCard({ customer, profile, banks }: { customer: { id: string; name: string }; profile: CustomerProfile | null; banks: BankAccount[] }) {
  const t = useTranslations("settings.customers");
  const initial = useMemo(() => profile ?? blank(customer.id), [profile, customer.id]);
  const [p, setP] = useState<CustomerProfile>(initial);
  const [dirty, setDirty] = useState(false);
  const save = useTradeMutation((a, body: CustomerProfile) => a.updateSettings({ customerProfiles: { [customer.id]: body } }));
  useEffect(() => {
    setP(initial);
    setDirty(false);
  }, [initial]);
  const set = (patch: Partial<CustomerProfile>) => {
    setP((x) => ({ ...x, ...patch }));
    setDirty(true);
  };
  const dp = p.deliveryProfile ?? { siteName: "", address: "", notes: "" };
  const submit = async () => {
    try {
      const body = { ...p, deliveryProfile: dp.siteName || dp.address ? dp : null };
      await save.mutateAsync(body);
      toast.success(t("saved", { name: customer.name }));
      setDirty(false);
    } catch (e: any) {
      toast.error(e?.message || t("couldNotSave"));
    }
  };
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.5 } }} data-tour="customer-profile-card">
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
        <Typography variant="h6" sx={{ fontWeight: 700, flex: 1 }}>
          {customer.name}
        </Typography>
        {!profile && <Chip size="small" variant="outlined" label={t("noProfile")} />}
        <Chip size="small" color={p.billingMode === "SINGLE" ? "secondary" : "default"} label={p.billingMode === "SINGLE" ? t("singleInvoice") : t("twoInvoices")} />
      </Stack>
      <Grid2 container spacing={1.5}>
        <Grid2 size={{ xs: 12, sm: 4 }}>
          <TextField select size="small" fullWidth label={t("billingMode")} value={p.billingMode} onChange={(e) => set({ billingMode: e.target.value as any })} data-tour="profile-billing-mode">
            <MenuItem value="TWO_STAGE">{t("modeTwoStage")}</MenuItem>
            <MenuItem value="SINGLE">{t("modeSingle")}</MenuItem>
          </TextField>
        </Grid2>
        <Grid2 size={{ xs: 12, sm: 4 }}>
          <FormControlLabel control={<Switch checked={p.sendImportPermit} onChange={(e) => set({ sendImportPermit: e.target.checked })} />} label={t("sendImportPermit")} />
        </Grid2>
        <Grid2 size={{ xs: 6, sm: 2 }}>
          <TextField size="small" fullWidth label={t("shortKey")} value={p.key ?? ""} onChange={(e) => set({ key: e.target.value })} placeholder="SUS / KATO" />
        </Grid2>
        <Grid2 size={{ xs: 6, sm: 2 }}>
          <TextField size="small" fullWidth label={t("port")} value={p.port ?? ""} onChange={(e) => set({ port: e.target.value })} placeholder="Yokohama" />
        </Grid2>
        <Grid2 size={{ xs: 6, sm: 3 }}>
          <TextField select size="small" fullWidth label={t("truckSize")} value={p.truckCapacityT} onChange={(e) => set({ truckCapacityT: Number(e.target.value) })}>
            <MenuItem value={20}>{t("truck20")}</MenuItem>
            <MenuItem value={10}>{t("truck10")}</MenuItem>
          </TextField>
        </Grid2>
        <Grid2 size={{ xs: 6, sm: 3 }}>
          <TextField select size="small" fullWidth label={t("customsRate")} value={p.customsRatePerMt ?? 2800} onChange={(e) => set({ customsRatePerMt: Number(e.target.value) })}>
            <MenuItem value={2800}>{t("rateYokohama")}</MenuItem>
            <MenuItem value={2300}>{t("rateNagoya")}</MenuItem>
          </TextField>
        </Grid2>
        <Grid2 size={{ xs: 12, sm: 6 }}>
          <TextField
            select
            size="small"
            fullWidth
            label={t("defaultBank")}
            value={banks.some((b) => b.id === p.defaultBankId) ? p.defaultBankId : ""}
            onChange={(e) => set({ defaultBankId: e.target.value || undefined, defaultBankCheck: undefined })}
            helperText={p.defaultBankCheck ? t("bankCheck") : t("bankHint")}
            FormHelperTextProps={{ sx: p.defaultBankCheck ? { color: "warning.main" } : undefined }}
            data-tour="settings-customer-bank"
          >
            <MenuItem value="">{t("orgDefault")}</MenuItem>
            {banks.map((b) => (
              <MenuItem key={b.id} value={b.id}>
                {b.label} · {bankEntity(b) === "ADH_JP" ? "ADH JP" : "ADH SG"}
              </MenuItem>
            ))}
          </TextField>
        </Grid2>
        <Grid2 size={{ xs: 12, sm: 6 }}>
          <TextField
            size="small"
            fullWidth
            label={t("emailDomains")}
            value={(p.emailDomains ?? []).join(", ")}
            onChange={(e) => set({ emailDomains: e.target.value.split(/[,\s]+/).filter(Boolean) })}
            placeholder="customer.co.jp"
          />
        </Grid2>
        <Grid2 size={{ xs: 12, sm: 6 }}>
          <TextField select size="small" fullWidth label={t("plTemplate")} value={p.docVariants.CUSTOMER_PL ?? "CUSTOMER_PL_KATO"} onChange={(e) => set({ docVariants: { ...p.docVariants, CUSTOMER_PL: e.target.value } })}>
            {PL.map((o) => (
              <MenuItem key={o.value} value={o.value}>
                {t(`templates.${o.value}`)}
              </MenuItem>
            ))}
          </TextField>
        </Grid2>
        <Grid2 size={{ xs: 12, sm: 6 }}>
          <TextField select size="small" fullWidth label={t("coaTemplate")} value={p.docVariants.CUSTOMER_COA ?? "CUSTOMER_COA_KATO"} onChange={(e) => set({ docVariants: { ...p.docVariants, CUSTOMER_COA: e.target.value } })}>
            {COA.map((o) => (
              <MenuItem key={o.value} value={o.value}>
                {t(`templates.${o.value}`)}
              </MenuItem>
            ))}
          </TextField>
        </Grid2>
        <Grid2 size={12}>
          <TextField
            size="small"
            fullWidth
            label={t("addressee")}
            value={p.docAddressee ?? ""}
            onChange={(e) => set({ docAddressee: e.target.value })}
            placeholder={t("addresseePlaceholder")}
            helperText={t("addresseeHint")}
            data-tour="settings-customer-addressee"
          />
        </Grid2>
        <Grid2 size={12}>
          <Typography variant="overline" color="text.secondary">
            {t("deliverySite")}
          </Typography>
        </Grid2>
        <Grid2 size={{ xs: 12, sm: 4 }}>
          <TextField size="small" fullWidth label={t("siteName")} value={dp.siteName} onChange={(e) => set({ deliveryProfile: { ...dp, siteName: e.target.value } })} />
        </Grid2>
        <Grid2 size={{ xs: 12, sm: 8 }}>
          <TextField size="small" fullWidth label={t("address")} value={dp.address} onChange={(e) => set({ deliveryProfile: { ...dp, address: e.target.value } })} />
        </Grid2>
        {/* Round BA: 倉庫名 on this customer's 出庫・納入依頼書. A non-Yokohama site
            (Kato, Nagoya) is otherwise left blank to check; a name clears that. */}
        <Grid2 size={{ xs: 12, sm: 6 }}>
          <TextField
            size="small"
            fullWidth
            label={t("warehouseName")}
            helperText={t("warehouseNameHint")}
            value={dp.warehouseName ?? ""}
            onChange={(e) =>
              set({ deliveryProfile: { ...dp, warehouseName: e.target.value, ...(e.target.value.trim() ? { warehouseCheck: false } : {}) } })
            }
          />
        </Grid2>
        <Grid2 size={12}>
          <TextField size="small" fullWidth multiline minRows={2} label={t("notes")} value={dp.notes} onChange={(e) => set({ deliveryProfile: { ...dp, notes: e.target.value } })} />
        </Grid2>
        {p.billingMode === "SINGLE" && (
          <>
            {/* Round BO: Kato is invoiced on step 2 (after the shipping documents), not step 11. */}
            <Grid2 size={{ xs: 12, sm: 6 }}>
              <TextField select size="small" fullWidth label={t("invoiceStep")} value={p.singleInvoiceStep ?? "INVOICE_2"} onChange={(e) => set({ singleInvoiceStep: e.target.value as any })} helperText={t("invoiceStepHelp")} data-tour="profile-invoice-step">
                <MenuItem value="INVOICE_1">{t("invoiceStep2")}</MenuItem>
                <MenuItem value="INVOICE_2">{t("invoiceStep11")}</MenuItem>
              </TextField>
            </Grid2>
            <Grid2 size={{ xs: 12, sm: 6 }}>
              <TextField size="small" fullWidth type="number" label={t("customsFlat")} value={p.customsFlatJpy ?? ""} onChange={(e) => set({ customsFlatJpy: e.target.value === "" ? null : Number(e.target.value) })} helperText={t("customsFlatHelp")} />
            </Grid2>
          </>
        )}
        {p.billingMode === "SINGLE" && (
          <Grid2 size={12}>
            <TextField
              size="small"
              fullWidth
              multiline
              minRows={4}
              label={t("invoiceRemarks")}
              value={p.invoiceRemarks ?? ""}
              onChange={(e) => set({ invoiceRemarks: e.target.value })}
            />
          </Grid2>
        )}
      </Grid2>
      <Stack direction="row" justifyContent="flex-end" spacing={1} sx={{ mt: 2 }}>
        <Button
          disabled={!dirty || save.isPending}
          onClick={() => {
            setP(initial);
            setDirty(false);
          }}
        >
          {t("discard")}
        </Button>
        <Button variant="contained" disabled={!dirty || save.isPending} onClick={() => void submit()}>
          {save.isPending ? t("saving") : t("save")}
        </Button>
      </Stack>
    </Paper>
  );
}
