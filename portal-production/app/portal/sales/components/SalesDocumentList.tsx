"use client";

import React, { useState } from "react";
import { useGetDocuments, useDeleteDocument } from "@/app/portal/hooks/api";
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
import { useRouter } from "next/navigation";
import moment from "moment";
import { toast } from "react-toastify";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { request } from "@/helpers/request";

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

// Filter drawer config for sales documents — document statuses (NOT the legacy
// inventory statuses) + a date range. Category is omitted (sales docs have none).
const SALES_FILTER_CONFIG: FilterField[] = [
  { type: "dateRange", key: "createdOn", label: "Created On" },
  {
    type: "select",
    key: "status",
    label: "Status",
    options: [
      { value: "draft", label: "Draft" },
      { value: "confirmed", label: "Confirmed" },
      { value: "pending_delivery", label: "Pending Delivery" },
      { value: "delivered_not_installed", label: "Delivered (Not Installed)" },
      { value: "delivered_installed", label: "Delivered & Installed" },
      { value: "pending_return", label: "Pending Return" },
      { value: "returned", label: "Returned" },
    ],
  },
];

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

  // Fetch documents with new hook
  const { documents = [], isLoading, error, refetch } = useGetDocuments();

  // Filter documents by the specified document types, plus the filter-drawer
  // selections + search (previously stored but never applied).
  const filteredDocuments = documents.filter((doc: any) => {
    if (!documentTypes.includes(doc.documentType)) return false;
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
      cell: ({ row }: any) => moment(row.original.createdAt).format("DD/MM/YYYY"),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }: any) => {
        const status = row.original.status;
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
    ...additionalColumns,
    {
      accessorKey: "action",
      header: "Action",
      cell: ({ row }: any) => {
        const { documentType, templateId, id, status } = row.original;
        const isDraft = (status || "draft") === "draft";

        const handleDownload = () => {
          const viewUrl = `/portal/documents/view/${documentType}/${templateId}/${id}?autoprint=true`;
          window.open(viewUrl, "_blank");
        };

        return (
          <Box sx={{ display: "flex", gap: "var(--default-gap)" }}>
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

      // Create the document
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
        token ?? undefined
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
        filterConfig={SALES_FILTER_CONFIG}
        pageCount={Math.ceil(filteredDocuments.length / limit)}
        totalDocs={filteredDocuments.length}
        headerContent={headerContent}
        actionButtons={actionButtons}
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
