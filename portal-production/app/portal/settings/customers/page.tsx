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

const PL = [
  { value: "CUSTOMER_PL_KATO", label: "計量検収票 — Kato layout" },
  { value: "CUSTOMER_PL_SUS", label: "計量検収票 — SUS (format not yet confirmed)" },
  { value: "CUSTOMER_PL_HOEI", label: "計量検収票 — Hoei (format not yet confirmed)" },
];
const COA = [
  { value: "CUSTOMER_COA_KATO", label: "納品書兼分析試験成績報告書 — Kato layout" },
  { value: "CUSTOMER_COA_SUS", label: "納品書兼分析試験成績報告書 — SUS (format not yet confirmed)" },
  { value: "CUSTOMER_COA_HOEI", label: "納品書兼分析試験成績報告書 — Hoei (format not yet confirmed)" },
];

const blank = (customerId: string): CustomerProfile => ({ customerId, billingMode: "TWO_STAGE", sendImportPermit: true, truckCapacityT: 20, docVariants: {} });

export default function CustomerProfilesPage() {
  const { isModuleEnabled, loading } = useConfiguration() as { isModuleEnabled: (code: string) => boolean; loading?: boolean };
  const settings = useTradeSettings();
  const customers = useCustomers();
  if (!loading && !showShippingSettings(isModuleEnabled)) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="info">Customer profiles are for organizations with the Shipments module.</Alert>
      </Box>
    );
  }
  return (
    <TradeTheme>
      <Box sx={{ p: { xs: 1.5, md: 3 }, maxWidth: 1000, mx: "auto" }}>
        <Typography variant="h5" sx={{ fontWeight: 800 }}>
          Customers
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          How each trade customer is billed and served. Steps that don&apos;t apply to a customer show as &quot;N/A (customer profile)&quot; on its orders.
        </Typography>
        {settings.isLoading || customers.isLoading ? (
          <CircularProgress />
        ) : (
          <Stack spacing={2.5}>
            {(customers.data ?? []).map((c) => (
              <ProfileCard key={c.id} customer={c} profile={settings.data?.customerProfiles?.[c.id] ?? null} banks={(settings.data?.docDefaults?.banks as BankAccount[] | undefined) ?? []} />
            ))}
            {!(customers.data ?? []).length && <Alert severity="info">No customers yet — add them in Master Files.</Alert>}
          </Stack>
        )}
        <Typography variant="h5" sx={{ fontWeight: 800, mt: 5 }}>
          Suppliers
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Whether a supplier issues a PI (deposit on step 1) and which documents it sends with a shipment.
        </Typography>
        <SupplierProfilesPanel />
      </Box>
    </TradeTheme>
  );
}

function ProfileCard({ customer, profile, banks }: { customer: { id: string; name: string }; profile: CustomerProfile | null; banks: BankAccount[] }) {
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
      toast.success(`${customer.name}: profile saved`);
      setDirty(false);
    } catch (e: any) {
      toast.error(e?.message || "Could not save the profile");
    }
  };
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.5 } }} data-tour="customer-profile-card">
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
        <Typography variant="h6" sx={{ fontWeight: 700, flex: 1 }}>
          {customer.name}
        </Typography>
        {!profile && <Chip size="small" variant="outlined" label="No profile yet (TWO_STAGE default)" />}
        <Chip size="small" color={p.billingMode === "SINGLE" ? "secondary" : "default"} label={p.billingMode === "SINGLE" ? "Single invoice" : "Invoice #1 + #2"} />
      </Stack>
      <Grid2 container spacing={1.5}>
        <Grid2 size={{ xs: 12, sm: 4 }}>
          <TextField select size="small" fullWidth label="Billing mode" value={p.billingMode} onChange={(e) => set({ billingMode: e.target.value as any })} data-tour="profile-billing-mode">
            <MenuItem value="TWO_STAGE">TWO_STAGE — Invoice #1 (prev. month LME) + Invoice #2 (final − #1)</MenuItem>
            <MenuItem value="SINGLE">SINGLE — one invoice after the B/L (shipment-month LME), due in 5 business days</MenuItem>
          </TextField>
        </Grid2>
        <Grid2 size={{ xs: 12, sm: 4 }}>
          <FormControlLabel control={<Switch checked={p.sendImportPermit} onChange={(e) => set({ sendImportPermit: e.target.checked })} />} label="Send the import permit to the customer" />
        </Grid2>
        <Grid2 size={{ xs: 6, sm: 2 }}>
          <TextField size="small" fullWidth label="Short key" value={p.key ?? ""} onChange={(e) => set({ key: e.target.value })} placeholder="SUS / KATO" />
        </Grid2>
        <Grid2 size={{ xs: 6, sm: 2 }}>
          <TextField size="small" fullWidth label="Port" value={p.port ?? ""} onChange={(e) => set({ port: e.target.value })} placeholder="Yokohama" />
        </Grid2>
        <Grid2 size={{ xs: 6, sm: 3 }}>
          <TextField select size="small" fullWidth label="Truck size" value={p.truckCapacityT} onChange={(e) => set({ truckCapacityT: Number(e.target.value) })}>
            <MenuItem value={20}>20 t (¥98,000 / truck)</MenuItem>
            <MenuItem value={10}>10 t (¥26,000 / truck)</MenuItem>
          </TextField>
        </Grid2>
        <Grid2 size={{ xs: 6, sm: 3 }}>
          <TextField select size="small" fullWidth label="通関 rate (¥/MT)" value={p.customsRatePerMt ?? 2800} onChange={(e) => set({ customsRatePerMt: Number(e.target.value) })}>
            <MenuItem value={2800}>¥2,800 (Yokohama)</MenuItem>
            <MenuItem value={2300}>¥2,300 (Nagoya)</MenuItem>
          </TextField>
        </Grid2>
        <Grid2 size={{ xs: 12, sm: 6 }}>
          <TextField
            select
            size="small"
            fullWidth
            label="Default bank account (invoices)"
            value={banks.some((b) => b.id === p.defaultBankId) ? p.defaultBankId : ""}
            onChange={(e) => set({ defaultBankId: e.target.value || undefined, defaultBankCheck: undefined })}
            helperText={p.defaultBankCheck ? "check — not confirmed by ADH yet; pick the account to confirm" : "Preselected on this customer's invoices; any entity's account"}
            FormHelperTextProps={{ sx: p.defaultBankCheck ? { color: "warning.main" } : undefined }}
            data-tour="settings-customer-bank"
          >
            <MenuItem value="">Org default</MenuItem>
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
            label="Email domains (intake matching)"
            value={(p.emailDomains ?? []).join(", ")}
            onChange={(e) => set({ emailDomains: e.target.value.split(/[,\s]+/).filter(Boolean) })}
            placeholder="customer.co.jp"
          />
        </Grid2>
        <Grid2 size={{ xs: 12, sm: 6 }}>
          <TextField select size="small" fullWidth label="Customer PL template" value={p.docVariants.CUSTOMER_PL ?? "CUSTOMER_PL_KATO"} onChange={(e) => set({ docVariants: { ...p.docVariants, CUSTOMER_PL: e.target.value } })}>
            {PL.map((o) => (
              <MenuItem key={o.value} value={o.value}>
                {o.label}
              </MenuItem>
            ))}
          </TextField>
        </Grid2>
        <Grid2 size={{ xs: 12, sm: 6 }}>
          <TextField select size="small" fullWidth label="Customer COA template" value={p.docVariants.CUSTOMER_COA ?? "CUSTOMER_COA_KATO"} onChange={(e) => set({ docVariants: { ...p.docVariants, CUSTOMER_COA: e.target.value } })}>
            {COA.map((o) => (
              <MenuItem key={o.value} value={o.value}>
                {o.label}
              </MenuItem>
            ))}
          </TextField>
        </Grid2>
        <Grid2 size={12}>
          <TextField
            size="small"
            fullWidth
            label="宛先 on the 計量検収票 / 納品書兼分析試験成績報告書"
            value={p.docAddressee ?? ""}
            onChange={(e) => set({ docAddressee: e.target.value })}
            placeholder="Blank = the Japanese legal name (e.g. SUS株式会社 福島製造グループ)"
            helperText="Printed before 御中; the address and contact come from the customer record"
            data-tour="settings-customer-addressee"
          />
        </Grid2>
        <Grid2 size={12}>
          <Typography variant="overline" color="text.secondary">
            Delivery site (出庫・納入依頼書)
          </Typography>
        </Grid2>
        <Grid2 size={{ xs: 12, sm: 4 }}>
          <TextField size="small" fullWidth label="Site name (納入先)" value={dp.siteName} onChange={(e) => set({ deliveryProfile: { ...dp, siteName: e.target.value } })} />
        </Grid2>
        <Grid2 size={{ xs: 12, sm: 8 }}>
          <TextField size="small" fullWidth label="Address" value={dp.address} onChange={(e) => set({ deliveryProfile: { ...dp, address: e.target.value } })} />
        </Grid2>
        <Grid2 size={12}>
          <TextField size="small" fullWidth multiline minRows={2} label="Notes (one 備考 line each)" value={dp.notes} onChange={(e) => set({ deliveryProfile: { ...dp, notes: e.target.value } })} />
        </Grid2>
        {p.billingMode === "SINGLE" && (
          <Grid2 size={12}>
            <TextField
              size="small"
              fullWidth
              multiline
              minRows={4}
              label="Single invoice 備考 (商品 / 荷姿 / 保管倉庫 / 取扱港 / 保管条件 / 業務範囲 / 作業備考)"
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
          Discard changes
        </Button>
        <Button variant="contained" disabled={!dirty || save.isPending} onClick={() => void submit()}>
          {save.isPending ? "Saving…" : "Save profile"}
        </Button>
      </Stack>
    </Paper>
  );
}
