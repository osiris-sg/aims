"use client";

// Client-facing preview: the server's print HTML (same renderer as the PDF)
// in a sandboxed iframe, with Print. Always rendered on a white page — this is
// paper, not UI, so it intentionally ignores the portal theme.

import React, { useEffect, useRef, useState } from "react";
import { Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from "@mui/material";
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
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setHtml(null);
    setError(null);
    api
      .getHtml(documentId)
      .then((r) => !cancelled && setHtml(r.html))
      .catch((e) => !cancelled && setError(e.message || "Failed to render preview"));
    return () => {
      cancelled = true;
    };
  }, [open, documentId, revision, api]);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="lg" PaperProps={{ sx: { borderRadius: 2, height: "92vh" } }}>
      <DialogTitle sx={{ py: 1.5 }}>
        Client preview
        <Typography variant="caption" sx={{ color: "text.secondary", ml: 1 }}>
          exactly what the PDF and e-mail attachment will contain — no cost or margin columns
        </Typography>
      </DialogTitle>
      <DialogContent sx={{ p: 0, bgcolor: "#e9e9e9" }}>
        {error && (
          <Typography color="error" sx={{ p: 3 }}>
            {error}
          </Typography>
        )}
        {!html && !error && (
          <Box sx={{ display: "flex", justifyContent: "center", pt: 8 }}>
            <CircularProgress />
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
