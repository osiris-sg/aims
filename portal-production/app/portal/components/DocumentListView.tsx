"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { request, withActiveOrg } from "@/helpers/request";
import MainCard from "@/components/MainCard";
import PageTable from "@/components/PageTable";
import StatusChip from "@/components/StatusChip";
import { wctStatusOptionsFor } from "@/helpers/wctStatuses";
import { flowStatusOptions } from "@/helpers/wctStatusFlow";
import {
  Stack,
  Chip,
  Box,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Grid,
  IconButton,
  Skeleton,
  Typography,
  Menu,
  MenuItem,
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import CalendarMonthOutlinedIcon from "@mui/icons-material/CalendarMonthOutlined";
import DraftsOutlinedIcon from "@mui/icons-material/DraftsOutlined";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import { Button } from "@mui/material";
import moment from "moment";
import { toast } from "react-toastify";
import DocumentUploadDialog from "./DocumentUploadDialog";
import BulkActionBar from "@/components/BulkActionBar";
import { BulkConfirmDialog, downloadDocumentPdfs, runBulk, useBulkSelection } from "@/components/useBulkSelection";
import DownloadIcon from "@mui/icons-material/Download";
import BlockIcon from "@mui/icons-material/Block";
import { useDeleteDocument, useGetDocumentsPaginated, useGetDocumentStats } from "@/app/portal/hooks/api";
import type { FilterField } from "@/components/FilterDrawer";

// Document statuses (NOT the legacy inventory statuses the old `availableFilters`
// path produced). Customer is appended at runtime.
// Invoices (guru 2026-11-14): never "Confirmed" — Unconfirmed, Awaiting
// Payment, Partially Paid or Paid, nothing else.
const INVOICE_TYPE_SET = new Set(["INVOICE", "TI", "TI2"]);
const DOC_STATUS_OPTIONS = [
  { value: "unconfirmed", label: "Unconfirmed" },
  { value: "confirmed", label: "Confirmed" },
  { value: "pending_delivery", label: "Pending Delivery" },
  { value: "delivered_not_installed", label: "Delivered (Not Installed)" },
  { value: "delivered_installed", label: "Delivered & Installed" },
  { value: "pending_payment", label: "Awaiting Payment" },
  { value: "partially_paid", label: "Partially Paid" },
  { value: "paid", label: "Paid" },
  { value: "pending_return", label: "Pending Return" },
  { value: "returned", label: "Returned" },
  { value: "voided", label: "Voided" },
];
import { useCreateDocumentFlow } from "./useCreateDocumentFlow";
import { docGrossTotal, docPaidToDate, docAmountDue } from "@/helpers/docTotal";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";
import QuotationTemplatesHost from "@/app/portal/components/QuotationTemplates/QuotationTemplatesHost";
import { quotationListTemplates } from "@/helpers/quotationTemplates";
import { documentListSubtitle } from "@/helpers/wctDocUi";
import { invoiceStatusOptions } from "@/helpers/invoiceStatusOptions";
import DoStatusTag from "@/components/DoStatusTag";
import { docDoTag } from "@/helpers/doStatusTag";
import { DEFAULT_PAGE_SIZE } from "@/components/PageTable";
import { SUBJECT_SORT, subjectCell, subjectColumnOn } from "@/helpers/listSubject";

interface Props {
  documentTypes: string[];
  documentLabel: string;
  pluralLabel?: string;
  createDocumentType: string;
  /** When set, opened documents carry ?from=<this> so the editor's Back and the
   *  nav highlight return here (e.g. the stand-alone Invoices module). */
  fromPath?: string;
  /** Hide the "All … for this organization" line under the title (stand-alone Invoices module). */
  hideSubtitle?: boolean;
  /** "issue": SORT by the document's own date (newest first) out of the box. The
   *  date column always SHOWS that date either way — this only sets the default
   *  ordering, which stays on the created date elsewhere because an issue-date
   *  sort is a JSON sort for any org without the document list keys. */
  dateColumn?: "created" | "issue";
  /** Trade invoices (Shipments orgs): a "Covers" column — the orders / shipments the invoice bills ("#9-1, #9-2"). */
  showCovers?: boolean;
  /** Limit the list to one side of the books. Credit and debit notes exist in
   *  BOTH directions under one document type — Sales shows only the ones we
   *  issue to a customer; a supplier's note belongs in the purchase journal
   *  under AP (guru 2026-11-12). */
  counterparty?: "CUSTOMER" | "SUPPLIER";
}

interface DocumentRow {
  id: string;
  name: string;
  documentType: string;
  templateId: string;
  status: string;
  createdAt: string;
  issueDate?: string;
  associated_customer?: string;
  associated_item?: string;
  /** Which side the name above is on — set by the API from the document's
   *  own supplier / customer block. */
  counterpartyKind?: "CUSTOMER" | "SUPPLIER" | null;
  config?: any;
}

// What this list's date column is CALLED. The value is always the document's
// own date (documentInfo.date / date / issueDate, server-side documentIssueDate),
// but a delivery order's date is a DELIVERY date and an invoice's is an INVOICE
// date, so the heading says which (guru 2026-11-18). A list mixing types falls
// back to the plain word.
const DATE_HEADERS: Array<[string[], string]> = [
  [["INVOICE", "TI", "TI2", "INV"], "Invoice date"],
  [["DELIVERY_ORDER", "DO"], "Delivery date"],
  [["RETURN_DELIVERY_ORDER", "RDO"], "Return date"],
  [["QUOTATION", "QO", "QO1", "QO2", "QT"], "Quotation date"],
  [["SALES_ORDER", "SO"], "Order date"],
  [["PURCHASE_ORDER", "PO"], "Order date"],
  [["PURCHASE_RETURN", "PR"], "Return date"],
  [["VARIATION_ORDER", "VO"], "Order date"],
  [["CREDIT_NOTE", "CN"], "Credit note date"],
  [["DEBIT_NOTE", "DN"], "Debit note date"],
  [["BILL"], "Bill date"],
  [["OFFICIAL_RECEIPT"], "Receipt date"],
  [["PAYMENT_VOUCHER", "JOURNAL_VOUCHER"], "Voucher date"],
  [["STOCK_ADJUSTMENT_IN", "SAI", "STOCK_ADJUSTMENT_OUT", "SAO"], "Adjustment date"],
  [["GRN", "GOODS_RECEIPT"], "Received date"],
];

export const dateHeaderFor = (documentTypes: string[]): string => {
  const codes = (documentTypes || []).map((t) => String(t).toUpperCase());
  if (!codes.length) return "Date";
  const match = DATE_HEADERS.find(([set]) => codes.every((c) => set.includes(c)));
  return match ? match[1] : "Date";
};

/** The Status filter's options for this list's types (WCT group: helpers/wctStatuses.ts). */
export function statusOptionsFor(documentTypes: string[], manualOrderFlow: boolean, wctStatuses: boolean, statusFlow = false) {
  // enableWctStatusFlow is the main WCT wording (guru 2026-11-20) and wins over the enableWctStatuses set.
  const flow = statusFlow ? flowStatusOptions(documentTypes, { voided: true }) : null;
  if (flow) return flow;
  const wct = wctStatusOptionsFor(documentTypes, wctStatuses);
  if (wct) return wct;
  return documentTypes.length && documentTypes.every((t) => INVOICE_TYPE_SET.has(String(t).toUpperCase())) ? invoiceStatusOptions(manualOrderFlow) : DOC_STATUS_OPTIONS;
}

const formatStatus = (status: string) => {
  if (!status) return "Unconfirmed";
  if (status === "draft" || status === "unconfirmed") return "Unconfirmed";
  if (status === "pending_payment") return "Awaiting Payment";
  if (status === "partially_paid") return "Partially Paid";
  return status
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
};

const getStatusColor = (status: string) => {
  switch (status) {
    case "draft":
    case "unconfirmed":
      return "text.secondary";
    case "confirmed":
    case "delivered_installed":
    case "paid":
      return "success.main";
    case "pending_delivery":
    case "pending_payment":
    case "partially_paid":
    case "pending_return":
      return "warning.main";
    case "delivered_not_installed":
      return "info.main";
    default:
      return "text.primary";
  }
};

function StatCard({
  title,
  value,
  icon,
  color,
  bgColor,
  loading,
}: {
  title: string;
  value: number | string;
  icon: React.ReactElement;
  color: string;
  bgColor: string;
  loading?: boolean;
}) {
  return (
    <Card
      elevation={0}
      sx={{
        border: 1,
        borderColor: "divider",
        height: "100%",
        transition: "all 0.3s ease",
        "&:hover": { boxShadow: 2, transform: "translateY(-2px)" },
      }}
    >
      <CardContent>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1 }}>
          <Typography
            variant="caption"
            sx={{ color: "text.secondary", fontWeight: 500, fontSize: "0.75rem", letterSpacing: "0.5px" }}
          >
            {title}
          </Typography>
          <Box
            sx={{
              backgroundColor: bgColor,
              borderRadius: "50%",
              p: 0.5,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {React.cloneElement(icon, { sx: { fontSize: 20, color } })}
          </Box>
        </Box>
        {loading ? (
          <Skeleton variant="text" width="60%" height={40} />
        ) : (
          <Typography variant="h5" sx={{ fontWeight: 600, color, mt: 1 }}>
            {value}
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}

export default function DocumentListView({
  documentTypes,
  documentLabel,
  pluralLabel,
  createDocumentType,
  fromPath,
  hideSubtitle,
  dateColumn = "created",
  showCovers = false,
  counterparty,
}: Props) {
  const router = useRouter();
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  // Shared creation flow (number format → template → create → editor) — same
  // hook backs the AR tab's Create Invoice, so the behaviour stays identical.
  const { create: handleCreate, creating, dialogs: createFlowDialogs, resolveTarget } = useCreateDocumentFlow(
    createDocumentType,
    documentLabel
  );
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(DEFAULT_PAGE_SIZE);
  const [search, setSearch] = useState("");
  const [sorting, setSorting] = useState<any[]>(dateColumn === "issue" ? [{ id: "issueDate", desc: true }] : []);
  const [filters, setFilters] = useState<any>({
    status: "",
    customerId: "",
    createdOn: { startDate: null, endDate: null },
  });

  const dateHeader = useMemo(() => dateHeaderFor(documentTypes), [documentTypes]);

  // Real DO numbers (enableRealDoOnSchedule): a DO shows Pending / Completed / Cancelled next to its number.
  const { isRealDoOnScheduleEnabled, isWctOrdersEnabled, isManualOrderFlowEnabled, isWctDocNavEnabled, isQuotationTemplatesEnabled, isWctStatusesEnabled, isWctStatusFlowEnabled, isSoftDeleteDraftsEnabled } = useOrganizationFeatures();
  // Quotation templates (enableQuotationTemplates, WCT group, 2026-11-19): "Create Quotation" gets an arrow ->
  // Create from template. Every other org / list: the plain Create button, as before.
  const templatesOn = quotationListTemplates(!!isQuotationTemplatesEnabled, createDocumentType);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  // WCT group (enableWctDocNav, 2026-11-18): no "All … for this organization" line under the title.
  // WCT orders hub (2026-11-13): a quotation's order number, linked, in the Quotations list.
  const showOrderColumn = !!isWctOrdersEnabled && documentTypes.some((t) => ["QUOTATION", "QO", "QO1", "QO2", "QT"].includes(t));
  // The order number comes with each quotation row (server linkedOrder, documents.service quotationOrders); the list
  // used to load the whole Orders list (9 MB at WCT) just for this column (2026-11-23).
  const filterConfig: FilterField[] = useMemo(
    () => [
      { type: "dateRange", key: "createdOn", label: "Created On" },
      // "Voided" (manual order flow only): invoices voided with a cancelled order, hidden from the default list.
      // WCT group (enableWctStatuses): quotation / DO / invoice lists offer only the statuses that apply there.
      { type: "select", key: "status", label: "Status", options: statusOptionsFor(documentTypes, !!isManualOrderFlowEnabled, !!isWctStatusesEnabled, !!isWctStatusFlowEnabled) },
      // Server-search customer picker (orgs have thousands of customers).
      { type: "customer", key: "customerId", label: "Customer" },
    ],
    [documentTypes, isManualOrderFlowEnabled, isWctStatusesEnabled, isWctStatusFlowEnabled],
  );

  // Column-header sort → server sort field (name/status/createdAt only; the
  // JSON-derived Customer/Item columns aren't server-sortable, so their sort is
  // disabled in the column defs below).
  // WCT group (enableWctDocNav, 2026-11-24): Quotations / DOs / Invoices show Subject (not Remarks), sorted on the server.
  const showSubject = subjectColumnOn(documentTypes, isWctDocNavEnabled);
  const sortColMap: Record<string, string> = { name: "name", status: "status", createdAt: "createdAt", issueDate: "issueDate", ...(showSubject ? { [SUBJECT_SORT]: SUBJECT_SORT } : {}) };
  const sortState = sorting[0];
  const sortBy = sortState ? sortColMap[sortState.id] : undefined;
  const sortDir = sortState ? (sortState.desc ? "desc" : "asc") : undefined;

  // WCT group (enableWctDocNav, 2026-11-23): the search waits 300 ms after typing stops, so typing an order number no
  // longer sends one request per key (they queued: ~7.5 s each). Every other org: as before.
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  useEffect(() => {
    if (!isWctDocNavEnabled) return setDebouncedSearch(search);
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search, isWctDocNavEnabled]);
  // Server-side paginated list for this document-type set (fetches one page).
  const { docs, total, totalPages, isFetching, refetch } = useGetDocumentsPaginated({
    documentTypes,
    page,
    limit,
    search: debouncedSearch,
    status: filters.status || undefined,
    customerId: filters.customerId || undefined,
    createdOn: filters.createdOn,
    sortBy,
    sortDir: sortDir as any,
    counterparty,
  });

  // Stat-card counts across the full type set (independent of the filters) —
  // but on the SAME side, or the total would count rows the list doesn't show.
  const { stats, isLoading: statsLoading, refetch: refetchStats } = useGetDocumentStats(documentTypes, counterparty);

  // Credit / debit notes are the only document types that exist in both
  // directions (we raise one for a customer; a supplier raises one for us).
  // A list that is already scoped to one side doesn't need to say so on every
  // row; one that shows both does.
  // Paid / Due sit beside Amount on INVOICE lists only — a quotation or a
  // delivery order is not owed anything, so the columns would be dead weight
  // (guru 2026-11-17, asking for them on /portal/sales/invoices).
  const showPaidDue = documentTypes.length > 0 && documentTypes.every((t) => INVOICE_TYPE_SET.has(String(t).toUpperCase()));

  const twoSidedList =
    !counterparty &&
    documentTypes.some((t) => ["CREDIT_NOTE", "CN", "DEBIT_NOTE", "DN"].includes(String(t).toUpperCase()));
  const [uploadOpen, setUploadOpen] = useState(false);
  const [docToDelete, setDocToDelete] = useState<DocumentRow | null>(null);
  // Anchored to the CLICK POSITION, not the button element — the table
  // re-renders on menu-state changes, detaching the stored anchorEl and
  // making the menu open at the top-left corner (guru 2026-09-14).
  const [rowMenu, setRowMenu] = useState<{ pos: { left: number; top: number }; row: any } | null>(null);

  const deleteDocumentMutation = useDeleteDocument();

  // Bulk actions (guru 2026-11-21): tick rows → Download (PDF / ZIP), Delete
  // drafts, Void. Selection survives paging and clears on any re-scope.
  const bulk = useBulkSelection<any>(docs, { resetKey: `${documentTypes.join(",")}|${search}|${JSON.stringify(filters)}` });
  const isDraftRow = (d: any) => ["draft", "unconfirmed"].includes(d.status || "unconfirmed");
  const isVoidedRow = (d: any) => d.status === "voided" || !!d.config?.voided;
  // Same rule as the row kebab: drafts only, never an imported (old ERP) one.
  const bulkDeletable = bulk.selectedRows.filter((d) => isDraftRow(d) && !d.imported);
  // Void = the editor's Void button, for confirmed documents (the server refuses one with payments).
  const bulkVoidable = bulk.selectedRows.filter((d) => !isDraftRow(d) && !isVoidedRow(d));
  const [bulkConfirm, setBulkConfirm] = useState<"delete" | "void" | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkDownloading, setBulkDownloading] = useState(false);
  const bulkDownload = async () => {
    if (bulkDownloading) return;
    setBulkDownloading(true);
    try {
      await downloadDocumentPdfs(bulk.selectedRows.map((d) => d.id), request, await getToken(), `${(pluralLabel || documentLabel + "s").toLowerCase()}.zip`);
    } catch (e: any) {
      toast.error(e?.message || "Download failed");
    } finally {
      setBulkDownloading(false);
    }
  };
  const bulkDelete = async () => {
    setBulkBusy(true);
    const { ok } = await runBulk(bulkDeletable, (d) => deleteDocumentMutation.mutateAsync(d.id), {
      done: (n) => `${n} ${n === 1 ? documentLabel.toLowerCase() : (pluralLabel || documentLabel + "s").toLowerCase()} deleted`,
      failed: (n) => `${n} could not be deleted`,
    });
    bulk.remove(ok.map((d) => d.id));
    setBulkBusy(false);
    setBulkConfirm(null);
    refetch();
    refetchStats();
  };
  const bulkVoid = async () => {
    setBulkBusy(true);
    const token = await getToken();
    const { ok } = await runBulk(
      bulkVoidable,
      async (d) => {
        const res: any = await request({ path: `/documents/${d.id}/void`, method: "POST", ownError: true }, {}, token ?? undefined);
        if (res?.success === false) throw new Error(res?.message || "Void failed");
      },
      { done: (n) => `${n} voided`, failed: (n) => `${n} could not be voided (a document with payments cannot be voided)` },
    );
    bulk.remove(ok.map((d) => d.id));
    setBulkBusy(false);
    setBulkConfirm(null);
    refetch();
    refetchStats();
  };

  const handleDeleteConfirm = async () => {
    if (!docToDelete) return;
    try {
      await deleteDocumentMutation.mutateAsync(docToDelete.id);
      toast.success(`${documentLabel} deleted`);
      setDocToDelete(null);
      refetch();
      refetchStats();
    } catch (err: any) {
      console.error("Delete document failed:", err);
      toast.error(err?.message || `Failed to delete ${documentLabel}`);
    }
  };


  // Filtering, sorting, and paging all happen server-side now (see the hooks
  // above). Reset to page 1 whenever the query changes so we don't land on an
  // out-of-range page.
  useEffect(() => { setPage(1); }, [search, filters, sorting, limit]);

  const columns = [
    {
      accessorKey: "name",
      header: `${documentLabel} #`,
      cell: ({ row }: any) => {
        const r = row.original;
        if (!r.name) return "—";
        const num = <Box sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{r.name}</Box>;
        const isDo = ["DELIVERY_ORDER", "DO"].includes(String(r.documentType || r.type || "").toUpperCase());
        if (!isRealDoOnScheduleEnabled || !isDo) return num;
        return (
          <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
            {num}
            <DoStatusTag tag={docDoTag(r)} doc={r} />
          </Stack>
        );
      },
    },
    ...(showOrderColumn
      ? [
          {
            id: "order",
            header: "Order",
            enableSorting: false,
            cell: ({ row }: any) => {
              const o = (row.original as any).linkedOrder as { id: string; orderNumber: string } | undefined;
              if (!o) return "";
              return (
                <Box
                  component="a"
                  href={`/portal/orders/${o.id}`}
                  onClick={(e: React.MouseEvent) => {
                    e.preventDefault();
                    e.stopPropagation();
                    router.push(`/portal/orders/${o.id}`);
                  }}
                  sx={{ color: "primary.main", fontWeight: 600, textDecoration: "none", "&:hover": { textDecoration: "underline" } }}
                >
                  {o.orderNumber}
                </Box>
              );
            },
          },
        ]
      : []),
    {
      accessorKey: "associated_customer",
      // Credit and debit notes run in BOTH directions — one we issue to a
      // customer, one a supplier issued to us — so the column names the side
      // as well as the party (guru 2026-11-12: "it should state if its a
      // supplier cn or we send to the customer"). Every other document type
      // has only one direction, so it keeps the plain header and no tag.
      header: twoSidedList ? "Customer / Supplier" : "Customer",
      enableSorting: false, // JSON-derived (config), not server-sortable
      cell: ({ row }: any) => {
        const r = row.original;
        const who = r.associated_customer && r.associated_customer !== "N/A" ? r.associated_customer : "—";
        if (!twoSidedList || !r.counterpartyKind) return who;
        const fromSupplier = r.counterpartyKind === "SUPPLIER";
        return (
          <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
            <Box component="span">{who}</Box>
            <Chip
              size="small"
              variant="outlined"
              color={fromSupplier ? "warning" : "info"}
              label={fromSupplier ? "From supplier" : "To customer"}
              sx={{ height: 20, fontSize: "0.7rem" }}
            />
          </Stack>
        );
      },
    },
    showSubject
      ? {
          // WCT group: the Subject (server listSubject); a DO / Invoice with none of its own shows its quotation's, muted.
          id: SUBJECT_SORT,
          // A column needs an accessor to be sortable at all (the sort itself runs on the server, sortColMap).
          accessorFn: (r: any) => subjectCell(r)?.text ?? "",
          header: "Subject",
          enableSorting: true,
          cell: ({ row }: any) => {
            const cell = subjectCell(row.original);
            if (!cell) return "";
            return (
              <Box component="span" sx={{ color: cell.muted ? "text.secondary" : "inherit" }}>
                {cell.text}
              </Box>
            );
          },
        }
      : {
          // Free-text Remarks — what the document is FOR (guru 2026-07-24: every document carries
          // one and every list shows it; 2026-11-21: ONE Remarks memo on the right of every editor,
          // this column is what people take their reference from). Canonical key referenceNo.
          accessorKey: "reference",
          header: "Remarks",
          enableSorting: false, // JSON-derived (config), not server-sortable
          cell: ({ row }: any) => {
            const c: any = row.original.config || {};
            return c?.documentInfo?.referenceNo || c?.referenceNo || c?.remarks || c?.reference || c?.xeroReference || "—";
          },
        },
    // "Associated Item" dropped from all document lists (2026-07-13, guru).
    ...(showCovers
      ? [
          {
            // Stamped by the in-app 請求書 on Finalize (config.tradeCovers): "#11" for Invoice #1, "#9-1, #9-2" for an Invoice #2 over two shipments.
            accessorKey: "covers",
            header: "Covers",
            enableSorting: false,
            cell: ({ row }: { row: { original: { config?: unknown } } }) => String((row.original.config as { tradeCovers?: string } | undefined)?.tradeCovers || "—"),
          },
        ]
      : []),
    {
      // Gross total from the config blob — same candidate order as the AR
      // invoice list's getInvoiceTotal (guru 2026-08-18: show the amount).
      accessorKey: "amount",
      header: "Amount",
      enableSorting: false, // JSON-derived (config), not server-sortable
      nowrap: true,
      align: "right",
      pxWidth: 130,
      cell: ({ row }: any) => {
        // Sign-aware: a negative total (credit-style invoice) is a real amount.
        const total = docGrossTotal(row.original.config);
        return total ? (
          <Box sx={{ fontVariantNumeric: "tabular-nums" }}>
            {total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </Box>
        ) : "—";
      },
    },
    ...(showPaidDue
      ? [
          {
            accessorKey: "paid",
            header: "Paid",
            enableSorting: false, // JSON-derived (config), not server-sortable
            nowrap: true,
            align: "right",
            pxWidth: 120,
            cell: ({ row }: any) => {
              const paid = docPaidToDate(row.original.config);
              return paid ? (
                <Box sx={{ fontVariantNumeric: "tabular-nums" }}>
                  {paid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </Box>
              ) : "—";
            },
          },
          {
            accessorKey: "due",
            header: "Due",
            enableSorting: false,
            nowrap: true,
            align: "right",
            pxWidth: 120,
            cell: ({ row }: any) => {
              const due = docAmountDue(row.original.config);
              // Settled reads as a dash, not 0.00 — the eye should land on
              // what is still owed.
              if (!due) return "—";
              return (
                <Box sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 600, color: "warning.main" }}>
                  {due.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </Box>
              );
            },
          },
        ]
      : []),
    {
      // The DOCUMENT'S OWN date, named after what that date means to the person
      // reading the list — Delivery date on a DO, Invoice date on an invoice
      // (guru 2026-11-18). It used to be the row's CREATED timestamp, which is
      // when somebody happened to type it in: a December-keyed November invoice
      // read as December, and a DO's delivery date — the only date a storeman
      // cares about — was nowhere on the list.
      accessorKey: "issueDate",
      header: dateHeader,
      nowrap: true,
      // 140, not the old 120: "Delivery date" / "Credit note date" wrap onto
      // two lines in the narrower column and the header row grows.
      pxWidth: 140,
      cell: ({ row }: any) => moment(row.original.issueDate || row.original.createdAt).format("DD/MM/YYYY"),
    },
    {
      accessorKey: "status",
      header: "Status",
      // wrap: chip may take two lines (no "…" — guru 2026-08-27)
      // Fixed-width chip/date columns: the flexible width goes to Customer
      // and Reference instead (guru 2026-08-18).
      pxWidth: 150,
      cell: ({ row }: any) => {
        // An RDO born from an ad-hoc return has no real customer / project
        // until the office attaches them on the delivery run (2026-10-22).
        const r = row.original;
        const isRdo = ["RETURN_DELIVERY_ORDER", "RDO"].includes(String(r.documentType || "").toUpperCase());
        const c: any = r.config || {};
        const needsInfo = isRdo && (!(c?.customer?.id || c?.customerId) || !r.projectId);
        return (
          <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap" useFlexGap>
            <StatusChip status={r.status} doc={r} />
            {needsInfo && <Chip size="small" color="warning" variant="outlined" label="Needs info" sx={{ height: 20, fontSize: "0.7rem" }} />}
          </Stack>
        );
      },
    },
    {
      // Row-click opens the document; the kebab holds secondary actions
      // (CLAUDE.md table pattern — inline action-icon columns retired).
      accessorKey: "action",
      header: "",
      nowrap: true,
      align: "center",
      pxWidth: 56,
      cell: ({ row }: any) => (
        <IconButton
          size="small"
          aria-label="Row actions"
          data-tour="document-row-view"
          onClick={(e: React.MouseEvent<HTMLElement>) => {
            e.stopPropagation();
            setRowMenu({ pos: { left: e.clientX, top: e.clientY }, row: row.original });
          }}
          sx={{ color: "text.secondary" }}
        >
          <MoreVertIcon fontSize="small" />
        </IconButton>
      ),
    },
  ];

  // ONE url builder for both the click handler and the row's real <a href>, so
  // a left-click and an "open in new tab" can never disagree about where a row
  // goes (guru 2026-10-15).
  //
  // withActiveOrg matters here: the admin "viewing as <org>" override lives in
  // sessionStorage, which a NEW TAB does not inherit — without the ?aorg= the
  // document opens against the admin's home org and fails to load.
  const documentUrl = (doc: any) => {
    const from = fromPath ? `?from=${encodeURIComponent(fromPath)}` : "";
    // Invoices finalized from an in-app trade document (e.g. the 請求書 template) open as that PDF.
    const path = doc.config?.tradeGeneratedDocId
      ? `/portal/trade-documents/invoice/${doc.id}${from}`
      : `/portal/documents/${doc.documentType}/${doc.templateId}/${doc.id}${from}`;
    return withActiveOrg(path);
  };

  const openDocument = (doc: any) => router.push(documentUrl(doc));

  const serializeDate = (d: Date | null) => (d ? JSON.parse(JSON.stringify(d)) : null);
  const handleSetFilters = (newFilters: any) => {
    setFilters({
      ...newFilters,
      createdOn: {
        startDate: newFilters.createdOn?.startDate
          ? serializeDate(new Date(newFilters.createdOn.startDate))
          : null,
        endDate: newFilters.createdOn?.endDate
          ? serializeDate(new Date(newFilters.createdOn.endDate))
          : null,
      },
    });
  };

  const uploadButton = createDocumentType ? (
    <Button
      key="upload-doc"
      data-tour="document-upload"
      variant="outlined"
      startIcon={<CloudUploadIcon />}
      onClick={() => setUploadOpen(true)}
      disabled={creating}
    >
      Upload {documentLabel}
    </Button>
  ) : null;

  return (
    <MainCard>
      <PageTable
        // This list renders its own id-keyed checkbox column (feeds the BulkActionBar).
        noSelectionColumn
        columns={[bulk.column, ...columns]}
        data={docs}
        onRowClick={openDocument}
        // Makes each row a REAL link, so right-click offers Chrome's own
        // "Open link in new tab / new window / copy link" and ⌘/middle-click
        // open a tab natively — the same behaviour Xero has. Plain left-clicks
        // still route through onRowClick for client-side navigation.
        rowHref={documentUrl}
        manualSorting
        sorting={sorting}
        onSortingChange={setSorting}
        tableName={`${pluralLabel || documentLabel + "s"} List`}
        subTitle={documentListSubtitle(pluralLabel || documentLabel + "s", !!hideSubtitle, !!isWctDocNavEnabled)}
        buttonName={createDocumentType ? `Create ${documentLabel}` : undefined}
        onAddClick={createDocumentType ? handleCreate : undefined}
        buttonDisabled={creating}
        buttonMenu={templatesOn ? [{ label: "Create from template", onClick: () => setTemplatesOpen(true), tour: "quotation-list-from-template" }] : undefined}
        actionButtons={uploadButton ? [uploadButton] : undefined}
        loading={isFetching || creating}
        page={page}
        limit={limit}
        search={search}
        filters={filters}
        setPage={setPage}
        setLimit={setLimit}
        setSearch={setSearch}
        setFilters={handleSetFilters}
        filterConfig={filterConfig}
        pageCount={totalPages}
        totalDocs={total}
        headerContent={
          <Box sx={{ mb: 3 }}>
            <Grid container spacing={2}>
              <Grid item xs={12} sm={4}>
                <StatCard
                  title={`TOTAL ${(pluralLabel || documentLabel + "S").toUpperCase()}`}
                  value={stats.total}
                  icon={<DescriptionOutlinedIcon />}
                  color="primary.main"
                  bgColor="surfaceTones.high"
                  loading={statsLoading}
                />
              </Grid>
              <Grid item xs={12} sm={4}>
                <StatCard
                  title="THIS MONTH"
                  value={stats.thisMonth}
                  icon={<CalendarMonthOutlinedIcon />}
                  color="success.main"
                  bgColor="success.light"
                  loading={statsLoading}
                />
              </Grid>
              <Grid item xs={12} sm={4}>
                <StatCard
                  title={isWctStatusFlowEnabled && flowStatusOptions(documentTypes) ? (flowStatusOptions(documentTypes)!.some((o) => o.value === "flow_draft") ? "DRAFT + PENDING" : "PENDING") : "UNCONFIRMED"}
                  value={stats.drafts}
                  icon={<DraftsOutlinedIcon />}
                  color="customYellow.dark"
                  bgColor="customYellow.light"
                  loading={statsLoading}
                />
              </Grid>
            </Grid>
          </Box>
        }
      />
      {createDocumentType && (
        <DocumentUploadDialog
          open={uploadOpen}
          onClose={() => setUploadOpen(false)}
          documentType={createDocumentType}
          documentLabel={documentLabel}
          onCreated={() => {
            refetch();
            refetchStats();
          }}
        />
      )}

      {templatesOn && (
        <QuotationTemplatesHost
          listOpen={templatesOpen}
          onCloseList={() => setTemplatesOpen(false)}
          docType={createDocumentType}
          resolveLayout={resolveTarget}
          onUsed={(doc) => {
            const from = typeof window !== "undefined" ? encodeURIComponent(window.location.pathname + window.location.search) : "";
            router.push(`/portal/documents/${doc.type || createDocumentType}/${doc.documentTemplateId}/${doc.id}${from ? `?from=${from}` : ""}`);
          }}
        />
      )}

      {/* Row kebab menu (CLAUDE.md table pattern) */}
      <Menu anchorReference="anchorPosition" anchorPosition={rowMenu?.pos} open={!!rowMenu} onClose={() => setRowMenu(null)}>
        <MenuItem
          onClick={() => {
            const row = rowMenu!.row;
            setRowMenu(null);
            openDocument(row);
          }}
        >
          Open
        </MenuItem>
        {/* Drafts only; never an imported (old ERP) one. WCT group (enableSoftDeleteDrafts): hidden, number kept as a gap. */}
        {rowMenu && ["draft", "unconfirmed"].includes(rowMenu.row.status || "unconfirmed") && !(rowMenu.row as any).imported && (
          <MenuItem
            sx={{ color: "error.main" }}
            onClick={() => {
              const row = rowMenu!.row;
              setRowMenu(null);
              setDocToDelete(row);
            }}
          >
            Delete draft
          </MenuItem>
        )}
      </Menu>

      <Dialog open={!!docToDelete} onClose={() => setDocToDelete(null)}>
        <DialogTitle>Delete {documentLabel}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {isSoftDeleteDraftsEnabled
              ? `Delete "${docToDelete?.name || "this document"}"? Its number stays as a gap.`
              : `Delete "${docToDelete?.name || "this document"}"? This cannot be undone.`}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDocToDelete(null)} disabled={deleteDocumentMutation.isPending}>
            Cancel
          </Button>
          <Button
            onClick={handleDeleteConfirm}
            color="error"
            variant="contained"
            disabled={deleteDocumentMutation.isPending}
          >
            {deleteDocumentMutation.isPending ? "Deleting..." : "Delete"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Floating bulk-action bar (guru 2026-11-21) */}
      <BulkActionBar
        count={bulk.count}
        onClear={bulk.clear}
        actions={[
          {
            key: "download",
            label: bulkDownloading ? "Preparing…" : "Download",
            icon: <DownloadIcon />,
            disabled: bulkDownloading,
            tooltip: bulk.count > 1 ? "Download the selected documents as one ZIP of PDFs" : "Download this document's PDF",
            onClick: () => void bulkDownload(),
          },
          {
            key: "void",
            label: bulkVoidable.length > 0 && bulkVoidable.length < bulk.count ? `Void ${bulkVoidable.length}` : "Void",
            icon: <BlockIcon />,
            color: "warning",
            disabled: bulkVoidable.length === 0 || bulkBusy,
            tooltip:
              bulkVoidable.length === 0
                ? "Only confirmed documents can be voided — delete a draft instead"
                : bulkVoidable.length < bulk.count
                ? `${bulk.count - bulkVoidable.length} draft / already-voided will be skipped`
                : "Void the selected documents and their journals",
            onClick: () => setBulkConfirm("void"),
          },
          {
            key: "delete",
            label: bulkDeletable.length > 0 && bulkDeletable.length < bulk.count ? `Delete ${bulkDeletable.length} ${bulkDeletable.length === 1 ? "draft" : "drafts"}` : "Delete",
            icon: <DeleteIcon />,
            color: "error",
            disabled: bulkDeletable.length === 0 || bulkBusy,
            tooltip:
              bulkDeletable.length === 0
                ? "Only unconfirmed drafts can be deleted"
                : bulkDeletable.length < bulk.count
                ? `${bulk.count - bulkDeletable.length} confirmed / imported will be skipped`
                : "Delete the selected drafts",
            onClick: () => setBulkConfirm("delete"),
          },
        ]}
      />
      <BulkConfirmDialog
        open={bulkConfirm === "delete"}
        title={`Delete ${bulkDeletable.length} ${bulkDeletable.length === 1 ? documentLabel.toLowerCase() : (pluralLabel || documentLabel + "s").toLowerCase()}?`}
        body={
          (isSoftDeleteDraftsEnabled ? "Their numbers stay as gaps." : "This cannot be undone.") +
          (bulk.count > bulkDeletable.length ? ` ${bulk.count - bulkDeletable.length} selected ${bulk.count - bulkDeletable.length === 1 ? "row is not a draft" : "rows are not drafts"} and will not be touched.` : "")
        }
        confirmLabel={bulkBusy ? "Deleting…" : "Delete"}
        busy={bulkBusy}
        onCancel={() => setBulkConfirm(null)}
        onConfirm={() => void bulkDelete()}
      />
      <BulkConfirmDialog
        open={bulkConfirm === "void"}
        title={`Void ${bulkVoidable.length} ${bulkVoidable.length === 1 ? documentLabel.toLowerCase() : (pluralLabel || documentLabel + "s").toLowerCase()}?`}
        body={
          "Each document and every live journal posted from it is voided. A document that already has payments is refused and left as it is. There is no un-void." +
          (bulk.count > bulkVoidable.length ? ` ${bulk.count - bulkVoidable.length} selected ${bulk.count - bulkVoidable.length === 1 ? "row is a draft or already voided" : "rows are drafts or already voided"} and will not be touched.` : "")
        }
        confirmLabel={bulkBusy ? "Voiding…" : "Void"}
        color="warning"
        busy={bulkBusy}
        onCancel={() => setBulkConfirm(null)}
        onConfirm={() => void bulkVoid()}
      />

      {createFlowDialogs}
    </MainCard>
  );
}
