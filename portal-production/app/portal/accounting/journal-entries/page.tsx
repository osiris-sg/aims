"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
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
  Dialog,
  DialogContent,
  DialogTitle,
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import VisibilityIcon from "@mui/icons-material/Visibility";
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
  sourceDocumentId?: string | null;
  sourcePaymentId?: string | null;
  postedAt?: string | null;
  lines: JournalLine[];
};

const TYPES = ["", "MANUAL", "INVOICE", "PAYMENT", "CREDIT_NOTE", "DEBIT_NOTE", "OPENING_BALANCE", "ADJUSTMENT"];
const STATUSES = ["", "DRAFT", "POSTED", "VOID"];

function statusColor(s: string): "default" | "primary" | "success" | "error" {
  if (s === "POSTED") return "success";
  if (s === "DRAFT") return "primary";
  if (s === "VOID") return "error";
  return "default";
}

export default function JournalEntriesPage() {
  const { request } = useAccountingApi();
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({ type: "", status: "", startDate: "", endDate: "" });
  const [selected, setSelected] = useState<JournalEntry | null>(null);

  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    if (filters.type) p.set("type", filters.type);
    if (filters.status) p.set("status", filters.status);
    if (filters.startDate) p.set("startDate", filters.startDate);
    if (filters.endDate) p.set("endDate", filters.endDate);
    p.set("limit", "100");
    return p.toString();
  }, [filters]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await request<{ items: JournalEntry[]; total: number }>(`/journal/entries?${queryString}`);
      setEntries(res.items || []);
    } catch (e: any) {
      toast.error(e?.message || "Failed to load journal entries");
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

  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>
            Journal Entries
          </Typography>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            Every posted invoice and payment writes a balanced entry here. Manual journal vouchers can be created from the API.
          </Typography>
        </Box>
        <Button startIcon={<RefreshIcon />} onClick={load} variant="outlined">
          Refresh
        </Button>
      </Stack>
      <Divider />

      <Paper sx={{ p: 2 }}>
        <Stack direction="row" gap={2} flexWrap="wrap">
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
        </Stack>
      </Paper>

      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 600 }}>Entry #</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Date</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Type</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Reference</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Description</TableCell>
              <TableCell align="right" sx={{ fontWeight: 600 }}>Debit</TableCell>
              <TableCell align="right" sx={{ fontWeight: 600 }}>Credit</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
              <TableCell align="right" sx={{ fontWeight: 600 }}>Actions</TableCell>
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
            {!loading && entries.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} align="center" sx={{ py: 4, color: "text.secondary" }}>
                  No journal entries yet — confirm an invoice or record a payment to populate the ledger.
                </TableCell>
              </TableRow>
            )}
            {entries.map((e) => (
              <TableRow key={e.id} hover>
                <TableCell sx={{ fontFamily: "monospace" }}>{e.journalNumber}</TableCell>
                <TableCell>{new Date(e.entryDate).toLocaleDateString()}</TableCell>
                <TableCell>{e.type}</TableCell>
                <TableCell>{e.reference}</TableCell>
                <TableCell sx={{ maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {e.description}
                </TableCell>
                <TableCell align="right">{e.totalDebit.toFixed(2)}</TableCell>
                <TableCell align="right">{e.totalCredit.toFixed(2)}</TableCell>
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
            {entry.journalNumber}
            <Chip size="small" label={entry.status} color={statusColor(entry.status)} sx={{ ml: 2 }} />
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
                        <Box>
                          <Typography component="span" sx={{ fontFamily: "monospace", fontWeight: 600 }}>
                            {l.account.code}
                          </Typography>{" "}
                          <Typography component="span">{l.account.name}</Typography>
                        </Box>
                      </TableCell>
                      <TableCell>{l.description}</TableCell>
                      <TableCell align="right">{l.debit ? l.debit.toFixed(2) : ""}</TableCell>
                      <TableCell align="right">{l.credit ? l.credit.toFixed(2) : ""}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell colSpan={3} align="right" sx={{ fontWeight: 700 }}>
                      Totals
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700 }}>{entry.totalDebit.toFixed(2)}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700 }}>{entry.totalCredit.toFixed(2)}</TableCell>
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
