"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { request, withActiveOrg } from "@/helpers/request";
import MainCard from "@/components/MainCard";
import PageTable from "@/components/PageTable";
import { useClientSort } from "@/components/clientSort";
import type { FilterField } from "@/components/FilterDrawer";
import { Box, IconButton, Alert, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from "@mui/material";
import BulkActionBar from "@/components/BulkActionBar";
import DeleteIcon from "@mui/icons-material/Delete";
import DownloadIcon from "@mui/icons-material/Download";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import LinkIcon from "@mui/icons-material/Link";
import { Tab, Tabs, Chip, alpha, Stack, Typography, Menu, MenuItem } from "@mui/material";
import { useDeleteDocument, useGetCustomers } from "@/app/portal/hooks/api";
import { useRouter } from "next/navigation";
import { useCreateDocumentFlow } from "@/app/portal/components/useCreateDocumentFlow";
import moment from "moment";
import StatusChip from "@/components/StatusChip";
import { toast } from "react-toastify";
import { DOCUMENT_API } from "../documents/constants";
import { ROUTES } from "@/routes";
import CustomerSelectionDrawer from "./components/CustomerSelectionDrawer";
import InvoiceVariantDrawer from "./components/InvoiceVariantDrawer";
import InvoiceStatistics from "./components/InvoiceStatistics";
import RecordPaymentDialog from "./components/RecordPaymentDialog";
import { useXeroConnection } from "./hooks/useXeroConnection";

interface Document {
  id: string;
  name: string;
  associated_item: string;
  associated_customer: string;
  status: string;
  documentType: string;
  templateId: string;
  createdAt: string;
  config?: {
    dueDate?: string;
    [key: string]: any;
  };
}

interface Customer {
  id: string;
  name: string;
  email?: string;
  address?: string;
}

interface PaginatedResponse {
  docs: Document[];
  totalDocs: number;
  limit: number;
  totalPages: number;
  page: number;
  pagingCounter: number;
  hasPrevPage: boolean;
  hasNextPage: boolean;
  prevPage: number | null;
  nextPage: null;
}

interface Filters {
  status?: string;
  category?: string;
  createdOn?: {
    startDate: string | null;
    endDate: string | null;
  };
  [key: string]: any;
}

// Base filter fields for invoices — document statuses (NOT the legacy inventory
// statuses the old `availableFilters` path produced) + a date range. The
// Customer field is appended at runtime (its options are the org's customers).
// Category is intentionally omitted (invoices have none).
const INVOICE_STATUS_OPTIONS = [
  { value: "unconfirmed", label: "Unconfirmed" },
  { value: "confirmed", label: "Confirmed" },
  { value: "pending_payment", label: "Awaiting Payment" },
  { value: "paid", label: "Paid" },
];

export default function InvoicesPage() {
  const router = useRouter();
  // Create Invoice here shares the EXACT flow of the Sales > Invoice page
  // (number-format picker → template picker → create → editor). ?from= on the
  // editor URL brings the user back to this tab afterwards.
  const { create: createInvoice, creating: creatingInvoice, dialogs: createFlowDialogs } =
    useCreateDocumentFlow("INVOICE", "Invoice");
  const { organization } = useOrganization();
  const { getToken } = useAuth();
  const organizationId = organization?.id;

  const [documents, setDocuments] = useState<PaginatedResponse>({
    docs: [],
    totalDocs: 0,
    limit: 10,
    totalPages: 0,
    page: 1,
    pagingCounter: 0,
    hasPrevPage: false,
    hasNextPage: false,
    prevPage: null,
    nextPage: null,
  });
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Filters>({
    status: "",
    category: "",
    createdOn: {
      startDate: null,
      endDate: null,
    },
  });
  const [error, setError] = useState<string | null>(null);
  const [customerDrawerOpen, setCustomerDrawerOpen] = useState(false);
  const [variantDrawerOpen, setVariantDrawerOpen] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);

  // AR workspace state: per-invoice payment summary (totalPaid / count / last),
  // active status tab, and the quick "Record Payment" dialog.
  type PaymentSummaryRow = { totalPaid: number; paymentCount: number; lastPaymentDate: string | null };
  const [paymentSummary, setPaymentSummary] = useState<Record<string, PaymentSummaryRow>>({});
  const [arTab, setArTab] = useState<"all" | "draft" | "awaiting" | "overdue" | "paid">("all");

  // Any narrowing change restarts at page 1 — otherwise the pager can be
  // stranded past the last page of the new (smaller) result set.
  useEffect(() => {
    setPage(1);
    setSelectedIds(new Set());
  }, [search, filters, arTab, limit]);
  const [payDialogOpen, setPayDialogOpen] = useState(false);
  const [payDialogInvoice, setPayDialogInvoice] = useState<any>(null);
  // When a document type has >1 numbering variant, ask which to use before creating.
  const [numberingPicker, setNumberingPicker] = useState<{ formats: any[]; data: any; customer?: any; variantId?: string } | null>(null);

  // Draft-only delete: invoices in draft status can be removed.
  // The kebab menu anchors to the CLICK POSITION, not the button element —
  // the table re-renders on selection/menu state changes, which detached the
  // stored anchorEl and made the menu open at the top-left corner (guru
  // 2026-09-11).
  const [rowMenu, setRowMenu] = useState<{ pos: { left: number; top: number }; row: any } | null>(null);
  const [docToDelete, setDocToDelete] = useState<Document | null>(null);
  const deleteDocumentMutation = useDeleteDocument();

  // Row selection for the floating bulk-action bar (CIEL-editor pattern,
  // guru 2026-09-11). Selection is a Set of doc ids so it survives paging;
  // it resets whenever the visible list is re-scoped (tab/search/filter).
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const toggleSelected = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const handleDeleteConfirm = async () => {
    if (!docToDelete) return;
    const id = docToDelete.id;
    try {
      await deleteDocumentMutation.mutateAsync(id);
      toast.success("Invoice deleted");
      setDocToDelete(null);
      // Drop the row locally so the list updates without an extra round-trip.
      setDocuments((prev) => ({
        ...prev,
        docs: (prev.docs || []).filter((d) => d.id !== id),
        totalDocs: Math.max(0, (prev.totalDocs || 0) - 1),
      }));
    } catch (err: any) {
      console.error("Delete invoice failed:", err);
      toast.error(err?.message || "Failed to delete invoice");
    }
  };

  // Read the invoice's gross total from its config blob. Documents store the
  // form data under config.summary / config.nettTotal / etc. — try a few.
  const getInvoiceTotal = (doc: any): number => {
    const cfg = doc?.config || {};
    const candidates = [cfg?.summary?.grandTotal, cfg?.nettTotal, cfg?.grandTotal, cfg?.total, cfg?.summary?.total];
    for (const c of candidates) {
      const n = parseFloat(c);
      if (!isNaN(n) && n > 0) return n;
    }
    // Fallback: sum line items if present.
    if (Array.isArray(cfg.items)) {
      const sum = cfg.items.reduce((s: number, it: any) => {
        const amt = parseFloat(it.amount) || parseFloat(it.quantity) * parseFloat(it.unitPrice) || 0;
        return s + amt;
      }, 0);
      if (sum > 0) return sum;
    }
    return 0;
  };

  const getDueDate = (doc: any): Date | null => {
    const d = doc?.config?.dueDate;
    return d ? new Date(d) : null;
  };

  // Days overdue for unpaid invoices. Negative = days until due. null = no due date.
  const daysOverdue = (doc: any): number | null => {
    const due = getDueDate(doc);
    if (!due) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diff = Math.floor((today.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
    return diff;
  };

  // Derived per-invoice status for AR tabs. A document explicitly marked paid
  // wins outright — Xero-imported invoices carry status='paid' but have no
  // AIMS Payment rows, so deriving only from payments left the Paid tab at 0
  // while the chips (and the money cards, which check doc.status) said PAID.
  const arStatusOf = (doc: any): "draft" | "paid" | "overdue" | "awaiting" => {
    const st = (doc.status || "").toLowerCase();
    if (!st || st === "draft" || st === "unconfirmed") return "draft";
    if (st === "paid" || st === "completed") return "paid";
    const total = getInvoiceTotal(doc);
    const paid = paymentSummary[doc.id]?.totalPaid ?? 0;
    if (total > 0 && paid >= total - 0.005) return "paid";
    const od = daysOverdue(doc);
    if (od !== null && od > 0) return "overdue";
    return "awaiting";
  };

  // Xero connection hook
  const { connectionStatus, loading: xeroLoading, connectToXero } = useXeroConnection();

  const columns = [
    {
      // Bulk-select checkboxes (CIEL-editor pattern). The header checkbox
      // toggles the CURRENT page; row checkboxes stopPropagation so the
      // row-click still opens the invoice. `sortedDocs` is declared later in
      // this component — safe: these closures only run while rendering
      // PageTable, after the whole body has executed.
      accessorKey: "_select",
      enableSorting: false,
      header: () => {
        const pageRows = sortedDocs.slice((page - 1) * limit, page * limit);
        const allChecked = pageRows.length > 0 && pageRows.every((r: any) => selectedIds.has(r.id));
        const someChecked = pageRows.some((r: any) => selectedIds.has(r.id));
        return (
          <Checkbox
            size="small"
            // p:0 — the fixed 56px cell (minus its 16px side paddings) only
            // leaves ~24px of content box; any checkbox padding clips it.
            sx={{ p: 0 }}
            checked={allChecked}
            indeterminate={!allChecked && someChecked}
            onClick={(e) => e.stopPropagation()}
            onChange={() =>
              setSelectedIds((prev) => {
                const next = new Set(prev);
                if (allChecked) pageRows.forEach((r: any) => next.delete(r.id));
                else pageRows.forEach((r: any) => next.add(r.id));
                return next;
              })
            }
          />
        );
      },
      nowrap: true,
      align: "center",
      pxWidth: 56,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cell: ({ row }: any) => (
        <Checkbox
          size="small"
          sx={{ p: 0 }}
          checked={selectedIds.has(row.original.id)}
          onClick={(e) => e.stopPropagation()}
          onChange={() => toggleSelected(row.original.id)}
        />
      ),
    },
    {
      accessorKey: "name",
      header: "Document SKU",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cell: ({ row }: any) => <Box sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{row.original.name}</Box>,
    },
    {
      accessorKey: "associated_customer",
      header: "Associated Customer",
    },
    {
      // Free-text Reference — what the invoice is FOR (guru 2026-07-24).
      accessorKey: "reference",
      header: "Reference",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cell: ({ row }: any) => {
        const c: any = row.original.config || {};
        return (
          c?.documentInfo?.referenceNo || c?.referenceNo || c?.reference || c?.xeroReference || (
            <Box component="span" sx={{ color: "text.disabled" }}>—</Box>
          )
        );
      },
    },
    // "Associated Item" dropped from all document lists (2026-07-13, guru).
    {
      accessorKey: "dueDate",
      header: "Due Date",
      nowrap: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cell: ({ row }: any) => {
        const dueDate = row.original.config?.dueDate;
        return dueDate ? moment(dueDate).format("DD/MM/YYYY") : <Box component="span" sx={{ color: "text.disabled" }}>—</Box>;
      },
    },
    {
      accessorKey: "status",
      header: "Status",
      // wrap: chip may take two lines (no "…" — guru 2026-08-27)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cell: ({ row }: any) => <StatusChip status={row.original.status} />,
    },
    {
      // Xero sync state: grey until the invoice is pushed to / imported from
      // Xero; then a green chip carrying the Xero-side status.
      accessorKey: "xeroSync",
      header: "Xero",
      // wrap: chip may take two lines (no "…" — guru 2026-08-27)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cell: ({ row }: any) => {
        const cfg = row.original?.config || {};
        return cfg.xeroInvoiceId ? (
          <Chip size="small" variant="outlined" color="success" label={`Xero · ${cfg.xeroStatus || "SYNCED"}`} sx={{ fontSize: "0.65rem", height: "auto", minHeight: 24, py: 0.25, "& .MuiChip-label": { whiteSpace: "normal", display: "block", textAlign: "center", lineHeight: 1.3 } }} />
        ) : (
          <Chip size="small" variant="outlined" label="Not synced" sx={{ fontSize: "0.65rem", opacity: 0.6, height: "auto", minHeight: 24, py: 0.25, "& .MuiChip-label": { whiteSpace: "normal", display: "block", textAlign: "center", lineHeight: 1.3 } }} />
        );
      },
    },
    {
      accessorKey: "outstanding",
      header: "Outstanding",
      nowrap: true,
      align: "right",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cell: ({ row }: any) => {
        const total = getInvoiceTotal(row.original);
        const paid = paymentSummary[row.original.id]?.totalPaid ?? 0;
        // Status-paid invoices (e.g. Xero imports without AIMS payment rows)
        // owe nothing regardless of recorded payments.
        const outstanding = arStatusOf(row.original) === "paid" ? 0 : Math.max(0, total - paid);
        const fmt = (n: number) =>
          n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        return (
          <Box sx={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
            <Box sx={{ fontWeight: 600 }}>{fmt(outstanding)}</Box>
            {paid > 0 && (
              <Box sx={{ fontSize: "0.7rem", color: "text.secondary" }}>
                paid {fmt(paid)} / {fmt(total)}
              </Box>
            )}
          </Box>
        );
      },
    },
    {
      accessorKey: "daysOverdue",
      header: "Age",
      nowrap: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cell: ({ row }: any) => {
        const status = arStatusOf(row.original);
        if (status === "paid") {
          return <Box sx={{ fontSize: "0.8125rem", color: "success.main" }}>Paid</Box>;
        }
        const od = daysOverdue(row.original);
        if (od === null) return <Box sx={{ color: "text.disabled" }}>—</Box>;
        if (od > 0) {
          const tone = od >= 60 ? "error.main" : od >= 30 ? "warning.main" : "warning.main";
          return (
            <Box sx={{ color: tone, fontWeight: 600, fontSize: "0.8125rem" }}>
              {od}d overdue
            </Box>
          );
        }
        if (od === 0) return <Box sx={{ fontSize: "0.8125rem", color: "warning.main" }}>Due today</Box>;
        return <Box sx={{ fontSize: "0.8125rem", color: "text.secondary" }}>{Math.abs(od)}d to go</Box>;
      },
    },
    {
      accessorKey: "createdAt",
      header: "Invoice Date",
      nowrap: true,
      // Show the invoice's real issue date (config.date); fall back to the row
      // creation timestamp only when an invoice has no issue date recorded.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cell: ({ row }: any) => moment(row.original.config?.date ?? row.original.createdAt).format("DD/MM/YYYY"),
    },
    {
      // Row-click opens the invoice; the kebab holds payment/download/delete
      // (CLAUDE.md table pattern — inline action-icon columns retired).
      accessorKey: "action",
      header: "",
      nowrap: true,
      align: "center",
      pxWidth: 56,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cell: ({ row }: any) => (
        <IconButton
          size="small"
          aria-label="Row actions"
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

  // Row-click target — keeps the ?from= so the editor's Back returns here
  // (this list is embedded on both the AR tab and /portal/invoices).
  const invoiceUrl = (doc: any) => {
    const from = encodeURIComponent(window.location.pathname + window.location.search);
    // withActiveOrg: keeps the admin "viewing as" org when the link is opened
    // in a NEW tab (sessionStorage override doesn't cross tabs by itself).
    return withActiveOrg(`/portal/documents/${doc.documentType}/${doc.templateId}/${doc.id}?from=${from}`);
  };
  const openInvoice = (doc: any) => router.push(invoiceUrl(doc));
  // Kebab convenience; rows themselves are real links (rowHref below), so
  // right-click also shows Chrome's native "Open link in new tab" menu.
  const openInvoiceNewTab = (doc: any) => window.open(invoiceUrl(doc), "_blank", "noopener");
  const openPayDialogFor = (doc: any) => {
    const total = getInvoiceTotal(doc);
    const paid = paymentSummary[doc.id]?.totalPaid ?? 0;
    setPayDialogInvoice({
      id: doc.id,
      name: doc.name,
      // Editor-created invoices store the customer flat (config.customerId);
      // imported ones nested (config.customer.id) — read both.
      customerId: doc.config?.customer?.id ?? doc.config?.customerId,
      customerName: doc.associated_customer || doc.config?.customer?.name || doc.config?.customerName,
      amount: Math.max(0, total - paid),
      status: doc.status,
    });
    setPayDialogOpen(true);
  };

  const serializeDate = (date: Date | null) => {
    if (!date) return null;
    return JSON.parse(JSON.stringify(date));
  };

  const handleSetFilters = (newFilters: Filters) => {
    const updatedFilters = {
      ...newFilters,
      createdOn: {
        startDate: newFilters.createdOn?.startDate ? serializeDate(new Date(newFilters.createdOn.startDate)) : null,
        endDate: newFilters.createdOn?.endDate ? serializeDate(new Date(newFilters.createdOn.endDate)) : null,
      },
    };
    setFilters(updatedFilters);
  };

  const fetchDocuments = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    setError(null);
    console.log("organizationId:", organizationId);
    try {
      const token = await getToken();
      if (!token) return;

      const response = await request(
        {
          path: DOCUMENT_API.GET_ALL.path,
          method: "POST",
        },
        { organizationId },
        token
      );
      if (response.success) {
        const invoiceDocs = response.data.filter((doc: any) => doc.documentType === "INVOICE");
        setDocuments({
          docs: invoiceDocs,
          totalDocs: invoiceDocs.length,
          limit,
          totalPages: 1,
          page: 1,
          pagingCounter: 1,
          hasPrevPage: false,
          hasNextPage: false,
          prevPage: null,
          nextPage: null,
        });
      } else {
        setError(response.message || "Failed to fetch documents");
      }
    } catch (error) {
      console.error("Error fetching documents:", error);
      setError("An error occurred while fetching documents");
    } finally {
      setLoading(false);
    }
  }, [organizationId, getToken, limit]);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  // After invoices land, batch-fetch payment summaries so the AR columns
  // (Paid / Outstanding / Days Overdue) have data. Single round-trip.
  useEffect(() => {
    if (!organizationId || documents.docs.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const ids = documents.docs.map((d) => d.id);
        const res = await request(
          { path: "/payments/summary", method: "POST" },
          { documentIds: ids },
          token,
        );
        if (!cancelled && res?.success) {
          setPaymentSummary(res.data || {});
        }
      } catch {
        // Silent — AR columns will just show 0 paid / full outstanding.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [documents.docs, organizationId, getToken]);

  // Filter invoices by AR tab. Computed live so user-edits to paymentSummary
  // (after recording a payment) update the visible row set.
  // Customers for the Customer filter dropdown (unfiltered, stable options).
  const { customers: filterCustomers = [] } = useGetCustomers({ limit: 1000 });
  const customerNameById = useMemo(() => {
    const m = new Map<string, string>();
    (filterCustomers || []).forEach((c: any) => m.set(c.id, c.name));
    return m;
  }, [filterCustomers]);
  const invoiceFilterConfig: FilterField[] = useMemo(
    () => [
      { type: "dateRange", key: "createdOn", label: "Created On" },
      { type: "select", key: "status", label: "Status", options: INVOICE_STATUS_OPTIONS },
      { type: "select", key: "customerId", label: "Customer", options: (filterCustomers || []).map((c: any) => ({ value: c.id, label: c.name })) },
    ],
    [filterCustomers],
  );

  const visibleDocs = (() => {
    let docs = arTab === "all" ? documents.docs : documents.docs.filter((d) => arStatusOf(d) === arTab);
    // Apply the filter-drawer selections (previously stored but never applied).
    const statusFilter = filters.status;
    if (statusFilter) {
      docs = docs.filter((d) => (d.status || "").toLowerCase() === statusFilter.toLowerCase());
    }
    const customerFilter = filters.customerId;
    if (customerFilter) {
      // Invoice docs carry the customer NAME (associated_customer), rarely an id
      // — match on either.
      const name = customerNameById.get(customerFilter);
      docs = docs.filter((d) => {
        const docCustId = (d as any).customerId || (d as any).customer?.id;
        const docCustName = (d as any).associated_customer || (d as any).customer?.name;
        return (docCustId && docCustId === customerFilter) || (!!name && docCustName === name);
      });
    }
    const start = filters.createdOn?.startDate ? new Date(filters.createdOn.startDate) : null;
    const end = filters.createdOn?.endDate ? new Date(filters.createdOn.endDate) : null;
    if (end) end.setHours(23, 59, 59, 999);
    if (start || end) {
      docs = docs.filter((d) => {
        const c = (d as any).createdAt ? new Date((d as any).createdAt) : null;
        if (!c) return false;
        if (start && c < start) return false;
        if (end && c > end) return false;
        return true;
      });
    }
    // Search across the meaningful fields (was previously a no-op).
    const term = (search || "").trim().toLowerCase();
    if (term) {
      docs = docs.filter((d) => {
        const hay = [
          (d as any).name,
          (d as any).associated_customer,
          (d as any).associated_item,
          (d as any).documentType,
          (d as any).status,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(term);
      });
    }
    return docs;
  })();

  // Header-driven sorting over the WHOLE filtered list (not just the visible
  // page) — the table itself is in manualSorting mode (guru 2026-09-09).
  const { sorted: sortedDocs, sorting, sortingProps } = useClientSort(visibleDocs, {
    reference: (d: any) => {
      const c: any = d.config || {};
      return c?.documentInfo?.referenceNo || c?.referenceNo || c?.reference || c?.xeroReference || "";
    },
    dueDate: (d: any) => d.config?.dueDate || null,
    status: (d: any) => arStatusOf(d),
    xeroSync: (d: any) => (d.config?.xeroInvoiceId ? d.config?.xeroStatus || "SYNCED" : ""),
    outstanding: (d: any) => {
      if (arStatusOf(d) === "paid") return 0;
      const paid = paymentSummary[d.id]?.totalPaid ?? 0;
      return Math.max(0, getInvoiceTotal(d) - paid);
    },
    daysOverdue: (d: any) => daysOverdue(d),
    createdAt: (d: any) => d.config?.date ?? d.createdAt,
  });

  // Sort changes also restart at page 1 (separate effect — `sorting` is
  // declared just above and can't be referenced by the earlier reset).
  useEffect(() => {
    setPage(1);
  }, [sorting]);

  // Bulk-bar derived state. Delete only applies to unconfirmed/draft
  // invoices (same rule as the row kebab's "Delete draft") — confirmed rows
  // stay selected but are skipped, and the bar says so.
  const selectedDocs = documents.docs.filter((d) => selectedIds.has(d.id));
  const deletableSelected = selectedDocs.filter((d) => ["draft", "unconfirmed"].includes(d.status || "unconfirmed"));
  const skippedCount = selectedDocs.length - deletableSelected.length;

  // PDF download (guru 2026-09-11): one invoice downloads its PDF; several
  // download as one ZIP. Server names each file
  // "<document name> - <reference>.pdf". Shared by the bulk-action bar AND
  // the row kebab's "Download PDF" (guru wants both identical).
  const [bulkDownloading, setBulkDownloading] = useState(false);
  const downloadPdfs = async (ids: string[]) => {
    if (ids.length === 0 || bulkDownloading) return;
    setBulkDownloading(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Authentication required");
      const res = await request(
        // Generating many fresh PDFs (Puppeteer) can exceed the 30s default —
        // give the batch a longer per-call timeout.
        { path: "/documents/bulk-download", method: "POST", timeout: 180000 },
        { ids },
        token
      );
      // The API's global CustomResponseInterceptor wraps every body as
      // { success, data, message } — the real payload sits under data.
      const payload = res?.data;
      if (!res?.success || !payload?.base64) throw new Error((!res?.success && res?.message) || "Download failed");
      const bytes = Uint8Array.from(atob(payload.base64), (ch) => ch.charCodeAt(0));
      const blob = new Blob([bytes], { type: payload.mime || "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = payload.filename || "invoices.zip";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      if (payload.failed?.length) toast.warn(`${payload.failed.length} document${payload.failed.length === 1 ? "" : "s"} could not be included`);
    } catch (err: any) {
      console.error("Bulk download failed:", err);
      toast.error(err?.message || "Failed to download PDFs");
    } finally {
      setBulkDownloading(false);
    }
  };
  const handleBulkDownload = () => downloadPdfs(selectedDocs.map((d) => d.id));

  const handleBulkDelete = async () => {
    const ids = deletableSelected.map((d) => d.id);
    if (ids.length === 0) return;
    setBulkDeleting(true);
    const deleted = new Set<string>();
    let failed = 0;
    // Sequential on purpose: each delete also voids the doc's GL entry
    // server-side; hammering them in parallel risks version conflicts.
    for (const id of ids) {
      try {
        await deleteDocumentMutation.mutateAsync(id);
        deleted.add(id);
      } catch (err) {
        console.error("Bulk delete failed for", id, err);
        failed += 1;
      }
    }
    setBulkDeleting(false);
    setBulkDeleteOpen(false);
    if (deleted.size) toast.success(`Deleted ${deleted.size} invoice${deleted.size === 1 ? "" : "s"}`);
    if (failed) toast.error(`${failed} invoice${failed === 1 ? "" : "s"} failed to delete`);
    setDocuments((prev) => ({
      ...prev,
      docs: (prev.docs || []).filter((d) => !deleted.has(d.id)),
      totalDocs: Math.max(0, (prev.totalDocs || 0) - deleted.size),
    }));
    setSelectedIds((prev) => new Set(Array.from(prev).filter((id) => !deleted.has(id))));
  };

  const arCounts = (() => {
    let draft = 0,
      awaiting = 0,
      overdue = 0,
      paid = 0;
    for (const d of documents.docs) {
      const s = arStatusOf(d);
      if (s === "draft") draft += 1;
      else if (s === "awaiting") awaiting += 1;
      else if (s === "overdue") overdue += 1;
      else if (s === "paid") paid += 1;
    }
    return { all: documents.docs.length, draft, awaiting, overdue, paid };
  })();

  // Add useState and onSubmit above return
  const [isDocumentTemplateUpdating, setIsDocumentTemplateUpdating] = useState(false);

  const typeToIdMap: Record<string, string> = {};

  const getTemplateIdByType = async (documentType: string, token: string) => {
    try {
      const response = await request(
        {
          path: `/documentTemplates/type/${documentType}`,
          method: "GET",
        },
        {},
        token
      );

      if (response?.success && response.data?.id) {
        return response.data.id;
      } else {
        console.warn("Template ID not found, using fallback from typeToIdMap");
        return typeToIdMap[documentType] || documentType;
      }
    } catch (error) {
      console.error("Error fetching template ID by type:", error);
      return typeToIdMap[documentType] || documentType;
    }
  };

  const handleCreateInvoiceClick = () => {
    setCustomerDrawerOpen(true);
  };

  const handleCustomerSelect = (customer: Customer) => {
    console.log("Customer selected:", customer);
    setSelectedCustomer(customer);
    // Don't use handleDrawerClose as it clears selectedCustomer
    setCustomerDrawerOpen(false);
    // Open variant selection drawer after a brief delay to ensure state is updated
    setTimeout(() => {
      setVariantDrawerOpen(true);
    }, 100);
  };

  const handleVariantSelect = (variant: any) => {
    console.log("=== VARIANT SELECTED ===");
    console.log("Variant:", variant);
    console.log("Template ID:", variant.id);
    console.log("Document Type:", variant.type);
    console.log("Template Variant:", variant.templateVariant);
    console.log("Selected Customer:", selectedCustomer);

    setVariantDrawerOpen(false);

    // Create invoice with selected customer and variant
    if (selectedCustomer) {
      console.log("Customer exists, calling onSubmit");
      // Use the document type from the template (e.g., "INVOICE")
      onSubmit({
        documentType: variant.type, // Use type from the template
        templateVariant: variant.templateVariant
      }, selectedCustomer, variant.id);
    } else {
      console.error("No customer selected! This shouldn't happen.");
      toast.error("Please select a customer first");
      // Reopen customer drawer
      setCustomerDrawerOpen(true);
    }
  };

  const handleDrawerClose = () => {
    setCustomerDrawerOpen(false);
    setSelectedCustomer(null);
  };

  const handleVariantDrawerClose = () => {
    setVariantDrawerOpen(false);
    // Don't clear selected customer in case they want to go back
  };

  const onSubmit = async (data: any, customer?: Customer, variantId?: string, numberFormatId?: string) => {
    console.log("=== ONSUBMIT CALLED ===");

    try {
      setIsDocumentTemplateUpdating(true);
      const token = await getToken();

      // Custom numbering: if this document type has more than one active numbering
      // variant and the caller hasn't chosen one, pause and ask which format.
      if (!numberFormatId) {
        try {
          const headers: Record<string, string> = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
          const activeOrgId = typeof window !== "undefined" ? window.sessionStorage.getItem("aims-admin-active-org") : null;
          if (activeOrgId) headers["X-Active-Org-Id"] = activeOrgId;
          // This page always creates invoices — the variant.type may be a template
          // code (TI/TI2), so look up numbering under the canonical "INVOICE".
          const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_API_URL}/document-numbering?documentType=INVOICE`, { headers });
          const json = await res.json();
          const active = ((json?.data ?? json) || []).filter((f: any) => f.isActive);
          if (active.length > 1) {
            setNumberingPicker({ formats: active, data, customer, variantId });
            setIsDocumentTemplateUpdating(false);
            return;
          }
          if (active.length === 1) numberFormatId = active[0].id;
        } catch { /* no custom numbering → legacy */ }
      }

      // Use provided variantId or fetch template ID by type
      let documentTemplateId = variantId;
      if (!documentTemplateId || documentTemplateId.startsWith('default-')) {
        console.log("Fetching template ID for type:", data.documentType);
        documentTemplateId = await getTemplateIdByType(data.documentType, token ?? "");
        console.log("Fetched template ID:", documentTemplateId);
      }

      console.log("=== CREATING DOCUMENT ===");
      console.log("Selected Document Type:", data.documentType);
      console.log("Selected Customer:", customer);
      console.log("Selected Template ID:", documentTemplateId);
      console.log("Organization ID:", organizationId);

      const requestPayload = {
        type: data.documentType, // Use the document type from the template
        config: {
          ...(customer ? { customerId: customer.id, templateVariant: data.templateVariant } : {}),
          ...(numberFormatId ? { numberFormatId } : {}),
        },
        documentTemplateId: documentTemplateId,
        organizationId: organizationId,
      };
      console.log("Request payload:", requestPayload);

      // Re-fetch the token: the numbering + template lookups above can take
      // seconds, and Clerk tokens live 60s — reusing the flow-start token
      // intermittently 401s right here (JWT expired mid-flow).
      const freshToken = await getToken();
      const response = await request(
        {
          path: "/documents/basic",
          method: "POST",
        },
        requestPayload,
        freshToken ?? token ?? undefined
      );

      console.log("=== RESPONSE RECEIVED ===");
      console.log("Full Response:", response);
      console.log("Response success:", response?.success);
      console.log("Response data:", response?.data);

      if (!response || !response.success) {
        console.error("Document creation failed:", response);
        alert(`Failed to create document: ${response?.message || 'Unknown error'}`);
        return;
      }

      const createdDocumentId = response?.data?.id;
      if (!createdDocumentId) {
        console.error("No document ID in response:", response);
        alert("Failed to create document: No document ID returned");
        return;
      }

      console.log("Created Document ID:", createdDocumentId);

      // Navigate to the document with customer pre-selected
      // Use the document type from the template
      const url = `/portal/documents/${data.documentType}/${documentTemplateId}/${createdDocumentId}`;
      const urlWithCustomer = customer ? `${url}?customerId=${customer.id}` : url;

      console.log("=== NAVIGATING ===");
      console.log("Navigation URL:", urlWithCustomer);

      toast.success("Invoice created successfully! Redirecting...");

      // Small delay to ensure toast is visible
      setTimeout(() => {
        router.push(urlWithCustomer);
        console.log("Navigation triggered");
      }, 500);
    } catch (error) {
      console.error("=== ERROR IN ONSUBMIT ===");
      console.error("Error submitting form:", error);
      alert(`Error creating invoice: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsDocumentTemplateUpdating(false);
      console.log("isDocumentTemplateUpdating set to false");
    }
  };

  // Create additional action buttons
  const actionButtons = [];

  // Only show "Connect Xero" button if not connected
  if (connectionStatus && !connectionStatus.connected && !xeroLoading) {
    actionButtons.push(
      <Button
        key="connect-xero"
        variant="outlined"
        startIcon={<LinkIcon />}
        onClick={connectToXero}
        sx={{
          borderColor: "primary.main",
          color: "primary.main",
          "&:hover": {
            borderColor: "primary.dark",
            backgroundColor: "primary.light",
          },
        }}
      >
        Connect Xero
      </Button>
    );
  }

  return (
    <MainCard>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {/* Show Xero connection status */}
      {connectionStatus && connectionStatus.connected && (
        <Alert severity="success" sx={{ mb: 2 }}>
          ✅ Xero is connected! Invoices will be automatically synced.
        </Alert>
      )}

      <PageTable
        onRowClick={openInvoice}
        rowHref={invoiceUrl}
        // This page renders its own id-keyed checkbox column (survives
        // paging, feeds the BulkActionBar) — hide Table's built-in one.
        noSelectionColumn
        columns={columns}
        // PageTable renders `data` as-is — hand it only the CURRENT page's
        // slice, or every filtered row renders at once and the pager does
        // nothing (guru 2026-08-07).
        data={sortedDocs.slice((page - 1) * limit, page * limit)}
        {...sortingProps}
        tableName="Invoice List"
        subTitle="Invoice Detail Information"
        buttonName="Create Invoice"
        onAddClick={createInvoice}
        buttonDisabled={creatingInvoice}
        loading={loading || isDocumentTemplateUpdating}
        page={page}
        limit={limit}
        search={search}
        filters={filters}
        setPage={setPage}
        setLimit={setLimit}
        setSearch={setSearch}
        setFilters={handleSetFilters}
        filterConfig={invoiceFilterConfig}
        pageCount={Math.ceil(visibleDocs.length / limit)}
        totalDocs={visibleDocs.length}
        actionButtons={actionButtons}
        headerContent={
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
            <InvoiceStatistics documents={documents.docs} loading={loading} />
            <Box sx={{ borderBottom: 1, borderColor: "divider" }}>
              <Tabs
                value={arTab}
                onChange={(_, v) => setArTab(v)}
                sx={{ minHeight: 36, "& .MuiTab-root": { minHeight: 36, textTransform: "none", fontWeight: 600 } }}
              >
                <Tab value="all" label={<TabLabel text="All" count={arCounts.all} />} />
                <Tab value="draft" label={<TabLabel text="Unconfirmed" count={arCounts.draft} />} />
                <Tab value="awaiting" label={<TabLabel text="Awaiting Payment" count={arCounts.awaiting} tone="info" />} />
                <Tab value="overdue" label={<TabLabel text="Overdue" count={arCounts.overdue} tone="error" />} />
                <Tab value="paid" label={<TabLabel text="Paid" count={arCounts.paid} tone="success" />} />
              </Tabs>
            </Box>
          </Box>
        }
      />

      {/* Floating bulk-action bar (CIEL-editor pattern) */}
      <BulkActionBar
        count={selectedDocs.length}
        onClear={() => setSelectedIds(new Set())}
        actions={[
          {
            key: "download",
            label: bulkDownloading ? "Preparing…" : "Download",
            icon: <DownloadIcon />,
            disabled: bulkDownloading,
            tooltip:
              selectedDocs.length > 1
                ? "Download the selected invoices' PDFs as one ZIP"
                : "Download this invoice's PDF",
            onClick: handleBulkDownload,
          },
          {
            key: "delete",
            label: skippedCount > 0 && deletableSelected.length > 0 ? `Delete ${deletableSelected.length} unconfirmed` : "Delete",
            icon: <DeleteIcon />,
            color: "error",
            disabled: deletableSelected.length === 0 || bulkDeleting,
            tooltip:
              deletableSelected.length === 0
                ? "Only unconfirmed (draft) invoices can be deleted"
                : skippedCount > 0
                ? `${skippedCount} confirmed invoice${skippedCount === 1 ? "" : "s"} in the selection will be skipped`
                : "Delete the selected unconfirmed invoices",
            onClick: () => setBulkDeleteOpen(true),
          },
        ]}
      />

      {/* Bulk delete confirm */}
      <Dialog open={bulkDeleteOpen} onClose={() => !bulkDeleting && setBulkDeleteOpen(false)}>
        <DialogTitle>Delete {deletableSelected.length} invoice{deletableSelected.length === 1 ? "" : "s"}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Delete {deletableSelected.length} unconfirmed invoice{deletableSelected.length === 1 ? "" : "s"}? This cannot be undone.
            {skippedCount > 0 &&
              ` ${skippedCount} confirmed invoice${skippedCount === 1 ? "" : "s"} in the selection will not be touched.`}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBulkDeleteOpen(false)} disabled={bulkDeleting}>
            Cancel
          </Button>
          <Button color="error" variant="contained" onClick={handleBulkDelete} disabled={bulkDeleting}>
            {bulkDeleting ? "Deleting..." : "Delete"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Row kebab menu (CLAUDE.md table pattern) */}
      <Menu anchorReference="anchorPosition" anchorPosition={rowMenu?.pos} open={!!rowMenu} onClose={() => setRowMenu(null)}>
        <MenuItem onClick={() => { const r = rowMenu!.row; setRowMenu(null); openInvoice(r); }}>Open</MenuItem>
        <MenuItem onClick={() => { const r = rowMenu!.row; setRowMenu(null); openInvoiceNewTab(r); }}>Open in new tab</MenuItem>
        {rowMenu &&
          !["draft", "unconfirmed"].includes(rowMenu.row.status || "unconfirmed") &&
          arStatusOf(rowMenu.row) !== "paid" && (
            <MenuItem onClick={() => { const r = rowMenu!.row; setRowMenu(null); openPayDialogFor(r); }}>
              Record payment
            </MenuItem>
          )}
        {/* Same server-rendered branded PDF as the bulk bar's Download
            (guru 2026-09-11) — not the old print-view popup. */}
        <MenuItem onClick={() => { const r = rowMenu!.row; setRowMenu(null); downloadPdfs([r.id]); }}>Download PDF</MenuItem>
        {rowMenu && ["draft", "unconfirmed"].includes(rowMenu.row.status || "unconfirmed") && (
          <MenuItem sx={{ color: "error.main" }} onClick={() => { const r = rowMenu!.row; setRowMenu(null); setDocToDelete(r); }}>
            Delete draft
          </MenuItem>
        )}
      </Menu>

      {/* Customer Selection Drawer */}
      {/* Shared create-flow pickers (number format + template) */}
      {createFlowDialogs}

      <CustomerSelectionDrawer open={customerDrawerOpen} onClose={handleDrawerClose} onSelectCustomer={handleCustomerSelect} />

      {/* Invoice Variant Selection Drawer */}
      <InvoiceVariantDrawer
        open={variantDrawerOpen}
        onClose={handleVariantDrawerClose}
        onSelectVariant={handleVariantSelect}
        selectedCustomer={selectedCustomer}
      />

      {/* Quick Record-Payment dialog opened from the per-row Pay icon */}
      <RecordPaymentDialog
        open={payDialogOpen}
        onClose={() => setPayDialogOpen(false)}
        onSuccess={() => {
          setPayDialogOpen(false);
          fetchDocuments();
        }}
        invoice={payDialogInvoice}
      />

      {/* Numbering-variant picker — shown when the type has >1 active format */}
      <Dialog open={!!numberingPicker} onClose={() => setNumberingPicker(null)} fullWidth maxWidth="xs">
        <DialogTitle>Choose number format</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>This document type has multiple numbering formats. Which one should this document use?</DialogContentText>
          <Stack gap={1}>
            {(numberingPicker?.formats || []).map((f: any) => (
              <Button
                key={f.id}
                variant="outlined"
                onClick={() => {
                  const p = numberingPicker!;
                  setNumberingPicker(null);
                  onSubmit(p.data, p.customer, p.variantId, f.id);
                }}
                sx={{ justifyContent: "flex-start", textTransform: "none", py: 1 }}
              >
                <Box sx={{ textAlign: "left" }}>
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>{f.label}</Typography>
                  <Typography variant="caption" sx={{ color: "text.secondary", fontVariantNumeric: "tabular-nums" }}>{f.preview || f.pattern}</Typography>
                </Box>
              </Button>
            ))}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setNumberingPicker(null)}>Cancel</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!docToDelete} onClose={() => setDocToDelete(null)}>
        <DialogTitle>Delete Invoice</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Delete &quot;{docToDelete?.name || "this draft"}&quot;? This cannot be undone.
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
    </MainCard>
  );
}

function TabLabel({
  text,
  count,
  tone,
}: {
  text: string;
  count: number;
  tone?: "info" | "error" | "success";
}) {
  return (
    <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.75 }}>
      {text}
      <Chip
        size="small"
        label={count}
        variant="outlined"
        color={tone ?? "default"}
        sx={{ height: 18, fontSize: "0.65rem", "& .MuiChip-label": { px: 0.75 } }}
      />
    </Box>
  );
}
