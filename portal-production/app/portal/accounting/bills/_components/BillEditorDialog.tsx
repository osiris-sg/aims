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
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
  alpha,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import CloseIcon from "@mui/icons-material/Close";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import { toast } from "react-toastify";
import { useAccountingApi } from "../../_lib/api";
import { useAuth } from "@clerk/nextjs";
import { uploadFile } from "@/helpers/fileUploader";
import AttachmentUploader, { Attachment } from "@/components/AttachmentUploader";
import PostingPreviewDialog, { PreviewResult } from "@/components/PostingPreviewDialog";

// ---------------------------------------------------------------------------
// Create / view bill. Three entry paths:
//   1. Manual: pick supplier, type lines.
//   2. PDF drop: drag a PDF onto the dropzone → Claude extracts → form is
//      pre-filled, user reviews & saves.
//   3. From PO: not in this dialog — invoked from the PO list page (separate
//      action that calls POST /bills/from-po/:id).
// ---------------------------------------------------------------------------

type Supplier = { id: string; name: string; gstRegNo?: string | null };

type LineForm = {
  uid: string;
  description: string;
  quantity: string;
  unitPrice: string;
  amount: string;
  accountId: string | null;
};

type Account = { id: string; code: string; name: string; category: "PNL" | "BALANCE_SHEET"; isActive: boolean };

const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const todayIso = () => new Date().toISOString().slice(0, 10);

const newLine = (): LineForm => ({
  uid: Math.random().toString(36).slice(2),
  description: "",
  quantity: "1",
  unitPrice: "",
  amount: "",
  accountId: null,
});

export default function BillEditorDialog({
  open,
  editing,
  onClose,
  onSaved,
}: {
  open: boolean;
  editing: any | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { request } = useAccountingApi();
  const { getToken } = useAuth();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [saving, setSaving] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewData, setPreviewData] = useState<PreviewResult | null>(null);
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [billNumber, setBillNumber] = useState("");
  const [billDate, setBillDate] = useState(todayIso);
  const [dueDate, setDueDate] = useState("");
  const [description, setDescription] = useState("");
  const [taxAmount, setTaxAmount] = useState("0");
  const [lines, setLines] = useState<LineForm[]>([newLine()]);
  const [inboundChannel, setInboundChannel] = useState<string>("MANUAL");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const isReadOnly = !!editing && editing.status !== "DRAFT" && editing.status !== "PENDING_APPROVAL";

  const loadSuppliersAndAccounts = useCallback(async () => {
    try {
      const [sup, acc] = await Promise.all([
        // Supplier list is a paginated POST (page/limit), not a GET. limit high
        // enough to fill the picker for any org.
        request<any>("/suppliers", { method: "POST", body: JSON.stringify({ page: 1, limit: 1000 }) }),
        request<Account[]>("/accounting/accounts"),
      ]);
      const supList: Supplier[] = Array.isArray(sup) ? sup : sup?.docs || sup?.data || [];
      setSuppliers(supList);
      setAccounts((acc || []).filter((a) => a.isActive).sort((a, b) => a.code.localeCompare(b.code)));
    } catch (e: any) {
      toast.error(e?.message || "Failed to load suppliers/accounts");
    }
  }, [request]);

  useEffect(() => {
    if (!open) return;
    loadSuppliersAndAccounts();
    if (editing) {
      setSupplierId(editing.supplierId ?? editing.supplier?.id ?? null);
      setBillNumber(editing.billNumber || "");
      setBillDate(editing.billDate ? editing.billDate.slice(0, 10) : todayIso());
      setDueDate(editing.dueDate ? editing.dueDate.slice(0, 10) : "");
      setDescription(editing.description || "");
      setTaxAmount(String(editing.taxAmount || 0));
      setInboundChannel(editing.inboundChannel || "MANUAL");
      setAttachments(Array.isArray(editing.attachments) ? editing.attachments : []);
      const ls: any[] = Array.isArray(editing.lines) ? editing.lines : [];
      setLines(
        ls.length > 0
          ? ls.map((l) => ({
              uid: Math.random().toString(36).slice(2),
              description: l.description || "",
              quantity: String(l.quantity ?? 1),
              unitPrice: String(l.unitPrice ?? ""),
              amount: String(l.amount ?? ""),
              accountId: l.accountId || null,
            }))
          : [newLine()],
      );
    } else {
      setSupplierId(null);
      setBillNumber("");
      setBillDate(todayIso());
      setDueDate("");
      setDescription("");
      setTaxAmount("0");
      setLines([newLine()]);
      setInboundChannel("MANUAL");
      setAttachments([]);
    }
  }, [open, editing, loadSuppliersAndAccounts]);

  const subtotal = useMemo(
    () => lines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0),
    [lines],
  );
  const tax = parseFloat(taxAmount) || 0;
  const totalAmount = subtotal + tax;

  const setLine = (uid: string, patch: Partial<LineForm>) => {
    setLines((rows) =>
      rows.map((r) => {
        if (r.uid !== uid) return r;
        const next = { ...r, ...patch };
        // Auto-compute amount if qty + unitPrice both set and amount untouched.
        if ((patch.quantity !== undefined || patch.unitPrice !== undefined) && patch.amount === undefined) {
          const q = parseFloat(next.quantity) || 0;
          const u = parseFloat(next.unitPrice) || 0;
          if (q > 0 && u > 0) next.amount = String(q * u);
        }
        return next;
      }),
    );
  };

  // ---------- PDF / image upload → LLM extract ----------
  const handleFile = async (file: File) => {
    setExtracting(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const mediaType = file.type as any;
      // Run the AI extraction AND the S3 upload in parallel — the analysed file
      // is kept as the bill's supporting document (not discarded).
      const [extracted, uploaded] = await Promise.all([
        request<any>("/bills/extract", { method: "POST", body: JSON.stringify({ base64, mediaType }) }),
        (async () => {
          try {
            const token = await getToken();
            if (!token) return null;
            return await uploadFile({ file, folder: "bills/attachments", token });
          } catch {
            return null; // never block the extract/attach flow on an upload hiccup
          }
        })(),
      ]);
      // Attach the source file regardless of whether extraction succeeded.
      if (uploaded) setAttachments((prev) => [...prev, uploaded]);
      if (!extracted) {
        toast.warn(uploaded ? "File attached, but couldn't extract — fill in manually" : "Couldn't extract — fill in manually");
        return;
      }
      // Pre-fill form.
      if (extracted.supplierIdGuess?.id) setSupplierId(extracted.supplierIdGuess.id);
      if (extracted.billNumber) setBillNumber(extracted.billNumber);
      if (extracted.billDate) setBillDate(String(extracted.billDate).slice(0, 10));
      if (extracted.dueDate) setDueDate(String(extracted.dueDate).slice(0, 10));
      if (extracted.taxAmount !== undefined) setTaxAmount(String(extracted.taxAmount || 0));
      if (Array.isArray(extracted.lines) && extracted.lines.length > 0) {
        setLines(
          extracted.lines.map((l: any) => ({
            uid: Math.random().toString(36).slice(2),
            description: l.description || "",
            quantity: String(l.quantity ?? 1),
            unitPrice: String(l.unitPrice ?? ""),
            amount: String(l.amount ?? ""),
            accountId: null,
          })),
        );
      }
      setInboundChannel("UPLOAD");
      toast.success(`Extracted${uploaded ? " & file attached" : ""} — review and save${extracted.supplierIdGuess ? "" : ". Pick a supplier."}`);
    } catch (e: any) {
      toast.error(e?.message || "Extraction failed");
    } finally {
      setExtracting(false);
    }
  };

  const submit = async () => {
    if (!supplierId) return toast.error("Supplier is required");
    if (!billNumber.trim()) return toast.error("Bill number is required");
    if (lines.length === 0 || lines.every((l) => !l.amount)) return toast.error("Add at least one line");
    setSaving(true);
    try {
      const body = {
        supplierId,
        billNumber: billNumber.trim(),
        billDate,
        dueDate: dueDate || undefined,
        description: description || undefined,
        taxAmount: parseFloat(taxAmount) || 0,
        lines: lines.map((l) => ({
          description: l.description || undefined,
          quantity: parseFloat(l.quantity) || 0,
          unitPrice: parseFloat(l.unitPrice) || 0,
          amount: parseFloat(l.amount) || 0,
          accountId: l.accountId || undefined,
        })),
        inboundChannel,
      };
      let billId: string | undefined;
      if (editing) {
        await request(`/bills/${editing.id}`, { method: "PATCH", body: JSON.stringify(body) });
        billId = editing.id;
        toast.success("Bill updated");
      } else {
        const created: any = await request("/bills", { method: "POST", body: JSON.stringify(body) });
        billId = created?.id;
        toast.success("Bill saved as DRAFT");
      }
      // Persist attachments after we have the bill id. Sends the full list
      // so the backend can dedupe; harmless if no new files were added.
      if (billId && attachments.length > 0) {
        try {
          await request(`/bills/${billId}/attachments`, {
            method: "POST",
            body: JSON.stringify({ files: attachments }),
          });
        } catch (e: any) {
          toast.warn(`Bill saved but attachment update failed: ${e?.message || "unknown"}`);
        }
      }
      onSaved();
    } catch (e: any) {
      toast.error(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  // Open the AI account-review dialog (dry-run — saves/posts nothing).
  const openReview = async () => {
    if (lines.length === 0 || lines.every((l) => !l.amount)) return toast.error("Add at least one line first");
    setPreviewOpen(true);
    setPreviewLoading(true);
    setPreviewData(null);
    try {
      const res = await request<PreviewResult>("/bills/preview-posting", {
        method: "POST",
        body: JSON.stringify({
          billNumber: billNumber.trim(),
          taxAmount: parseFloat(taxAmount) || 0,
          totalAmount,
          lines: lines.map((l) => ({
            description: l.description || undefined,
            amount: parseFloat(l.amount) || 0,
            accountId: l.accountId || undefined,
          })),
        }),
      });
      setPreviewData(res);
    } catch (e: any) {
      toast.error(e?.message || "Couldn't get account suggestions");
      setPreviewOpen(false);
    } finally {
      setPreviewLoading(false);
    }
  };

  // Confirm the review: write the chosen accounts back onto the bill lines and
  // close the dialog. Does NOT save or post — the user keeps editing and saves
  // when ready.
  const applyReview = (picks: Array<{ lineIndex: number; accountId: string | null; accountCode: string | null }>) => {
    const override: Record<number, string | null> = {};
    for (const p of picks) override[p.lineIndex] = p.accountId;
    setLines((rows) => rows.map((r, i) => (i in override ? { ...r, accountId: override[i] } : r)));
    setPreviewOpen(false);
    toast.success("Accounts applied — review and save when ready");
  };

  return (
    <Dialog open={open} onClose={() => !saving && !extracting && onClose()} fullWidth maxWidth="lg">
      <DialogTitle>
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Stack direction="row" gap={1.5} alignItems="center">
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              {editing ? `Bill — ${editing.billNumber}` : "New Bill"}
            </Typography>
            {editing && (
              <Chip
                size="small"
                label={editing.status?.replace("_", " ")}
                variant="outlined"
                color={
                  editing.status === "PAID"
                    ? "success"
                    : editing.status === "POSTED"
                    ? "info"
                    : editing.status === "VOID"
                    ? "error"
                    : "default"
                }
              />
            )}
          </Stack>
          <IconButton onClick={onClose} size="small" disabled={saving || extracting}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Stack>
      </DialogTitle>

      <DialogContent dividers>
        {!editing && (
          <Paper
            variant="outlined"
            sx={{
              p: 1.5,
              mb: 2,
              borderStyle: "dashed",
              borderColor: (t: any) => alpha(t.palette.primary.main, 0.4),
              bgcolor: (t: any) => alpha(t.palette.primary.main, 0.03),
              display: "flex",
              alignItems: "center",
              gap: 2,
            }}
          >
            <AutoAwesomeIcon sx={{ color: "primary.main" }} />
            <Box sx={{ flex: 1 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                Drop a PDF or image of the supplier's bill — Claude will extract it for you.
              </Typography>
              <Typography variant="caption" sx={{ color: "text.secondary" }}>
                Works on most invoices. You'll review the extracted form before saving.
              </Typography>
            </Box>
            <input
              type="file"
              accept="application/pdf,image/*"
              hidden
              ref={fileInputRef}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
                e.target.value = "";
              }}
            />
            <Button
              variant="outlined"
              size="small"
              startIcon={extracting ? <CircularProgress size={14} /> : <UploadFileIcon />}
              disabled={extracting || saving}
              onClick={() => fileInputRef.current?.click()}
            >
              {extracting ? "Extracting..." : "Upload bill"}
            </Button>
          </Paper>
        )}

        {/* Header fields */}
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", md: "2fr 1fr 1fr 1fr" },
            gap: 2,
            mb: 2,
          }}
        >
          <Autocomplete
            size="small"
            options={suppliers}
            value={suppliers.find((s) => s.id === supplierId) || null}
            onChange={(_, v) => setSupplierId(v?.id || null)}
            getOptionLabel={(o) => o.name + (o.gstRegNo ? ` (${o.gstRegNo})` : "")}
            renderInput={(params) => <TextField {...params} label="Supplier" required disabled={isReadOnly} />}
          />
          <TextField
            size="small"
            label="Bill #"
            required
            value={billNumber}
            onChange={(e) => setBillNumber(e.target.value)}
            disabled={isReadOnly}
          />
          <TextField
            size="small"
            type="date"
            label="Bill date"
            InputLabelProps={{ shrink: true }}
            value={billDate}
            onChange={(e) => setBillDate(e.target.value)}
            disabled={isReadOnly}
          />
          <TextField
            size="small"
            type="date"
            label="Due date (optional)"
            InputLabelProps={{ shrink: true }}
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            disabled={isReadOnly}
          />
          <TextField
            size="small"
            label="Notes (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={isReadOnly}
            sx={{ gridColumn: { xs: "1 / -1", md: "1 / 4" } }}
          />
          <TextField
            size="small"
            type="number"
            label="Tax (GST)"
            value={taxAmount}
            onChange={(e) => setTaxAmount(e.target.value)}
            disabled={isReadOnly}
            inputProps={{ step: "0.01", min: 0 }}
          />
        </Box>

        {/* Lines */}
        <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1, overflow: "hidden" }}>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: (t: any) => alpha(t.palette.text.primary, 0.03) }}>
                <TableCell sx={{ fontWeight: 700, width: 40 }}>#</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Description</TableCell>
                <TableCell sx={{ fontWeight: 700, width: 220 }}>Account</TableCell>
                <TableCell align="right" sx={{ fontWeight: 700, width: 80 }}>Qty</TableCell>
                <TableCell align="right" sx={{ fontWeight: 700, width: 110 }}>Unit</TableCell>
                <TableCell align="right" sx={{ fontWeight: 700, width: 120 }}>Amount</TableCell>
                <TableCell sx={{ width: 40 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {lines.map((l, i) => (
                <TableRow key={l.uid}>
                  <TableCell sx={{ color: "text.secondary" }}>{i + 1}</TableCell>
                  <TableCell>
                    <TextField
                      size="small"
                      fullWidth
                      placeholder="Line description"
                      value={l.description}
                      onChange={(e) => setLine(l.uid, { description: e.target.value })}
                      disabled={isReadOnly}
                    />
                  </TableCell>
                  <TableCell>
                    <Autocomplete
                      size="small"
                      options={accounts}
                      value={accounts.find((a) => a.id === l.accountId) || null}
                      onChange={(_, v) => setLine(l.uid, { accountId: v?.id || null })}
                      getOptionLabel={(o) => `${o.code} — ${o.name}`}
                      renderInput={(params) => <TextField {...params} placeholder="Auto" disabled={isReadOnly} />}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <TextField
                      size="small"
                      type="number"
                      value={l.quantity}
                      onChange={(e) => setLine(l.uid, { quantity: e.target.value })}
                      disabled={isReadOnly}
                      inputProps={{ step: "1", min: 0, style: { textAlign: "right" } }}
                      sx={{ width: 70 }}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <TextField
                      size="small"
                      type="number"
                      value={l.unitPrice}
                      onChange={(e) => setLine(l.uid, { unitPrice: e.target.value })}
                      disabled={isReadOnly}
                      inputProps={{ step: "0.01", min: 0, style: { textAlign: "right" } }}
                      sx={{ width: 100 }}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <TextField
                      size="small"
                      type="number"
                      value={l.amount}
                      onChange={(e) => setLine(l.uid, { amount: e.target.value })}
                      disabled={isReadOnly}
                      inputProps={{ step: "0.01", min: 0, style: { textAlign: "right" } }}
                      sx={{ width: 110 }}
                    />
                  </TableCell>
                  <TableCell>
                    <Tooltip title="Remove line">
                      <span>
                        <IconButton
                          size="small"
                          onClick={() => setLines((r) => (r.length <= 1 ? r : r.filter((x) => x.uid !== l.uid)))}
                          disabled={lines.length <= 1 || isReadOnly}
                        >
                          <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>

        <Stack direction="row" alignItems="center" gap={2} sx={{ mt: 1.5 }}>
          <Button startIcon={<AddIcon />} size="small" onClick={() => setLines((r) => [...r, newLine()])} disabled={isReadOnly}>
            Add line
          </Button>
          <Box sx={{ flex: 1 }} />
          <Typography variant="body2" sx={{ color: "text.secondary" }}>Subtotal</Typography>
          <Typography sx={{ fontFamily: "monospace", fontWeight: 600, minWidth: 100, textAlign: "right" }}>
            {fmt(subtotal)}
          </Typography>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>+ Tax</Typography>
          <Typography sx={{ fontFamily: "monospace", fontWeight: 600, minWidth: 80, textAlign: "right" }}>
            {fmt(tax)}
          </Typography>
          <Typography variant="body2" sx={{ fontWeight: 700 }}>= Total</Typography>
          <Typography sx={{ fontFamily: "monospace", fontWeight: 700, minWidth: 110, textAlign: "right" }}>
            {fmt(totalAmount)}
          </Typography>
        </Stack>

        {editing?.matchStatus && editing.matchStatus !== "MATCHED" && (
          <Alert severity="warning" sx={{ mt: 2 }}>
            3-way match: {editing.matchStatus}
            {editing.matchDetails && (
              <Box component="pre" sx={{ fontSize: "0.7rem", mt: 0.5, mb: 0, opacity: 0.85 }}>
                {JSON.stringify(editing.matchDetails, null, 2)}
              </Box>
            )}
          </Alert>
        )}

        {isReadOnly && (
          <Alert severity="info" sx={{ mt: 2 }}>
            This bill is {editing?.status?.replace("_", " ")} — view-only. Void it to make changes.
          </Alert>
        )}

        {/* Attachments — the supplier's original PDF + supporting docs. */}
        <Box sx={{ mt: 3, pt: 2, borderTop: "1px solid", borderColor: "divider" }}>
          <AttachmentUploader
            folder={`bills/${editing?.id || "new"}/source`}
            value={attachments}
            onChange={setAttachments}
            label="Source Documents"
            disabled={isReadOnly}
          />
          {!editing && attachments.length > 0 && (
            <Typography variant="caption" sx={{ color: "text.secondary", mt: 1, display: "block" }}>
              Files will attach after saving.
            </Typography>
          )}
        </Box>
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} disabled={saving || extracting}>
          Cancel
        </Button>
        {!isReadOnly && (
          <Button
            variant="outlined"
            startIcon={<AutoAwesomeIcon />}
            onClick={openReview}
            disabled={saving || extracting}
          >
            Review
          </Button>
        )}
        {!isReadOnly && (
          <Button
            variant="contained"
            onClick={submit}
            disabled={saving || extracting}
            startIcon={saving ? <CircularProgress size={14} color="inherit" /> : undefined}
          >
            {editing ? "Save changes" : "Save as Draft"}
          </Button>
        )}
      </DialogActions>

      <PostingPreviewDialog
        open={previewOpen}
        loading={previewLoading}
        preview={previewData}
        accounts={accounts}
        onClose={() => setPreviewOpen(false)}
        onConfirm={applyReview}
        onLearn={(corrections) =>
          request("/posting-preview/learn", {
            method: "POST",
            body: JSON.stringify({ side: "PURCHASE", corrections }),
          }).catch(() => {})
        }
      />
    </Dialog>
  );
}

// Local Paper import alias used inside the dropzone block.
function Paper({ children, variant, sx }: { children: React.ReactNode; variant?: any; sx?: any }) {
  return (
    <Box
      sx={{
        border: variant === "outlined" ? 1 : 0,
        borderColor: "divider",
        borderRadius: 1.5,
        bgcolor: "background.paper",
        ...sx,
      }}
    >
      {children}
    </Box>
  );
}
