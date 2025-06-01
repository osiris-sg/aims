"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useOrganization, useAuth } from "@clerk/nextjs";
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
    </MainCard>
  );
}
