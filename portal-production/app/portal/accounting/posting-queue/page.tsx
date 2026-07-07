"use client";

// Posting Queue — accountant screen listing invoices created but not yet posted
// to the GL (config.glPosting.status='pending', e.g. from the weighbridge
// ingestion). Review the AI/learned Dr-Cr preview per row, then post to the GL
// in bulk. Reuses the shared PostingPreviewDialog + /posting-preview/learn.

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
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
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import { toast } from "react-toastify";
import { useAccountingApi } from "../_lib/api";
import PostingPreviewDialog, {
  PreviewResult,
  PreviewAccount,
} from "@/components/PostingPreviewDialog";

type QueueItem = {
  id: string;
  name: string | null;
  date: string | null;
  customerName: string;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  status: string;
  source: string | null;
  ingestBatch: { type?: string; date?: string; sentAt?: string } | null;
  items: Array<{ lineIndex: number; description: string; amount: number; accountCode: string | null }>;
};

const fmt = (n: number) =>
  (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "");

export default function PostingQueuePage() {
  const { request } = useAccountingApi();
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [posting, setPosting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Review dialog state
  const [accounts, setAccounts] = useState<PreviewAccount[]>([]);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewData, setReviewData] = useState<PreviewResult | null>(null);
  const [reviewDocId, setReviewDocId] = useState<string | null>(null);

  // Reject dialog state
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await request<{ rows: QueueItem[] }>("/posting-queue?limit=200");
      setItems(res?.rows || []);
      setSelected(new Set());
    } catch (e: any) {
      toast.error(e?.message || "Failed to load posting queue");
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    load();
  }, [load]);

  // Group rows by ingest batch (type + date); ungrouped rows fall under "Other".
  const groups = useMemo(() => {
    const map = new Map<string, { label: string; rows: QueueItem[]; total: number }>();
    for (const it of items) {
      const b = it.ingestBatch;
      const key = b?.date ? `${b.type || "batch"}|${b.date}` : "other";
      const label = b?.date ? `${b.type || "batch"} · ${fmtDate(b.date)}` : "Other";
      const g = map.get(key) || { label, rows: [], total: 0 };
      g.rows.push(it);
      g.total += it.totalAmount;
      map.set(key, g);
    }
    return Array.from(map.values());
  }, [items]);

  const allIds = useMemo(() => items.map((i) => i.id), [items]);
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(allIds));
  const toggleGroup = (rows: QueueItem[]) =>
    setSelected((s) => {
      const n = new Set(s);
      const on = rows.every((r) => n.has(r.id));
      rows.forEach((r) => (on ? n.delete(r.id) : n.add(r.id)));
      return n;
    });

  const ensureAccounts = useCallback(async () => {
    if (accounts.length) return;
    try {
      const list = await request<any[]>("/accounting/accounts");
      setAccounts((list || []).filter((a) => a.isActive).map((a) => ({ id: a.id, code: a.code, name: a.name })));
    } catch {
      /* picker still works with codes typed manually */
    }
  }, [accounts.length, request]);

  const openReview = async (docId: string) => {
    setReviewDocId(docId);
    setReviewOpen(true);
    setReviewLoading(true);
    setReviewData(null);
    ensureAccounts();
    try {
      const res = await request<PreviewResult>(`/posting-queue/${docId}/preview`);
      setReviewData(res);
    } catch (e: any) {
      toast.error(e?.message || "Couldn't build the posting preview");
      setReviewOpen(false);
    } finally {
      setReviewLoading(false);
    }
  };

  const applyReview = async (
    picks: Array<{ lineIndex: number; accountId: string | null; accountCode: string | null }>,
  ) => {
    if (!reviewDocId) return;
    try {
      await request(`/posting-queue/${reviewDocId}/accounts`, {
        method: "POST",
        body: JSON.stringify({ picks: picks.map((p) => ({ lineIndex: p.lineIndex, accountCode: p.accountCode })) }),
      });
      toast.success("Accounts applied — ready to post");
      setReviewOpen(false);
      load();
    } catch (e: any) {
      toast.error(e?.message || "Failed to apply accounts");
    }
  };

  const learn = (corrections: Array<{ text: string; accountCode: string }>) => {
    request("/posting-preview/learn", {
      method: "POST",
      body: JSON.stringify({ side: "SALES", corrections }),
    }).catch(() => {});
  };

  const postSelected = async () => {
    if (selected.size === 0) return;
    setPosting(true);
    try {
      const res = await request<{ posted: number; skipped: number; failed: number; results: any[] }>(
        "/posting-queue/post-batch",
        { method: "POST", body: JSON.stringify({ documentIds: Array.from(selected) }) },
      );
      const parts = [`${res.posted} posted`];
      if (res.skipped) parts.push(`${res.skipped} skipped`);
      if (res.failed) parts.push(`${res.failed} failed`);
      res.failed ? toast.warn(parts.join(", ")) : toast.success(parts.join(", "));
      load();
    } catch (e: any) {
      toast.error(e?.message || "Batch post failed");
    } finally {
      setPosting(false);
    }
  };

  const doReject = async () => {
    if (selected.size === 0) return;
    setPosting(true);
    try {
      await Promise.all(
        Array.from(selected).map((id) =>
          request(`/posting-queue/${id}/reject`, { method: "POST", body: JSON.stringify({ reason: rejectReason }) }),
        ),
      );
      toast.success(`${selected.size} rejected`);
      setRejectOpen(false);
      setRejectReason("");
      load();
    } catch (e: any) {
      toast.error(e?.message || "Reject failed");
    } finally {
      setPosting(false);
    }
  };

  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>
            Posting Queue
          </Typography>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            Invoices created but not yet posted to the general ledger
          </Typography>
        </Box>
        <Button startIcon={<RefreshIcon />} onClick={load} disabled={loading}>
          Refresh
        </Button>
      </Stack>

      {loading && !items.length ? (
        <Box sx={{ display: "flex", justifyContent: "center", p: 8 }}>
          <CircularProgress />
        </Box>
      ) : items.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 6, textAlign: "center", color: "text.secondary" }}>
          Nothing pending — all invoices are posted.
        </Paper>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell padding="checkbox">
                  <Checkbox checked={allSelected} indeterminate={selected.size > 0 && !allSelected} onChange={toggleAll} />
                </TableCell>
                <TableCell>Invoice #</TableCell>
                <TableCell>Date</TableCell>
                <TableCell>Customer</TableCell>
                <TableCell align="right">Subtotal</TableCell>
                <TableCell align="right">GST</TableCell>
                <TableCell align="right">Total</TableCell>
                <TableCell align="center">Status</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {groups.map((g) => (
                <Fragment key={g.label}>
                  <TableRow sx={{ backgroundColor: "action.hover" }}>
                    <TableCell padding="checkbox">
                      <Checkbox
                        checked={g.rows.every((r) => selected.has(r.id))}
                        indeterminate={g.rows.some((r) => selected.has(r.id)) && !g.rows.every((r) => selected.has(r.id))}
                        onChange={() => toggleGroup(g.rows)}
                      />
                    </TableCell>
                    <TableCell colSpan={5} sx={{ fontWeight: 600 }}>
                      {g.label} · {g.rows.length} invoice{g.rows.length === 1 ? "" : "s"}
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600 }}>
                      {fmt(g.total)}
                    </TableCell>
                    <TableCell colSpan={2} />
                  </TableRow>
                  {g.rows.map((r) => (
                    <TableRow key={r.id} hover selected={selected.has(r.id)}>
                      <TableCell padding="checkbox">
                        <Checkbox checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                      </TableCell>
                      <TableCell>{r.name}</TableCell>
                      <TableCell>{fmtDate(r.date)}</TableCell>
                      <TableCell>{r.customerName}</TableCell>
                      <TableCell align="right">{fmt(r.subtotal)}</TableCell>
                      <TableCell align="right">{fmt(r.taxAmount)}</TableCell>
                      <TableCell align="right">{fmt(r.totalAmount)}</TableCell>
                      <TableCell align="center">
                        <Chip size="small" label="Pending" color="warning" variant="outlined" />
                      </TableCell>
                      <TableCell align="right">
                        <Button size="small" onClick={() => openReview(r.id)}>
                          Review
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Sticky bulk action bar */}
      {selected.size > 0 && (
        <Paper
          variant="outlined"
          sx={{ position: "sticky", bottom: 16, p: 1.5, display: "flex", alignItems: "center", gap: 2, borderColor: "primary.main" }}
        >
          <Typography sx={{ fontWeight: 600 }}>{selected.size} selected</Typography>
          <Box sx={{ flex: 1 }} />
          <Button color="error" onClick={() => setRejectOpen(true)} disabled={posting}>
            Reject
          </Button>
          <Button variant="contained" onClick={postSelected} disabled={posting} startIcon={posting ? <CircularProgress size={16} /> : undefined}>
            Post to GL
          </Button>
        </Paper>
      )}

      <PostingPreviewDialog
        open={reviewOpen}
        loading={reviewLoading}
        preview={reviewData}
        accounts={accounts}
        title="Review posting — invoice"
        onClose={() => setReviewOpen(false)}
        onConfirm={applyReview}
        onLearn={learn}
      />

      <Dialog open={rejectOpen} onClose={() => setRejectOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Reject {selected.size} invoice{selected.size === 1 ? "" : "s"}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            multiline
            minRows={2}
            label="Reason (optional)"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRejectOpen(false)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={doReject} disabled={posting}>
            Reject
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
