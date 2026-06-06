"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { request } from "@/helpers/request";
import MainCard from "@/components/MainCard";
import PageTable from "@/components/PageTable";
import { Box, IconButton, Alert, Button } from "@mui/material";
import VisibilityIcon from "@mui/icons-material/Visibility";
import DownloadIcon from "@mui/icons-material/Download";
import LinkIcon from "@mui/icons-material/Link";
import PaymentIcon from "@mui/icons-material/Payment";
import { Tab, Tabs, Chip, alpha } from "@mui/material";
import { useRouter } from "next/navigation";
import moment from "moment";
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

export default function InvoicesPage() {
  const router = useRouter();
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
  const [arTab, setArTab] = useState<"all" | "awaiting" | "overdue" | "paid">("all");
  const [payDialogOpen, setPayDialogOpen] = useState(false);
  const [payDialogInvoice, setPayDialogInvoice] = useState<any>(null);

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

  // Derived per-invoice status for AR tabs. "paid" beats document status.
  const arStatusOf = (doc: any): "paid" | "overdue" | "awaiting" => {
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
      accessorKey: "name",
      header: "Document SKU",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cell: ({ row }: any) => row.original.name,
    },
    {
      accessorKey: "associated_customer",
      header: "Associated Customer",
    },
    {
      accessorKey: "associated_item",
      header: "Associated Item",
    },
    {
      accessorKey: "dueDate",
      header: "Due Date",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cell: ({ row }: any) => {
        const dueDate = row.original.config?.dueDate;
        return dueDate ? moment(dueDate).format("DD/MM/YYYY") : "N/A";
      },
    },
    {
      accessorKey: "status",
      header: "Status",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cell: ({ row }: any) => {
        const status = row.original.status;
        // Format status for display
        const formatStatus = (status: string) => {
          if (!status) return "Draft";
          return status
            .split("_")
            .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
            .join(" ");
        };

        // Get color based on status
        const getStatusColor = (status: string) => {
          switch (status) {
            case "draft":
              return "text.secondary";
            case "pending_delivery":
              return "warning.main";
            case "delivered_not_installed":
              return "info.main";
            case "delivered_installed":
              return "success.main";
            case "pending_payment":
              return "warning.main";
            case "paid":
              return "success.main";
            case "pending_return":
              return "warning.main";
            case "returned":
              return "text.secondary";
            default:
              return "text.primary";
          }
        };

        return (
          <Box
            sx={{
              color: getStatusColor(status || "draft"),
              fontWeight: 500,
              textTransform: "capitalize",
            }}
          >
            {formatStatus(status || "draft")}
          </Box>
        );
      },
    },
    {
      accessorKey: "outstanding",
      header: "Outstanding",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cell: ({ row }: any) => {
        const total = getInvoiceTotal(row.original);
        const paid = paymentSummary[row.original.id]?.totalPaid ?? 0;
        const outstanding = Math.max(0, total - paid);
        const fmt = (n: number) =>
          n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        return (
          <Box sx={{ textAlign: "right", fontFamily: "monospace" }}>
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
      header: "Created Date",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cell: ({ row }: any) => moment(row.original.createdAt).format("DD/MM/YYYY"),
    },
    {
      accessorKey: "action",
      header: "Action",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cell: ({ row }: any) => {
        const { documentType, templateId, id } = row.original;

        const handleDownload = () => {
          // Open document in view mode in a new tab and auto-trigger print
          const viewUrl = `/portal/documents/view/${documentType}/${templateId}/${id}?autoprint=true`;
          window.open(viewUrl, "_blank");
        };

        const status = arStatusOf(row.original);
        return (
          <Box sx={{ display: "flex", gap: "var(--default-gap)" }}>
            {status !== "paid" && (
              <IconButton
                title="Record payment"
                onClick={() => {
                  const total = getInvoiceTotal(row.original);
                  const paid = paymentSummary[row.original.id]?.totalPaid ?? 0;
                  setPayDialogInvoice({
                    id: row.original.id,
                    name: row.original.name,
                    customerId: row.original.config?.customer?.id,
                    customerName:
                      row.original.associated_customer ||
                      row.original.config?.customer?.name,
                    amount: Math.max(0, total - paid),
                    status: row.original.status,
                  });
                  setPayDialogOpen(true);
                }}
                sx={{
                  color: "text.secondary",
                  "&:hover": { color: "success.main" },
                }}
              >
                <PaymentIcon />
              </IconButton>
            )}
            <IconButton
              onClick={() => router.push(`/portal/documents/${documentType}/${templateId}/${id}`)}
              sx={{
              color: "text.secondary",
              "&:hover": { color: "primary.main" },
              }}
            >
              <VisibilityIcon />
            </IconButton>
            <IconButton
              onClick={handleDownload}
              sx={{
              color: "text.secondary",
              "&:hover": { color: "primary.main" },
              }}
            >
              <DownloadIcon />
            </IconButton>
          </Box>
        );
      },
    },
  ];

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
  const visibleDocs = (() => {
    if (arTab === "all") return documents.docs;
    return documents.docs.filter((d) => arStatusOf(d) === arTab);
  })();

  const arCounts = (() => {
    let awaiting = 0,
      overdue = 0,
      paid = 0;
    for (const d of documents.docs) {
      const s = arStatusOf(d);
      if (s === "awaiting") awaiting += 1;
      else if (s === "overdue") overdue += 1;
      else if (s === "paid") paid += 1;
    }
    return { all: documents.docs.length, awaiting, overdue, paid };
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

  const onSubmit = async (data: any, customer?: Customer, variantId?: string) => {
    console.log("=== ONSUBMIT CALLED ===");
    console.log("Data:", data);
    console.log("Customer:", customer);
    console.log("Variant ID:", variantId);

    try {
      setIsDocumentTemplateUpdating(true);
      const token = await getToken();

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
        config: customer ? { customerId: customer.id, templateVariant: data.templateVariant } : {},
        documentTemplateId: documentTemplateId,
        organizationId: organizationId,
      };
      console.log("Request payload:", requestPayload);

      const response = await request(
        {
          path: "/documents/basic",
          method: "POST",
        },
        requestPayload,
        token ?? undefined
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
        columns={columns}
        data={visibleDocs}
        tableName="Invoice List"
        subTitle="Invoice Detail Information"
        buttonName="Create Invoice"
        onAddClick={handleCreateInvoiceClick}
        loading={loading || isDocumentTemplateUpdating}
        page={page}
        limit={limit}
        search={search}
        filters={filters}
        setPage={setPage}
        setLimit={setLimit}
        setSearch={setSearch}
        setFilters={handleSetFilters}
        availableFilters={["status", "category", "createdOn"]}
        pageCount={documents.totalPages}
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
                <Tab value="awaiting" label={<TabLabel text="Awaiting Payment" count={arCounts.awaiting} tone="info" />} />
                <Tab value="overdue" label={<TabLabel text="Overdue" count={arCounts.overdue} tone="error" />} />
                <Tab value="paid" label={<TabLabel text="Paid" count={arCounts.paid} tone="success" />} />
              </Tabs>
            </Box>
          </Box>
        }
      />

      {/* Customer Selection Drawer */}
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
