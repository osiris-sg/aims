"use client";

import React, { useCallback, useState } from "react";
import { Alert, Box, Button, CircularProgress, Tooltip, Typography } from "@mui/material";
import LinearProgress from "@mui/material/LinearProgress";
import PrintIcon from "@mui/icons-material/Print";
import DownloadIcon from "@mui/icons-material/Download";
import { isSystemPrintAvailable } from "../lib/systemPrint";
import { useDoA4Print } from "./DoA4Print";

const FIELD_BUTTON_SX = { py: 1.5, fontSize: "1rem", minHeight: 48 } as const;

/**
 * Print DO / Download DO for one delivery order, as the rider sees them after a
 * sign-off (the finished screen, and the basket of a partly signed run).
 *
 * Print goes through ANDROID'S print system (the printer is a WiFi colour
 * inkjet no Bluetooth path can reach); Download saves the same render as a PDF
 * and offers the share sheet, so the rider can join the printer's own hotspot
 * and print from there. Both are native-shell only. The offscreen A4 surface
 * is mounted here, so the caller only passes the DO id.
 */
export function DoPrintActions({ doId }: { doId: string | null }) {
  const { surface: printSurface, printDoViaSystem, downloadDo, progress: printProgress } = useDoA4Print();
  const [printing, setPrinting] = useState(false);
  const [printMsg, setPrintMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const doPrint = useCallback(async () => {
    if (!doId) {
      setPrintMsg({ ok: false, text: "This run has no delivery order linked to it yet, so there is nothing to print." });
      return;
    }
    setPrinting(true);
    setPrintMsg(null);
    try {
      await printDoViaSystem(doId);
      // The dialog is now Android's. It owns printer choice, settings and
      // cancellation, and reports none of that back, so this says the handover
      // happened, not that paper came out.
      setPrintMsg({ ok: true, text: "Print dialog opened. Pick the printer there." });
    } catch (e: any) {
      setPrintMsg({ ok: false, text: e?.message ?? "Could not open the print dialog." });
    } finally {
      setPrinting(false);
    }
  }, [doId, printDoViaSystem]);

  const doDownload = async () => {
    if (!doId) {
      setPrintMsg({ ok: false, text: "This run has no delivery order linked to it yet, so there is nothing to download." });
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

  return (
    <>
      {isSystemPrintAvailable() ? (
        <Button
          variant="contained"
          startIcon={printing ? <CircularProgress size={18} /> : <PrintIcon />}
          onClick={() => void doPrint()}
          disabled={printing}
          fullWidth
          sx={FIELD_BUTTON_SX}
        >
          {printing ? "Printing…" : "Print DO"}
        </Button>
      ) : (
        <Tooltip title="Printing needs the AIMS Field app">
          <span style={{ width: "100%" }}>
            <Button variant="contained" startIcon={<PrintIcon />} disabled fullWidth sx={FIELD_BUTTON_SX}>
              Print DO
            </Button>
          </span>
        </Tooltip>
      )}

      {isSystemPrintAvailable() && (
        <Button
          variant="outlined"
          startIcon={<DownloadIcon />}
          onClick={() => void doDownload()}
          disabled={printing}
          fullWidth
          sx={FIELD_BUTTON_SX}
        >
          Download DO
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
