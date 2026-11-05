/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Round AM — Clients › a customer › Document formats: per document AIMS makes for this customer (step 4 Customer COA /
// packing list, 7 SG→JP INVOICE & PACKING LIST, 9 出庫・納入依頼書, 11 invoice) — which generator / layout, its 宛先 and
// language, a note, the customer's sample / template files, and a preview on a real shipment (read-only: the document
// as AIMS would make it from that shipment's Vedanta file; nothing is created). The step-4 generator chosen here is
// what "Create from Vedanta file" uses on the customer's shipments (the profile's docVariants).

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Box, Button, Chip, CircularProgress, Grid2, MenuItem, Paper, Stack, TextField, Typography } from "@mui/material";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import VisibilityIcon from "@mui/icons-material/Visibility";
import DownloadIcon from "@mui/icons-material/Download";
import { useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useShipmentsApi, type DocFormatView, type FormatPreview, type SiFormat } from "../../_lib/api";
import { CLIENT_KEYS, useTradeSettings } from "../../_lib/hooks";
import { Table, TableBody, TableCell, TableHead, TableRow } from "@mui/material";
import { fmtDay } from "../../_lib/format";
import { toast } from "../../_lib/toast";
import { ConfirmDialog } from "../../_components/bits";

const b64Url = (base64: string, type: string) => URL.createObjectURL(new Blob([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], { type }));

export default function DocumentFormatsPanel({ customerId, formats, lang }: { customerId: string; formats: DocFormatView[]; lang: "en" | "ja" }) {
  const api = useShipmentsApi();
  const t = useTranslations("clients.formats");
  const ships = useQuery({ queryKey: [...CLIENT_KEYS.all, "preview-shipments", customerId], queryFn: () => api.clientPreviewShipments(customerId) });
  return (
    <Stack spacing={2} data-tour="client-doc-formats">
      <Alert severity="info" sx={{ py: 0 }}>
        {t("intro")}
      </Alert>
      {formats.map((f) => (
        <FormatCard key={f.docType} customerId={customerId} f={f} lang={lang} shipments={ships.data ?? []} />
      ))}
    </Stack>
  );
}

function FormatCard({ customerId, f, lang, shipments }: { customerId: string; f: DocFormatView; lang: "en" | "ja"; shipments: Array<{ id: string; ref: string; blNumber: string | null; hasCoa: boolean; hasPl: boolean }> }) {
  const api = useShipmentsApi();
  const qc = useQueryClient();
  const t = useTranslations("clients.formats");
  const [gen, setGen] = useState(f.generator);
  const [language, setLanguage] = useState(f.language);
  const [addressee, setAddressee] = useState(f.addressee ?? "");
  const [notes, setNotes] = useState(f.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [hide, setHide] = useState<{ id: string; fileName: string } | null>(null);
  const [shipmentId, setShipmentId] = useState("");
  const [preview, setPreview] = useState<{ r: FormatPreview; pdfUrl: string } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setGen(f.generator);
    setLanguage(f.language);
    setAddressee(f.addressee ?? "");
    setNotes(f.notes ?? "");
  }, [f]);
  useEffect(() => () => (preview ? URL.revokeObjectURL(preview.pdfUrl) : undefined), [preview]);
  const usable = useMemo(() => shipments.filter((s) => (f.docType === "CUSTOMER_COA" ? s.hasCoa : s.hasPl)), [shipments, f.docType]);
  useEffect(() => {
    if (!shipmentId && usable[0]) setShipmentId(usable[0].id);
  }, [usable, shipmentId]);
  const dirty = gen !== f.generator || language !== f.language || addressee !== (f.addressee ?? "") || notes !== (f.notes ?? "");
  const refresh = () => qc.invalidateQueries({ queryKey: CLIENT_KEYS.all });
  const save = async () => {
    setSaving(true);
    try {
      await api.clientUpdateFormat(customerId, f.docType, { ...(f.choose === "variant" ? { generator: gen } : {}), language, addressee: addressee || null, notes: notes || null });
      await refresh();
      toast.success(t("saved", { title: f.title }));
    } catch (e: any) {
      toast.error(e?.message || t("couldNotSave"));
    } finally {
      setSaving(false);
    }
  };
  const upload = async (file: File) => {
    setUploading(true);
    try {
      await api.clientAddSample(customerId, f.docType, file);
      await refresh();
      toast.success(t("added", { name: file.name }));
    } catch (e: any) {
      toast.error(e?.message || t("uploadFailed"));
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  };
  const openSample = async (id: string) => {
    try {
      const s = await api.clientSampleUrl(customerId, f.docType, id);
      window.open(s.url, "_blank", "noopener");
    } catch (e: any) {
      toast.error(e?.message || t("couldNotOpen"));
    }
  };
  const runPreview = async () => {
    if (!shipmentId) return;
    setPreviewing(true);
    try {
      const r = await api.clientPreview(customerId, f.docType, { shipmentId, generator: gen });
      setPreview({ r, pdfUrl: b64Url(r.pdf.base64, r.pdf.contentType) });
    } catch (e: any) {
      toast.error(e?.message || t("previewFailed"));
    } finally {
      setPreviewing(false);
    }
  };
  const downloadXlsx = () => {
    if (!preview?.r.xlsx) return;
    const a = document.createElement("a");
    a.href = b64Url(preview.r.xlsx.base64, preview.r.xlsx.contentType);
    a.download = preview.r.xlsx.fileName;
    a.click();
  };
  const jaLayout = f.docType === "CUSTOMER_COA" || f.docType === "CUSTOMER_PL";
  return (
    <Paper variant="outlined" sx={{ p: { xs: 1.5, md: 2 } }} data-tour={`client-format-${f.docType}`}>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 1.5 }}>
        <Chip size="small" label={t("step", { n: f.step })} />
        <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
          {lang === "ja" ? f.titleJa : f.title}
        </Typography>
        {!f.formatConfirmed && <Chip size="small" color="warning" variant="outlined" label={t("notConfirmed")} />}
        {!f.formatConfirmed && !f.samples.length && <Chip size="small" color="warning" label={t("needsSample")} data-tour="client-format-needs-sample" />}
      </Stack>
      <Grid2 container spacing={1.5}>
        <Grid2 size={{ xs: 12, md: 6 }}>
          {f.choose === "variant" ? (
            <TextField select fullWidth size="small" label={t("generator")} value={gen} onChange={(e) => setGen(e.target.value)} data-tour="client-format-generator">
              {f.options.map((o) => (
                <MenuItem key={o.key} value={o.key}>
                  {o.label}
                  {o.formatConfirmed ? "" : t("optNotConfirmed")}
                </MenuItem>
              ))}
            </TextField>
          ) : (
            <TextField fullWidth size="small" label={t("format")} value={f.generatorLabel} disabled helperText={f.choose === "billing" ? t("followsBilling") : t("oneLayout")} />
          )}
        </Grid2>
        <Grid2 size={{ xs: 6, md: 2 }}>
          <TextField select fullWidth size="small" label={t("language")} value={language} onChange={(e) => setLanguage(e.target.value as any)} disabled={!jaLayout} helperText={jaLayout ? undefined : t("fixed")}>
            <MenuItem value="ja">日本語</MenuItem>
            <MenuItem value="en">English</MenuItem>
          </TextField>
        </Grid2>
        <Grid2 size={{ xs: 12, md: 4 }}>
          <TextField fullWidth size="small" label={t("addressee")} value={addressee} onChange={(e) => setAddressee(e.target.value)} placeholder={f.effectiveAddressee} helperText={t("blank", { v: f.effectiveAddressee })} />
        </Grid2>
        <Grid2 size={12}>
          <TextField fullWidth size="small" multiline minRows={1} label={t("notes")} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("notesPh")} />
        </Grid2>
      </Grid2>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mt: 1.5 }}>
        <Typography variant="body2" color="text.secondary">
          {t("samples")}:
        </Typography>
        {f.samples.map((s) => (
          <Chip key={s.id} size="small" variant="outlined" label={s.fileName} title={`${fmtDay(s.uploadedAt)}${s.uploadedByName ? ` · ${s.uploadedByName}` : ""}`} onClick={() => void openSample(s.id)} onDelete={() => setHide({ id: s.id, fileName: s.fileName })} />
        ))}
        {!f.samples.length && (
          <Typography variant="body2" color="text.disabled">
            {t("none")}
          </Typography>
        )}
        <input ref={input} type="file" hidden onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
        <Button size="small" startIcon={uploading ? <CircularProgress size={14} /> : <UploadFileIcon />} disabled={uploading} onClick={() => input.current?.click()} sx={{ textTransform: "none" }} data-tour="client-format-sample">
          {t("addSample")}
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button size="small" variant="contained" disabled={!dirty || saving} onClick={() => void save()} sx={{ textTransform: "none" }}>
          {saving ? t("saving") : t("save")}
        </Button>
      </Stack>
      {f.docType === "SHIPPING_INSTRUCTIONS" && <SiSettings customerId={customerId} f={f} />}
      {f.previewable && (
        <Box sx={{ mt: 2, pt: 1.5, borderTop: "1px solid", borderColor: "divider" }} data-tour="client-format-preview">
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <TextField select size="small" label={t("previewOn")} value={shipmentId} onChange={(e) => setShipmentId(e.target.value)} sx={{ minWidth: 240 }} disabled={!usable.length}>
              {usable.map((s) => (
                <MenuItem key={s.id} value={s.id}>
                  {s.ref} · {s.blNumber ?? t("blPending")}
                </MenuItem>
              ))}
            </TextField>
            <Button size="small" variant="outlined" startIcon={previewing ? <CircularProgress size={14} /> : <VisibilityIcon />} disabled={!shipmentId || previewing} onClick={() => void runPreview()} sx={{ textTransform: "none" }}>
              {t("preview")}
            </Button>
            {!usable.length && (
              <Typography variant="body2" color="text.secondary">
                {t("noVedanta", { kind: f.docType === "CUSTOMER_COA" ? "COA" : "PL" })}
              </Typography>
            )}
            {preview?.r.xlsx && (
              <Button size="small" startIcon={<DownloadIcon />} onClick={downloadXlsx} sx={{ textTransform: "none" }}>
                {preview.r.xlsx.fileName}
              </Button>
            )}
          </Stack>
          {preview && (
            <Box sx={{ mt: 1 }}>
              <Typography variant="caption" color="text.secondary" display="block">
                {preview.r.source ? t("fromSource", { source: preview.r.source }) : ""} · {preview.r.notes.join(" · ")}
              </Typography>
              <Box component="iframe" src={preview.pdfUrl} title={t("preview")} sx={{ width: "100%", height: 520, border: "1px solid", borderColor: "divider", borderRadius: 1, mt: 0.5, bgcolor: "#fff" }} />
            </Box>
          )}
        </Box>
      )}
      <ConfirmDialog
        open={!!hide}
        title={t("hideTitle", { name: hide?.fileName ?? "" })}
        body={t("hideBody")}
        confirmLabel={t("hide")}
        onClose={() => setHide(null)}
        onConfirm={async () => {
          await api.clientHideSample(customerId, f.docType, hide!.id);
          await refresh();
          toast.success(t("hidden"));
        }}
      />
    </Paper>
  );
}

/**
 * Round BF — 出庫・納入依頼書 settings for this customer (new SIs only): product line style, weights, default 備考,
 * 運送会社, 倉庫名; and ADH's own .xlsx template with its field → cell mapping (found from {{field}} placeholders or
 * the printed labels; a typed cell overrides).
 */
function SiSettings({ customerId, f }: { customerId: string; f: DocFormatView }) {
  const api = useShipmentsApi();
  const qc = useQueryClient();
  const t = useTranslations("si.formats");
  const settings = useTradeSettings();
  const orgCarrier = ((settings.data as any)?.docDefaults?.siCarrier as string | undefined) ?? "";
  const init = (si: SiFormat | null | undefined) => ({
    productStyle: si?.productStyle ?? "JA_EN",
    weightMode: si?.weightMode ?? "NET_GROSS",
    defaultRemarks: si?.defaultRemarks ?? "",
    carrier: si?.carrier ?? "",
    warehouseName: si?.warehouseName ?? "",
  });
  const [d, setD] = useState(init(f.si));
  const [cells, setCells] = useState<Record<string, string>>(f.si?.xlsxMapping ?? {});
  const [busy, setBusy] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setD(init(f.si));
    setCells(f.si?.xlsxMapping ?? {});
  }, [f.si]);
  const mapping = useQuery({ queryKey: [...CLIENT_KEYS.all, "si-mapping", customerId, f.xlsxTemplate?.id ?? "none"], queryFn: () => api.clientSiTemplateMapping(customerId), enabled: !!f.xlsxTemplate });
  const refresh = () => qc.invalidateQueries({ queryKey: CLIENT_KEYS.all });
  const dirty = JSON.stringify(d) !== JSON.stringify(init(f.si));
  const cellsDirty = JSON.stringify(cells) !== JSON.stringify(f.si?.xlsxMapping ?? {});
  const save = async (withCells: boolean) => {
    setBusy(withCells ? "cells" : "save");
    try {
      await api.clientUpdateFormat(customerId, "SHIPPING_INSTRUCTIONS", { si: { ...d, xlsxMapping: withCells ? cells : (f.si?.xlsxMapping ?? {}) } as SiFormat });
      await refresh();
      toast.success(t("saved"));
    } catch (e: any) {
      toast.error(e?.message || "Could not save");
    } finally {
      setBusy(null);
    }
  };
  const upload = async (file: File) => {
    setBusy("upload");
    try {
      const r = await api.clientSetSiTemplate(customerId, file);
      await refresh();
      toast.success(t("xlsxUploaded", { name: file.name, found: String(r.siTemplate?.found ?? 0) }));
    } catch (e: any) {
      toast.error(e?.message || "Upload failed");
    } finally {
      setBusy(null);
      if (input.current) input.current.value = "";
    }
  };
  const stop = async () => {
    setBusy("stop");
    try {
      await api.clientHideSiTemplate(customerId);
      await refresh();
      toast.success(t("xlsxStopped"));
    } catch (e: any) {
      toast.error(e?.message || "Could not save");
    } finally {
      setBusy(null);
    }
  };
  const how = (h: string) => t(h === "placeholder" ? "howPlaceholder" : h === "label" ? "howLabel" : h === "manual" ? "howManual" : "howNone");
  return (
    <Box sx={{ mt: 2, pt: 1.5, borderTop: "1px solid", borderColor: "divider" }} data-tour="client-format-si-settings">
      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        {t("title")}
      </Typography>
      <Grid2 container spacing={1.5}>
        <Grid2 size={{ xs: 6, md: 3 }}>
          <TextField select fullWidth size="small" label={t("productStyle")} value={d.productStyle} onChange={(e) => setD({ ...d, productStyle: e.target.value as any })}>
            <MenuItem value="JA_EN">{t("styleJaEn")}</MenuItem>
            <MenuItem value="JA">{t("styleJa")}</MenuItem>
          </TextField>
        </Grid2>
        <Grid2 size={{ xs: 6, md: 3 }}>
          <TextField select fullWidth size="small" label={t("weightMode")} value={d.weightMode} onChange={(e) => setD({ ...d, weightMode: e.target.value as any })}>
            <MenuItem value="NET_GROSS">{t("weightBoth")}</MenuItem>
            <MenuItem value="GROSS">{t("weightGross")}</MenuItem>
          </TextField>
        </Grid2>
        <Grid2 size={{ xs: 12, md: 3 }}>
          <TextField fullWidth size="small" label={t("carrier")} value={d.carrier} onChange={(e) => setD({ ...d, carrier: e.target.value })} placeholder={orgCarrier ? t("carrierPh", { v: orgCarrier }) : undefined} />
        </Grid2>
        <Grid2 size={{ xs: 12, md: 3 }}>
          <TextField fullWidth size="small" label={t("warehouse")} value={d.warehouseName} onChange={(e) => setD({ ...d, warehouseName: e.target.value })} placeholder={t("warehousePh")} />
        </Grid2>
        <Grid2 size={12}>
          <TextField fullWidth size="small" multiline minRows={2} label={t("defaultRemarks")} value={d.defaultRemarks} onChange={(e) => setD({ ...d, defaultRemarks: e.target.value })} />
        </Grid2>
      </Grid2>
      <Stack direction="row" sx={{ mt: 1 }}>
        <Box sx={{ flex: 1 }} />
        <Button size="small" variant="contained" disabled={!dirty || !!busy} onClick={() => void save(false)} sx={{ textTransform: "none" }}>
          {busy === "save" ? "…" : t("save")}
        </Button>
      </Stack>
      <Box sx={{ mt: 1.5 }} data-tour="client-format-si-xlsx">
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <Typography variant="body2" sx={{ fontWeight: 700 }}>
            {t("xlsxTitle")}
          </Typography>
          {f.xlsxTemplate ? (
            <Chip size="small" color="success" variant="outlined" label={t("xlsxUsing", { name: f.xlsxTemplate.fileName })} title={`${fmtDay(f.xlsxTemplate.uploadedAt)}${f.xlsxTemplate.uploadedByName ? ` · ${f.xlsxTemplate.uploadedByName}` : ""}`} />
          ) : (
            <Typography variant="body2" color="text.secondary">
              {t("xlsxNone")}
            </Typography>
          )}
          <input ref={input} type="file" accept=".xlsx" hidden onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
          <Button size="small" startIcon={busy === "upload" ? <CircularProgress size={14} /> : <UploadFileIcon />} disabled={!!busy} onClick={() => input.current?.click()} sx={{ textTransform: "none" }}>
            {f.xlsxTemplate ? t("xlsxReplace") : t("xlsxUpload")}
          </Button>
          {f.xlsxTemplate && (
            <Button size="small" color="inherit" disabled={!!busy} onClick={() => void stop()} sx={{ textTransform: "none" }}>
              {t("xlsxStop")}
            </Button>
          )}
        </Stack>
        {f.xlsxTemplate && (
          <Box sx={{ mt: 1 }}>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
              <b>{t("mappingTitle")}</b> · {t("mappingHelp", { example: "{{vessel}}" })}
            </Typography>
            {mapping.isLoading ? (
              <CircularProgress size={18} />
            ) : (
              <Box sx={{ overflowX: "auto", border: 1, borderColor: "divider", borderRadius: 1 }}>
                <Table size="small" sx={{ "& td, & th": { py: 0.4 } }}>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 700 }}>{t("field")}</TableCell>
                      <TableCell sx={{ fontWeight: 700, width: 130 }}>{t("cell")}</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>{t("how")}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(mapping.data?.mapping ?? []).map((m) => (
                      <TableRow key={m.field}>
                        <TableCell>{t(`fields.${m.field}` as any)}</TableCell>
                        <TableCell>
                          <TextField
                            size="small"
                            variant="standard"
                            value={cells[m.field] ?? ""}
                            placeholder={m.how === "manual" ? "" : (m.cell ?? "—")}
                            onChange={(e) => setCells((c) => ({ ...c, [m.field]: e.target.value.toUpperCase() }))}
                            inputProps={{ "aria-label": `${m.field} cell`, style: { fontFamily: "monospace" } }}
                          />
                        </TableCell>
                        <TableCell>
                          <Chip size="small" variant="outlined" color={m.how === "none" ? "warning" : "default"} label={how(m.how)} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            )}
            <Stack direction="row" sx={{ mt: 1 }}>
              <Box sx={{ flex: 1 }} />
              <Button size="small" variant="outlined" disabled={!cellsDirty || !!busy} onClick={() => void save(true)} sx={{ textTransform: "none" }}>
                {t("saveMapping")}
              </Button>
            </Stack>
          </Box>
        )}
      </Box>
    </Box>
  );
}
