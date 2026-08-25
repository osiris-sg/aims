"use client";

import React, { useMemo, useState } from "react";
import { Box, Chip, IconButton, Tooltip } from "@mui/material";
import VisibilityIcon from "@mui/icons-material/Visibility";
import BlockIcon from "@mui/icons-material/Block";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { useAuth } from "@clerk/nextjs";
import MainCard from "@/components/MainCard";
import PageTable from "@/components/PageTable";
import type { FilterField } from "@/components/FilterDrawer";
import { request } from "@/helpers/request";
import { ROUTES } from "@/routes";
import { useGetCustomerInfoRequests } from "@/app/portal/hooks/api/useCustomerInfo";
import AddCustomerInfoDialog from "./_components/AddCustomerInfoDialog";

// Office-facing status chip. Colors mirror the accounting/document lists.
const STATUS_CHIP: Record<string, { label: string; color: "default" | "warning" | "success" | "error" }> = {
  awaiting: { label: "Awaiting response", color: "warning" },
  submitted: { label: "Submitted", color: "success" },
  expired: { label: "Expired", color: "default" },
  revoked: { label: "Revoked", color: "error" },
};

const STATUS_OPTIONS = [
  { value: "awaiting", label: "Awaiting response" },
  { value: "submitted", label: "Submitted" },
  { value: "expired", label: "Expired" },
  { value: "revoked", label: "Revoked" },
];

export default function CustomerInformationPage() {
  const router = useRouter();
  const { getToken } = useAuth();
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<{ status?: string; [key: string]: any }>({ status: "" });
  const [addOpen, setAddOpen] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const { docs, total, totalPages, isLoading, refetch } = useGetCustomerInfoRequests({
    page,
    limit,
    search,
    status: filters.status || undefined,
  });

  const filterConfig: FilterField[] = useMemo(
    () => [{ type: "select", key: "status", label: "Status", options: STATUS_OPTIONS }],
    [],
  );

  const handleRevoke = async (id: string) => {
    if (!window.confirm("Revoke this link? The customer will no longer be able to open it.")) return;
    setRevokingId(id);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const res = await request({ path: `/customer-info/${id}/revoke`, method: "POST" }, {}, token);
      if (res?.success === false) throw new Error(res?.message ?? "Failed to revoke");
      toast.success("Link revoked");
      refetch();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to revoke");
    } finally {
      setRevokingId(null);
    }
  };

  const columns = [
    {
      id: "customerName",
      accessorKey: "customerName",
      header: "Customer",
      cell: (info: any) => info.getValue() || "-",
    },
    {
      id: "projectName",
      accessorKey: "projectName",
      header: "Project",
      cell: (info: any) => info.getValue() || "-",
    },
    {
      id: "status",
      accessorKey: "status",
      header: "Status",
      cell: (info: any) => {
        const s = STATUS_CHIP[info.getValue() as string] ?? { label: info.getValue(), color: "default" as const };
        return <Chip size="small" label={s.label} color={s.color} variant={s.color === "default" ? "outlined" : "filled"} />;
      },
    },
    {
      id: "submittedAt",
      accessorKey: "submittedAt",
      header: "Submitted",
      cell: (info: any) => {
        const v = info.getValue();
        return v ? new Date(v).toLocaleDateString() : "-";
      },
    },
    {
      id: "createdAt",
      accessorKey: "createdAt",
      header: "Created",
      cell: (info: any) => {
        const v = info.getValue();
        return v ? new Date(v).toLocaleDateString() : "-";
      },
    },
    {
      id: "actions",
      header: "Actions",
      cell: (info: any) => {
        const row = info.row.original;
        const isRevoked = row.status === "revoked";
        return (
          <Box display="flex" gap={1}>
            <Tooltip title="View collected contacts">
              <IconButton
                onClick={() => router.push(`${ROUTES.CUSTOMER_INFORMATION}/${row.id}`)}
                sx={{ color: "text.secondary", "&:hover": { color: "primary.main" } }}
              >
                <VisibilityIcon />
              </IconButton>
            </Tooltip>
            {!isRevoked && (
              <Tooltip title="Revoke link">
                <span>
                  <IconButton
                    onClick={() => handleRevoke(row.id)}
                    disabled={revokingId === row.id}
                    sx={{ color: "text.secondary", "&:hover": { color: "error.main" } }}
                  >
                    <BlockIcon />
                  </IconButton>
                </span>
              </Tooltip>
            )}
          </Box>
        );
      },
    },
  ];

  return (
    <MainCard>
      <PageTable
        columns={columns}
        data={docs}
        tableName="Customer Information"
        subTitle="Contact people collected from customers, by project"
        buttonName="Add Customer Info"
        onAddClick={() => setAddOpen(true)}
        loading={isLoading}
        page={page}
        limit={limit}
        search={search}
        filters={filters}
        setPage={setPage}
        setLimit={setLimit}
        setSearch={setSearch}
        setFilters={setFilters}
        filterConfig={filterConfig}
        pageCount={totalPages}
        totalDocs={total}
      />

      <AddCustomerInfoDialog open={addOpen} onClose={() => setAddOpen(false)} onCreated={refetch} />
    </MainCard>
  );
}
