"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { request } from "@/helpers/request";
import MainCard from "@/components/MainCard";
import PageTable from "@/components/PageTable";
import { Box, IconButton, Alert } from "@mui/material";
import VisibilityIcon from "@mui/icons-material/Visibility";
import { useRouter } from "next/navigation";
import moment from "moment";
import { DOCUMENT_API } from "../documents/constants";
import { ROUTES } from "@/routes";

interface Document {
  id: string;
  name: string;
  associated_item: string;
  associated_customer: string;
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

  const columns = [
    {
      accessorKey: "id",
      header: "Document ID",
    },
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
      accessorKey: "action",
      header: "Action",
      cell: ({ row }: any) => {
        const { documentType, templateId, id } = row.original;
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
        const tiDocs = response.data.filter((doc: any) => doc.documentType === "TI");
        setDocuments({
          docs: tiDocs,
          totalDocs: tiDocs.length,
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

  // Add useState and onSubmit above return
  const [isDocumentTemplateUpdating, setIsDocumentTemplateUpdating] = useState(false);

  const typeToIdMap: Record<string, string> = {
    DO: "36c25729-34a0-419a-8a93-cdda243168ab",
    RDO: "89e5fd4b-e837-44ad-982e-80559a3274e0",
    TI: "654da337-fc90-4234-8228-3e0f79b50192",
    MSR: "maintenance_service_report",
    QO1: "033bbb49-7f69-41a7-8b1d-157f587bb781", // Add your QO1 template ID here
  };

  const onSubmit = async (data: any) => {
    try {
      setIsDocumentTemplateUpdating(true);
      const token = await getToken();
      const documentTemplateId = typeToIdMap[data.documentType] || data.documentType;
      console.log("Selected Document Type:", organizationId);
      const response = await request(
        {
          path: "/documents/basic",
          method: "POST",
        },
        {
          type: data.documentType,
          config: {},
          documentTemplateId: documentTemplateId,
          organizationId: organizationId,
        },
        token ?? undefined
      );

      const createdDocumentId = response?.data.id;
      console.log("Created Document ID:", createdDocumentId);
      router.push(`/portal/documents/${data.documentType}/${documentTemplateId}/${createdDocumentId}`);
    } catch (error) {
      console.error("Error submitting form:", error);
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
        tableName="Document List"
        subTitle="Document Detail Information"
        buttonName="Create Invoice"
        onAddClick={() => onSubmit({ documentType: "TI" })}
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
    </MainCard>
  );
}
