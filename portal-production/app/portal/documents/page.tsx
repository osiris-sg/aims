"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { request } from "@/helpers/request";
import MainCard from "@/components/MainCard";
import PageTable from "@/components/PageTable";
import { Box, IconButton, Alert, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, Button } from "@mui/material";
import VisibilityIcon from "@mui/icons-material/Visibility";
import DownloadIcon from "@mui/icons-material/Download";
import DeleteIcon from "@mui/icons-material/Delete";
import { useRouter } from "next/navigation";
import moment from "moment";
import { toast } from "react-toastify";
import { DOCUMENT_API } from "../documents/constants";

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
}

export default function DocumentsPage() {
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
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [documentToDelete, setDocumentToDelete] = useState<Document | null>(null);
  const [deleting, setDeleting] = useState(false);

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
        const { documentType, templateId, id } = row.original;

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
                color: "customYellow.contrastText",
                bgcolor: "customYellow.main",
                "&:hover": {
                  bgcolor: "customYellow.dark",
                },
                borderRadius: "8px",
              }}
            >
              <VisibilityIcon />
            </IconButton>
            <IconButton
              onClick={handleDownload}
              sx={{
                color: "white",
                bgcolor: "primary.main",
                "&:hover": {
                  bgcolor: "primary.dark",
                },
                borderRadius: "8px",
              }}
            >
              <DownloadIcon />
            </IconButton>
            <IconButton
              onClick={() => handleDeleteClick(row.original)}
              sx={{
                color: "customRed.contrastText",
                bgcolor: "customRed.main",
                "&:hover": {
                  bgcolor: "customRed.dark",
                },
                borderRadius: "8px",
              }}
            >
              <DeleteIcon />
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

  const handleDeleteClick = (document: Document) => {
    setDocumentToDelete(document);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!documentToDelete || !organizationId) return;
    
    setDeleting(true);
    try {
      const token = await getToken();
      if (!token) return;

      const response = await request(
        {
          path: `${DOCUMENT_API.DELETE.path}/${documentToDelete.id}`,
          method: DOCUMENT_API.DELETE.method,
        },
        {},
        token
      );

      if (response.success) {
        toast.success("Document deleted successfully");
        setDeleteDialogOpen(false);
        setDocumentToDelete(null);
        // Refresh the documents list
        fetchDocuments();
      } else {
        toast.error(response.message || "Failed to delete document");
      }
    } catch (error) {
      console.error("Error deleting document:", error);
      toast.error("An error occurred while deleting the document");
    } finally {
      setDeleting(false);
    }
  };

  const handleDeleteCancel = () => {
    setDeleteDialogOpen(false);
    setDocumentToDelete(null);
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
        console.log("Fetched documents:", response.data);
        setDocuments({
          docs: response.data,
          totalDocs: response.data.length,
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

  return (
    <MainCard>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      <PageTable
        columns={columns}
        data={documents.docs}
        tableName="Document List"
        subTitle="Document Detail Information"
        buttonName="Create Document"
        onAddClick={() => router.push("/portal/documents/create")}
        loading={loading}
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
        totalDocs={documents.totalDocs}
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
          <Button onClick={handleDeleteCancel} disabled={deleting}>
            Cancel
          </Button>
          <Button 
            onClick={handleDeleteConfirm} 
            color="error" 
            variant="contained"
            disabled={deleting}
          >
            {deleting ? "Deleting..." : "Delete"}
          </Button>
        </DialogActions>
      </Dialog>
    </MainCard>
  );
}
