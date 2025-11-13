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
import { DOCUMENT_API } from "../documents/constants";
import { ROUTES } from "@/routes";
import CustomerSelectionDrawer from "./components/CustomerSelectionDrawer";
import InvoiceVariantDrawer from "./components/InvoiceVariantDrawer";
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
        data={documents.docs}
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
        totalDocs={documents.totalDocs}
        actionButtons={actionButtons}
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
    </MainCard>
  );
}
