"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
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
export default function RevenueItemPickerDialog({
  open,
  onClose,
  onSelect,
  onBlank,
  typeFilter,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (item: RevenueItem) => void;
  onBlank?: () => void; // add an ad-hoc blank line
  typeFilter?: string; // "SERVICE" to show services only
}) {
  const { getToken } = useAuth();
  const [items, setItems] = useState<RevenueItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");

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

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span>Add item / service</span>
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
                  <TableCell sx={{ fontWeight: 700 }}>Name</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Type</TableCell>
                  <TableCell sx={{ fontWeight: 700 }} align="right">Unit price</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>GL account</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filtered.map((it) => (
                  <TableRow
                    key={it.id} hover sx={{ cursor: "pointer", "&:hover": { bgcolor: (t) => alpha(t.palette.primary.main, 0.06) } }}
                    onClick={() => { onSelect(it); onClose(); }}
                  >
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>{it.name}</Typography>
                      {it.code && <Typography variant="caption" sx={{ color: "text.secondary" }}>{it.code}</Typography>}
                    </TableCell>
                    <TableCell><Chip size="small" variant="outlined" label={it.type === "PRODUCT" ? "Item" : "Service"} color={it.type === "PRODUCT" ? "primary" : "default"} /></TableCell>
                    <TableCell align="right" sx={{ fontFamily: "monospace" }}>{it.unitPrice != null ? it.unitPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}</TableCell>
                    <TableCell><Typography variant="body2"><b>{it.accountCode}</b>{it.accountName ? ` — ${it.accountName}` : ""}</Typography></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
        <Typography variant="caption" sx={{ color: "text.secondary", display: "block", mt: 1 }}>
          Click a row to add it — the line will post to its mapped GL account automatically.
        </Typography>
      </DialogContent>
    </Dialog>
  );
}
