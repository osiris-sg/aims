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
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useShipmentsApi, type DocFormatView, type FormatPreview } from "../../_lib/api";
import { CLIENT_KEYS } from "../../_lib/hooks";
import { fmtDay } from "../../_lib/format";
import { toast } from "../../_lib/toast";
import { ConfirmDialog } from "../../_components/bits";

const b64Url = (base64: string, type: string) => URL.createObjectURL(new Blob([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], { type }));

export default function DocumentFormatsPanel({ customerId, formats, lang }: { customerId: string; formats: DocFormatView[]; lang: "en" | "ja" }) {
  const api = useShipmentsApi();
  const ships = useQuery({ queryKey: [...CLIENT_KEYS.all, "preview-shipments", customerId], queryFn: () => api.clientPreviewShipments(customerId) });
  return (
    <Stack spacing={2} data-tour="client-doc-formats">
      <Alert severity="info" sx={{ py: 0 }}>
        {lang === "ja"
          ? "ステップ4の「Vedantaファイルから作成」は、ここで選んだフォーマットを使います。プレビューは実際の出荷のVedantaファイルから作るだけで、何も保存しません。"
          : "Step 4's “Create from Vedanta file” uses the format chosen here. A preview builds the document from a real shipment's Vedanta file and saves nothing."}
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
      toast.success(`${f.title}: saved`);
    } catch (e: any) {
      toast.error(e?.message || "Could not save");
    } finally {
      setSaving(false);
    }
  };
  const upload = async (file: File) => {
    setUploading(true);
    try {
      await api.clientAddSample(customerId, f.docType, file);
      await refresh();
      toast.success(`${file.name} added`);
    } catch (e: any) {
      toast.error(e?.message || "Upload failed");
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
      toast.error(e?.message || "Could not open the file");
    }
  };
  const runPreview = async () => {
    if (!shipmentId) return;
    setPreviewing(true);
    try {
      const r = await api.clientPreview(customerId, f.docType, { shipmentId, generator: gen });
      setPreview({ r, pdfUrl: b64Url(r.pdf.base64, r.pdf.contentType) });
    } catch (e: any) {
      toast.error(e?.message || "Preview failed");
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
        <Chip size="small" label={`${lang === "ja" ? "ステップ" : "Step"} ${f.step}`} />
        <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
          {lang === "ja" ? f.titleJa : f.title}
        </Typography>
        {!f.formatConfirmed && <Chip size="small" color="warning" variant="outlined" label={lang === "ja" ? "フォーマット未確認" : "format not yet confirmed"} />}
        {!f.formatConfirmed && !f.samples.length && <Chip size="small" color="warning" label={lang === "ja" ? "ADHからサンプルが必要" : "needs a sample from ADH"} data-tour="client-format-needs-sample" />}
      </Stack>
      <Grid2 container spacing={1.5}>
        <Grid2 size={{ xs: 12, md: 6 }}>
          {f.choose === "variant" ? (
            <TextField select fullWidth size="small" label={lang === "ja" ? "フォーマット（生成方法）" : "Format (generator)"} value={gen} onChange={(e) => setGen(e.target.value)} data-tour="client-format-generator">
              {f.options.map((o) => (
                <MenuItem key={o.key} value={o.key}>
                  {o.label}
                  {o.formatConfirmed ? "" : " — not confirmed"}
                </MenuItem>
              ))}
            </TextField>
          ) : (
            <TextField fullWidth size="small" label={lang === "ja" ? "フォーマット" : "Format"} value={f.generatorLabel} disabled helperText={f.choose === "billing" ? (lang === "ja" ? "請求方式に従います（組織設定 → 顧客）" : "Follows the billing mode (Org Settings → Customers)") : lang === "ja" ? "全顧客共通のレイアウト" : "One layout for every customer"} />
          )}
        </Grid2>
        <Grid2 size={{ xs: 6, md: 2 }}>
          <TextField select fullWidth size="small" label={lang === "ja" ? "言語" : "Language"} value={language} onChange={(e) => setLanguage(e.target.value as any)} disabled={!jaLayout} helperText={jaLayout ? undefined : lang === "ja" ? "固定" : "fixed"}>
            <MenuItem value="ja">日本語</MenuItem>
            <MenuItem value="en">English</MenuItem>
          </TextField>
        </Grid2>
        <Grid2 size={{ xs: 12, md: 4 }}>
          <TextField fullWidth size="small" label="宛先" value={addressee} onChange={(e) => setAddressee(e.target.value)} placeholder={f.effectiveAddressee} helperText={lang === "ja" ? `空欄 = ${f.effectiveAddressee}` : `Blank = ${f.effectiveAddressee}`} />
        </Grid2>
        <Grid2 size={12}>
          <TextField fullWidth size="small" multiline minRows={1} label={lang === "ja" ? "メモ" : "Notes"} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={lang === "ja" ? "例: VedantaのCOA.xlsから作成" : "e.g. made from Vedanta's COA.xls; SUS wants the .xls"} />
        </Grid2>
      </Grid2>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mt: 1.5 }}>
        <Typography variant="body2" color="text.secondary">
          {lang === "ja" ? "サンプル" : "Samples"}:
        </Typography>
        {f.samples.map((s) => (
          <Chip key={s.id} size="small" variant="outlined" label={s.fileName} title={`${fmtDay(s.uploadedAt)}${s.uploadedByName ? ` · ${s.uploadedByName}` : ""}`} onClick={() => void openSample(s.id)} onDelete={() => setHide({ id: s.id, fileName: s.fileName })} />
        ))}
        {!f.samples.length && (
          <Typography variant="body2" color="text.disabled">
            {lang === "ja" ? "なし" : "none yet"}
          </Typography>
        )}
        <input ref={input} type="file" hidden onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
        <Button size="small" startIcon={uploading ? <CircularProgress size={14} /> : <UploadFileIcon />} disabled={uploading} onClick={() => input.current?.click()} sx={{ textTransform: "none" }} data-tour="client-format-sample">
          {lang === "ja" ? "サンプルを追加" : "Add sample"}
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button size="small" variant="contained" disabled={!dirty || saving} onClick={() => void save()} sx={{ textTransform: "none" }}>
          {saving ? "Saving…" : lang === "ja" ? "保存" : "Save"}
        </Button>
      </Stack>
      {f.previewable && (
        <Box sx={{ mt: 2, pt: 1.5, borderTop: "1px solid", borderColor: "divider" }} data-tour="client-format-preview">
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <TextField select size="small" label={lang === "ja" ? "出荷（プレビュー）" : "Preview on shipment"} value={shipmentId} onChange={(e) => setShipmentId(e.target.value)} sx={{ minWidth: 240 }} disabled={!usable.length}>
              {usable.map((s) => (
                <MenuItem key={s.id} value={s.id}>
                  {s.ref} · {s.blNumber ?? "B/L pending"}
                </MenuItem>
              ))}
            </TextField>
            <Button size="small" variant="outlined" startIcon={previewing ? <CircularProgress size={14} /> : <VisibilityIcon />} disabled={!shipmentId || previewing} onClick={() => void runPreview()} sx={{ textTransform: "none" }}>
              {lang === "ja" ? "プレビュー" : "Preview"}
            </Button>
            {!usable.length && (
              <Typography variant="body2" color="text.secondary">
                {lang === "ja" ? "Vedantaのファイルがある出荷がまだありません" : `No shipment has Vedanta's ${f.docType === "CUSTOMER_COA" ? "COA" : "PL"} file yet`}
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
                {preview.r.source ? `From ${preview.r.source}` : ""} · {preview.r.notes.join(" · ")}
              </Typography>
              <Box component="iframe" src={preview.pdfUrl} title="Preview" sx={{ width: "100%", height: 520, border: "1px solid", borderColor: "divider", borderRadius: 1, mt: 0.5, bgcolor: "#fff" }} />
            </Box>
          )}
        </Box>
      )}
      <ConfirmDialog
        open={!!hide}
        title={`Hide ${hide?.fileName ?? ""}?`}
        body="It leaves this list. The file itself is kept (nothing is deleted)."
        confirmLabel="Hide"
        onClose={() => setHide(null)}
        onConfirm={async () => {
          await api.clientHideSample(customerId, f.docType, hide!.id);
          await refresh();
          toast.success("Sample hidden");
        }}
      />
    </Paper>
  );
}
