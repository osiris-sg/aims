"use client";

// Client-facing preview: the server's print HTML (same renderer as the PDF)
// in a sandboxed iframe, with Print. Always rendered on a white page — this is
// paper, not UI, so it intentionally ignores the portal theme.
// EN / 中文 toggle (guru 2026-09-19): 中文 first AI-translates the quote's free
// text (cached on the document, so it only costs once) then re-renders.

import React, { useEffect, useRef, useState } from "react";
import { Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import PrintIcon from "@mui/icons-material/PrintOutlined";
import { useIdQuoteApi } from "../_lib/api";

interface Props {
  open: boolean;
  documentId: string;
  /** Bumped by the parent after a save so the preview refetches. */
  revision: number;
  onClose: () => void;
}

export default function PreviewDialog({ open, documentId, revision, onClose }: Props) {
  const api = useIdQuoteApi();
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lang, setLang] = useState<"en" | "zh">("en");
  const [translating, setTranslating] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setHtml(null);
    setError(null);
    const run = async () => {
      try {
        if (lang === "zh") {
          // Fills config.quoteZh for any strings not yet translated; instant
          // when everything is already cached.
          setTranslating(true);
          await api.translate(documentId);
        }
        const r = await api.getHtml(documentId, lang);
        if (!cancelled) setHtml(r.html);
      } catch (e: any) {
        if (!cancelled) setError(e.message || "Failed to render preview");
      } finally {
        if (!cancelled) setTranslating(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [open, documentId, revision, lang, api]);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="lg" PaperProps={{ sx: { borderRadius: 2, height: "92vh" } }}>
      <DialogTitle sx={{ py: 1.5, display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
        Client preview
        <Typography variant="caption" sx={{ color: "text.secondary", flex: 1 }}>
          exactly what the PDF and e-mail attachment will contain — no cost or margin columns
        </Typography>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={lang}
          onChange={(_, v) => v && setLang(v)}
          data-tour="quote-lang-toggle"
        >
          <ToggleButton value="en" sx={{ px: 1.5, textTransform: "none" }}>
            English
          </ToggleButton>
          <ToggleButton value="zh" sx={{ px: 1.5, textTransform: "none" }}>
            中文
          </ToggleButton>
        </ToggleButtonGroup>
      </DialogTitle>
      <DialogContent sx={{ p: 0, bgcolor: "#e9e9e9" }}>
        {error && (
          <Typography color="error" sx={{ p: 3 }}>
            {error}
          </Typography>
        )}
        {!html && !error && (
          <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1.5, pt: 8 }}>
            <CircularProgress />
            {translating && (
              <Typography variant="caption" sx={{ color: "text.secondary" }}>
                Translating to Chinese… (first time only — it&apos;s cached after that)
              </Typography>
            )}
          </Box>
        )}
        {html && (
          <Box sx={{ p: { xs: 0, md: 2 }, height: "100%" }}>
            <iframe
              ref={frame}
              title="Quotation preview"
              srcDoc={html}
              sandbox="allow-same-origin allow-modals"
              style={{ width: "100%", height: "100%", border: 0, background: "#fff", boxShadow: "0 2px 12px rgba(0,0,0,.15)" }}
            />
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
        <Button variant="contained" startIcon={<PrintIcon />} disabled={!html} onClick={() => frame.current?.contentWindow?.print()}>
          Print / Save PDF
        </Button>
      </DialogActions>
    </Dialog>
  );
}
