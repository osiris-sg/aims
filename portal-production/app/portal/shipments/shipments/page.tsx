/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Shipments (round H) — every B/L across all orders. Tabs: In transit (ETA
// ahead), Arrived (arrival / discharge date, or the latest ETA passed),
// Delivered (cleared: steps up to 10 done) and Completed. Columns: #n-seq,
// customer, B/L, vessel / voyage, carrier, net MT, ETD, latest ETA, current
// step and the port free-time countdown (DET / DEM from discharge, else ETA).
// Search by B/L, order no. ("#19" / "19-1") or vessel. A row opens the
// shipment's steps on its order page.

import React, { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Alert, Box, Chip, Stack, Tab, Tabs, Tooltip, Typography } from "@mui/material";
import PageTable from "@/components/PageTable";
import type { ShipmentListItem, ShipmentTab } from "../_lib/api";
import { useShipments } from "../_lib/hooks";
import { blLabel, fmtDay, fmtMt } from "../_lib/format";
import { CurrentStepCell, EmptyState } from "../_components/bits";
import { useDebounced } from "../_components/useDebounced";
import ShowTestToggle, { useShowTestOrders } from "../_components/ShowTestToggle";

const TABS: Array<{ value: ShipmentTab; label: string }> = [
  { value: "in_transit", label: "In transit" },
  { value: "arrived", label: "Arrived" },
  { value: "delivered", label: "Delivered" },
  { value: "completed", label: "Completed" },
];

const hrefOf = (s: ShipmentListItem) => (s.orderId ? `/portal/shipments/orders/${s.orderId}?shipment=${s.id}` : `/portal/shipments/${s.id}`);

/** "DET 2d · DEM 8d" — red when over, amber on the last day. */
function FreeTime({ s }: { s: ShipmentListItem }) {
  const f = s.freeTime;
  if (!f) return <Typography variant="body2" color="text.secondary">—</Typography>;
  const chip = (code: string, x: { ends: string; daysLeft: number }) => (
    <Tooltip key={code} title={`${code === "DET" ? "Detention" : "Demurrage"} free time ends ${fmtDay(x.ends)} (from ${f.from === "discharge" ? "discharge" : "ETA"})`}>
      <Chip
        size="small"
        variant={x.daysLeft <= 1 ? "filled" : "outlined"}
        color={x.daysLeft < 0 ? "error" : x.daysLeft <= 1 ? "warning" : "default"}
        label={`${code} ${x.daysLeft < 0 ? `${-x.daysLeft}d over` : `${x.daysLeft}d`}`}
      />
    </Tooltip>
  );
  return (
    <Stack direction="row" spacing={0.5} sx={{ whiteSpace: "nowrap" }}>
      {chip("DET", f.det)}
      {chip("DEM", f.dem)}
    </Stack>
  );
}

export default function ShipmentsListPage() {
  const router = useRouter();
  const params = useSearchParams();
  const [tab, setTab] = useState<ShipmentTab>(TABS.some((t) => t.value === params?.get("tab")) ? (params!.get("tab") as ShipmentTab) : "in_transit");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [search, setSearch] = useState("");
  const q = useDebounced(search);
  const [showTest, setShowTest] = useShowTestOrders();
  const list = useShipments({ tab, page, pageSize: limit, q: q || undefined, includeTest: showTest ? "true" : undefined });
  const counts = list.data?.tabs;

  const columns = useMemo(
    () => [
      { id: "ref", header: "#", nowrap: true, cell: ({ row }: any) => <Typography variant="body2" sx={{ fontWeight: 800 }}>{row.original.ref || "—"}</Typography> },
      { id: "customer", header: "Customer", cell: ({ row }: any) => row.original.customerName || "—" },
      { id: "bl", header: "B/L", nowrap: true, cell: ({ row }: any) => blLabel(row.original.blNumber) },
      { id: "vessel", header: "Vessel / voyage", cell: ({ row }: any) => [row.original.vessel, row.original.voyageNo].filter(Boolean).join(" / ") || "—" },
      { id: "carrier", header: "Carrier", cell: ({ row }: any) => row.original.carrier || "—" },
      { id: "net", header: "Net MT", cell: ({ row }: any) => <Box sx={{ fontVariantNumeric: "tabular-nums", textAlign: "right" }}>{row.original.netWeightMt != null ? fmtMt(row.original.netWeightMt) : "—"}</Box> },
      { id: "etd", header: "ETD", nowrap: true, cell: ({ row }: any) => fmtDay(row.original.etd) },
      { id: "eta", header: "ETA (latest)", nowrap: true, cell: ({ row }: any) => fmtDay(row.original.eta) },
      { id: "step", header: "Current step", cell: ({ row }: any) => <CurrentStepCell step={row.original.currentStep} progress={row.original.progress} maxWidth={260} /> },
      { id: "free", header: "Free time", cell: ({ row }: any) => <FreeTime s={row.original} /> },
    ],
    [],
  );

  const tabs = (
    <Tabs
      value={tab}
      onChange={(_, v) => {
        setTab(v);
        setPage(1);
      }}
      variant="scrollable"
      allowScrollButtonsMobile
      sx={{ minHeight: 40, "& .MuiTab-root": { minHeight: 40, textTransform: "none" } }}
      data-tour="shipments-list-tabs"
    >
      {TABS.map((t) => (
        <Tab key={t.value} value={t.value} label={`${t.label}${counts ? ` (${counts[t.value] ?? 0})` : ""}`} />
      ))}
    </Tabs>
  );

  return (
    <Box sx={{ p: { xs: 1.5, md: 3 }, height: "100%" }} data-tour="shipments-list">
      <PageTable
        tableName="Shipments"
        subTitle="Every B/L across all orders"
        columns={columns}
        data={list.data?.items ?? []}
        loading={list.isLoading}
        page={page}
        limit={limit}
        search={search}
        setPage={setPage}
        setLimit={(l) => {
          setLimit(l);
          setPage(1);
        }}
        setSearch={(s) => {
          setSearch(s);
          setPage(1);
        }}
        pageCount={list.data?.totalPages ?? 1}
        totalDocs={list.data?.total}
        onRowClick={(r: ShipmentListItem) => router.push(hrefOf(r))}
        rowHref={(r: ShipmentListItem) => hrefOf(r)}
        noSelectionColumn
        manualSorting
        hideTable={!list.isLoading && !list.isError && !list.data?.items?.length}
        headerContent={
          <>
            <Stack direction="row" alignItems="center" spacing={1}>
              {tabs}
              <ShowTestToggle
                value={showTest}
                onChange={(v) => {
                  setShowTest(v);
                  setPage(1);
                }}
              />
            </Stack>
            {list.isError ? (
              <Alert severity="error">{(list.error as Error)?.message || "Could not load shipments"}</Alert>
            ) : !list.isLoading && !list.data?.items?.length ? (
              <EmptyState title={q ? "No shipment matches this search" : `No shipments ${TABS.find((t) => t.value === tab)!.label.toLowerCase()}`} />
            ) : null}
          </>
        }
      />
    </Box>
  );
}
