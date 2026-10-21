/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Round T — the whole email, like an email client: From / To / Cc / Date / Subject, the body (HTML
// sanitised with DOMPurify and rendered in a fully sandboxed frame; remote images blocked until "Load
// images"; plain-text fallback), the quoted history collapsed, the attachments with inline preview
// (PDF / image) and download. Nothing inside the email is executed or followed.

import React, { useEffect, useMemo, useState } from "react";
import { Box, Button, Chip, CircularProgress, Collapse, IconButton, Stack, Tooltip, Typography, useTheme } from "@mui/material";
import DownloadIcon from "@mui/icons-material/Download";
import VisibilityIcon from "@mui/icons-material/Visibility";
import ImageIcon from "@mui/icons-material/Image";
import { useQuery } from "@tanstack/react-query";
import DOMPurify from "dompurify";
import { useShipmentsApi, type EmailMessage } from "../../_lib/api";
import { fmtDateTime } from "../../_lib/format";
import { fmtSize, frameDocument, FRAME_SANDBOX, PURIFY_CONFIG, restoreRemoteImages, textToHtml } from "../../_lib/email-html";

/** Sanitised body HTML for the frame: HTML when the email has it (images blocked), else the plain text. */
export function bodyHtml(m: EmailMessage, loadImages: boolean): string {
  if (m.html) {
    const clean = String(DOMPurify.sanitize(m.html, PURIFY_CONFIG as any));
    return loadImages ? restoreRemoteImages(clean) : clean;
  }
  return textToHtml(m.text ?? "");
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
        <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap title={a.name}>
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
            <iframe title={a.name} src={a.url!} sandbox="" style={{ width: "100%", height: 480, border: 0 }} />
          )}
        </Box>
      </Collapse>
    </Box>
  );
}

/** One email's full view. Fetches /email-inbox/:id/message when shown. */
export function EmailView({ id }: { id: string }) {
  const api = useShipmentsApi();
  const theme = useTheme();
  const q = useQuery({ queryKey: ["trade-inbox", "message", id], queryFn: () => api.inboxMessage(id), staleTime: 5 * 60_000 });
  const [loadImages, setLoadImages] = useState(false);
  const [showQuoted, setShowQuoted] = useState(false);
  const [frameHeight, setFrameHeight] = useState(240);
  const m = q.data;
  const doc = useMemo(() => (m ? frameDocument(bodyHtml(m, loadImages), theme.palette.mode === "dark") : ""), [m, loadImages, theme.palette.mode]);
  useEffect(() => setFrameHeight(240), [id]);
  if (q.isLoading) return <CircularProgress size={20} />;
  if (q.isError || !m) return <Typography color="error">Could not load this email.</Typography>;
  return (
    <Stack spacing={1.25} data-tour="email-view">
      <Box sx={{ borderBottom: "1px solid", borderColor: "divider", pb: 1 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          {m.headers.subject || "(no subject)"}
        </Typography>
        <HeaderLine label="From" value={m.headers.from} />
        <HeaderLine label="To" value={m.headers.to} />
        <HeaderLine label="Cc" value={m.headers.cc} />
        <HeaderLine label="Date" value={m.headers.date ? fmtDateTime(m.headers.date) : null} />
        <Stack direction="row" spacing={0.75} sx={{ mt: 0.5 }} flexWrap="wrap" useFlexGap>
          {m.source === "whatsapp" && <Chip size="small" color="success" variant="outlined" label="Sent on WhatsApp" />}
          {m.reconstructed && <Chip size="small" variant="outlined" label="Rebuilt from the stored text (older email)" />}
          {m.html && m.blockedRemote > 0 && !loadImages && (
            <Button size="small" startIcon={<ImageIcon />} onClick={() => setLoadImages(true)} sx={{ textTransform: "none" }} data-tour="email-load-images">
              Load images ({m.blockedRemote} blocked)
            </Button>
          )}
        </Stack>
      </Box>
      <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1, overflow: "hidden" }}>
        <iframe
          title="Email body"
          sandbox={FRAME_SANDBOX}
          srcDoc={doc}
          referrerPolicy="no-referrer"
          style={{ width: "100%", height: frameHeight, border: 0, display: "block", background: "transparent" }}
          onLoad={(e) => {
            // The frame is sandboxed without allow-same-origin, so its height cannot be read; size it to the text.
            const len = (m.html ?? m.text ?? "").length;
            setFrameHeight(Math.min(900, Math.max(160, Math.round(len / 4))));
            void e;
          }}
        />
      </Box>
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
