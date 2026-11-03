"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { Box, FormControl, InputLabel, MenuItem, Select, Stack, TextField, Tooltip, Typography } from "@mui/material";
import { toast } from "react-toastify";
import PageTable from "@/components/PageTable";
import JobFieldIcon from "@/components/jobFields/JobFieldIcon";
import { request } from "@/helpers/request";
import { fmtJobWhen } from "@/helpers/wctOrders";
import { ORDER_JOB_STATE_LABEL, orderJobStateColor } from "@/helpers/wctNav";
import StatusPill from "./_components/StatusPill";

// WCT Orders → Jobs (enableWctOrders, 2026-11-03): every job of every order.
// GET /deliveries/order-jobs filters on the server (search, dates, status,
// worker). The row opens the job.
interface JobRow {
  id: string;
  deliveryNumber: number;
  direction?: string;
  state: string;
  scheduledFor: string | null;
  order: { id: string; orderNumber: string } | null;
  customer: { id: string; name: string } | null;
  site: string | null;
  worker: string | null;
  dos: Array<{ id: string; name: string | null }>;
  badges: Array<{ fieldId: string; label: string; icon: string; colour: string; text: string }>;
}

export default function WctJobsList() {
  const router = useRouter();
  const { getToken } = useAuth();
  const [rows, setRows] = useState<JobRow[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [workers, setWorkers] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<any>({});
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [state, setState] = useState("");
  const [worker, setWorker] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const token = await getToken();
      const qs = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (search.trim()) qs.set("q", search.trim());
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
      if (state) qs.set("state", state);
      if (worker) qs.set("worker", worker);
      const res: any = await request({ path: `/deliveries/order-jobs?${qs}`, method: "GET" }, {}, token ?? undefined);
      if (res?.success === false) throw new Error(res?.message || "Failed to load jobs");
      const d = res?.data ?? res;
      setRows(d?.docs ?? []);
      setTotal(d?.total ?? 0);
      setPages(d?.totalPages ?? 1);
      setWorkers(d?.workers ?? []);
    } catch (e: any) {
      toast.error(e?.message || "Failed to load jobs");
    } finally {
      setLoading(false);
    }
  }, [getToken, page, limit, search, from, to, state, worker]);

  useEffect(() => {
    void load();
  }, [load]);

  // A filter change starts again at page 1.
  useEffect(() => {
    setPage(1);
  }, [search, from, to, state, worker]);

  const columns: any[] = [
    {
      accessorKey: "deliveryNumber",
      header: "Job No.",
      size: 8,
      cell: ({ row }: any) => (
        <Typography variant="body2" sx={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
          {row.original.direction === "RETURN" ? "Return" : "Job"} #{row.original.deliveryNumber}
        </Typography>
      ),
    },
    { accessorKey: "order", header: "Order No.", size: 11, cell: ({ row }: any) => row.original.order?.orderNumber || "-" },
    { accessorKey: "customer", header: "Customer", size: 14, cell: ({ row }: any) => row.original.customer?.name || "-" },
    { accessorKey: "site", header: "Site", size: 16, cell: ({ row }: any) => row.original.site || "-" },
    { accessorKey: "scheduledFor", header: "Date / time", size: 11, cell: ({ row }: any) => (row.original.scheduledFor ? fmtJobWhen(row.original.scheduledFor) : "Not scheduled") },
    { accessorKey: "worker", header: "Worker", size: 10, cell: ({ row }: any) => row.original.worker || "-" },
    {
      accessorKey: "badges",
      header: "Permits",
      size: 7,
      cell: ({ row }: any) =>
        row.original.badges?.length ? (
          <Stack direction="row" spacing={0.5}>
            {row.original.badges.map((b: any) => (
              <Tooltip key={b.fieldId} title={`${b.label}: ${b.text}`}>
                <span>
                  <JobFieldIcon icon={b.icon} sx={{ fontSize: 18, color: b.colour }} />
                </span>
              </Tooltip>
            ))}
          </Stack>
        ) : (
          "-"
        ),
    },
    { accessorKey: "dos", header: "DO", size: 10, cell: ({ row }: any) => (row.original.dos?.length ? row.original.dos.map((d: any) => d.name || "DO").join(", ") : "-") },
    {
      accessorKey: "state",
      header: "Status",
      size: 9,
      cell: ({ row }: any) => <StatusPill label={ORDER_JOB_STATE_LABEL[row.original.state] ?? row.original.state} color={orderJobStateColor(row.original.state)} />,
    },
  ];

  const filterBar = (
    <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ mb: 2 }}>
      <TextField label="From" type="date" size="small" value={from} onChange={(e) => setFrom(e.target.value)} InputLabelProps={{ shrink: true }} />
      <TextField label="To" type="date" size="small" value={to} onChange={(e) => setTo(e.target.value)} InputLabelProps={{ shrink: true }} />
      <FormControl size="small" sx={{ minWidth: 160 }}>
        <InputLabel id="jobs-state">Status</InputLabel>
        <Select labelId="jobs-state" label="Status" value={state} onChange={(e) => setState(String(e.target.value))}>
          <MenuItem value="">All</MenuItem>
          {Object.entries(ORDER_JOB_STATE_LABEL).map(([k, v]) => (
            <MenuItem key={k} value={k}>
              {v}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      <FormControl size="small" sx={{ minWidth: 180 }}>
        <InputLabel id="jobs-worker">Worker</InputLabel>
        <Select labelId="jobs-worker" label="Worker" value={worker} onChange={(e) => setWorker(String(e.target.value))}>
          <MenuItem value="">All</MenuItem>
          {workers.map((w) => (
            <MenuItem key={w} value={w}>
              {w}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
    </Stack>
  );

  return (
    <Box>
      <PageTable
        onRowClick={(r: any) => router.push(`/portal/deliveries/${r.id}`)}
        rowHref={(r: any) => `/portal/deliveries/${r.id}`}
        columns={columns}
        data={rows}
        tableName="Jobs"
        subTitle="Every job of every order. Open a job to see its details, photos and DO."
        headerContent={filterBar}
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
        pageCount={pages}
        totalDocs={total}
      />
    </Box>
  );
}
