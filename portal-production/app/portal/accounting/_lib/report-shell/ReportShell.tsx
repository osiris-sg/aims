"use client";

// Xero-style report shell: breadcrumb + title header, filter bar, white report
// card, and a footer bar (compact toggle, row info, export). All colors via
// theme tokens — dark-mode safe.
//
// No Update button (guru 2026-11-16): changing a filter re-runs the report by
// itself. The shell watches `onUpdate`'s identity — every report builds it with
// useCallback over its fetch filters — and calls it, debounced, whenever that
// identity changes after mount. Reports must therefore pass the memoised
// callback itself (onUpdate={load}), never an inline arrow.

import React, { useEffect, useRef, useState } from "react";
import {
  Box, FormControlLabel, InputAdornment, LinearProgress,
  Stack, Switch, TextField, Typography,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import { ReportSearchContext } from "./ReportTable";
import { useOrganization } from "@/app/portal/hooks/useOrganization";
import { ReportPrintExportButton, ReportEmailButton, domToExportModel, type ReportExportModel } from "../report-export";

export interface ReportShellProps {
  title: string;
  breadcrumb?: { label: string; href: string };
  /** filter controls; the shell renders them in a row */
  filters: React.ReactNode;
  /** memoised fetch (useCallback over the filters) — re-run whenever its identity changes */
  onUpdate: () => void;
  loading?: boolean;
  /** lines under the in-card title: org name, "As at ...", etc. */
  headerLines?: string[];
  /** right side of the card header, e.g. reorder columns */
  cardActions?: React.ReactNode;
  footerInfo?: string;
  onExportCsv?: () => void;
  /** a report that has more than tables (e.g. an ageing box) builds its own export model */
  getExportModel?: () => ReportExportModel | null;
  compact?: boolean;
  onCompactChange?: (v: boolean) => void;
  children: React.ReactNode;
}

export default function ReportShell({
  title, filters, onUpdate, loading, headerLines,
  cardActions, footerInfo, onExportCsv, getExportModel, compact, onCompactChange, children,
}: ReportShellProps) {
  // In-report search — provided via context so every ReportTable in this
  // report filters its rows live (guru 2026-07-15: search on ALL reports).
  const [reportSearch, setReportSearch] = useState("");

  // Auto-update: when a filter changes, the report's memoised `onUpdate`
  // gets a new identity; re-run it after a short pause so typing a date does
  // not fire a request per keystroke. The first identity is the mount — the
  // report already loads itself then — and an unchanged identity (StrictMode
  // re-run, unrelated re-render) is a no-op.
  const lastUpdate = useRef(onUpdate);
  useEffect(() => {
    if (lastUpdate.current === onUpdate) return;
    lastUpdate.current = onUpdate;
    const t = setTimeout(() => onUpdate(), 400);
    return () => clearTimeout(t);
  }, [onUpdate]);

  // Print & export per the report standard (CLAUDE.md "Report print & export
  // standard"): the rendered tables are captured generically from the DOM into
  // one export model, so every report gets PDF/.xlsx/CSV — and Print opens the
  // GENERATED DOCUMENT with the print dialog, never the raw app screen.
  const { organization } = useOrganization();
  const reportContentRef = useRef<HTMLDivElement | null>(null);
  const captureModel = () =>
    getExportModel ? getExportModel() : domToExportModel(reportContentRef.current, title, organization?.name || "", headerLines);
  // NOTE: the hosting section page already shows "Back to X | <Report name>",
  // so the shell renders no header of its own — the report card carries the
  // title (guru, 2026-07-10).
  return (
    <Box sx={{ display: "flex", flexDirection: "column", minHeight: "100%", bgcolor: "background.default" }}>
      <Box sx={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* Main column */}
        <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          {/* Filter bar — width-capped with the report card so filters and
              content share the same centred column (guru 2026-07-27: reports
              read like Xero's — compact centred card, columns close together,
              not stretched across the whole screen). */}
          {/* Print / Export lives at the TOP RIGHT of every report page, on the
              filter row but outside the centred filter column (guru 2026-11-11:
              the footer button was hard to see). */}
          <Box sx={{ position: "relative" }}>
            {/* Filters share the report card's centred column EXACTLY — same
                padding + same 1140 cap on the padded box (guru 2026-11-11:
                "left section aligned with the report"). */}
            <Box sx={{ px: { xs: 1.5, md: 3 }, py: 2, maxWidth: 1140, mx: "auto", width: "100%" }}>
              <Stack direction="row" flexWrap="wrap" alignItems="flex-end" sx={{ gap: { xs: 1.5, md: 2 } }}>
                {filters}
              </Stack>
            </Box>
            {/* Top-right of the page, outside the column; drops under the
                filters on narrow screens instead of overlapping them. */}
            <Box
              sx={{
                position: { xs: "static", lg: "absolute" },
                right: { lg: 24 },
                top: { lg: 16 },
                px: { xs: 1.5, md: 3, lg: 0 },
                pb: { xs: 1.5, lg: 0 },
                display: "flex",
                flexDirection: { xs: "row", lg: "column" },
                alignItems: "stretch",
                justifyContent: "flex-end",
                gap: 1,
                "& .MuiButton-root": { height: 40, justifyContent: "flex-start" },
              }}
            >
              <ReportPrintExportButton getModel={captureModel} onExportCsv={onExportCsv} size="medium" />
              <ReportEmailButton getModel={captureModel} size="medium" />
            </Box>
          </Box>

          {/* Report card */}
          <Box sx={{ px: { xs: 1.5, md: 3 }, pb: 3, flex: 1, maxWidth: 1140, mx: "auto", width: "100%" }}>
            <Box sx={{
              bgcolor: "background.paper",
              border: (t) => `1px solid ${t.palette.divider}`,
              borderRadius: 1.5,
              p: { xs: 1.5, md: 3 },
              overflowX: "auto",
              position: "relative",
            }}>
              {/* The only "loading" signal now that the Update button is gone:
                  a thin bar along the card's top edge. */}
              {loading && (
                <LinearProgress sx={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, borderRadius: "6px 6px 0 0" }} />
              )}
              {/* Phone: title + search wrap onto two rows instead of clipping */}
              <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 1, flexWrap: { xs: "wrap", md: "nowrap" }, gap: 1 }}>
                <Box>
                  <Typography variant="h6" sx={{ fontWeight: 700 }}>{title}</Typography>
                  {(headerLines || []).map((l) => (
                    <Typography key={l} variant="body2" color="text.secondary" sx={{ lineHeight: 1.6 }}>{l}</Typography>
                  ))}
                </Box>
                <Stack direction="row" gap={1} alignItems="center" sx={{ flexWrap: "wrap", minWidth: { xs: "100%", sm: 0 } }}>
                  <TextField
                    size="small"
                    placeholder="Search report…"
                    value={reportSearch}
                    onChange={(e) => setReportSearch(e.target.value)}
                    sx={{ width: { xs: "100%", sm: 220 }, displayPrint: "none" }}
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">
                          <SearchIcon fontSize="small" />
                        </InputAdornment>
                      ),
                    }}
                  />
                  {cardActions}
                </Stack>
              </Stack>
              <ReportSearchContext.Provider value={reportSearch}>
                <Box ref={reportContentRef}>{children}</Box>
              </ReportSearchContext.Provider>
            </Box>
          </Box>

          {/* Footer bar — shares the report card's centred 1140 column so its
              info (e.g. "Customer 1 of 2 · Range total owed") aligns with the
              report's right edge, not the far bottom-right of the screen
              (guru 2026-11-14). */}
          <Box sx={{
            borderTop: (t) => `1px solid ${t.palette.divider}`,
            px: { xs: 1.5, md: 3 }, py: 1,
            maxWidth: 1140, mx: "auto", width: "100%",
            display: "flex", alignItems: "center", justifyContent: "space-between",
            flexWrap: { xs: "wrap", md: "nowrap" }, gap: 1,
            position: "sticky", bottom: 0,
            bgcolor: "background.paper",
          }}>
            <Box>
              {onCompactChange && (
                <FormControlLabel
                  control={<Switch size="small" checked={!!compact} onChange={(_, v) => onCompactChange(v)} />}
                  label={<Typography variant="body2">Compact view</Typography>}
                />
              )}
            </Box>
            <Typography variant="body2" color="text.secondary">{footerInfo || ""}</Typography>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

// Utility: trigger a client-side CSV download.
export function downloadCsv(filename: string, rows: (string | number)[][]) {
  const esc = (v: string | number) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const content = rows.map((r) => r.map(esc).join(",")).join("\n");
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
