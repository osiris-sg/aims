"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Autocomplete,
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
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
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
  // PDF extraction runs in the background: PROCESSING → READY | FAILED.
  status?: string;
  error?: string | null;
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
  status: "PENDING" | "MATCHED" | "POSTED_NEW" | "IGNORED" | "SUGGESTED";
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
  // "Reconciled transaction details" — what a matched line reconciled to.
  const [detail, setDetail] = useState<any | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  // Manual match picker — rich candidates (ref / contact / amount).
  const [matchLine, setMatchLine] = useState<StatementLine | null>(null);
  const [candidates, setCandidates] = useState<any[] | null>(null);
  const [candSearch, setCandSearch] = useState("");
  const [candLoading, setCandLoading] = useState(false);
  // Batch payments: one statement line can settle several journal lines.
  const [candSelected, setCandSelected] = useState<Set<string>>(new Set());
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

  // Background PDF extraction: poll the imports list while any is PROCESSING,
  // and pull in the fresh lines when the active one flips READY / FAILED.
  const processingIds = imports.filter((i) => i.status === "PROCESSING").map((i) => i.id).join(",");
  useEffect(() => {
    if (!processingIds) return;
    const t = setInterval(async () => {
      if (!bankAccountId) return;
      try {
        const list: ImportRow[] = (await request(`/bank-rec/imports?bankAccountId=${bankAccountId}`)) || [];
        setImports(list);
        for (const id of processingIds.split(",")) {
          const now = list.find((x) => x.id === id);
          if (now && now.status !== "PROCESSING") {
            if (now.status === "FAILED") toast.error(`Statement extraction failed: ${now.error || "unknown error"}`);
            else toast.success(`Statement ready — ${now._count?.lines ?? 0} lines extracted + auto-matched`);
            if (activeImportId === id) loadActive();
          }
        }
      } catch {
        /* transient poll failure — keep polling */
      }
    }, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processingIds, bankAccountId]);

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
      toast.success("Extracting in the background — safe to leave or refresh; the import appears below when ready");
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
  const openDetail = async (line: StatementLine) => {
    setDetailLoading(true);
    setDetail({ line }); // open immediately with a spinner
    try {
      const d = await request(`/bank-rec/lines/${line.id}/detail`);
      setDetail(d);
    } catch (e: any) {
      toast.error(e?.message || "Failed to load match details");
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const loadCandidates = useCallback(
    async (line: StatementLine, term: string) => {
      setCandLoading(true);
      try {
        const r = await request(`/bank-rec/lines/${line.id}/candidates${term ? `?search=${encodeURIComponent(term)}` : ""}`);
        setCandidates(r?.candidates || []);
      } catch (e: any) {
        toast.error(e?.message || "Failed to load candidates");
        setCandidates([]);
      } finally {
        setCandLoading(false);
      }
    },
    [request],
  );

  const openMatchPicker = (line: StatementLine) => {
    setMatchLine(line);
    setCandidates(null);
    setCandSearch("");
    setCandSelected(new Set());
    void loadCandidates(line, "");
  };

  const commitMatch = async (journalLineIds: string[]) => {
    if (!matchLine || journalLineIds.length === 0) return;
    try {
      await request(`/bank-rec/lines/${matchLine.id}/match`, {
        method: "POST",
        body: JSON.stringify({ journalLineIds }),
      });
      toast.success(journalLineIds.length > 1 ? `Matched to ${journalLineIds.length} journals (batch)` : "Matched");
      setMatchLine(null);
      loadActive();
    } catch (e: any) {
      toast.error(e?.message || "Match failed");
    }
  };

  const toggleCandidate = (id: string) => {
    setCandSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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
    const c = { all: visibleLines.length, PENDING: 0, MATCHED: 0, POSTED_NEW: 0, IGNORED: 0, SUGGESTED: 0 };
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
          <Box sx={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600, color: amtColor }}>
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
          label={row.original.status === "SUGGESTED" ? "SUGGESTED (AI)" : row.original.status.replace("_", " ")}
          color={
            row.original.status === "MATCHED"
              ? "success"
              : row.original.status === "SUGGESTED"
              ? "info"
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
        // Paid-vs-bank drift in days — the accountant's first sanity check.
        const drift = (jeDate: string | Date) => {
          const d = Math.round((new Date(jeDate).getTime() - new Date(line.date).getTime()) / 86400000);
          return d === 0 ? "same day" : d > 0 ? `+${d}d` : `${d}d`;
        };
        const multi: any[] = (line as any).matchedJournalLines || [];
        return (
          <Box sx={{ fontSize: "0.8125rem" }}>
            {multi.length > 1 ? (
              <Box sx={{ color: "text.secondary" }}>
                <Box component="span" sx={{ fontWeight: 700 }}>
                  {multi.length} journals (batch)
                </Box>
                {" · paid "}
                {(() => {
                  const ds = multi.map((m: any) => new Date(m.journalEntry.entryDate).getTime());
                  const lo = new Date(Math.min(...ds)).toLocaleDateString("en-GB");
                  const hi = new Date(Math.max(...ds)).toLocaleDateString("en-GB");
                  return lo === hi ? `${lo} (${drift(new Date(Math.min(...ds)))})` : `${lo} – ${hi}`;
                })()}
              </Box>
            ) : line.matchedJournalLine ? (
              <Box sx={{ color: "text.secondary" }}>
                <Box component="span" sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                  {line.matchedJournalLine.journalEntry.journalNumber}
                </Box>
                {" · paid "}
                {new Date(line.matchedJournalLine.journalEntry.entryDate).toLocaleDateString("en-GB")}
                {` (${drift(line.matchedJournalLine.journalEntry.entryDate)})`}
              </Box>
            ) : null}
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
        const isSuggested = line.status === "SUGGESTED";
        return (
          <Stack direction="row" gap={0.25} justifyContent="flex-end">
            {isSuggested && (
              <>
                <Button
                  size="small"
                  variant="contained"
                  color="success"
                  sx={{ mr: 0.5, textTransform: "none", fontSize: "0.7rem", py: 0.25 }}
                  onClick={async () => {
                    try {
                      await request(`/bank-rec/lines/${line.id}/confirm`, { method: "POST" });
                      toast.success("Match confirmed");
                      loadActive();
                    } catch (e: any) {
                      toast.error(e?.message || "Confirm failed");
                    }
                  }}
                >
                  Confirm
                </Button>
                <Tooltip title="Reconciliation details — verify before confirming">
                  <IconButton size="small" onClick={() => openDetail(line)}>
                    <VisibilityOutlinedIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Reject suggestion (back to pending)">
                  <IconButton size="small" onClick={() => unmatchLine(line)}>
                    <LinkOffIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </>
            )}
            {line.status === "PENDING" && (
              <>
                <Button
                  size="small"
                  variant="contained"
                  onClick={() => openMatchPicker(line)}
                  sx={{ mr: 0.5, textTransform: "none", fontSize: "0.7rem", py: 0.25 }}
                >
                  Match
                </Button>
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
              <>
                <Tooltip title="Reconciliation details — what this matched to">
                  <IconButton size="small" onClick={() => openDetail(line)}>
                    <VisibilityOutlinedIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Unmatch">
                  <IconButton size="small" onClick={() => unmatchLine(line)}>
                    <LinkOffIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </>
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
            data-tour="bankrec-upload"
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
                icon={i.status === "PROCESSING" ? <CircularProgress size={12} sx={{ ml: 0.5 }} /> : undefined}
                label={
                  i.status === "PROCESSING"
                    ? `${i.source} · ${i.filename || "statement"} — extracting…`
                    : i.status === "FAILED"
                    ? `${i.source} · ${i.filename || "statement"} — FAILED`
                    : `${i.source} · ${i.periodStart ? new Date(i.periodStart).toLocaleDateString() : "—"} → ${
                        i.periodEnd ? new Date(i.periodEnd).toLocaleDateString() : "—"
                      } · ${i._count?.lines ?? "?"} lines`
                }
                onClick={() => {
                  if (i.status === "FAILED") toast.error(i.error || "Extraction failed — delete this import and re-upload");
                  setActiveImportId(i.id);
                }}
                variant={i.id === activeImportId ? "filled" : "outlined"}
                color={i.status === "FAILED" ? "error" : i.id === activeImportId ? "primary" : "default"}
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
          <Chip size="small" variant="outlined" color="info" label={`Suggested ${(counts as any).SUGGESTED}`} />
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

      {/* Manual match picker (guru 2026-08-03): candidates shown with the
          info an accountant matches by — reference (REC/P/V), contact,
          document, amount, date — ranked exact-amount-first. */}
      <Dialog open={!!matchLine} onClose={() => setMatchLine(null)} fullWidth maxWidth="lg">
        <DialogTitle sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Box>
            Find match
            {matchLine && (
              <Typography variant="body2" sx={{ color: "text.secondary" }}>
                {new Date(matchLine.date).toLocaleDateString("en-GB")} · {matchLine.description?.slice(0, 80)} ·{" "}
                <Box component="span" sx={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                  {matchLine.amount > 0 ? "+" : "−"} {fmt(Math.abs(matchLine.amount))}
                </Box>
              </Typography>
            )}
          </Box>
          <IconButton size="small" onClick={() => setMatchLine(null)}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          <TextField
            size="small"
            fullWidth
            placeholder="Search by reference, contact, document number or amount… (searches all dates)"
            value={candSearch}
            onChange={(e) => setCandSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && matchLine) void loadCandidates(matchLine, candSearch);
            }}
            sx={{ mb: 1.5 }}
            InputProps={{
              endAdornment: (
                <Button size="small" onClick={() => matchLine && loadCandidates(matchLine, candSearch)}>
                  Search
                </Button>
              ),
            }}
          />
          {candLoading || candidates === null ? (
            <Box sx={{ display: "flex", justifyContent: "center", p: 4 }}>
              <CircularProgress size={22} />
            </Box>
          ) : candidates.length === 0 ? (
            <Typography variant="body2" sx={{ color: "text.secondary", p: 2 }}>
              No open journal lines on this bank account{candSearch ? " match the search" : " near this date"}.
              The OR / payment may not be recorded in AIMS yet.
            </Typography>
          ) : (
            <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: "55vh", borderRadius: 1.5 }}>
              <Table size="small" stickyHeader sx={(t) => ({
                "& tbody td": { py: 0.5, borderBottom: `1px solid ${t.palette.mode === "dark" ? "rgba(255,255,255,0.32)" : "rgba(0,0,0,0.32)"}` },
              })}>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ width: 40 }} />
                    <TableCell sx={{ fontWeight: 700, fontSize: "0.7rem", color: "text.secondary" }}>DATE</TableCell>
                    <TableCell sx={{ fontWeight: 700, fontSize: "0.7rem", color: "text.secondary" }}>REFERENCE</TableCell>
                    <TableCell sx={{ fontWeight: 700, fontSize: "0.7rem", color: "text.secondary" }}>CONTACT / DESCRIPTION</TableCell>
                    <TableCell sx={{ fontWeight: 700, fontSize: "0.7rem", color: "text.secondary" }}>DOCUMENT</TableCell>
                    <TableCell sx={{ fontWeight: 700, fontSize: "0.7rem", color: "text.secondary", textAlign: "right" }}>DEBIT</TableCell>
                    <TableCell sx={{ fontWeight: 700, fontSize: "0.7rem", color: "text.secondary", textAlign: "right" }}>CREDIT</TableCell>
                    <TableCell />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {candidates.map((c) => (
                    <TableRow
                      key={c.journalLineId}
                      hover={!c.takenBy}
                      sx={(t) => ({
                        cursor: c.takenBy ? "default" : "pointer",
                        opacity: c.takenBy ? 0.45 : 1,
                        bgcolor: candSelected.has(c.journalLineId)
                          ? alpha(t.palette.primary.main, 0.1)
                          : c.amountMatches && c.sideMatches && !c.takenBy
                          ? alpha(t.palette.success.main, 0.08)
                          : undefined,
                      })}
                      onClick={() => !c.takenBy && toggleCandidate(c.journalLineId)}
                    >
                      <TableCell padding="checkbox" onClick={(e) => e.stopPropagation()}>
                        <Checkbox size="small" disabled={!!c.takenBy} checked={candSelected.has(c.journalLineId)} onChange={() => toggleCandidate(c.journalLineId)} />
                      </TableCell>
                      <TableCell sx={{ whiteSpace: "nowrap" }}>
                        {new Date(c.entryDate).toLocaleDateString("en-GB")}
                        <Box component="span" sx={{ color: "text.secondary", ml: 0.5, fontSize: "0.75rem" }}>
                          {c.dateDiffDays === 0 ? "(same day)" : `(±${c.dateDiffDays}d)`}
                        </Box>
                      </TableCell>
                      <TableCell sx={{ fontFamily: "monospace", fontWeight: 600, whiteSpace: "nowrap" }}>
                        {c.reference || c.journalNumber}
                      </TableCell>
                      <TableCell>
                        <Box sx={{ fontWeight: c.contactName ? 600 : 400 }}>{c.contactName || c.description || "—"}</Box>
                        {c.contactName && c.description && (
                          <Box sx={{ fontSize: "0.75rem", color: "text.secondary" }}>{String(c.description).slice(0, 60)}</Box>
                        )}
                      </TableCell>
                      <TableCell sx={{ whiteSpace: "nowrap" }}>
                        {c.docType ? `${String(c.docType).replace(/_/g, " ")}${c.docName ? ` ${c.docName}` : ""}` : "—"}
                      </TableCell>
                      <TableCell sx={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{c.debit ? fmt(c.debit) : ""}</TableCell>
                      <TableCell sx={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{c.credit ? fmt(c.credit) : ""}</TableCell>
                      <TableCell sx={{ textAlign: "right" }} onClick={(e) => e.stopPropagation()}>
                        {c.takenBy ? (
                          <Tooltip title={`Already matched to: ${c.takenBy}. Unmatch that line first to use this journal.`}>
                            <Chip size="small" color="warning" variant="outlined" label="taken" sx={{ fontSize: "0.65rem" }} />
                          </Tooltip>
                        ) : (
                          <Button
                            size="small"
                            variant={c.amountMatches ? "contained" : "outlined"}
                            sx={{ textTransform: "none", py: 0, fontSize: "0.7rem" }}
                            onClick={() => commitMatch([c.journalLineId])}
                          >
                            Match
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
          <Stack direction="row" alignItems="center" gap={2} sx={{ mt: 1.5 }}>
            <Typography variant="caption" sx={{ color: "text.secondary", flex: 1 }}>
              Green rows = exact amount on the right side. Tick several rows for a BATCH payment (one bank line settling
              multiple journals). Default window ±90 days; searching scans everything.
            </Typography>
            {matchLine && candSelected.size > 0 && (() => {
              const sel = (candidates || []).filter((c) => candSelected.has(c.journalLineId));
              const total = Math.round(sel.reduce((sum, c) => sum + (c.debit || c.credit || 0), 0) * 100) / 100;
              const target = Math.round(Math.abs(matchLine.amount) * 100) / 100;
              const exact = Math.abs(total - target) < 0.005;
              return (
                <>
                  <Chip
                    size="small"
                    color={exact ? "success" : "warning"}
                    label={`${candSelected.size} selected · ${fmt(total)} / ${fmt(target)}${exact ? " ✓" : ` (off by ${fmt(Math.abs(total - target))})`}`}
                  />
                  <Button variant="contained" onClick={() => commitMatch(Array.from(candSelected))}>
                    Match {candSelected.size} selected
                  </Button>
                </>
              );
            })()}
          </Stack>
        </DialogContent>
      </Dialog>

      {/* Reconciled transaction details (guru 2026-08-03, Xero concept): the
          statement line beside exactly what it reconciled to — document,
          contact and the journal's double entry — with Remove & Redo. */}
      <Dialog open={!!detail} onClose={() => setDetail(null)} fullWidth maxWidth="md">
        <DialogTitle sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          Reconciliation details
          <IconButton size="small" onClick={() => setDetail(null)}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          {detailLoading || !detail ? (
            <Box sx={{ display: "flex", justifyContent: "center", p: 4 }}>
              <CircularProgress size={22} />
            </Box>
          ) : (
            <Stack gap={2}>
              <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 2 }}>
                {/* Statement line */}
                <Paper variant="outlined" sx={(t) => ({ p: 2, borderRadius: 2, bgcolor: alpha(t.palette.success.main, 0.06) })}>
                  <Typography variant="overline" sx={{ fontWeight: 700, color: "text.secondary" }}>
                    This statement line
                  </Typography>
                  <Typography sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 700, fontSize: "1.25rem" }}>
                    {detail.line?.amount > 0 ? "+" : "−"} {fmt(Math.abs(detail.line?.amount || 0))}
                  </Typography>
                  <Typography variant="body2" sx={{ mt: 0.5 }}>
                    {detail.line?.date ? new Date(detail.line.date).toLocaleDateString("en-GB") : "—"}
                    {detail.line?.reference ? ` · ${detail.line.reference}` : ""}
                  </Typography>
                  <Typography variant="body2" sx={{ color: "text.secondary", mt: 1, wordBreak: "break-word" }}>
                    {detail.line?.description}
                  </Typography>
                </Paper>

                {/* Reconciled with */}
                <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                  <Typography variant="overline" sx={{ fontWeight: 700, color: "text.secondary" }}>
                    Reconciled with
                  </Typography>
                  {!detail.entry ? (
                    <Typography variant="body2" sx={{ color: "text.secondary", mt: 1 }}>
                      No journal found for this match.
                    </Typography>
                  ) : (
                    <>
                      {detail.document && (
                        <Typography sx={{ fontWeight: 700 }}>
                          {String(detail.document.type || "").replace(/_/g, " ")} {detail.document.name}
                        </Typography>
                      )}
                      {detail.billPayment && (
                        <Typography sx={{ fontWeight: 700 }}>
                          Supplier payment{detail.billPayment.billNumber ? ` — ${detail.billPayment.billNumber}` : ""}
                        </Typography>
                      )}
                      {detail.customerPayment && (
                        <Typography sx={{ fontWeight: 700 }}>
                          Customer receipt{detail.customerPayment.invoiceNumber ? ` — ${detail.customerPayment.invoiceNumber}` : ""}
                        </Typography>
                      )}
                      <Typography variant="body2" sx={{ mt: 0.5 }}>
                        {detail.document?.contactName || detail.billPayment?.supplierName || detail.customerPayment?.customerName || detail.entry.description || "—"}
                      </Typography>
                      <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.5 }}>
                        {detail.entry.journalNumber} · paid {new Date(detail.entry.entryDate).toLocaleDateString("en-GB")}
                        {(() => {
                          const d = Math.round((new Date(detail.entry.entryDate).getTime() - new Date(detail.line.date).getTime()) / 86400000);
                          return ` (${d === 0 ? "same day as bank" : `${Math.abs(d)}d ${d < 0 ? "before" : "after"} bank date`})`;
                        })()}
                        {detail.entry.reference ? ` · ${detail.entry.reference}` : ""}
                        {detail.entry.isUnconfirmed ? " · UNCONFIRMED" : ""}
                      </Typography>
                    </>
                  )}
                </Paper>
              </Box>

              {/* Counterparty sanity check: matched contact should appear in
                  the bank narrative — a mismatch is the #1 wrong-match tell. */}
              {(() => {
                const ens: any[] = detail.entries?.length ? detail.entries : detail.entry ? [detail] : [];
                const contacts = Array.from(new Set(ens.map((en: any) => en.document?.contactName || en.billPayment?.supplierName || en.customerPayment?.customerName).filter(Boolean))) as string[];
                if (!contacts.length) return null;
                const desc = String(detail.line?.description || "").toLowerCase();
                const stop = ["received", "from", "fast", "clearing", "swift", "outward", "credit"];
                const misses = contacts.filter(
                  (ct) => !ct.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w: string) => w.length >= 4 && !stop.includes(w)).some((tok: string) => desc.includes(tok)),
                );
                if (!misses.length) return null;
                return (
                  <Alert severity="warning">
                    Counterparty mismatch — the bank narrative doesn&apos;t mention {misses.join(", ")}. Verify this match before trusting it.
                  </Alert>
                );
              })()}

              {/* Batch matches: name every journal settled + its share of the
                  bank line, totalling to the statement amount. */}
              {Array.isArray(detail.entries) && detail.entries.length > 1 && (() => {
                const matchedAmt = (en: any) =>
                  (en.entry?.lines || []).reduce((s: number, l: any) => (l.isMatchedLine ? s + (l.debit || l.credit || 0) : s), 0);
                const total = detail.entries.reduce((s: number, en: any) => s + matchedAmt(en), 0);
                return (
                  <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                    <Typography variant="overline" sx={{ fontWeight: 700, color: "text.secondary" }}>
                      Batch payment — settles {detail.entries.length} journals
                    </Typography>
                    {detail.entries.map((en: any, i: number) => (
                      <Box key={i} sx={{ display: "flex", justifyContent: "space-between", gap: 2, mt: 0.5 }}>
                        <Typography variant="body2">
                          {en.document ? `${String(en.document.type || "").replace(/_/g, " ")} ${en.document.name}` : en.billPayment ? `Supplier payment${en.billPayment.billNumber ? ` — ${en.billPayment.billNumber}` : ""}` : en.customerPayment ? `Customer receipt${en.customerPayment.invoiceNumber ? ` — ${en.customerPayment.invoiceNumber}` : ""}` : en.entry?.journalNumber}
                          {" · "}
                          {en.document?.contactName || en.billPayment?.supplierName || en.customerPayment?.customerName || en.entry?.description || ""}
                        </Typography>
                        <Typography variant="body2" sx={{ color: "text.secondary", whiteSpace: "nowrap", mx: 1 }}>
                          {en.entry?.entryDate
                            ? (() => {
                                const d = Math.round((new Date(en.entry.entryDate).getTime() - new Date(detail.line.date).getTime()) / 86400000);
                                return `paid ${new Date(en.entry.entryDate).toLocaleDateString("en-GB")} (${d === 0 ? "0d" : `${d > 0 ? "+" : ""}${d}d`})`;
                              })()
                            : ""}
                        </Typography>
                        <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 600, whiteSpace: "nowrap" }}>
                          {fmt(matchedAmt(en))}
                        </Typography>
                      </Box>
                    ))}
                    <Box sx={{ display: "flex", justifyContent: "space-between", mt: 1, pt: 1, borderTop: 1, borderColor: "divider" }}>
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>Total</Typography>
                      <Typography variant="body2" sx={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{fmt(total)}</Typography>
                    </Box>
                  </Paper>
                );
              })()}

              {/* The double entry of EVERY settled journal — a wrong AI match
                  is visible instantly. */}
              {(detail.entries?.length ? detail.entries : detail.entry ? [detail] : []).map((en: any, gi: number) => (
                en.entry && (
                  <Paper key={gi} variant="outlined" sx={{ borderRadius: 2 }}>
                    {(detail.entries?.length ?? 0) > 1 && (
                      <Box sx={{ px: 2, pt: 1 }}>
                        <Typography variant="caption" sx={{ fontWeight: 700, color: "text.secondary" }}>
                          {en.entry.journalNumber}
                          {en.entry.reference ? ` · ${en.entry.reference}` : ""}
                        </Typography>
                      </Box>
                    )}
                    <Box sx={{ display: "grid", gridTemplateColumns: "1fr 120px 120px", px: 2, py: 0.75, borderBottom: 1, borderColor: "divider" }}>
                      <Typography variant="caption" sx={{ fontWeight: 700, color: "text.secondary" }}>ACCOUNT</Typography>
                      <Typography variant="caption" sx={{ fontWeight: 700, color: "text.secondary", textAlign: "right" }}>DEBIT</Typography>
                      <Typography variant="caption" sx={{ fontWeight: 700, color: "text.secondary", textAlign: "right" }}>CREDIT</Typography>
                    </Box>
                    {en.entry.lines.map((l: any, i: number) => (
                      <Box
                        key={i}
                        sx={(t) => ({
                          display: "grid",
                          gridTemplateColumns: "1fr 120px 120px",
                          px: 2,
                          py: 0.5,
                          bgcolor: l.isMatchedLine ? alpha(t.palette.primary.main, 0.07) : undefined,
                        })}
                      >
                        <Typography variant="body2">
                          {l.accountCode} {l.accountName}
                          {l.isMatchedLine ? "  ← matched" : ""}
                        </Typography>
                        <Typography variant="body2" sx={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{l.debit ? fmt(l.debit) : ""}</Typography>
                        <Typography variant="body2" sx={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{l.credit ? fmt(l.credit) : ""}</Typography>
                      </Box>
                    ))}
                  </Paper>
                )
              ))}

              <Stack direction="row" justifyContent="flex-end" gap={1}>
                {detail.document?.type === "OFFICIAL_RECEIPT" && (
                  <Button variant="outlined" onClick={() => window.open(`/portal/accounting/receipts/${detail.document.id}`, "_blank")}>
                    Open receipt
                  </Button>
                )}
                {detail.document && detail.document.type !== "OFFICIAL_RECEIPT" && detail.document.type !== "BILL" && detail.document.templateId && (
                  <Button variant="outlined" onClick={() => window.open(`/portal/documents/${detail.document.type}/${detail.document.templateId}/${detail.document.id}`, "_blank")}>
                    Open document
                  </Button>
                )}
                {detail.line?.status === "SUGGESTED" && (
                  <Button
                    color="success"
                    variant="contained"
                    onClick={async () => {
                      try {
                        await request(`/bank-rec/lines/${detail.line.id}/confirm`, { method: "POST" });
                        toast.success("Match confirmed");
                        setDetail(null);
                        loadActive();
                      } catch (e: any) {
                        toast.error(e?.message || "Confirm failed");
                      }
                    }}
                  >
                    Confirm match
                  </Button>
                )}
                <Button
                  color="warning"
                  variant="contained"
                  onClick={async () => {
                    const line = detail.line;
                    setDetail(null);
                    if (line) await unmatchLine(line);
                  }}
                >
                  {detail.line?.status === "SUGGESTED" ? "Reject" : "Remove & Redo"}
                </Button>
              </Stack>
            </Stack>
          )}
        </DialogContent>
      </Dialog>
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
      <Typography sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 700, fontSize: "1.125rem", mt: 0.25 }}>{value}</Typography>
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
            inputProps={{ style: { fontVariantNumeric: "tabular-nums", fontSize: "0.75rem" } }}
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
                          <TableCell key={c} sx={{ fontSize: "0.7rem", fontVariantNumeric: "tabular-nums" }}>
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
