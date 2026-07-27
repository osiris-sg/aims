"use client";

// Xero-style report shell: breadcrumb + title header, filter bar with explicit
// Update button, white report card, and a footer bar (compact toggle, row
// info, export). All colors via theme tokens — dark-mode safe.

import React, { useRef, useState } from "react";
import {
  Box, Button, CircularProgress, FormControlLabel, InputAdornment,
  Menu, MenuItem, Stack, Switch, TextField, Tooltip, Typography,
} from "@mui/material";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import FileDownloadOutlinedIcon from "@mui/icons-material/FileDownloadOutlined";
import PrintOutlinedIcon from "@mui/icons-material/PrintOutlined";
import SearchIcon from "@mui/icons-material/Search";
import { ReportSearchContext } from "./ReportTable";

export interface ReportShellProps {
  title: string;
  breadcrumb?: { label: string; href: string };
  /** filter controls; the shell renders them in a row with the Update button */
  filters: React.ReactNode;
  onUpdate: () => void;
  loading?: boolean;
  /** lines under the in-card title: org name, "As at ...", etc. */
  headerLines?: string[];
  /** right side of the card header, e.g. reorder columns */
  cardActions?: React.ReactNode;
  footerInfo?: string;
  onExportCsv?: () => void;
  compact?: boolean;
  onCompactChange?: (v: boolean) => void;
  children: React.ReactNode;
}

export default function ReportShell({
  title, filters, onUpdate, loading, headerLines,
  cardActions, footerInfo, onExportCsv, compact, onCompactChange, children,
}: ReportShellProps) {
  // In-report search — provided via context so every ReportTable in this
  // report filters its rows live (guru 2026-07-15: search on ALL reports).
  const [reportSearch, setReportSearch] = useState("");

  // Export dropdown. Excel export is generic: it serialises the rendered
  // report tables from the DOM into an Excel-compatible HTML .xls, so every
  // report gets it without a per-report exporter.
  const [exportAnchor, setExportAnchor] = useState<null | HTMLElement>(null);
  const reportContentRef = useRef<HTMLDivElement | null>(null);
  const exportExcel = () => {
    const tables = reportContentRef.current?.querySelectorAll("table");
    if (!tables || tables.length === 0) return;
    const tableHtml = Array.from(tables).map((t) => t.outerHTML).join("<br/>");
    const html =
      `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">` +
      `<head><meta charset="utf-8"/><style>td,th{font-family:Helvetica,Arial,sans-serif;font-size:11pt;}</style></head>` +
      `<body><b>${title}</b><br/>${(headerLines || []).join("<br/>")}<br/><br/>${tableHtml}</body></html>`;
    const blob = new Blob(["﻿", html], { type: "application/vnd.ms-excel" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.replace(/[^\w-]+/g, "_").toLowerCase()}.xls`;
    a.click();
    URL.revokeObjectURL(url);
  };
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
          <Box sx={{ px: 3, py: 2, maxWidth: 1140, mx: "auto", width: "100%" }}>
            <Stack direction="row" flexWrap="wrap" alignItems="flex-end" sx={{ gap: 2 }}>
              {filters}
              <Button
                variant="contained"
                onClick={onUpdate}
                disabled={loading}
                startIcon={loading ? <CircularProgress size={14} color="inherit" /> : undefined}
                sx={{ height: 40 }}
              >
                Update
              </Button>
            </Stack>
          </Box>

          {/* Report card */}
          <Box sx={{ px: 3, pb: 3, flex: 1, maxWidth: 1140, mx: "auto", width: "100%" }}>
            <Box sx={{
              bgcolor: "background.paper",
              border: (t) => `1px solid ${t.palette.divider}`,
              borderRadius: 1.5,
              p: 3,
              overflowX: "auto",
            }}>
              <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 1 }}>
                <Box>
                  <Typography variant="h6" sx={{ fontWeight: 700 }}>{title}</Typography>
                  {(headerLines || []).map((l) => (
                    <Typography key={l} variant="body2" color="text.secondary" sx={{ lineHeight: 1.6 }}>{l}</Typography>
                  ))}
                </Box>
                <Stack direction="row" gap={1} alignItems="center">
                  <TextField
                    size="small"
                    placeholder="Search report…"
                    value={reportSearch}
                    onChange={(e) => setReportSearch(e.target.value)}
                    sx={{ width: 220, displayPrint: "none" }}
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

          {/* Footer bar */}
          <Box sx={{
            borderTop: (t) => `1px solid ${t.palette.divider}`,
            px: 3, py: 1,
            display: "flex", alignItems: "center", justifyContent: "space-between",
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
            <Stack direction="row" gap={1}>
              <Tooltip title="Print / save as PDF">
                <Button size="small" variant="outlined" startIcon={<PrintOutlinedIcon />} onClick={() => window.print()}>Print</Button>
              </Tooltip>
              {/* Export dropdown — pick the destination format (guru 2026-07-27). */}
              <Button
                size="small"
                variant="outlined"
                startIcon={<FileDownloadOutlinedIcon />}
                endIcon={<ArrowDropDownIcon />}
                onClick={(e) => setExportAnchor(e.currentTarget)}
              >
                Export
              </Button>
              <Menu anchorEl={exportAnchor} open={!!exportAnchor} onClose={() => setExportAnchor(null)}
                anchorOrigin={{ vertical: "top", horizontal: "right" }}
                transformOrigin={{ vertical: "bottom", horizontal: "right" }}
              >
                {onExportCsv && (
                  <MenuItem onClick={() => { setExportAnchor(null); onExportCsv(); }}>
                    CSV (.csv)
                  </MenuItem>
                )}
                <MenuItem onClick={() => { setExportAnchor(null); exportExcel(); }}>
                  Excel (.xls)
                </MenuItem>
                <MenuItem onClick={() => { setExportAnchor(null); window.print(); }}>
                  PDF (print dialog)
                </MenuItem>
              </Menu>
            </Stack>
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
