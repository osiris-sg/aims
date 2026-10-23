/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Steps of one order or shipment as cards (the order page's timeline).
// Steps that don't apply to the customer (profile) fold to a greyed
// "N/A (customer profile)" line; "sent" sub-tasks (Sent to customer …) are
// ticked by hand or by the email intake and never block a step. Invoice #2 /
// the single invoice ask which shipments of the customer they cover.
//
// There is no Start: the current step (first one not done) is the large open
// card; done steps fold to one line ("✓ 1. Set up PI payment · user · date",
// click to view / reopen); later steps are greyed one-liners (click to look
// ahead — documents can arrive early). Each required document is a full row:
//   - received documents: title + hint + a large drop zone ("Choose file");
//     once there, a green row with the first-page thumbnail · View · Replace;
//   - documents ADH makes in-app (Invoice #1 / #2, Customer PL / COA, SG→JP,
//     shipping instructions): a big "Create …" button, then Draft / Finalized
//     + Open (only Finalized — or a confirmed linked invoice — counts);
//   - record fields (shipment step 2: B/L no. + product line): the inline B/L
//     form passed in as `fieldsForm`.
// When every required row is done the server completes the step by itself
// (the page toasts it and opens the next card). Steps with nothing required
// get "Mark done"; a reopened step waits for "Mark done" (or a changed
// document). Optional documents sit under a collapsed "Optional" heading: the
// step's own optional types (step 3: extra PL / COA …), only files uploaded
// for this step, and they can still be added once the step is done. Every
// file / in-app document shows its document ID (454003255-1-CPL).

import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Box, Button, ButtonBase, Checkbox, Chip, CircularProgress, Collapse, Dialog, DialogActions, DialogContent, DialogTitle, Divider, FormControlLabel, List, ListItemButton, ListItemIcon, ListItemText, Menu, MenuItem, Paper, Stack, Tooltip, Typography } from "@mui/material";
import BlockIcon from "@mui/icons-material/Block";
import MailOutlineIcon from "@mui/icons-material/MailOutline";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import FiberManualRecordIcon from "@mui/icons-material/FiberManualRecord";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import CloudUploadOutlinedIcon from "@mui/icons-material/CloudUploadOutlined";
import PostAddIcon from "@mui/icons-material/PostAdd";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import LinkIcon from "@mui/icons-material/Link";
import DownloadIcon from "@mui/icons-material/Download";
import { toast } from "../_lib/toast";
import { PAYMENT_GATED_STEPS, paymentOf, useShipmentsApi, type BlCheckSummary, type GeneratedDoc, type GenSource, type RecordDocLink, type RecordFileLink, type TradeFile, type TradeStep } from "../_lib/api";
import { useDocTypeLabels, useShipments, useTradeMutation } from "../_lib/hooks";
import { documentHref, fmtDate, fmtDateTime, GENERATED_DOC_TYPES, INVOICE_DOC_TYPES, stepLabel } from "../_lib/format";
import { doneTooltip } from "../_lib/order-focus";
import { ConfirmDialog } from "./bits";
import BlCheckPanel from "./BlCheckPanel";
import FileUploadDialog, { type LinkTarget } from "./FileUploadDialog";
import { FileThumb, useFileViewer } from "./FilePreview";
import LinkInvoiceDialog from "./LinkInvoiceDialog";
import { DocLinkChip } from "./LinkedDocuments";
import BulkDropDialog, { bulkDocTypes } from "./BulkDropDialog";

/** One short line under each document title (what it is / where it comes from). */
const DOC_HINTS: Record<string, string> = {
  CONTRACT: "The signed sales contract, if there is one",
  PI: "Vedanta's proforma invoice",
  DEPOSIT_PROOF: "Bank transfer slip for the PI deposit",
  INVOICE_1: "ADH 請求書 to the customer for the advance",
  BL_DRAFT: "Draft B/L from Vedanta — consignee and notify party are checked against the contract",
  BL: "The final B/L",
  CI: "Vedanta's commercial invoice",
  PL: "Vedanta's packing list (PDF or the .XLS export)",
  COA: "Vedanta's certificate of analysis",
  COO: "Certificate of origin",
  INSURANCE: "Insurance certificate",
  CUSTOMER_PL: "計量検収票 for the customer, made from Vedanta's packing list",
  CUSTOMER_COA: "納品書兼分析試験成績報告書, made from Vedanta's COA",
  CI_PAYMENT_PROOF: "Bank transfer slip for the CI balance",
  SGJP_IV_PL: "SG→JP invoice & packing list for Japanese customs",
  TAX_ESTIMATE: "Import tax estimate from the customs broker",
  ARRIVAL_NOTICE: "Arrival notice from the shipping line",
  SHIPPING_INSTRUCTIONS: "出庫・納入依頼書 to the warehouse",
  TELEX_RELEASE: "Telex release / surrender notice",
  DELIVERY_SCHEDULE: "The customer's delivery schedule",
  IMPORT_PERMIT: "Import permit (輸入許可書)",
  INVOICE_2: "ADH 請求書 for the final price, customs and transport (2回目) — can cover several shipments of the customer",
  INVOICE_SINGLE: "ADH 請求書 (one invoice, Kato / Hoei): billet + 通関、車輸送料 + 通関 — once the B/L and CI are in",
  VENDOR_INVOICE: "Warehouse / transport invoices (e.g. Mitsui Soko)",
  PAYMENT_PROOF: "Bank transfer slip for those invoices",
  OTHER: "Anything else for this step",
};

export type StepContext = {
  /** Line under the step title (record facts). */
  stepLine?: (s: TradeStep) => string | null;
  /** Line under a document's title (e.g. "Deposit 10% = USD 47,867.40, due 03/07/2026"). */
  docLine?: (docType: string) => string | null;
};

type DocState = { done: boolean; files: RecordFileLink[]; docs: RecordDocLink[]; gens: GeneratedDoc[] };

export default function StepCards({
  steps,
  owner,
  fileLinks,
  docLinks,
  generatedDocs = [],
  recordOpen,
  returnTo,
  openId,
  onOpen,
  context = {},
  fieldsForm,
  fieldsSummary,
  fieldsTitle = "Details",
  blCheck = null,
  numberFrom,
  onFileUploaded,
  stepExtra,
  customerId,
  orderShipmentIds = [],
  highlightFile = null,
}: {
  /** Round AF: the file (by name) to highlight and scroll to inside the opened step — from ?file= on the order page. */
  highlightFile?: string | null;
  steps: TradeStep[];
  owner: LinkTarget;
  fileLinks: RecordFileLink[];
  docLinks: RecordDocLink[];
  generatedDocs?: GeneratedDoc[];
  recordOpen: boolean;
  /** Where the in-app editor's Back returns. */
  returnTo: string;
  /** The expanded card (controlled by the page so only one card is open across the deal). */
  openId: string | null;
  onOpen: (stepId: string | null) => void;
  context?: StepContext;
  /** Inline form for a step's required fields (shipment step 2: the B/L details). */
  fieldsForm?: (s: TradeStep) => React.ReactNode;
  /** One-line summary of those fields once filled ("B/L 198GX04822 · 6063 · 300 MT"). */
  fieldsSummary?: string | null;
  /** Title of that row ("B/L details"). */
  fieldsTitle?: string;
  blCheck?: BlCheckSummary | null;
  /** Position numbering fallback offset (steps without the org's own number). */
  numberFrom?: number;
  /** After a file is uploaded on a row (the deal page reads a B/L draft / arrival notice with AI). */
  onFileUploaded?: (docType: string, files: TradeFile[]) => void;
  /** A panel under a step's rows (estimator on steps 7 / 8 / 12, reconciliation on 13). */
  stepExtra?: (s: TradeStep) => React.ReactNode;
  /** The record's customer (the covers picker lists its other shipments). */
  customerId?: string | null;
  /** On an order: its shipments (step 11's invoice covers them by default). */
  orderShipmentIds?: string[];
}) {
  const api = useShipmentsApi();
  const router = useRouter();
  const label = useDocTypeLabels();
  const { open: view, viewer } = useFileViewer();
  const [upload, setUpload] = useState<{ step: TradeStep; docType: string; files?: File[]; replace?: RecordFileLink; optional?: boolean } | null>(null);
  const [linkExisting, setLinkExisting] = useState<{ step: TradeStep; docType: string } | null>(null);
  const [more, setMore] = useState<{ pos: { left: number; top: number }; step: TradeStep; docType: string; sources: GenSource[] | null } | null>(null);
  const [pickSource, setPickSource] = useState<{ docType: string; sources: GenSource[] } | null>(null);
  const [creating, setCreating] = useState<string | null>(null);
  const [reopenAsk, setReopenAsk] = useState<TradeStep | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [optOpen, setOptOpen] = useState<Record<string, boolean>>({});
  // Bulk upload with AI sorting: files dropped on a step's "Drop all documents here" zone.
  const [bulk, setBulk] = useState<{ step: TradeStep; files: File[] } | null>(null);

  const change = useTradeMutation((a, v: { id: string; action: "complete" | "reopen" }) => (v.action === "complete" ? a.completeStep(v.id) : a.reopenStep(v.id)));
  const tick = useTradeMutation((a, v: { id: string; key: string; done: boolean }) => a.setSubtask(v.id, v.key, v.done));
  // Invoice #2 / single invoice: which shipments of the customer it covers (picked before creating it).
  const [covers, setCovers] = useState<{ docType: string } | null>(null);
  const removeOld = useTradeMutation(async (a, old: RecordFileLink) => {
    const after = await a.removeLink(old.file.id, old.id);
    // Linked nowhere else: the replaced file goes; otherwise it stays on the other records.
    if (!after.links.length) await a.deleteFile(old.file.id);
  });

  const sorted = [...steps].sort((a, b) => a.sortOrder - b.sortOrder);
  const main = sorted.filter((s) => !s.isOngoing);
  // Numbering ignores N/A steps only when the org has no own step numbers (displayNo).
  const ongoing = sorted.filter((s) => s.isOngoing);
  const titleOf = (s: TradeStep) => stepLabel(s, s.isOngoing ? undefined : (numberFrom ?? 0) + main.indexOf(s) + 1);
  const editorHref = (id: string) => `/portal/trade-documents/generated/${id}?from=${encodeURIComponent(returnTo)}`;
  // Step 11 is the order's (round H): its Invoice #2 / single invoice is made for the order's shipments.
  const canCreate = (docType: string) => GENERATED_DOC_TYPES[docType]?.scope === owner.kind || (owner.kind === "order" && !!GENERATED_DOC_TYPES[docType]?.covers && orderShipmentIds.length > 0);

  const reqOf = (s: TradeStep, docType: string) => s.requirements?.find((r) => r.docType === docType);
  const byAge = (a: RecordFileLink, b: RecordFileLink) => a.file.createdAt.localeCompare(b.file.createdAt);
  const isOptional = (s: TradeStep, docType: string) => (s.optionalDocTypes ?? []).includes(docType);
  /** A required row: every file of its type on the record — just the first when the type is also optional here (the rest show under Optional). */
  const stateOf = (s: TradeStep, docType: string): DocState => {
    const all = fileLinks.filter((l) => l.file.docType === docType).sort(byAge);
    const files = isOptional(s, docType) && s.requiredDocTypes.includes(docType) ? all.slice(0, 1) : all;
    const docs = docLinks.filter((l) => l.docType === docType);
    const gens = generatedDocs.filter((g) => g.docType === docType);
    const r = reqOf(s, docType);
    return { done: r ? r.satisfied : files.length > 0 || docs.some((d) => d.satisfies), files, docs, gens };
  };
  // Round AF: once the step card with the highlighted file is open, scroll that file row into view (one time). A file
  // that sits in the card's collapsed "Optional (n)" group (a second vendor invoice, an extra delivery note) opens it.
  const scrolledFile = useRef<string | null>(null);
  useEffect(() => {
    if (!highlightFile || !openId) return;
    const link = fileLinks.find((l) => l.file.fileName === highlightFile);
    const step = steps.find((x) => x.id === openId);
    if (link && step && !optOpen[openId]) {
      const inRequiredRow = step.requiredDocTypes.some((dt) => stateOf(step, dt).files.some((l) => l.id === link.id));
      if (!inRequiredRow) setOptOpen((o) => ({ ...o, [openId]: true }));
    }
    if (scrolledFile.current === `${openId}:${highlightFile}`) return;
    const t = setTimeout(() => {
      const el = document.querySelector('[data-tour="file-highlight"]');
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        scrolledFile.current = `${openId}:${highlightFile}`;
      }
    }, 450);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightFile, openId, fileLinks, optOpen]);
  /** An optional row: only files uploaded for this step (plus a required type's extra files). */
  const optionalStateOf = (s: TradeStep, docType: string): DocState => {
    const required = s.requiredDocTypes.includes(docType) ? stateOf(s, docType).files.map((l) => l.id) : [];
    const files = fileLinks.filter((l) => l.file.docType === docType && !required.includes(l.id) && (l.stepId === s.id || required.length > 0)).sort(byAge);
    return { done: files.length > 0, files, docs: [], gens: [] };
  };
  const fieldsDone = (s: TradeStep) => (s.fieldRequirements ?? []).every((f) => f.satisfied);
  const stillNeeded = (s: TradeStep) => [
    ...s.requiredDocTypes.filter((d) => !stateOf(s, d).done).map(label),
    ...(s.fieldRequirements ?? []).filter((f) => !f.satisfied).map((f) => f.label),
    // A paying step stays open until its payment (amount, date, account) is saved below.
    ...(PAYMENT_GATED_STEPS.has(s.code) && !s.notApplicable && !paymentOf(s) ? ["the payment (amount, date, account)"] : []),
  ];
  const hasRequirements = (s: TradeStep) => s.requiredDocTypes.length > 0 || (s.requiredFields?.length ?? 0) > 0;

  const run = async (s: TradeStep, action: "complete" | "reopen") => {
    setBusyId(s.id);
    try {
      await change.mutateAsync({ id: s.id, action });
    } catch (e: any) {
      toast.error(e?.message || "Could not update the step");
    } finally {
      setBusyId(null);
    }
  };

  const createBlank = async (docType: string, coversShipmentIds?: string[]) => {
    // Invoice #2 / single invoice on a shipment: ask which of the customer's shipments it covers first.
    const covers = !!GENERATED_DOC_TYPES[docType]?.covers;
    if (!coversShipmentIds && covers && (owner.kind === "shipment" || owner.kind === "order")) return setCovers({ docType });
    setCreating(docType);
    try {
      const g = await api.createBlankGenerated({
        docType,
        // An order's Invoice #2 bills the shipments it covers (the server takes the first as its record).
        ...(owner.kind === "contract"
            ? { contractId: owner.id }
            : owner.kind === "order"
              ? { orderId: owner.id }
              : owner.kind === "supplierOrder"
                ? { supplierOrderId: owner.id }
                : { shipmentId: owner.id }),
        ...(coversShipmentIds ? { coversShipmentIds } : {}),
      });
      router.push(editorHref(g.id));
    } catch (e: any) {
      toast.error(e?.message || "Could not create the document");
      setCreating(null);
    }
  };
  const createFromSource = async (docType: string, sourceFileId: string) => {
    setCreating(docType);
    try {
      const g = await api.createGenerated({ shipmentId: owner.id, docType, sourceFileId });
      router.push(editorHref(g.id));
    } catch (e: any) {
      toast.error(e?.message || "Could not create the document");
      setCreating(null);
    }
  };
  const openMore = (e: React.MouseEvent, s: TradeStep, docType: string) => {
    const fromFile = !!GENERATED_DOC_TYPES[docType]?.source && owner.kind === "shipment";
    setMore({ pos: { left: e.clientX, top: e.clientY }, step: s, docType, sources: fromFile ? null : [] });
    if (fromFile) {
      api
        .generatedSources(owner.id, docType)
        .then((sources) => setMore((m) => (m && m.docType === docType ? { ...m, sources } : m)))
        .catch(() => setMore((m) => (m ? { ...m, sources: [] } : m)));
    }
  };

  // ── rows ─────────────────────────────────────────────────────────────────
  const rowShell = (done: boolean, children: React.ReactNode, key: string) => (
    <Paper
      key={key}
      variant="outlined"
      sx={{
        p: { xs: 1.5, md: 2 },
        borderColor: done ? "success.main" : "divider",
        bgcolor: done ? "rgba(46,125,50,0.06)" : "background.paper",
      }}
    >
      {children}
    </Paper>
  );

  // Round Q: the hint sits in an ⓘ tooltip (and only when it says more than the title); the record facts
  // ("Deposit 10% = …") stay as a line since they are not in the title.
  const rowTitle = (s: TradeStep, docType: string, done: boolean, optional = false) => (
    <Stack direction="row" spacing={1} alignItems="center">
      {done ? <CheckCircleIcon color="success" fontSize="small" /> : <EmptyDot />}
      <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
        {label(docType)}
      </Typography>
      <HintInfo text={hintFor(docType, label(docType))} />
      {optional && <Chip size="small" variant="outlined" label="Optional" />}
    </Stack>
  );
  const rowHint = (docType: string) => {
    const ctx = context.docLine?.(docType);
    if (!ctx) return null;
    return (
      <Box sx={{ ml: 3.5, mt: 0.25 }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {ctx}
        </Typography>
      </Box>
    );
  };

  /** A received document: drop zone until there, then a green row per file. */
  const uploadRow = (s: TradeStep, docType: string, st: DocState, optional = false) =>
    rowShell(
      st.files.length > 0,
      <>
        {rowTitle(s, docType, st.files.length > 0, optional)}
        {rowHint(docType)}
        {st.files.length > 0 ? (
          <Stack spacing={1} sx={{ mt: 1.25, ml: 3.5 }}>
            {st.files.map((l) => (
              <Stack
                key={l.id}
                id={`file-${l.id}`}
                data-tour={highlightFile && l.file.fileName === highlightFile ? "file-highlight" : undefined}
                direction={{ xs: "column", sm: "row" }}
                spacing={1.5}
                alignItems={{ xs: "flex-start", sm: "center" }}
                sx={highlightFile && l.file.fileName === highlightFile ? { p: 1, mx: -1, borderRadius: 1, bgcolor: "rgba(255, 193, 7, 0.16)", outline: "2px solid", outlineColor: "warning.main" } : undefined}
              >
                <FileThumb file={{ id: l.file.id, fileName: l.file.fileName, mimeType: l.file.mimeType, hasThumb: l.file.hasThumb, docRef: l.file.docRef }} width={72} onOpen={view} />
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <DocRef value={l.file.docRef} />
                  <Typography variant="body2" sx={{ fontWeight: 600, wordBreak: "break-word" }}>
                    {l.file.fileName}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {l.file.uploadedByName ? `${l.file.uploadedByName} · ` : ""}
                    {fmtDateTime(l.file.createdAt)}
                  </Typography>
                </Box>
                <Stack direction="row" spacing={1}>
                  <Button size="small" variant="outlined" onClick={() => view({ id: l.file.id, fileName: l.file.fileName, mimeType: l.file.mimeType, hasThumb: l.file.hasThumb, docRef: l.file.docRef })}>
                    View
                  </Button>
                  {recordOpen && (
                    <Button size="small" variant="outlined" onClick={() => setUpload({ step: s, docType, replace: l })}>
                      Replace
                    </Button>
                  )}
                </Stack>
              </Stack>
            ))}
            {recordOpen && (
              <Box>
                <Button size="small" startIcon={<UploadFileIcon />} onClick={() => setUpload({ step: s, docType, optional })}>
                  Add another file
                </Button>
              </Box>
            )}
          </Stack>
        ) : recordOpen ? (
          <DropZone onFiles={(files) => setUpload({ step: s, docType, files, optional })} />
        ) : (
          <Typography variant="body2" color="text.secondary" sx={{ ml: 3.5, mt: 1 }}>
            Not uploaded
          </Typography>
        )}
      </>,
      `${s.id}-${docType}`,
    );

  /** A document ADH makes in-app: Create, then Draft / Finalized + Open. */
  const createRow = (s: TradeStep, docType: string, st: DocState) => {
    const spec = GENERATED_DOC_TYPES[docType];
    const gensFinal = st.gens.filter((g) => g.status === "FINAL");
    const showCreate = recordOpen && (!st.gens.length || spec?.multiple) && !(st.done && !spec?.multiple);
    // An invoice linked from Sales (not made in-app here) shows as its own line.
    const linkedOnly = st.docs.filter((d) => !st.gens.some((g) => g.documentId === d.documentId));
    return rowShell(
      st.done,
      <>
        {rowTitle(s, docType, st.done)}
        {rowHint(docType)}
        <Stack spacing={1} sx={{ mt: 1.25, ml: 3.5 }}>
          {st.gens.map((g) => (
            <Stack key={g.id} direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems={{ xs: "flex-start", sm: "center" }}>
              {g.finalFileId ? (
                <FileThumb file={{ id: g.finalFileId, fileName: `${g.number ?? label(docType)}.pdf`, mimeType: "application/pdf", docRef: g.docRef }} width={72} onOpen={view} />
              ) : null}
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <DocRef value={g.docRef} />
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {g.number ?? label(docType)}
                  </Typography>
                  <Chip size="small" color={g.status === "FINAL" ? "success" : "warning"} variant="outlined" label={g.status === "FINAL" ? "Finalized" : "Draft — finalize to count"} />
                </Stack>
                <Typography variant="caption" color="text.secondary">
                  {g.createdByName ? `${g.createdByName} · ` : ""}
                  {fmtDateTime(g.updatedAt)}
                </Typography>
              </Box>
              <Stack direction="row" spacing={1}>
                <Button size="small" variant="contained" onClick={() => router.push(editorHref(g.id))}>
                  Open
                </Button>
                <Button size="small" variant="outlined" startIcon={<DownloadIcon />} onClick={() => void api.downloadGeneratedPdf(g.id).catch((e) => toast.error(e?.message || "Could not download the PDF"))}>
                  PDF
                </Button>
              </Stack>
            </Stack>
          ))}
          {linkedOnly.map((d) => (
            <Box key={d.id}>
              <DocLinkChip link={d} onClick={d.document ? () => router.push(documentHref(d.document!, returnTo)) : undefined} />
            </Box>
          ))}
          {/* Uploaded instead of made in-app (e.g. a scan). */}
          {st.files
            .filter((l) => !gensFinal.some((g) => g.finalFileId === l.file.id) && !st.docs.some((d) => d.inAppFileId === l.file.id))
            .map((l) => (
              <Stack key={l.id} direction="row" spacing={1.5} alignItems="center">
                <FileThumb file={{ id: l.file.id, fileName: l.file.fileName, mimeType: l.file.mimeType, hasThumb: l.file.hasThumb, docRef: l.file.docRef }} width={72} onOpen={view} />
                <Box sx={{ minWidth: 0 }}>
                  <DocRef value={l.file.docRef} />
                  <Typography variant="body2" sx={{ fontWeight: 600, wordBreak: "break-word" }}>
                    {l.file.fileName}
                  </Typography>
                </Box>
              </Stack>
            ))}
          {showCreate && (
            <CreateButtons
              docType={docType}
              shipmentId={owner.kind === "shipment" && spec?.source ? owner.id : null}
              creating={creating}
              blankLabel={st.gens.length && spec?.multiple ? `Create another ${label(docType)}` : (spec?.createLabel ?? `Create ${label(docType)}`)}
              onBlank={() => void createBlank(docType)}
              onSource={(id) => void createFromSource(docType, id)}
              onMore={(e) => openMore(e, s, docType)}
            />
          )}
        </Stack>
      </>,
      `${s.id}-${docType}`,
    );
  };

  /** Required record fields (shipment step 2's B/L details): the inline form, or its summary once filled. */
  const fieldsRow = (s: TradeStep) => {
    const done = fieldsDone(s);
    return rowShell(
      done,
      <FieldsRow title={fieldsTitle} done={done} summary={fieldsSummary ?? null} canEdit={recordOpen} form={fieldsForm?.(s) ?? null} labels={(s.fieldRequirements ?? []).filter((f) => !f.satisfied).map((f) => f.label)} />,
      `${s.id}-fields`,
    );
  };

  // ── cards ────────────────────────────────────────────────────────────────
  const card = (s: TradeStep) => {
    const isDone = s.status === "DONE";
    const needed = stillNeeded(s);
    const optional = (s.optionalDocTypes ?? []).filter((d) => !s.requiredDocTypes.includes(d));
    // Other files tagged with this step that no row shows (e.g. an extra type uploaded from the Files tab).
    const shownTypes = new Set([...s.requiredDocTypes, ...optional]);
    const extra = fileLinks.filter((l) => l.stepId === s.id && !shownTypes.has(l.file.docType));
    const canMarkDone = recordOpen && !isDone && !s.isOngoing && (!hasRequirements(s) || (!!s.holdOpen && needed.length === 0));
    const line = context.stepLine?.(s);
    // Optional rows: the step's optional types, plus a required type that may repeat (step 3: extra PL / COA).
    const optRows = (s.optionalDocTypes ?? []).filter((d) => !s.requiredDocTypes.includes(d) || isOptional(s, d));
    const optCount = optRows.reduce((n, d) => n + optionalStateOf(s, d).files.length, 0) + extra.length;
    return (
      <Paper
        id={`step-${s.id}`}
        key={s.id}
        elevation={0}
        sx={{ p: { xs: 1.5, md: 2.5 }, border: 2, borderColor: isDone ? "success.main" : "primary.main", borderRadius: 2, scrollMarginTop: 96 }}
      >
        <Stack direction="row" spacing={1.5} alignItems="flex-start">
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Stack direction="row" spacing={0.75} alignItems="center">
              <ButtonBase onClick={() => onOpen(null)} sx={{ textAlign: "left", borderRadius: 1 }}>
                <Typography variant="h6" sx={{ fontWeight: 800 }}>
                  {isDone ? "✓ " : ""}
                  {titleOf(s)}
                </Typography>
              </ButtonBase>
              {/* Round Q: the record facts under the title moved into an ⓘ tooltip. */}
              <HintInfo text={line} />
            </Stack>
          </Box>
          <Chip
            size="small"
            color={isDone ? "success" : "warning"}
            variant="outlined"
            label={isDone ? "Done" : s.holdOpen ? "Reopened" : s.isOngoing ? "Ongoing" : "In progress"}
          />
        </Stack>

        <Stack spacing={1.25} sx={{ mt: 2 }}>
          {recordOpen && s.requiredDocTypes.filter((d) => !canCreate(d)).length >= 2 && (
            <Box data-tour="step-bulk-drop">
              <DropZone
                big
                title="Drop all documents here"
                hint="Drop every file for this step at once — each is read and sorted into its row (you confirm the types first)."
                onFiles={(files) => setBulk({ step: s, files })}
              />
            </Box>
          )}
          {(s.requiredFields?.length ?? 0) > 0 && fieldsRow(s)}
          {s.requiredDocTypes.map((d) => (canCreate(d) ? createRow(s, d, stateOf(s, d)) : uploadRow(s, d, stateOf(s, d))))}
          {owner.kind === "shipment" && s.code === "BL_DRAFT_APPROVAL" && blCheck && <BlCheckPanel check={blCheck} shipmentId={owner.id} canEdit={recordOpen} />}
          {(s.subtasks ?? []).length > 0 && (
            <Paper variant="outlined" sx={{ px: 2, py: 1 }} data-tour="step-subtasks">
              {(s.subtasks ?? []).map((t) => (
                <Stack key={t.key} direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                  {t.na ? (
                    <Typography variant="body2" color="text.disabled" sx={{ py: 0.75 }}>
                      <BlockIcon sx={{ fontSize: 16, verticalAlign: "-3px", mr: 0.75 }} />
                      {t.label} — N/A (customer profile)
                    </Typography>
                  ) : (
                    <FormControlLabel
                      control={<Checkbox size="small" checked={!!t.done} disabled={!recordOpen || tick.isPending} onChange={(e) => void tick.mutateAsync({ id: s.id, key: t.key, done: e.target.checked }).catch((err) => toast.error(err?.message || "Could not update"))} />}
                      label={<Typography variant="body2">{t.label}</Typography>}
                    />
                  )}
                  {t.done && (
                    <Typography variant="caption" color="text.secondary">
                      {t.source === "EMAIL" ? <MailOutlineIcon sx={{ fontSize: 14, verticalAlign: "-2px", mr: 0.5 }} /> : null}
                      {t.source === "EMAIL" ? "from an email" : t.by ? `by ${t.by}` : ""}
                      {t.at ? ` · ${fmtDateTime(t.at)}` : ""}
                    </Typography>
                  )}
                </Stack>
              ))}
            </Paper>
          )}
          {stepExtra?.(s)}
        </Stack>

        {(optRows.length > 0 || extra.length > 0) && (
          <Box sx={{ mt: 1.5 }}>
            <Button size="small" color="inherit" onClick={() => setOptOpen((o) => ({ ...o, [s.id]: !o[s.id] }))} endIcon={<ExpandMoreIcon sx={{ transform: optOpen[s.id] ? "rotate(180deg)" : "none", transition: "transform .2s" }} />}>
              Optional{optCount ? ` (${optCount})` : ""}
            </Button>
            <Collapse in={!!optOpen[s.id]} unmountOnExit>
              <Stack spacing={1.25} sx={{ mt: 1 }}>
                {optRows.map((d) => uploadRow(s, d, optionalStateOf(s, d), true))}
                {extra.map((l) => (
                  <Stack key={l.id} direction="row" spacing={1.5} alignItems="center">
                    <FileThumb file={{ id: l.file.id, fileName: l.file.fileName, mimeType: l.file.mimeType, hasThumb: l.file.hasThumb, docRef: l.file.docRef }} width={56} onOpen={view} />
                    <Box>
                      <DocRef value={l.file.docRef} />
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {l.file.fileName}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {label(l.file.docType)}
                      </Typography>
                    </Box>
                  </Stack>
                ))}
              </Stack>
            </Collapse>
          </Box>
        )}

        <Divider sx={{ my: 1.5 }} />
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems={{ xs: "flex-start", sm: "center" }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            {!isDone && needed.length > 0 && (
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                Still needed: {needed.join(", ")}
              </Typography>
            )}
            {!isDone && needed.length === 0 && hasRequirements(s) && s.holdOpen && (
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                Everything is here — mark it done, or replace a document first.
              </Typography>
            )}
            {!recordOpen && (
              <Typography variant="body2" color="text.secondary">
                This record is closed — reopen it to change its steps.
              </Typography>
            )}
            <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
              {isDone ? `Done${s.updatedByName ? ` by ${s.updatedByName}` : ""} · ${fmtDateTime(s.completedAt ?? s.updatedAt)}${s.skipReason ? ` · ${s.skipReason}` : ""}` : s.updatedByName ? `Last change by ${s.updatedByName} · ${fmtDateTime(s.updatedAt)}` : ""}
            </Typography>
          </Box>
          {canMarkDone && (
            <Button variant="contained" color="success" size="large" disabled={busyId === s.id} onClick={() => void run(s, "complete")}>
              Mark done
            </Button>
          )}
          {(isDone || s.status === "SKIPPED") && recordOpen && (
            <Button variant="outlined" disabled={busyId === s.id} onClick={() => setReopenAsk(s)}>
              Reopen
            </Button>
          )}
        </Stack>
      </Paper>
    );
  };

  /** Folded line: done (✓ · who · when) or not yet (greyed). */
  const line = (s: TradeStep) => {
    const isDone = s.status === "DONE";
    return (
      <ButtonBase
        id={`step-${s.id}`}
        key={s.id}
        onClick={() => onOpen(s.id)}
        sx={{ width: "100%", justifyContent: "flex-start", textAlign: "left", px: 1.5, py: 1, borderRadius: 1, "&:hover": { bgcolor: "action.hover" }, scrollMarginTop: 96 }}
      >
        <Stack direction="row" spacing={1.25} alignItems="center" sx={{ minWidth: 0, width: "100%" }}>
          {/* Round R: a done step is ✓ + its name; who / when / "imported from the task list" sit on the ✓. */}
          {isDone ? (
            <Tooltip title={doneTooltip(s, fmtDate)} arrow>
              <CheckCircleIcon color="success" fontSize="small" />
            </Tooltip>
          ) : (
            <EmptyDot />
          )}
          <Typography variant="body2" sx={{ fontWeight: isDone ? 600 : 400, color: isDone ? "text.primary" : "text.disabled", flexShrink: 0 }}>
            {titleOf(s)}
          </Typography>
          {!isDone && s.holdOpen && <Chip size="small" variant="outlined" color="warning" label="Reopened" />}
        </Stack>
      </ButtonBase>
    );
  };

  /** A step that doesn't apply to this customer: collapsed, greyed, never blocks. */
  const naLine = (s: TradeStep) => (
    <Box key={s.id} id={`step-${s.id}`} sx={{ px: 1.5, py: 0.75, display: "flex", alignItems: "center", gap: 1.25, opacity: 0.7 }}>
      <BlockIcon fontSize="small" sx={{ color: "text.disabled" }} />
      <Typography variant="body2" color="text.disabled" sx={{ textDecoration: "line-through" }}>
        {titleOf(s)}
      </Typography>
      <Chip size="small" variant="outlined" label="N/A (customer profile)" data-tour="step-na-chip" />
    </Box>
  );

  const item = (s: TradeStep) => (s.notApplicable ? naLine(s) : openId === s.id ? card(s) : line(s));

  return (
    <Box>
      <Stack spacing={0.5}>{main.map(item)}</Stack>
      {ongoing.length > 0 && (
        <Box sx={{ mt: 2 }}>
          <Typography variant="overline" color="text.secondary">
            Ongoing
          </Typography>
          <Stack spacing={0.5}>{ongoing.map(item)}</Stack>
        </Box>
      )}

      <Menu anchorReference="anchorPosition" anchorPosition={more?.pos} open={!!more} onClose={() => setMore(null)}>
        {/* Made from Vedanta's file: the best one is picked (COA summary / .XLS before the test report); the others under "Use a different file". */}
        {more && GENERATED_DOC_TYPES[more.docType]?.source && owner.kind === "shipment" && (
          <MenuItem
            data-tour="create-from-source"
            disabled={more.sources === null || !more.sources.length || !!creating}
            onClick={() => {
              const m = more!;
              setMore(null);
              if (m.sources?.length) void createFromSource(m.docType, m.sources[0].id);
            }}
          >
            <ListItemIcon>{more.sources === null ? <CircularProgress size={16} /> : <PostAddIcon fontSize="small" />}</ListItemIcon>
            <ListItemText
              primary={more.sources?.length ? `Create from ${more.sources[0].label ?? "Vedanta file"}` : "Create from Vedanta file"}
              secondary={
                more.sources === null
                  ? "Finding Vedanta's files…"
                  : !more.sources.length
                    ? `Upload Vedanta's ${GENERATED_DOC_TYPES[more.docType].sourceLabel} (${GENERATED_DOC_TYPES[more.docType].sourceFiles ?? "spreadsheet"}) on this shipment first`
                    : more.sources[0].fileName
              }
            />
          </MenuItem>
        )}
        {more && (more.sources?.length ?? 0) > 1 && (
          <MenuItem
            disabled={!!creating}
            onClick={() => {
              const m = more!;
              setMore(null);
              setPickSource({ docType: m.docType, sources: m.sources!.slice(1) });
            }}
          >
            <ListItemIcon>
              <ExpandMoreIcon fontSize="small" />
            </ListItemIcon>
            Use a different file…
          </MenuItem>
        )}
        <MenuItem
          onClick={() => {
            const m = more!;
            setMore(null);
            setUpload({ step: m.step, docType: m.docType });
          }}
        >
          <ListItemIcon>
            <UploadFileIcon fontSize="small" />
          </ListItemIcon>
          Upload a file instead
        </MenuItem>
        {more && INVOICE_DOC_TYPES.includes(more.docType) && (
          <MenuItem
            onClick={() => {
              const m = more!;
              setMore(null);
              setLinkExisting({ step: m.step, docType: m.docType });
            }}
          >
            <ListItemIcon>
              <LinkIcon fontSize="small" />
            </ListItemIcon>
            Link an existing invoice
          </MenuItem>
        )}
      </Menu>

      <Dialog open={!!pickSource} onClose={() => setPickSource(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Use a different {pickSource ? GENERATED_DOC_TYPES[pickSource.docType]?.sourceLabel : ""} file</DialogTitle>
        <DialogContent dividers>
          <List dense disablePadding>
            {(pickSource?.sources ?? []).map((f) => (
              <ListItemButton
                key={f.id}
                disabled={!!creating}
                onClick={() => {
                  const p = pickSource!;
                  setPickSource(null);
                  void createFromSource(p.docType, f.id);
                }}
              >
                <ListItemText
                  primary={f.label ?? f.fileName}
                  secondary={`${f.label ? `${f.fileName} · ` : ""}${fmtDate(f.createdAt)}${f.uploadedByName ? ` · ${f.uploadedByName}` : ""}`}
                />
              </ListItemButton>
            ))}
          </List>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPickSource(null)}>Cancel</Button>
        </DialogActions>
      </Dialog>

      <FileUploadDialog
        open={!!upload}
        onClose={() => setUpload(null)}
        title={upload ? `${upload.replace ? "Replace" : "Upload"} ${label(upload.docType)}` : undefined}
        docType={upload?.docType}
        stepId={upload?.step.id}
        replacesFileId={upload?.replace?.file.id}
        defaultTargets={[owner]}
        initialFiles={upload?.files ?? null}
        announceSteps={false}
        onUploaded={async (files) => {
          const u = upload;
          if (!u) return;
          if (u.replace) await removeOld.mutateAsync(u.replace);
          onFileUploaded?.(u.docType, files);
        }}
      />
      <BulkDropDialog
        files={bulk?.files ?? null}
        step={bulk?.step ?? null}
        owner={owner}
        docTypes={bulk ? bulkDocTypes(bulk.step, canCreate) : []}
        onClose={() => setBulk(null)}
        onFileUploaded={onFileUploaded}
      />
      <CoversDialog
        open={!!covers}
        docType={covers?.docType ?? ""}
        primaryId={owner.kind === "shipment" ? owner.id : null}
        preselect={owner.kind === "order" ? orderShipmentIds : []}
        customerId={customerId ?? null}
        label={covers ? label(covers.docType) : ""}
        onClose={() => setCovers(null)}
        onConfirm={(ids) => {
          const c = covers!;
          setCovers(null);
          void createBlank(c.docType, ids);
        }}
      />
      <LinkInvoiceDialog open={!!linkExisting} onClose={() => setLinkExisting(null)} docType={linkExisting?.docType ?? ""} stepId={linkExisting?.step.id} owner={owner} />
      <ConfirmDialog
        open={!!reopenAsk}
        title={reopenAsk ? `Reopen step ${titleOf(reopenAsk)}?` : ""}
        body="Files can then be deleted."
        confirmLabel="Reopen step"
        onClose={() => setReopenAsk(null)}
        onConfirm={async () => {
          if (reopenAsk) await change.mutateAsync({ id: reopenAsk.id, action: "reopen" });
        }}
      />
      {viewer}
    </Box>
  );
}

/** The document ID above a file / in-app document ("454003255-1-CPL"). */
function DocRef({ value }: { value?: string | null }) {
  if (!value) return null;
  return (
    <Typography variant="caption" sx={{ display: "block", fontFamily: "monospace", fontWeight: 700, color: "primary.main", letterSpacing: 0.2 }}>
      {value}
    </Typography>
  );
}

/** Large drag-and-drop area with a "Choose file" button (`big`: the step's "Drop all documents here" zone). */
/** Round Q: an empty slot shows a small grey dot (the empty circle looked like a radio button); done = green ✓. */
function EmptyDot() {
  return <FiberManualRecordIcon sx={{ fontSize: 10, color: "text.disabled", mx: "5px" }} />;
}

/** An ⓘ with the helper text in a tooltip — nothing when there is no text. */
function HintInfo({ text }: { text: string | null | undefined }) {
  if (!text) return null;
  return (
    <Tooltip title={text} arrow>
      <InfoOutlinedIcon sx={{ fontSize: 16, color: "text.disabled", cursor: "help" }} />
    </Tooltip>
  );
}

/** A hint only when it says something the title doesn't. */
const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9fff]+/g, "");
export function hintFor(docType: string, title: string): string | null {
  const h = DOC_HINTS[docType];
  if (!h) return null;
  return norm(h) === norm(title) ? null : h;
}

function DropZone({ onFiles, big = false, title, hint }: { onFiles: (files: File[]) => void; big?: boolean; title?: string; hint?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <Box
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const files = Array.from(e.dataTransfer.files ?? []);
        if (files.length) onFiles(files);
      }}
      sx={{
        mt: big ? 0 : 1.25,
        ml: big ? 0 : { xs: 0, sm: 3.5 },
        p: big ? 4 : 3,
        border: 2,
        borderStyle: "dashed",
        borderColor: over ? "primary.main" : big ? "primary.light" : "divider",
        borderRadius: 2,
        bgcolor: over ? "action.hover" : big ? "rgba(46,125,50,0.04)" : "transparent",
        textAlign: "center",
        transition: "border-color .15s, background-color .15s",
      }}
    >
      <CloudUploadOutlinedIcon sx={{ fontSize: big ? 44 : 36, color: big ? "primary.main" : "text.secondary" }} />
      {title && (
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          {title}
        </Typography>
      )}
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        {hint ?? "Drag & drop the file here"}
      </Typography>
      <input
        ref={input}
        type="file"
        hidden
        multiple
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (input.current) input.current.value = "";
          if (files.length) onFiles(files);
        }}
      />
      <Button variant={big ? "outlined" : "contained"} startIcon={<UploadFileIcon />} onClick={() => input.current?.click()}>
        {big ? "Choose files" : "Choose file"}
      </Button>
    </Box>
  );
}

/** The step's record fields: the inline form while open, else the filled summary with Edit. */
function FieldsRow({ title, done, summary, canEdit, form, labels }: { title: string; done: boolean; summary: string | null; canEdit: boolean; form: React.ReactNode; labels: string[] }) {
  const [editing, setEditing] = useState(false);
  const showForm = canEdit && (!done || editing);
  return (
    <>
      <Stack direction="row" spacing={1} alignItems="center">
        {done ? <CheckCircleIcon color="success" fontSize="small" /> : <EmptyDot />}
        <Typography variant="subtitle1" sx={{ fontWeight: 700, flex: 1 }}>
          {title}
        </Typography>
        {done && canEdit && (
          <Button size="small" onClick={() => setEditing((v) => !v)}>
            {editing ? "Close" : "Edit"}
          </Button>
        )}
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ ml: 3.5, mt: 0.25 }}>
        {done && summary ? summary : `Needed: ${labels.join(", ")}`}
      </Typography>
      {showForm && form && <Box sx={{ mt: 1.5 }}>{form}</Box>}
    </>
  );
}

/**
 * Invoice #2 / single invoice: which shipments it bills. The current one is
 * always in; other open, not-yet-invoiced shipments of the same customer can
 * be added (even from other orders: "6005_56.197t+6063_260.224t").
 */
/**
 * Step 4's create buttons: when Vedanta's spreadsheet (PL.XLS / COA.XLS) is already on the shipment, "Create from …"
 * is the primary button and "Create blank" the secondary; else "Create blank" first.
 */
function CreateButtons({
  docType,
  shipmentId,
  creating,
  blankLabel,
  onBlank,
  onSource,
  onMore,
}: {
  docType: string;
  /** Set when the document can be made from a source file on this shipment. */
  shipmentId: string | null;
  creating: string | null;
  blankLabel: string;
  onBlank: () => void;
  onSource: (fileId: string) => void;
  onMore: (e: React.MouseEvent) => void;
}) {
  const api = useShipmentsApi();
  const sources = useQuery({ queryKey: ["trade-generated", "sources", shipmentId, docType], queryFn: () => api.generatedSources(shipmentId!, docType), enabled: !!shipmentId, staleTime: 30_000 });
  const best = (sources.data ?? []).find((x) => x.best && (x.kind === "spreadsheet" || x.kind === "summary")) ?? null;
  const busy = creating === docType;
  const icon = busy ? <CircularProgress size={18} color="inherit" /> : <PostAddIcon />;
  return (
    <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ xs: "stretch", sm: "center" }}>
      {best ? (
        <>
          <Button variant="contained" size="large" startIcon={icon} disabled={!!creating} onClick={() => onSource(best.id)} sx={{ py: 1.25, px: 3 }} data-tour="step-create-from-source">
            Create from {(best.label ?? best.fileName).split(":")[0]}
          </Button>
          <Button variant="outlined" disabled={!!creating} onClick={onBlank}>
            Create blank
          </Button>
        </>
      ) : (
        <Button variant="contained" size="large" startIcon={icon} disabled={!!creating} onClick={onBlank} sx={{ py: 1.25, px: 3 }}>
          {blankLabel}
        </Button>
      )}
      <Button variant="text" endIcon={<ExpandMoreIcon />} onClick={onMore}>
        Other ways
      </Button>
    </Stack>
  );
}

function CoversDialog({
  open,
  docType,
  primaryId,
  preselect = [],
  customerId,
  label,
  onClose,
  onConfirm,
}: {
  open: boolean;
  docType: string;
  /** Opened from a shipment: that shipment (always covered). From the order: null. */
  primaryId: string | null;
  /** From the order: its shipments, ticked to start with. */
  preselect?: string[];
  customerId: string | null;
  label: string;
  onClose: () => void;
  onConfirm: (ids: string[]) => void;
}) {
  // Completed shipments can still be invoiced (step 11 is the order's); cancelled ones can't.
  const list = useShipments({ customerId: customerId ?? undefined, uninvoiced: "true", pageSize: 100 }, open && !!customerId);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const pre = preselect.join(",");
  React.useEffect(() => {
    if (open) setPicked(new Set(primaryId ? [primaryId] : pre ? pre.split(",") : []));
  }, [open, primaryId, pre]);
  const rows = (list.data?.items ?? []).filter((x) => x.status !== "CANCELLED");
  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      if (primaryId) n.add(primaryId);
      return n;
    });
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {label}: which shipments does it cover?
        <Typography variant="body2" color="text.secondary">
          One invoice can bill several shipments of this customer — including shipments of other orders. An order&apos;s step 11 is done once all its shipments are invoiced.
        </Typography>
      </DialogTitle>
      <DialogContent dividers data-tour="invoice-covers-picker">
        {list.isLoading ? (
          <CircularProgress size={22} />
        ) : !rows.length ? (
          <Typography variant="body2">{primaryId ? "Only this shipment is open and not invoiced yet." : "No shipment of this customer is waiting for an invoice."}</Typography>
        ) : (
          <List dense disablePadding>
            {rows.map((x) => (
              <ListItemButton key={x.id} onClick={() => x.id !== primaryId && toggle(x.id)} disabled={x.id === primaryId}>
                <ListItemIcon>
                  <Checkbox edge="start" size="small" checked={picked.has(x.id)} disabled={x.id === primaryId} />
                </ListItemIcon>
                <ListItemText
                  primary={`${x.ref || "Shipment"}${x.blNumber ? ` · B/L ${x.blNumber}` : " · B/L pending"}${x.id === primaryId ? " (this shipment)" : ""}`}
                  secondary={[x.productLine, x.netWeightMt != null ? `${Number(x.netWeightMt).toLocaleString("en-US", { maximumFractionDigits: 3 })} MT net` : null].filter(Boolean).join(" · ")}
                />
              </ListItemButton>
            ))}
          </List>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={() => {
            // Exactly what is ticked (in the list's order where listed), this shipment first.
            const order = (list.data?.items ?? []).map((x) => x.id);
            const ids = [...picked].filter((id) => id !== primaryId).sort((a, b) => (order.indexOf(a) + 1 || 999) - (order.indexOf(b) + 1 || 999));
            onConfirm(primaryId ? [primaryId, ...ids] : ids);
          }}
          disabled={!docType || picked.size === 0}
        >
          Create invoice ({picked.size} shipment{picked.size === 1 ? "" : "s"})
        </Button>
      </DialogActions>
    </Dialog>
  );
}
