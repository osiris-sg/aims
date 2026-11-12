"use client";

import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { Alert, Box, Button, CircularProgress, Stack } from "@mui/material";
import PrintIcon from "@mui/icons-material/Print";
import PictureAsPdfIcon from "@mui/icons-material/PictureAsPdf";
import { extForMime, fetchServiceReportFile, saveBlob, type ServiceReportFileKind } from "@/helpers/serviceReportFileBlob";

/**
 * A service report's FILE on screen (2026-11-12): an uploaded report, or any
 * report's photos attachment. A PDF shows in a frame, an image inline, both on
 * the same neutral backdrop as the WCT paper. The file is read through the
 * authenticated API into a same-origin blob, so Print prints the file itself
 * (not the portal page) and Download saves it as stored.
 *
 * `actions` renders a button row (Download PDF / Print + whatever the page
 * adds) like WctReportView's; pages that keep their own toolbar pass
 * `hideActions` and call print / download through the ref.
 */

export type ReportFileHandle = { print: () => void; download: () => void; ready: boolean };

type Props = {
  reportId: string;
  kind: ServiceReportFileKind;
  mimeType?: string | null;
  /** Download name without the extension. */
  downloadName: string;
  hideActions?: boolean;
  /** Extra buttons placed before Download PDF / Print. */
  extraActions?: React.ReactNode;
  /** Field app: show the file only. */
  viewOnly?: boolean;
};

const A4_WIDTH_PX = 794;

const ReportFileView = forwardRef<ReportFileHandle, Props>(function ReportFileView(
  { reportId, kind, mimeType, downloadName, hideActions, extraActions, viewOnly },
  ref,
) {
  const { getToken } = useAuth();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let made: string | null = null;
    setBlob(null);
    setUrl(null);
    setError(null);
    (async () => {
      try {
        const token = await getToken();
        if (!token) throw new Error("Not signed in");
        const b = await fetchServiceReportFile(reportId, kind, token);
        if (cancelled) return;
        made = URL.createObjectURL(b);
        setBlob(b);
        setUrl(made);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Could not load the file");
      }
    })();
    return () => {
      cancelled = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [reportId, kind, mimeType, getToken]);

  const type = (blob?.type || mimeType || "").toLowerCase();
  const isImage = type.startsWith("image/");

  const print = () => {
    const win = frameRef.current?.contentWindow;
    if (!win) return;
    win.focus();
    win.print();
  };
  const download = () => {
    if (blob) saveBlob(blob, `${downloadName}.${extForMime(type)}`);
  };
  useImperativeHandle(ref, () => ({ print, download, ready: !!blob }), [blob]); // eslint-disable-line react-hooks/exhaustive-deps

  // An image prints from a tiny page of its own, sized to the paper.
  const imageDoc = url
    ? `<!doctype html><html><head><style>@page{size:A4;margin:10mm}html,body{margin:0;background:#fff}img{display:block;max-width:100%;margin:0 auto}</style></head><body><img src="${url}" alt=""></body></html>`
    : "";

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
      {!hideActions && !viewOnly && (
        <Stack direction="row" spacing={1} justifyContent="flex-end" flexWrap="wrap" useFlexGap sx={{ "@media print": { display: "none" } }}>
          {extraActions}
          <Button variant="outlined" startIcon={<PictureAsPdfIcon />} onClick={download} disabled={!blob}>
            {isImage ? "Download" : "Download PDF"}
          </Button>
          <Button variant="contained" startIcon={<PrintIcon />} onClick={print} disabled={!blob}>
            Print
          </Button>
        </Stack>
      )}
      {error && <Alert severity="error">{error}</Alert>}
      {!url && !error && (
        <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
          <CircularProgress />
        </Box>
      )}
      {url && (
        <Box sx={{ bgcolor: "action.hover", p: { xs: 1, md: 3 }, borderRadius: 1, overflowX: "auto" }}>
          {isImage ? (
            <>
              <Box component="img" src={url} alt="" sx={{ display: "block", maxWidth: "100%", mx: "auto", bgcolor: "#fff", boxShadow: 3 }} />
              {/* Off-screen copy that Print prints. */}
              <iframe ref={frameRef} title="Print copy" srcDoc={imageDoc} style={{ position: "absolute", width: 0, height: 0, border: 0, visibility: "hidden" }} />
            </>
          ) : (
            <Box
              component="iframe"
              ref={frameRef}
              title="Service report file"
              src={url}
              sx={{ display: "block", width: A4_WIDTH_PX, maxWidth: "100%", height: "80vh", minHeight: 600, border: 0, bgcolor: "#fff", mx: "auto", boxShadow: 3 }}
            />
          )}
        </Box>
      )}
    </Box>
  );
});

export default ReportFileView;
