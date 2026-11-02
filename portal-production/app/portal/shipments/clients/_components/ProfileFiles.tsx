/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Round BA — shared bits of the Products / Packing tabs: a file chip that opens a signed URL, a photo thumbnail
// (signed URL fetched on demand), a photo uploader with caption + date, and a "hide" confirm. Files are hidden,
// never deleted.

import React, { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Stack, TextField, Tooltip, Typography } from "@mui/material";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import AddPhotoAlternateIcon from "@mui/icons-material/AddPhotoAlternate";
import { useShipmentsApi, type ClientKind, type ProfileFileView } from "../../_lib/api";
import { CLIENT_KEYS } from "../../_lib/hooks";
import { toast } from "../../_lib/toast";
import { fmtDay } from "../../_lib/format";

/** Refresh every Clients query after a change. */
export function useRefreshClients() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: CLIENT_KEYS.all });
}

/** Open a profile file (signed URL, new tab). */
export function useOpenProfileFile(kind: ClientKind, id: string) {
  const api = useShipmentsApi();
  const t = useTranslations("catalog");
  return async (fileId: string) => {
    try {
      const f = await api.clientProfileFileUrl(kind, id, fileId);
      window.open(f.url, "_blank", "noopener");
    } catch (e: any) {
      toast.error(e?.message || t("files.openFailed"));
    }
  };
}

/** "Hide …?" confirm dialog. */
export function ConfirmHide({ open, title, body, onCancel, onConfirm, busy }: { open: boolean; title: string; body: string; onCancel: () => void; onConfirm: () => void; busy?: boolean }) {
  const t = useTranslations("catalog");
  return (
    <Dialog open={open} onClose={onCancel} maxWidth="xs" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Typography variant="body2">{body}</Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} disabled={busy}>{t("common.cancel")}</Button>
        <Button color="error" variant="contained" onClick={onConfirm} disabled={busy}>{t("common.hide")}</Button>
      </DialogActions>
    </Dialog>
  );
}

/** One spec sheet / file: opens on click, hide button (confirmed). */
export function FileChip({ kind, id, file }: { kind: ClientKind; id: string; file: ProfileFileView }) {
  const t = useTranslations("catalog");
  const api = useShipmentsApi();
  const open = useOpenProfileFile(kind, id);
  const refresh = useRefreshClients();
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const hide = async () => {
    setBusy(true);
    try {
      await api.clientHideProfileFile(kind, id, file.id);
      await refresh();
      setAsk(false);
    } catch (e: any) {
      toast.error(e?.message || t("files.hideFailed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Chip
        size="small"
        variant="outlined"
        icon={<AttachFileIcon />}
        label={file.fileName}
        onClick={() => void open(file.id)}
        onDelete={() => setAsk(true)}
        deleteIcon={<Tooltip title={t("files.hide")}><VisibilityOffIcon /></Tooltip>}
        sx={{ maxWidth: 320 }}
        title={`${file.fileName} · ${fmtDay(file.uploadedAt)}${file.uploadedByName ? ` · ${file.uploadedByName}` : ""}`}
      />
      <ConfirmHide open={ask} title={t("files.hideTitle")} body={t("files.hideBody", { name: file.fileName })} onCancel={() => setAsk(false)} onConfirm={() => void hide()} busy={busy} />
    </>
  );
}

/** A photo thumbnail: the signed URL is fetched when it is shown; click opens it full size. */
export function PhotoThumb({ kind, id, file, size = 140 }: { kind: ClientKind; id: string; file: ProfileFileView; size?: number }) {
  const t = useTranslations("catalog");
  const api = useShipmentsApi();
  const refresh = useRefreshClients();
  const [url, setUrl] = useState<string | null>(file.url ?? null);
  const [failed, setFailed] = useState(false);
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (file.url) return;
    let alive = true;
    api
      .clientProfileFileUrl(kind, id, file.id)
      .then((f) => alive && setUrl(f.url))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.id]);
  const hide = async () => {
    setBusy(true);
    try {
      await api.clientHideProfileFile(kind, id, file.id);
      await refresh();
      setAsk(false);
    } catch (e: any) {
      toast.error(e?.message || t("files.hideFailed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Box sx={{ width: size }}>
      <Box
        onClick={() => url && window.open(url, "_blank", "noopener")}
        sx={{ width: size, height: size, borderRadius: 1, border: 1, borderColor: "divider", bgcolor: "action.hover", overflow: "hidden", cursor: url ? "zoom-in" : "default", display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}
        title={t("photos.openFull")}
      >
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={file.caption ?? file.fileName} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : failed ? (
          <Typography variant="caption" color="text.secondary">{t("photos.unavailable")}</Typography>
        ) : (
          <CircularProgress size={20} />
        )}
        <IconButton
          size="small"
          onClick={(e) => {
            e.stopPropagation();
            setAsk(true);
          }}
          sx={{ position: "absolute", top: 2, right: 2, bgcolor: "background.paper", "&:hover": { bgcolor: "background.paper" } }}
          aria-label={t("files.hide")}
        >
          <VisibilityOffIcon fontSize="inherit" />
        </IconButton>
      </Box>
      <Typography variant="caption" component="div" sx={{ mt: 0.5, lineHeight: 1.3 }} noWrap title={file.caption ?? file.fileName}>
        {file.caption || file.fileName}
      </Typography>
      <Typography variant="caption" color="text.secondary" component="div">
        {file.takenOn ? fmtDay(file.takenOn) : fmtDay(file.uploadedAt)}
      </Typography>
      <ConfirmHide open={ask} title={t("files.hideTitle")} body={t("files.hideBody", { name: file.caption || file.fileName })} onCancel={() => setAsk(false)} onConfirm={() => void hide()} busy={busy} />
    </Box>
  );
}

/** Upload a photo (caption + date first) to a product (productId) or the company's Packing gallery (null). */
export function PhotoUploader({ kind, id, productId, dataTour }: { kind: ClientKind; id: string; productId: string | null; dataTour?: string }) {
  const t = useTranslations("catalog");
  const api = useShipmentsApi();
  const refresh = useRefreshClients();
  const input = useRef<HTMLInputElement>(null);
  const [caption, setCaption] = useState("");
  const [takenOn, setTakenOn] = useState("");
  const [busy, setBusy] = useState(false);
  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      await api.clientUploadProfileFile(kind, id, productId, "packing", file, { caption: caption.trim() || undefined, takenOn: takenOn || undefined });
      await refresh();
      setCaption("");
      setTakenOn("");
      toast.success(t("photos.added"));
    } catch (e: any) {
      toast.error(e?.message || t("files.uploadFailed"));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };
  return (
    <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "center" }} data-tour={dataTour}>
      <TextField size="small" label={t("photos.caption")} placeholder={t("photos.captionPlaceholder")} value={caption} onChange={(e) => setCaption(e.target.value)} sx={{ flex: 1, minWidth: 180 }} />
      <TextField size="small" type="date" label={t("photos.takenOn")} value={takenOn} onChange={(e) => setTakenOn(e.target.value)} InputLabelProps={{ shrink: true }} sx={{ width: 170 }} />
      <input ref={input} type="file" accept="image/*" hidden onChange={(e) => void upload(e.target.files?.[0])} />
      <Button variant="outlined" startIcon={busy ? <CircularProgress size={16} /> : <AddPhotoAlternateIcon />} onClick={() => input.current?.click()} disabled={busy}>
        {t("photos.add")}
      </Button>
    </Stack>
  );
}

/** Upload a spec sheet (PDF / Excel / image) to a product. */
export function SpecUploader({ kind, id, productId }: { kind: ClientKind; id: string; productId: string }) {
  const t = useTranslations("catalog");
  const api = useShipmentsApi();
  const refresh = useRefreshClients();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      await api.clientUploadProfileFile(kind, id, productId, "spec", file);
      await refresh();
      toast.success(t("files.specAdded"));
    } catch (e: any) {
      toast.error(e?.message || t("files.uploadFailed"));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };
  return (
    <>
      <input ref={input} type="file" accept=".pdf,.xlsx,.xls,.csv,.doc,.docx,image/*" hidden onChange={(e) => void upload(e.target.files?.[0])} />
      <Button size="small" startIcon={busy ? <CircularProgress size={14} /> : <AttachFileIcon />} onClick={() => input.current?.click()} disabled={busy}>
        {t("files.uploadSpec")}
      </Button>
    </>
  );
}
