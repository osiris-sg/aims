"use client";

import React, { useMemo, useState } from "react";
import { useGetDocuments, useDeleteDocument } from "@/app/portal/hooks/api";
import { useGetCustomers } from "@/app/portal/hooks/api/useCustomers";
import MainCard from "@/components/MainCard";
import PageTable from "@/components/PageTable";
import type { FilterField } from "@/components/FilterDrawer";
import { Box, IconButton, Alert, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, Button } from "@mui/material";
import VisibilityIcon from "@mui/icons-material/Visibility";
import DownloadIcon from "@mui/icons-material/Download";
import DeleteIcon from "@mui/icons-material/Delete";
import { useRouter } from "next/navigation";
import moment from "moment";
import { toast } from "react-toastify";

interface Document {
  id: string;
  name: string;
  associated_item: string;
  associated_customer: string;
  status: string;
  documentType: string;
  templateId: string;
  createdAt: string;
}

interface Filters {
  status?: string;
  documentType?: string;
  customerId?: string;
  createdOn?: {
    startDate: string | null;
    endDate: string | null;
  };
}

// Mirrors api-server-production/prisma/schema.prisma DocumentStatus enum.
const DOCUMENT_STATUS_OPTIONS = [
  { value: "draft", label: "Draft" },
  { value: "confirmed", label: "Confirmed" },
  { value: "pending_delivery", label: "Pending Delivery" },
  { value: "delivered_not_installed", label: "Delivered (Not Installed)" },
  { value: "delivered_installed", label: "Delivered & Installed" },
  { value: "pending_payment", label: "Pending Payment" },
  { value: "paid", label: "Paid" },
  { value: "pending_return", label: "Pending Return" },
  { value: "returned", label: "Returned" },
];

const DOCUMENT_TYPE_OPTIONS = [
  { value: "QUOTATION", label: "Quotation" },
  { value: "DELIVERY_ORDER", label: "Delivery Order" },
  { value: "PURCHASE_ORDER", label: "Purchase Order" },
  { value: "RECEIVED_DELIVERY_ORDER", label: "Received DO" },
  { value: "TAKE_IN", label: "Take In" },
  { value: "MATERIAL_SERVICE_REPORT", label: "Material Service Report" },
];

// Document.type is stored inconsistently — a mix of canonical long names
// ("DELIVERY_ORDER", "QUOTATION") and short variant codes ("DO", "PO", "TI2").
// Canonicalize both the stored value and the filter value before comparing so
// e.g. selecting "Purchase Order" matches docs stored as "PO".
const DOCUMENT_TYPE_ALIASES: Record<string, string> = {
  QO1: "QUOTATION", QO2: "QUOTATION", QO: "QUOTATION", QT: "QUOTATION", QUOTATION: "QUOTATION",
  DO: "DELIVERY_ORDER", DELIVERY_ORDER: "DELIVERY_ORDER",
  RDO: "RECEIVED_DELIVERY_ORDER", RECEIVED_DELIVERY_ORDER: "RECEIVED_DELIVERY_ORDER",
  PO: "PURCHASE_ORDER", PURCHASE_ORDER: "PURCHASE_ORDER",
  PR: "PURCHASE_RETURN", PURCHASE_RETURN: "PURCHASE_RETURN",
  TKI: "TAKE_IN", TAKE_IN: "TAKE_IN",
  MSR: "MATERIAL_SERVICE_REPORT", MATERIAL_SERVICE_REPORT: "MATERIAL_SERVICE_REPORT",
  SO: "SALES_ORDER", SALES_ORDER: "SALES_ORDER",
  TI: "INVOICE", TI2: "INVOICE", INVOICE: "INVOICE",
  CN: "CREDIT_NOTE", DN: "DEBIT_NOTE", SAI: "STOCK_ADJUSTMENT_IN", SAO: "STOCK_ADJUSTMENT_OUT", BILL: "BILL",
};
const canonDocType = (t: any) => {
  const key = String(t || "").toUpperCase();
  return DOCUMENT_TYPE_ALIASES[key] || key;
};

export default function DocumentsPage() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Filters>({
    status: "",
    documentType: "",
    customerId: "",
    createdOn: {
      startDate: null,
      endDate: null,
    },
  });
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [documentToDelete, setDocumentToDelete] = useState<Document | null>(null);

  // Fetch documents with new hook
  const { documents = [], isLoading, error, refetch } = useGetDocuments();

  // Customers for the Customer filter dropdown
  const { customers = [] } = useGetCustomers({ limit: 1000 });

  // Filter out INVOICE type documents (they have their own page) AND apply
  // the user's search + status + documentType + customer + createdOn filters.
  const filteredDocuments = useMemo(() => {
    const term = (search || "").trim().toLowerCase();
    const statusFilter = (filters?.status || "").trim();
    const typeFilter = (filters?.documentType || "").trim();
    const customerFilter = (filters?.customerId || "").trim();
    const startDate = filters?.createdOn?.startDate ? new Date(filters.createdOn.startDate) : null;
    const endDate = filters?.createdOn?.endDate ? new Date(filters.createdOn.endDate) : null;
    if (endDate) endDate.setHours(23, 59, 59, 999);

    const customerNameById = new Map<string, string>();
    (customers || []).forEach((c: any) => customerNameById.set(c.id, c.name));
    const selectedCustomerName = customerFilter ? customerNameById.get(customerFilter) : "";

    return (documents || []).filter((doc: any) => {
      if (doc.documentType === "INVOICE") return false;
      if (statusFilter && (doc.status || "").toLowerCase() !== statusFilter.toLowerCase()) return false;
      if (typeFilter && canonDocType(doc.documentType) !== canonDocType(typeFilter)) return false;
      if (customerFilter) {
        // documents API returns associated_customer as a string label, not an id.
        // Fall back to comparing on customerId if present.
        const docCustomerId = doc.customerId || doc.customer?.id;
        const docCustomerName = doc.associated_customer || doc.customer?.name;
        const matchesById = docCustomerId && docCustomerId === customerFilter;
        const matchesByName = selectedCustomerName && docCustomerName === selectedCustomerName;
        if (!matchesById && !matchesByName) return false;
      }
      if (startDate && new Date(doc.createdAt) < startDate) return false;
      if (endDate && new Date(doc.createdAt) > endDate) return false;
      if (term) {
        const haystack = [
          doc.name,
          doc.associated_item,
          doc.associated_customer,
          doc.documentType,
          doc.status,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    });
  }, [documents, customers, search, filters]);

  const filterConfig: FilterField[] = useMemo(
    () => [
      { type: "dateRange", key: "createdOn", label: "Created On" },
      { type: "select", key: "status", label: "Status", options: DOCUMENT_STATUS_OPTIONS },
      { type: "select", key: "documentType", label: "Document Type", options: DOCUMENT_TYPE_OPTIONS },
      {
        type: "select",
        key: "customerId",
        label: "Customer",
        options: (customers || []).map((c: any) => ({ value: c.id, label: c.name })),
      },
    ],
    [customers],
  );

  // Delete document mutation
  const deleteDocumentMutation = useDeleteDocument();

  const columns = [
    {
      accessorKey: "name",
      header: "Document Name",
    },
    {
      accessorKey: "associated_item",
      header: "Associated Item",
    },
    {
      accessorKey: "associated_customer",
      header: "Associated Customer",
    },
    {
      accessorKey: "createdAt",
      header: "Created Date",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cell: ({ row }: any) => moment(row.original.createdAt).format("DD/MM/YYYY"),
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
      accessorKey: "action",
      header: "Action",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cell: ({ row }: any) => {
        const { documentType, templateId, id, status } = row.original;
        const isDraft = (status || "draft") === "draft";

        const handleDownload = () => {
          // Open document in view mode in a new tab and auto-trigger print
          const viewUrl = `/portal/documents/view/${documentType}/${templateId}/${id}?autoprint=true`;
          window.open(viewUrl, "_blank");
        };

        return (
          <Box sx={{ display: "flex", gap: "var(--default-gap)" }}>
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
            {isDraft && (
              <IconButton
                onClick={() => handleDeleteClick(row.original)}
                sx={{
                color: "text.secondary",
                "&:hover": { color: "error.main" },
                }}
              >
                <DeleteIcon />
              </IconButton>
            )}
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

  const handleDeleteClick = (document: Document) => {
    setDocumentToDelete(document);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!documentToDelete) return;

    try {
      await deleteDocumentMutation.mutateAsync(documentToDelete.id);
      toast.success("Document deleted successfully");
      setDeleteDialogOpen(false);
      setDocumentToDelete(null);
      refetch();
    } catch (error: any) {
      console.error("Error deleting document:", error);
      toast.error(error.message || "An error occurred while deleting the document");
    }
  };

  const handleDeleteCancel = () => {
    setDeleteDialogOpen(false);
    setDocumentToDelete(null);
  };

  return (
    <MainCard>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {String(error)}
        </Alert>
      )}
      <PageTable
        columns={columns}
        data={filteredDocuments}
        tableName="Document List"
        subTitle="Document Detail Information"
        buttonName="Create Document"
        onAddClick={() => router.push("/portal/documents/create")}
        loading={isLoading}
        page={page}
        limit={limit}
        search={search}
        filters={filters}
        setPage={setPage}
        setLimit={setLimit}
        setSearch={setSearch}
        setFilters={handleSetFilters}
        filterConfig={filterConfig}
        pageCount={Math.ceil(filteredDocuments.length / limit)}
        totalDocs={filteredDocuments.length}
      />

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteDialogOpen}
        onClose={handleDeleteCancel}
        aria-labelledby="delete-dialog-title"
        aria-describedby="delete-dialog-description"
      >
        <DialogTitle id="delete-dialog-title">
          Delete Document
        </DialogTitle>
        <DialogContent>
          <DialogContentText id="delete-dialog-description">
            Are you sure you want to delete "{documentToDelete?.name}"? This action cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleDeleteCancel} disabled={deleteDocumentMutation.isPending}>
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
