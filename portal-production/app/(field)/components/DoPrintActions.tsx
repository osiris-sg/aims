"use client";

import React, { useCallback, useState } from "react";
import { Alert, Box, Button, CircularProgress, Tooltip, Typography } from "@mui/material";
import LinearProgress from "@mui/material/LinearProgress";
import PrintIcon from "@mui/icons-material/Print";
import DownloadIcon from "@mui/icons-material/Download";
import { isSystemPrintAvailable } from "../lib/systemPrint";
import { useDoA4Print } from "./DoA4Print";
import { FIELD_BUTTON_SX } from "@/app/(field)/components/fieldUi";


/**
 * Print DO / Download DO for one delivery order, as the rider sees them after a
 * sign-off (the finished screen, and the basket of a partly signed run).
 *
 * Print goes through ANDROID'S print system (the printer is a WiFi colour
 * inkjet no Bluetooth path can reach); Download saves the same render as a PDF
 * and offers the share sheet, so the rider can join the printer's own hotspot
 * and print from there. Both are native-shell only, except that Print can also
 * use the browser's own dialog when the caller asks (browserPrint, WCT). The offscreen A4 surface
 * is mounted here, so the caller only passes the DO id.
 */
export function DoPrintActions({
  doId,
  docLabel = "DO",
  browserPrint = false,
  preparing = false,
  onRetry,
}: {
  doId: string | null;
  docLabel?: "DO" | "RDO";
  /** Print through the browser's own dialog when not in the SiteJobs shell (WCT). Off: the button stays disabled there, as before. */
  browserPrint?: boolean;
  /** The DO is still being made (not linked, or still on its placeholder number): spinner instead of Print. */
  preparing?: boolean;
  /** Shown as Retry once the caller stops waiting and the DO is still not ready. */
  onRetry?: () => void;
}) {
  const docName = docLabel === "RDO" ? "return delivery order" : "delivery order";
  const { surface: printSurface, printDoViaSystem, printDoInBrowser, downloadDo, progress: printProgress } = useDoA4Print();
  const native = isSystemPrintAvailable();
  const [printing, setPrinting] = useState(false);
  const [printMsg, setPrintMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const doPrint = useCallback(async () => {
    if (!doId) {
      setPrintMsg({ ok: false, text: `This run has no ${docName} linked to it yet, so there is nothing to print.` });
      return;
    }
    setPrinting(true);
    setPrintMsg(null);
    try {
      if (native) await printDoViaSystem(doId);
      else await printDoInBrowser(doId);
      // The dialog is now Android's (or the browser's). It owns printer choice,
      // settings and cancellation, and reports none of that back, so this says
      // the handover happened, not that paper came out.
      setPrintMsg({ ok: true, text: "Print dialog opened. Pick the printer there." });
    } catch (e: any) {
      setPrintMsg({ ok: false, text: e?.message ?? "Could not open the print dialog." });
    } finally {
      setPrinting(false);
    }
  }, [doId, native, printDoViaSystem, printDoInBrowser]);

  const doDownload = async () => {
    if (!doId) {
      setPrintMsg({ ok: false, text: `This run has no ${docName} linked to it yet, so there is nothing to download.` });
      return;
    }
    setPrinting(true);
    setPrintMsg(null);
    try {
      const saved = await downloadDo(doId);
      setPrintMsg({ ok: true, text: `Saved to Downloads as ${saved.fileName}` });
    } catch (e: any) {
      setPrintMsg({ ok: false, text: e?.message ?? "Could not save the PDF." });
    } finally {
      setPrinting(false);
    }
  };

  if (preparing || (!doId && onRetry)) {
    return (
      <>
        <Button variant="contained" startIcon={preparing ? <CircularProgress size={18} color="inherit" /> : <PrintIcon />} disabled fullWidth sx={FIELD_BUTTON_SX}>
          {preparing ? `Preparing the ${docName}…` : `Print ${docLabel}`}
        </Button>
        {!preparing && onRetry && (
          <Alert
            severity="warning"
            action={
              <Button size="small" onClick={onRetry}>
                Retry
              </Button>
            }
          >
            {`The ${docName} is not ready yet. Try again in a moment.`}
          </Alert>
        )}
      </>
    );
  }

  return (
    <>
      {native || browserPrint ? (
        <Button
          variant="contained"
          startIcon={printing ? <CircularProgress size={18} /> : <PrintIcon />}
          onClick={() => void doPrint()}
          disabled={printing}
          fullWidth
          sx={FIELD_BUTTON_SX}
        >
          {printing ? "Printing…" : `Print ${docLabel}`}
        </Button>
      ) : (
        <Tooltip title="Printing needs the SiteJobs app">
          <span style={{ width: "100%" }}>
            <Button variant="contained" startIcon={<PrintIcon />} disabled fullWidth sx={FIELD_BUTTON_SX}>
              Print {docLabel}
            </Button>
          </span>
        </Tooltip>
      )}

      {native && (
        <Button
          variant="outlined"
          startIcon={<DownloadIcon />}
          onClick={() => void doDownload()}
          disabled={printing}
          fullWidth
          sx={FIELD_BUTTON_SX}
        >
          Download {docLabel}
        </Button>
      )}

      {printing && (
        <Box sx={{ width: "100%", maxWidth: 360, mb: 1 }}>
          <LinearProgress
            variant={printProgress ? "determinate" : "indeterminate"}
            value={printProgress ? Math.round(printProgress.fraction * 100) : undefined}
          />
          <Typography variant="caption" color="text.secondary">
            {printProgress?.label ?? "Preparing…"}
            {printProgress ? ` ${Math.round(printProgress.fraction * 100)}%` : ""}
          </Typography>
        </Box>
      )}

      {printMsg && (
        <Alert
          severity={printMsg.ok ? "success" : "error"}
          action={
            !printMsg.ok ? (
              <Button size="small" onClick={() => void doPrint()} disabled={printing}>
                Retry
              </Button>
            ) : undefined
          }
          onClose={() => setPrintMsg(null)}
        >
          {printMsg.text}
        </Alert>
      )}

      {/* Offscreen A4 render, nothing visible. */}
      {printSurface}
    </>
  );
}
