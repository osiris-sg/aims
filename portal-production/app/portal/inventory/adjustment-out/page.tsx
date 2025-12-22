"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { request } from "@/helpers/request";
import MainCard from "@/components/MainCard";
import PageTable from "@/components/PageTable";
import { Box, IconButton, Alert } from "@mui/material";
import VisibilityIcon from "@mui/icons-material/Visibility";
import DownloadIcon from "@mui/icons-material/Download";
import { useRouter } from "next/navigation";
import moment from "moment";
import { toast } from "react-toastify";
import { DOCUMENT_API } from "@/app/portal/documents/constants";
import { INVENTORY_DOCUMENT_TYPES } from "../constants";

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
    supplierCode?: string;
    [key: string]: any;
  };
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

export default function AdjustmentOutPage() {
  const router = useRouter();
  const { organization } = useOrganization();
  const { getToken } = useAuth();
  const organizationId = organization?.id;
  const config = INVENTORY_DOCUMENT_TYPES.STOCK_ADJUSTMENT_OUT;

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
  const [isDocumentTemplateUpdating, setIsDocumentTemplateUpdating] = useState(false);

  const columns = [
    {
      accessorKey: "name",
      header: "Reference No.",
      cell: ({ row }: any) => row.original.name,
    },
    {
      accessorKey: "supplierCode",
      header: "Supplier",
      cell: ({ row }: any) => row.original.config?.supplierCode || "N/A",
    },
    {
      accessorKey: "purchaserCode",
      header: "Purchaser",
      cell: ({ row }: any) => row.original.config?.purchaserCode || "N/A",
    },
    {
      accessorKey: "woNo",
      header: "W/O Number",
      cell: ({ row }: any) => row.original.config?.woNo || "N/A",
    },
    {
      accessorKey: "totalAmount",
      header: "Total Amount",
      cell: ({ row }: any) => {
        const amount = row.original.config?.totalAmount;
        return amount ? `$${amount.toFixed(2)}` : "N/A";
      },
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }: any) => {
        const status = row.original.status;
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
            case "pending":
              return "warning.main";
            case "confirmed":
              return "info.main";
            case "completed":
              return "success.main";
            case "cancelled":
              return "error.main";
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
      accessorKey: "createdAt",
      header: "Created Date",
      cell: ({ row }: any) => moment(row.original.createdAt).format("DD/MM/YYYY"),
    },
    {
      accessorKey: "action",
      header: "Action",
      cell: ({ row }: any) => {
        const { documentType, templateId, id } = row.original;

        const handleDownload = () => {
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
        const filteredDocs = response.data.filter((doc: any) =>
          config.types.includes(doc.documentType)
        );
        setDocuments({
          docs: filteredDocs,
          totalDocs: filteredDocs.length,
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
  }, [organizationId, getToken, limit, config.types]);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

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
        console.warn("Template ID not found");
        return documentType;
      }
    } catch (error) {
      console.error("Error fetching template ID by type:", error);
      return documentType;
    }
  };

  const handleCreateClick = () => {
    onSubmit({ documentType: config.createDocumentType });
  };

  const onSubmit = async (data: any) => {
    try {
      setIsDocumentTemplateUpdating(true);
      const token = await getToken();

      const documentTemplateId = await getTemplateIdByType(data.documentType, token ?? "");

      const requestPayload = {
        type: data.documentType,
        config: {},
        documentTemplateId: documentTemplateId,
        organizationId: organizationId,
      };

      const response = await request(
        {
          path: "/documents/basic",
          method: "POST",
        },
        requestPayload,
        token ?? undefined
      );

      if (!response || !response.success) {
        alert(`Failed to create document: ${response?.message || "Unknown error"}`);
        return;
      }

      const createdDocumentId = response?.data?.id;
      if (!createdDocumentId) {
        alert("Failed to create document: No document ID returned");
        return;
      }

      const url = `/portal/documents/${data.documentType}/${documentTemplateId}/${createdDocumentId}`;

      toast.success(`${config.label} created successfully! Redirecting...`);

      setTimeout(() => {
        router.push(url);
      }, 500);
    } catch (error) {
      console.error("Error submitting form:", error);
      alert(`Error creating ${config.label}: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setIsDocumentTemplateUpdating(false);
    }
  };

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
        tableName={`${config.label} List`}
        subTitle={`${config.label} Detail Information`}
        buttonName={`Create ${config.label}`}
        onAddClick={handleCreateClick}
        loading={loading || isDocumentTemplateUpdating}
        page={page}
        limit={limit}
        search={search}
        filters={filters}
        setPage={setPage}
        setLimit={setLimit}
        setSearch={setSearch}
        setFilters={handleSetFilters}
        availableFilters={["status", "createdOn"]}
        pageCount={documents.totalPages}
        totalDocs={documents.totalDocs}
      />
    </MainCard>
  );
}
