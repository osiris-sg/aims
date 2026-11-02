"use client";

// Round BA — the customer's packing on the order page (Details tab and the shipment view): packing notes, photos
// (signed URLs; click opens full size), linked issues and per-product bundle data with photos — from
// Clients › the customer › Packing / Products. Renders nothing when the customer has none of it.

import React, { useState } from "react";
import { Box, ButtonBase, Chip, Dialog, DialogActions, DialogContent, Button, Paper, Stack, Typography } from "@mui/material";
import { useTranslations } from "next-intl";
import { useUiLang } from "@/i18n/UiLangProvider";
import { useCustomerPacking } from "../_lib/hooks";
import type { ProfileFileView } from "../_lib/api";

function Thumbs({ files, onOpen }: { files: ProfileFileView[]; onOpen: (f: ProfileFileView) => void }) {
  const t = useTranslations("addflow.panel");
  return (
    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
      {files.filter((f) => f.url).map((f) => (
        <ButtonBase key={f.id} onClick={() => onOpen(f)} aria-label={t("open")} title={[f.caption, f.takenOn ? String(f.takenOn).slice(0, 10) : null].filter(Boolean).join(" · ") || f.fileName} sx={{ borderRadius: 1, flexDirection: "column", alignItems: "flex-start", width: 96 }}>
          <Box component="img" src={f.url!} alt={f.caption ?? f.fileName} sx={{ width: 96, height: 72, objectFit: "cover", borderRadius: 1, border: 1, borderColor: "divider", display: "block" }} />
          {f.caption && (
            <Typography variant="caption" color="text.secondary" noWrap sx={{ width: 96, textAlign: "left" }}>
              {f.caption}
            </Typography>
          )}
        </ButtonBase>
      ))}
    </Stack>
  );
}

export default function CustomerPackingPanel({ customerId }: { customerId: string | null | undefined }) {
  const t = useTranslations("addflow.panel");
  const { lang } = useUiLang();
  const q = useCustomerPacking(customerId);
  const [full, setFull] = useState<ProfileFileView | null>(null);
  const p = q.data;
  const images = (p?.images ?? []).filter((f) => f.url);
  const products = (p?.products ?? []).filter((x) => x.piecesPerBundle != null || x.bundleWeightKg != null || x.images.some((f) => f.url));
  const issues = p?.issues ?? [];
  if (!p || (!p.notes?.trim() && !images.length && !issues.length && !products.length)) return null;
  return (
    <Paper variant="outlined" sx={{ p: 1.5 }} data-tour="order-packing">
      <Typography variant="overline" color="text.secondary">
        {t("title")}
      </Typography>
      <Stack spacing={1.25}>
        {p.notes?.trim() && (
          <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
            {p.notes}
          </Typography>
        )}
        {images.length > 0 && <Thumbs files={images} onOpen={setFull} />}
        {issues.length > 0 && (
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
              {t("issues")}
            </Typography>
            <Stack spacing={0.75}>
              {issues.map((i) => {
                const summary = lang === "ja" ? i.summaryJa || i.summaryEn : i.summaryEn || i.summaryJa;
                return (
                  <Box key={i.id}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>
                        {i.title}
                      </Typography>
                      <Chip size="small" variant="outlined" color={i.status === "OPEN" ? "warning" : "default"} label={i.status === "OPEN" || i.status === "RESOLVED" ? t(`status.${i.status}`) : i.status} />
                    </Stack>
                    {summary && (
                      <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                        {summary}
                      </Typography>
                    )}
                  </Box>
                );
              })}
            </Stack>
          </Box>
        )}
        {products.length > 0 && (
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
              {t("products")}
            </Typography>
            <Stack spacing={1}>
              {products.map((x) => (
                <Box key={x.id}>
                  <Typography variant="body2">
                    <b>{x.label}</b>
                    {[x.piecesPerBundle != null ? t("bundle", { pieces: x.piecesPerBundle }) : null, x.bundleWeightKg != null ? t("weight", { kg: x.bundleWeightKg }) : null].filter(Boolean).map((s) => ` · ${s}`).join("")}
                  </Typography>
                  {x.images.some((f) => f.url) && (
                    <Box sx={{ mt: 0.5 }}>
                      <Thumbs files={x.images} onOpen={setFull} />
                    </Box>
                  )}
                </Box>
              ))}
            </Stack>
          </Box>
        )}
      </Stack>
      <Dialog open={!!full} onClose={() => setFull(null)} maxWidth="lg">
        <DialogContent sx={{ p: 1 }}>
          {full?.url && <Box component="img" src={full.url} alt={full.caption ?? full.fileName} sx={{ maxWidth: "100%", maxHeight: "80vh", display: "block" }} />}
          {full?.caption && (
            <Typography variant="body2" sx={{ mt: 1 }}>
              {[full.caption, full.takenOn ? String(full.takenOn).slice(0, 10) : null].filter(Boolean).join(" · ")}
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          {full?.url && (
            <Button href={full.url} target="_blank" rel="noopener noreferrer">
              {t("open")}
            </Button>
          )}
          <Button onClick={() => setFull(null)}>{t("close")}</Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}
