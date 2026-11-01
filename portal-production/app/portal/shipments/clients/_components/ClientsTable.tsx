/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Round AY part 3 — the Clients tables (Customers · Suppliers · Shipping lines): sortable columns, search, row
// selection with "Export selected (CSV)", the row opens the record, secondary actions behind the row's ⋮ menu
// (anchored at the click position — CLAUDE.md table pattern).

import React, { useMemo, useState } from "react";
import { Box, Button, Checkbox, CircularProgress, IconButton, InputAdornment, Menu, MenuItem, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TableSortLabel, TextField, Typography } from "@mui/material";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import SearchIcon from "@mui/icons-material/Search";
import DownloadIcon from "@mui/icons-material/Download";
import { useTranslations } from "next-intl";
import { csvOf, searchRows, sortRows, type ColValue, type SortDir } from "../../_lib/clients-table";

export type ClientsColumn<T> = { id: string; label: string; value: (r: T) => ColValue; render?: (r: T) => React.ReactNode; minWidth?: number; align?: "left" | "right" };
export type RowAction<T> = { label: string; onClick: (r: T) => void; destructive?: boolean };

export default function ClientsTable<T>({
  rows,
  columns,
  rowKey,
  onOpen,
  loading,
  actions,
  menu,
  csvName,
  dataTour,
  initialSort,
}: {
  rows: T[];
  columns: ClientsColumn<T>[];
  rowKey: (r: T) => string;
  onOpen?: (r: T) => void;
  loading?: boolean;
  /** Toolbar buttons (right of the search), e.g. "+ Add customer". */
  actions?: React.ReactNode;
  menu?: (r: T) => RowAction<T>[];
  csvName: string;
  /** Not needed any more (text follows the portal language); kept for the callers. */
  lang?: "en" | "ja";
  dataTour?: string;
  initialSort?: { id: string; dir: SortDir };
}) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ id: string; dir: SortDir }>(initialSort ?? { id: columns[0]?.id, dir: "asc" });
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [m, setM] = useState<{ pos: { left: number; top: number }; row: T } | null>(null);
  const col = columns.find((c) => c.id === sort.id) ?? columns[0];
  const shown = useMemo(() => sortRows(searchRows(rows, q, (r) => columns.map((c) => c.value(r) ?? "").join(" ")), col.value, sort.dir), [rows, q, columns, col, sort.dir]);
  const allOn = shown.length > 0 && shown.every((r) => sel.has(rowKey(r)));
  const picked = rows.filter((r) => sel.has(rowKey(r)));
  const exportCsv = () => {
    const blob = new Blob([csvOf(picked.length ? picked : shown, columns)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${csvName}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const t = useTranslations("clients.table");
  return (
    <Paper variant="outlined" sx={{ p: 1.5 }} data-tour={dataTour}>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
        <TextField
          size="small"
          placeholder={t("search")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          sx={{ minWidth: 240, flex: { xs: 1, sm: "0 1 320px" } }}
          InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
        />
        <Typography variant="caption" color="text.secondary">
          {t("rows", { n: shown.length })}
          {picked.length ? ` · ${t("selected", { n: picked.length })}` : ""}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Button size="small" startIcon={<DownloadIcon />} onClick={exportCsv} data-tour="clients-export">
          {picked.length ? t("exportSelected") : t("export")}
        </Button>
        {actions}
      </Stack>
      <TableContainer sx={{ maxWidth: "100%", overflowX: "auto" }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox">
                <Checkbox size="small" checked={allOn} indeterminate={!allOn && shown.some((r) => sel.has(rowKey(r)))} onChange={() => setSel(allOn ? new Set() : new Set(shown.map(rowKey)))} inputProps={{ "aria-label": t("selectAll") }} />
              </TableCell>
              {columns.map((c) => (
                <TableCell key={c.id} align={c.align} sx={{ minWidth: c.minWidth, whiteSpace: "nowrap", fontWeight: 700 }} sortDirection={sort.id === c.id ? sort.dir : false}>
                  <TableSortLabel active={sort.id === c.id} direction={sort.id === c.id ? sort.dir : "asc"} onClick={() => setSort((s) => ({ id: c.id, dir: s.id === c.id && s.dir === "asc" ? "desc" : "asc" }))}>
                    {c.label}
                  </TableSortLabel>
                </TableCell>
              ))}
              {menu && <TableCell padding="checkbox" />}
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={columns.length + 2}><CircularProgress size={20} /></TableCell>
              </TableRow>
            ) : !shown.length ? (
              <TableRow>
                <TableCell colSpan={columns.length + 2}><Typography variant="body2" color="text.secondary">{t("empty")}</Typography></TableCell>
              </TableRow>
            ) : (
              shown.map((r) => {
                const k = rowKey(r);
                return (
                  <TableRow key={k} hover sx={{ cursor: onOpen ? "pointer" : undefined }} onClick={() => onOpen?.(r)} selected={sel.has(k)}>
                    <TableCell padding="checkbox" onClick={(e) => e.stopPropagation()}>
                      <Checkbox size="small" checked={sel.has(k)} onChange={() => setSel((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; })} />
                    </TableCell>
                    {columns.map((c) => (
                      <TableCell key={c.id} align={c.align} sx={{ verticalAlign: "top" }}>{c.render ? c.render(r) : c.value(r) ?? "—"}</TableCell>
                    ))}
                    {menu && (
                      <TableCell padding="checkbox" onClick={(e) => e.stopPropagation()}>
                        <IconButton size="small" aria-label={t("more")} onClick={(e) => setM({ pos: { left: e.clientX, top: e.clientY }, row: r })}>
                          <MoreVertIcon fontSize="small" />
                        </IconButton>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </TableContainer>
      <Menu open={!!m} onClose={() => setM(null)} anchorReference="anchorPosition" anchorPosition={m?.pos}>
        {m && menu?.(m.row).map((a) => (
          <MenuItem key={a.label} onClick={() => { setM(null); a.onClick(m.row); }} sx={a.destructive ? { color: "error.main" } : undefined}>
            {a.label}
          </MenuItem>
        ))}
      </Menu>
    </Paper>
  );
}
