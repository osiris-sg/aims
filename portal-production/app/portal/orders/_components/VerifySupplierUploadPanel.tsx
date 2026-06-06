"use client";

/**
 * Top-of-page panel on the Orders list: upload a supplier's Delivery Order or
 * Tax Invoice (PDF/PNG/JPG) and reconcile it against the buyer's PO. The
 * backend auto-detects DO vs Invoice, locates the matching PO by PO-number
 * then by SKU overlap, and returns a structured per-line + totals + points
 * report which we render in a dialog. No props — fully self-contained.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorIcon from "@mui/icons-material/Error";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import HelpOutlineIcon from "@mui/icons-material/HelpOutline";
import ReplayIcon from "@mui/icons-material/Replay";
import CloseIcon from "@mui/icons-material/Close";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import DownloadIcon from "@mui/icons-material/Download";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { toast } from "react-toastify";

interface LineRow {
  code?: string;
  description?: string;
  po: { qty: number; unitPrice: number; amount: number } | null;
  supplier: { qty: number; unitPrice?: number; amount?: number } | null;
  status: "ok" | "mismatch" | "missing" | "extra";
  notes?: string;
}

interface CheckBlock {
  kind: "items" | "totals" | "points";
  status: "ok" | "warn" | "fail";
  label: string;
  details: any;
}

interface VerifyResult {
  matched: boolean;
  extracted: any;
  match: null | {
    orderId: string;
    orderNumber: string;
    orderType: string | null;
    poDocId: string;
    poDocName: string;
    confidence: number;
    reason: string;
  };
  stamped?: "verifiedDo" | "verifiedInv" | null;
  stampedCount?: number;
  supplierFile?: {
    url: string | null;
    key: string | null;
    originalName: string | null;
    mimeType: string | null;
  } | null;
  checks: CheckBlock[];
  summary: { allOk: boolean; issueCount: number; reason?: string };
}

const fmt = (n: number | undefined | null) =>
  n == null || !Number.isFinite(Number(n))
    ? "—"
    : Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const statusChip = (s: "ok" | "warn" | "fail") =>
  s === "ok" ? (
    <Chip size="small" color="success" icon={<CheckCircleIcon />} label="OK" />
  ) : s === "warn" ? (
    <Chip size="small" color="warning" label="Review" />
  ) : (
    <Chip size="small" color="error" icon={<ErrorIcon />} label="Mismatch" />
  );

const lineStatusChip = (s: LineRow["status"]) => {
  if (s === "ok") return <Chip size="small" color="success" label="✓" />;
  if (s === "mismatch") return <Chip size="small" color="error" label="Mismatch" />;
  if (s === "missing") return <Chip size="small" color="error" label="Missing on supplier" />;
  return <Chip size="small" color="warning" label="Extra on supplier" />;
};

/**
 * Run one verify-upload call. Used by both the single-file flow (current
 * panel) and the batch dialog. Throws on transport / non-2xx errors; returns
 * the unwrapped VerifyResult (the API wrapper nests payload at .data).
 */
async function runVerifyUpload(file: File, token: string): Promise<VerifyResult> {
  const fd = new FormData();
  fd.append("file", file);
  const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4040";
  // Mirror helpers/request.ts: auto-forward the admin org-switch header from
  // sessionStorage so a "Viewing as <org>" admin hits the right org.
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (typeof window !== "undefined") {
    const activeOrgId = window.sessionStorage.getItem("aims-admin-active-org");
    if (activeOrgId) headers["X-Active-Org-Id"] = activeOrgId;
  }
  const res = await fetch(`${apiBase}/orders/verify-upload`, { method: "POST", headers, body: fd });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.message || "Verification failed");
  return (json?.data ?? json) as VerifyResult;
}

// One row in the batch dialog. The id is `${name}_${size}_${lastModified}` so
// the same file dropped twice is deduped; identical file from a different
// folder still gets its own row (different lastModified).
interface BatchRowState {
  id: string;
  file: File;
  status: "queued" | "extracting" | "done" | "error";
  result?: VerifyResult;
  error?: string;
}

const fileKeyOf = (f: File) => `${f.name}_${f.size}_${f.lastModified}`;

export default function VerifySupplierUploadPanel() {
  const router = useRouter();
  const { getToken } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [batchFiles, setBatchFiles] = useState<File[] | null>(null); // when non-null → batch dialog is open

  const pickFile = () => inputRef.current?.click();

  // Single-file flow: existing behaviour with auto-nav on match.
  const handleSingleFile = async (file: File) => {
    setUploading(true);
    try {
      const token = await getToken();
      if (!token) {
        toast.error("Not authenticated");
        return;
      }
      const payload = await runVerifyUpload(file, token);
      if (!payload.matched) {
        setResult(payload);
        setDialogOpen(true);
        toast.warn("No matching PO found — see report for extracted details");
      } else {
        const stampLabel = payload.stamped === "verifiedDo" ? "DO" : payload.stamped === "verifiedInv" ? "Invoice" : "";
        const n = payload.stampedCount || 0;
        const verifiedPart = n > 0 && stampLabel ? ` · ${n} line${n === 1 ? "" : "s"} marked ✓ ${stampLabel}` : "";
        if (payload.summary.allOk) toast.success(`All checks passed${verifiedPart}`);
        else toast.warn(`${payload.summary.issueCount} check issue${payload.summary.issueCount === 1 ? "" : "s"}${verifiedPart}`);
        if (payload.match?.orderId) router.push(`/portal/orders/${payload.match.orderId}`);
      }
    } catch (err: any) {
      console.error("Verify upload failed:", err);
      toast.error(err?.message || "Verification failed");
    } finally {
      setUploading(false);
    }
  };

  // Route 1 file to the single-file path (auto-nav); 2+ to the batch dialog.
  const handleFiles = (files: File[]) => {
    const ok = files.filter((f) => /^application\/pdf$|^image\/(png|jpeg)$/.test(f.type));
    if (ok.length === 0) {
      if (files.length > 0) toast.warn("Pick PDF / PNG / JPG files only");
      return;
    }
    // De-dupe by name+size+lastModified so a double-drop doesn't re-scan.
    const seen = new Set<string>();
    const unique: File[] = [];
    for (const f of ok) {
      const k = fileKeyOf(f);
      if (!seen.has(k)) { seen.add(k); unique.push(f); }
    }
    if (unique.length === 1) {
      handleSingleFile(unique[0]);
    } else {
      setBatchFiles(unique);
    }
  };

  return (
    <Box
      onDragOver={(e) => { e.preventDefault(); if (!dragOver) setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const dropped = Array.from(e.dataTransfer.files || []);
        handleFiles(dropped);
      }}
      sx={{
        mb: 2,
        p: 2,
        border: "1px dashed",
        borderColor: dragOver ? "primary.main" : "divider",
        bgcolor: dragOver ? "action.hover" : "background.paper",
        borderRadius: 1,
        display: "flex",
        alignItems: "center",
        gap: 2,
        flexWrap: "wrap",
        transition: "background-color 120ms ease, border-color 120ms ease",
      }}
    >
      <UploadFileIcon color="action" />
      <Box sx={{ flex: 1, minWidth: 240 }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          Verify supplier DO / Tax Invoice
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Drop one or more supplier docs (PDF / PNG / JPG) here, or click the button. Multiple files run 3 at a time and open a batch report.
        </Typography>
      </Box>
      <input
        ref={inputRef}
        type="file"
        hidden
        multiple
        accept="application/pdf,image/png,image/jpeg"
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          handleFiles(files);
          if (inputRef.current) inputRef.current.value = ""; // allow re-pick of same file
        }}
      />
      <Button
        variant="contained"
        size="small"
        onClick={pickFile}
        disabled={uploading}
        startIcon={uploading ? <CircularProgress size={16} color="inherit" /> : null}
      >
        {uploading ? "Verifying…" : "Upload & Verify"}
      </Button>

      {/* Single-file unmatched dialog (kept as-is). */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="lg" fullWidth>
        <DialogTitle sx={{ pb: 1 }}>
          Supplier doc verification
          {result?.match && (
            <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
              {result.extracted?.supplier?.name ? `${result.extracted.supplier.name} · ` : ""}
              {result.extracted?.docKind === "DELIVERY_ORDER" ? "Delivery Order" : result.extracted?.docKind === "INVOICE" ? "Tax Invoice" : "Document"}
              {result.extracted?.docNumber ? ` ${result.extracted.docNumber}` : ""}
              {result.extracted?.docDate ? ` · ${result.extracted.docDate}` : ""}
            </Typography>
          )}
        </DialogTitle>
        <DialogContent dividers>{result && <ReportBody result={result} onOpenOrder={(id) => router.push(`/portal/orders/${id}`)} />}</DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Multi-file batch dialog. */}
      {batchFiles && (
        <BatchVerifyDialog
          files={batchFiles}
          onClose={() => setBatchFiles(null)}
          onOpenOrder={(id) => window.open(`/portal/orders/${id}`, "_blank", "noopener,noreferrer")}
        />
      )}
    </Box>
  );
}

function ReportBody({ result, onOpenOrder }: { result: VerifyResult; onOpenOrder: (orderId: string) => void }) {
  if (!result.matched || !result.match) {
    // No PO matched — show the extracted summary so the user can identify it.
    return (
      <Stack spacing={2}>
        <Alert severity="warning">
          {result.summary.reason || "No matching PO found."} Extracted details below.
        </Alert>
        <ExtractedFallback extracted={result.extracted} />
      </Stack>
    );
  }

  return (
    <Stack spacing={2}>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 2, flexWrap: "wrap" }}>
        <Box>
          <Typography variant="body2" color="text.secondary">Matched to</Typography>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}>
            <Button size="small" variant="text" onClick={() => onOpenOrder(result.match!.orderId)} sx={{ p: 0, minWidth: 0, textTransform: "none" }}>
              <Typography variant="body1" sx={{ fontWeight: 600 }}>{result.match.orderNumber || "(order)"}</Typography>
            </Button>
            {result.match.orderType && (
              <Chip size="small" variant="outlined" label={result.match.orderType} color={result.match.orderType === "Route Order" ? "secondary" : "primary"} />
            )}
            <Chip size="small" label={`PO ${result.match.poDocName || ""}`} variant="outlined" />
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
            {result.match.reason} · confidence {Math.round((result.match.confidence || 0) * 100)}%
          </Typography>
        </Box>
        <Box sx={{ textAlign: "right" }}>
          {result.summary.allOk ? (
            <Chip color="success" icon={<CheckCircleIcon />} label="All checks passed" />
          ) : (
            <Chip color="error" icon={<ErrorIcon />} label={`${result.summary.issueCount} issue${result.summary.issueCount === 1 ? "" : "s"}`} />
          )}
          {!!result.stampedCount && (
            <Box sx={{ mt: 0.5 }}>
              <Chip
                color="success"
                variant="outlined"
                size="small"
                icon={<CheckCircleIcon />}
                label={`${result.stampedCount} line${result.stampedCount === 1 ? "" : "s"} marked ✓ ${result.stamped === "verifiedDo" ? "DO" : "INV"}`}
              />
            </Box>
          )}
        </Box>
      </Box>

      <Divider />

      {result.checks.map((c) => (
        <Box key={c.kind}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
            <Typography variant="subtitle2">{c.label}</Typography>
            {statusChip(c.status)}
          </Stack>
          {c.kind === "items" && <ItemsTable lines={c.details?.lines || []} />}
          {c.kind === "totals" && <TotalsView details={c.details} />}
          {c.kind === "points" && <PointsView details={c.details} />}
        </Box>
      ))}
    </Stack>
  );
}

function ItemsTable({ lines }: { lines: LineRow[] }) {
  return (
    <TableContainer>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Code</TableCell>
            <TableCell align="center">PO qty</TableCell>
            <TableCell align="right">PO unit</TableCell>
            <TableCell align="right">PO amount</TableCell>
            <TableCell align="center">Sup qty</TableCell>
            <TableCell align="right">Sup unit</TableCell>
            <TableCell align="right">Sup amount</TableCell>
            <TableCell align="center">Status</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {lines.length === 0 && (
            <TableRow>
              <TableCell colSpan={8}>
                <Typography variant="body2" color="text.secondary" sx={{ p: 1, textAlign: "center" }}>
                  No items.
                </Typography>
              </TableCell>
            </TableRow>
          )}
          {lines.map((l, i) => (
            <TableRow key={`${l.code || i}-${i}`}>
              <TableCell>
                <Typography variant="body2">{l.code || "—"}</Typography>
                {l.description && <Typography variant="caption" color="text.secondary">{l.description}</Typography>}
              </TableCell>
              <TableCell align="center">{l.po?.qty ?? "—"}</TableCell>
              <TableCell align="right">{l.po ? fmt(l.po.unitPrice) : "—"}</TableCell>
              <TableCell align="right">{l.po ? fmt(l.po.amount) : "—"}</TableCell>
              <TableCell align="center">{l.supplier?.qty ?? "—"}</TableCell>
              <TableCell align="right">{l.supplier?.unitPrice != null ? fmt(l.supplier.unitPrice) : "—"}</TableCell>
              <TableCell align="right">{l.supplier?.amount != null ? fmt(l.supplier.amount) : "—"}</TableCell>
              <TableCell align="center">
                {lineStatusChip(l.status)}
                {l.notes && <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>{l.notes}</Typography>}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function TotalsView({ details }: { details: any }) {
  const po = details?.po || {};
  const sup = details?.supplier || {};
  const row = (label: string, a: any, b: any) => (
    <TableRow>
      <TableCell>{label}</TableCell>
      <TableCell align="right">{fmt(a)}</TableCell>
      <TableCell align="right">{fmt(b)}</TableCell>
    </TableRow>
  );
  return (
    <TableContainer>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell />
            <TableCell align="right">PO (computed)</TableCell>
            <TableCell align="right">Supplier</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {row("Subtotal", po.subtotal, sup.subtotal)}
          {po.lessPoints > 0 && row("Less Points", po.lessPoints, null)}
          {row(`GST${sup.taxPercent ? ` (${sup.taxPercent}%)` : ""}`, po.gst, sup.gst)}
          {row("Total", po.total, sup.total)}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function PointsView({ details }: { details: any }) {
  return (
    <Stack direction="row" spacing={3} sx={{ pl: 1 }}>
      <Typography variant="body2"><b>PO total points:</b> {details?.po ?? "—"}</Typography>
      <Typography variant="body2"><b>Supplier issued:</b> {details?.supplier ?? "—"}</Typography>
      <Typography variant="body2" color={Math.abs(Number(details?.diff || 0)) > 0.5 ? "error.main" : "text.secondary"}>
        <b>Diff:</b> {details?.diff ?? "—"}
      </Typography>
    </Stack>
  );
}

function ExtractedFallback({ extracted }: { extracted: any }) {
  return (
    <Box>
      <Typography variant="subtitle2">Extracted summary</Typography>
      <Typography variant="body2" color="text.secondary">
        {extracted?.docKind || "Unknown"} {extracted?.docNumber || ""} {extracted?.docDate ? `· ${extracted.docDate}` : ""}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        PO ref on doc: {extracted?.customerPoNumber || "—"}
      </Typography>
      <Box sx={{ mt: 1 }}>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Code</TableCell>
                <TableCell>Description</TableCell>
                <TableCell align="center">Qty</TableCell>
                <TableCell align="right">Unit</TableCell>
                <TableCell align="right">Amount</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(extracted?.items || []).map((it: any, i: number) => (
                <TableRow key={i}>
                  <TableCell>{it.code || "—"}</TableCell>
                  <TableCell>{it.description || "—"}</TableCell>
                  <TableCell align="center">{it.quantity ?? "—"}</TableCell>
                  <TableCell align="right">{it.unitPrice != null ? fmt(it.unitPrice) : "—"}</TableCell>
                  <TableCell align="right">{it.amount != null ? fmt(it.amount) : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Box>
    </Box>
  );
}

// ─── Batch verification ─────────────────────────────────────────────────────

const MAX_IN_FLIGHT = 3;

function BatchVerifyDialog({
  files,
  onClose,
  onOpenOrder,
}: {
  files: File[];
  onClose: () => void;
  onOpenOrder: (orderId: string) => void;
}) {
  const { getToken } = useAuth();
  const [rows, setRows] = useState<BatchRowState[]>(() =>
    files.map((f) => ({ id: fileKeyOf(f) + "_" + Math.random().toString(36).slice(2, 6), file: f, status: "queued" })),
  );
  const inFlightRef = useRef(0);
  const cancelledRef = useRef(false);
  // Latest rows visible to the pump (since pump runs outside React's
  // scheduling we need a live ref to know which ids are still queued).
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  // Mutate one row by id. Used by start/done/error transitions.
  const patchRow = (id: string, patch: Partial<BatchRowState>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  // Pull the next queued row, mark it extracting, fire the verify call. On
  // settle, decrement in-flight and recurse so the slot is reused. Bails
  // immediately if cancelled (Cancel pending button) so already-queued items
  // stay frozen instead of marching forward.
  const pump = async () => {
    while (!cancelledRef.current && inFlightRef.current < MAX_IN_FLIGHT) {
      const next = rowsRef.current.find((r) => r.status === "queued");
      if (!next) return;
      inFlightRef.current++;
      patchRow(next.id, { status: "extracting" });
      const token = await getToken().catch(() => null);
      if (!token) {
        patchRow(next.id, { status: "error", error: "Not authenticated" });
        inFlightRef.current--;
        continue;
      }
      runVerifyUpload(next.file, token)
        .then((result) => patchRow(next.id, { status: "done", result, error: undefined }))
        .catch((err) =>
          patchRow(next.id, { status: "error", error: err?.message || "Verification failed", result: undefined }),
        )
        .finally(() => {
          inFlightRef.current--;
          pump();
        });
    }
  };

  // Kick off processing on mount and whenever rows changes (e.g. retry).
  useEffect(() => {
    pump();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const counts = useMemo(() => {
    let matchedOk = 0, matchedMismatch = 0, unmatched = 0, failed = 0, pending = 0;
    for (const r of rows) {
      if (r.status === "queued" || r.status === "extracting") pending++;
      else if (r.status === "error") failed++;
      else if (r.result?.matched) {
        if (r.result.summary.allOk) matchedOk++; else matchedMismatch++;
      } else unmatched++;
    }
    return { matchedOk, matchedMismatch, unmatched, failed, pending };
  }, [rows]);

  const allDone = counts.pending === 0;

  const onRetry = (id: string) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status: "queued", error: undefined, result: undefined } : r)));
    // pump will pick it up via the useEffect on rows.
  };
  const onRemove = (id: string) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
  };
  const cancelPending = () => {
    cancelledRef.current = true;
    // Drop queued rows; leave in-flight running (they've already paid the LLM cost).
    setRows((prev) => prev.filter((r) => r.status !== "queued"));
  };

  return (
    <Dialog open onClose={allDone ? onClose : undefined} maxWidth="lg" fullWidth>
      <DialogTitle sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", pb: 1, gap: 2 }}>
        <Box>
          <Typography variant="h6" sx={{ lineHeight: 1.2 }}>Batch verification</Typography>
          <Typography variant="caption" color="text.secondary">{rows.length} file{rows.length === 1 ? "" : "s"}</Typography>
        </Box>
        <Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap", justifyContent: "flex-end" }}>
          {counts.matchedOk > 0 && <Chip size="small" color="success" icon={<CheckCircleIcon />} label={`${counts.matchedOk} verified`} />}
          {counts.matchedMismatch > 0 && <Chip size="small" color="warning" icon={<WarningAmberIcon />} label={`${counts.matchedMismatch} mismatch`} />}
          {counts.unmatched > 0 && <Chip size="small" color="error" variant="outlined" icon={<HelpOutlineIcon />} label={`${counts.unmatched} no match`} />}
          {counts.failed > 0 && <Chip size="small" color="error" icon={<ErrorIcon />} label={`${counts.failed} failed`} />}
          {counts.pending > 0 && <Chip size="small" variant="outlined" label={`${counts.pending} pending`} />}
        </Stack>
      </DialogTitle>
      <DialogContent dividers sx={{ p: 0 }}>
        {rows.length === 0 && (
          <Box sx={{ p: 3, textAlign: "center" }}>
            <Typography variant="body2" color="text.secondary">All rows removed.</Typography>
          </Box>
        )}
        {rows.map((r) => (
          <BatchRowItem
            key={r.id}
            state={r}
            onRetry={() => onRetry(r.id)}
            onRemove={() => onRemove(r.id)}
            onOpenOrder={onOpenOrder}
          />
        ))}
      </DialogContent>
      <DialogActions>
        {!allDone && (
          <Button color="inherit" onClick={cancelPending}>
            Cancel pending
          </Button>
        )}
        <Button onClick={onClose} disabled={!allDone} variant={allDone ? "contained" : "text"}>
          {allDone ? "Close" : "Working…"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function BatchRowItem({
  state,
  onRetry,
  onRemove,
  onOpenOrder,
}: {
  state: BatchRowState;
  onRetry: () => void;
  onRemove: () => void;
  onOpenOrder: (orderId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { file, status, result, error } = state;
  const terminal = status === "done" || status === "error";
  const matched = status === "done" && !!result?.matched;
  const mismatched = matched && !result!.summary.allOk;
  const unmatched = status === "done" && !result?.matched;
  const stampLabel = result?.stamped === "verifiedDo" ? "DO" : result?.stamped === "verifiedInv" ? "INV" : null;

  // Status badge maps the row's state to an icon + label + colour.
  const badge = (() => {
    if (status === "queued") return <Chip size="small" variant="outlined" label="Queued" />;
    if (status === "extracting")
      return (
        <Chip size="small" color="info" icon={<CircularProgress size={12} color="inherit" />} label="Scanning…" />
      );
    if (status === "error") return <Chip size="small" color="error" variant="outlined" icon={<ErrorIcon />} label="Failed" />;
    if (unmatched) return <Chip size="small" color="error" variant="outlined" icon={<HelpOutlineIcon />} label="No PO found" />;
    if (mismatched) return <Chip size="small" color="warning" icon={<WarningAmberIcon />} label="Verified ⚠" />;
    return <Chip size="small" color="success" icon={<CheckCircleIcon />} label="Verified" />;
  })();

  return (
    <Box sx={{ borderBottom: 1, borderColor: "divider", px: 2, py: 1.25 }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ flexWrap: "wrap" }}>
        {/* Expand chevron: only meaningful once the row has a payload. */}
        <IconButton
          size="small"
          onClick={() => setExpanded((v) => !v)}
          disabled={!terminal}
          sx={{
            transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 120ms ease",
            opacity: terminal ? 1 : 0.3,
          }}
        >
          <ExpandMoreIcon fontSize="small" />
        </IconButton>

        {badge}

        <Tooltip arrow title={file.name}>
          <Typography
            variant="body2"
            sx={{ flex: 1, minWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 500 }}
          >
            {file.name}
          </Typography>
        </Tooltip>

        {/* Summary chips: only meaningful in terminal states. */}
        {matched && (
          <Stack direction="row" spacing={0.5} alignItems="center" sx={{ flexWrap: "wrap" }}>
            {result?.match?.orderNumber && (
              <Chip
                size="small"
                clickable
                variant="outlined"
                color="primary"
                icon={<OpenInNewIcon sx={{ fontSize: 14 }} />}
                label={result.match.orderNumber}
                onClick={() => result.match?.orderId && onOpenOrder(result.match.orderId)}
              />
            )}
            {result?.match?.orderType && (
              <Chip size="small" variant="outlined" label={result.match.orderType} />
            )}
            {stampLabel && (
              <Chip
                size="small"
                color={mismatched ? "warning" : "success"}
                variant={mismatched ? "outlined" : "filled"}
                label={`${result?.stampedCount || 0} ✓ ${stampLabel}`}
              />
            )}
            {mismatched && (
              <Chip
                size="small"
                color="warning"
                variant="outlined"
                label={`${result?.summary.issueCount} issue${result?.summary.issueCount === 1 ? "" : "s"}`}
              />
            )}
          </Stack>
        )}
        {unmatched && (
          <Typography variant="caption" color="text.secondary">
            {result?.extracted?.docKind === "DELIVERY_ORDER" ? "Delivery Order" : result?.extracted?.docKind === "INVOICE" ? "Tax Invoice" : "Document"}
            {result?.extracted?.docNumber ? ` ${result.extracted.docNumber}` : ""}
          </Typography>
        )}
        {status === "error" && (
          <Typography variant="caption" color="error.main" sx={{ flex: 1, minWidth: 0 }}>
            {error || "Failed"}
          </Typography>
        )}

        {/* Retry on failed / unmatched rows; Remove on any terminal row. */}
        {(status === "error" || unmatched) && (
          <Tooltip arrow title="Retry this file">
            <IconButton size="small" onClick={onRetry}>
              <ReplayIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        {terminal && (
          <Tooltip arrow title="Remove from list">
            <IconButton size="small" onClick={onRemove}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      </Stack>

      {/* Expanded details — reuses the existing single-upload renderers so
          the user sees the same items / totals / points tables they'd see
          for a one-off upload. Unmatched rows show the extracted summary
          instead. */}
      <Collapse in={expanded && terminal} timeout="auto" unmountOnExit>
        <Box sx={{ pl: 5, pr: 1, pt: 1.5, pb: 1.5 }}>
          {status === "error" && (
            <Alert severity="error" sx={{ mb: 1 }}>
              {error || "Verification failed"}
            </Alert>
          )}
          {result && (
            <ReportBody result={result} onOpenOrder={onOpenOrder} />
          )}
          {result?.matched && <BatchDownloadStrip result={result} />}
        </Box>
      </Collapse>
    </Box>
  );
}

/**
 * One-chip download strip rendered at the bottom of each matched row's
 * expanded view. The supplier file was uploaded server-side as part of the
 * verify-upload call, so we just need to mint a signed URL via the existing
 * /orders/supplier-doc-url endpoint to open it.
 *
 * Why this lives separately from the per-item Verified chip on the order
 * page: in the batch dialog we're not on the order page; we want a quick
 * download right inside the report.
 */
function BatchDownloadStrip({ result }: { result: VerifyResult }) {
  const { getToken } = useAuth();
  const [busy, setBusy] = useState(false);
  const fileKey = result.supplierFile?.key || null;
  if (!fileKey) return null;

  const openFile = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const token = await getToken();
      const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4040";
      const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
      if (typeof window !== "undefined") {
        const activeOrgId = window.sessionStorage.getItem("aims-admin-active-org");
        if (activeOrgId) headers["X-Active-Org-Id"] = activeOrgId;
      }
      const res = await fetch(`${apiBase}/orders/supplier-doc-url?key=${encodeURIComponent(fileKey)}`, { headers });
      const json = await res.json();
      const url = json?.data?.url ?? json?.url;
      if (url) window.open(url, "_blank", "noopener,noreferrer");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
      <Chip
        size="small"
        variant="outlined"
        color="success"
        icon={busy ? <CircularProgress size={12} color="inherit" /> : <DownloadIcon sx={{ fontSize: 14 }} />}
        label="Download supplier file"
        clickable
        onClick={openFile}
      />
    </Stack>
  );
}
