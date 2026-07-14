"use client";

import React, { useState, useMemo } from "react";
import { useGetDocuments, useDeleteDocument, useGetCustomers } from "@/app/portal/hooks/api";
import MainCard from "@/components/MainCard";
import PageTable from "@/components/PageTable";
import type { FilterField } from "@/components/FilterDrawer";
import {
  Box,
  IconButton,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
} from "@mui/material";
import VisibilityIcon from "@mui/icons-material/Visibility";
import DownloadIcon from "@mui/icons-material/Download";
import DeleteIcon from "@mui/icons-material/Delete";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import DocumentUploadDialog from "@/app/portal/components/DocumentUploadDialog";
import { useRouter } from "next/navigation";
import moment from "moment";
import { toast } from "react-toastify";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { request } from "@/helpers/request";
import StatusChip from "@/components/StatusChip";

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
  category?: string;
  createdOn?: {
    startDate: string | null;
    endDate: string | null;
  };
}

// Document statuses (NOT the legacy inventory statuses) for the sales filter
// drawer. Customer + (when the list spans >1 type) Document Type are appended
// at runtime. Category is omitted (sales docs have none).
const SALES_STATUS_OPTIONS = [
  { value: "draft", label: "Draft" },
  { value: "confirmed", label: "Confirmed" },
  { value: "pending_delivery", label: "Pending Delivery" },
  { value: "delivered_not_installed", label: "Delivered (Not Installed)" },
  { value: "delivered_installed", label: "Delivered & Installed" },
  { value: "pending_return", label: "Pending Return" },
  { value: "returned", label: "Returned" },
];

const prettyDocType = (t: string) =>
  String(t || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());

export interface SalesDocumentListProps {
  documentTypes: string[];
  title: string;
  subtitle: string;
  createButtonLabel: string;
  createDocumentType: string; // The document type to create (e.g., "SO", "DO", "TI")
  showDelete?: boolean;
  additionalColumns?: any[];
  headerContent?: React.ReactNode;
  actionButtons?: React.ReactNode[];
}

export default function SalesDocumentList({
  documentTypes,
  title,
  subtitle,
  createButtonLabel,
  createDocumentType,
  showDelete = true,
  additionalColumns = [],
  headerContent,
  actionButtons,
}: SalesDocumentListProps) {
  const router = useRouter();
  const { getToken } = useAuth();
  const { organization } = useOrganization();
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
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [documentToDelete, setDocumentToDelete] = useState<Document | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  // OSI-13: upload → AI-extract → pre-fill draft (same entry as the generic
  // document list). documentLabel strips the "New " prefix off createButtonLabel.
  const [uploadOpen, setUploadOpen] = useState(false);
  const uploadDocumentLabel = (createButtonLabel || createDocumentType).replace(/^(new|create)\s+/i, "");

  // Fetch documents with new hook
  const { documents = [], isLoading, error, refetch } = useGetDocuments();

  // Customers for the Customer filter dropdown (stable, unfiltered options).
  const { customers: filterCustomers = [] } = useGetCustomers({ limit: 1000 });
  const customerNameById = useMemo(() => {
    const m = new Map<string, string>();
    (filterCustomers || []).forEach((c: any) => m.set(c.id, c.name));
    return m;
  }, [filterCustomers]);

  const filterConfig: FilterField[] = useMemo(() => {
    const cfg: FilterField[] = [
      { type: "dateRange", key: "createdOn", label: "Created On" },
      { type: "select", key: "status", label: "Status", options: SALES_STATUS_OPTIONS },
      { type: "select", key: "customerId", label: "Customer", options: (filterCustomers || []).map((c: any) => ({ value: c.id, label: c.name })) },
    ];
    // Only useful when this list shows more than one document type.
    if ((documentTypes?.length || 0) > 1) {
      cfg.push({ type: "select", key: "documentType", label: "Document Type", options: documentTypes.map((t) => ({ value: t, label: prettyDocType(t) })) });
    }
    return cfg;
  }, [filterCustomers, documentTypes]);

  // Filter documents by the specified document types, plus the filter-drawer
  // selections + search (previously stored but never applied).
  const filteredDocuments = documents.filter((doc: any) => {
    if (!documentTypes.includes(doc.documentType)) return false;
    if ((filters as any).documentType && doc.documentType !== (filters as any).documentType) return false;
    if ((filters as any).customerId) {
      const name = customerNameById.get((filters as any).customerId);
      const docCustId = doc.customerId || doc.customer?.id;
      const docCustName = doc.associated_customer || doc.customer?.name;
      if (!((docCustId && docCustId === (filters as any).customerId) || (!!name && docCustName === name))) return false;
    }
    if (filters.status && (doc.status || "").toLowerCase() !== filters.status.toLowerCase()) return false;
    const start = filters.createdOn?.startDate ? new Date(filters.createdOn.startDate) : null;
    const end = filters.createdOn?.endDate ? new Date(filters.createdOn.endDate) : null;
    if (end) end.setHours(23, 59, 59, 999);
    if (start || end) {
      const c = doc.createdAt ? new Date(doc.createdAt) : null;
      if (!c) return false;
      if (start && c < start) return false;
      if (end && c > end) return false;
    }
    const term = (search || "").trim().toLowerCase();
    if (term) {
      const hay = [doc.name, doc.associated_customer, doc.associated_item, doc.documentType, doc.status]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!hay.includes(term)) return false;
    }
    return true;
  });

  // Delete document mutation
  const deleteDocumentMutation = useDeleteDocument();

  const formatStatus = (status: string) => {
    if (!status) return "Draft";
    return status
      .split("_")
      .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  };

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

  const baseColumns = [
    {
      accessorKey: "name",
      header: "Document Name",
      cell: ({ row }: any) => <Box sx={{ fontFamily: "monospace", fontWeight: 600 }}>{row.original.name}</Box>,
    },
    // "Associated Item" dropped from all document lists (2026-07-13, guru) —
    // it was N/A on nearly every row; re-add here if it earns its keep.
    {
      accessorKey: "associated_customer",
      header: "Associated Customer",
    },
    {
      accessorKey: "createdAt",
      header: "Created Date",
      nowrap: true,
      cell: ({ row }: any) => moment(row.original.createdAt).format("DD/MM/YYYY"),
    },
    {
      accessorKey: "status",
      header: "Status",
      nowrap: true,
      cell: ({ row }: any) => <StatusChip status={row.original.status} />,
    },
    ...additionalColumns,
    {
      accessorKey: "action",
      header: "Action",
      nowrap: true,
      align: "center",
      pxWidth: 150, // fits all row icons — never squeezed/clipped
      cell: ({ row }: any) => {
        const { documentType, templateId, id, status } = row.original;
        const isDraft = (status || "draft") === "draft";

        const handleDownload = () => {
          const viewUrl = `/portal/documents/view/${documentType}/${templateId}/${id}?autoprint=true`;
          window.open(viewUrl, "_blank");
        };

        return (
          <Box sx={{ display: "flex", gap: "var(--default-gap)", justifyContent: "center" }}>
            <IconButton
              onClick={() =>
                router.push(`/portal/documents/${documentType}/${templateId}/${id}`)
              }
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
            {showDelete && isDraft && (
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
        startDate: newFilters.createdOn?.startDate
          ? serializeDate(new Date(newFilters.createdOn.startDate))
          : null,
        endDate: newFilters.createdOn?.endDate
          ? serializeDate(new Date(newFilters.createdOn.endDate))
          : null,
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

  const handleAddClick = async () => {
    if (!organization?.id || !createDocumentType) {
      toast.error("Unable to create document. Please try again.");
      return;
    }

    setIsCreating(true);
    try {
      const token = await getToken();

      // First, get the document template ID for this type
      const templateResponse = await request(
        {
          path: `/documentTemplates/type/${createDocumentType}`,
          method: "GET",
        },
        {},
        token ?? undefined
      );

      if (!templateResponse.success || !templateResponse.data?.id) {
        toast.error(`No template found for document type: ${createDocumentType}`);
        return;
      }

      const documentTemplateId = templateResponse.data.id;

      // Create the document. Re-fetch the token — the template lookup above can
      // outlive the 60s Clerk token and 401 the create.
      const freshToken = await getToken();
      const response = await request(
        {
          path: "/documents/basic",
          method: "POST",
        },
        {
          type: createDocumentType,
          config: {},
          documentTemplateId: documentTemplateId,
          organizationId: organization.id,
        },
        freshToken ?? token ?? undefined
      );

      if (response?.data?.id) {
        // Navigate directly to the edit page
        router.push(`/portal/documents/${createDocumentType}/${documentTemplateId}/${response.data.id}`);
      } else {
        toast.error("Failed to create document");
      }
    } catch (error: any) {
      console.error("Error creating document:", error);
      toast.error(error.message || "An error occurred while creating the document");
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <MainCard>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {String(error)}
        </Alert>
      )}
      <PageTable
        columns={baseColumns}
        data={filteredDocuments}
        tableName={title}
        subTitle={subtitle}
        buttonName={isCreating ? "Creating..." : createButtonLabel}
        onAddClick={handleAddClick}
        loading={isLoading}
        buttonDisabled={isCreating}
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
        headerContent={headerContent}
        actionButtons={[
          ...(createDocumentType
            ? [
                <Button
                  key="upload-extract"
                  variant="outlined"
                  startIcon={<CloudUploadIcon />}
                  onClick={() => setUploadOpen(true)}
                >
                  Upload {uploadDocumentLabel}
                </Button>,
              ]
            : []),
          ...(actionButtons ?? []),
        ]}
      />

      {/* OSI-13: upload a document → AI extract → pre-fill a draft of this type
          (extracts as delivery_order for the DO list), then route to the editor. */}
      <DocumentUploadDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        documentType={createDocumentType}
        documentLabel={uploadDocumentLabel}
      />

      {/* Delete Confirmation Dialog */}
      {showDelete && (
        <Dialog
          open={deleteDialogOpen}
          onClose={handleDeleteCancel}
          aria-labelledby="delete-dialog-title"
          aria-describedby="delete-dialog-description"
        >
          <DialogTitle id="delete-dialog-title">Delete Document</DialogTitle>
          <DialogContent>
            <DialogContentText id="delete-dialog-description">
              Are you sure you want to delete "{documentToDelete?.name}"? This action
              cannot be undone.
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
      )}
    </MainCard>
  );
}
