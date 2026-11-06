/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Round BA — Clients › Products: what a customer buys / a supplier sells (grade, form, size, standard, chemistry,
// bundle data, monthly quantity, price basis), with spec sheets and packing photos per product. Hide, never delete.

import React, { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Autocomplete, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Menu, MenuItem, Paper,
  Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import { PRODUCT_FORMS, useShipmentsApi, type ChemLimit, type ClientCatalog, type ClientKind, type ClientProductInput, type ClientProductView, type ProductForm } from "../../_lib/api";
import { toast } from "../../_lib/toast";
import { docLines } from "@/helpers/siDocLines";
import { t3 } from "./ClientsBits";
import { ConfirmHide, FileChip, PhotoThumb, PhotoUploader, SpecUploader, useRefreshClients } from "./ProfileFiles";

const GRADES = ["6063", "6005", "6061", "P1020", "P0507", "1070", "HSB"];
const PRICE_BASES = ["LME + premium", "MJP + premium", "upcharge"];
/** Product fields with a label (a seeded row's toConfirm names these). */
const FIELD_KEYS = new Set(["grade", "form", "size", "diameterMm", "lengthMm", "sizeText", "standard", "chemistry", "tolerances", "piecesPerBundle", "bundleWeightKg", "monthlyQtyMt", "priceBasis", "notes", "docNameJa", "docNameEn", "docSize", "hsCode"]);

/** The product form's label ("billet", "remelt ingot"…) in the portal language. */
export function useFormLabel() {
  const t = useTranslations("catalog");
  return (f: ProductForm | null | undefined) => (f ? t(`forms.${f}`) : "");
}

type ChemRow = { element: string; min: string; max: string };
type Draft = {
  grade: string; form: ProductForm | ""; diameterMm: string; lengthMm: string; sizeText: string; standard: string; chemistry: ChemRow[];
  tolerances: string; piecesPerBundle: string; bundleWeightKg: string; monthlyQtyMt: string; priceBasis: string; notes: string;
  docNameJa: string; docNameEn: string; docSize: string; hsCode: string;
};
const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const toDraft = (p?: ClientProductView | null): Draft => ({
  grade: s(p?.grade), form: p?.form ?? "", diameterMm: s(p?.diameterMm), lengthMm: s(p?.lengthMm), sizeText: s(p?.sizeText), standard: s(p?.standard),
  chemistry: (p?.chemistry ?? []).map((c) => ({ element: c.element, min: s(c.min), max: s(c.max) })),
  tolerances: s(p?.tolerances), piecesPerBundle: s(p?.piecesPerBundle), bundleWeightKg: s(p?.bundleWeightKg), monthlyQtyMt: s(p?.monthlyQtyMt),
  priceBasis: s(p?.priceBasis), notes: s(p?.notes),
  docNameJa: s(p?.docNameJa), docNameEn: s(p?.docNameEn), docSize: s(p?.docSize), hsCode: s(p?.hsCode),
});
const n = (v: string) => (v.trim() === "" ? null : Number(v.replace(/,/g, "")));
const txt = (v: string) => v.trim() || null;
const toInput = (d: Draft): ClientProductInput => ({
  grade: txt(d.grade), form: d.form || null, diameterMm: n(d.diameterMm), lengthMm: n(d.lengthMm), sizeText: txt(d.sizeText), standard: txt(d.standard),
  chemistry: d.chemistry.filter((c) => c.element.trim()).map((c): ChemLimit => ({ element: c.element.trim(), min: n(c.min), max: n(c.max) })),
  tolerances: txt(d.tolerances), piecesPerBundle: n(d.piecesPerBundle), bundleWeightKg: n(d.bundleWeightKg), monthlyQtyMt: n(d.monthlyQtyMt),
  priceBasis: txt(d.priceBasis), notes: txt(d.notes),
  docNameJa: txt(d.docNameJa), docNameEn: txt(d.docNameEn), docSize: txt(d.docSize), hsCode: txt(d.hsCode),
});

/** Add / edit one product. */
function ProductDialog({ open, onClose, kind, id, product }: { open: boolean; onClose: () => void; kind: ClientKind; id: string; product: ClientProductView | null }) {
  const t = useTranslations("catalog");
  const ts = useTranslations("si.product");
  const api = useShipmentsApi();
  const refresh = useRefreshClients();
  const formLabel = useFormLabel();
  const [d, setD] = useState<Draft>(toDraft(product));
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setD(toDraft(product));
  }, [open, product]);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((p) => ({ ...p, [k]: v }));
  const setChem = (i: number, k: keyof ChemRow, v: string) => setD((p) => ({ ...p, chemistry: p.chemistry.map((c, j) => (j === i ? { ...c, [k]: v } : c)) }));
  const bad = [d.diameterMm, d.lengthMm, d.piecesPerBundle, d.bundleWeightKg, d.monthlyQtyMt, ...d.chemistry.flatMap((c) => [c.min, c.max])].some((v) => v.trim() !== "" && !Number.isFinite(Number(v.replace(/,/g, ""))));
  const empty = !d.grade.trim() && !d.form && !d.sizeText.trim() && !(d.diameterMm.trim() && d.lengthMm.trim()) && !d.notes.trim();
  const save = async () => {
    setBusy(true);
    try {
      await api.clientSaveProduct(kind, id, product?.id ?? null, toInput(d));
      await refresh();
      toast.success(product ? t("products.saved") : t("products.added"));
      onClose();
    } catch (e: any) {
      toast.error(e?.message || t("products.saveFailed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="md" fullWidth>
      <DialogTitle>{product ? t("products.editTitle", { label: product.label }) : t("products.addTitle")}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <Autocomplete freeSolo options={GRADES} value={d.grade} onInputChange={(_, v) => set("grade", v)} sx={{ flex: 1 }} renderInput={(p) => <TextField {...p} size="small" label={t("fields.grade")} />} />
            <TextField select size="small" label={t("fields.form")} value={d.form} onChange={(e) => set("form", e.target.value as ProductForm | "")} sx={{ flex: 1 }}>
              <MenuItem value="">—</MenuItem>
              {PRODUCT_FORMS.map((f) => (
                <MenuItem key={f} value={f}>
                  {formLabel(f)}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems={{ sm: "center" }}>
            <TextField size="small" label={t("fields.diameterMm")} value={d.diameterMm} onChange={(e) => set("diameterMm", e.target.value)} inputMode="decimal" sx={{ width: { sm: 150 } }} />
            <Typography color="text.secondary">×</Typography>
            <TextField size="small" label={t("fields.lengthMm")} value={d.lengthMm} onChange={(e) => set("lengthMm", e.target.value)} inputMode="decimal" sx={{ width: { sm: 150 } }} />
            <Typography color="text.secondary">{t("fields.or")}</Typography>
            <TextField size="small" label={t("fields.sizeText")} placeholder={t("fields.sizeTextPlaceholder")} value={d.sizeText} onChange={(e) => set("sizeText", e.target.value)} sx={{ flex: 1 }} />
          </Stack>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField size="small" label={t("fields.standard")} placeholder={t("fields.standardPlaceholder")} value={d.standard} onChange={(e) => set("standard", e.target.value)} sx={{ flex: 1 }} />
            {/* Round BJ: customs HS code — used when a B/L / CI prints none; a different code on a shipment is warned about. */}
            <TextField size="small" label={t("fields.hsCode")} placeholder="7601.20" helperText={t("fields.hsCodeHelp")} value={d.hsCode} onChange={(e) => set("hsCode", e.target.value)} sx={{ width: { sm: 220 } }} inputProps={{ "data-tour": "client-product-hs" }} />
          </Stack>
          <Box>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
              {t("fields.chemistry")}
            </Typography>
            {d.chemistry.length > 0 && (
              <Table size="small" sx={{ mb: 1, "& td, & th": { py: 0.5 } }}>
                <TableHead>
                  <TableRow>
                    <TableCell>{t("chem.element")}</TableCell>
                    <TableCell>{t("chem.min")}</TableCell>
                    <TableCell>{t("chem.max")}</TableCell>
                    <TableCell />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {d.chemistry.map((c, i) => (
                    <TableRow key={i}>
                      <TableCell>
                        <TextField size="small" value={c.element} onChange={(e) => setChem(i, "element", e.target.value)} placeholder="Si" inputProps={{ maxLength: 3 }} sx={{ width: 90 }} />
                      </TableCell>
                      <TableCell>
                        <TextField size="small" value={c.min} onChange={(e) => setChem(i, "min", e.target.value)} inputMode="decimal" sx={{ width: 110 }} />
                      </TableCell>
                      <TableCell>
                        <TextField size="small" value={c.max} onChange={(e) => setChem(i, "max", e.target.value)} inputMode="decimal" sx={{ width: 110 }} />
                      </TableCell>
                      <TableCell align="right">
                        <IconButton size="small" aria-label={t("chem.remove")} onClick={() => setD((p) => ({ ...p, chemistry: p.chemistry.filter((_, j) => j !== i) }))}>
                          <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <Button size="small" startIcon={<AddIcon />} onClick={() => setD((p) => ({ ...p, chemistry: [...p.chemistry, { element: "", min: "", max: "" }] }))}>
              {t("chem.add")}
            </Button>
          </Box>
          <TextField size="small" multiline minRows={2} label={t("fields.tolerances")} value={d.tolerances} onChange={(e) => set("tolerances", e.target.value)} />
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField size="small" label={t("fields.piecesPerBundle")} value={d.piecesPerBundle} onChange={(e) => set("piecesPerBundle", e.target.value)} inputMode="numeric" sx={{ flex: 1 }} />
            <TextField size="small" label={t("fields.bundleWeightKg")} value={d.bundleWeightKg} onChange={(e) => set("bundleWeightKg", e.target.value)} inputMode="decimal" sx={{ flex: 1 }} />
            <TextField size="small" label={t("fields.monthlyQtyMt")} value={d.monthlyQtyMt} onChange={(e) => set("monthlyQtyMt", e.target.value)} inputMode="decimal" sx={{ flex: 1 }} />
          </Stack>
          <Autocomplete freeSolo options={PRICE_BASES} value={d.priceBasis} onInputChange={(_, v) => set("priceBasis", v)} renderInput={(p) => <TextField {...p} size="small" label={t("fields.priceBasis")} />} />
          <TextField size="small" multiline minRows={2} label={t("fields.notes")} value={d.notes} onChange={(e) => set("notes", e.target.value)} />
          {/* Round BF: how the product prints on the 出庫・納入依頼書 (one line each, never broken inside a word). */}
          <Box data-tour="client-product-docname">
            <Typography variant="subtitle2">{ts("docName")}</Typography>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
              {ts("docNameHelp")}
            </Typography>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField size="small" multiline minRows={2} label={ts("docNameJa")} placeholder={ts("docNameJaPh")} value={d.docNameJa} onChange={(e) => set("docNameJa", e.target.value)} sx={{ flex: 1 }} />
              <TextField size="small" multiline minRows={2} label={ts("docNameEn")} placeholder={ts("docNameEnPh")} value={d.docNameEn} onChange={(e) => set("docNameEn", e.target.value)} sx={{ flex: 1 }} />
              <TextField size="small" label={ts("docSize")} placeholder={ts("docSizePh")} value={d.docSize} onChange={(e) => set("docSize", e.target.value)} sx={{ width: { sm: 140 } }} />
            </Stack>
            {docLines(d).length > 0 && (
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                {ts("printsAs", { text: docLines(d).join(" / ") })}
              </Typography>
            )}
          </Box>
          {bad && <Typography color="error" variant="body2">{t("products.badNumber")}</Typography>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>{t("common.cancel")}</Button>
        <Button variant="contained" onClick={() => void save()} disabled={busy || bad || empty} startIcon={busy ? <CircularProgress size={16} /> : undefined}>
          {t("common.save")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** One product: its data, chips for what is still to confirm / where it came from, spec sheets and packing photos. */
function ProductCard({ kind, id, p, onMenu }: { kind: ClientKind; id: string; p: ClientProductView; onMenu: (e: React.MouseEvent, p: ClientProductView) => void }) {
  const t = useTranslations("catalog");
  const formLabel = useFormLabel();
  const row = (k: string, v: React.ReactNode) =>
    v === null || v === undefined || v === "" ? null : (
      <Stack direction="row" spacing={1} key={k}>
        <Typography variant="body2" color="text.secondary" sx={{ minWidth: 150 }}>
          {t(`fields.${k}`)}
        </Typography>
        <Typography variant="body2" component="div" sx={{ whiteSpace: "pre-line", flex: 1 }}>
          {v}
        </Typography>
      </Stack>
    );
  const lim = (c: ChemLimit) => (c.min != null && c.max != null ? `${c.min}–${c.max}%` : c.max != null ? `≤ ${c.max}%` : `≥ ${c.min}%`);
  const chem = (p.chemistry ?? []).map((c) => `${c.element} ${lim(c)}`).join(" · ");
  return (
    <Paper variant="outlined" sx={{ p: 2 }} data-tour="client-product">
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
        <Typography variant="h6" sx={{ fontWeight: 800 }}>
          {p.label || t("products.unnamed")}
        </Typography>
        {(p.toConfirm ?? []).map((k) => (
          <Chip key={k} size="small" color="warning" variant="outlined" label={t("products.toConfirm", { field: FIELD_KEYS.has(k) ? t(`fields.${k}`) : k })} />
        ))}
        {p.source && <Chip size="small" variant="outlined" label={t("products.source", { source: p.source })} sx={{ maxWidth: 420 }} title={p.source} />}
        <Box sx={{ flex: 1 }} />
        <IconButton size="small" aria-label={t("common.actions")} onClick={(e) => onMenu(e, p)}>
          <MoreVertIcon fontSize="small" />
        </IconButton>
      </Stack>
      <Stack spacing={0.4}>
        {row("grade", p.grade)}
        {row("form", formLabel(p.form))}
        {row("size", p.size)}
        {row("standard", p.standard)}
        {row("hsCode", p.hsCode)}
        {row("chemistry", chem)}
        {row("tolerances", p.tolerances)}
        {row("piecesPerBundle", p.piecesPerBundle === null || p.piecesPerBundle === undefined ? null : t3(p.piecesPerBundle))}
        {row("bundleWeightKg", p.bundleWeightKg === null || p.bundleWeightKg === undefined ? null : `${t3(p.bundleWeightKg)} kg`)}
        {row("monthlyQtyMt", p.monthlyQtyMt === null || p.monthlyQtyMt === undefined ? null : `${t3(p.monthlyQtyMt)} t`)}
        {row("priceBasis", p.priceBasis)}
        {row("notes", p.notes)}
        {row("docName", docLines({ docNameJa: s(p.docNameJa), docNameEn: s(p.docNameEn), docSize: s(p.docSize) }).join(" / ") || null)}
      </Stack>
      <Box sx={{ mt: 1.5 }}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <Typography variant="subtitle2">{t("files.specSheets")}</Typography>
          {p.specFiles.length === 0 && (
            <Typography variant="body2" color="text.secondary">
              {t("files.noSpecs")}
            </Typography>
          )}
          {p.specFiles.map((f) => (
            <FileChip key={f.id} kind={kind} id={id} file={f} />
          ))}
          <SpecUploader kind={kind} id={id} productId={p.id} />
        </Stack>
      </Box>
      <Box sx={{ mt: 1.5 }}>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          {t("photos.packingPhotos")}
        </Typography>
        {p.packingImages.length > 0 && (
          <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
            {p.packingImages.map((f) => (
              <PhotoThumb key={f.id} kind={kind} id={id} file={f} size={110} />
            ))}
          </Stack>
        )}
        <PhotoUploader kind={kind} id={id} productId={p.id} />
      </Box>
    </Paper>
  );
}

export function ProductsPanel({ kind, id, catalog }: { kind: ClientKind; id: string; catalog?: ClientCatalog | null }) {
  const t = useTranslations("catalog");
  const api = useShipmentsApi();
  const refresh = useRefreshClients();
  const [editing, setEditing] = useState<{ product: ClientProductView | null } | null>(null);
  const [menu, setMenu] = useState<{ pos: { left: number; top: number }; p: ClientProductView } | null>(null);
  const [hiding, setHiding] = useState<ClientProductView | null>(null);
  const [busy, setBusy] = useState(false);
  const products = catalog?.products ?? [];
  const hide = async () => {
    if (!hiding) return;
    setBusy(true);
    try {
      await api.clientHideProduct(kind, id, hiding.id, true);
      await refresh();
      toast.success(t("products.hidden"));
      setHiding(null);
    } catch (e: any) {
      toast.error(e?.message || t("products.hideFailed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Stack spacing={2}>
      <Stack direction="row" alignItems="center" spacing={1}>
        <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
          {kind === "customers" ? t("products.introCustomer") : t("products.introSupplier")}
          {catalog?.hiddenProducts ? ` ${t("products.hiddenN", { n: catalog.hiddenProducts })}` : ""}
        </Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing({ product: null })} data-tour="product-add">
          {t("products.add")}
        </Button>
      </Stack>
      {products.length === 0 && <Typography color="text.secondary">{t("products.none")}</Typography>}
      {products.map((p) => (
        <ProductCard
          key={p.id}
          kind={kind}
          id={id}
          p={p}
          onMenu={(e, prod) => {
            e.stopPropagation();
            setMenu({ pos: { left: e.clientX, top: e.clientY }, p: prod });
          }}
        />
      ))}
      <Menu open={!!menu} onClose={() => setMenu(null)} anchorReference="anchorPosition" anchorPosition={menu?.pos}>
        <MenuItem
          onClick={(e) => {
            e.stopPropagation();
            setEditing({ product: menu!.p });
            setMenu(null);
          }}
        >
          {t("products.edit")}
        </MenuItem>
        <MenuItem
          sx={{ color: "error.main" }}
          onClick={(e) => {
            e.stopPropagation();
            setHiding(menu!.p);
            setMenu(null);
          }}
        >
          {t("products.hide")}
        </MenuItem>
      </Menu>
      <ProductDialog open={!!editing} onClose={() => setEditing(null)} kind={kind} id={id} product={editing?.product ?? null} />
      <ConfirmHide
        open={!!hiding}
        title={t("products.hideTitle")}
        body={t("products.hideBody", { label: hiding?.label || t("products.unnamed") })}
        onCancel={() => setHiding(null)}
        onConfirm={() => void hide()}
        busy={busy}
      />
    </Stack>
  );
}
