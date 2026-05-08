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
  InputAdornment,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import PrintIcon from "@mui/icons-material/Print";
import VisibilityIcon from "@mui/icons-material/Visibility";
import SearchIcon from "@mui/icons-material/Search";
import CloseIcon from "@mui/icons-material/Close";
import { toast } from "react-toastify";
import { useAccountingApi } from "../_lib/api";

type Account = { id: string; code: string; name: string };

type JournalLine = {
  id: string;
  accountId: string;
  lineNumber: number;
  description?: string | null;
  debit: number;
  credit: number;
  account: Account;
};

type JournalEntry = {
  id: string;
  journalNumber: string;
  entryDate: string;
  type: string;
  status: "DRAFT" | "POSTED" | "VOID";
  reference?: string | null;
  description?: string | null;
  totalDebit: number;
  totalCredit: number;
  currency: string;
  postedAt?: string | null;
  lines: JournalLine[];
};

const TYPES = ["", "MANUAL", "INVOICE", "PAYMENT", "CREDIT_NOTE", "DEBIT_NOTE", "OPENING_BALANCE", "ADJUSTMENT"];
const STATUSES = ["", "DRAFT", "POSTED", "VOID"];

const fmt = (n: number) =>
  n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function statusColor(s: string): "default" | "primary" | "success" | "error" {
  if (s === "POSTED") return "success";
  if (s === "DRAFT") return "primary";
  if (s === "VOID") return "error";
  return "default";
}

export default function AuditTrailPage() {
  const { request } = useAccountingApi();
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({ type: "", status: "", startDate: "", endDate: "" });
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<JournalEntry | null>(null);

  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    if (filters.type) p.set("type", filters.type);
    if (filters.status) p.set("status", filters.status);
    if (filters.startDate) p.set("startDate", filters.startDate);
    if (filters.endDate) p.set("endDate", filters.endDate);
    p.set("limit", "200");
    return p.toString();
  }, [filters]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await request<{ items: JournalEntry[]; total: number }>(`/journal/entries?${queryString}`);
      setEntries(res.items || []);
    } catch (e: any) {
      toast.error(e?.message || "Failed to load audit trail");
    } finally {
      setLoading(false);
    }
  }, [request, queryString]);

  useEffect(() => {
    load();
  }, [load]);

  const post = async (id: string) => {
    try {
      await request(`/journal/entries/${id}/post`, { method: "POST" });
      toast.success("Posted");
      load();
    } catch (e: any) {
      toast.error(e?.message || "Post failed");
    }
  };

  const voidEntry = async (id: string) => {
    if (!confirm("Void this entry? A reversing entry will be created if it was already posted.")) return;
    try {
      await request(`/journal/entries/${id}/void`, { method: "POST" });
      toast.success("Voided");
      load();
    } catch (e: any) {
      toast.error(e?.message || "Void failed");
    }
  };

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (e) =>
        e.journalNumber.toLowerCase().includes(q) ||
        (e.reference || "").toLowerCase().includes(q) ||
        (e.description || "").toLowerCase().includes(q),
    );
  }, [entries, search]);

  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>
            Audit Trail
          </Typography>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            Chronological log of every journal entry — invoices, payments, manual vouchers, voids.
          </Typography>
        </Box>
      </Stack>

      <Paper variant="outlined" sx={{ p: 1.5 }}>
        <Stack direction="row" gap={2} flexWrap="wrap" alignItems="center">
          <TextField
            select
            size="small"
            label="Type"
            value={filters.type}
            onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value }))}
            sx={{ minWidth: 160 }}
          >
            {TYPES.map((t) => (
              <MenuItem key={t} value={t}>
                {t || "All types"}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            label="Status"
            value={filters.status}
            onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
            sx={{ minWidth: 160 }}
          >
            {STATUSES.map((s) => (
              <MenuItem key={s} value={s}>
                {s || "All statuses"}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            size="small"
            type="date"
            label="From"
            InputLabelProps={{ shrink: true }}
            value={filters.startDate}
            onChange={(e) => setFilters((f) => ({ ...f, startDate: e.target.value }))}
          />
          <TextField
            size="small"
            type="date"
            label="To"
            InputLabelProps={{ shrink: true }}
            value={filters.endDate}
            onChange={(e) => setFilters((f) => ({ ...f, endDate: e.target.value }))}
          />
          <TextField
            size="small"
            label="Locate"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            sx={{ minWidth: 200 }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            }}
          />
          <Box sx={{ flex: 1 }} />
          <Button startIcon={<PrintIcon />} variant="outlined" size="small" onClick={() => window.print()}>
            Print
          </Button>
          <Button startIcon={<RefreshIcon />} variant="outlined" size="small" onClick={load}>
            Refresh
          </Button>
        </Stack>
      </Paper>

      <TableContainer component={Paper} variant="outlined">
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 700 }}>Entry #</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Date</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Type</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Reference</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Description</TableCell>
              <TableCell align="right" sx={{ fontWeight: 700 }}>Debit</TableCell>
              <TableCell align="right" sx={{ fontWeight: 700 }}>Credit</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
              <TableCell align="right" sx={{ fontWeight: 700 }}>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell colSpan={9} align="center" sx={{ py: 4 }}>
                  <CircularProgress size={20} />
                </TableCell>
              </TableRow>
            )}
            {!loading && visible.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} align="center" sx={{ py: 4, color: "text.secondary" }}>
                  No entries match — confirm an invoice or record a payment to populate the audit trail.
                </TableCell>
              </TableRow>
            )}
            {visible.map((e) => (
              <TableRow key={e.id} hover>
                <TableCell sx={{ fontFamily: "monospace" }}>{e.journalNumber}</TableCell>
                <TableCell>{new Date(e.entryDate).toLocaleDateString()}</TableCell>
                <TableCell>{e.type}</TableCell>
                <TableCell>{e.reference}</TableCell>
                <TableCell sx={{ maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {e.description}
                </TableCell>
                <TableCell align="right" sx={{ fontFamily: "monospace" }}>{fmt(e.totalDebit)}</TableCell>
                <TableCell align="right" sx={{ fontFamily: "monospace" }}>{fmt(e.totalCredit)}</TableCell>
                <TableCell>
                  <Chip size="small" label={e.status} color={statusColor(e.status)} variant="outlined" />
                </TableCell>
                <TableCell align="right">
                  <Tooltip title="View lines">
                    <IconButton size="small" onClick={() => setSelected(e)}>
                      <VisibilityIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  {e.status === "DRAFT" && (
                    <Button size="small" onClick={() => post(e.id)} sx={{ ml: 0.5 }}>
                      Post
                    </Button>
                  )}
                  {e.status !== "VOID" && (
                    <Button size="small" color="error" onClick={() => voidEntry(e.id)} sx={{ ml: 0.5 }}>
                      Void
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <EntryDialog entry={selected} onClose={() => setSelected(null)} />
    </Box>
  );
}

function EntryDialog({ entry, onClose }: { entry: JournalEntry | null; onClose: () => void }) {
  return (
    <Dialog open={!!entry} onClose={onClose} fullWidth maxWidth="md">
      {entry && (
        <>
          <DialogTitle>
            <Stack direction="row" alignItems="center" justifyContent="space-between">
              <Stack direction="row" alignItems="center" gap={1}>
                <Typography component="span" sx={{ fontFamily: "monospace", fontWeight: 700 }}>
                  {entry.journalNumber}
                </Typography>
                <Chip size="small" label={entry.status} color={statusColor(entry.status)} />
              </Stack>
              <IconButton onClick={onClose} size="small">
                <CloseIcon fontSize="small" />
              </IconButton>
            </Stack>
          </DialogTitle>
          <DialogContent dividers>
            <Stack gap={1} sx={{ mb: 2 }}>
              <Typography variant="body2"><strong>Date:</strong> {new Date(entry.entryDate).toLocaleDateString()}</Typography>
              <Typography variant="body2"><strong>Type:</strong> {entry.type}</Typography>
              {entry.reference && <Typography variant="body2"><strong>Reference:</strong> {entry.reference}</Typography>}
              {entry.description && <Typography variant="body2"><strong>Description:</strong> {entry.description}</Typography>}
            </Stack>
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>#</TableCell>
                    <TableCell>Account</TableCell>
                    <TableCell>Description</TableCell>
                    <TableCell align="right">Debit</TableCell>
                    <TableCell align="right">Credit</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {entry.lines.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell>{l.lineNumber}</TableCell>
                      <TableCell>
                        <Typography component="span" sx={{ fontFamily: "monospace", fontWeight: 600 }}>
                          {l.account.code}
                        </Typography>{" "}
                        <Typography component="span">{l.account.name}</Typography>
                      </TableCell>
                      <TableCell>{l.description}</TableCell>
                      <TableCell align="right" sx={{ fontFamily: "monospace" }}>
                        {l.debit ? fmt(l.debit) : ""}
                      </TableCell>
                      <TableCell align="right" sx={{ fontFamily: "monospace" }}>
                        {l.credit ? fmt(l.credit) : ""}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell colSpan={3} align="right" sx={{ fontWeight: 700 }}>
                      Totals
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700, fontFamily: "monospace" }}>
                      {fmt(entry.totalDebit)}
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700, fontFamily: "monospace" }}>
                      {fmt(entry.totalCredit)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </TableContainer>
          </DialogContent>
        </>
      )}
    </Dialog>
  );
}
