"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
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
  alpha,
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import LinkOffIcon from "@mui/icons-material/LinkOff";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import CloseIcon from "@mui/icons-material/Close";
import { toast } from "react-toastify";
import { useAccountingApi } from "../_lib/api";
import PageTable from "@/components/PageTable";

// ---------------------------------------------------------------------------
// Bank reconciliation workspace.
//
// Layout:
//   - Top: bank account selector + upload area (CSV or PDF)
//   - Imports list: lets user pick which past import to work on
//   - Reconciliation summary: bank ending vs GL balance vs pending
//   - Statement-line table: status per row (matched/pending/posted-new/ignored)
//     with inline actions (suggest+post, ignore, unmatch)
// ---------------------------------------------------------------------------

type Account = { id: string; code: string; name: string };
type ImportRow = {
  id: string;
  bankAccountId: string;
  source: string;
  filename?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  endingBalance?: number | null;
  _count?: { lines: number };
  createdAt: string;
};
type StatementLine = {
  id: string;
  date: string;
  description: string;
  reference?: string | null;
  amount: number;
  runningBalance?: number | null;
  status: "PENDING" | "MATCHED" | "POSTED_NEW" | "IGNORED";
  matchedJournalLineId?: string | null;
  suggestedAccountId?: string | null;
  suggestionConfidence?: number | null;
  suggestionReason?: string | null;
  postedJournalEntryId?: string | null;
  matchedJournalLine?: {
    id: string;
    debit: number;
    credit: number;
    journalEntry: { id: string; journalNumber: string; entryDate: string; type: string };
  } | null;
};
type ImportDetail = ImportRow & { lines: StatementLine[] };
type Recon = {
  bankEndingBalance: number | null;
  glBalance: number;
  matchedCount: number;
  postedNewCount: number;
  pendingCount: number;
  ignoredCount: number;
  matchedTotal: number;
  pendingTotal: number;
  reconciles: boolean | null;
  diff: number | null;
};

const fmt = (n: number) =>
  n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function BankReconciliationPage() {
  const { request } = useAccountingApi();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [bankAccountId, setBankAccountId] = useState<string | null>(null);
  const [imports, setImports] = useState<ImportRow[]>([]);
  const [activeImportId, setActiveImportId] = useState<string | null>(null);
  const [activeImport, setActiveImport] = useState<ImportDetail | null>(null);
  const [recon, setRecon] = useState<Recon | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [csvDialogOpen, setCsvDialogOpen] = useState(false);
  const [postDialogLine, setPostDialogLine] = useState<StatementLine | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // PageTable-driven state for the statement-line table
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<any>({});

  // Initial: load bank accounts
  useEffect(() => {
    (async () => {
      try {
        const list = await request("/bank-rec/accounts");
        setAccounts(list || []);
        if (list && list.length > 0 && !bankAccountId) {
          setBankAccountId(list[0].id);
        }
      } catch (e: any) {
        toast.error(e?.message || "Failed to load bank accounts");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When bank account changes, load imports
  const loadImports = useCallback(async () => {
    if (!bankAccountId) return;
    try {
      const list = await request(`/bank-rec/imports?bankAccountId=${bankAccountId}`);
      setImports(list || []);
      if (!activeImportId && list && list.length > 0) {
        setActiveImportId(list[0].id);
      }
    } catch (e: any) {
      toast.error(e?.message || "Failed to load imports");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bankAccountId]);

  useEffect(() => {
    loadImports();
  }, [loadImports]);

  // Load active import detail + reconciliation
  const loadActive = useCallback(async () => {
    if (!activeImportId) {
      setActiveImport(null);
      setRecon(null);
      return;
    }
    setLoading(true);
    try {
      const [imp, r] = await Promise.all([
        request(`/bank-rec/imports/${activeImportId}`),
        request(`/bank-rec/imports/${activeImportId}/reconciliation`),
      ]);
      setActiveImport(imp);
      setRecon(r);
    } catch (e: any) {
      toast.error(e?.message || "Failed to load import");
    } finally {
      setLoading(false);
    }
  }, [activeImportId, request]);

  useEffect(() => {
    loadActive();
  }, [loadActive]);

  // ---------- Upload handlers ----------
  const onPdfUpload = async (file: File) => {
    if (!bankAccountId) return toast.error("Pick a bank account first");
    setUploading(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result as string);
        r.onerror = reject;
        r.readAsDataURL(file);
      });
      const imp = await request("/bank-rec/imports/pdf", {
        method: "POST",
        body: JSON.stringify({
          bankAccountId,
          base64,
          mediaType: file.type,
          filename: file.name,
        }),
      });
      toast.success("Statement imported + auto-matched");
      setActiveImportId(imp.id);
      loadImports();
    } catch (e: any) {
      toast.error(e?.message || "Import failed");
    } finally {
      setUploading(false);
    }
  };

  const runAutoMatch = async () => {
    if (!activeImportId) return;
    try {
      const r = await request(
        `/bank-rec/imports/${activeImportId}/auto-match`,
        { method: "POST" },
      );
      toast.success(`Auto-matched ${r.matchedCount} line(s)`);
      loadActive();
    } catch (e: any) {
      toast.error(e?.message || "Auto-match failed");
    }
  };

  const deleteImport = async () => {
    if (!activeImportId) return;
    if (!confirm("Delete this import? Statement lines are removed (posted-new JEs stay).")) return;
    try {
      await request(`/bank-rec/imports/${activeImportId}`, { method: "DELETE" });
      toast.success("Deleted");
      setActiveImportId(null);
      setActiveImport(null);
      loadImports();
    } catch (e: any) {
      toast.error(e?.message || "Delete failed");
    }
  };

  const ignoreLine = async (line: StatementLine) => {
    try {
      await request(`/bank-rec/lines/${line.id}/ignore`, { method: "POST" });
      loadActive();
    } catch (e: any) {
      toast.error(e?.message || "Failed");
    }
  };
  const unmatchLine = async (line: StatementLine) => {
    try {
      await request(`/bank-rec/lines/${line.id}/unmatch`, { method: "POST" });
      loadActive();
    } catch (e: any) {
      toast.error(e?.message || "Failed");
    }
  };

  const visibleLines = activeImport?.lines || [];
  const counts = useMemo(() => {
    const c = { all: visibleLines.length, PENDING: 0, MATCHED: 0, POSTED_NEW: 0, IGNORED: 0 };
    for (const l of visibleLines) (c as any)[l.status] = ((c as any)[l.status] ?? 0) + 1;
    return c;
  }, [visibleLines]);

  // Apply search to lines before paging.
  const visibleFiltered = useMemo(() => {
    const q = (search || "").trim().toLowerCase();
    if (!q) return visibleLines;
    return visibleLines.filter(
      (l) =>
        (l.description || "").toLowerCase().includes(q) ||
        (l.reference || "").toLowerCase().includes(q),
    );
  }, [visibleLines, search]);

  useEffect(() => { setPage(1); }, [search, activeImportId]);

  const pageCount = Math.max(1, Math.ceil(visibleFiltered.length / limit));
  const pagedLines = useMemo(
    () => visibleFiltered.slice((page - 1) * limit, page * limit),
    [visibleFiltered, page, limit],
  );

  const lineColumns = useMemo(() => [
    {
      accessorKey: "date",
      header: "Date",
      cell: ({ row }: any) => (
        <Box sx={{ fontSize: "0.8125rem" }}>{new Date(row.original.date).toLocaleDateString()}</Box>
      ),
    },
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
      accessorKey: "reference",
      header: "Reference",
      cell: ({ row }: any) => (
        <Box sx={{ fontSize: "0.8125rem", color: "text.secondary" }}>{row.original.reference || "—"}</Box>
      ),
    },
    {
      accessorKey: "amount",
      header: "Amount",
      cell: ({ row }: any) => {
        const dir = row.original.amount > 0 ? "in" : "out";
        const amtColor = dir === "in" ? "success.main" : "error.main";
        return (
          <Box sx={{ textAlign: "right", fontFamily: "monospace", fontWeight: 600, color: amtColor }}>
            {dir === "in" ? "+" : "−"} {fmt(Math.abs(row.original.amount))}
          </Box>
        );
      },
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }: any) => (
        <Chip
          size="small"
          variant="outlined"
          label={row.original.status.replace("_", " ")}
          color={
            row.original.status === "MATCHED"
              ? "success"
              : row.original.status === "POSTED_NEW"
              ? "info"
              : row.original.status === "IGNORED"
              ? "default"
              : "warning"
          }
          sx={{ fontSize: "0.7rem" }}
        />
      ),
    },
    {
      accessorKey: "match",
      header: "Match / Suggestion",
      cell: ({ row }: any) => {
        const line: StatementLine = row.original;
        return (
          <Box sx={{ fontSize: "0.8125rem" }}>
            {line.matchedJournalLine && (
              <Box sx={{ color: "text.secondary" }}>
                <Box component="span" sx={{ fontFamily: "monospace", fontWeight: 600 }}>
                  {line.matchedJournalLine.journalEntry.journalNumber}
                </Box>
                {" · "}
                {new Date(line.matchedJournalLine.journalEntry.entryDate).toLocaleDateString()}
              </Box>
            )}
            {line.status === "PENDING" && line.suggestionReason && (
              <Tooltip title={line.suggestionReason}>
                <Chip
                  size="small"
                  label={`Suggest: ${(line.suggestionConfidence ?? 0) * 100 | 0}%`}
                  variant="outlined"
                  color="info"
                  sx={{ fontSize: "0.65rem", height: 18 }}
                />
              </Tooltip>
            )}
          </Box>
        );
      },
    },
    {
      accessorKey: "actions",
      header: "Actions",
      cell: ({ row }: any) => {
        const line: StatementLine = row.original;
        const isMatched = line.status === "MATCHED" || line.status === "POSTED_NEW";
        return (
          <Stack direction="row" gap={0.25} justifyContent="flex-end">
            {line.status === "PENDING" && (
              <>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => setPostDialogLine(line)}
                  sx={{ mr: 0.5, textTransform: "none", fontSize: "0.7rem", py: 0.25 }}
                >
                  Post as new
                </Button>
                <Tooltip title="Ignore (e.g. duplicate, opening balance)">
                  <IconButton size="small" onClick={() => ignoreLine(line)}>
                    <VisibilityOffIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </>
            )}
            {isMatched && (
              <Tooltip title="Unmatch">
                <IconButton size="small" onClick={() => unmatchLine(line)}>
                  <LinkOffIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
          </Stack>
        );
      },
    },
  ], []);

  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2 }}>
      <Box>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          Bank Reconciliation
        </Typography>
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          Import a CSV or PDF bank statement, match against posted journal entries, post new entries for charges and interest.
        </Typography>
      </Box>

      {/* Account picker + upload */}
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction="row" gap={2} alignItems="center" flexWrap="wrap">
          <TextField
            select
            size="small"
            label="Bank account"
            value={bankAccountId || ""}
            onChange={(e) => {
              setBankAccountId(e.target.value || null);
              setActiveImportId(null);
            }}
            sx={{ minWidth: 280 }}
          >
            {accounts.length === 0 && <MenuItem disabled>No bank accounts in chart</MenuItem>}
            {accounts.map((a) => (
              <MenuItem key={a.id} value={a.id}>
                {a.code} — {a.name}
              </MenuItem>
            ))}
          </TextField>

          <Box sx={{ flex: 1 }} />

          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onPdfUpload(f);
              e.target.value = "";
            }}
          />
          <Button
            startIcon={uploading ? <CircularProgress size={14} /> : <AutoAwesomeIcon />}
            variant="contained"
            size="small"
            disabled={!bankAccountId || uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? "Extracting..." : "Upload PDF statement"}
          </Button>
          <Button
            startIcon={<UploadFileIcon />}
            variant="outlined"
            size="small"
            disabled={!bankAccountId}
            onClick={() => setCsvDialogOpen(true)}
          >
            Import CSV
          </Button>
        </Stack>
      </Paper>

      {/* Imports list */}
      {bankAccountId && (
        <Paper variant="outlined" sx={{ p: 1.5 }}>
          <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap">
            <Typography variant="overline" sx={{ fontWeight: 700, mr: 1 }}>
              Imports
            </Typography>
            {imports.length === 0 && (
              <Typography variant="body2" sx={{ color: "text.secondary" }}>
                None yet — upload a statement above.
              </Typography>
            )}
            {imports.map((i) => (
              <Chip
                key={i.id}
                label={`${i.source} · ${i.periodStart ? new Date(i.periodStart).toLocaleDateString() : "—"} → ${
                  i.periodEnd ? new Date(i.periodEnd).toLocaleDateString() : "—"
                } · ${i._count?.lines ?? "?"} lines`}
                onClick={() => setActiveImportId(i.id)}
                variant={i.id === activeImportId ? "filled" : "outlined"}
                color={i.id === activeImportId ? "primary" : "default"}
                sx={{ cursor: "pointer" }}
              />
            ))}
          </Stack>
        </Paper>
      )}

      {/* Reconciliation summary */}
      {recon && activeImport && (
        <Stack direction="row" gap={2} flexWrap="wrap">
          <Stat label="Bank ending" value={recon.bankEndingBalance !== null ? fmt(recon.bankEndingBalance) : "—"} />
          <Stat label="GL balance" value={fmt(recon.glBalance)} />
          <Stat
            label="Pending"
            value={fmt(recon.pendingTotal)}
            accent={recon.pendingCount > 0 ? "warning" : undefined}
          />
          <Stat
            label="Reconciles?"
            value={
              recon.reconciles === null
                ? "n/a (no ending balance)"
                : recon.reconciles
                ? "✓"
                : `Diff ${fmt(recon.diff || 0)}`
            }
            accent={recon.reconciles === true ? "success" : recon.reconciles === false ? "error" : undefined}
          />
          <Box sx={{ flex: 1 }} />
          <Button startIcon={<RefreshIcon />} variant="outlined" size="small" onClick={runAutoMatch}>
            Re-run match
          </Button>
          <Button startIcon={<DeleteOutlineIcon />} variant="outlined" size="small" color="error" onClick={deleteImport}>
            Delete import
          </Button>
        </Stack>
      )}

      {/* Status chip strip */}
      {activeImport && (
        <Stack direction="row" gap={1}>
          <Chip size="small" variant="outlined" label={`All ${counts.all}`} />
          <Chip size="small" variant="outlined" color="warning" label={`Pending ${counts.PENDING}`} />
          <Chip size="small" variant="outlined" color="success" label={`Matched ${counts.MATCHED}`} />
          <Chip size="small" variant="outlined" color="info" label={`Posted-new ${counts.POSTED_NEW}`} />
          <Chip size="small" variant="outlined" label={`Ignored ${counts.IGNORED}`} />
        </Stack>
      )}

      {/* Statement-line table */}
      {activeImport && (
        <PageTable
          columns={lineColumns}
          data={pagedLines}
          tableName="Statement lines"
          subTitle="Match against posted journal entries, or post new entries for charges and interest."
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
          totalDocs={visibleFiltered.length}
        />
      )}

      <CsvImportDialog
        open={csvDialogOpen}
        bankAccountId={bankAccountId}
        onClose={() => setCsvDialogOpen(false)}
        onImported={(impId) => {
          setCsvDialogOpen(false);
          setActiveImportId(impId);
          loadImports();
        }}
      />

      <PostAsNewDialog
        open={!!postDialogLine}
        line={postDialogLine}
        accounts={accounts}
        request={request}
        onClose={() => setPostDialogLine(null)}
        onPosted={() => {
          setPostDialogLine(null);
          loadActive();
        }}
      />
    </Box>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "success" | "warning" | "error";
}) {
  return (
    <Paper
      variant="outlined"
      sx={{
        p: 1.5,
        minWidth: 180,
        borderLeft: accent ? 3 : 0,
        borderLeftColor: accent ? `${accent}.main` : undefined,
      }}
    >
      <Typography
        variant="caption"
        sx={{ color: "text.secondary", textTransform: "uppercase", fontWeight: 700, fontSize: "0.65rem" }}
      >
        {label}
      </Typography>
      <Typography sx={{ fontFamily: "monospace", fontWeight: 700, fontSize: "1.125rem", mt: 0.25 }}>{value}</Typography>
    </Paper>
  );
}

function CsvImportDialog({
  open,
  bankAccountId,
  onClose,
  onImported,
}: {
  open: boolean;
  bankAccountId: string | null;
  onClose: () => void;
  onImported: (importId: string) => void;
}) {
  const { request } = useAccountingApi();
  const [csv, setCsv] = useState("");
  const [skipRows, setSkipRows] = useState(1);
  const [delimiter, setDelimiter] = useState(",");
  const [dateCol, setDateCol] = useState(0);
  const [descCol, setDescCol] = useState(1);
  const [signedAmountCol, setSignedAmountCol] = useState<number | "">("");
  const [debitCol, setDebitCol] = useState<number | "">("");
  const [creditCol, setCreditCol] = useState<number | "">("");
  const [referenceCol, setReferenceCol] = useState<number | "">("");
  const [balanceCol, setBalanceCol] = useState<number | "">("");
  const [filename, setFilename] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setCsv("");
      setSkipRows(1);
      setDelimiter(",");
      setDateCol(0);
      setDescCol(1);
      setSignedAmountCol("");
      setDebitCol("");
      setCreditCol("");
      setReferenceCol("");
      setBalanceCol("");
      setFilename("");
    }
  }, [open]);

  const onFile = async (file: File) => {
    setFilename(file.name);
    const text = await file.text();
    setCsv(text);
  };

  const submit = async () => {
    if (!bankAccountId) return toast.error("Pick a bank account");
    if (!csv.trim()) return toast.error("Paste or upload CSV first");
    if (signedAmountCol === "" && debitCol === "" && creditCol === "") {
      return toast.error("Pick either Signed Amount, or Debit + Credit columns");
    }
    setBusy(true);
    try {
      const mapping: any = {
        date: dateCol,
        description: descCol,
        skipRows,
        delimiter,
      };
      if (signedAmountCol !== "") mapping.amount = signedAmountCol;
      if (debitCol !== "") mapping.debit = debitCol;
      if (creditCol !== "") mapping.credit = creditCol;
      if (referenceCol !== "") mapping.reference = referenceCol;
      if (balanceCol !== "") mapping.balance = balanceCol;

      const imp = await request("/bank-rec/imports/csv", {
        method: "POST",
        body: JSON.stringify({ bankAccountId, csv, mapping, filename }),
      });
      toast.success("CSV imported + auto-matched");
      onImported(imp.id);
    } catch (e: any) {
      toast.error(e?.message || "Import failed");
    } finally {
      setBusy(false);
    }
  };

  // Preview first few rows to help with column index picking
  const preview = csv
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0)
    .slice(0, 4);

  return (
    <Dialog open={open} onClose={() => !busy && onClose()} fullWidth maxWidth="md">
      <DialogTitle>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Typography variant="h6" sx={{ fontWeight: 700 }}>Import CSV statement</Typography>
          <IconButton size="small" onClick={onClose} disabled={busy}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Stack>
      </DialogTitle>
      <DialogContent dividers>
        <Stack gap={2}>
          <Box>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onFile(f);
              }}
            />
            {filename && <Typography variant="caption" sx={{ ml: 1 }}>{filename}</Typography>}
          </Box>
          <TextField
            label="CSV content (auto-filled from file)"
            multiline
            minRows={4}
            maxRows={8}
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            disabled={busy}
            inputProps={{ style: { fontFamily: "monospace", fontSize: "0.75rem" } }}
          />
          {preview.length > 0 && (
            <Box>
              <Typography variant="caption" sx={{ color: "text.secondary" }}>Preview (column indexes):</Typography>
              <Box sx={{ overflowX: "auto", border: 1, borderColor: "divider", borderRadius: 1, p: 1 }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      {(preview[0]?.split(delimiter) || []).map((_, i) => (
                        <TableCell key={i} sx={{ fontSize: "0.65rem", color: "text.secondary" }}>
                          [{i}]
                        </TableCell>
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {preview.map((row, r) => (
                      <TableRow key={r}>
                        {row.split(delimiter).map((cell, c) => (
                          <TableCell key={c} sx={{ fontSize: "0.7rem", fontFamily: "monospace" }}>
                            {cell.trim()}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            </Box>
          )}
          <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 1.5 }}>
            <TextField label="Skip header rows" type="number" size="small" value={skipRows} onChange={(e) => setSkipRows(parseInt(e.target.value) || 0)} disabled={busy} />
            <TextField label="Delimiter" size="small" value={delimiter} onChange={(e) => setDelimiter(e.target.value)} disabled={busy} />
            <TextField label="Date col #" type="number" size="small" value={dateCol} onChange={(e) => setDateCol(parseInt(e.target.value) || 0)} disabled={busy} />
            <TextField label="Description col #" type="number" size="small" value={descCol} onChange={(e) => setDescCol(parseInt(e.target.value) || 0)} disabled={busy} />
            <TextField
              label="Signed Amount col # (use this OR debit+credit)"
              type="number"
              size="small"
              value={signedAmountCol}
              onChange={(e) => setSignedAmountCol(e.target.value === "" ? "" : parseInt(e.target.value) || 0)}
              disabled={busy}
              sx={{ gridColumn: "span 2" }}
            />
            <TextField label="Debit col #" type="number" size="small" value={debitCol} onChange={(e) => setDebitCol(e.target.value === "" ? "" : parseInt(e.target.value) || 0)} disabled={busy} />
            <TextField label="Credit col #" type="number" size="small" value={creditCol} onChange={(e) => setCreditCol(e.target.value === "" ? "" : parseInt(e.target.value) || 0)} disabled={busy} />
            <TextField label="Reference col # (optional)" type="number" size="small" value={referenceCol} onChange={(e) => setReferenceCol(e.target.value === "" ? "" : parseInt(e.target.value) || 0)} disabled={busy} />
            <TextField label="Balance col # (optional)" type="number" size="small" value={balanceCol} onChange={(e) => setBalanceCol(e.target.value === "" ? "" : parseInt(e.target.value) || 0)} disabled={busy} />
          </Box>
          <Alert severity="info" sx={{ fontSize: "0.8125rem" }}>
            Mapping is per-import. Convention: <strong>credit (money in) is positive</strong>, debit is negative. If your bank
            gives you debit and credit in separate columns, leave Signed Amount blank.
          </Alert>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button
          variant="contained"
          onClick={submit}
          disabled={busy}
          startIcon={busy ? <CircularProgress size={14} color="inherit" /> : undefined}
        >
          Import + auto-match
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function PostAsNewDialog({
  open,
  line,
  accounts: _accounts,
  request,
  onClose,
  onPosted,
}: {
  open: boolean;
  line: StatementLine | null;
  accounts: Account[];
  request: any;
  onClose: () => void;
  onPosted: () => void;
}) {
  const [contraAccountId, setContraAccountId] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestion, setSuggestion] = useState<{
    accountId: string;
    code: string;
    name: string;
    confidence: number;
    reason: string;
  } | null>(null);
  const [pnlAccounts, setPnlAccounts] = useState<any[]>([]);

  useEffect(() => {
    if (!open || !line) return;
    setContraAccountId(line.suggestedAccountId ?? null);
    setDescription(line.description);
    setSuggestion(null);

    // Load P&L accounts for the contra picker.
    (async () => {
      try {
        const list = await request("/accounting/accounts");
        const all = Array.isArray(list) ? list : [];
        setPnlAccounts(all.filter((a: any) => a.isActive).sort((a: any, b: any) => a.code.localeCompare(b.code)));
      } catch {
        // best-effort
      }
    })();
  }, [open, line, request]);

  const askSuggestion = async () => {
    if (!line) return;
    setSuggesting(true);
    try {
      const r = await request(`/bank-rec/lines/${line.id}/suggest`, { method: "POST" });
      setSuggestion(r.suggestion);
      if (r.suggestion?.accountId) setContraAccountId(r.suggestion.accountId);
    } catch (e: any) {
      toast.error(e?.message || "Suggestion failed");
    } finally {
      setSuggesting(false);
    }
  };

  const submit = async () => {
    if (!line) return;
    if (!contraAccountId) return toast.error("Pick a contra account");
    setBusy(true);
    try {
      await request(`/bank-rec/lines/${line.id}/post`, {
        method: "POST",
        body: JSON.stringify({ contraAccountId, description }),
      });
      toast.success("Posted + matched");
      onPosted();
    } catch (e: any) {
      toast.error(e?.message || "Post failed");
    } finally {
      setBusy(false);
    }
  };

  if (!line) return null;
  const dir = line.amount > 0 ? "money IN" : "money OUT";

  return (
    <Dialog open={open} onClose={() => !busy && onClose()} fullWidth maxWidth="sm">
      <DialogTitle>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Typography variant="h6" sx={{ fontWeight: 700 }}>Post bank line as new entry</Typography>
          <IconButton size="small" onClick={onClose} disabled={busy}><CloseIcon fontSize="small" /></IconButton>
        </Stack>
      </DialogTitle>
      <DialogContent dividers>
        <Stack gap={2}>
          <Alert severity={line.amount > 0 ? "success" : "warning"} sx={{ fontSize: "0.8125rem" }}>
            <strong>{dir}:</strong> {fmt(Math.abs(line.amount))} on{" "}
            {new Date(line.date).toLocaleDateString()} — {line.description}
          </Alert>

          <Stack direction="row" gap={1} alignItems="center">
            <Autocomplete
              fullWidth
              size="small"
              options={pnlAccounts}
              value={pnlAccounts.find((a) => a.id === contraAccountId) || null}
              onChange={(_, v) => setContraAccountId(v?.id || null)}
              getOptionLabel={(o: any) => `${o.code} — ${o.name}`}
              renderInput={(params) => <TextField {...params} label="Categorize as (contra account)" required disabled={busy} />}
            />
            <Tooltip title="LLM suggests the best fit">
              <span>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={askSuggestion}
                  disabled={suggesting || busy}
                  startIcon={suggesting ? <CircularProgress size={14} /> : <AutoAwesomeIcon />}
                >
                  Suggest
                </Button>
              </span>
            </Tooltip>
          </Stack>

          {suggestion && (
            <Box
              sx={{
                p: 1.25,
                borderRadius: 1,
                bgcolor: (t) => alpha(t.palette.info.main, 0.06),
                borderLeft: 3,
                borderColor: "info.main",
              }}
            >
              <Typography variant="body2">
                <strong>{suggestion.code} {suggestion.name}</strong> ({((suggestion.confidence ?? 0) * 100).toFixed(0)}% confident)
              </Typography>
              {suggestion.reason && (
                <Typography variant="caption" sx={{ color: "text.secondary" }}>{suggestion.reason}</Typography>
              )}
            </Box>
          )}

          <TextField
            label="Description"
            size="small"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={busy}
          />

          <Alert severity="info" sx={{ fontSize: "0.75rem" }}>
            Will post: {line.amount > 0 ? "Dr Bank / Cr selected account" : "Dr selected account / Cr Bank"} ({fmt(Math.abs(line.amount))}).
          </Alert>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button
          variant="contained"
          onClick={submit}
          disabled={busy || !contraAccountId}
          startIcon={busy ? <CircularProgress size={14} color="inherit" /> : undefined}
        >
          Post + match
        </Button>
      </DialogActions>
    </Dialog>
  );
}
