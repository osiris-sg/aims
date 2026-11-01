"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { request } from "@/helpers/request";
import MainCard from "@/components/MainCard";
import DoStatusTag from "@/components/DoStatusTag";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import moment from "moment";
import ScheduleDeliveryDialog from "@/app/portal/deliveries/_components/ScheduleDeliveryDialog";
import { addJobPrefill, fmtJobWhen, jobStatusColor, jobStatusLabel, orderStatusColor, orderStatusLabel, type PrefillLine } from "@/helpers/wctOrders";

// WCT order page (enableWctOrders, 2026-11-01): the order header, its jobs
// (Delivery runs), and "Add job", which opens the usual schedule dialog
// pre-filled with the customer, the site and the quotation's lines (SiteClock
// worker + duration as on any schedule). A row opens the job; the kebab has the DO.
interface Job {
  id: string;
  deliveryNumber: number;
  status: string;
  isDraft: boolean;
  scheduledFor: string | null;
  completedAt: string | null;
  siteAddress: string | null;
  rider: string | null;
  worker: { id: string | null; name: string | null; durationMin: number; syncState: string; lastError: string | null } | null;
  deliveryOrder: { id: string; name: string | null; status: string; templateId: string; tag: "Pending" | "Completed" | "Cancelled" } | null;
}
interface WctOrder {
  id: string;
  orderNumber: string;
  status: string;
  createdAt: string;
  customer: { id: string; name: string; customerCode: string | null; address: string | null } | null;
  sourceQuotation: { id: string; name: string; status: string; type: string; documentTemplateId: string } | null;
  jobs: Job[];
  prefill: { siteAddress: string | null; lines: PrefillLine[] };
}

const doHref = (d: NonNullable<Job["deliveryOrder"]>) => `/portal/documents/DELIVERY_ORDER/${d.templateId}/${d.id}`;

export default function WctOrderDetail({ id }: { id: string }) {
  const router = useRouter();
  const { organization } = useOrganization();
  const { getToken } = useAuth();
  const [order, setOrder] = useState<WctOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [menu, setMenu] = useState<{ pos: { left: number; top: number }; job: Job } | null>(null);

  const load = useCallback(async () => {
    if (!organization?.id) return;
    try {
      const token = await getToken();
      const res = await request({ path: `/orders/${id}`, method: "GET" }, {}, token ?? undefined);
      if (res?.success === false || !res?.data) throw new Error(res?.message || "Order not found");
      setOrder(res.data);
      setError(null);
    } catch (e: any) {
      setError(e?.message || "Failed to load the order");
    } finally {
      setLoading(false);
    }
  }, [organization?.id, getToken, id]);

  useEffect(() => {
    load();
  }, [load]);

  // Memoised: the dialog re-applies its prefill whenever this object changes.
  const prefill = useMemo(() => (order ? addJobPrefill(order) : null), [order]);

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "60vh" }}>
        <CircularProgress />
      </Box>
    );
  }
  if (error || !order) {
    return (
      <MainCard>
        <Alert severity="error">{error || "Order not found"}</Alert>
      </MainCard>
    );
  }

  const q = order.sourceQuotation;
  return (
    <MainCard>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
        <IconButton size="small" onClick={() => router.push("/portal/orders")} aria-label="Back to orders">
          <ArrowBackIcon fontSize="small" />
        </IconButton>
        <Typography variant="caption" color="text.secondary">
          Orders
        </Typography>
      </Stack>

      <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" alignItems={{ xs: "flex-start", sm: "center" }} spacing={2} sx={{ mb: 3 }}>
        <Box>
          <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography variant="h5" sx={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
              {order.orderNumber}
            </Typography>
            <Chip size="small" label={orderStatusLabel(order.status)} color={orderStatusColor(order.status) as any} />
          </Stack>
          <Stack direction="row" spacing={3} sx={{ mt: 1 }} flexWrap="wrap" useFlexGap>
            <Box>
              <Typography variant="caption" color="text.secondary">
                Customer
              </Typography>
              <Typography variant="body2">{order.customer?.name || "—"}</Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">
                Quotation
              </Typography>
              <Typography variant="body2">
                {q ? (
                  <Link href={`/portal/documents/${q.type}/${q.documentTemplateId}/${q.id}`} style={{ color: "inherit" }}>
                    {q.name}
                  </Link>
                ) : (
                  "—"
                )}
              </Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">
                Created
              </Typography>
              <Typography variant="body2">{moment(order.createdAt).format("DD/MM/YYYY")}</Typography>
            </Box>
          </Stack>
        </Box>
        <Button variant="contained" disableElevation startIcon={<AddIcon />} onClick={() => setAddOpen(true)} data-tour="wct-order-add-job">
          Add job
        </Button>
      </Stack>

      <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
        Jobs
      </Typography>
      {order.jobs.length === 0 ? (
        <Alert severity="info">No jobs yet. Use Add job to schedule the first one.</Alert>
      ) : (
        <TableContainer sx={{ border: 1, borderColor: "divider", borderRadius: 1 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Job</TableCell>
                <TableCell>When</TableCell>
                <TableCell>Worker</TableCell>
                <TableCell>Site</TableCell>
                <TableCell>DO</TableCell>
                <TableCell>Status</TableCell>
                <TableCell padding="checkbox" />
              </TableRow>
            </TableHead>
            <TableBody>
              {order.jobs.map((j) => (
                <TableRow key={j.id} hover sx={{ cursor: "pointer", opacity: j.status === "cancelled" ? 0.6 : 1 }} onClick={() => router.push(`/portal/deliveries/${j.id}`)}>
                  <TableCell sx={{ fontWeight: 600, whiteSpace: "nowrap" }}>#{j.deliveryNumber}</TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>{fmtJobWhen(j.scheduledFor)}</TableCell>
                  <TableCell>
                    {j.worker?.name || "—"}
                    {j.rider && j.rider !== j.worker?.name && (
                      <Typography variant="caption" color="text.secondary" component="div">
                        Started by {j.rider}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell sx={{ maxWidth: 260 }}>
                    <Typography variant="body2" noWrap title={j.siteAddress || ""}>
                      {j.siteAddress || "—"}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>
                    {j.deliveryOrder ? (
                      <Stack direction="row" spacing={0.75} alignItems="center">
                        <span style={{ fontVariantNumeric: "tabular-nums" }}>{j.deliveryOrder.name || "—"}</span>
                        <DoStatusTag tag={j.deliveryOrder.tag} />
                      </Stack>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell>
                    <Chip size="small" label={jobStatusLabel(j)} color={jobStatusColor(j) as any} variant={j.isDraft ? "outlined" : "filled"} />
                  </TableCell>
                  <TableCell padding="checkbox" onClick={(e) => e.stopPropagation()}>
                    <IconButton
                      size="small"
                      aria-label="More actions"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenu({ pos: { left: e.clientX, top: e.clientY }, job: j });
                      }}
                    >
                      <MoreVertIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Menu anchorReference="anchorPosition" anchorPosition={menu?.pos} open={!!menu} onClose={() => setMenu(null)}>
        <MenuItem
          onClick={() => {
            const j = menu!.job;
            setMenu(null);
            router.push(`/portal/deliveries/${j.id}`);
          }}
        >
          Open job
        </MenuItem>
        <MenuItem
          disabled={!menu?.job.deliveryOrder}
          onClick={() => {
            const d = menu!.job.deliveryOrder!;
            setMenu(null);
            router.push(doHref(d));
          }}
        >
          View DO
        </MenuItem>
      </Menu>

      <ScheduleDeliveryDialog open={addOpen} onClose={() => setAddOpen(false)} onCreated={() => void load()} prefill={prefill} />
    </MainCard>
  );
}
