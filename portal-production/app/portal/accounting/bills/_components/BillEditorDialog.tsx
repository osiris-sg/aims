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
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import { accountTypeLabel, sortAccountsByType } from "@/components/glAccountGrouping";
import CloudSyncIcon from "@mui/icons-material/CloudSync";
import { toast } from "react-toastify";
import { useAccountingApi } from "../../_lib/api";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";
import { useAuth } from "@clerk/nextjs";
import { uploadFile } from "@/helpers/fileUploader";
import { expandUploadFiles, UPLOAD_ACCEPT } from "@/helpers/uploadExpand";
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

type Account = { id: string; code: string; name: string; category: "PNL" | "BALANCE_SHEET"; accountType?: string; isActive: boolean };

type TaxRateOpt = { id: string; code: string; name: string; rate: number; direction: string; isActive: boolean };

type AmountsAre = "EXCLUSIVE" | "INCLUSIVE" | "NO_TAX";

// Bulk upload: each selected file becomes one batch item, reviewed and saved
// one at a time via the ‹ › pager while the rest extract in the background
// (guru 2026-07-26).
type BatchItem = {
  uid: string;
  file: File;
  status: "pending" | "extracting" | "ready" | "error" | "saved";
  form?: FormSnapshot;
  error?: string;
  billId?: string;
  // Extracted vendor name — lets the close-time auto-save resolve/create a
  // placeholder supplier when no supplierId was matched.
  supplierNameGuess?: string;
};

type FormSnapshot = {
  supplierId: string | null;
  billNumber: string;
  billDate: string;
  dueDate: string;
  reference: string;
  description: string;
  taxAmount: string;
  taxManual: boolean;
  amountsAre: AmountsAre;
  taxCode: string;
  lines: LineForm[];
  inboundChannel: string;
  attachments: Attachment[];
};

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
  batchFiles,
  onRefresh,
  kind: kindProp,
}: {
  open: boolean;
  editing: any | null;
  onClose: () => void;
  onSaved: () => void;
  // Pre-expanded files from the "Upload Bills" bulk entry point — opens the
  // dialog straight into batch mode.
  batchFiles?: File[] | null;
  // List refresh that does NOT close the dialog (used after each batch save).
  onRefresh?: () => void;
  // SIN = supplier invoice (default); SPR = supplier purchase return
  // (supplier credit/debit note) — posts the mirrored journal.
  kind?: "SIN" | "SPR";
}) {
  const { request } = useAccountingApi();
  const { getToken } = useAuth();
  const { isXeroDocSyncEnabled } = useOrganizationFeatures();
  // Editing keeps the bill's stored kind; new entries take the chooser's pick.
  const kind: "SIN" | "SPR" = (editing ? editing.kind : kindProp) === "SPR" ? "SPR" : "SIN";
  const kindLabel = kind === "SPR" ? "Supplier Purchase Return" : "Supplier Invoice";
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [saving, setSaving] = useState(false);
  const [syncingXero, setSyncingXero] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewData, setPreviewData] = useState<PreviewResult | null>(null);
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [billNumber, setBillNumber] = useState("");
  const [billDate, setBillDate] = useState(todayIso);
  const [dueDate, setDueDate] = useState("");
  // Free-text Reference — what the bill is FOR (guru 2026-07-24; shown as a
  // list column like every other document type).
  const [reference, setReference] = useState("");
  const [description, setDescription] = useState("");
  const [taxAmount, setTaxAmount] = useState("0");
  const [amountsAre, setAmountsAre] = useState<AmountsAre>("EXCLUSIVE");
  const [taxCode, setTaxCode] = useState("4"); // Input Tax 9% — AP default
  const [taxRates, setTaxRates] = useState<TaxRateOpt[]>([]);
  // True while the Tax field holds a user-typed / extracted / stored value we
  // must not clobber; changing tax code or amounts-are recomputes.
  const taxManualRef = useRef(false);
  const [lines, setLines] = useState<LineForm[]>([newLine()]);
  const [inboundChannel, setInboundChannel] = useState<string>("MANUAL");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Batch (bulk-upload) state. batchRef is the source of truth for the async
  // extraction loop; setBatch mirrors it into React for rendering.
  const [batch, setBatch] = useState<BatchItem[] | null>(null);
  const [batchIdx, setBatchIdx] = useState(0);
  const batchRef = useRef<BatchItem[] | null>(null);
  const batchLoopRunning = useRef(false);
  const batchAbortRef = useRef(false);
  const loadedIdxRef = useRef(-1); // which batch item the visible form belongs to
  // True while close-time auto-save of unreviewed batch items is running.
  const [flushing, setFlushing] = useState(false);

  const isReadOnly = !!editing && editing.status !== "DRAFT" && editing.status !== "PENDING_APPROVAL";

  const loadSuppliersAndAccounts = useCallback(async () => {
    try {
      const [sup, acc, rates] = await Promise.all([
        // Supplier list is a paginated POST (page/limit), not a GET. limit high
        // enough to fill the picker for any org.
        request<any>("/suppliers", { method: "POST", body: JSON.stringify({ page: 1, limit: 1000 }) }),
        request<Account[]>("/accounting/accounts"),
        request<TaxRateOpt[]>("/accounting/tax-rates").catch(() => [] as TaxRateOpt[]),
      ]);
      const supList: Supplier[] = Array.isArray(sup) ? sup : sup?.docs || sup?.data || [];
      setSuppliers(supList);
      setAccounts((acc || []).filter((a) => a.isActive).sort((a, b) => a.code.localeCompare(b.code)));
      setTaxRates((Array.isArray(rates) ? rates : []).filter((t) => t.isActive));
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
      setReference(editing.reference || "");
      setDescription(editing.description || "");
      setTaxAmount(String(editing.taxAmount || 0));
      setAmountsAre((editing.amountsAre as AmountsAre) || "EXCLUSIVE");
      setTaxCode(editing.taxCode || (editing.amountsAre === "NO_TAX" ? "12" : "4"));
      taxManualRef.current = true; // keep the stored tax until code/mode changes
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
      setReference("");
      setDescription("");
      setTaxAmount("0");
      setAmountsAre("EXCLUSIVE");
      setTaxCode("4");
      taxManualRef.current = false;
      setLines([newLine()]);
      setInboundChannel("MANUAL");
      setAttachments([]);
    }
  }, [open, editing, loadSuppliersAndAccounts]);

  const linesSum = useMemo(
    () => lines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0),
    [lines],
  );
  const tax = parseFloat(taxAmount) || 0;
  const selRate = taxRates.find((t) => t.code === taxCode)?.rate ?? 9;
  // INCLUSIVE: line amounts are gross → subtotal nets the tax out, total = gross.
  const subtotal = amountsAre === "INCLUSIVE" ? linesSum - tax : linesSum;
  const totalAmount = amountsAre === "INCLUSIVE" ? linesSum : linesSum + tax;

  // Recompute tax from the selected code whenever amounts change — unless the
  // user typed a tax figure (or it came from extraction / a stored bill).
  useEffect(() => {
    if (isReadOnly || taxManualRef.current) return;
    let t = 0;
    if (amountsAre === "EXCLUSIVE") t = (linesSum * selRate) / 100;
    else if (amountsAre === "INCLUSIVE") t = (linesSum * selRate) / (100 + selRate);
    setTaxAmount(t ? t.toFixed(2) : "0");
  }, [linesSum, amountsAre, selRate, isReadOnly]);

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
  // Extraction + S3 upload for one file, in parallel — the analysed file is
  // kept as the bill's supporting document (not discarded). Never throws for
  // the upload; extraction errors propagate to the caller.
  const fileToDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const extractRaw = async (file: File) => {
    const base64 = await fileToDataUrl(file);
    const mediaType = (file.type || "application/pdf") as any;
    // Settled independently: a failed extraction must not throw away a
    // successful S3 upload (the source file still attaches to the bill).
    const [ex, up] = await Promise.allSettled([
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
    const extracted = ex.status === "fulfilled" ? ex.value : null;
    const uploaded = up.status === "fulfilled" ? up.value : null;
    const extractError =
      ex.status === "rejected"
        ? (ex.reason?.message as string) || "Extraction request failed"
        : extracted
        ? undefined
        : "Claude couldn't read the file";
    return { extracted, uploaded, extractError };
  };

  const handleFile = async (file: File) => {
    setExtracting(true);
    try {
      const { extracted, uploaded, extractError } = await extractRaw(file);
      // Attach the source file regardless of whether extraction succeeded.
      if (uploaded) setAttachments((prev) => [...prev, uploaded]);
      if (!extracted) {
        toast.warn(
          `${extractError || "Couldn't extract"} — ${uploaded ? "file attached, fill in manually" : "fill in manually"}`,
        );
        return;
      }
      // Pre-fill form.
      if (extracted.supplierIdGuess?.id) setSupplierId(extracted.supplierIdGuess.id);
      if (extracted.billNumber) setBillNumber(extracted.billNumber);
      if (extracted.billDate) setBillDate(String(extracted.billDate).slice(0, 10));
      if (extracted.dueDate) setDueDate(String(extracted.dueDate).slice(0, 10));
      if (extracted.taxAmount !== undefined) {
        setTaxAmount(String(extracted.taxAmount || 0));
        taxManualRef.current = true; // extracted actuals win over the computed rate
      }
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

  // ---------- Bulk upload batch ----------
  const syncBatch = () => setBatch(batchRef.current ? [...batchRef.current] : null);

  const captureForm = (): FormSnapshot => ({
    supplierId, billNumber, billDate, dueDate, reference, description,
    taxAmount, taxManual: taxManualRef.current, amountsAre, taxCode,
    lines, inboundChannel, attachments,
  });

  const restoreForm = (fm: FormSnapshot | null) => {
    setSupplierId(fm?.supplierId ?? null);
    setBillNumber(fm?.billNumber ?? "");
    setBillDate(fm?.billDate || todayIso());
    setDueDate(fm?.dueDate ?? "");
    setReference(fm?.reference ?? "");
    setDescription(fm?.description ?? "");
    setTaxAmount(fm?.taxAmount ?? "0");
    taxManualRef.current = fm?.taxManual ?? false;
    setAmountsAre(fm?.amountsAre ?? "EXCLUSIVE");
    setTaxCode(fm?.taxCode ?? "4");
    setLines(fm?.lines?.length ? fm.lines : [newLine()]);
    setInboundChannel(fm?.inboundChannel ?? "UPLOAD");
    setAttachments(fm?.attachments ?? []);
  };

  // Map one file's extraction into a full form snapshot (batch items always
  // start from a blank form, so a full snapshot — not a selective merge — is
  // correct here).
  const extractToSnapshot = async (
    file: File,
  ): Promise<{ form: FormSnapshot; ok: boolean; supplierName?: string; error?: string }> => {
    let extracted: any = null;
    let uploaded: Attachment | null = null;
    let error: string | undefined;
    try {
      const res = await extractRaw(file);
      extracted = res.extracted;
      uploaded = res.uploaded as any;
      error = res.extractError;
    } catch (e: any) {
      error = e?.message || "Extraction failed";
    }
    const form: FormSnapshot = {
      supplierId: extracted?.supplierIdGuess?.id ?? null,
      billNumber: extracted?.billNumber ?? "",
      billDate: extracted?.billDate ? String(extracted.billDate).slice(0, 10) : todayIso(),
      dueDate: extracted?.dueDate ? String(extracted.dueDate).slice(0, 10) : "",
      reference: "",
      description: "",
      taxAmount: extracted?.taxAmount !== undefined ? String(extracted.taxAmount || 0) : "0",
      taxManual: extracted?.taxAmount !== undefined,
      amountsAre: "EXCLUSIVE",
      taxCode: "4",
      lines:
        Array.isArray(extracted?.lines) && extracted.lines.length > 0
          ? extracted.lines.map((l: any) => ({
              uid: Math.random().toString(36).slice(2),
              description: l.description || "",
              quantity: String(l.quantity ?? 1),
              unitPrice: String(l.unitPrice ?? ""),
              amount: String(l.amount ?? ""),
              accountId: null,
            }))
          : [newLine()],
      inboundChannel: "UPLOAD",
      attachments: uploaded ? [uploaded] : [],
    };
    return {
      form,
      ok: !!extracted,
      supplierName: (extracted?.supplierName as string) || undefined,
      error: extracted ? undefined : error || "Couldn't extract — fill in manually",
    };
  };

  // Sequential background loop — one extraction at a time, skipping anything
  // already handled. Safe to call repeatedly (e.g. after adding more files).
  const runBatchLoop = async () => {
    if (batchLoopRunning.current) return;
    batchLoopRunning.current = true;
    try {
      for (;;) {
        const items = batchRef.current;
        if (!items || batchAbortRef.current) return;
        const it = items.find((x) => x.status === "pending");
        if (!it) return;
        it.status = "extracting";
        syncBatch();
        const res = await extractToSnapshot(it.file);
        if (batchAbortRef.current || !batchRef.current) return;
        it.form = res.form;
        it.supplierNameGuess = res.supplierName;
        it.status = res.ok ? "ready" : "error";
        it.error = res.error;
        syncBatch();
      }
    } finally {
      batchLoopRunning.current = false;
    }
  };

  const startBatch = (fs: File[]) => {
    const items: BatchItem[] = fs.map((file) => ({
      uid: Math.random().toString(36).slice(2),
      file,
      status: "pending",
    }));
    batchAbortRef.current = false;
    batchRef.current = items;
    loadedIdxRef.current = -1;
    setBatchIdx(0);
    restoreForm(null); // blank while the first file extracts
    syncBatch();
    void runBatchLoop();
  };

  // Entry for the dialog's own file input (multiple + ZIP). One file with no
  // active batch keeps the classic in-place prefill; anything more becomes a
  // batch (appending to it if one is already running).
  const handleFiles = async (list: FileList | File[]) => {
    const fs = await expandUploadFiles(list);
    if (!fs.length) return;
    if (batchRef.current) {
      const seen = new Set(batchRef.current.map((b) => `${b.file.name}|${b.file.size}`));
      const fresh = fs.filter((x) => !seen.has(`${x.name}|${x.size}`));
      batchRef.current.push(
        ...fresh.map((file) => ({ uid: Math.random().toString(36).slice(2), file, status: "pending" as const })),
      );
      syncBatch();
      void runBatchLoop();
      return;
    }
    if (fs.length === 1) {
      void handleFile(fs[0]);
      return;
    }
    startBatch(fs);
  };

  // Navigate the pager. Persists in-progress edits onto the item being left.
  const gotoBatch = (next: number) => {
    const items = batchRef.current;
    if (!items || next < 0 || next >= items.length) return;
    if (loadedIdxRef.current >= 0 && items[loadedIdxRef.current] && items[loadedIdxRef.current].status !== "extracting" && items[loadedIdxRef.current].status !== "pending") {
      items[loadedIdxRef.current].form = captureForm();
    }
    loadedIdxRef.current = -1;
    if (!items[next].form) restoreForm(null); // target still extracting
    setBatchIdx(next);
    syncBatch();
  };

  // Load the current item's snapshot into the form once its extraction lands.
  useEffect(() => {
    if (!batch) return;
    const it = batch[batchIdx];
    if (!it || loadedIdxRef.current === batchIdx) return;
    if (it.status === "ready" || it.status === "error" || it.status === "saved") {
      restoreForm(it.form ?? null);
      loadedIdxRef.current = batchIdx;
      if (it.status === "error") toast.warn(`${it.file.name}: ${it.error || "couldn't extract"}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batch, batchIdx]);

  // Bulk entry point: files handed in by the bills page's Upload Bills button.
  useEffect(() => {
    if (!open || editing || !batchFiles?.length) return;
    if (batchFiles.length === 1) void handleFile(batchFiles[0]);
    else startBatch(batchFiles);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing, batchFiles]);

  // Tear the batch down when the dialog closes.
  useEffect(() => {
    if (!open) {
      batchAbortRef.current = true;
      batchRef.current = null;
      setBatch(null);
      setBatchIdx(0);
      loadedIdxRef.current = -1;
    }
  }, [open]);

  // Leaving the review halfway must not lose work (guru 2026-07-27): closing
  // with unsaved batch items auto-saves each as an UNCONFIRMED bill so they
  // land in the bills list / Posting Queue for later review.
  //   - extracted items (ready/error with data): saved from their snapshot,
  //     preserving any edits; unmatched suppliers resolve by extracted name
  //     (placeholder created server-side via supplierName).
  //   - not-yet-extracted items: one-shot server pipeline /bills/extract-create.
  //   - items with no supplier at all: skipped, named in a toast.
  const requestClose = () => {
    if (saving || extracting || flushing) return;
    const unsaved = batchRef.current?.filter((i) => i.status !== "saved") ?? [];
    if (unsaved.length === 0) {
      onClose();
      return;
    }
    void flushBatchAndClose();
  };

  const flushBatchAndClose = async () => {
    const items = batchRef.current;
    if (!items) return;
    batchAbortRef.current = true; // halt the background extraction loop
    setFlushing(true);
    // Persist edits on the item currently in the form.
    if (loadedIdxRef.current >= 0) {
      const cur = items[loadedIdxRef.current];
      if (cur && cur.status !== "saved" && cur.status !== "pending" && cur.status !== "extracting") {
        cur.form = captureForm();
      }
    }
    let savedCount = 0;
    const skipped: string[] = [];
    for (const it of items) {
      if (it.status === "saved") continue;
      try {
        if ((it.status === "ready" || it.status === "error") && it.form && (it.form.supplierId || it.supplierNameGuess)) {
          const fm = it.form;
          const rate = taxRates.find((t) => t.code === fm.taxCode)?.rate ?? 9;
          const body: any = {
            supplierId: fm.supplierId || undefined,
            supplierName: fm.supplierId ? undefined : it.supplierNameGuess,
            billNumber:
              fm.billNumber.trim() ||
              `UPLOAD-${new Date().toISOString().slice(0, 10)}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
            billDate: fm.billDate,
            dueDate: fm.dueDate || undefined,
            reference: fm.reference.trim() || undefined,
            description: fm.description || undefined,
            taxAmount: fm.amountsAre === "NO_TAX" ? 0 : parseFloat(fm.taxAmount) || 0,
            amountsAre: fm.amountsAre,
            taxCode: fm.taxCode,
            gstPercent: fm.amountsAre === "NO_TAX" ? 0 : rate,
            lines: fm.lines
              .filter((l) => l.description || parseFloat(l.amount))
              .map((l) => ({
                description: l.description || undefined,
                quantity: parseFloat(l.quantity) || 0,
                unitPrice: parseFloat(l.unitPrice) || 0,
                amount: parseFloat(l.amount) || 0,
                accountId: l.accountId || undefined,
              })),
            inboundChannel: "UPLOAD",
          };
          if (!body.lines.length) body.lines = [{ description: it.file.name, amount: 0 }];
          const created: any = await request("/bills", { method: "POST", body: JSON.stringify(body) });
          if (created?.id && fm.attachments.length) {
            await request(`/bills/${created.id}/attachments`, {
              method: "POST",
              body: JSON.stringify({ files: fm.attachments }),
            }).catch(() => undefined);
          }
          it.status = "saved";
          it.billId = created?.id;
          savedCount++;
        } else if (it.status === "pending" || it.status === "extracting") {
          const base64 = await fileToDataUrl(it.file);
          const token = await getToken();
          const uploaded = token
            ? await uploadFile({ file: it.file, folder: "bills/attachments", token }).catch(() => null)
            : null;
          const created: any = await request("/bills/extract-create", {
            method: "POST",
            body: JSON.stringify({
              base64,
              mediaType: it.file.type || "application/pdf",
              filename: it.file.name,
              attachments: uploaded ? [uploaded] : [],
            }),
          });
          it.status = "saved";
          it.billId = created?.id;
          savedCount++;
        } else {
          skipped.push(it.file.name);
        }
      } catch {
        skipped.push(it.file.name);
      }
      syncBatch();
    }
    setFlushing(false);
    if (savedCount) {
      toast.success(
        `${savedCount} remaining bill${savedCount === 1 ? "" : "s"} saved as unconfirmed — finish reviewing in the Posting Queue`,
      );
    }
    if (skipped.length) toast.warn(`Couldn't save: ${skipped.join(", ")} — upload again or create manually`);
    onSaved(); // close + refresh the list
  };

  const currentItem = batch?.[batchIdx] ?? null;
  const currentExtracting = !!currentItem && (currentItem.status === "pending" || currentItem.status === "extracting");
  const batchBusyCount = batch ? batch.filter((b) => b.status === "pending" || b.status === "extracting").length : 0;
  const batchSavedCount = batch ? batch.filter((b) => b.status === "saved").length : 0;

  const submit = async () => {
    if (!supplierId) return toast.error("Supplier is required");
    if (!billNumber.trim()) return toast.error("Invoice number is required");
    if (lines.length === 0 || lines.every((l) => !l.amount)) return toast.error("Add at least one line");
    setSaving(true);
    try {
      const body = {
        supplierId,
        billNumber: billNumber.trim(),
        billDate,
        kind,
        dueDate: dueDate || undefined,
        reference: reference.trim() || undefined,
        description: description || undefined,
        taxAmount: amountsAre === "NO_TAX" ? 0 : parseFloat(taxAmount) || 0,
        amountsAre,
        taxCode,
        gstPercent: amountsAre === "NO_TAX" ? 0 : selRate,
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
        toast.success(`${kindLabel} updated`);
      } else {
        const created: any = await request("/bills", { method: "POST", body: JSON.stringify(body) });
        billId = created?.id;
        toast.success(`${kindLabel} saved — posted as unconfirmed`);
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
      // Batch mode: mark this item saved, refresh the list behind the dialog,
      // and hop to the next unsaved bill. Only when every item is saved (or
      // there is nothing left to review) does the dialog close.
      if (batchRef.current) {
        const items = batchRef.current;
        const it = items[batchIdx];
        if (it) {
          it.status = "saved";
          it.billId = billId;
          it.form = captureForm();
        }
        onRefresh?.();
        let nextIdx = -1;
        for (let step = 1; step < items.length; step++) {
          const j = (batchIdx + step) % items.length;
          if (items[j].status !== "saved") { nextIdx = j; break; }
        }
        syncBatch();
        if (nextIdx >= 0) gotoBatch(nextIdx);
        else {
          toast.success(`All ${items.length} supplier invoices saved`);
          onSaved();
        }
      } else {
        onSaved();
      }
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
          kind,
          taxAmount: amountsAre === "NO_TAX" ? 0 : parseFloat(taxAmount) || 0,
          totalAmount,
          amountsAre,
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
    <Dialog open={open} onClose={requestClose} fullWidth maxWidth="lg">
      <DialogTitle>
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Stack direction="row" gap={1.5} alignItems="center">
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              {editing ? `${kindLabel} — ${editing.billNumber}` : batch ? `New Supplier Invoices — ${batchIdx + 1} of ${batch.length}` : `New ${kindLabel} (${kind})`}
            </Typography>
            {batch && (
              <>
                <IconButton size="small" onClick={() => gotoBatch(batchIdx - 1)} disabled={batchIdx === 0 || saving || flushing}>
                  <ChevronLeftIcon fontSize="small" />
                </IconButton>
                <IconButton size="small" onClick={() => gotoBatch(batchIdx + 1)} disabled={batchIdx >= batch.length - 1 || saving || flushing}>
                  <ChevronRightIcon fontSize="small" />
                </IconButton>
                <Chip size="small" variant="outlined" label={currentItem?.file.name} sx={{ maxWidth: 240 }} />
                {currentItem?.status === "saved" && <Chip size="small" color="success" label="Saved" />}
                {currentItem?.status === "error" && <Chip size="small" color="warning" label="Extract failed — fill manually" />}
              </>
            )}
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
          <IconButton onClick={requestClose} size="small" disabled={saving || extracting || flushing}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Stack>
      </DialogTitle>

      <DialogContent dividers sx={{ position: "relative" }}>
        {/* While the currently-viewed batch item is still extracting, veil the
            form — its snapshot loads in the moment extraction lands. */}
        {(currentExtracting || flushing) && (
          <Box
            sx={{
              position: "absolute",
              inset: 0,
              zIndex: 5,
              display: "flex",
              flexDirection: "column",
              gap: 1.5,
              alignItems: "center",
              justifyContent: "center",
              bgcolor: (t: any) => alpha(t.palette.background.paper, 0.85),
            }}
          >
            <CircularProgress size={28} />
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              {flushing
                ? `Saving ${batch?.filter((b) => b.status !== "saved").length ?? 0} remaining bill(s) as unconfirmed…`
                : `Extracting ${currentItem?.file.name}…`}
            </Typography>
          </Box>
        )}
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
              {batch ? (
                <>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {batchBusyCount > 0
                      ? `Extracting ${batch.length - batchBusyCount + 1} of ${batch.length} in the background…`
                      : `All ${batch.length} files extracted.`}
                    {batchSavedCount > 0 ? ` ${batchSavedCount} saved.` : ""}
                  </Typography>
                  <Typography variant="caption" sx={{ color: "text.secondary" }}>
                    Use the ‹ › arrows to move between bills — review each one and save it.
                  </Typography>
                </>
              ) : (
                <>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    Drop PDFs or images of supplier invoices — Claude will extract them for you.
                  </Typography>
                  <Typography variant="caption" sx={{ color: "text.secondary" }}>
                    Works on most invoices. Select multiple files or a ZIP to review them one by one.
                  </Typography>
                </>
              )}
            </Box>
            <input
              type="file"
              accept={UPLOAD_ACCEPT}
              multiple
              hidden
              ref={fileInputRef}
              onChange={(e) => {
                if (e.target.files?.length) void handleFiles(e.target.files);
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
              {extracting ? "Extracting..." : batch ? "Add files" : "Upload invoices"}
            </Button>
          </Paper>
        )}

        {currentItem?.status === "error" && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            {currentItem.file.name}: {currentItem.error || "couldn't extract"}.{" "}
            {currentItem.form?.attachments?.length
              ? "The source file is attached below — fill in the details manually and save."
              : "The source file couldn't be attached either — re-add it under Source Documents, then fill in manually."}
          </Alert>
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
            label="Invoice #"
            required
            value={billNumber}
            onChange={(e) => setBillNumber(e.target.value)}
            disabled={isReadOnly}
          />
          <TextField
            size="small"
            type="date"
            label="Invoice date"
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
            label="Reference"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            disabled={isReadOnly}
          />
          <TextField
            size="small"
            label="Notes (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={isReadOnly}
            sx={{ gridColumn: { xs: "1 / -1", md: "1 / 2" } }}
          />
          <TextField
            size="small"
            select
            label="Amounts are"
            value={amountsAre}
            onChange={(e) => {
              const v = e.target.value as AmountsAre;
              setAmountsAre(v);
              taxManualRef.current = false; // mode change → recompute from code
              if (v === "NO_TAX") setTaxCode("12"); // Out-of-Scope Purchases / No GST
              else if (taxCode === "12") setTaxCode("4");
            }}
            disabled={isReadOnly}
          >
            <MenuItem value="EXCLUSIVE">Tax Exclusive</MenuItem>
            <MenuItem value="INCLUSIVE">Tax Inclusive</MenuItem>
            <MenuItem value="NO_TAX">No Tax</MenuItem>
          </TextField>
          <TextField
            size="small"
            select
            label="Tax code"
            value={taxRates.some((t) => t.code === taxCode) ? taxCode : ""}
            onChange={(e) => {
              setTaxCode(e.target.value);
              taxManualRef.current = false; // code change → recompute
            }}
            disabled={isReadOnly || amountsAre === "NO_TAX"}
            SelectProps={{ renderValue: (v) => String(v) }}
          >
            {taxRates.map((t) => (
              <MenuItem key={t.id} value={t.code}>
                {t.code} — {t.name} ({t.rate}%)
              </MenuItem>
            ))}
          </TextField>
          <TextField
            size="small"
            type="number"
            label="Tax (GST)"
            value={taxAmount}
            onChange={(e) => {
              setTaxAmount(e.target.value);
              taxManualRef.current = true;
            }}
            disabled={isReadOnly || amountsAre === "NO_TAX"}
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
                  <TableCell sx={{ verticalAlign: "top" }}>
                    {/* Word-for-word extracted descriptions are multi-line —
                        grow to 8 rows, then scroll inside the field. */}
                    <TextField
                      size="small"
                      fullWidth
                      multiline
                      maxRows={8}
                      placeholder="Line description"
                      value={l.description}
                      onChange={(e) => setLine(l.uid, { description: e.target.value })}
                      disabled={isReadOnly}
                      sx={{ "& .MuiInputBase-root": { alignItems: "flex-start" } }}
                    />
                  </TableCell>
                  <TableCell>
                    <Autocomplete
                      size="small"
                      // Grouped by account type (Fixed Assets, Expenses, …) —
                      // options pre-sorted so each group renders contiguously.
                      options={sortAccountsByType(accounts)}
                      groupBy={(o) => accountTypeLabel(o.accountType)}
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
          <Typography sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 600, minWidth: 100, textAlign: "right" }}>
            {fmt(subtotal)}
          </Typography>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            {amountsAre === "INCLUSIVE" ? "incl. Tax" : "+ Tax"}
          </Typography>
          <Typography sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 600, minWidth: 80, textAlign: "right" }}>
            {fmt(tax)}
          </Typography>
          <Typography variant="body2" sx={{ fontWeight: 700 }}>= Total</Typography>
          <Typography sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 700, minWidth: 110, textAlign: "right" }}>
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
        {/* Sync to Xero — feature-flagged; saved bills only (any status: the
            main use is pushing POSTED bills). Creates/updates a Xero ACCPAY
            DRAFT with mapped account codes and this bill's amounts-are mode. */}
        {editing?.id && isXeroDocSyncEnabled && (
          <Button
            variant="outlined"
            startIcon={syncingXero ? <CircularProgress size={14} color="inherit" /> : <CloudSyncIcon />}
            onClick={async () => {
              setSyncingXero(true);
              try {
                const res: any = await request(`/documents/${editing.id}/sync-to-xero`, { method: "POST" });
                if (res?.success) {
                  toast.success(`${res.action === "updated" ? "Updated in Xero" : "Created in Xero"}: ${res.xeroInvoiceNumber || "(auto number)"} — ${res.xeroStatus || "DRAFT"}`);
                } else {
                  throw new Error(res?.message || "Xero sync failed");
                }
              } catch (e: any) {
                toast.error(e?.message || "Failed to sync to Xero");
              } finally {
                setSyncingXero(false);
              }
            }}
            disabled={saving || extracting || syncingXero}
            sx={{ mr: "auto" }}
          >
            {syncingXero ? "Syncing..." : "Sync to Xero"}
          </Button>
        )}
        <Button onClick={requestClose} disabled={saving || extracting || flushing}>
          Cancel
        </Button>
        {!isReadOnly && (
          <Button
            variant="outlined"
            startIcon={<AutoAwesomeIcon />}
            onClick={openReview}
            disabled={saving || extracting || flushing || currentExtracting}
          >
            Review
          </Button>
        )}
        {!isReadOnly && (
          <Button
            variant="contained"
            onClick={submit}
            disabled={saving || extracting || flushing || currentExtracting || currentItem?.status === "saved"}
            startIcon={saving ? <CircularProgress size={14} color="inherit" /> : undefined}
          >
            {editing ? "Save changes" : currentItem?.status === "saved" ? "Saved" : batch ? `Save invoice ${batchIdx + 1} of ${batch.length}` : "Save"}
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
