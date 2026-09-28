"use client";
// Xero-style reconcile work view (guru 2026-09-28: "follow how they do
// matching — somewhat, don't copy wholesale"). Each unreconciled statement
// line is a row pair: bank line on the LEFT (date / payee / ref, Spent |
// Received), the action on the RIGHT. AI-suggested batches get Xero's
// signature one-click green OK; pending lines expand (one at a time) into
// Match (find & select candidates with a must-match running total) or
// Create (post as new entry with an AI account suggestion). Deliberately
// not copied: Transfer/Discuss tabs, bank feeds, auto-reconcile toggle.
// The classic table survives as the "All lines" view on the same page.
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
  alpha,
} from "@mui/material";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import SearchIcon from "@mui/icons-material/Search";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import { toast } from "react-toastify";

type StatementLine = {
  id: string;
  date: string;
  description: string;
  reference?: string | null;
  amount: number;
  status: string;
  suggestedAccountId?: string | null;
  matchedJournalLines?: Array<{
    id: string;
    debit: number;
    credit: number;
    description?: string | null;
    journalEntry?: { journalNumber: string; entryDate: string; type: string };
  }>;
};

type Candidate = {
  journalLineId: string;
  entryDate: string;
  dateDiffDays: number;
  reference?: string | null;
  journalNumber?: string | null;
  contactName?: string | null;
  description?: string | null;
  docType?: string | null;
  docName?: string | null;
  debit?: number;
  credit?: number;
  amountMatches?: boolean;
  sideMatches?: boolean;
  takenBy?: string | null;
};

// Open invoice/bill the line can SETTLE (creates the payment on reconcile).
type DocCandidate = {
  documentId: string;
  number: string;
  contactName?: string | null;
  date?: string | null;
  total: number;
  outstanding: number;
  kind: "INVOICE" | "BILL";
};

const fmt = (n: number) =>
  (n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dmy = (iso: string) => new Date(iso).toLocaleDateString("en-GB");

// Verification preview (guru 2026-09-28): the double entry behind a journal
// candidate + its source document — checked before committing a match.
type PreviewData = {
  journal?: {
    journalNumber: string;
    entryDate: string;
    reference?: string | null;
    description?: string | null;
    isUnconfirmed?: boolean;
    lines: Array<{ account: string; description?: string | null; debit: number; credit: number; highlight?: boolean }>;
  };
  sourceDocument?: {
    id: string;
    number: string;
    type: string;
    templateId: string;
    status: string;
    contact?: string | null;
    date?: string | null;
    dueDate?: string | null;
    reference?: string | null;
    total?: number | null;
    outstanding?: number | null;
    items: Array<{ description: string; quantity?: number | null; amount: number }>;
  } | null;
};

function PreviewDialog({ open, loading, data, onClose }: { open: boolean; loading: boolean; data: PreviewData | null; onClose: () => void }) {
  const doc = data?.sourceDocument;
  const isBill = doc?.type === "BILL";
  const openUrl = doc ? (isBill ? "/portal/accounting/payables/purchase-journal" : `/portal/documents/${doc.type}/${doc.templateId}/${doc.id}`) : null;
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pr: 6 }}>
        Verify before matching
        <IconButton size="small" onClick={onClose} sx={{ position: "absolute", right: 12, top: 12 }}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        {loading || !data ? (
          <Box sx={{ py: 4, textAlign: "center" }}><CircularProgress size={20} /></Box>
        ) : (
          <Stack gap={2}>
            {data.journal && (
              <Box>
                <Stack direction="row" alignItems="center" gap={1} sx={{ mb: 0.5 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                    {data.journal.journalNumber} · {dmy(data.journal.entryDate)}
                  </Typography>
                  {data.journal.isUnconfirmed && (
                    <Chip size="small" color="warning" variant="outlined" label="unconfirmed" sx={{ height: 18, fontSize: "0.6rem" }} />
                  )}
                </Stack>
                {data.journal.reference && (
                  <Typography variant="caption" sx={{ fontFamily: "monospace", display: "block" }}>{data.journal.reference}</Typography>
                )}
                <Box sx={{ mt: 1, border: 1, borderColor: "divider", borderRadius: 1 }}>
                  <Stack direction="row" sx={{ px: 1, py: 0.5, borderBottom: 1, borderColor: "divider" }}>
                    <Typography variant="caption" sx={{ flex: 1, fontWeight: 700 }}>Account</Typography>
                    <Typography variant="caption" sx={{ width: 90, textAlign: "right", fontWeight: 700 }}>Debit</Typography>
                    <Typography variant="caption" sx={{ width: 90, textAlign: "right", fontWeight: 700 }}>Credit</Typography>
                  </Stack>
                  {data.journal.lines.map((l, i) => (
                    <Stack
                      key={i}
                      direction="row"
                      sx={{
                        px: 1, py: 0.5,
                        borderBottom: 1, borderColor: "divider", "&:last-child": { borderBottom: 0 },
                        bgcolor: l.highlight ? (t: any) => alpha(t.palette.primary.main, 0.08) : undefined,
                      }}
                    >
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="caption" sx={{ display: "block", fontWeight: 600 }} noWrap>{l.account}</Typography>
                        {l.description && (
                          <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>{l.description}</Typography>
                        )}
                      </Box>
                      <Typography variant="caption" sx={{ width: 90, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{l.debit ? fmt(l.debit) : ""}</Typography>
                      <Typography variant="caption" sx={{ width: 90, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{l.credit ? fmt(l.credit) : ""}</Typography>
                    </Stack>
                  ))}
                </Box>
              </Box>
            )}

            {data.journal && doc && <Divider />}

            {doc ? (
              <Box>
                <Stack direction="row" alignItems="center" justifyContent="space-between">
                  <Box>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                      {doc.type.replace(/_/g, " ")} {doc.number}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {doc.contact || "—"}
                      {doc.date ? ` · ${dmy(doc.date)}` : ""}
                      {doc.dueDate ? ` · due ${dmy(doc.dueDate)}` : ""}
                      {` · ${String(doc.status).replace(/_/g, " ")}`}
                    </Typography>
                    {doc.reference && (
                      <Typography variant="caption" sx={{ display: "block", fontFamily: "monospace" }}>{doc.reference}</Typography>
                    )}
                  </Box>
                  {openUrl && (
                    <Button size="small" variant="outlined" endIcon={<OpenInNewIcon fontSize="small" />} onClick={() => window.open(openUrl, "_blank", "noopener")}>
                      Open
                    </Button>
                  )}
                </Stack>
                {doc.items.length > 0 && (
                  <Box sx={{ mt: 1, border: 1, borderColor: "divider", borderRadius: 1, maxHeight: 220, overflowY: "auto" }}>
                    {doc.items.map((it, i) => (
                      <Stack key={i} direction="row" gap={1} sx={{ px: 1, py: 0.5, borderBottom: 1, borderColor: "divider", "&:last-child": { borderBottom: 0 } }}>
                        <Typography variant="caption" sx={{ flex: 1, whiteSpace: "pre-line" }}>
                          {it.description || "—"}
                        </Typography>
                        <Typography variant="caption" sx={{ width: 90, textAlign: "right", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
                          {it.amount ? fmt(it.amount) : ""}
                        </Typography>
                      </Stack>
                    ))}
                  </Box>
                )}
                <Stack direction="row" justifyContent="flex-end" gap={2} sx={{ mt: 0.75 }}>
                  {doc.total !== null && doc.total !== undefined && (
                    <Typography variant="caption">Total <strong>{fmt(doc.total)}</strong></Typography>
                  )}
                  {doc.outstanding !== null && doc.outstanding !== undefined && (
                    <Typography variant="caption">Outstanding <strong>{fmt(doc.outstanding)}</strong></Typography>
                  )}
                </Stack>
              </Box>
            ) : data.journal ? (
              <Typography variant="caption" color="text.secondary">No source document — this journal was entered directly.</Typography>
            ) : null}
          </Stack>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function ReconcileView({
  lines,
  request,
  onChanged,
}: {
  lines: StatementLine[];
  request: any;
  onChanged: () => void;
}) {
  // One row expanded at a time (Xero focuses you line by line).
  const [activeId, setActiveId] = useState<string | null>(null);
  const [tab, setTab] = useState<"match" | "create">("match");
  const [busyId, setBusyId] = useState<string | null>(null);

  // Match panel state (scoped to the active row)
  const [cands, setCands] = useState<Candidate[] | null>(null);
  const [candLoading, setCandLoading] = useState(false);
  const [candSearch, setCandSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Settle section: open invoices/bills — ORDERED selection (allocation is
  // computed in pick order, clamping the last pick to what's left).
  const [docCands, setDocCands] = useState<DocCandidate[] | null>(null);
  const [docSelected, setDocSelected] = useState<string[]>([]);

  // Verification preview dialog
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [preview, setPreview] = useState<PreviewData | null>(null);

  // Create panel state
  const [pnlAccounts, setPnlAccounts] = useState<any[]>([]);
  const [contraAccountId, setContraAccountId] = useState<string | null>(null);
  const [createDesc, setCreateDesc] = useState("");
  const [suggesting, setSuggesting] = useState(false);

  useEffect(() => {
    // Contra-account list for the Create tab — once.
    (async () => {
      try {
        const list = await request("/accounting/accounts");
        const all = Array.isArray(list) ? list : [];
        setPnlAccounts(all.filter((a: any) => a.isActive).sort((a: any, b: any) => a.code.localeCompare(b.code)));
      } catch {
        /* best-effort */
      }
    })();
  }, [request]);

  const loadCandidates = useCallback(
    async (line: StatementLine, term: string) => {
      setCandLoading(true);
      try {
        const r = await request(`/bank-rec/lines/${line.id}/candidates${term ? `?search=${encodeURIComponent(term)}` : ""}`);
        setCands(r?.candidates || []);
      } catch (e: any) {
        toast.error(e?.message || "Failed to load candidates");
        setCands([]);
      } finally {
        setCandLoading(false);
      }
    },
    [request],
  );

  const loadDocCandidates = useCallback(
    async (line: StatementLine) => {
      try {
        const r = await request(`/bank-rec/lines/${line.id}/document-candidates`);
        setDocCands(r?.candidates || []);
      } catch {
        setDocCands([]);
      }
    },
    [request],
  );

  const expand = (line: StatementLine) => {
    if (activeId === line.id) {
      setActiveId(null);
      return;
    }
    setActiveId(line.id);
    setTab("match");
    setCands(null);
    setCandSearch("");
    setSelected(new Set());
    setDocCands(null);
    setDocSelected([]);
    setContraAccountId(line.suggestedAccountId ?? null);
    setCreateDesc(line.description || "");
    void loadCandidates(line, "");
    void loadDocCandidates(line);
  };

  const act = async (line: StatementLine, path: string, body?: any, okMsg?: string) => {
    setBusyId(line.id);
    try {
      await request(`/bank-rec/lines/${line.id}/${path}`, {
        method: "POST",
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (okMsg) toast.success(okMsg);
      setActiveId(null);
      onChanged();
    } catch (e: any) {
      toast.error(e?.message || "Action failed");
    } finally {
      setBusyId(null);
    }
  };

  const openPreview = async (kind: "journal" | "document", id: string) => {
    setPreviewOpen(true);
    setPreviewLoading(true);
    setPreview(null);
    try {
      const r = await request(kind === "journal" ? `/bank-rec/journal-lines/${id}/preview` : `/bank-rec/documents/${id}/preview`);
      setPreview(r || null);
    } catch (e: any) {
      toast.error(e?.message || "Failed to load preview");
      setPreviewOpen(false);
    } finally {
      setPreviewLoading(false);
    }
  };

  const askSuggestion = async (line: StatementLine) => {
    setSuggesting(true);
    try {
      const r = await request(`/bank-rec/lines/${line.id}/suggest`, { method: "POST" });
      if (r?.suggestion?.accountId) {
        setContraAccountId(r.suggestion.accountId);
        toast.success(`Suggested: ${r.suggestion.code} — ${r.suggestion.name}`);
      } else toast.info("No confident suggestion — pick manually");
    } catch (e: any) {
      toast.error(e?.message || "Suggestion failed");
    } finally {
      setSuggesting(false);
    }
  };

  if (lines.length === 0) {
    return (
      <Paper variant="outlined" sx={{ p: 5, textAlign: "center" }}>
        <CheckIcon sx={{ fontSize: 40, color: "success.main" }} />
        <Typography sx={{ fontWeight: 700, mt: 1 }}>All statement lines reconciled</Typography>
        <Typography variant="body2" color="text.secondary">
          Nothing left to match on this import — switch to "All lines" to review what was done.
        </Typography>
      </Paper>
    );
  }

  return (
    <Stack gap={1.25}>
      {/* Column captions, Xero-style */}
      <Stack direction="row" sx={{ px: 0.5, display: { xs: "none", md: "flex" } }}>
        <Typography variant="caption" color="text.secondary" sx={{ flex: 5 }}>
          Review your bank statement lines…
        </Typography>
        <Box sx={{ width: 72 }} />
        <Typography variant="caption" color="text.secondary" sx={{ flex: 6 }}>
          …then match them to your books
        </Typography>
      </Stack>

      {lines.map((line) => {
        const isActive = activeId === line.id;
        const isSuggested = line.status === "SUGGESTED";
        const busy = busyId === line.id;
        const target = Math.round(Math.abs(line.amount) * 100) / 100;

        const sel = (cands || []).filter((c) => selected.has(c.journalLineId));
        const selTotal = Math.round(sel.reduce((s, c) => s + (c.debit || c.credit || 0), 0) * 100) / 100;
        const outBy = Math.round((target - selTotal) * 100) / 100;
        const balanced = sel.length > 0 && Math.abs(outBy) < 0.005;

        // Doc-settle allocations: pick order, each clamped to what's left of
        // the statement amount — so the last pick can be a partial payment.
        const docAllocs: Array<{ doc: DocCandidate; alloc: number }> = [];
        if (isActive && docCands) {
          let remaining = target;
          for (const id of docSelected) {
            const d = docCands.find((x) => x.documentId === id);
            if (!d) continue;
            const alloc = Math.min(d.outstanding, Math.max(0, Math.round(remaining * 100) / 100));
            remaining = Math.round((remaining - alloc) * 100) / 100;
            docAllocs.push({ doc: d, alloc });
          }
        }
        const docTotal = Math.round(docAllocs.reduce((s, a) => s + a.alloc, 0) * 100) / 100;
        const docOutBy = Math.round((target - docTotal) * 100) / 100;
        const docBalanced = docAllocs.length > 0 && Math.abs(docOutBy) < 0.005;
        const settleMode = docSelected.length > 0;

        const sugLines = line.matchedJournalLines || [];
        const sugTotal = Math.round(sugLines.reduce((s, m) => s + (m.debit || m.credit || 0), 0) * 100) / 100;
        const sugDrift = Math.round((target - sugTotal) * 100) / 100;

        const filteredCands = (cands || []).filter((c) => {
          const q = candSearch.trim().toLowerCase();
          if (!q) return true;
          return [c.reference, c.journalNumber, c.contactName, c.description, c.docName]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(q));
        });

        return (
          <Paper key={line.id} variant="outlined" sx={{ overflow: "hidden", ...(isActive ? { borderColor: "primary.main" } : {}) }}>
            <Stack direction={{ xs: "column", md: "row" }} sx={{ alignItems: "stretch" }}>
              {/* LEFT — the bank statement line */}
              <Box sx={{ flex: 5, p: 1.5, display: "flex", gap: 1.5 }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="caption" color="text.secondary">{dmy(line.date)}</Typography>
                  <Typography variant="body2" sx={{ fontWeight: 600, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                    {line.description}
                  </Typography>
                  {line.reference && (
                    <Typography variant="caption" sx={{ fontFamily: "monospace", color: "text.secondary" }}>
                      {line.reference}
                    </Typography>
                  )}
                </Box>
                {/* Spent | Received — Xero's clearest idea, kept verbatim */}
                <Stack direction="row" sx={{ alignItems: "center" }}>
                  <Box sx={{ width: 92, textAlign: "right", pr: 1.5, borderLeft: 1, borderColor: "divider", alignSelf: "stretch", display: "flex", flexDirection: "column", justifyContent: "center" }}>
                    <Typography variant="caption" color="text.secondary">Spent</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                      {line.amount < 0 ? fmt(Math.abs(line.amount)) : ""}
                    </Typography>
                  </Box>
                  <Box sx={{ width: 92, textAlign: "right", pr: 0.5, borderLeft: 1, borderColor: "divider", alignSelf: "stretch", display: "flex", flexDirection: "column", justifyContent: "center" }}>
                    <Typography variant="caption" color="text.secondary">Received</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                      {line.amount > 0 ? fmt(line.amount) : ""}
                    </Typography>
                  </Box>
                </Stack>
              </Box>

              {/* MIDDLE — the one-click OK for suggestions */}
              <Box sx={{ width: { md: 72 }, display: "flex", alignItems: "center", justifyContent: "center", py: { xs: 0, md: 1 } }}>
                {isSuggested ? (
                  <Tooltip title="Accept the suggested match">
                    <span>
                      <Button
                        variant="contained"
                        color="success"
                        size="small"
                        disabled={busy}
                        onClick={() => act(line, "confirm", undefined, "Match confirmed")}
                        sx={{ minWidth: 52, fontWeight: 700 }}
                      >
                        {busy ? <CircularProgress size={16} color="inherit" /> : "OK"}
                      </Button>
                    </span>
                  </Tooltip>
                ) : (
                  <Typography variant="caption" color="text.secondary" sx={{ display: { xs: "none", md: "block" } }}>
                    →
                  </Typography>
                )}
              </Box>

              {/* RIGHT — suggestion summary, or Match/Create */}
              <Box
                sx={{
                  flex: 6,
                  p: 1.5,
                  bgcolor: (t) => alpha(t.palette.text.primary, 0.02),
                  borderLeft: { md: 1 },
                  borderTop: { xs: 1, md: 0 },
                  borderColor: { xs: "divider", md: "divider" },
                  cursor: isSuggested ? "default" : "pointer",
                }}
                onClick={() => !isSuggested && !isActive && expand(line)}
              >
                {isSuggested ? (
                  <Stack direction="row" alignItems="center" gap={1}>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Stack direction="row" gap={0.75} alignItems="center">
                        <Chip size="small" color="info" variant="outlined" label="Suggested match" sx={{ height: 20, fontSize: "0.65rem" }} />
                        {Math.abs(sugDrift) >= 0.005 && (
                          <Chip size="small" color="warning" variant="outlined" label={`off by ${fmt(Math.abs(sugDrift))}`} sx={{ height: 20, fontSize: "0.65rem" }} />
                        )}
                      </Stack>
                      <Stack direction="row" alignItems="center" gap={0.5} flexWrap="wrap" sx={{ mt: 0.5 }}>
                        <Typography variant="body2">
                          {sugLines.length} journal{sugLines.length === 1 ? "" : "s"} · {fmt(sugTotal)} —
                        </Typography>
                        {sugLines.slice(0, 6).map((m) => (
                          <Tooltip key={m.id} title="View this journal & its document">
                            <Chip
                              size="small"
                              clickable
                              variant="outlined"
                              icon={<InfoOutlinedIcon sx={{ fontSize: 13 }} />}
                              label={m.journalEntry?.journalNumber || "JE"}
                              onClick={() => openPreview("journal", m.id)}
                              sx={{ height: 20, fontSize: "0.65rem", fontFamily: "monospace" }}
                            />
                          </Tooltip>
                        ))}
                        {sugLines.length > 6 && (
                          <Typography variant="caption" color="text.secondary">+{sugLines.length - 6} more</Typography>
                        )}
                      </Stack>
                    </Box>
                    <Tooltip title="Reject suggestion (back to pending)">
                      <span>
                        <Button size="small" color="inherit" disabled={busy} onClick={() => act(line, "unmatch", undefined, "Suggestion rejected")} sx={{ minWidth: 36 }}>
                          <CloseIcon fontSize="small" />
                        </Button>
                      </span>
                    </Tooltip>
                  </Stack>
                ) : !isActive ? (
                  <Stack direction="row" alignItems="center" justifyContent="space-between">
                    <Typography variant="body2" color="text.secondary">
                      Click to find a match or create an entry
                    </Typography>
                    <Button
                      size="small"
                      color="inherit"
                      sx={{ color: "text.secondary" }}
                      disabled={busy}
                      onClick={(e) => { e.stopPropagation(); act(line, "ignore", undefined, "Line ignored"); }}
                    >
                      Ignore
                    </Button>
                  </Stack>
                ) : (
                  <Box onClick={(e) => e.stopPropagation()}>
                    <Stack direction="row" alignItems="center" justifyContent="space-between">
                      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ minHeight: 32, "& .MuiTab-root": { minHeight: 32, py: 0.25, textTransform: "none", fontWeight: 600 } }}>
                        <Tab value="match" label="Match" />
                        <Tab value="create" label="Create" />
                      </Tabs>
                      <Button size="small" color="inherit" sx={{ color: "text.secondary" }} onClick={() => setActiveId(null)}>
                        Close
                      </Button>
                    </Stack>

                    {tab === "match" ? (
                      <Box sx={{ mt: 1 }}>
                        <TextField
                          size="small"
                          fullWidth
                          placeholder="Search by reference, contact or document…"
                          value={candSearch}
                          onChange={(e) => setCandSearch(e.target.value)}
                          InputProps={{ startAdornment: <SearchIcon fontSize="small" sx={{ mr: 0.75, color: "text.secondary" }} /> }}
                        />
                        <Box sx={{ maxHeight: 260, overflowY: "auto", mt: 1, border: 1, borderColor: "divider", borderRadius: 1 }}>
                          {candLoading ? (
                            <Box sx={{ py: 3, textAlign: "center" }}><CircularProgress size={18} /></Box>
                          ) : filteredCands.length === 0 ? (
                            <Typography variant="body2" color="text.secondary" sx={{ py: 2.5, textAlign: "center" }}>
                              No candidate journals on this bank account — settle an open document below, or use Create.
                            </Typography>
                          ) : (
                            filteredCands.slice(0, 60).map((c) => {
                              const amt = c.debit || c.credit || 0;
                              const checked = selected.has(c.journalLineId);
                              return (
                                <Stack
                                  key={c.journalLineId}
                                  direction="row"
                                  alignItems="center"
                                  gap={0.75}
                                  onClick={() => {
                                    if (c.takenBy) return;
                                    setDocSelected([]); // journals and doc-settles don't mix in one reconcile
                                    setSelected((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(c.journalLineId)) next.delete(c.journalLineId);
                                      else next.add(c.journalLineId);
                                      return next;
                                    });
                                  }}
                                  sx={{
                                    px: 0.75,
                                    py: 0.5,
                                    borderBottom: 1,
                                    borderColor: "divider",
                                    cursor: c.takenBy ? "default" : "pointer",
                                    opacity: c.takenBy ? 0.45 : 1,
                                    bgcolor: checked ? (t: any) => alpha(t.palette.primary.main, 0.08) : undefined,
                                    "&:last-child": { borderBottom: 0 },
                                  }}
                                >
                                  <Checkbox size="small" disabled={!!c.takenBy} checked={checked} sx={{ p: 0.25 }} />
                                  <Box sx={{ width: 78, flexShrink: 0 }}>
                                    <Typography variant="caption">{dmy(c.entryDate)}</Typography>
                                    <Typography variant="caption" sx={{ display: "block", color: "text.secondary" }}>
                                      {c.dateDiffDays === 0 ? "same day" : `±${c.dateDiffDays}d`}
                                    </Typography>
                                  </Box>
                                  <Box sx={{ flex: 1, minWidth: 0 }}>
                                    <Typography variant="caption" sx={{ fontFamily: "monospace", fontWeight: 600, display: "block" }} noWrap>
                                      {c.reference || c.journalNumber}
                                    </Typography>
                                    <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
                                      {c.takenBy ? `already matched: ${c.takenBy}` : c.contactName || c.description || (c.docName ? `${c.docType || ""} ${c.docName}` : "")}
                                    </Typography>
                                  </Box>
                                  <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums", fontWeight: c.amountMatches ? 700 : 400, flexShrink: 0 }}>
                                    {fmt(amt)}
                                  </Typography>
                                  <Tooltip title="View the journal & its document">
                                    <IconButton
                                      size="small"
                                      sx={{ p: 0.25, flexShrink: 0 }}
                                      onClick={(e) => { e.stopPropagation(); openPreview("journal", c.journalLineId); }}
                                    >
                                      <InfoOutlinedIcon sx={{ fontSize: 16 }} />
                                    </IconButton>
                                  </Tooltip>
                                </Stack>
                              );
                            })
                          )}
                        </Box>
                        {/* Settle open documents — statement-driven "mark as paid"
                            (guru 2026-09-28): reconciling CREATES the payment via
                            the standard payment services, then links it. */}
                        {(docCands === null || docCands.length > 0) && (
                          <>
                            <Typography variant="caption" sx={{ display: "block", mt: 1.25, fontWeight: 700 }}>
                              Or settle open {line.amount > 0 ? "invoices" : "bills"} — records the payment & marks {line.amount > 0 ? "them" : "the bill"} paid
                            </Typography>
                            <Box sx={{ maxHeight: 200, overflowY: "auto", mt: 0.5, border: 1, borderColor: "divider", borderRadius: 1 }}>
                              {docCands === null ? (
                                <Box sx={{ py: 2, textAlign: "center" }}><CircularProgress size={16} /></Box>
                              ) : (
                                docCands
                                  .filter((d) => {
                                    const q = candSearch.trim().toLowerCase();
                                    if (!q) return true;
                                    return d.number.toLowerCase().includes(q) || (d.contactName || "").toLowerCase().includes(q);
                                  })
                                  .slice(0, 40)
                                  .map((d) => {
                                    const picked = docSelected.includes(d.documentId);
                                    const alloc = docAllocs.find((a) => a.doc.documentId === d.documentId)?.alloc;
                                    return (
                                      <Stack
                                        key={d.documentId}
                                        direction="row"
                                        alignItems="center"
                                        gap={0.75}
                                        onClick={() => {
                                          setSelected(new Set()); // doc-settles and journal matches don't mix
                                          setDocSelected((prev) =>
                                            prev.includes(d.documentId) ? prev.filter((x) => x !== d.documentId) : [...prev, d.documentId],
                                          );
                                        }}
                                        sx={{
                                          px: 0.75,
                                          py: 0.5,
                                          borderBottom: 1,
                                          borderColor: "divider",
                                          cursor: "pointer",
                                          bgcolor: picked ? (t: any) => alpha(t.palette.success.main, 0.08) : undefined,
                                          "&:last-child": { borderBottom: 0 },
                                        }}
                                      >
                                        <Checkbox size="small" checked={picked} sx={{ p: 0.25 }} color="success" />
                                        <Box sx={{ flex: 1, minWidth: 0 }}>
                                          <Typography variant="caption" sx={{ fontFamily: "monospace", fontWeight: 600, display: "block" }} noWrap>
                                            {d.number}
                                          </Typography>
                                          <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
                                            {d.contactName || "—"}
                                            {d.date ? ` · ${dmy(d.date)}` : ""}
                                          </Typography>
                                        </Box>
                                        {picked && alloc !== undefined && Math.abs(alloc - d.outstanding) > 0.005 && (
                                          <Chip size="small" color="warning" variant="outlined" label={`part-pay ${fmt(alloc)}`} sx={{ height: 18, fontSize: "0.6rem" }} />
                                        )}
                                        <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums", fontWeight: Math.abs(d.outstanding - target) < 0.005 ? 700 : 400, flexShrink: 0 }}>
                                          {fmt(d.outstanding)}
                                        </Typography>
                                        <Tooltip title={`View the ${d.kind === "BILL" ? "bill" : "invoice"}`}>
                                          <IconButton
                                            size="small"
                                            sx={{ p: 0.25, flexShrink: 0 }}
                                            onClick={(e) => { e.stopPropagation(); openPreview("document", d.documentId); }}
                                          >
                                            <InfoOutlinedIcon sx={{ fontSize: 16 }} />
                                          </IconButton>
                                        </Tooltip>
                                      </Stack>
                                    );
                                  })
                              )}
                            </Box>
                          </>
                        )}
                        {/* Must-match running bar — Xero's step 3, condensed.
                            Serves whichever mode is active (journals vs settle). */}
                        <Stack direction="row" alignItems="center" gap={1} sx={{ mt: 1 }}>
                          <Typography variant="caption" sx={{ flex: 1 }}>
                            Must match <strong>{fmt(target)}</strong> · selected <strong>{fmt(settleMode ? docTotal : selTotal)}</strong>{" "}
                            {(settleMode ? docAllocs.length > 0 : sel.length > 0) && (
                              <Box component="span" sx={{ color: (settleMode ? docBalanced : balanced) ? "success.main" : "warning.main", fontWeight: 700 }}>
                                {(settleMode ? docBalanced : balanced) ? "✓ balanced" : `out by ${fmt(Math.abs(settleMode ? docOutBy : outBy))}`}
                              </Box>
                            )}
                          </Typography>
                          <Button
                            variant="contained"
                            color="success"
                            size="small"
                            disabled={(settleMode ? !docBalanced : !balanced) || busy}
                            onClick={() =>
                              settleMode
                                ? act(
                                    line,
                                    "settle",
                                    { allocations: docAllocs.filter((a) => a.alloc > 0).map((a) => ({ documentId: a.doc.documentId, amount: a.alloc })) },
                                    docAllocs.length > 1 ? `Payments recorded for ${docAllocs.length} documents` : "Payment recorded + reconciled",
                                  )
                                : act(line, "match", { journalLineIds: Array.from(selected) }, sel.length > 1 ? `Matched ${sel.length} journals` : "Matched")
                            }
                          >
                            {busy ? <CircularProgress size={16} color="inherit" /> : settleMode ? "Record payment & reconcile" : "Reconcile"}
                          </Button>
                        </Stack>
                      </Box>
                    ) : (
                      <Stack gap={1.25} sx={{ mt: 1.25 }}>
                        <Stack direction="row" gap={1}>
                          <Autocomplete
                            fullWidth
                            size="small"
                            options={pnlAccounts}
                            value={pnlAccounts.find((a) => a.id === contraAccountId) || null}
                            onChange={(_, v) => setContraAccountId(v?.id || null)}
                            getOptionLabel={(o: any) => `${o.code} — ${o.name}`}
                            renderInput={(params) => <TextField {...params} label="Categorize as (account)" />}
                          />
                          <Tooltip title="AI suggests the account">
                            <span>
                              <Button size="small" variant="outlined" disabled={suggesting} onClick={() => askSuggestion(line)} sx={{ minWidth: 44, height: "100%" }}>
                                {suggesting ? <CircularProgress size={14} /> : <AutoAwesomeIcon fontSize="small" />}
                              </Button>
                            </span>
                          </Tooltip>
                        </Stack>
                        <TextField
                          size="small"
                          fullWidth
                          label="Description"
                          value={createDesc}
                          onChange={(e) => setCreateDesc(e.target.value)}
                        />
                        <Stack direction="row" justifyContent="flex-end">
                          <Button
                            variant="contained"
                            color="success"
                            size="small"
                            disabled={!contraAccountId || busy}
                            onClick={() => act(line, "post", { contraAccountId, description: createDesc }, "Posted + reconciled")}
                          >
                            {busy ? <CircularProgress size={16} color="inherit" /> : `Post ${line.amount > 0 ? "receipt" : "payment"} ${fmt(target)}`}
                          </Button>
                        </Stack>
                      </Stack>
                    )}
                  </Box>
                )}
              </Box>
            </Stack>
            {isSuggested && Math.abs(sugDrift) >= 0.005 && (
              <Alert severity="warning" sx={{ borderRadius: 0, py: 0.25, fontSize: "0.75rem" }}>
                Suggested total differs from the statement amount by {fmt(Math.abs(sugDrift))} — review before accepting.
              </Alert>
            )}
          </Paper>
        );
      })}

      <PreviewDialog open={previewOpen} loading={previewLoading} data={preview} onClose={() => setPreviewOpen(false)} />
    </Stack>
  );
}
