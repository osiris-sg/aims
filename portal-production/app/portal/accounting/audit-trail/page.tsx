"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
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
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import PrintIcon from "@mui/icons-material/Print";
import VisibilityIcon from "@mui/icons-material/Visibility";
import CloseIcon from "@mui/icons-material/Close";
import { toast } from "react-toastify";
import { useAccountingApi } from "../_lib/api";
import JournalEntryDialog from "../_lib/JournalEntryDialog";
import PageTable from "@/components/PageTable";

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
  const searchParams = useSearchParams();
  const router = useRouter();
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [selected, setSelected] = useState<JournalEntry | null>(null);
  const [newOpen, setNewOpen] = useState(false);

  // PageTable-driven state
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<any>({});

  // ?journalNumbers=JV-XERO-22533,JV-XERO-22619 — set by the Hub action queue
  // when it links into a specific subset (e.g. unpaid no-GST invoices).
  const pinnedJournalNumbers = useMemo(() => {
    const raw = searchParams?.get("journalNumbers");
    if (!raw) return null;
    const list = raw.split(",").map((s) => s.trim()).filter(Boolean);
    return list.length ? new Set(list) : null;
  }, [searchParams]);

  const clearPinned = () => router.push("/portal/accounting/audit-trail");

  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    if (typeFilter) p.set("type", typeFilter);
    if (statusFilter) p.set("status", statusFilter);
    if (startDate) p.set("startDate", startDate);
    if (endDate) p.set("endDate", endDate);
    p.set("limit", "200");
    return p.toString();
  }, [typeFilter, statusFilter, startDate, endDate]);

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
    let base = entries;
    if (pinnedJournalNumbers) {
      base = base.filter((e) => pinnedJournalNumbers.has(e.journalNumber));
    }
    const q = search.trim().toLowerCase();
    if (!q) return base;
    return base.filter(
      (e) =>
        e.journalNumber.toLowerCase().includes(q) ||
        (e.reference || "").toLowerCase().includes(q) ||
        (e.description || "").toLowerCase().includes(q) ||
        (e.type || "").toLowerCase().includes(q) ||
        (e.lines || []).some(
          (l) =>
            (l.account?.code || "").toLowerCase().includes(q) ||
            (l.account?.name || "").toLowerCase().includes(q) ||
            ((l as any).description || "").toLowerCase().includes(q),
        ),
    );
  }, [entries, search, pinnedJournalNumbers]);

  useEffect(() => { setPage(1); }, [search, typeFilter, statusFilter, startDate, endDate]);

  const pageCount = Math.max(1, Math.ceil(visible.length / limit));
  const paged = useMemo(
    () => visible.slice((page - 1) * limit, page * limit),
    [visible, page, limit],
  );

  const columns = useMemo(() => [
    {
      accessorKey: "journalNumber",
      header: "Entry #",
      cell: ({ row }: any) => <Box sx={{ fontFamily: "monospace" }}>{row.original.journalNumber}</Box>,
    },
    {
      accessorKey: "entryDate",
      header: "Date",
      cell: ({ row }: any) => new Date(row.original.entryDate).toLocaleDateString(),
    },
    { accessorKey: "type", header: "Type", cell: ({ row }: any) => row.original.type },
    { accessorKey: "reference", header: "Reference", cell: ({ row }: any) => row.original.reference || "" },
    {
      accessorKey: "description",
      header: "Description",
      cell: ({ row }: any) => (
        <Box sx={{ maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {row.original.description}
        </Box>
      ),
    },
    {
      accessorKey: "totalDebit",
      header: "Debit",
      cell: ({ row }: any) => (
        <Box sx={{ textAlign: "right", fontFamily: "monospace" }}>{fmt(row.original.totalDebit)}</Box>
      ),
    },
    {
      accessorKey: "totalCredit",
      header: "Credit",
      cell: ({ row }: any) => (
        <Box sx={{ textAlign: "right", fontFamily: "monospace" }}>{fmt(row.original.totalCredit)}</Box>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }: any) => (
        <Chip size="small" label={row.original.status} color={statusColor(row.original.status)} variant="outlined" />
      ),
    },
    {
      accessorKey: "actions",
      header: "Actions",
      cell: ({ row }: any) => {
        const e: JournalEntry = row.original;
        return (
          <Stack direction="row" gap={0.25} justifyContent="flex-end" alignItems="center">
            <Tooltip title="View lines">
              <IconButton size="small" onClick={() => setSelected(e)}>
                <VisibilityIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            {e.status === "DRAFT" && (
              <Button size="small" onClick={() => post(e.id)}>
                Post
              </Button>
            )}
            {e.status !== "VOID" && (
              <Button size="small" color="error" onClick={() => voidEntry(e.id)}>
                Void
              </Button>
            )}
          </Stack>
        );
      },
    },
  ], []);

  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2 }}>
      {pinnedJournalNumbers && (
        <Paper variant="outlined" sx={{ p: 1.5, bgcolor: (t) => t.palette.warning.light + "22", borderColor: "warning.main" }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" gap={2}>
            <Typography variant="body2">
              Filtered to <strong>{pinnedJournalNumbers.size}</strong> journal{pinnedJournalNumbers.size === 1 ? "" : "s"} from
              the Hub action queue: <code>{Array.from(pinnedJournalNumbers).join(", ")}</code>
            </Typography>
            <Button size="small" variant="outlined" onClick={clearPinned}>
              Clear filter
            </Button>
          </Stack>
        </Paper>
      )}

      <Paper variant="outlined" sx={{ p: 1.5 }}>
        <Stack direction="row" gap={2} flexWrap="wrap" alignItems="center">
          <TextField
            select
            size="small"
            label="Type"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
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
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
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
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
          <TextField
            size="small"
            type="date"
            label="To"
            InputLabelProps={{ shrink: true }}
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
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

      <PageTable
        columns={columns}
        data={paged}
        tableName="Audit Trail"
        subTitle="Chronological log of every journal entry — invoices, payments, manual vouchers, voids."
        buttonName="New Entry"
        onAddClick={() => setNewOpen(true)}
        loading={loading}
        page={page}
        limit={limit}
        search={search}
        filters={filters}
        setPage={setPage}
        setLimit={setLimit}
        setSearch={setSearch}
        setFilters={setFilters}
        pageCount={pageCount}
        totalDocs={visible.length}
      />

      <EntryDialog entry={selected} onClose={() => setSelected(null)} />
      <JournalEntryDialog open={newOpen} onClose={() => setNewOpen(false)} onCreated={load} />
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
