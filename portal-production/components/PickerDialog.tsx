"use client";

// Shared big picker (2026-11-22): the look of Biofuel's Stock Card > Select Item (StockCardDialog.tsx, which stays as
// it is): a large dialog with the title and a close X, a full-width search, optional tabs, then a table whose rows
// are picked with a click or Enter (arrow keys move). Callers give the columns, the rows and what a pick does.

import React, { useEffect, useRef, useState } from "react";
import {
  Box,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import SearchIcon from "@mui/icons-material/Search";

export interface PickerColumn<T> {
  key: string;
  header: string;
  width?: string;
  align?: "left" | "right" | "center";
  render: (row: T) => React.ReactNode;
}

export interface PickerDialogProps<T> {
  open: boolean;
  onClose: () => void;
  title: string;
  search: string;
  onSearch: (v: string) => void;
  searchPlaceholder?: string;
  tabs?: Array<{ value: string; label: string }>;
  tab?: string;
  onTab?: (v: string) => void;
  columns: PickerColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onPick: (row: T) => void;
  loading?: boolean;
  /** Shown when there are no rows (after loading). */
  emptyText?: string;
  /** A line under the search (e.g. an error or a hint). */
  note?: React.ReactNode;
  busy?: boolean;
  "data-tour"?: string;
}

export default function PickerDialog<T>({
  open,
  onClose,
  title,
  search,
  onSearch,
  searchPlaceholder = "Search",
  tabs,
  tab,
  onTab,
  columns,
  rows,
  rowKey,
  onPick,
  loading = false,
  emptyText = "Nothing found",
  note,
  busy = false,
  "data-tour": dataTour,
}: PickerDialogProps<T>) {
  const [active, setActive] = useState(0);
  const activeRef = useRef<HTMLTableRowElement | null>(null);
  useEffect(() => setActive(0), [rows, tab]);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [active]);
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(rows.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter" && rows[active] && !busy) {
      e.preventDefault();
      onPick(rows[active]);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={() => !busy && onClose()}
      maxWidth="lg"
      fullWidth
      PaperProps={{
        sx: {
          m: { xs: 0, sm: 4 },
          width: { xs: "100%", sm: "auto" },
          maxWidth: { xs: "100%", sm: undefined },
          borderRadius: { xs: 0, sm: 1 },
          minHeight: { xs: "100%", sm: "70vh" },
          maxHeight: { xs: "100%", sm: "85vh" },
        },
      }}
      data-tour={dataTour}
    >
      <DialogTitle sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", bgcolor: "background.paper", color: "text.primary", borderBottom: "1px solid", borderColor: "divider", py: 1.75 }}>
        <Typography variant="h6" fontWeight={600} component="span">
          {title}
        </Typography>
        <IconButton onClick={onClose} size="small" sx={{ color: "text.secondary" }} aria-label="Close" disabled={busy}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ p: 0, bgcolor: "background.paper" }}>
        <Box sx={{ p: 2, bgcolor: "background.paper", borderBottom: "1px solid", borderColor: "divider" }}>
          <TextField
            fullWidth
            placeholder={searchPlaceholder}
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            onKeyDown={onKeyDown}
            size="small"
            autoFocus
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon color="action" />
                </InputAdornment>
              ),
            }}
            sx={{ mb: tabs?.length || note ? 1.5 : 0, bgcolor: "background.paper" }}
          />
          {tabs && tabs.length > 0 && (
            <ToggleButtonGroup exclusive size="small" value={tab} onChange={(_, v) => v && onTab?.(v)} sx={{ mb: note ? 1 : 0 }}>
              {tabs.map((t) => (
                <ToggleButton key={t.value} value={t.value} sx={{ px: 2 }}>
                  {t.label}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          )}
          {note && <Box sx={{ mt: tabs?.length ? 0.5 : 0 }}>{note}</Box>}
        </Box>
        <TableContainer component={Paper} elevation={0} sx={{ maxHeight: "calc(85vh - 220px)", bgcolor: "background.paper" }}>
          <Table stickyHeader size="small">
            <TableHead>
              <TableRow>
                {columns.map((c) => (
                  <TableCell key={c.key} align={c.align} sx={{ width: c.width }}>
                    {c.header}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={columns.length} align="center" sx={{ py: 4 }}>
                    <Typography color="text.secondary">{loading ? "Searching…" : emptyText}</Typography>
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row, i) => (
                  <TableRow
                    key={rowKey(row)}
                    ref={i === active ? activeRef : undefined}
                    hover
                    selected={i === active}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => !busy && onPick(row)}
                    sx={{
                      cursor: busy ? "progress" : "pointer",
                      "&.Mui-selected, &.Mui-selected:hover": {
                        bgcolor: "primary.main",
                        "& .MuiTableCell-root": { color: "primary.contrastText" },
                        "& .MuiTypography-root": { color: "primary.contrastText" },
                      },
                    }}
                  >
                    {columns.map((c) => (
                      <TableCell key={c.key} align={c.align} sx={{ color: "text.primary" }}>
                        {c.render(row)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </DialogContent>
    </Dialog>
  );
}
