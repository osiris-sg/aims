"use client";

import React, { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Divider,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Snackbar,
  Stack,
  Typography,
} from "@mui/material";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import DownloadIcon from "@mui/icons-material/Download";
import { ReportSummary } from "../lib/maintenanceReports";
import { isSystemPrintAvailable } from "../lib/systemPrint";
import { useMsrPrint } from "./MsrPrintSurface";
import { ListCard, StatusChip } from "./fieldUi";
import { MAX_BULK_REPORTS, savedMessage, serviceReportFileBase } from "@/helpers/serviceReportFiles";
import { downloadServiceReportsZip } from "@/helpers/downloadServiceReportsZip";

const LONG_PRESS_MS = 500;

/**
 * Signed (completed) maintenance reports. Shared by /scan/reports ("Recently
 * completed") and the Maintenance home's Completed tab. A tap opens the
 * report's print screen.
 *
 * SELECT MODE (2026-11-03): "Select" or a long press ticks reports; a tap then
 * toggles instead of opening. "Download (n)" saves them in the order shown.
 * In the SiteJobs app each is the single download's PDF, saved to Downloads
 * one after another WITHOUT the share sheet (the plugin shares one file at a
 * time, so there is no Share for the set). In a browser it is one zip of the
 * server's PDFs, since browsers block a burst of downloads.
 * `barBottom` lifts the bar clear of a bottom nav.
 */
export function CompletedReportList({ reports, barBottom = "0px" }: { reports: ReportSummary[]; barBottom?: string }) {
  const router = useRouter();
  const { getToken } = useAuth();
  const { surface, saveReportQuietly } = useMsrPrint();
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; tone: "success" | "warning" | "error" } | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const exit = () => {
    setSelecting(false);
    setSelected([]);
  };

  const startPress = (id: string) => {
    longPressed.current = false;
    if (selecting) return;
    pressTimer.current = setTimeout(() => {
      longPressed.current = true;
      setSelecting(true);
      setSelected((s) => (s.includes(id) ? s : [...s, id]));
    }, LONG_PRESS_MS);
  };
  const cancelPress = () => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };

  const onRow = (id: string) => {
    // The long press already ticked it; the click that follows the release must not untick it.
    if (longPressed.current) {
      longPressed.current = false;
      return;
    }
    if (selecting) toggle(id);
    else router.push(`/scan/reports/${id}/print`);
  };

  // In the list's order (newest first), whatever order they were ticked in.
  const chosen = reports.filter((r) => selected.includes(r.id));
  const tooMany = chosen.length > MAX_BULK_REPORTS;

  const download = async () => {
    if (!chosen.length || tooMany || progress) return;
    setNotice(null);
    try {
      if (!isSystemPrintAvailable()) {
        setProgress(`Preparing ${chosen.length} ${chosen.length === 1 ? "report" : "reports"}…`);
        const token = await getToken();
        if (!token) throw new Error("Not signed in");
        const name = await downloadServiceReportsZip(chosen.map((r) => r.id), token);
        setNotice({ text: `Downloaded ${name}`, tone: "success" });
        exit();
        return;
      }
      const failed: string[] = [];
      for (let i = 0; i < chosen.length; i++) {
        const r = chosen[i];
        setProgress(`Saving ${i + 1} of ${chosen.length}…`);
        try {
          await saveReportQuietly(r.id, serviceReportFileBase(r));
        } catch {
          failed.push(r.reportNumber != null ? `#${r.reportNumber}` : r.id.slice(0, 8));
        }
      }
      const saved = chosen.length - failed.length;
      setNotice({ text: savedMessage(saved, chosen.length, failed), tone: failed.length ? (saved ? "warning" : "error") : "success" });
      if (!failed.length) exit();
    } catch (e: any) {
      setNotice({ text: e?.message ?? "Could not download the reports", tone: "error" });
    } finally {
      setProgress(null);
    }
  };

  return (
    <>
      <Stack direction="row" justifyContent="flex-end" sx={{ mt: -1, mb: -1 }}>
        {selecting ? (
          <Button size="small" onClick={exit} disabled={!!progress}>
            Cancel
          </Button>
        ) : (
          <Button size="small" onClick={() => setSelecting(true)}>
            Select
          </Button>
        )}
      </Stack>

      <ListCard>
      <List disablePadding>
        {reports.map((r, i) => (
          <React.Fragment key={r.id}>
          {i > 0 && <Divider component="li" sx={{ mx: 2 }} />}
          <ListItemButton
            onClick={() => onRow(r.id)}
            onPointerDown={() => startPress(r.id)}
            onPointerUp={cancelPress}
            onPointerLeave={cancelPress}
            onPointerCancel={cancelPress}
            onContextMenu={(e) => e.preventDefault()}
            disabled={!!progress}
            sx={{ minHeight: 68, gap: 1, userSelect: "none", WebkitTouchCallout: "none" }}
          >
            {selecting && (
              <Checkbox
                edge="start"
                checked={selected.includes(r.id)}
                tabIndex={-1}
                disableRipple
                sx={{ mr: 0.5, pointerEvents: "none" }}
                inputProps={{ "aria-label": `Select report ${r.reportNumber ?? ""}` }}
              />
            )}
            <ListItemText
              primaryTypographyProps={{ fontWeight: 600 }}
              secondaryTypographyProps={{ fontSize: 12.5 }}
              primary={
                <>
                  {r.reportNumber != null && <strong>#{r.reportNumber}</strong>}
                  {r.reportNumber != null && "  "}
                  {r.serviceData?.customerName || "No customer"}
                </>
              }
              secondary={[
                r.serviceData?.model || r.asset?.name,
                r.serviceData?.serial || r.inventory?.sku,
                r.serviceData?.serviceDate,
              ]
                .filter(Boolean)
                .join(" · ")}
            />
            <StatusChip label="SIGNED" tone="good" />
            {!selecting && <ChevronRightIcon sx={{ color: "text.disabled", mr: -0.5 }} />}
          </ListItemButton>
          </React.Fragment>
        ))}
      </List>
      </ListCard>

      {/* Keeps the last row scrollable clear of the bar. */}
      {selecting && <Box aria-hidden sx={{ flexShrink: 0, height: 88 }} />}

      {selecting && (
        <Paper
          elevation={0}
          sx={{
            position: "fixed", left: 0, right: 0, bottom: barBottom, zIndex: 1200,
            p: 1.5, borderRadius: 0, display: "flex", alignItems: "center", gap: 1,
            borderTop: 1, borderColor: "divider", boxShadow: "0 -6px 18px rgba(0,0,0,0.08)",
          }}
        >
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="body2" fontWeight={700} noWrap>
              {progress ?? `${selected.length} selected`}
            </Typography>
            {!progress && (
              <Stack direction="row" spacing={0.5} sx={{ ml: -1 }}>
                <Button size="small" onClick={() => setSelected(reports.map((r) => r.id))}>
                  Select all
                </Button>
                <Button size="small" onClick={() => setSelected([])} disabled={!selected.length}>
                  Clear
                </Button>
              </Stack>
            )}
            {tooMany && !progress && (
              <Typography variant="caption" color="error" noWrap component="div">
                At most {MAX_BULK_REPORTS} at a time
              </Typography>
            )}
          </Box>
          <Button
            variant="contained"
            startIcon={progress ? <CircularProgress size={18} color="inherit" /> : <DownloadIcon />}
            onClick={download}
            disabled={!chosen.length || tooMany || !!progress}
            sx={{ minHeight: 48 }}
          >
            Download ({chosen.length})
          </Button>
        </Paper>
      )}

      <Snackbar
        open={!!notice}
        autoHideDuration={notice?.tone === "success" ? 5000 : null}
        onClose={(_, reason) => reason !== "clickaway" && setNotice(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        sx={{ bottom: `calc(${barBottom} + 16px) !important` }}
      >
        <Alert severity={notice?.tone ?? "success"} onClose={() => setNotice(null)} variant="filled" sx={{ width: "100%" }}>
          {notice?.text}
        </Alert>
      </Snackbar>

      {surface}
    </>
  );
}
