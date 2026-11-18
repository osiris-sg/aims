"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { Alert, Box, Button, Chip, FormControlLabel, Stack, Switch, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import MainCard from "@/components/MainCard";
import PageTable from "@/components/PageTable";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";
import { useUserPermissions } from "@/app/portal/hooks/useUserPermissions";
import { canVehicles, expiryChip, fmtDate, fmtKm, fmtMoney, vehiclesApi, type VehicleRow } from "@/helpers/wctVehicles";
import { VEHICLE_NEW_PATH, vehicleHref } from "@/helpers/wctNav";
import { DEFAULT_PAGE_SIZE } from "@/components/PageTable";

/**
 * WCT Vehicles (enableWctVehicles, 2026-11-12; log book 2026-11-16): the vans
 * and lorries with the current driver (latest "Driver assigned" entry), the
 * last mileage, what each cost this year, and the COE / lifespan expiry (amber
 * under 90 days, red once past). Click a row for its log book. Under Assets
 * since 2026-11-16: no row menu (Edit / Archive are on the vehicle's pages),
 * Add vehicle is a full page.
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
  const [limit, setLimit] = useState(DEFAULT_PAGE_SIZE);
  const [filters, setFilters] = useState<any>({});

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
              since {fmtDate(row.original.driverSince)}
            </Typography>
          </Box>
        ) : (
          <Typography variant="body2" color="text.secondary">
            Not assigned
          </Typography>
        ),
    },
    { accessorKey: "lastMileage", header: "Last mileage", size: 10, cell: ({ row }: any) => fmtKm(row.original.lastMileage) },
    {
      accessorKey: "spentThisYear",
      header: "Spent this year",
      size: 10,
      cell: ({ row }: any) => <span style={{ fontVariantNumeric: "tabular-nums" }}>{fmtMoney(row.original.spentThisYear ?? 0)}</span>,
    },
    { accessorKey: "coeExpiry", header: "COE expiry", size: 15, cell: ({ row }: any) => <ExpiryCell date={row.original.coeExpiry} days={row.original.coeDays} /> },
    { accessorKey: "lifespanExpiry", header: "Lifespan expiry", size: 15, cell: ({ row }: any) => <ExpiryCell date={row.original.lifespanExpiry} days={row.original.lifespanDays} /> },
    {
      accessorKey: "repairsToApprove",
      header: "Repairs to approve",
      size: 8,
      cell: ({ row }: any) => (row.original.repairsToApprove ? <Chip size="small" color="warning" label={row.original.repairsToApprove} /> : "-"),
    },
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
        onRowClick={(r: any) => router.push(vehicleHref(r.id))}
        rowHref={(r: any) => vehicleHref(r.id)}
        columns={columns}
        data={filtered}
        tableName="Vehicles"
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
                <Button key="add" variant="contained" startIcon={<AddIcon />} onClick={() => router.push(VEHICLE_NEW_PATH)} data-tour="vehicles-add">
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
        clientPaging
        pageCount={1}
        totalDocs={filtered.length}
        noSelectionColumn
      />
    </MainCard>
  );
}
