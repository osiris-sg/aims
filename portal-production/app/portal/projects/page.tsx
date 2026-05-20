"use client";

import React, { useMemo, useState, useEffect } from "react";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { request } from "@/helpers/request";
import MainCard from "@/components/MainCard";
import PageTable from "@/components/PageTable";
import type { FilterField } from "@/components/FilterDrawer";
import { useGetCustomers } from "@/app/portal/hooks/api/useCustomers";
import { Box, Dialog, DialogTitle, DialogContent, DialogActions, Button, CircularProgress, Typography, IconButton } from "@mui/material";
import { useRouter } from "next/navigation";
import { ROUTES } from "@/routes";
import VisibilityIcon from "@mui/icons-material/Visibility";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";

interface Project {
  id: string;
  name: string;
  customer: { id: string; name: string } | null;
  siteOffice: { id: string; name: string } | null;
  itemsRelated: number;
  startDate: string | null;
  endDate: string | null;
  status: string;
}

const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString() : "—";

interface PaginatedResponse {
  docs: Project[];
  totalPagesCount: number;
  totalDocuments: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
  limit: number;
  nextPage: number;
}

export default function ProjectsPage() {
  const router = useRouter();
  const { organization } = useOrganization();
  const { getToken } = useAuth();
  const organizationId = organization?.id;

  const [projects, setProjects] = useState<PaginatedResponse>({
    docs: [],
    totalPagesCount: 0,
    totalDocuments: 0,
    hasNextPage: false,
    hasPrevPage: false,
    limit: 10,
    nextPage: 0,
  });
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<{
    status: string;
    customerId: string;
    startDate: { startDate: Date | string | null; endDate: Date | string | null };
    endDate: { startDate: Date | string | null; endDate: Date | string | null };
  }>({
    status: "",
    customerId: "",
    startDate: { startDate: null, endDate: null },
    endDate: { startDate: null, endDate: null },
  });
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const columns = [
    { id: "id", accessorKey: "id", header: "Project ID", cell: (info: any) => info.getValue() },
    { id: "name", accessorKey: "name", header: "Project Name", cell: (info: any) => info.getValue() },
    { id: "customer", accessorKey: "customer", header: "Customer", cell: ({ row }: { row: any }) => <Typography variant="body2">{row.original.customer?.name ?? "N/A"}</Typography> },
    { id: "siteOffice", accessorKey: "siteOffice", header: "Site Office", cell: ({ row }: { row: any }) => <Typography variant="body2">{row.original.siteOffice?.name ?? "N/A"}</Typography> },
    { id: "itemsRelated", accessorKey: "itemsRelated", header: "Items Related", cell: ({ row }: { row: any }) => <Typography variant="body2">{row.original.itemsRelated ?? 0}</Typography> },
    { id: "startDate", accessorKey: "startDate", header: "Start Date", cell: (info: any) => fmtDate(info.getValue()) },
    { id: "endDate", accessorKey: "endDate", header: "End Date", cell: (info: any) => fmtDate(info.getValue()) },
    { id: "status", accessorKey: "status", header: "Status", cell: (info: any) => info.getValue() },
    {
      id: "actions",
      header: "Actions",
      cell: ({ row }: { row: any }) => (
        <Box sx={{ display: "flex", gap: 1 }}>
          <IconButton onClick={() => router.push(`${ROUTES.PROJECTS}/${row.original.id}`)} sx={{ color: "text.secondary", "&:hover": { color: "primary.main" } }}>
            <VisibilityIcon />
          </IconButton>
          <IconButton onClick={() => router.push(`${ROUTES.CREATE_PROJECT}?id=${row.original.id}`)} sx={{ color: "text.secondary", "&:hover": { color: "info.main" } }}>
            <EditIcon />
          </IconButton>
          <IconButton
            onClick={() => {
              setSelectedProject(row.original);
              setDeleteDialogOpen(true);
            }}
            sx={{ color: "text.secondary", "&:hover": { color: "error.main" } }}
          >
            <DeleteIcon />
          </IconButton>
        </Box>
      ),
    },
  ];

  // Backend understands status + startDate (date range). customerId + endDate
  // are applied client-side below so we don't depend on new backend filter keys.
  const apiFilters = useMemo(
    () => ({
      status: filters.status || undefined,
      startDate: filters.startDate,
    }),
    [filters.status, filters.startDate],
  );

  const fetchProjects = async () => {
    if (!organizationId) return;
    setLoading(true);

    try {
      const token = await getToken();
      if (!token) return;

      const response = await request({ path: "/projects", method: "POST" }, { page, limit, search, filters: apiFilters, organizationId }, token);

      if (response.success) {
        console.log("Projects response:", response.data);
        setProjects(response.data);
      }
    } catch (error) {
      console.error("Error fetching projects:", error);
    } finally {
      setLoading(false);
    }
  };

  // Customers dropdown for the Customer filter
  const { customers = [] } = useGetCustomers({ limit: 1000 });

  // Client-side post-filter for customerId + endDate range.
  const filteredProjects = useMemo(() => {
    const customerFilter = filters.customerId || "";
    const endStart = filters.endDate?.startDate ? new Date(filters.endDate.startDate) : null;
    const endEnd = filters.endDate?.endDate ? new Date(filters.endDate.endDate) : null;
    if (endEnd) endEnd.setHours(23, 59, 59, 999);
    if (!customerFilter && !endStart && !endEnd) return projects.docs;
    return (projects.docs || []).filter((p: any) => {
      if (customerFilter) {
        const pid = p.customerId || p.customer?.id;
        if (pid !== customerFilter) return false;
      }
      if (endStart || endEnd) {
        const projectEnd = p.endDate ? new Date(p.endDate) : null;
        if (!projectEnd) return false;
        if (endStart && projectEnd < endStart) return false;
        if (endEnd && projectEnd > endEnd) return false;
      }
      return true;
    });
  }, [projects.docs, filters.customerId, filters.endDate]);

  const filterConfig: FilterField[] = useMemo(
    () => [
      {
        type: "select",
        key: "status",
        label: "Status",
        options: [
          { value: "pending", label: "Pending" },
          { value: "ongoing", label: "Ongoing" },
          { value: "completed", label: "Completed" },
        ],
      },
      {
        type: "select",
        key: "customerId",
        label: "Customer",
        options: (customers || []).map((c: any) => ({ value: c.id, label: c.name })),
      },
      { type: "dateRange", key: "startDate", label: "Start Date" },
      { type: "dateRange", key: "endDate", label: "End Date" },
    ],
    [customers],
  );

  const handleDelete = async () => {
    if (!selectedProject || !organizationId) return;
    setIsDeleting(true);
    try {
      const token = await getToken();
      if (!token) return;
      await request({ path: `/projects/${selectedProject.id}`, method: "DELETE" }, {}, token);
      setDeleteDialogOpen(false);
      setSelectedProject(null);
      fetchProjects();
    } catch (error) {
      console.error("Error deleting project:", error);
    } finally {
      setIsDeleting(false);
    }
  };

  useEffect(() => {
    fetchProjects();
  }, [page, limit, search, filters, organizationId]);

  return (
    <MainCard>
      <PageTable
        columns={columns}
        data={filteredProjects}
        tableName="Projects"
        subTitle="Items Detail Information"
        buttonName="Add Project"
        loading={loading}
        page={page}
        limit={limit}
        search={search}
        filters={filters}
        setPage={setPage}
        setLimit={setLimit}
        setSearch={setSearch}
        setFilters={setFilters}
        onAddClick={() => router.push(ROUTES.CREATE_PROJECT)}
        filterConfig={filterConfig}
        pageCount={projects.totalPagesCount}
        totalDocs={filters.customerId || filters.endDate?.startDate || filters.endDate?.endDate ? filteredProjects.length : projects.totalDocuments}
      />

      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
        <DialogTitle>Delete Project</DialogTitle>
        <DialogContent>Are you sure you want to delete this project? This action cannot be undone.</DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleDelete} color="error" disabled={isDeleting}>
            {isDeleting ? <CircularProgress size={24} /> : "Delete"}
          </Button>
        </DialogActions>
      </Dialog>
    </MainCard>
  );
}
