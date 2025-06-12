"use client";

import React, { useState, useEffect } from "react";
import { useOrganization, useAuth } from "@clerk/nextjs";
import { request } from "@/helpers/request";
import MainCard from "@/components/MainCard";
import PageTable from "@/components/PageTable";
import { Box, Dialog, DialogTitle, DialogContent, DialogActions, Button, CircularProgress, Typography, IconButton } from "@mui/material";
import { useRouter } from "next/navigation";
import { ROUTES } from "@/routes";
import VisibilityIcon from "@mui/icons-material/Visibility";
import DeleteIcon from "@mui/icons-material/Delete";

interface Project {
  id: string;
  name: string;
  customer: {
    name: string;
  };
  itemsRelated: string[];
  startDate: string;
  endDate: string;
  status: string;
}

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
  const [filters, setFilters] = useState({
    status: "",
    startDate: {
      startDate: null as Date | null,
      endDate: null as Date | null,
    },
  });
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const columns = [
    { id: "id", accessorKey: "id", header: "Project ID", cell: (info: any) => info.getValue() },
    { id: "name", accessorKey: "name", header: "Project Name", cell: (info: any) => info.getValue() },
    { id: "customer", accessorKey: "customer", header: "Customer", cell: ({ row }: { row: any }) => <Typography variant="body2">{row.original.customer?.name ?? "N/A"}</Typography> },
    { id: "itemsRelated", accessorKey: "itemsRelated", header: "Items Related", cell: ({ row }: { row: any }) => <Typography variant="body2">{row.original.itemsRelated?.length ?? 0}</Typography> },
    { id: "startDate", accessorKey: "startDate", header: "Start Date", cell: (info: any) => new Date(info.getValue()).toLocaleDateString() },
    { id: "endDate", accessorKey: "endDate", header: "End Date", cell: (info: any) => new Date(info.getValue()).toLocaleDateString() },
    { id: "status", accessorKey: "status", header: "Status", cell: (info: any) => info.getValue() },
    {
      id: "actions",
      header: "Actions",
      cell: ({ row }: { row: any }) => (
        <Box sx={{ display: "flex", gap: 1 }}>
          <IconButton onClick={() => router.push(`${ROUTES.PROJECTS}/${row.original.id}`)} sx={{ color: "primary.contrastText", bgcolor: "primary.main", "&:hover": { bgcolor: "primary.dark" }, borderRadius: "8px" }}>
            <VisibilityIcon />
          </IconButton>
          <IconButton
            onClick={() => {
              setSelectedProject(row.original);
              setDeleteDialogOpen(true);
            }}
            sx={{ color: "customRed.contrastText", bgcolor: "customRed.main", "&:hover": { bgcolor: "customRed.dark" }, borderRadius: "8px" }}
          >
            <DeleteIcon />
          </IconButton>
        </Box>
      ),
    },
  ];

  const fetchProjects = async () => {
    if (!organizationId) return;
    setLoading(true);

    try {
      const token = await getToken();
      if (!token) return;

      const response = await request({ path: "/projects", method: "POST" }, { page, limit, search, filters, organizationId }, token);

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

  const handleDelete = async () => {
    if (!selectedProject || !organizationId) return;
    setIsDeleting(true);
    try {
      const token = await getToken();
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
        data={projects.docs}
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
        availableFilters={["status", "startDate"]}
        pageCount={projects.totalPagesCount}
        totalDocs={projects.totalDocuments}
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
