"use client";

import React, { useEffect } from "react";
import {
  Box,
  Button,
  CircularProgress,
  Divider,
  FormControlLabel,
  Grid2,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import { useForm, Controller } from "react-hook-form";

type SettingsForm = {
  baseCurrency: string;
  taxRegistrationNumber: string;
  taxDefaultPercentage: number;
  taxReference: string;
  activateLastSoldPrice: boolean;
  activateLastBuyPrice: boolean;
  enablePerpetualInventory: boolean;
  yearOpeningDate: string;
  yearOpeningStock: number;
  monthOpeningDate: string;
  monthOpeningStock: number;
  monthClosingStock: number;
  nextNumbers: Record<string, number>;
  numberPrefixes: Record<string, string>;
};

const DOC_TYPES: { key: string; label: string; defaultPrefix: string }[] = [
  { key: "quotation", label: "Quotation", defaultPrefix: "QO" },
  { key: "salesOrder", label: "Sales Order", defaultPrefix: "SO" },
  { key: "deliveryOrder", label: "Delivery Order", defaultPrefix: "DO" },
  { key: "invoice", label: "Invoice", defaultPrefix: "INV" },
  { key: "debitNote", label: "Debit Note", defaultPrefix: "DN" },
  { key: "creditNote", label: "Credit Note", defaultPrefix: "CN" },
  { key: "proforma", label: "Proforma", defaultPrefix: "PF" },
  { key: "allocationOrder", label: "Allocation Order", defaultPrefix: "AO" },
  { key: "productionOrder", label: "Production Order", defaultPrefix: "PDO" },
  { key: "stockAdjustment", label: "Stock Adjustment", defaultPrefix: "SA" },
  { key: "purchaseOrder", label: "Purchase Order", defaultPrefix: "PO" },
  { key: "purchaseReturn", label: "Purchase Return", defaultPrefix: "PR" },
  { key: "receipt", label: "Receipt", defaultPrefix: "RCP" },
  { key: "paymentVoucher", label: "Payment Voucher", defaultPrefix: "PV" },
  { key: "journalVoucher", label: "Journal Voucher", defaultPrefix: "JV" },
];

function toDateInput(value?: string | null) {
  if (!value) return "";
  return new Date(value).toISOString().slice(0, 10);
}

interface Props {
  settings: any;
  loading: boolean;
  onSave: (updates: Partial<SettingsForm>) => Promise<void>;
}

export default function DefaultSettingsTab({ settings, loading, onSave }: Props) {
  const defaults: SettingsForm = {
    baseCurrency: settings?.baseCurrency || "SGD",
    taxRegistrationNumber: settings?.taxRegistrationNumber || "",
    taxDefaultPercentage: settings?.taxDefaultPercentage ?? 9,
    taxReference: settings?.taxReference || "GST",
    activateLastSoldPrice: settings?.activateLastSoldPrice ?? true,
    activateLastBuyPrice: settings?.activateLastBuyPrice ?? true,
    enablePerpetualInventory: settings?.enablePerpetualInventory ?? false,
    yearOpeningDate: toDateInput(settings?.yearOpeningDate),
    yearOpeningStock: settings?.yearOpeningStock ?? 0,
    monthOpeningDate: toDateInput(settings?.monthOpeningDate),
    monthOpeningStock: settings?.monthOpeningStock ?? 0,
    monthClosingStock: settings?.monthClosingStock ?? 0,
    nextNumbers: settings?.nextNumbers || {},
    numberPrefixes: settings?.numberPrefixes || {},
  };

  const { control, handleSubmit, reset, register } = useForm<SettingsForm>({ defaultValues: defaults });

  useEffect(() => {
    reset(defaults);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  if (loading && !settings) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", p: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  const onSubmit = async (data: SettingsForm) => {
    await onSave({
      baseCurrency: data.baseCurrency,
      taxRegistrationNumber: data.taxRegistrationNumber,
      taxDefaultPercentage: Number(data.taxDefaultPercentage) || 0,
      taxReference: data.taxReference,
      activateLastSoldPrice: !!data.activateLastSoldPrice,
      activateLastBuyPrice: !!data.activateLastBuyPrice,
      enablePerpetualInventory: !!data.enablePerpetualInventory,
      yearOpeningDate: data.yearOpeningDate || undefined,
      yearOpeningStock: Number(data.yearOpeningStock) || 0,
      monthOpeningDate: data.monthOpeningDate || undefined,
      monthOpeningStock: Number(data.monthOpeningStock) || 0,
      monthClosingStock: Number(data.monthClosingStock) || 0,
      nextNumbers: Object.fromEntries(
        DOC_TYPES.map((d) => [d.key, Number((data.nextNumbers as any)?.[d.key]) || 1])
      ),
      numberPrefixes: Object.fromEntries(
        DOC_TYPES.map((d) => [d.key, ((data.numberPrefixes as any)?.[d.key] ?? "").toString()])
      ),
    });
  };

  return (
    <Box component="form" onSubmit={handleSubmit(onSubmit)} sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {/* ---------- Operation Settings ---------- */}
      <Section title="Operation Settings">
        <Grid2 container spacing={2}>
          <Grid2 size={{ xs: 12, md: 4 }}>
            <Controller
              control={control}
              name="baseCurrency"
              render={({ field }) => (
                <TextField {...field} label="Base Currency" size="small" fullWidth />
              )}
            />
          </Grid2>
          <Grid2 size={{ xs: 12, md: 8 }}>
            <Stack direction="row" gap={3} flexWrap="wrap">
              <Controller
                control={control}
                name="activateLastSoldPrice"
                render={({ field }) => (
                  <FormControlLabel
                    control={<Switch checked={!!field.value} onChange={(_, v) => field.onChange(v)} />}
                    label="Activate Last Sold Price"
                  />
                )}
              />
              <Controller
                control={control}
                name="activateLastBuyPrice"
                render={({ field }) => (
                  <FormControlLabel
                    control={<Switch checked={!!field.value} onChange={(_, v) => field.onChange(v)} />}
                    label="Activate Last Buy Price"
                  />
                )}
              />
              <Controller
                control={control}
                name="enablePerpetualInventory"
                render={({ field }) => (
                  <FormControlLabel
                    control={<Switch checked={!!field.value} onChange={(_, v) => field.onChange(v)} />}
                    label="Perpetual inventory (auto Dr/Cr Inventory + COGS)"
                  />
                )}
              />
            </Stack>
          </Grid2>
        </Grid2>

        <Typography variant="subtitle2" sx={{ mt: 3, mb: 1, fontWeight: 600 }}>
          Document number sequences
        </Typography>
        <Typography variant="caption" sx={{ color: "text.secondary", display: "block", mb: 2 }}>
          The prefix is prepended to each generated number. "Next number" is the counter used for the next document of that type.
        </Typography>

        <Grid2 container spacing={1.5}>
          {DOC_TYPES.map((d) => (
            <Grid2 key={d.key} size={{ xs: 12, md: 6 }}>
              <Stack direction="row" gap={1} alignItems="center">
                <Typography sx={{ width: 180, fontSize: 14 }}>{d.label}</Typography>
                <TextField
                  size="small"
                  label="Prefix"
                  placeholder={d.defaultPrefix}
                  sx={{ width: 110 }}
                  {...register(`numberPrefixes.${d.key}` as any)}
                />
                <TextField
                  size="small"
                  type="number"
                  label="Next #"
                  sx={{ width: 140 }}
                  {...register(`nextNumbers.${d.key}` as any)}
                />
              </Stack>
            </Grid2>
          ))}
        </Grid2>
      </Section>

      <Divider />

      {/* ---------- Accounts Settings ---------- */}
      <Section title="Accounts Settings">
        <Grid2 container spacing={2}>
          <Grid2 size={{ xs: 12, md: 4 }}>
            <Controller
              control={control}
              name="yearOpeningDate"
              render={({ field }) => (
                <TextField {...field} type="date" label="Year Opening Date" size="small" fullWidth InputLabelProps={{ shrink: true }} />
              )}
            />
          </Grid2>
          <Grid2 size={{ xs: 12, md: 4 }}>
            <Controller
              control={control}
              name="yearOpeningStock"
              render={({ field }) => (
                <TextField {...field} type="number" label="Year Opening Stock" size="small" fullWidth />
              )}
            />
          </Grid2>
          <Grid2 size={{ xs: 12, md: 4 }} />
          <Grid2 size={{ xs: 12, md: 4 }}>
            <Controller
              control={control}
              name="monthOpeningDate"
              render={({ field }) => (
                <TextField {...field} type="date" label="Month Opening Date" size="small" fullWidth InputLabelProps={{ shrink: true }} />
              )}
            />
          </Grid2>
          <Grid2 size={{ xs: 12, md: 4 }}>
            <Controller
              control={control}
              name="monthOpeningStock"
              render={({ field }) => (
                <TextField {...field} type="number" label="Month Opening Stock" size="small" fullWidth />
              )}
            />
          </Grid2>
          <Grid2 size={{ xs: 12, md: 4 }}>
            <Controller
              control={control}
              name="monthClosingStock"
              render={({ field }) => (
                <TextField {...field} type="number" label="Month Closing Stock" size="small" fullWidth />
              )}
            />
          </Grid2>
        </Grid2>
      </Section>

      <Divider />

      {/* ---------- Tax Settings ---------- */}
      <Section title="Tax Settings">
        <Grid2 container spacing={2}>
          <Grid2 size={{ xs: 12, md: 4 }}>
            <Controller
              control={control}
              name="taxRegistrationNumber"
              render={({ field }) => (
                <TextField {...field} label="Tax Registration Number" size="small" fullWidth />
              )}
            />
          </Grid2>
          <Grid2 size={{ xs: 12, md: 4 }}>
            <Controller
              control={control}
              name="taxDefaultPercentage"
              render={({ field }) => (
                <TextField {...field} type="number" label="Default Tax %" size="small" fullWidth />
              )}
            />
          </Grid2>
          <Grid2 size={{ xs: 12, md: 4 }}>
            <Controller
              control={control}
              name="taxReference"
              render={({ field }) => (
                <TextField {...field} label="Tax Reference (GST / VAT / …)" size="small" fullWidth />
              )}
            />
          </Grid2>
        </Grid2>
      </Section>

      <Box>
        <Button type="submit" variant="contained" color="primary">
          Save
        </Button>
      </Box>
    </Box>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box>
      <Typography variant="subtitle1" sx={{ mb: 2, fontWeight: 600, color: "primary.main" }}>
        {title}
      </Typography>
      {children}
    </Box>
  );
}
