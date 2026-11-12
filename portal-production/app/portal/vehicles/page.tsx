"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { Alert, Box, Button, Chip, FormControlLabel, IconButton, Menu, MenuItem, Stack, Switch, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import MainCard from "@/components/MainCard";
import PageTable from "@/components/PageTable";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";
import { useUserPermissions } from "@/app/portal/hooks/useUserPermissions";
import { canVehicles, expiryChip, fmtDate, fmtKm, vehiclesApi, type VehicleRow } from "@/helpers/wctVehicles";
import { VehicleFormDialog } from "./_components/VehicleDialogs";

/**
 * WCT Vehicles (enableWctVehicles, 2026-11-12): the vans and lorries with who
 * has each one now, the last mileage, and the COE / lifespan expiry (amber
 * under 90 days, red once past). Click a row for its usage & repair log.
 */
function ExpiryCell({ date, days }: { date: string | null; days: number | null }) {
  const chip = expiryChip(days);
  return (
    <Stack direction="row" spacing={1} alignItems="center">
      <span>{fmtDate(date)}</span>
      {chip && <Chip size="small" label={chip.label} color={chip.color} variant="outlined" />}
    </Stack>
  );
}

export default function VehiclesPage() {
  const router = useRouter();
  const { getToken } = useAuth();
  const { isWctVehiclesEnabled } = useOrganizationFeatures();
  const { hasPermission, userRoles } = useUserPermissions();
  const canEdit = canVehicles(userRoles, hasPermission, "update");
  const [rows, setRows] = useState<VehicleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [filters, setFilters] = useState<any>({});
  const [form, setForm] = useState<{ open: boolean; vehicle: VehicleRow | null }>({ open: false, vehicle: null });
  const [menu, setMenu] = useState<{ pos: { left: number; top: number }; row: VehicleRow } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      setRows(await vehiclesApi<VehicleRow[]>(showArchived ? "?archived=1" : "", "GET", token));
    } catch (e: any) {
      setError(e?.message ?? "Could not load the vehicles");
    } finally {
      setLoading(false);
    }
  }, [getToken, showArchived]);

  useEffect(() => {
    if (isWctVehiclesEnabled) void load();
  }, [isWctVehiclesEnabled, load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? rows.filter((r) => [r.vehicleNo, r.model, r.currentDriver].some((v) => (v ?? "").toLowerCase().includes(q))) : rows;
  }, [rows, search]);

  const archive = async (row: VehicleRow) => {
    setMenu(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      await vehiclesApi(`/${row.id}/archive`, "POST", token, { archived: !row.archived });
      await load();
    } catch (e: any) {
      setError(e?.message ?? "Could not archive");
    }
  };

  const columns: any[] = [
    {
      accessorKey: "vehicleNo",
      header: "Vehicle / Lorry No.",
      size: 12,
      cell: ({ row }: any) => (
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {row.original.vehicleNo}
          </Typography>
          {row.original.archived && <Chip size="small" label="Archived" variant="outlined" />}
        </Stack>
      ),
    },
    { accessorKey: "model", header: "Model", size: 16, cell: ({ row }: any) => row.original.model || "-" },
    {
      accessorKey: "currentDriver",
      header: "Current driver",
      size: 14,
      cell: ({ row }: any) =>
        row.original.currentDriver ? (
          <Box>
            <Typography variant="body2">{row.original.currentDriver}</Typography>
            <Typography variant="caption" color="text.secondary">
              since {fmtDate(row.original.inUseSince)}
            </Typography>
          </Box>
        ) : (
          <Typography variant="body2" color="text.secondary">
            Available
          </Typography>
        ),
    },
    { accessorKey: "lastMileage", header: "Last mileage", size: 10, cell: ({ row }: any) => fmtKm(row.original.lastMileage) },
    { accessorKey: "coeExpiry", header: "COE expiry", size: 15, cell: ({ row }: any) => <ExpiryCell date={row.original.coeExpiry} days={row.original.coeDays} /> },
    { accessorKey: "lifespanExpiry", header: "Lifespan expiry", size: 15, cell: ({ row }: any) => <ExpiryCell date={row.original.lifespanExpiry} days={row.original.lifespanDays} /> },
    {
      accessorKey: "repairsToApprove",
      header: "Repairs to approve",
      size: 8,
      cell: ({ row }: any) => (row.original.repairsToApprove ? <Chip size="small" color="warning" label={row.original.repairsToApprove} /> : "-"),
    },
    ...(canEdit
      ? [
          {
            id: "actions",
            header: "",
            size: 4,
            cell: ({ row }: any) => (
              <IconButton
                size="small"
                aria-label="More"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenu({ pos: { left: e.clientX, top: e.clientY }, row: row.original });
                }}
              >
                <MoreVertIcon fontSize="small" />
              </IconButton>
            ),
          },
        ]
      : []),
  ];

  if (!isWctVehiclesEnabled) {
    return (
      <MainCard>
        <Alert severity="info">Vehicles are not enabled for this organisation.</Alert>
      </MainCard>
    );
  }

  return (
    <MainCard>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      <PageTable
        onRowClick={(r: any) => router.push(`/portal/vehicles/${r.id}`)}
        rowHref={(r: any) => `/portal/vehicles/${r.id}`}
        columns={columns}
        data={filtered}
        tableName="Vehicles"
        subTitle="Vans and lorries, who has each one and its usage & repair log. COE and lifespan expiry turn amber 90 days before."
        headerContent={
          <FormControlLabel
            sx={{ mb: 1 }}
            control={<Switch size="small" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />}
            label={<Typography variant="body2">Show archived</Typography>}
          />
        }
        actionButtons={
          canEdit
            ? [
                <Button key="add" variant="contained" startIcon={<AddIcon />} onClick={() => setForm({ open: true, vehicle: null })} data-tour="vehicles-add">
                  Add vehicle
                </Button>,
              ]
            : []
        }
        loading={loading}
        page={page}
        limit={limit}
        search={search}
        filters={filters}
        setPage={setPage}
        setLimit={setLimit}
        setSearch={setSearch}
        setFilters={setFilters}
        filterConfig={[]}
        pageCount={1}
        totalDocs={filtered.length}
        noSelectionColumn
      />
      <Menu open={!!menu} onClose={() => setMenu(null)} anchorReference="anchorPosition" anchorPosition={menu?.pos}>
        <MenuItem
          onClick={() => {
            setForm({ open: true, vehicle: menu!.row });
            setMenu(null);
          }}
        >
          Edit details
        </MenuItem>
        <MenuItem onClick={() => menu && void archive(menu.row)}>{menu?.row.archived ? "Restore" : "Archive"}</MenuItem>
      </Menu>
      <VehicleFormDialog
        open={form.open}
        vehicle={form.vehicle}
        onClose={() => setForm({ open: false, vehicle: null })}
        onDone={(v) => {
          setForm({ open: false, vehicle: null });
          if (form.vehicle) void load();
          else router.push(`/portal/vehicles/${v.id}`);
        }}
      />
    </MainCard>
  );
}
