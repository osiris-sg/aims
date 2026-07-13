"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { request } from "@/helpers/request";
import MainCard from "@/components/MainCard";
import PageTable from "@/components/PageTable";
import StatusChip from "@/components/StatusChip";
import {
  Box,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Grid,
  IconButton,
  Skeleton,
  Typography,
} from "@mui/material";
import VisibilityIcon from "@mui/icons-material/Visibility";
import DeleteIcon from "@mui/icons-material/Delete";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import CalendarMonthOutlinedIcon from "@mui/icons-material/CalendarMonthOutlined";
import DraftsOutlinedIcon from "@mui/icons-material/DraftsOutlined";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import { Button } from "@mui/material";
import moment from "moment";
import { toast } from "react-toastify";
import DocumentUploadDialog from "./DocumentUploadDialog";
import { useDeleteDocument, useGetCustomers, useGetDocumentsPaginated, useGetDocumentStats } from "@/app/portal/hooks/api";
import type { FilterField } from "@/components/FilterDrawer";

// Document statuses (NOT the legacy inventory statuses the old `availableFilters`
// path produced). Customer is appended at runtime.
const DOC_STATUS_OPTIONS = [
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
import { useTemplatePicker } from "./useTemplatePicker";
import { useNumberFormatPicker } from "./useNumberFormatPicker";

interface Props {
  documentTypes: string[];
  documentLabel: string;
  pluralLabel?: string;
  createDocumentType: string;
}

interface DocumentRow {
  id: string;
  name: string;
  documentType: string;
  templateId: string;
  status: string;
  createdAt: string;
  associated_customer?: string;
  associated_item?: string;
  config?: any;
}

const formatStatus = (status: string) => {
  if (!status) return "Draft";
  return status
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
};

const getStatusColor = (status: string) => {
  switch (status) {
    case "draft":
      return "text.secondary";
    case "confirmed":
    case "delivered_installed":
    case "paid":
      return "success.main";
    case "pending_delivery":
    case "pending_payment":
    case "pending_return":
      return "warning.main";
    case "delivered_not_installed":
      return "info.main";
    default:
      return "text.primary";
  }
};

function StatCard({
  title,
  value,
  icon,
  color,
  bgColor,
  loading,
}: {
  title: string;
  value: number | string;
  icon: React.ReactElement;
  color: string;
  bgColor: string;
  loading?: boolean;
}) {
  return (
    <Card
      elevation={0}
      sx={{
        border: 1,
        borderColor: "divider",
        height: "100%",
        transition: "all 0.3s ease",
        "&:hover": { boxShadow: 2, transform: "translateY(-2px)" },
      }}
    >
      <CardContent>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1 }}>
          <Typography
            variant="caption"
            sx={{ color: "text.secondary", fontWeight: 500, fontSize: "0.75rem", letterSpacing: "0.5px" }}
          >
            {title}
          </Typography>
          <Box
            sx={{
              backgroundColor: bgColor,
              borderRadius: "50%",
              p: 0.5,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {React.cloneElement(icon, { sx: { fontSize: 20, color } })}
          </Box>
        </Box>
        {loading ? (
          <Skeleton variant="text" width="60%" height={40} />
        ) : (
          <Typography variant="h5" sx={{ fontWeight: 600, color, mt: 1 }}>
            {value}
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}

export default function DocumentListView({
  documentTypes,
  documentLabel,
  pluralLabel,
  createDocumentType,
}: Props) {
  const router = useRouter();
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const { resolveTemplate, dialog: templatePickerDialog } = useTemplatePicker();
  const { resolveNumberFormat, dialog: numberFormatPickerDialog } = useNumberFormatPicker();

  const [creating, setCreating] = useState(false);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [search, setSearch] = useState("");
  const [sorting, setSorting] = useState<any[]>([]);
  const [filters, setFilters] = useState<any>({
    status: "",
    customerId: "",
    createdOn: { startDate: null, endDate: null },
  });

  // Customers for the Customer filter dropdown (stable, unfiltered options).
  const { customers: filterCustomers = [] } = useGetCustomers({ limit: 1000 });
  const filterConfig: FilterField[] = useMemo(
    () => [
      { type: "dateRange", key: "createdOn", label: "Created On" },
      { type: "select", key: "status", label: "Status", options: DOC_STATUS_OPTIONS },
      { type: "select", key: "customerId", label: "Customer", options: (filterCustomers || []).map((c: any) => ({ value: c.id, label: c.name })) },
    ],
    [filterCustomers],
  );

  // Column-header sort → server sort field (name/status/createdAt only; the
  // JSON-derived Customer/Item columns aren't server-sortable, so their sort is
  // disabled in the column defs below).
  const sortColMap: Record<string, string> = { name: "name", status: "status", createdAt: "createdAt" };
  const sortState = sorting[0];
  const sortBy = sortState ? sortColMap[sortState.id] : undefined;
  const sortDir = sortState ? (sortState.desc ? "desc" : "asc") : undefined;

  // Server-side paginated list for this document-type set (fetches one page).
  const { docs, total, totalPages, isFetching, refetch } = useGetDocumentsPaginated({
    documentTypes,
    page,
    limit,
    search,
    status: filters.status || undefined,
    customerId: filters.customerId || undefined,
    createdOn: filters.createdOn,
    sortBy,
    sortDir: sortDir as any,
  });

  // Stat-card counts across the full type set (independent of the filters).
  const { stats, isLoading: statsLoading, refetch: refetchStats } = useGetDocumentStats(documentTypes);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [docToDelete, setDocToDelete] = useState<DocumentRow | null>(null);

  const deleteDocumentMutation = useDeleteDocument();

  const handleDeleteConfirm = async () => {
    if (!docToDelete) return;
    try {
      await deleteDocumentMutation.mutateAsync(docToDelete.id);
      toast.success(`${documentLabel} deleted`);
      setDocToDelete(null);
      refetch();
      refetchStats();
    } catch (err: any) {
      console.error("Delete document failed:", err);
      toast.error(err?.message || `Failed to delete ${documentLabel}`);
    }
  };

  const handleCreate = async () => {
    if (!organization?.id || !createDocumentType || creating) return;
    setCreating(true);
    try {
      const token = await getToken();
      // Step 1 — number format: 0 → legacy, 1 → auto, >1 → popup. null = cancelled.
      const nf = await resolveNumberFormat(createDocumentType);
      if (nf === null) {
        return;
      }
      const numberFormatId = nf || undefined;
      // Step 2 — template via the shared picker: 1 active → straight through,
      // >1 → popup, 0 → single-resolve fallback. null = no template OR the user
      // cancelled the popup → abort without creating anything.
      const templateId = await resolveTemplate(createDocumentType);
      if (!templateId) {
        return;
      }
      const created = await request(
        { path: "/documents/basic", method: "POST" },
        {
          type: createDocumentType,
          config: { ...(numberFormatId ? { numberFormatId } : {}) },
          documentTemplateId: templateId,
          organizationId: organization.id,
        },
        token ?? undefined
      );
      if (created?.success && created?.data?.id) {
        router.push(`/portal/documents/${createDocumentType}/${templateId}/${created.data.id}`);
      } else {
        toast.error(`Failed to create ${documentLabel}`);
      }
    } catch (err) {
      console.error("DocumentListView create error:", err);
      toast.error(`Failed to create ${documentLabel}`);
    } finally {
      setCreating(false);
    }
  };

  // Filtering, sorting, and paging all happen server-side now (see the hooks
  // above). Reset to page 1 whenever the query changes so we don't land on an
  // out-of-range page.
  useEffect(() => { setPage(1); }, [search, filters, sorting, limit]);

  const columns = [
    {
      accessorKey: "name",
      header: `${documentLabel} #`,
      cell: ({ row }: any) =>
        row.original.name ? <Box sx={{ fontFamily: "monospace", fontWeight: 600 }}>{row.original.name}</Box> : "—",
    },
    {
      accessorKey: "associated_customer",
      header: "Customer",
      enableSorting: false, // JSON-derived (config), not server-sortable
      cell: ({ row }: any) => row.original.associated_customer || "—",
    },
    // "Associated Item" dropped from all document lists (2026-07-13, guru).
    {
      accessorKey: "status",
      header: "Status",
      nowrap: true,
      cell: ({ row }: any) => <StatusChip status={row.original.status} />,
    },
    {
      accessorKey: "createdAt",
      header: "Created",
      nowrap: true,
      cell: ({ row }: any) => moment(row.original.createdAt).format("DD/MM/YYYY"),
    },
    {
      accessorKey: "action",
      header: "Action",
      nowrap: true,
      align: "center",
      pxWidth: 150, // fits all row icons — never squeezed/clipped
      cell: ({ row }: any) => {
        const { documentType, templateId, id, status } = row.original;
        const isDraft = (status || "draft") === "draft";
        return (
          <Box sx={{ display: "flex", gap: 0.5, justifyContent: "center" }}>
            <IconButton
              onClick={() => router.push(`/portal/documents/${documentType}/${templateId}/${id}`)}
              sx={{ color: "text.secondary", "&:hover": { color: "primary.main" } }}
            >
              <VisibilityIcon />
            </IconButton>
            {isDraft && (
              <IconButton
                onClick={() => setDocToDelete(row.original)}
                sx={{ color: "text.secondary", "&:hover": { color: "error.main" } }}
              >
                <DeleteIcon />
              </IconButton>
            )}
          </Box>
        );
      },
    },
  ];

  const serializeDate = (d: Date | null) => (d ? JSON.parse(JSON.stringify(d)) : null);
  const handleSetFilters = (newFilters: any) => {
    setFilters({
      ...newFilters,
      createdOn: {
        startDate: newFilters.createdOn?.startDate
          ? serializeDate(new Date(newFilters.createdOn.startDate))
          : null,
        endDate: newFilters.createdOn?.endDate
          ? serializeDate(new Date(newFilters.createdOn.endDate))
          : null,
      },
    });
  };

  const uploadButton = createDocumentType ? (
    <Button
      key="upload-doc"
      variant="outlined"
      startIcon={<CloudUploadIcon />}
      onClick={() => setUploadOpen(true)}
      disabled={creating}
    >
      Upload {documentLabel}
    </Button>
  ) : null;

  return (
    <MainCard>
      <PageTable
        columns={columns}
        data={docs}
        manualSorting
        sorting={sorting}
        onSortingChange={setSorting}
        tableName={`${pluralLabel || documentLabel + "s"} List`}
        subTitle={`All ${pluralLabel || documentLabel + "s"} for this organization`}
        buttonName={createDocumentType ? `Create ${documentLabel}` : undefined}
        onAddClick={createDocumentType ? handleCreate : undefined}
        buttonDisabled={creating}
        actionButtons={uploadButton ? [uploadButton] : undefined}
        loading={isFetching || creating}
        page={page}
        limit={limit}
        search={search}
        filters={filters}
        setPage={setPage}
        setLimit={setLimit}
        setSearch={setSearch}
        setFilters={handleSetFilters}
        filterConfig={filterConfig}
        pageCount={totalPages}
        totalDocs={total}
        headerContent={
          <Box sx={{ mb: 3 }}>
            <Grid container spacing={2}>
              <Grid item xs={12} sm={4}>
                <StatCard
                  title={`TOTAL ${(pluralLabel || documentLabel + "S").toUpperCase()}`}
                  value={stats.total}
                  icon={<DescriptionOutlinedIcon />}
                  color="primary.main"
                  bgColor="surfaceTones.high"
                  loading={statsLoading}
                />
              </Grid>
              <Grid item xs={12} sm={4}>
                <StatCard
                  title="THIS MONTH"
                  value={stats.thisMonth}
                  icon={<CalendarMonthOutlinedIcon />}
                  color="success.main"
                  bgColor="success.light"
                  loading={statsLoading}
                />
              </Grid>
              <Grid item xs={12} sm={4}>
                <StatCard
                  title="DRAFTS"
                  value={stats.drafts}
                  icon={<DraftsOutlinedIcon />}
                  color="customYellow.dark"
                  bgColor="customYellow.light"
                  loading={statsLoading}
                />
              </Grid>
            </Grid>
          </Box>
        }
      />
      {createDocumentType && (
        <DocumentUploadDialog
          open={uploadOpen}
          onClose={() => setUploadOpen(false)}
          documentType={createDocumentType}
          documentLabel={documentLabel}
        />
      )}

      <Dialog open={!!docToDelete} onClose={() => setDocToDelete(null)}>
        <DialogTitle>Delete {documentLabel}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Delete &quot;{docToDelete?.name || "this draft"}&quot;? This cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDocToDelete(null)} disabled={deleteDocumentMutation.isPending}>
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

      {numberFormatPickerDialog}
      {templatePickerDialog}
    </MainCard>
  );
}
