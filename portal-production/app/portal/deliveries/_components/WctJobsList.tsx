"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import React, { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, InputLabel, MenuItem, Select, Stack, Tab, Tabs, TextField, Tooltip, Typography } from "@mui/material";
import { toast } from "react-toastify";
import MainCard from "@/components/MainCard";
import PageTable from "@/components/PageTable";
import { kebabColumn } from "@/components/RowKebab";
import JobFieldIcon from "@/components/jobFields/JobFieldIcon";
import { request } from "@/helpers/request";
import { fmtJobWhen } from "@/helpers/wctOrders";
import { rejectProblem } from "@/helpers/wctFinishModes";
import { JOB_TABS, ORDER_JOB_STATE_LABEL, jobsTab, orderJobStateColor, verifiedText } from "@/helpers/wctNav";
import StatusPill from "@/app/portal/orders/_components/StatusPill";

// WCT Jobs (enableWctOrders, 2026-11-03): the Jobs menu page (/portal/deliveries).
// A WCT job is a service visit from an order (stored as a delivery run). Title
// first, then the status tabs ("To verify (n)" is the sign-off queue), the
// filters, the table. GET /deliveries/order-jobs filters on the server. A row
// opens the job; a job waiting for sign-off has Verify / Reject in its menu.
interface JobRow {
  id: string;
  deliveryNumber: number;
  direction?: string;
  state: string;
  verificationState: string | null;
  verifiedByName: string | null;
  verifiedAt: string | null;
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
  const pathname = usePathname();
  const params = useSearchParams();
  const { getToken } = useAuth();
  const state = jobsTab(params.get("status"));
  const [rows, setRows] = useState<JobRow[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [workers, setWorkers] = useState<string[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<any>({});
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [worker, setWorker] = useState("");
  const [rejecting, setRejecting] = useState<JobRow | null>(null);
  const [reason, setReason] = useState("");
  const [working, setWorking] = useState(false);

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
      setCounts(d?.counts ?? {});
    } catch (e: any) {
      toast.error(e?.message || "Failed to load jobs");
    } finally {
      setLoading(false);
    }
  }, [getToken, page, limit, search, from, to, state, worker]);

  useEffect(() => {
    void load();
  }, [load]);

  // A filter or tab change starts again at page 1.
  useEffect(() => {
    setPage(1);
  }, [search, from, to, state, worker]);

  const selectTab = (key: string) => router.replace(key ? `${pathname}?status=${key}` : pathname, { scroll: false });

  const act = async (row: JobRow, kind: "verify" | "reject", body: any = {}) => {
    setWorking(true);
    try {
      const token = await getToken();
      const res: any = await request({ path: `/deliveries/${row.id}/${kind}`, method: "POST" }, body, token ?? undefined);
      if (res?.success === false) throw new Error(res?.message || "Could not save");
      toast.success(kind === "verify" ? `Job #${row.deliveryNumber} verified.` : `Job #${row.deliveryNumber} sent back.`);
      await load();
      return true;
    } catch (e: any) {
      toast.error(e?.message || "Could not save");
      return false;
    } finally {
      setWorking(false);
    }
  };

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
    { accessorKey: "customer", header: "Customer", size: 13, cell: ({ row }: any) => row.original.customer?.name || "-" },
    { accessorKey: "site", header: "Site", size: 14, cell: ({ row }: any) => row.original.site || "-" },
    { accessorKey: "scheduledFor", header: "Date / time", size: 11, cell: ({ row }: any) => (row.original.scheduledFor ? fmtJobWhen(row.original.scheduledFor) : "Not scheduled") },
    { accessorKey: "worker", header: "Worker", size: 9, cell: ({ row }: any) => row.original.worker || "-" },
    {
      accessorKey: "badges",
      header: "Permits",
      size: 6,
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
    { accessorKey: "dos", header: "DO", size: 9, cell: ({ row }: any) => (row.original.dos?.length ? row.original.dos.map((d: any) => d.name || "DO").join(", ") : "-") },
    {
      accessorKey: "state",
      header: "Status",
      size: 8,
      cell: ({ row }: any) => <StatusPill label={ORDER_JOB_STATE_LABEL[row.original.state] ?? row.original.state} color={orderJobStateColor(row.original.state)} />,
    },
    {
      accessorKey: "verificationState",
      header: "Verified",
      size: 9,
      cell: ({ row }: any) => (
        <Typography variant="body2" color={row.original.verificationState === "verified" ? "text.primary" : "text.secondary"}>
          {verifiedText(row.original)}
        </Typography>
      ),
    },
    kebabColumn((row: JobRow) => [
      { label: "Open job", onClick: () => router.push(`/portal/deliveries/${row.id}`) },
      ...(row.order ? [{ label: "Open order", onClick: () => router.push(`/portal/orders/${row.order!.id}`) }] : []),
      ...(row.state === "to_verify" || row.state === "rejected" ? [{ label: "Verify", onClick: () => void act(row, "verify") }] : []),
      ...(row.state === "to_verify" ? [{ label: "Reject", destructive: true, onClick: () => { setReason(""); setRejecting(row); } }] : []),
    ]),
  ];

  const header = (
    <>
      <Box sx={{ borderBottom: 1, borderColor: "divider", mb: 2 }}>
        <Tabs value={state} onChange={(_, v) => selectTab(String(v))} variant="scrollable" scrollButtons="auto" allowScrollButtonsMobile>
          {JOB_TABS.map((t) => (
            <Tab key={t.key || "all"} value={t.key} label={`${t.label} (${counts[t.key || "all"] ?? 0})`} sx={{ textTransform: "none", minHeight: 48 }} data-tour={t.key === "to_verify" ? "jobs-to-verify" : undefined} />
          ))}
        </Tabs>
      </Box>
      {state === "to_verify" && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Jobs finished with a photo of the stamped DO, or marked completed with the paper copy to follow. Open a job to check its photos; verify it once the stamped DO or the paper copy is right, or reject it with a reason to send it back.
        </Typography>
      )}
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ mb: 2 }}>
        <TextField label="From" type="date" size="small" value={from} onChange={(e) => setFrom(e.target.value)} InputLabelProps={{ shrink: true }} />
        <TextField label="To" type="date" size="small" value={to} onChange={(e) => setTo(e.target.value)} InputLabelProps={{ shrink: true }} />
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
    </>
  );

  return (
    <MainCard>
      <PageTable
        onRowClick={(r: any) => router.push(`/portal/deliveries/${r.id}`)}
        rowHref={(r: any) => `/portal/deliveries/${r.id}`}
        columns={columns}
        data={rows}
        tableName="Jobs"
        subTitle="Every job of every order. Open a job to see its details, photos and DO."
        headerContent={header}
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
      <Dialog open={!!rejecting} onClose={() => !working && setRejecting(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Reject job #{rejecting?.deliveryNumber}?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 1.5 }}>
            The job goes back with your reason, for the team to fix and finish again.
          </Typography>
          <TextField label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} fullWidth multiline minRows={2} autoFocus />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRejecting(null)} disabled={working} color="inherit">
            Cancel
          </Button>
          <Button
            variant="contained"
            color="error"
            disabled={working || !!rejectProblem(reason)}
            onClick={async () => {
              if (rejecting && (await act(rejecting, "reject", { reason: reason.trim() }))) setRejecting(null);
            }}
          >
            Reject
          </Button>
        </DialogActions>
      </Dialog>
    </MainCard>
  );
}
