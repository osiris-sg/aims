/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Courier cost + import tax estimator on a shipment (ADH's task-list
// formulas; every rate is in Org Settings → Shipping & documents, every input
// here is editable):
//   step 7  two separate cards (round BI, same figures): the import tax estimate (with the
//           tax-estimate file slot), then the courier cost estimate — 通関 (qty × rate × 1.1) +
//           B/L fee + AN charges = est. 通関・車輸送; trucking = trucks (ROUND(gross / truck size))
//           × truck rate × 1.1; storage / other.
//   steps 7 / 8  import tax as ADH's calculator (round BK, 輸入消費税計算ファイル): CIF = the SG→JP invoice
//           total (typed wins; never Vedanta's CI) × the customs weekly rate of the estimated clearance week
//           (ETA by default) → INT → ⌊⌋₁₀₀₀ → 消費税 INT(7.8%) ⌊⌋₁₀₀ + 地方消費税 INT(22/78) ⌊⌋₁₀₀, each line shown;
//           加算運賃 (typed / A/N EQMC / containers × ¥1,800) only when switched on (as on the permit);
//           "Use for step 8 funds"; step 8: transfer SG → JP, actual (import permit, step 10), difference.
//   step 12 actuals from Mitsui Soko's invoices next to the estimate.
// Values are saved on blur to Shipment.costs; the figures come back computed.

import React, { useEffect, useState } from "react";
import { Box, Button, FormControlLabel, Grid, InputAdornment, Link, Paper, Stack, Switch, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from "@mui/material";
import type { Shipment, ShipmentCosts } from "../_lib/api";
import { useTradeMutation } from "../_lib/hooks";
import { fmtYen } from "../_lib/format";
import { toast } from "../_lib/toast";
import { useTranslations } from "next-intl";

type Mode = "estimate" | "tax" | "actuals";
export const ESTIMATOR_STEPS: Record<string, Mode> = { CUSTOMS_TAX_ESTIMATE: "estimate", TAX_FUNDS: "tax", LOGISTICS_PAYMENT: "actuals" };

const CUSTOMS_FX_URL = "https://www.customs.go.jp/tetsuzuki/kawase/index.htm";

export default function EstimatorPanel({ shipment, mode, canEdit, taxSlot }: { shipment: Shipment; mode: Mode; canEdit: boolean; /** Round BI: step 7's import-tax-estimate file row, shown in the tax card. */ taxSlot?: React.ReactNode }) {
  const t = useTranslations("shipments.estimator");
  const e = shipment.estimate;
  const costs = shipment.costs ?? {};
  const save = useTradeMutation((a, patch: ShipmentCosts) => a.updateShipment(shipment.id, { costs: patch }));
  // What was just typed shows in the summary at once (Funded / Actual / Variance), before the refetch lands.
  const [typed, setTyped] = useState<ShipmentCosts>({});
  useEffect(() => setTyped({}), [shipment.updatedAt]);
  if (!e) return taxSlot ? <>{taxSlot}</> : null;

  const put = async (patch: ShipmentCosts) => {
    setTyped((p) => ({ ...p, ...patch }));
    try {
      await save.mutateAsync(patch);
    } catch (err: any) {
      setTyped({});
      toast.error(err?.message || t("couldNotSave"));
    }
  };
  const funded = "importTaxFunded" in typed ? (typed.importTaxFunded ?? null) : e.importTax.funded;
  const actual = "importTaxActual" in typed ? (typed.importTaxActual ?? null) : e.importTax.actual;
  const variance = actual === null || e.importTax.estimate === null ? null : actual - e.importTax.estimate;

  const it = e.importTax;
  const yenLine = (v: number | null | undefined) => (v === null || v === undefined ? "—" : fmtYen(v));
  const cifHelp =
    it.cifSource?.kind === "typed"
      ? it.cifSource.sgjpAmount != null && Math.abs(it.cifSource.sgjpAmount - (it.cifUsd ?? 0)) >= 0.005
        ? t("cifTypedDiffers", { amount: fmtUsd(it.cifSource.sgjpAmount) })
        : t("cifTyped")
      : it.cifSource
        ? t(it.cifSource.kind === "draft" ? "cifFromDraft" : it.cifSource.kind === "file" ? "cifFromFile" : "cifFromFinal", { no: it.cifSource.invoiceNo ?? it.cifSource.ref ?? "" })
        : t("cifNone");
  const week = it.fxSource?.start ? `${fmtMd(it.fxSource.start)}–${fmtMd(it.fxSource.end)}` : null;
  const fxHelp =
    it.fxSource?.kind === "typed"
      ? it.fxSource.customsRate != null && it.fxSource.customsRate !== it.fxRate
        ? t("fxTypedDiffers", { rate: String(it.fxSource.customsRate), week: week ?? "" })
        : t("fxTyped")
      : it.fxSource
        ? t(it.fxSource.provisional ? "fxProvisional" : "fxCustoms", { week: week ?? "" })
        : t("fxNone");
  const addOnHelp = it.addOnSource === "typed" ? t("addOnTyped") : it.addOnSource === "EQMC" ? t("addOnDefault") : it.addOnSource === "containers" ? t("addOnContainers") : t("addOnNotRead");
  const estimateTotal = it.estimate;
  const toFunds = canEdit && estimateTotal !== null && funded !== estimateTotal;

  const taxCard = (
    <Box>
      <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
        {mode === "tax" ? t("taxFundsTitle") : t("taxEstimateTitle")}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        {t("taxFormulaAdh")}{" "}
        <Link href={it.fxSource?.url ?? CUSTOMS_FX_URL} target="_blank" rel="noopener">
          {t("customsRates")}
        </Link>
      </Typography>
      <Grid container spacing={1.5}>
        <Num label={t("cif")} value={costs.cifUsd} placeholder={it.cifSource?.kind !== "typed" ? (it.cifUsd ?? undefined) : undefined} helper={cifHelp} disabled={!canEdit} onSave={(v) => put({ cifUsd: v })} />
        <Grid item xs={6} sm={4}>
          <DateField label={t("clearanceDate")} value={costs.clearanceDate ?? ""} placeholder={it.clearanceFrom === "eta" ? it.clearanceDate ?? "" : ""} helper={it.clearanceFrom === "typed" ? t("clearanceTyped") : it.clearanceFrom === "eta" ? t("clearanceEta") : t("clearanceNone")} disabled={!canEdit} onSave={(v) => put({ clearanceDate: v })} />
        </Grid>
        <Num label={t("customsRate")} value={costs.fxRate} placeholder={it.fxSource?.kind === "customs" ? (it.fxRate ?? undefined) : undefined} helper={fxHelp} disabled={!canEdit} onSave={(v) => put({ fxRate: v })} />
      </Grid>
      {it.cifSource?.kind === "typed" && it.cifSource.sgjpAmount != null && Math.abs(it.cifSource.sgjpAmount - (it.cifUsd ?? 0)) >= 0.005 && canEdit && (
        <Button size="small" sx={{ mt: 0.5 }} onClick={() => put({ cifUsd: null })} data-tour="estimator-cif-use-sgjp">
          {t("useSgjpCif", { amount: fmtUsd(it.cifSource.sgjpAmount) })}
        </Button>
      )}
      {/* The xlsx, line by line (each with its value and rounding). */}
      <Box sx={{ mt: 1.5, display: "grid", gridTemplateColumns: { xs: "1fr auto", sm: "minmax(220px, 1.2fr) auto 1fr" }, columnGap: 2, rowGap: 0.4, maxWidth: 860 }} data-tour="estimator-tax-lines">
        <Line label={t("lDeclared")} value={it.cifUsd === null ? "—" : `US$${fmtUsd(it.cifUsd)}`} note={it.cifSource && it.cifSource.kind !== "typed" ? (it.cifSource.invoiceNo ?? it.cifSource.ref ?? "") + (it.cifSource.kind === "draft" ? ` (${t("draft")})` : "") : it.cifSource?.kind === "typed" ? t("typed") : ""} />
        <Line label={t("lRate")} value={it.fxRate === null ? "—" : String(it.fxRate)} note={week ? `${t("week")} ${week}${it.fxSource?.provisional ? ` (${t("provisional")})` : ""}` : ""} />
        <Line label={t("lJpy")} value={yenLine(it.cifJpy)} note={t("nDecimals")} />
        {it.addOnIncluded && <Line label={`+ ${t("fAddOn")}`} value={yenLine(it.addOnJpy)} note={t("nAddOn")} />}
        <Line label={t("lBase")} value={yenLine(it.taxBase)} note={t("nThousand")} />
        <Line label={t("lNational")} value={yenLine(it.nationalRaw)} note={t("nDecimals")} />
        <Line label={t("lNationalDown")} value={yenLine(it.national)} note={t("nHundred")} />
        <Line label={t("lLocal")} value={yenLine(it.localRaw)} note={t("nDecimals")} />
        <Line label={t("lLocalDown")} value={yenLine(it.local)} note={t("nHundred")} />
        <Line label={t("lTotal")} value={yenLine(estimateTotal)} note={t("nTransfer")} bold />
      </Box>
      {/* 加算運賃: off by default (ADH's sheet), on = as on the permit. */}
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems={{ sm: "center" }} sx={{ mt: 1.5 }} data-tour="estimator-addon">
        <FormControlLabel
          control={<Switch size="small" checked={!!it.addOnIncluded} disabled={!canEdit} onChange={(ev) => put({ includeAddOn: ev.target.checked })} />}
          label={<Typography variant="body2">{t("includeAddOn")}</Typography>}
        />
        <Box sx={{ width: { sm: 220 } }}>
          <Num bare label={t("addOn")} value={costs.customsAddOnJpy} yen placeholder={it.addOnSource !== "typed" ? (it.addOnValue ?? undefined) : undefined} helper={addOnHelp} disabled={!canEdit} onSave={(v) => put({ customsAddOnJpy: v })} />
        </Box>
        {it.addOnEffect != null && (
          <Typography variant="body2" color="text.secondary">
            {it.addOnIncluded ? t("addOnEffectOn", { yen: fmtYen(it.addOnEffect) }) : t("addOnEffectOff", { yen: fmtYen(it.addOnEffect) })}
          </Typography>
        )}
      </Stack>
      {mode === "tax" && (
        <Grid container spacing={1.5} sx={{ mt: 0.5 }}>
          <Num label={t("funded")} value={costs.importTaxFunded} yen placeholder={estimateTotal ?? undefined} disabled={!canEdit} onSave={(v) => put({ importTaxFunded: v })} />
          <Num label={t("actualPermit")} value={costs.importTaxActual} yen disabled={!canEdit} onSave={(v) => put({ importTaxActual: v })} />
        </Grid>
      )}
      {(toFunds || mode === "tax") && (
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mt: 1 }} flexWrap="wrap" useFlexGap>
          {toFunds && (
            <Button size="small" variant="outlined" onClick={() => put({ importTaxFunded: estimateTotal })} data-tour="estimator-use-for-funds">
              {funded === null ? t("useForFunds", { yen: fmtYen(estimateTotal) }) : t("useForFundsReplace", { yen: fmtYen(estimateTotal), old: fmtYen(funded) })}
            </Button>
          )}
          {mode !== "tax" && funded !== null && funded === estimateTotal && (
            <Typography variant="body2" color="success.main">{t("fundsSet", { yen: fmtYen(funded) })}</Typography>
          )}
        </Stack>
      )}
      {mode === "tax" && (
        <Figures
          rows={[
            [t("transferSgJp"), funded ?? estimateTotal, true],
            [t("actual"), actual],
            [t("fVarianceEstimate"), variance, true],
          ]}
        />
      )}
      {taxSlot ? (
        <Box sx={{ mt: 1.5 }} data-tour="estimator-tax-file">
          {taxSlot}
        </Box>
      ) : null}
    </Box>
  );
  // Round BI: on step 7 the import tax estimate and the courier cost estimate are two separate cards (figures unchanged).
  if (mode === "estimate")
    return (
      <Stack spacing={1.5}>
        <Paper variant="outlined" sx={{ p: { xs: 1.5, md: 2 } }} data-tour="estimator-tax-estimate">
          {taxCard}
        </Paper>
        <Paper variant="outlined" sx={{ p: { xs: 1.5, md: 2 } }} data-tour="estimator-costs">
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            {t("courierTitle")}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            {shipment.profile?.port ? `${shipment.profile.port} · ` : ""}
            {t("courierSub", { cap: e.truckCapacityT, rate: e.customsRatePerMt.toLocaleString("en-US"), net: String(e.qtyMt ?? "—"), gross: String(e.grossMt ?? "—") })}
          </Typography>
          <Grid container spacing={1.5}>
            <Num label={t("trucks")} value={costs.trucks} placeholder={e.trucksSuggested ?? undefined} helper={`ROUND(gross / ${e.truckCapacityT}) = ${e.trucksSuggested ?? "—"}`} disabled={!canEdit} onSave={(v) => put({ trucks: v })} />
            <Num label={t("thc")} value={costs.thc} yen disabled={!canEdit} onSave={(v) => put({ thc: v })} />
            <Num label={t("docFee")} value={costs.docFee} yen disabled={!canEdit} onSave={(v) => put({ docFee: v })} />
            <Num label={t("equipmentFee")} value={costs.equipmentFee} yen disabled={!canEdit} onSave={(v) => put({ equipmentFee: v })} />
            <Num label={t("storageManual")} value={costs.storage} yen disabled={!canEdit} onSave={(v) => put({ storage: v })} />
            <Num label={t("storageContainers")} value={costs.storageContainers} disabled={!canEdit} onSave={(v) => put({ storageContainers: v })} />
          </Grid>
          <Figures
            rows={[
              [t("fCustoms"), e.customs],
              [t("fBlFee"), e.blFee],
              [t("fAnCharges"), e.anCharges],
              [t("fCustomsTotal"), e.customsTotal, true],
              [t("fTrucking", { trucks: String(e.trucks ?? "—"), rate: e.truckRate.toLocaleString("en-US") }), e.trucking, true],
              [t("fStorage"), e.storage + e.other || null],
              [t("fTotal"), e.total, true],
            ]}
          />
        </Paper>
      </Stack>
    );

  return (
    <Paper variant="outlined" sx={{ p: { xs: 1.5, md: 2 } }} data-tour={mode === "actuals" ? "estimator-actuals" : "estimator-import-tax"}>
      {mode === "tax" && taxCard}
      {mode === "actuals" && shipment.actuals && (
        <>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            {t("actualsTitle")}
          </Typography>
          <Table size="small" sx={{ mt: 1 }}>
            <TableHead>
              <TableRow>
                <TableCell>{t("item")}</TableCell>
                <TableCell align="right">{t("estimate")}</TableCell>
                <TableCell align="right" sx={{ width: 180 }}>
                  {t("actual")}
                </TableCell>
                <TableCell align="right">{t("variance")}</TableCell>
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
                        <InlineNum value={(costs.actual as any)?.[`${r.key}Containers`]} suffix="CNT" disabled={!canEdit} onSave={(v) => put({ actual: { [`${r.key}Containers`]: v } as any })} />
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
                <TableCell sx={{ fontWeight: 700 }}>{t("total")}</TableCell>
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

/** One line of ADH's calculator: label · value · rounding note. */
function Line({ label, value, note, bold }: { label: string; value: string; note?: string; bold?: boolean }) {
  return (
    <>
      <Typography variant="body2" color={bold ? "text.primary" : "text.secondary"} sx={{ fontWeight: bold ? 700 : 400 }}>
        {label}
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: bold ? 700 : 400, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
        {value}
      </Typography>
      <Typography variant="caption" color={bold ? "primary.main" : "text.secondary"} sx={{ gridColumn: { xs: "1 / -1", sm: "auto" }, mt: { xs: -0.25, sm: 0 }, mb: { xs: 0.5, sm: 0 }, alignSelf: "center" }}>
        {note}
      </Typography>
    </>
  );
}

const fmtUsd = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** "2026-10-25" → "10/25". */
const fmtMd = (d: string | null | undefined) => {
  const m = /^\d{4}-(\d{2})-(\d{2})/.exec(d ?? "");
  return m ? `${Number(m[1])}/${Number(m[2])}` : "";
};

/** A date field saved on blur (YYYY-MM-DD; empty = default). */
function DateField({ label, value, onSave, disabled, helper, placeholder }: { label: string; value: string; onSave: (v: string | null) => void; disabled?: boolean; helper?: string; placeholder?: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <TextField
      fullWidth
      size="small"
      type="date"
      label={label}
      value={v || ""}
      disabled={disabled}
      helperText={helper ? `${helper}${!v && placeholder ? ` · ${placeholder}` : ""}` : undefined}
      InputLabelProps={{ shrink: true }}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        if ((v || null) !== (value || null)) onSave(v || null);
      }}
    />
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
function Num({ label, value, onSave, yen, disabled, helper, placeholder, bare }: { label: string; value: number | null | undefined; onSave: (v: number | null) => void; yen?: boolean; disabled?: boolean; helper?: string; placeholder?: number; /** Without the grid cell. */ bare?: boolean }) {
  const t = useTranslations("shipments.estimator");
  const [v, setV] = useState(value === null || value === undefined ? "" : String(value));
  useEffect(() => setV(value === null || value === undefined ? "" : String(value)), [value]);
  const field = (
      <TextField
        fullWidth
        size="small"
        label={label}
        value={v}
        disabled={disabled}
        placeholder={placeholder !== undefined ? String(placeholder) : undefined}
        helperText={helper}
        InputLabelProps={placeholder !== undefined ? { shrink: true } : undefined}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        onBlur={() => {
          const n = parse(v);
          if (n !== null && !Number.isFinite(n)) return toast.error(t("enterNumber", { label }));
          if (n !== (value ?? null)) onSave(n);
        }}
        InputProps={yen ? { startAdornment: <InputAdornment position="start">¥</InputAdornment> } : undefined}
      />
  );
  return bare ? field : (
    <Grid item xs={6} sm={4}>
      {field}
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
