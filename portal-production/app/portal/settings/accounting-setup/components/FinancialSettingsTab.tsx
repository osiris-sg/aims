"use client";

import { useEffect, useState } from "react";
import {
  Box,
  Button,
  CircularProgress,
  Divider,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";

// Consolidated, Xero-style "Financial Settings" — currency, financial year end,
// GST (tax basis / ID / period), tax defaults (sales & purchases inclusive vs
// exclusive), period lock date, and time zone. Single source of truth on
// AccountingSetting; the backend mirrors the rate + sales-inclusive flag onto
// Organization for legacy readers.

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const TIME_ZONES = [
  "Asia/Singapore",
  "Asia/Kuala_Lumpur",
  "Asia/Jakarta",
  "Asia/Bangkok",
  "Asia/Hong_Kong",
  "Asia/Tokyo",
  "Asia/Manila",
  "Australia/Sydney",
  "UTC",
];

type Settings = {
  baseCurrency?: string;
  fiscalYearEndDay?: number;
  fiscalYearEndMonth?: number;
  taxBasis?: string;
  taxRegistrationNumber?: string;
  taxReference?: string;
  taxPeriod?: string;
  taxDefaultPercentage?: number;
  salesTaxInclusive?: boolean;
  purchasesTaxInclusive?: boolean;
  lockedThroughDate?: string | null;
  timeZone?: string;
  currencyRates?: Record<string, number>;
};

type RateRow = { code: string; rate: string };

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <Box sx={{ mb: 3.5 }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: hint ? 0.25 : 1.5 }}>
        {title}
      </Typography>
      {hint && (
        <Typography variant="caption" sx={{ color: "text.secondary", display: "block", mb: 1.5 }}>
          {hint}
        </Typography>
      )}
      {children}
    </Box>
  );
}

export default function FinancialSettingsTab({
  settings,
  loading,
  onSave,
}: {
  settings: Settings | null;
  loading: boolean;
  onSave: (updates: any) => Promise<void> | void;
}) {
  const [form, setForm] = useState<Settings>({});
  const [rates, setRates] = useState<RateRow[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setRates(Object.entries(settings?.currencyRates || {}).map(([code, rate]) => ({ code, rate: String(rate) })));
    setForm({
      baseCurrency: settings?.baseCurrency || "SGD",
      fiscalYearEndDay: settings?.fiscalYearEndDay ?? 31,
      fiscalYearEndMonth: settings?.fiscalYearEndMonth ?? 12,
      taxBasis: settings?.taxBasis || "ACCRUAL",
      taxRegistrationNumber: settings?.taxRegistrationNumber || "",
      taxReference: settings?.taxReference || "GST",
      taxPeriod: settings?.taxPeriod || "QUARTERLY",
      taxDefaultPercentage: settings?.taxDefaultPercentage ?? 9,
      salesTaxInclusive: settings?.salesTaxInclusive ?? false,
      purchasesTaxInclusive: settings?.purchasesTaxInclusive ?? false,
      lockedThroughDate: settings?.lockedThroughDate ? String(settings.lockedThroughDate).slice(0, 10) : "",
      timeZone: settings?.timeZone || "Asia/Singapore",
    });
  }, [settings]);

  const set = (patch: Partial<Settings>) => setForm((f) => ({ ...f, ...patch }));

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({
        baseCurrency: form.baseCurrency,
        fiscalYearEndDay: Number(form.fiscalYearEndDay) || 31,
        fiscalYearEndMonth: Number(form.fiscalYearEndMonth) || 12,
        taxBasis: form.taxBasis,
        taxRegistrationNumber: form.taxRegistrationNumber,
        taxReference: form.taxReference,
        taxPeriod: form.taxPeriod,
        taxDefaultPercentage: Number(form.taxDefaultPercentage) || 0,
        salesTaxInclusive: !!form.salesTaxInclusive,
        purchasesTaxInclusive: !!form.purchasesTaxInclusive,
        lockedThroughDate: form.lockedThroughDate || null,
        timeZone: form.timeZone,
        currencyRates: Object.fromEntries(
          rates
            .filter((r) => r.code.trim() && Number(r.rate) > 0)
            .map((r) => [r.code.trim().toUpperCase(), Number(r.rate)]),
        ),
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", p: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  const sx = { width: { xs: "100%", sm: 240 } };

  return (
    <Box sx={{ maxWidth: 760 }}>
      <Section title="Currency">
        <TextField
          select
          size="small"
          label="Base currency"
          value={form.baseCurrency || "SGD"}
          onChange={(e) => set({ baseCurrency: e.target.value })}
          sx={sx}
        >
          {["SGD", "USD", "MYR", "EUR", "GBP", "JPY", "AUD", "HKD"].map((c) => (
            <MenuItem key={c} value={c}>{c}</MenuItem>
          ))}
        </TextField>
      </Section>

      <Section
        title="Currency rates"
        hint={`Standing rates locked by the accountant: 1 unit of the foreign currency = rate in ${form.baseCurrency || "SGD"}. Every foreign-currency document posts to the ledger at the rate current when it is confirmed; the realised difference on settlement posts to the FX gain/loss account. Rates apply until updated here.`}
      >
        <Stack gap={1}>
          {rates.map((r, i) => (
            <Stack key={i} direction="row" gap={1.5} alignItems="center">
              <TextField
                size="small" label="Currency" value={r.code} sx={{ width: 120 }}
                onChange={(e) => setRates((rs) => rs.map((x, xi) => (xi === i ? { ...x, code: e.target.value.toUpperCase() } : x)))}
                placeholder="USD"
              />
              <TextField
                size="small" label={`Rate to ${form.baseCurrency || "SGD"}`} type="number" value={r.rate} sx={{ width: 160 }}
                onChange={(e) => setRates((rs) => rs.map((x, xi) => (xi === i ? { ...x, rate: e.target.value } : x)))}
                placeholder="1.35"
                inputProps={{ step: "0.0001", min: 0 }}
              />
              <Typography variant="caption" color="text.secondary">
                {r.code && Number(r.rate) > 0 ? `1 ${r.code} = ${r.rate} ${form.baseCurrency || "SGD"}` : ""}
              </Typography>
              <Button size="small" color="inherit" onClick={() => setRates((rs) => rs.filter((_, xi) => xi !== i))}>
                Remove
              </Button>
            </Stack>
          ))}
          <Box>
            <Button size="small" variant="outlined" onClick={() => setRates((rs) => [...rs, { code: "", rate: "" }])}>
              Add currency
            </Button>
          </Box>
        </Stack>
      </Section>

      <Divider sx={{ mb: 3 }} />

      <Section title="Financial Year End">
        <Stack direction="row" gap={2}>
          <TextField
            select
            size="small"
            label="Day"
            value={form.fiscalYearEndDay ?? 31}
            onChange={(e) => set({ fiscalYearEndDay: Number(e.target.value) })}
            sx={{ width: 120 }}
          >
            {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
              <MenuItem key={d} value={d}>{d}</MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            label="Month"
            value={form.fiscalYearEndMonth ?? 12}
            onChange={(e) => set({ fiscalYearEndMonth: Number(e.target.value) })}
            sx={{ width: 180 }}
          >
            {MONTHS.map((m, i) => (
              <MenuItem key={m} value={i + 1}>{m}</MenuItem>
            ))}
          </TextField>
        </Stack>
      </Section>

      <Divider sx={{ mb: 3 }} />

      <Section title="GST">
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2 }}>
          <TextField
            select
            size="small"
            label="Tax Basis"
            value={form.taxBasis || "ACCRUAL"}
            onChange={(e) => set({ taxBasis: e.target.value })}
          >
            <MenuItem value="ACCRUAL">Accrual (invoice) basis</MenuItem>
            <MenuItem value="CASH">Cash (payment) basis</MenuItem>
          </TextField>
          <TextField
            select
            size="small"
            label="Tax Period"
            value={form.taxPeriod || "QUARTERLY"}
            onChange={(e) => set({ taxPeriod: e.target.value })}
          >
            <MenuItem value="MONTHLY">Monthly</MenuItem>
            <MenuItem value="QUARTERLY">Quarterly</MenuItem>
            <MenuItem value="ANNUALLY">Annually</MenuItem>
          </TextField>
          <TextField
            size="small"
            label="Tax ID Number"
            value={form.taxRegistrationNumber || ""}
            onChange={(e) => set({ taxRegistrationNumber: e.target.value })}
          />
          <TextField
            size="small"
            label="Tax ID Display Name"
            placeholder="GST Reg No"
            value={form.taxReference || ""}
            onChange={(e) => set({ taxReference: e.target.value })}
          />
          <TextField
            size="small"
            type="number"
            label="Default Tax %"
            value={form.taxDefaultPercentage ?? 9}
            onChange={(e) => set({ taxDefaultPercentage: Number(e.target.value) })}
            inputProps={{ step: "0.01", min: 0 }}
          />
        </Box>
      </Section>

      <Divider sx={{ mb: 3 }} />

      <Section title="Tax Defaults" hint="How tax is treated on new documents by default.">
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2 }}>
          <TextField
            select
            size="small"
            label="For Sales"
            helperText="Invoices, quotes, credit notes, receive money"
            value={form.salesTaxInclusive ? "INCLUSIVE" : "EXCLUSIVE"}
            onChange={(e) => set({ salesTaxInclusive: e.target.value === "INCLUSIVE" })}
          >
            <MenuItem value="EXCLUSIVE">Tax exclusive</MenuItem>
            <MenuItem value="INCLUSIVE">Tax inclusive</MenuItem>
          </TextField>
          <TextField
            select
            size="small"
            label="For Purchases"
            helperText="Bills, purchase orders, credit notes, spend money"
            value={form.purchasesTaxInclusive ? "INCLUSIVE" : "EXCLUSIVE"}
            onChange={(e) => set({ purchasesTaxInclusive: e.target.value === "INCLUSIVE" })}
          >
            <MenuItem value="EXCLUSIVE">Tax exclusive</MenuItem>
            <MenuItem value="INCLUSIVE">Tax inclusive</MenuItem>
          </TextField>
        </Box>
      </Section>

      <Divider sx={{ mb: 3 }} />

      <Section
        title="Lock Date"
        hint="Lock dates stop data from being changed on or before a date. Journal entries dated on/before this are read-only."
      >
        <TextField
          size="small"
          type="date"
          label="Locked through"
          InputLabelProps={{ shrink: true }}
          value={form.lockedThroughDate || ""}
          onChange={(e) => set({ lockedThroughDate: e.target.value })}
          sx={sx}
        />
      </Section>

      <Divider sx={{ mb: 3 }} />

      <Section title="Time zone">
        <TextField
          select
          size="small"
          label="Time zone"
          value={form.timeZone || "Asia/Singapore"}
          onChange={(e) => set({ timeZone: e.target.value })}
          sx={{ width: { xs: "100%", sm: 320 } }}
        >
          {TIME_ZONES.map((t) => (
            <MenuItem key={t} value={t}>{t.replace(/_/g, " ")}</MenuItem>
          ))}
        </TextField>
      </Section>

      <Box sx={{ display: "flex", justifyContent: "flex-end", mt: 2 }}>
        <Button variant="contained" onClick={handleSave} disabled={saving} startIcon={saving ? <CircularProgress size={14} color="inherit" /> : undefined}>
          Save financial settings
        </Button>
      </Box>
    </Box>
  );
}
