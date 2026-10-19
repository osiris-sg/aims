/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Courier cost + import tax estimator on a shipment (ADH's task-list
// formulas; every rate is in Org Settings → Shipping & documents, every input
// here is editable):
//   step 7  通関 (qty × rate × 1.1) + B/L fee + AN charges = est. 通関・車輸送;
//           trucking = trucks (ROUND(gross / truck size)) × truck rate × 1.1;
//           storage / other; and the import tax estimate.
//   step 8  import tax, the 輸入許可書 formula: 申告価格 = ⌊CIF × customs weekly
//           rate⌋ + 加算運賃 (default the A/N's EQMC); 消費税 7.8% of ⌊申告価格⌋₁₀₀₀,
//           地方消費税 22/78 of it, each ⌊⌋₁₀₀; funded and actual (import
//           permit, step 10), variance.
//   step 12 actuals from Mitsui Soko's invoices next to the estimate.
// Values are saved on blur to Shipment.costs; the figures come back computed.

import React, { useEffect, useState } from "react";
import { Box, Grid, InputAdornment, Link, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from "@mui/material";
import type { Shipment, ShipmentCosts } from "../_lib/api";
import { useTradeMutation } from "../_lib/hooks";
import { fmtYen } from "../_lib/format";
import { toast } from "../_lib/toast";

type Mode = "estimate" | "tax" | "actuals";
export const ESTIMATOR_STEPS: Record<string, Mode> = { CUSTOMS_TAX_ESTIMATE: "estimate", TAX_FUNDS: "tax", LOGISTICS_PAYMENT: "actuals" };

const CUSTOMS_FX_URL = "https://www.customs.go.jp/tetsuzuki/kawase/index.htm";

export default function EstimatorPanel({ shipment, mode, canEdit }: { shipment: Shipment; mode: Mode; canEdit: boolean }) {
  const e = shipment.estimate;
  const costs = shipment.costs ?? {};
  const save = useTradeMutation((a, patch: ShipmentCosts) => a.updateShipment(shipment.id, { costs: patch }));
  if (!e) return null;

  const put = async (patch: ShipmentCosts) => {
    try {
      await save.mutateAsync(patch);
    } catch (err: any) {
      toast.error(err?.message || "Could not save");
    }
  };

  return (
    <Paper variant="outlined" sx={{ p: { xs: 1.5, md: 2 } }} data-tour={mode === "actuals" ? "estimator-actuals" : mode === "tax" ? "estimator-import-tax" : "estimator-costs"}>
      {mode === "estimate" && (
        <>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            Courier cost estimate (JPY)
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            {shipment.profile?.port ? `${shipment.profile.port} · ` : ""}
            {e.truckCapacityT}t trucks · 通関 ¥{e.customsRatePerMt.toLocaleString("en-US")}/MT · net {e.qtyMt ?? "—"} MT · gross {e.grossMt ?? "—"} MT
          </Typography>
          <Grid container spacing={1.5}>
            <Num label="Trucks" value={costs.trucks} placeholder={e.trucksSuggested ?? undefined} helper={`ROUND(gross / ${e.truckCapacityT}) = ${e.trucksSuggested ?? "—"}`} disabled={!canEdit} onSave={(v) => put({ trucks: v })} />
            <Num label="THC (AN)" value={costs.thc} yen disabled={!canEdit} onSave={(v) => put({ thc: v })} />
            <Num label="Documentation fee (AN)" value={costs.docFee} yen disabled={!canEdit} onSave={(v) => put({ docFee: v })} />
            <Num label="Equipment mgmt charge (AN)" value={costs.equipmentFee} yen disabled={!canEdit} onSave={(v) => put({ equipmentFee: v })} />
            <Num label="Storage / other (manual)" value={costs.storage} yen disabled={!canEdit} onSave={(v) => put({ storage: v })} />
            <Num label="Storage containers (¥20,000/CNT)" value={costs.storageContainers} disabled={!canEdit} onSave={(v) => put({ storageContainers: v })} />
          </Grid>
          <Figures
            rows={[
              ["通関 (qty × rate × 1.1)", e.customs],
              ["B/L fee", e.blFee],
              ["AN charges", e.anCharges],
              ["Est. 通関・車輸送", e.customsTotal, true],
              [`Trucking (${e.trucks ?? "—"} × ¥${e.truckRate.toLocaleString("en-US")} × 1.1)`, e.trucking, true],
              ["Storage / other", e.storage + e.other || null],
              ["Total estimate", e.total, true],
            ]}
          />
        </>
      )}
      {(mode === "estimate" || mode === "tax") && (
        <Box sx={{ mt: mode === "estimate" ? 2 : 0 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            Import tax {mode === "tax" ? "(funds)" : "estimate"}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            ⌊CIF × customs weekly rate⌋ + 加算運賃 → 消費税 7.8% + 地方消費税 22/78 —{" "}
            <Link href={CUSTOMS_FX_URL} target="_blank" rel="noopener">
              customs.go.jp exchange rates
            </Link>
          </Typography>
          <Grid container spacing={1.5}>
            <Num label="CIF (USD)" value={costs.cifUsd} disabled={!canEdit} onSave={(v) => put({ cifUsd: v })} />
            <Num label="Customs rate (円/USD)" value={costs.fxRate} disabled={!canEdit} onSave={(v) => put({ fxRate: v })} />
            <Num
              label="加算運賃 (JPY add-on)"
              value={costs.customsAddOnJpy}
              yen
              placeholder={costs.equipmentFee ?? undefined}
              helper={costs.customsAddOnJpy === null || costs.customsAddOnJpy === undefined ? (costs.equipmentFee !== null && costs.equipmentFee !== undefined ? "Default: the A/N's EQMC" : "Default: the A/N's EQMC (not read yet)") : "Typed — clear to use the EQMC"}
              disabled={!canEdit}
              onSave={(v) => put({ customsAddOnJpy: v })}
            />
            {mode === "tax" && <Num label="Funded" value={costs.importTaxFunded} yen disabled={!canEdit} onSave={(v) => put({ importTaxFunded: v })} />}
            {mode === "tax" && <Num label="Actual (import permit)" value={costs.importTaxActual} yen disabled={!canEdit} onSave={(v) => put({ importTaxActual: v })} />}
          </Grid>
          <Figures
            rows={[
              ["CIF × rate (円未満切捨て)", e.importTax.cifJpy],
              [`+ 加算運賃${e.importTax.addOnSource === "EQMC" ? " (EQMC)" : ""}`, e.importTax.addOnJpy || null],
              ["申告価格", e.importTax.customsValue],
              ["消費税 7.8% (課税標準 1,000円未満, 100円未満切捨て)", e.importTax.national],
              ["地方消費税 22/78 (100円未満切捨て)", e.importTax.local],
              ["Import tax estimate (納税額合計)", e.importTax.estimate, true],
              ...(mode === "tax"
                ? ([
                    ["Funded", e.importTax.funded],
                    ["Actual", e.importTax.actual],
                    ["Variance (actual − estimate)", e.importTax.variance, true],
                  ] as Array<[string, number | null, boolean?]>)
                : []),
            ]}
          />
        </Box>
      )}
      {mode === "actuals" && shipment.actuals && (
        <>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            Actuals vs estimate (Mitsui Soko invoices, JPY)
          </Typography>
          <Table size="small" sx={{ mt: 1 }}>
            <TableHead>
              <TableRow>
                <TableCell>Item</TableCell>
                <TableCell align="right">Estimate</TableCell>
                <TableCell align="right" sx={{ width: 180 }}>
                  Actual
                </TableCell>
                <TableCell align="right">Variance</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {shipment.actuals.rows.map((r) => (
                <TableRow key={r.key}>
                  <TableCell>{r.label}</TableCell>
                  <TableCell align="right">{fmtYen(r.estimate)}</TableCell>
                  <TableCell align="right">
                    {r.key === "washing" || r.key === "detention" ? (
                      <Stack direction="row" spacing={0.5} justifyContent="flex-end" alignItems="center">
                        <InlineNum
                          value={(costs.actual as any)?.[`${r.key}Containers`]}
                          suffix="CNT"
                          disabled={!canEdit}
                          onSave={(v) => put({ actual: { [`${r.key}Containers`]: v } as any })}
                        />
                        <Typography variant="caption" color="text.secondary">
                          {fmtYen(r.actual)}
                        </Typography>
                      </Stack>
                    ) : (
                      <InlineNum value={(costs.actual as any)?.[r.key]} prefix="¥" disabled={!canEdit} onSave={(v) => put({ actual: { [r.key]: v } as any })} />
                    )}
                  </TableCell>
                  <TableCell align="right" sx={{ color: r.variance && r.variance > 0 ? "error.main" : r.variance && r.variance < 0 ? "success.main" : undefined }}>
                    {r.variance === null ? "—" : `${r.variance > 0 ? "+" : ""}${fmtYen(r.variance)}`}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell sx={{ fontWeight: 700 }}>Total</TableCell>
                <TableCell align="right" sx={{ fontWeight: 700 }}>
                  {fmtYen(shipment.actuals.estimate)}
                </TableCell>
                <TableCell align="right" sx={{ fontWeight: 700 }}>
                  {fmtYen(shipment.actuals.actual)}
                </TableCell>
                <TableCell align="right" sx={{ fontWeight: 700 }}>
                  {`${shipment.actuals.variance > 0 ? "+" : ""}${fmtYen(shipment.actuals.variance)}`}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </>
      )}
    </Paper>
  );
}

function Figures({ rows }: { rows: Array<[string, number | null, boolean?]> }) {
  return (
    <Box sx={{ mt: 1.5, display: "grid", gridTemplateColumns: "1fr auto", columnGap: 3, rowGap: 0.25, maxWidth: 520 }}>
      {rows.map(([k, v, bold]) => (
        <React.Fragment key={k}>
          <Typography variant="body2" color={bold ? "text.primary" : "text.secondary"} sx={{ fontWeight: bold ? 700 : 400 }}>
            {k}
          </Typography>
          <Typography variant="body2" sx={{ fontWeight: bold ? 700 : 400, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
            {fmtYen(v)}
          </Typography>
        </React.Fragment>
      ))}
    </Box>
  );
}

const parse = (s: string) => (s.trim() === "" ? null : Number(s.replace(/,/g, "")));

/** A number field saved on blur (only when it changed). */
function Num({ label, value, onSave, yen, disabled, helper, placeholder }: { label: string; value: number | null | undefined; onSave: (v: number | null) => void; yen?: boolean; disabled?: boolean; helper?: string; placeholder?: number }) {
  const [v, setV] = useState(value === null || value === undefined ? "" : String(value));
  useEffect(() => setV(value === null || value === undefined ? "" : String(value)), [value]);
  return (
    <Grid item xs={6} sm={4}>
      <TextField
        fullWidth
        size="small"
        label={label}
        value={v}
        disabled={disabled}
        placeholder={placeholder !== undefined ? String(placeholder) : undefined}
        helperText={helper}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => {
          const n = parse(v);
          if (n !== null && !Number.isFinite(n)) return toast.error(`${label}: enter a number`);
          if (n !== (value ?? null)) onSave(n);
        }}
        InputProps={yen ? { startAdornment: <InputAdornment position="start">¥</InputAdornment> } : undefined}
      />
    </Grid>
  );
}

function InlineNum({ value, onSave, disabled, prefix, suffix }: { value: number | null | undefined; onSave: (v: number | null) => void; disabled?: boolean; prefix?: string; suffix?: string }) {
  const [v, setV] = useState(value === null || value === undefined ? "" : String(value));
  useEffect(() => setV(value === null || value === undefined ? "" : String(value)), [value]);
  return (
    <TextField
      size="small"
      variant="standard"
      value={v}
      disabled={disabled}
      sx={{ width: suffix ? 70 : 130, "& input": { textAlign: "right" } }}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        const n = parse(v);
        if (n !== null && !Number.isFinite(n)) return;
        if (n !== (value ?? null)) onSave(n);
      }}
      InputProps={{
        ...(prefix ? { startAdornment: <InputAdornment position="start">{prefix}</InputAdornment> } : {}),
        ...(suffix ? { endAdornment: <InputAdornment position="end">{suffix}</InputAdornment> } : {}),
      }}
    />
  );
}
