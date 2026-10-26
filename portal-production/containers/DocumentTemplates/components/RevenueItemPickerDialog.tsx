"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
  alpha,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import AddIcon from "@mui/icons-material/Add";
import SearchIcon from "@mui/icons-material/Search";
import { useAuth } from "@clerk/nextjs";

export type RevenueItem = {
  id: string;
  code?: string | null;
  name: string;
  type: string; // PRODUCT | SERVICE
  unitPrice?: number | null;
  accountCode: string;
  accountName?: string | null;
};

// Master-file picker used by "Add Item / Add Service" in the invoice editor.
// Selecting a row returns the item (with its GL accountCode) so the added line
// self-codes and the invoice posts to the ledger deterministically.
//
// Two modes:
//  - single (default): click a row → that one line is added and the dialog
//    closes. Used when re-coding an existing row via the pencil.
//  - multi (`onSelectMany` given): rows carry a checkbox, the header checkbox
//    ticks every visible row, and "Add N services" appends them all in list
//    order (sorted by code — the order the master file was written in). Built
//    for WCT (guru 2026-10-26), whose quotations repeat the same dozen scope
//    lines (G-/S- services + a maintenance package) on every job: one trip to
//    the picker instead of twelve.
export default function RevenueItemPickerDialog({
  open,
  onClose,
  onSelect,
  onSelectMany,
  onBlank,
  typeFilter,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (item: RevenueItem) => void;
  onSelectMany?: (items: RevenueItem[]) => void; // multi-select mode when given
  onBlank?: () => void; // add an ad-hoc blank line
  typeFilter?: string; // "SERVICE" to show services only
}) {
  const { getToken } = useAuth();
  const [items, setItems] = useState<RevenueItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const multi = typeof onSelectMany === "function";
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  // A fresh open starts with nothing ticked — last job's picks must not leak
  // into the next quotation.
  useEffect(() => { if (open) setSelectedIds(new Set()); }, [open]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const token = await getToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      if (typeof window !== "undefined") {
        const activeOrgId = window.sessionStorage.getItem("aims-admin-active-org");
        if (activeOrgId) headers["X-Active-Org-Id"] = activeOrgId;
      }
      const typeQ = typeFilter ? `&type=${encodeURIComponent(typeFilter)}` : "";
      const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_API_URL}/revenue-items?activeOnly=true${typeQ}`, { headers });
      const json = await res.json();
      const list = json?.data ?? json;
      setItems(Array.isArray(list) ? list : []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [getToken, typeFilter]);

  useEffect(() => { if (open) load(); }, [open, load]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return items;
    return items.filter((i) => i.name.toLowerCase().includes(s) || (i.code || "").toLowerCase().includes(s) || (i.accountName || "").toLowerCase().includes(s) || i.accountCode.includes(s));
  }, [items, q]);

  const toggle = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const visibleSelected = filtered.filter((i) => selectedIds.has(i.id)).length;
  const allVisibleSelected = filtered.length > 0 && visibleSelected === filtered.length;
  const toggleAllVisible = () =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) filtered.forEach((i) => next.delete(i.id));
      else filtered.forEach((i) => next.add(i.id));
      return next;
    });
  const addSelected = () => {
    if (!onSelectMany) return;
    // List order (by code), not click order, so the lines land on the
    // document the way the master file reads.
    const picked = items.filter((i) => selectedIds.has(i.id));
    if (picked.length === 0) return;
    onSelectMany(picked);
    onClose();
  };
  const handleRowClick = (it: RevenueItem) => {
    if (multi) toggle(it.id);
    else { onSelect(it); onClose(); }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="md"
      // Phone: fill the screen — the item list needs the width.
      PaperProps={{
        sx: {
          m: { xs: 0, sm: 4 },
          width: { xs: "100%", sm: "auto" },
          maxWidth: { xs: "100%", sm: undefined },
          borderRadius: { xs: 0, sm: 1 },
          minHeight: { xs: "100%", sm: "auto" },
          maxHeight: { xs: "100%", sm: "calc(100% - 64px)" },
        },
      }}
    >
      <DialogTitle sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span>{multi ? "Add services" : "Add item / service"}</span>
        <IconButton size="small" onClick={onClose}><CloseIcon fontSize="small" /></IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <Stack direction="row" gap={1} sx={{ mb: 1.5 }} alignItems="center">
          <TextField
            fullWidth size="small" autoFocus placeholder="Search items & services…"
            value={q} onChange={(e) => setQ(e.target.value)}
            InputProps={{ startAdornment: <SearchIcon sx={{ color: "text.secondary", mr: 1 }} fontSize="small" /> }}
          />
          {onBlank && (
            <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={() => { onBlank(); onClose(); }} sx={{ whiteSpace: "nowrap" }}>
              Blank line
            </Button>
          )}
        </Stack>

        {loading ? (
          <Box sx={{ display: "flex", justifyContent: "center", p: 5 }}><CircularProgress /></Box>
        ) : filtered.length === 0 ? (
          <Box sx={{ textAlign: "center", py: 5, color: "text.secondary" }}>
            <Typography variant="body2">
              {items.length === 0 ? "No revenue items yet — add them in Accounting Setup → Revenue Items." : "No matches."}
            </Typography>
          </Box>
        ) : (
          <TableContainer sx={{ maxHeight: 440 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  {multi && (
                    <TableCell padding="checkbox">
                      <Checkbox
                        size="small"
                        checked={allVisibleSelected}
                        indeterminate={visibleSelected > 0 && !allVisibleSelected}
                        onChange={toggleAllVisible}
                        inputProps={{ "aria-label": "Select all visible services" }}
                      />
                    </TableCell>
                  )}
                  <TableCell sx={{ fontWeight: 700 }}>Name</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Type</TableCell>
                  <TableCell sx={{ fontWeight: 700 }} align="right">Unit price</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>GL account</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filtered.map((it) => (
                  <TableRow
                    key={it.id} hover
                    selected={multi && selectedIds.has(it.id)}
                    sx={{ cursor: "pointer", "&:hover": { bgcolor: (t) => alpha(t.palette.primary.main, 0.06) } }}
                    onClick={() => handleRowClick(it)}
                  >
                    {multi && (
                      <TableCell padding="checkbox">
                        <Checkbox
                          size="small"
                          checked={selectedIds.has(it.id)}
                          onChange={() => toggle(it.id)}
                          onClick={(e) => e.stopPropagation()}
                          inputProps={{ "aria-label": `Select ${it.name}` }}
                        />
                      </TableCell>
                    )}
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>{it.name}</Typography>
                      {/* Code + the GL account it posts to, same badge the invoice
                          line shows so the two read identically (guru 2026-08-17). */}
                      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, flexWrap: "wrap" }}>
                        {it.code && <Typography variant="caption" sx={{ color: "text.secondary" }}>{it.code}</Typography>}
                        <Typography
                          variant="caption"
                          sx={{
                            px: 0.5,
                            borderRadius: 0.5,
                            fontVariantNumeric: "tabular-nums",
                            color: "text.secondary",
                            bgcolor: (t) => alpha(t.palette.primary.main, t.palette.mode === "dark" ? 0.18 : 0.08),
                          }}
                        >
                          GL {it.accountCode}
                        </Typography>
                      </Box>
                    </TableCell>
                    <TableCell><Chip size="small" variant="outlined" label={it.type === "PRODUCT" ? "Item" : "Service"} color={it.type === "PRODUCT" ? "primary" : "default"} /></TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>{it.unitPrice != null ? it.unitPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}</TableCell>
                    <TableCell><Typography variant="body2"><b>{it.accountCode}</b>{it.accountName ? ` — ${it.accountName}` : ""}</Typography></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
        <Typography variant="caption" sx={{ color: "text.secondary", display: "block", mt: 1 }}>
          {multi
            ? "Tick the services for this job, then Add — each line posts to its mapped GL account automatically."
            : "Click a row to add it — the line will post to its mapped GL account automatically."}
        </Typography>
      </DialogContent>
      {multi && (
        <DialogActions sx={{ px: 3, py: 1.5, justifyContent: "space-between" }}>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            {selectedIds.size === 0 ? "Nothing selected" : `${selectedIds.size} selected`}
          </Typography>
          <Stack direction="row" gap={1}>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="contained" startIcon={<AddIcon />} disabled={selectedIds.size === 0} onClick={addSelected} data-tour="service-picker-add-selected">
              {selectedIds.size === 0 ? "Add services" : `Add ${selectedIds.size} ${selectedIds.size === 1 ? "service" : "services"}`}
            </Button>
          </Stack>
        </DialogActions>
      )}
    </Dialog>
  );
}
