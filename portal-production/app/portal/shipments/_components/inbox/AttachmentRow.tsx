/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Round BF (Sayaka) — one attachment as a row: name, size · pages, when its email arrived (JST) · who sent it, the
// version badges (Latest / Older version (5/11 14:02) / Identical to …), an eye that previews it in place, Download,
// and "Compare" (two same-name files side by side). Used by "Where does each file go?" (the Answer flow), "Show full
// email › All files in this thread" and a shipment slot's "Newer version received". The URL is fetched on demand.

import React, { createContext, useContext, useState } from "react";
import { Box, Button, Chip, Collapse, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Stack, Tooltip, Typography } from "@mui/material";
import DownloadIcon from "@mui/icons-material/Download";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import CompareIcon from "@mui/icons-material/Compare";
import { useTranslations } from "next-intl";
import { fmtSize } from "../../_lib/email-html";
import { factsLine, versionBadges, type FileVersion } from "../../_lib/file-versions";
import { fromParts, whenShort } from "../../_lib/inbox-threads";
import { toast } from "../../_lib/toast";
import type { InboxLang } from "../../_lib/api";

export type AttachmentView = {
  key: string;
  name: string;
  contentType?: string | null;
  size?: number | null;
  pages?: number | null;
  date?: string | null;
  from?: string | null;
  company?: string | null;
  version?: FileVersion | null;
  /** Signed URL of the bytes (fetched on Preview / Download / Compare). */
  getUrl: () => Promise<string | null>;
};

/** Preview pages only (/preview/shipments/*, no sign-in): where a file's bytes are served, by its key. Unset in the app. */
export const FileUrlOverride = createContext<((key: string) => string | null) | null>(null);
const useUrlOf = () => {
  const override = useContext(FileUrlOverride);
  return (f: AttachmentView) => (override ? Promise.resolve(override(f.key)) : f.getUrl());
};

const kindOf = (f: Pick<AttachmentView, "name" | "contentType">) => ({
  pdf: /pdf/i.test(f.contentType ?? "") || /\.pdf$/i.test(f.name),
  image: /^image\//i.test(f.contentType ?? "") || /\.(png|jpe?g|gif|webp)$/i.test(f.name),
});

/** "Latest" / "Older version (26/10 21:36)" / "Identical to the 27/10 13:10 file". */
export function VersionChips({ version, lang = "en" }: { version?: FileVersion | null; lang?: InboxLang }) {
  const t = useTranslations("inbox.fileVersions");
  const badges = versionBadges(version, lang);
  if (!badges.length) return null;
  return (
    <>
      {badges.map((b) => (
        <Chip
          key={b.kind}
          size="small"
          variant={b.kind === "latest" ? "filled" : "outlined"}
          color={b.kind === "latest" ? "success" : b.kind === "identical" ? "default" : "warning"}
          label={b.kind === "latest" ? t("latest") : b.kind === "older" ? t("older", { at: b.at }) : t("identical", { at: b.at })}
          sx={{ height: 20, fontSize: 11, fontWeight: 700 }}
          data-tour={`file-version-${b.kind}`}
        />
      ))}
    </>
  );
}

/** The file in place: an iframe for a PDF (sandboxed), an img for an image. */
function Inline({ url, f, height }: { url: string; f: Pick<AttachmentView, "name" | "contentType">; height: number }) {
  return kindOf(f).image ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt={f.name} style={{ maxWidth: "100%", display: "block" }} />
  ) : (
    <iframe title={f.name} src={url} sandbox="" style={{ width: "100%", height, border: 0, background: "#fff" }} />
  );
}

export function AttachmentRow({ f, lang, compareTo, right, dense }: { f: AttachmentView; lang: InboxLang; compareTo?: AttachmentView | null; right?: React.ReactNode; dense?: boolean }) {
  const t = useTranslations("inbox.fileVersions");
  const [url, setUrl] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [comparing, setComparing] = useState(false);
  const urlOf = useUrlOf();
  const k = kindOf(f);
  const fetchUrl = async (): Promise<string | null> => {
    if (url) return url;
    setBusy(true);
    try {
      const u = await urlOf(f);
      setUrl(u);
      return u;
    } catch (e: any) {
      toast.error(e?.message || t("couldNotGetFile"));
      return null;
    } finally {
      setBusy(false);
    }
  };
  const who = (f.company ?? "").trim() || (f.from ? fromParts(f.from).name : "");
  const facts = factsLine(f.size, f.pages, fmtSize, (n) => t("pages", { n }));
  return (
    <Box data-tour="file-row" data-latest={f.version?.latest ? "1" : undefined}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "center" }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={0.75} alignItems="center" useFlexGap flexWrap="wrap">
            <Typography variant="body2" sx={{ fontWeight: 600, wordBreak: "break-word" }}>
              📎 {f.name}
            </Typography>
            <VersionChips version={f.version} lang={lang} />
          </Stack>
          <Typography variant="caption" color="text.secondary" component="div" data-tour="file-facts">
            {[f.date ? whenShort(f.date, lang) : null, who || null, facts || null].filter(Boolean).join(" · ")}
          </Typography>
        </Box>
        <Stack direction="row" spacing={0.25} alignItems="center" sx={{ flexShrink: 0 }}>
          {(k.pdf || k.image) && (
            <Tooltip title={preview ? t("hidePreview") : t("preview")}>
              <IconButton
                size="small"
                disabled={busy}
                aria-label={t("preview")}
                data-tour="file-preview"
                onClick={async () => {
                  if (preview) return setPreview(false);
                  if (await fetchUrl()) setPreview(true);
                }}
              >
                {preview ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
              </IconButton>
            </Tooltip>
          )}
          <Tooltip title={t("download")}>
            <IconButton
              size="small"
              disabled={busy}
              aria-label={t("download")}
              onClick={async () => {
                const u = await fetchUrl();
                if (u) window.open(u, "_blank", "noopener,noreferrer");
              }}
            >
              <DownloadIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          {compareTo && (
            <Button size="small" startIcon={<CompareIcon fontSize="small" />} onClick={() => setComparing(true)} sx={{ textTransform: "none" }} data-tour="file-compare">
              {t("compare")}
            </Button>
          )}
          {right}
        </Stack>
      </Stack>
      <Collapse in={preview && !!url} unmountOnExit>
        <Box sx={{ mt: 1, borderRadius: 1, overflow: "hidden", bgcolor: "background.default" }}>{url && <Inline url={url} f={f} height={dense ? 520 : 900} />}</Box>
      </Collapse>
      {compareTo && <CompareDialog open={comparing} onClose={() => setComparing(false)} a={f} b={compareTo} lang={lang} />}
    </Box>
  );
}

/** Two versions side by side — the older on the left, the newer on the right. */
export function CompareDialog({ open, onClose, a, b, lang }: { open: boolean; onClose: () => void; a: AttachmentView; b: AttachmentView; lang: InboxLang }) {
  const t = useTranslations("inbox.fileVersions");
  const [left, right] = new Date(a.date ?? 0).getTime() <= new Date(b.date ?? 0).getTime() ? [a, b] : [b, a];
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xl" fullWidth data-tour="file-compare-dialog">
      <DialogTitle sx={{ pb: 0.5 }}>{t("compareTitle", { name: right.name })}</DialogTitle>
      <DialogContent dividers>
        <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1 }}>
          {t("compareHint")}
        </Typography>
        <Stack direction={{ xs: "column", md: "row" }} spacing={1.5}>
          {[left, right].map((f) => (
            <ComparePane key={f.key} f={f} lang={lang} open={open} />
          ))}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("close")}</Button>
      </DialogActions>
    </Dialog>
  );
}

function ComparePane({ f, lang, open }: { f: AttachmentView; lang: InboxLang; open: boolean }) {
  const t = useTranslations("inbox.fileVersions");
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const urlOf = useUrlOf();
  React.useEffect(() => {
    if (!open || url || failed) return;
    urlOf(f)
      .then((u) => (u ? setUrl(u) : setFailed(true)))
      .catch(() => setFailed(true));
  }, [open, url, failed, f]); // eslint-disable-line react-hooks/exhaustive-deps
  const who = (f.company ?? "").trim() || (f.from ? fromParts(f.from).name : "");
  return (
    <Box sx={{ flex: 1, minWidth: 0 }} data-tour="file-compare-pane">
      <Stack direction="row" spacing={0.75} alignItems="center" useFlexGap flexWrap="wrap" sx={{ mb: 0.5 }}>
        <VersionChips version={f.version} lang={lang} />
        <Typography variant="caption" color="text.secondary">
          {[f.date ? whenShort(f.date, lang) : null, who || null, factsLine(f.size, f.pages, fmtSize, (n) => t("pages", { n })) || null].filter(Boolean).join(" · ")}
        </Typography>
      </Stack>
      <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1, overflow: "hidden", minHeight: 200, bgcolor: "background.default" }}>
        {url ? <Inline url={url} f={f} height={720} /> : <Typography variant="body2" color={failed ? "error" : "text.secondary"} sx={{ p: 2 }}>{failed ? t("couldNotGetFile") : "…"}</Typography>}
      </Box>
    </Box>
  );
}
