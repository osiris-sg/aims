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
import { addJobPrefill, fmtJobWhen, invoiceNowText, jobStatusColor, jobStatusLabel, orderStatusColor, orderStatusLabel, type PrefillLine } from "@/helpers/wctOrders";
import { Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from "@mui/material";

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
  verificationState?: string | null;
  invoiceId?: string | null;
}
interface OrderInvoice {
  id: string;
  name: string | null;
  status: string;
  href: string;
  total: number;
  jobNumbers: number[];
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
  // WCT invoice per order (enableWctOrderInvoice)
  invoicing?: boolean;
  invoices?: OrderInvoice[];
  toInvoice?: number[];
}

const INVOICE_STATUS: Record<string, string> = { draft: "Draft", unconfirmed: "Draft", confirmed: "Confirmed", pending_payment: "Sent, awaiting payment", paid: "Paid" };

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
  const [invoiceAsk, setInvoiceAsk] = useState(false);
  const [invoicing, setInvoicing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

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

      {actionError && (
        <Alert severity="warning" sx={{ mt: 2 }} onClose={() => setActionError(null)}>
          {actionError}
        </Alert>
      )}
      {order.invoicing && (
        <Box sx={{ mt: 3 }}>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
              Invoices
            </Typography>
            <Box sx={{ flex: 1 }} />
            <Button size="small" variant="outlined" disabled={!order.toInvoice?.length || invoicing} onClick={() => setInvoiceAsk(true)} data-tour="wct-order-invoice-now">
              Invoice now
            </Button>
          </Stack>
          {!order.invoices?.length ? (
            <Typography variant="body2" color="text.secondary">
              {order.toInvoice?.length
                ? `${order.toInvoice.length} verified job${order.toInvoice.length === 1 ? "" : "s"} not invoiced yet. The order is invoiced automatically once every job is done and verified, or use Invoice now.`
                : "The order is invoiced once every job is done and verified."}
            </Typography>
          ) : (
            <TableContainer sx={{ border: 1, borderColor: "divider", borderRadius: 1 }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Invoice</TableCell>
                    <TableCell>Jobs</TableCell>
                    <TableCell align="right">Amount</TableCell>
                    <TableCell>Status</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {order.invoices.map((inv) => (
                    <TableRow key={inv.id} hover sx={{ cursor: "pointer" }} onClick={() => router.push(inv.href)}>
                      <TableCell sx={{ fontWeight: 600 }}>{inv.name || "Invoice"}</TableCell>
                      <TableCell>{inv.jobNumbers.map((n) => `#${n}`).join(", ")}</TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>
                        {inv.total.toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell>
                        <Chip size="small" label={INVOICE_STATUS[inv.status] ?? inv.status} color={inv.status === "paid" ? "success" : inv.status === "pending_payment" ? "info" : "default"} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Box>
      )}

      <Dialog open={invoiceAsk} onClose={() => setInvoiceAsk(false)} fullWidth maxWidth="xs">
        <DialogTitle>Invoice now</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {invoiceNowText(order.toInvoice ?? [], order.jobs.filter((j) => j.status !== "cancelled" && !j.invoiceId && !(order.toInvoice ?? []).includes(j.deliveryNumber)).length)}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setInvoiceAsk(false)}>Cancel</Button>
          <Button
            variant="contained"
            disableElevation
            disabled={invoicing}
            onClick={async () => {
              setInvoicing(true);
              try {
                const token = await getToken();
                const res = await request({ path: `/orders/${order.id}/invoice-now`, method: "POST" }, {}, token ?? undefined);
                if (res?.success === false) throw new Error(res?.message || "Could not create the invoice");
                setInvoiceAsk(false);
                await load();
              } catch (e: any) {
                setActionError(e?.message || "Could not create the invoice");
                setInvoiceAsk(false);
              } finally {
                setInvoicing(false);
              }
            }}
          >
            Create invoice
          </Button>
        </DialogActions>
      </Dialog>

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
