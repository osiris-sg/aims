/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Forms for the logistics documents ADH makes in-app:
//  - SG→JP INVOICE & PACKING LIST, ADH's layout (header.layout = 2): parties,
//    the receipt / delivery grid and one item per invoice + packing line, each
//    priced from LME + QMJP + premium + upcharge (or typed). Several per
//    shipment for split arrivals.
//  - 出庫・納入依頼書 (header.layout = 2): to the warehouse, vessel / voyage /
//    B/L / warehouse, one row per truck day and 備考 from the customer's
//    delivery profile.
// Documents created before these layouts keep their original forms below.

import React from "react";
import { Box, Button, Checkbox, Grid2, IconButton, MenuItem, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Tooltip, Typography } from "@mui/material";
import { useQueryClient } from "@tanstack/react-query";
import { useShipmentsApi } from "@/app/portal/shipments/_lib/api";
import { toast } from "@/app/portal/shipments/_lib/toast";
import { SHIPMENT_KEYS, useTradeSettings } from "@/app/portal/shipments/_lib/hooks";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/DeleteOutline";
import type { DocFormProps } from "./types";
import { useTranslations } from "next-intl";
import { roundDown, roundTo, toNum, usd } from "./invoiceCalc";
import { guardDate, tradeDateError } from "@/app/portal/shipments/_lib/dates";
import { useUiLang } from "@/i18n/UiLangProvider";
import SiDeliveries from "./SiDeliveries";

/** Text field bound to header[k]. */
function field(h: any, setH: (p: any) => void, disabled: boolean) {
  return function textField(k: string, label: string, extra: Record<string, any> = {}) {
    return <TextField size="small" fullWidth label={label} value={h[k] ?? ""} disabled={disabled} onChange={(e) => setH({ [k]: e.target.value })} {...guardDate(extra, h[k])} />;
  };
}
/** Number field bound to header[k] (blank = null). */
function numField(h: any, setH: (p: any) => void, disabled: boolean) {
  return function numberField(k: string, label: string, extra: Record<string, any> = {}) {
    return (
      <TextField size="small" fullWidth type="number" label={label} value={h[k] ?? ""} disabled={disabled} onChange={(e) => setH({ [k]: toNum(e.target.value) })} inputProps={{ step: "any", style: { textAlign: "right" } }} {...extra} />
    );
  };
}

/** A small editable grid: one input per cell, add / remove rows. */
function Grid({
  cols,
  rows,
  disabled,
  setRows,
  blank,
  footer,
  check,
}: {
  cols: Array<{ key: string; label: string; num?: boolean; date?: boolean; width?: number; multiline?: boolean; minWidth?: number }>;
  rows: any[];
  disabled: boolean;
  setRows: (fn: (rs: any[]) => any[]) => void;
  blank: () => any;
  footer?: React.ReactNode;
  /** A tick column saved on its own (e.g. SI "delivered" — works on a final document too). */
  check?: { key: string; label: string; onChange: (rowIndex: number, value: boolean) => void };
}) {
  const tsiRow = useTranslations("si.toolbar");
  return (
    <>
      <Box sx={{ overflowX: "auto", border: 1, borderColor: "divider", borderRadius: 1 }}>
        <Table size="small" sx={{ minWidth: 520 }}>
          <TableHead>
            <TableRow>
              {cols.map((c) => (
                <TableCell key={c.key} align={c.num ? "right" : "left"} sx={{ fontWeight: 700, whiteSpace: "nowrap", width: c.width }}>
                  {c.label}
                </TableCell>
              ))}
              {check && <TableCell sx={{ fontWeight: 700, width: 90 }}>{check.label}</TableCell>}
              <TableCell sx={{ width: 40 }} />
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={i}>
                {cols.map((c) => (
                  <TableCell key={c.key} sx={{ p: 0.5, minWidth: c.minWidth }}>
                    <TextField
                      size="small"
                      fullWidth
                      variant="standard"
                      multiline={!!c.multiline}
                      value={r[c.key] ?? ""}
                      disabled={disabled}
                      type={c.num ? "number" : c.date ? "date" : "text"}
                      inputProps={{ step: "any", style: { textAlign: c.num ? "right" : "left" }, "aria-label": `${c.label} row ${i + 1}`, ...(c.date ? { min: "2000-01-01", max: "2100-12-31" } : {}) }}
                      error={!!c.date && !!tradeDateError(r[c.key])}
                      title={c.date ? (tradeDateError(r[c.key]) ?? undefined) : undefined}
                      onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, [c.key]: c.num ? toNum(e.target.value) : e.target.value } : x)))}
                    />
                  </TableCell>
                ))}
                {check && (
                  <TableCell sx={{ p: 0.25 }}>
                    <Checkbox size="small" checked={r[check.key] === true} onChange={(e) => check.onChange(i, e.target.checked)} inputProps={{ "aria-label": `${check.label} row ${i + 1}` }} />
                  </TableCell>
                )}
                <TableCell sx={{ p: 0.25 }}>
                  {!disabled && (
                    <Tooltip title="Remove row">
                      <IconButton size="small" aria-label="Remove row" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {footer}
          </TableBody>
        </Table>
      </Box>
      {!disabled && (
        <Button size="small" startIcon={<AddIcon />} sx={{ mt: 1 }} onClick={() => setRows((rs) => [...rs, blank()])}>
          {tsiRow("addRow")}
        </Button>
      )}
    </>
  );
}

const sum = (rows: any[], k: string) => roundTo(rows.reduce((a, r) => a + (Number(r[k]) || 0), 0), 3);

export function SgjpDocForm(props: DocFormProps<any, any>) {
  return props.header?.layout === 2 ? <SgjpAdhForm {...props} /> : <SgjpLegacyForm {...props} />;
}

export function SiDocForm(props: DocFormProps<any, any>) {
  return props.header?.layout === 2 ? <SiAdhForm {...props} /> : <SiLegacyForm {...props} />;
}

/** Unit price: LME + QMJP + premium + upcharge once LME is filled, else as typed (mirrors the API). */
const itemPrice = (i: any) => (i.lme != null && i.lme !== "" ? roundTo((Number(i.lme) || 0) + (Number(i.qmjp) || 0) + (Number(i.premium) || 0) + (Number(i.upcharge) || 0), 4) : toNum(i.unitPrice));
const itemAmount = (i: any) => {
  const p = itemPrice(i);
  const q = toNum(i.quantity);
  return p === null || q === null ? null : roundDown(q * p, 2);
};
const sgjpNo = (d: string) => `ADH${(d ?? "").replace(/-/g, "").slice(0, 8)}`;

function SgjpAdhForm({ header: h, rows, disabled, setHeader, setRows }: DocFormProps<any, any>) {
  const tf = field(h, setHeader, disabled);
  const setItem = (i: number, patch: any) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const itf = (i: number, k: string, label: string, extra: Record<string, any> = {}) => (
    <TextField size="small" fullWidth label={label} value={rows[i][k] ?? ""} disabled={disabled} onChange={(e) => setItem(i, { [k]: e.target.value })} {...extra} />
  );
  const inf = (i: number, k: string, label: string, extra: Record<string, any> = {}) => (
    <TextField size="small" fullWidth type="number" label={label} value={rows[i][k] ?? ""} disabled={disabled} onChange={(e) => setItem(i, { [k]: toNum(e.target.value) })} inputProps={{ step: "any", style: { textAlign: "right" } }} {...extra} />
  );
  const total = rows.reduce((a, i) => a + (itemAmount(i) ?? 0), 0);
  return (
    <>
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
          INVOICE &amp; PACKING LIST
        </Typography>
        <Grid2 container spacing={1.5}>
          <Grid2 size={{ xs: 12, sm: 4 }}>{tf("invoiceNo", "Invoice no.", { helperText: "ADH + yyyymmdd; each arrival needs its own" })}</Grid2>
          <Grid2 size={{ xs: 12, sm: 4 }}>
            {/* The number follows the date until it is typed over. */}
            {tf("invoiceDate", "Invoice date", { type: "date", InputLabelProps: { shrink: true }, onChange: (e: any) => setHeader({ invoiceDate: e.target.value, ...(h.invoiceNo === sgjpNo(h.invoiceDate) ? { invoiceNo: sgjpNo(e.target.value) } : {}) }) })}
          </Grid2>
          <Grid2 size={{ xs: 12, sm: 4 }}>{tf("lmeMonth", "LME month (shipment month)", { type: "month", InputLabelProps: { shrink: true } })}</Grid2>
          <Grid2 size={{ xs: 12, md: 6 }}>{tf("shipperBlock", "(Shipper)", { multiline: true, minRows: 3 })}</Grid2>
          <Grid2 size={{ xs: 12, md: 6 }}>{tf("consigneeBlock", "(Consignee: Ship To)", { multiline: true, minRows: 3 })}</Grid2>
          <Grid2 size={{ xs: 12, md: 6 }}>{tf("sellerBlock", "(Seller)", { multiline: true, minRows: 3 })}</Grid2>
          <Grid2 size={{ xs: 12, md: 6 }}>{tf("buyerBlock", "(Buyer)", { multiline: true, minRows: 3 })}</Grid2>
          <Grid2 size={{ xs: 12, sm: 6 }}>{tf("placeOfReceipt", "Place of receipt")}</Grid2>
          <Grid2 size={{ xs: 12, sm: 6 }}>{tf("payment", "Payment")}</Grid2>
          <Grid2 size={{ xs: 12, sm: 6 }}>{tf("portOfLoading", "Port of loading")}</Grid2>
          <Grid2 size={{ xs: 12, sm: 6 }}>{tf("countryOfOrigin", "Country of origin")}</Grid2>
          <Grid2 size={{ xs: 12, sm: 6 }}>{tf("portOfDischarge", "Port of discharge")}</Grid2>
          <Grid2 size={{ xs: 12, sm: 6 }}>{tf("vessel", "Vessel / voyage")}</Grid2>
          <Grid2 size={{ xs: 12, sm: 6 }}>{tf("placeOfDelivery", "Place of delivery")}</Grid2>
          <Grid2 size={{ xs: 12, sm: 6 }}>{tf("others", "Others")}</Grid2>
          <Grid2 size={{ xs: 12, sm: 8 }}>{tf("shippingMarks", "Shipping marks", { multiline: true, minRows: 1 })}</Grid2>
          <Grid2 size={{ xs: 12, sm: 4 }}>{tf("currency", "Currency")}</Grid2>
        </Grid2>
      </Paper>
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Stack direction="row" alignItems="center" sx={{ mb: 1 }}>
          <Typography variant="subtitle2">Items (invoice line + packing line)</Typography>
          <Box sx={{ flex: 1 }} />
          <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>
            Total {h.currency || "USD"} {usd(roundTo(total, 2))}
          </Typography>
        </Stack>
        <Stack spacing={1.5}>
          {rows.map((it, i) => (
            <Box key={i} sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1.5 }}>
              <Stack direction="row" alignItems="center" sx={{ mb: 1 }}>
                <Typography variant="caption" color="text.secondary">
                  C/No. {i + 1}
                </Typography>
                <Box sx={{ flex: 1 }} />
                <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums" }}>
                  {usd(itemPrice(it))} × {it.quantity ?? "—"} = <b>{usd(itemAmount(it))}</b>
                </Typography>
                {!disabled && rows.length > 1 && (
                  <Tooltip title="Remove item">
                    <IconButton size="small" aria-label="Remove item" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}
              </Stack>
              <Grid2 container spacing={1}>
                <Grid2 size={{ xs: 12, sm: 6 }}>{itf(i, "goods", "Description")}</Grid2>
                <Grid2 size={{ xs: 6, sm: 3 }}>{itf(i, "hsCode", "HS code")}</Grid2>
                <Grid2 size={{ xs: 6, sm: 3 }}>{itf(i, "terms", "Terms (after HS)")}</Grid2>
                <Grid2 size={12}>
                  <Typography variant="caption" color="text.secondary">
                    Unit price US$/MT = LME + QMJP + billet premium + upcharge (customer price, shipment month) — fill LME, or type the unit price
                  </Typography>
                </Grid2>
                <Grid2 size={{ xs: 6, sm: 2.4 }}>{inf(i, "lme", "LME")}</Grid2>
                <Grid2 size={{ xs: 6, sm: 2.4 }}>{inf(i, "qmjp", "QMJP")}</Grid2>
                <Grid2 size={{ xs: 6, sm: 2.4 }}>{inf(i, "premium", "Billet premium")}</Grid2>
                <Grid2 size={{ xs: 6, sm: 2.4 }}>{inf(i, "upcharge", "Upcharge")}</Grid2>
                <Grid2 size={{ xs: 12, sm: 2.4 }}>
                  {it.lme != null && it.lme !== "" ? <TextField size="small" fullWidth label="Unit price" value={usd(itemPrice(it))} disabled inputProps={{ style: { textAlign: "right" } }} /> : inf(i, "unitPrice", "Unit price")}
                </Grid2>
                <Grid2 size={{ xs: 6, sm: 2 }}>{inf(i, "quantity", "Quantity MT")}</Grid2>
                <Grid2 size={{ xs: 6, sm: 2 }}>{inf(i, "bundles", "Bundles")}</Grid2>
                <Grid2 size={{ xs: 6, sm: 2 }}>{inf(i, "pieces", "Pieces")}</Grid2>
                <Grid2 size={{ xs: 6, sm: 3 }}>{inf(i, "netMt", "Net MT")}</Grid2>
                <Grid2 size={{ xs: 6, sm: 3 }}>{inf(i, "grossMt", "Gross MT")}</Grid2>
                <Grid2 size={12}>{itf(i, "dimension", "Dimension", { multiline: true, minRows: 1 })}</Grid2>
              </Grid2>
            </Box>
          ))}
        </Stack>
        {!disabled && (
          <Button size="small" startIcon={<AddIcon />} sx={{ mt: 1 }} onClick={() => setRows((rs) => [...rs, { ...(rs[rs.length - 1] ?? {}), quantity: null, bundles: null, pieces: null, netMt: null, grossMt: null }])}>
            Add item
          </Button>
        )}
      </Paper>
      <Paper variant="outlined" sx={{ p: 2 }}>
        {tf("signBlock", "Signature block (bottom right)", { multiline: true, minRows: 3 })}
      </Paper>
    </>
  );
}

function SiAdhForm({ doc, header: h, rows, disabled, setHeader, setRows }: DocFormProps<any, any>) {
  const { lang } = useUiLang();
  const api = useShipmentsApi();
  const qc = useQueryClient();
  const t = useTranslations("si.editor");
  const tf = field(h, setHeader, disabled);
  const nf = numField(h, setHeader, disabled);
  const settings = useTradeSettings();
  // Round N: the customers' own delivery sites (Org Settings → Customers, id "profile:<customerId>" — what a new draft
  // picks by itself) first, then the legacy org-level list. Kato's "Kato (Nagoya)" was missing from the list.
  type Site = { id: string; customerName: string; siteName: string; address: string; notes: string; label?: string | null; warehouseName?: string | null; warehouseCheck?: boolean };
  const customerSites: Site[] = Object.entries(((settings.data as any)?.customerProfiles ?? {}) as Record<string, any>)
    .filter(([, cp]) => cp?.deliveryProfile?.siteName)
    .map(([customerId, cp]) => ({ id: `profile:${customerId}`, customerName: cp.label ?? cp.key ?? "", ...cp.deliveryProfile }));
  const profiles: Site[] = [...customerSites, ...(((settings.data as any)?.docDefaults?.deliveryProfiles ?? []) as Site[])];
  const applyProfile = (id: string) => {
    const p = profiles.find((x) => x.id === id);
    if (!p) return;
    const remarks = [`指定荷卸し場→　${p.siteName}　${p.address}`.trim(), ...(p.notes ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean)].join("\n");
    setHeader({
      deliveryProfileId: p.id,
      remarks,
      ...(p.warehouseName ? { warehouseName: p.warehouseName, warehouseCheck: false } : p.warehouseCheck ? { warehouseName: "", warehouseCheck: true } : {}),
    } as any);
    setRows((rs) => rs.map((r) => ({ ...r, destination: p.siteName })));
  };
  return (
    <>
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
          {t("section")}
        </Typography>
        <Grid2 container spacing={1.5}>
          <Grid2 size={{ xs: 12, sm: 8 }}>{tf("title", t("title"))}</Grid2>
          <Grid2 size={{ xs: 12, sm: 4 }}>{tf("requestDate", t("requestDate"), { type: "date", InputLabelProps: { shrink: true } })}</Grid2>
          <Grid2 size={{ xs: 12, sm: 6 }}>{tf("toName", t("toName"))}</Grid2>
          <Grid2 size={{ xs: 12, sm: 6 }}>{tf("issuerName", t("issuer"))}</Grid2>
          <Grid2 size={{ xs: 12, sm: 6 }}>{tf("vessel", t("vessel"))}</Grid2>
          <Grid2 size={{ xs: 12, sm: 6 }}>{tf("voyageNo", t("voyage"))}</Grid2>
          <Grid2 size={{ xs: 12, sm: 6 }}>{tf("blNumber", t("bl"))}</Grid2>
          <Grid2 size={{ xs: 12, sm: 6 }}>
            {tf("warehouseName", t("warehouse"), (h as any).warehouseCheck && !h.warehouseName ? { helperText: t("warehouseCheck"), FormHelperTextProps: { sx: { color: "warning.main" } } } : {})}
          </Grid2>
          <Grid2 size={{ xs: 6, sm: 3 }}>{nf("grossWeightMt", t("gross"))}</Grid2>
          <Grid2 size={{ xs: 6, sm: 3 }}>{nf("netWeightMt", t("net"))}</Grid2>
          <Grid2 size={{ xs: 12, sm: 6 }}>
            <TextField select size="small" fullWidth label={t("weightMode")} value={h.weightMode === "GROSS" ? "GROSS" : "NET_GROSS"} disabled={disabled} onChange={(e) => setHeader({ weightMode: e.target.value })}>
              <MenuItem value="NET_GROSS">{t("weightBoth")}</MenuItem>
              <MenuItem value="GROSS">{t("weightGross")}</MenuItem>
            </TextField>
          </Grid2>
          <Grid2 size={{ xs: 12, sm: 6 }}>{tf("shipper", t("shipper"))}</Grid2>
          <Grid2 size={{ xs: 12, sm: 6 }}>{tf("carrier", t("carrier"))}</Grid2>
          {profiles.length > 0 && (
            <Grid2 size={{ xs: 12, sm: 6 }}>
              <TextField select size="small" fullWidth label={t("deliveryProfile")} value={profiles.some((p) => p.id === h.deliveryProfileId) ? h.deliveryProfileId : ""} disabled={disabled} onChange={(e) => applyProfile(e.target.value)} helperText={t("deliveryProfileHelp")}>
                {profiles.map((p) => (
                  <MenuItem key={p.id} value={p.id}>
                    {p.label ? `${p.label} — ${p.siteName}` : `${p.siteName} — ${p.customerName}`}
                  </MenuItem>
                ))}
              </TextField>
            </Grid2>
          )}
        </Grid2>
      </Paper>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          {t("deliveries")}
        </Typography>
        {/* Round BG: paste from Excel, fill days, 出荷日 from the 納入日, rows by 納入日, totals vs the B/L. */}
        <SiDeliveries
          docId={doc.id}
          rows={rows as any}
          setRows={setRows as any}
          disabled={disabled}
          lang={lang}
          requestDate={h.requestDate}
          weightsPerRow={h.weightsPerRow === true}
          setWeightsPerRow={(v) => setHeader({ weightsPerRow: v })}
          onDelivered={(i, v) => {
            if (disabled) {
              // Final SI: saved on its own (deliveries happen after the SI is sent).
              void api
                .setDelivered(doc.id, i, v)
                .then(() => qc.invalidateQueries({ queryKey: SHIPMENT_KEYS.generated }))
                .catch((e: any) => toast.error(e?.message || "Could not save"));
            } else setRows((rs) => rs.map((x, j) => (j === i ? { ...x, delivered: v } : x)));
          }}
        />
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
          {t("billetHelp")}
        </Typography>
        <Stack sx={{ mt: 2 }}>{tf("remarks", t("remarks"), { multiline: true, minRows: 4 })}</Stack>
      </Paper>
    </>
  );
}

function SgjpLegacyForm({ header: h, rows, disabled, setHeader, setRows }: DocFormProps<any, any>) {
  const tf = field(h, setHeader, disabled);
  const nf = numField(h, setHeader, disabled);
  const amount = h.netWeightMt != null && h.unitPrice != null ? roundTo(Number(h.netWeightMt) * Number(h.unitPrice), 2) : null;
  return (
    <>
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
          Invoice
        </Typography>
        <Grid2 container spacing={1.5}>
          <Grid2 size={{ xs: 12, sm: 6 }}>{tf("invoiceNo", "Invoice no.", { placeholder: "On Finalize: SGJP-<B/L>", InputLabelProps: { shrink: true } })}</Grid2>
          <Grid2 size={{ xs: 12, sm: 6 }}>{tf("invoiceDate", "Invoice date", { type: "date", InputLabelProps: { shrink: true } })}</Grid2>
          <Grid2 size={{ xs: 12, md: 6 }}>{tf("sellerBlock", "Seller", { multiline: true, minRows: 3 })}</Grid2>
          <Grid2 size={{ xs: 12, md: 6 }}>{tf("buyerBlock", "Buyer / Consignee", { multiline: true, minRows: 3 })}</Grid2>
          <Grid2 size={{ xs: 12, sm: 4 }}>{tf("blNumber", "B/L no.")}</Grid2>
          <Grid2 size={{ xs: 12, sm: 4 }}>{tf("vessel", "Vessel")}</Grid2>
          <Grid2 size={{ xs: 12, sm: 4 }}>{tf("voyageNo", "Voyage")}</Grid2>
          <Grid2 size={{ xs: 12, sm: 4 }}>{tf("portOfLoading", "Port of loading")}</Grid2>
          <Grid2 size={{ xs: 12, sm: 4 }}>{tf("portOfDischarge", "Port of discharge")}</Grid2>
          <Grid2 size={{ xs: 12, sm: 4 }}>{tf("terms", "Terms (e.g. CIF YOKOHAMA)")}</Grid2>
          <Grid2 size={12}>{tf("description", "Description of goods", { multiline: true, minRows: 2 })}</Grid2>
          <Grid2 size={{ xs: 6, sm: 3 }}>{tf("hsCode", "HS code")}</Grid2>
          <Grid2 size={{ xs: 6, sm: 3 }}>{tf("countryOfOrigin", "Origin")}</Grid2>
          <Grid2 size={{ xs: 6, sm: 3 }}>{nf("bundles", "Bundles")}</Grid2>
          <Grid2 size={{ xs: 6, sm: 3 }}>{nf("pieces", "Pieces")}</Grid2>
          <Grid2 size={{ xs: 6, sm: 3 }}>{nf("netWeightMt", "Net MT")}</Grid2>
          <Grid2 size={{ xs: 6, sm: 3 }}>{nf("grossWeightMt", "Gross MT")}</Grid2>
          <Grid2 size={{ xs: 6, sm: 3 }}>{nf("unitPrice", "Unit price / MT")}</Grid2>
          <Grid2 size={{ xs: 6, sm: 3 }}>{tf("currency", "Currency")}</Grid2>
          <Grid2 size={12}>
            <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums" }}>
              Amount = net × price: <b>{h.currency || "USD"} {usd(amount)}</b>
            </Typography>
          </Grid2>
          <Grid2 size={12}>{tf("remarks", "Remarks", { multiline: true, minRows: 1 })}</Grid2>
        </Grid2>
      </Paper>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          Packing list (per container)
        </Typography>
        <Grid
          cols={[
            { key: "containerNo", label: "Container no." },
            { key: "bundles", label: "Bundles", num: true, width: 110 },
            { key: "netMt", label: "Net MT", num: true, width: 130 },
            { key: "grossMt", label: "Gross MT", num: true, width: 130 },
          ]}
          rows={rows}
          disabled={disabled}
          setRows={setRows}
          blank={() => ({ containerNo: "", bundles: null, netMt: null, grossMt: null })}
          footer={
            <TableRow sx={{ "& td": { fontWeight: 700, fontVariantNumeric: "tabular-nums" } }}>
              <TableCell>Total</TableCell>
              <TableCell align="right">{sum(rows, "bundles") || ""}</TableCell>
              <TableCell align="right">{usd(sum(rows, "netMt"), 3)}</TableCell>
              <TableCell align="right">{usd(sum(rows, "grossMt"), 3)}</TableCell>
              <TableCell />
            </TableRow>
          }
        />
      </Paper>
    </>
  );
}

function SiLegacyForm({ header: h, rows, disabled, setHeader, setRows }: DocFormProps<any, any>) {
  const tf = field(h, setHeader, disabled);
  const nf = numField(h, setHeader, disabled);
  return (
    <>
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
          出荷指示 / Shipping instructions
        </Typography>
        <Grid2 container spacing={1.5}>
          <Grid2 size={{ xs: 12, sm: 8 }}>{tf("title", "Title")}</Grid2>
          <Grid2 size={{ xs: 12, sm: 4 }}>{tf("date", "Date", { type: "date", InputLabelProps: { shrink: true } })}</Grid2>
          <Grid2 size={{ xs: 12, md: 6 }}>{tf("to", "To (宛先)", { multiline: true, minRows: 2 })}</Grid2>
          <Grid2 size={{ xs: 12, md: 6 }}>{tf("fromBlock", "From (差出人)", { multiline: true, minRows: 2 })}</Grid2>
          <Grid2 size={{ xs: 12, sm: 6 }}>{tf("contactName", "Contact (担当)")}</Grid2>
          <Grid2 size={{ xs: 12, sm: 6 }}>{tf("blNumber", "B/L no.")}</Grid2>
          <Grid2 size={{ xs: 12, sm: 4 }}>{tf("vessel", "Vessel")}</Grid2>
          <Grid2 size={{ xs: 12, sm: 4 }}>{tf("voyageNo", "Voyage")}</Grid2>
          <Grid2 size={{ xs: 12, sm: 4 }}>{tf("eta", "Latest ETA", { type: "date", InputLabelProps: { shrink: true } })}</Grid2>
          <Grid2 size={{ xs: 6, sm: 3 }}>{nf("containerCount", "Containers")}</Grid2>
          <Grid2 size={{ xs: 6, sm: 9 }}>{tf("telexReleaseCode", "Telex release code")}</Grid2>
          <Grid2 size={12}>{tf("cargoDescription", "Cargo", { multiline: true, minRows: 1 })}</Grid2>
          <Grid2 size={{ xs: 6, sm: 3 }}>{nf("netWeightMt", "Net MT")}</Grid2>
          <Grid2 size={{ xs: 6, sm: 3 }}>{nf("grossWeightMt", "Gross MT")}</Grid2>
          <Grid2 size={{ xs: 6, sm: 3 }}>{nf("bundles", "Bundles")}</Grid2>
          <Grid2 size={{ xs: 6, sm: 3 }}>{nf("pieces", "Pieces")}</Grid2>
          <Grid2 size={12}>{tf("deliveryAddress", "Delivery address (納入先)", { multiline: true, minRows: 2 })}</Grid2>
        </Grid2>
      </Paper>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          配送スケジュール / Delivery schedule
        </Typography>
        <Grid
          cols={[
            { key: "date", label: "Date / range" },
            { key: "trucks", label: "Trucks", num: true, width: 100 },
            { key: "mt", label: "MT", num: true, width: 120 },
            { key: "notes", label: "Notes" },
          ]}
          rows={rows}
          disabled={disabled}
          setRows={setRows}
          blank={() => ({ date: "", trucks: null, mt: null, notes: "" })}
          footer={
            <TableRow sx={{ "& td": { fontWeight: 700, fontVariantNumeric: "tabular-nums" } }}>
              <TableCell>Total</TableCell>
              <TableCell align="right">{sum(rows, "trucks") || ""}</TableCell>
              <TableCell align="right">{usd(sum(rows, "mt"), 3)}</TableCell>
              <TableCell colSpan={2} />
            </TableRow>
          }
        />
        <Stack sx={{ mt: 2 }}>
          {tf("specialInstructions", "Special instructions (特記事項)", { multiline: true, minRows: 3 })}
        </Stack>
      </Paper>
    </>
  );
}
