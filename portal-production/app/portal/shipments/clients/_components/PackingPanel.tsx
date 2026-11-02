/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Round BA — Clients › Packing: the company's packing photo gallery (caption + date), packing notes, linked packing
// issues, and each product's packing photos grouped under its label. Photos are hidden, never deleted.

import React, { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Box, Button, Chip, CircularProgress, Paper, Stack, TextField, Typography } from "@mui/material";
import { useShipmentsApi, type ClientCatalog, type ClientKind } from "../../_lib/api";
import { fmtDay } from "../../_lib/format";
import { toast } from "../../_lib/toast";
import { useLang } from "./ClientsBits";
import { PhotoThumb, PhotoUploader, useRefreshClients } from "./ProfileFiles";

function PackingNotes({ kind, id, notes }: { kind: ClientKind; id: string; notes: string | null }) {
  const t = useTranslations("catalog");
  const api = useShipmentsApi();
  const refresh = useRefreshClients();
  const [v, setV] = useState(notes ?? "");
  const [busy, setBusy] = useState(false);
  useEffect(() => setV(notes ?? ""), [notes]);
  const dirty = v.trim() !== (notes ?? "").trim();
  const save = async () => {
    setBusy(true);
    try {
      await api.clientSavePacking(kind, id, { notes: v.trim() || null });
      await refresh();
      toast.success(t("packing.notesSaved"));
    } catch (e: any) {
      toast.error(e?.message || t("packing.notesFailed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Stack spacing={1}>
      <TextField multiline minRows={3} label={t("packing.notes")} placeholder={t("packing.notesPlaceholder")} value={v} onChange={(e) => setV(e.target.value)} />
      <Box>
        <Button variant="contained" size="small" onClick={() => void save()} disabled={!dirty || busy} startIcon={busy ? <CircularProgress size={14} /> : undefined}>
          {t("packing.saveNotes")}
        </Button>
      </Box>
    </Stack>
  );
}

export function PackingPanel({ kind, id, catalog }: { kind: ClientKind; id: string; catalog?: ClientCatalog | null }) {
  const t = useTranslations("catalog");
  const lang = useLang();
  const packing = catalog?.packing ?? { notes: null, images: [], issues: [] };
  const withPhotos = (catalog?.products ?? []).filter((p) => p.packingImages.length > 0);
  return (
    <Stack spacing={2}>
      <Paper variant="outlined" sx={{ p: 2 }} data-tour="packing-gallery">
        <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
          {t("packing.gallery")}
        </Typography>
        {packing.images.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            {t("packing.noPhotos")}
          </Typography>
        ) : (
          <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap sx={{ mb: 1.5 }}>
            {packing.images.map((f) => (
              <PhotoThumb key={f.id} kind={kind} id={id} file={f} />
            ))}
          </Stack>
        )}
        <PhotoUploader kind={kind} id={id} productId={null} />
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
          {t("packing.notesTitle")}
        </Typography>
        <PackingNotes kind={kind} id={id} notes={packing.notes} />
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 0.5 }}>
          {t("packing.issues")}
        </Typography>
        <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1 }}>
          {t("packing.issuesHint")}
        </Typography>
        {packing.issues.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {t("packing.noIssues")}
          </Typography>
        ) : (
          <Stack spacing={1}>
            {packing.issues.map((i) => {
              const summary = (lang === "ja" ? i.summaryJa || i.summaryEn : i.summaryEn || i.summaryJa) ?? "";
              return (
                <Box key={i.id} sx={{ borderLeft: 3, borderColor: "warning.main", pl: 1.5, py: 0.5 }}>
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                      {i.title}
                    </Typography>
                    <Chip size="small" variant="outlined" label={i.status} />
                    <Typography variant="caption" color="text.secondary">
                      {fmtDay(i.createdAt)}
                    </Typography>
                  </Stack>
                  {summary && (
                    <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: "pre-line" }}>
                      {summary}
                    </Typography>
                  )}
                </Box>
              );
            })}
          </Stack>
        )}
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
          {t("packing.byProduct")}
        </Typography>
        {withPhotos.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {t("packing.noProductPhotos")}
          </Typography>
        ) : (
          <Stack spacing={2}>
            {withPhotos.map((p) => (
              <Box key={p.id}>
                <Typography variant="body2" sx={{ fontWeight: 700, mb: 1 }}>
                  {p.label || t("products.unnamed")}
                </Typography>
                <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
                  {p.packingImages.map((f) => (
                    <PhotoThumb key={f.id} kind={kind} id={id} file={f} size={110} />
                  ))}
                </Stack>
              </Box>
            ))}
          </Stack>
        )}
      </Paper>
    </Stack>
  );
}
