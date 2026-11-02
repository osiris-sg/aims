"use client";

// Round BA — "+ Add customer / supplier" steps after Basic: Products, Packing and Contract. Presentational: the
// drawer (CompanyDrawer) keeps the drafts and does the saving, so "Next" and "Save and finish later" can save what
// is typed on any step.

import React from "react";
import { Box, Button, Chip, Grid2, MenuItem, Paper, Stack, TextField, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import PhotoIcon from "@mui/icons-material/PhotoCameraOutlined";
import { useTranslations } from "next-intl";
import { PRODUCT_FORMS, type ClientProductInput, type ClientProductView, type ProductForm, type ProfileFileView } from "../../_lib/api";

export type ProductDraft = Record<"grade" | "form" | "diameterMm" | "lengthMm" | "sizeText" | "piecesPerBundle" | "bundleWeightKg" | "monthlyQtyMt" | "priceBasis" | "notes", string>;
export const EMPTY_PRODUCT: ProductDraft = { grade: "", form: "", diameterMm: "", lengthMm: "", sizeText: "", piecesPerBundle: "", bundleWeightKg: "", monthlyQtyMt: "", priceBasis: "", notes: "" };
export const productPending = (d: ProductDraft) => Object.values(d).some((v) => v.trim() !== "");
const n = (v: string) => (v.trim() === "" ? null : Number(v.replace(/,/g, "")));
const s = (v: string) => v.trim() || null;
export const productBody = (d: ProductDraft): ClientProductInput => ({
  grade: s(d.grade),
  form: (d.form || null) as ProductForm | null,
  diameterMm: n(d.diameterMm),
  lengthMm: n(d.lengthMm),
  sizeText: s(d.sizeText),
  piecesPerBundle: n(d.piecesPerBundle),
  bundleWeightKg: n(d.bundleWeightKg),
  monthlyQtyMt: n(d.monthlyQtyMt),
  priceBasis: s(d.priceBasis),
  notes: s(d.notes),
});

export type PhotoDraft = { file: File | null; caption: string; takenOn: string };
export const EMPTY_PHOTO: PhotoDraft = { file: null, caption: "", takenOn: "" };

export function AddFlowProductsStep({ kind, draft, setDraft, products, busy, onAdd }: { kind: "customer" | "supplier"; draft: ProductDraft; setDraft: (d: ProductDraft) => void; products: ClientProductView[]; busy: boolean; onAdd: () => void }) {
  const t = useTranslations("addflow.products");
  const tf = (k: keyof ProductDraft, label: string, extra: Record<string, unknown> = {}) => <TextField size="small" fullWidth label={label} value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} {...extra} />;
  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>{kind === "customer" ? t("introC") : t("introS")}</Typography>
      <Grid2 container spacing={1.25}>
        <Grid2 size={{ xs: 6, sm: 4 }}>{tf("grade", t("grade"), { placeholder: t("gradeHint") })}</Grid2>
        <Grid2 size={{ xs: 6, sm: 4 }}>
          <TextField select size="small" fullWidth label={t("form")} value={draft.form} onChange={(e) => setDraft({ ...draft, form: e.target.value })}>
            <MenuItem value="">—</MenuItem>
            {PRODUCT_FORMS.map((f) => <MenuItem key={f} value={f}>{t(`forms.${f}`)}</MenuItem>)}
          </TextField>
        </Grid2>
        <Grid2 size={{ xs: 6, sm: 2 }}>{tf("diameterMm", t("diameter"), { type: "number" })}</Grid2>
        <Grid2 size={{ xs: 6, sm: 2 }}>{tf("lengthMm", t("length"), { type: "number" })}</Grid2>
        <Grid2 size={12}>{tf("sizeText", t("sizeText"), { placeholder: t("sizeTextHint"), disabled: !!(draft.diameterMm && draft.lengthMm) })}</Grid2>
        <Grid2 size={{ xs: 6, sm: 4 }}>{tf("piecesPerBundle", t("pieces"), { type: "number" })}</Grid2>
        <Grid2 size={{ xs: 6, sm: 4 }}>{tf("bundleWeightKg", t("bundleKg"), { type: "number" })}</Grid2>
        <Grid2 size={{ xs: 12, sm: 4 }}>{tf("monthlyQtyMt", t("monthly"), { type: "number" })}</Grid2>
        <Grid2 size={12}>{tf("priceBasis", t("priceBasis"), { placeholder: t("priceBasisHint") })}</Grid2>
        <Grid2 size={12}>{tf("notes", t("notes"), { multiline: true, minRows: 2 })}</Grid2>
      </Grid2>
      <Button size="small" variant="outlined" startIcon={<AddIcon />} sx={{ mt: 1.25 }} disabled={busy || !productPending(draft)} onClick={onAdd}>{t("add")}</Button>
      <Typography variant="subtitle2" sx={{ fontWeight: 800, mt: 2, mb: 0.75 }}>{t("list", { n: products.length })}</Typography>
      {products.length ? (
        <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
          {products.map((p) => <Chip key={p.id} size="small" label={[p.label, p.monthlyQtyMt != null ? `${p.monthlyQtyMt} t` : null].filter(Boolean).join(" · ")} />)}
        </Stack>
      ) : (
        <Typography variant="body2" color="text.secondary">{t("none")}</Typography>
      )}
    </Box>
  );
}

export function AddFlowPackingStep({ notes, setNotes, notesDirty, photo, setPhoto, images, busy, onSaveNotes, onUpload }: { notes: string; setNotes: (v: string) => void; notesDirty: boolean; photo: PhotoDraft; setPhoto: (p: PhotoDraft) => void; images: ProfileFileView[]; busy: boolean; onSaveNotes: () => void; onUpload: () => void }) {
  const t = useTranslations("addflow.packing");
  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>{t("intro")}</Typography>
      <TextField size="small" fullWidth multiline minRows={3} label={t("notes")} value={notes} onChange={(e) => setNotes(e.target.value)} />
      <Button size="small" variant="outlined" sx={{ mt: 1 }} disabled={busy || !notesDirty} onClick={onSaveNotes}>{t("saveNotes")}</Button>
      <Paper variant="outlined" sx={{ p: 1.5, mt: 2 }}>
        <Grid2 container spacing={1.25} alignItems="center">
          <Grid2 size={12}>
            <Button component="label" size="small" startIcon={<PhotoIcon />} disabled={busy}>
              {photo.file ? photo.file.name : t("choose")}
              <input hidden type="file" accept="image/*" onChange={(e) => setPhoto({ ...photo, file: e.target.files?.[0] ?? null })} />
            </Button>
          </Grid2>
          <Grid2 size={{ xs: 12, sm: 8 }}>
            <TextField size="small" fullWidth label={t("caption")} placeholder={t("captionHint")} value={photo.caption} onChange={(e) => setPhoto({ ...photo, caption: e.target.value })} />
          </Grid2>
          <Grid2 size={{ xs: 12, sm: 4 }}>
            <TextField size="small" fullWidth type="date" label={t("takenOn")} InputLabelProps={{ shrink: true }} value={photo.takenOn} onChange={(e) => setPhoto({ ...photo, takenOn: e.target.value })} />
          </Grid2>
        </Grid2>
        <Button size="small" variant="outlined" sx={{ mt: 1.25 }} disabled={busy || !photo.file} onClick={onUpload}>{t("upload")}</Button>
      </Paper>
      <Typography variant="subtitle2" sx={{ fontWeight: 800, mt: 2, mb: 0.75 }}>{t("photos", { n: images.length })}</Typography>
      {images.length ? (
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {images.map((f) => (
            <Box key={f.id} sx={{ width: 120 }}>
              {f.url ? (
                <Box component="img" src={f.url} alt={f.caption ?? f.fileName} sx={{ width: 120, height: 90, objectFit: "cover", borderRadius: 1, border: 1, borderColor: "divider", display: "block" }} />
              ) : (
                <Box sx={{ width: 120, height: 90, borderRadius: 1, border: 1, borderColor: "divider", display: "flex", alignItems: "center", justifyContent: "center", bgcolor: "action.hover" }}><PhotoIcon color="disabled" /></Box>
              )}
              <Typography variant="caption" sx={{ display: "block" }} noWrap title={f.caption ?? f.fileName}>{f.caption || f.fileName}</Typography>
              {f.takenOn && <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>{String(f.takenOn).slice(0, 10)}</Typography>}
            </Box>
          ))}
        </Stack>
      ) : (
        <Typography variant="body2" color="text.secondary">{t("none")}</Typography>
      )}
    </Box>
  );
}

export function AddFlowContractStep({ kind, count, onAdd }: { kind: "customer" | "supplier"; count: number; onAdd: () => void }) {
  const t = useTranslations("addflow.contract");
  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>{kind === "customer" ? t("introC") : t("introS")}</Typography>
      <Button variant="outlined" startIcon={<AddIcon />} onClick={onAdd}>{t("add")}</Button>
      {count > 0 && <Typography variant="body2" sx={{ mt: 1.5 }}>{t("list", { n: count })}</Typography>}
    </Box>
  );
}
