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
import { useRouter } from "next/navigation";
import moment from "moment";
import { toast } from "react-toastify";
import { DOCUMENT_API } from "@/app/portal/documents/constants";
import CustomerSelectionDrawer from "@/app/portal/invoices/components/CustomerSelectionDrawer";
import InvoiceVariantDrawer from "@/app/portal/invoices/components/InvoiceVariantDrawer";
import InvoiceStatistics from "@/app/portal/invoices/components/InvoiceStatistics";
import { useXeroConnection } from "@/app/portal/invoices/hooks/useXeroConnection";
import { SALES_DOCUMENT_TYPES } from "../constants";

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

export default function SalesInvoicesPage() {
  const router = useRouter();
  const { organization } = useOrganization();
  const { getToken } = useAuth();
  const organizationId = organization?.id;
  const config = SALES_DOCUMENT_TYPES.INVOICE;

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

  // Xero connection hook
  const { connectionStatus, loading: xeroLoading, connectToXero } = useXeroConnection();

  const columns = [
    {
      accessorKey: "name",
      header: "Document SKU",
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
      cell: ({ row }: any) => {
        const dueDate = row.original.config?.dueDate;
        return dueDate ? moment(dueDate).format("DD/MM/YYYY") : "N/A";
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
        const invoiceDocs = response.data.filter((doc: any) =>
          config.types.includes(doc.documentType)
        );
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
  }, [organizationId, getToken, limit, config.types]);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

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
    setSelectedCustomer(customer);
    setCustomerDrawerOpen(false);
    setTimeout(() => {
      setVariantDrawerOpen(true);
    }, 100);
  };

  const handleVariantSelect = (variant: any) => {
    setVariantDrawerOpen(false);

    if (selectedCustomer) {
      onSubmit(
        {
          documentType: variant.type,
          templateVariant: variant.templateVariant,
        },
        selectedCustomer,
        variant.id
      );
    } else {
      toast.error("Please select a customer first");
      setCustomerDrawerOpen(true);
    }
  };

  const handleDrawerClose = () => {
    setCustomerDrawerOpen(false);
    setSelectedCustomer(null);
  };

  const handleVariantDrawerClose = () => {
    setVariantDrawerOpen(false);
  };

  const onSubmit = async (data: any, customer?: Customer, variantId?: string) => {
    try {
      setIsDocumentTemplateUpdating(true);
      const token = await getToken();

      let documentTemplateId = variantId;
      if (!documentTemplateId || documentTemplateId.startsWith("default-")) {
        documentTemplateId = await getTemplateIdByType(data.documentType, token ?? "");
      }

      const requestPayload = {
        type: data.documentType,
        config: customer ? { customerId: customer.id, templateVariant: data.templateVariant } : {},
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
      const urlWithCustomer = customer ? `${url}?customerId=${customer.id}` : url;

      toast.success("Invoice created successfully! Redirecting...");

      setTimeout(() => {
        router.push(urlWithCustomer);
      }, 500);
    } catch (error) {
      console.error("Error submitting form:", error);
      alert(`Error creating invoice: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setIsDocumentTemplateUpdating(false);
    }
  };

  const actionButtons = [];

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

      {connectionStatus && connectionStatus.connected && (
        <Alert severity="success" sx={{ mb: 2 }}>
          Xero is connected! Invoices will be automatically synced.
        </Alert>
      )}

      <PageTable
        columns={columns}
        data={documents.docs}
        tableName={`${config.label} List`}
        subTitle={`${config.label} Detail Information`}
        buttonName={`Create ${config.label}`}
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
        totalDocs={documents.totalDocs}
        actionButtons={actionButtons}
        headerContent={<InvoiceStatistics documents={documents.docs} loading={loading} />}
      />

      <CustomerSelectionDrawer open={customerDrawerOpen} onClose={handleDrawerClose} onSelectCustomer={handleCustomerSelect} />

      <InvoiceVariantDrawer
        open={variantDrawerOpen}
        onClose={handleVariantDrawerClose}
        onSelectVariant={handleVariantSelect}
        selectedCustomer={selectedCustomer}
      />
    </MainCard>
  );
}
