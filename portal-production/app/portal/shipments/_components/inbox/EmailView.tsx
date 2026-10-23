/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Round T — the whole email, like an email client: From / To / Cc / Date / Subject, the body (HTML
// sanitised with DOMPurify and rendered in a fully sandboxed frame; remote images blocked until "Load
// images"; plain-text fallback), the quoted history collapsed, the attachments with inline preview
// (PDF / image) and download. Nothing inside the email is executed or followed.
// Round W (Part C.1) — the body renders in OUR style by default (`restyleEmailHtml`: the sender's CSS /
// colours / fonts gone, Outlook banners / [EXTERNAL] tags / tracking pixels / spacer tables removed, the
// signature collapsed under a toggle, links listed under the email and opened only after a confirm).
// "Show original" switches to the sanitised HTML as it came (styles kept, white page) — same sandbox.

import React, { useEffect, useId, useMemo, useState } from "react";
import { Box, Button, Chip, CircularProgress, Collapse, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Stack, Tooltip, Typography, useTheme } from "@mui/material";
import DownloadIcon from "@mui/icons-material/Download";
import VisibilityIcon from "@mui/icons-material/Visibility";
import ImageIcon from "@mui/icons-material/Image";
import LinkIcon from "@mui/icons-material/Link";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import { useQuery } from "@tanstack/react-query";
import DOMPurify from "dompurify";
import { useShipmentsApi, type EmailMessage, type InboxLang } from "../../_lib/api";
import { headerSummary } from "../../_lib/inbox-cards";
import { fmtDateTime } from "../../_lib/format";
import { estimateFrameHeight, fmtSize, frameDocument, FRAME_SANDBOX, PURIFY_CONFIG, restoreRemoteImages, restyleEmailHtml, textToHtml, type EmailLink, type RestyledEmail } from "../../_lib/email-html";

/** Sanitised body HTML for the frame: HTML when the email has it (images blocked), else the plain text. */
export function bodyHtml(m: EmailMessage, loadImages: boolean): string {
  if (m.html) {
    const clean = String(DOMPurify.sanitize(m.html, PURIFY_CONFIG as any));
    return loadImages ? restoreRemoteImages(clean) : clean;
  }
  return textToHtml(m.text ?? "");
}

/** The cleaned view of an HTML email (null for plain-text emails, which already are in our style). */
export function restyledBody(m: EmailMessage): RestyledEmail | null {
  if (!m.html) return null;
  return restyleEmailHtml(String(DOMPurify.sanitize(m.html, PURIFY_CONFIG as any)));
}

function HeaderLine({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <Stack direction="row" spacing={1} sx={{ minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary" sx={{ width: 52, flexShrink: 0, textAlign: "right" }}>
        {label}
      </Typography>
      <Typography variant="caption" sx={{ wordBreak: "break-all" }}>
        {value}
      </Typography>
    </Stack>
  );
}

function AttachmentRow({ a }: { a: EmailMessage["attachments"][number] }) {
  const [preview, setPreview] = useState(false);
  const isPdf = /pdf/i.test(a.contentType) || /\.pdf$/i.test(a.name);
  const isImage = /^image\//i.test(a.contentType) || /\.(png|jpe?g|gif|webp)$/i.test(a.name);
  const canPreview = !!a.url && (isPdf || isImage);
  return (
    <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1, px: 1, py: 0.5 }} data-tour="email-attachment">
      <Stack direction="row" spacing={1} alignItems="center">
        <Typography variant="body2" sx={{ flex: 1, minWidth: 0, wordBreak: "break-word" }} title={a.name}>
          📎 {a.name} <span style={{ opacity: 0.6 }}>· {fmtSize(a.size)}</span>
        </Typography>
        {canPreview && (
          <Tooltip title={preview ? "Hide preview" : "Preview"}>
            <IconButton size="small" onClick={() => setPreview((p) => !p)} aria-label="Preview">
              <VisibilityIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        {a.url ? (
          <Tooltip title="Download">
            <IconButton size="small" component="a" href={a.url} download={a.name} target="_blank" rel="noopener noreferrer" aria-label="Download">
              <DownloadIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        ) : (
          <Typography variant="caption" color="text.secondary">
            not stored
          </Typography>
        )}
      </Stack>
      <Collapse in={preview} unmountOnExit>
        <Box sx={{ mt: 1, borderRadius: 1, overflow: "hidden", bgcolor: "background.default" }}>
          {isImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={a.url!} alt={a.name} style={{ maxWidth: "100%", display: "block" }} />
          ) : (
            <iframe title={a.name} src={a.url!} sandbox="" style={{ width: "100%", height: 900, border: 0 }} />
          )}
        </Box>
      </Collapse>
    </Box>
  );
}

/**
 * A sandboxed frame for one piece of email HTML. Round AF (owner: one scroll bar): the frame grows to its content —
 * our nonce'd script inside it reports the document height and the frame is resized to it, so there is no inner scroll.
 * The text-based estimate is only the first paint.
 */
function BodyFrame({ title, html, dark, original, tour }: { title: string; html: string; dark: boolean; original?: boolean; tour?: string }) {
  const frameId = useId().replace(/[^a-z0-9]/gi, "");
  const doc = useMemo(() => frameDocument(html, dark, { original, frameId }), [html, dark, original, frameId]);
  const [height, setHeight] = useState<number>(() => estimateFrameHeight(html));
  useEffect(() => setHeight(estimateFrameHeight(html)), [html]);
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const d = e.data as { type?: string; id?: string; height?: number } | null;
      if (!d || d.type !== "aims-email-frame" || d.id !== frameId || typeof d.height !== "number") return;
      setHeight(Math.min(20000, Math.max(40, Math.ceil(d.height) + 4)));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [frameId]);
  return (
    <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1, overflow: "hidden" }} data-tour={tour}>
      <iframe title={title} sandbox={FRAME_SANDBOX} srcDoc={doc} referrerPolicy="no-referrer" scrolling="no" style={{ width: "100%", height, border: 0, display: "block", background: "transparent", overflow: "hidden" }} />
    </Box>
  );
}

/**
 * The links found in the email, listed on the host page. The frame is sandboxed with no allowances, so a click
 * inside it never navigates; this list is the one way out, and every link asks first ("Open host?") before
 * opening in a new tab with noopener.
 */
function LinksList({ links }: { links: EmailLink[] }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState<EmailLink | null>(null);
  if (!links.length) return null;
  return (
    <Box>
      <Button size="small" startIcon={<LinkIcon />} onClick={() => setOpen((s) => !s)} sx={{ textTransform: "none" }} data-tour="email-links">
        {open ? "Hide links" : `Links in this email (${links.length})`}
      </Button>
      <Collapse in={open} unmountOnExit>
        <Stack spacing={0.25} sx={{ pl: 1, borderLeft: "3px solid", borderColor: "divider" }}>
          {links.map((l) => (
            <Button
              key={l.href}
              size="small"
              variant="text"
              endIcon={<OpenInNewIcon sx={{ fontSize: 14 }} />}
              onClick={() => setConfirm(l)}
              sx={{ textTransform: "none", justifyContent: "flex-start", minWidth: 0, fontWeight: 400 }}
              title={l.href}
            >
              <Typography variant="body2" sx={{ maxWidth: 420, wordBreak: "break-word", textAlign: "left" }}>
                {l.text}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ ml: 0.75, whiteSpace: "nowrap" }}>
                ({l.host})
              </Typography>
            </Button>
          ))}
        </Stack>
      </Collapse>
      <Dialog open={!!confirm} onClose={() => setConfirm(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontSize: 16 }}>Open {confirm?.host}?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ wordBreak: "break-all" }}>
            {confirm?.href}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
            This link came from the email. Only open it if you trust the sender; it opens in a new tab.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirm(null)} sx={{ textTransform: "none" }}>
            Cancel
          </Button>
          <Button
            variant="contained"
            sx={{ textTransform: "none" }}
            onClick={() => {
              if (confirm) window.open(confirm.href, "_blank", "noopener,noreferrer");
              setConfirm(null);
            }}
          >
            Open in a new tab
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

/** One email's full view. Fetches /email-inbox/:id/message when shown. */
export function EmailView({ id, compactHeaders = false, company = null, lang = "en" }: { id: string; /** Round W: From/To/Cc as one line ("From 榎本若菜 (Mitsui Soko) · to Sayaka + 9") with expand. */ compactHeaders?: boolean; company?: string | null; lang?: InboxLang }) {
  const api = useShipmentsApi();
  const theme = useTheme();
  const dark = theme.palette.mode === "dark";
  const q = useQuery({ queryKey: ["trade-inbox", "message", id], queryFn: () => api.inboxMessage(id), staleTime: 5 * 60_000 });
  const [loadImages, setLoadImages] = useState(false);
  const [showQuoted, setShowQuoted] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [showSignature, setShowSignature] = useState(false);
  const [showHeaders, setShowHeaders] = useState(!compactHeaders);
  const m = q.data;
  const restyled = useMemo(() => (m ? restyledBody(m) : null), [m]);
  const original = showOriginal || !restyled;
  // The body shown: our style (with Load images applied to the restyled html) or the original sanitised html.
  const html = useMemo(() => {
    if (!m) return "";
    if (original) return bodyHtml(m, loadImages);
    return loadImages ? restoreRemoteImages(restyled!.html) : restyled!.html;
  }, [m, original, restyled, loadImages]);
  const signatureHtml = !original && restyled?.signatureHtml ? (loadImages ? restoreRemoteImages(restyled.signatureHtml) : restyled.signatureHtml) : null;
  useEffect(() => {
    setShowOriginal(false);
    setShowSignature(false);
  }, [id]);
  if (q.isLoading) return <CircularProgress size={20} />;
  if (q.isError || !m) return <Typography color="error">Could not load this email.</Typography>;
  const cleaned = restyled?.removed.filter((r) => r !== "signature") ?? [];
  return (
    <Stack spacing={1.25} data-tour="email-view">
      <Box sx={{ borderBottom: "1px solid", borderColor: "divider", pb: 1 }}>
        {!compactHeaders && (
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            {m.headers.subject || "(no subject)"}
          </Typography>
        )}
        {compactHeaders && !showHeaders ? (
          <Typography variant="caption" color="text.secondary" component="div" onClick={() => setShowHeaders(true)} sx={{ cursor: "pointer" }} title={lang === "ja" ? "宛先を表示" : "Show all recipients"} data-tour="email-headers-compact">
            {headerSummary(m.headers, company, lang)}
            {m.headers.date ? ` · ${fmtDateTime(m.headers.date)}` : ""} ▾
          </Typography>
        ) : (
          <>
            <HeaderLine label="From" value={m.headers.from} />
            <HeaderLine label="To" value={m.headers.to} />
            <HeaderLine label="Cc" value={m.headers.cc} />
            <HeaderLine label="Date" value={m.headers.date ? fmtDateTime(m.headers.date) : null} />
          </>
        )}
        <Stack direction="row" spacing={0.75} sx={{ mt: 0.5 }} flexWrap="wrap" useFlexGap alignItems="center">
          {m.source === "whatsapp" && <Chip size="small" color="success" variant="outlined" label="Sent on WhatsApp" />}
          {m.reconstructed && <Chip size="small" variant="outlined" label="Rebuilt from the stored text (older email)" />}
          {m.html && m.blockedRemote > 0 && !loadImages && (
            <Button size="small" startIcon={<ImageIcon />} onClick={() => setLoadImages(true)} sx={{ textTransform: "none" }} data-tour="email-load-images">
              Load images ({m.blockedRemote} blocked)
            </Button>
          )}
          {restyled && (
            <Tooltip title={showOriginal ? "Back to the cleaned view (our fonts and colours, sender junk removed)" : `Show the email as it was sent, with its own styles${cleaned.length ? ` — cleaned away: ${cleaned.join(", ")}` : ""}`}>
              <Button size="small" onClick={() => setShowOriginal((s) => !s)} sx={{ textTransform: "none" }} data-tour="email-show-original">
                {showOriginal ? "Show cleaned" : "Show original"}
              </Button>
            </Tooltip>
          )}
        </Stack>
      </Box>
      <BodyFrame title="Email body" html={html} dark={dark} original={original && !!m.html} />
      {!original && cleaned.length > 0 && (
        <Typography variant="caption" color="text.secondary">
          Cleaned for reading: {cleaned.join(" · ")}
        </Typography>
      )}
      {signatureHtml && (
        <Box>
          <Button size="small" onClick={() => setShowSignature((s) => !s)} sx={{ textTransform: "none" }} data-tour="email-signature">
            {showSignature ? "Hide signature" : "Show signature"}
          </Button>
          <Collapse in={showSignature} unmountOnExit>
            <BodyFrame title="Email signature" html={signatureHtml} dark={dark} />
          </Collapse>
        </Box>
      )}
      {!original && restyled && <LinksList links={restyled.links} />}
      {m.quoted && (
        <Box>
          <Button size="small" onClick={() => setShowQuoted((s) => !s)} sx={{ textTransform: "none" }} data-tour="email-quoted">
            {showQuoted ? "Hide quoted text" : "Show quoted text"}
          </Button>
          <Collapse in={showQuoted} unmountOnExit>
            <Box component="pre" sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 12, color: "text.secondary", m: 0, p: 1, borderLeft: "3px solid", borderColor: "divider" }}>
              {m.quoted}
            </Box>
          </Collapse>
        </Box>
      )}
      {m.attachments.length > 0 && (
        <Stack spacing={0.75}>
          <Typography variant="overline" color="text.secondary">
            Attachments ({m.attachments.length})
          </Typography>
          {m.attachments.map((a) => (
            <AttachmentRow key={a.index} a={a} />
          ))}
        </Stack>
      )}
    </Stack>
  );
}
