"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { request } from "@/helpers/request";
import MainCard from "@/components/MainCard";
import DoStatusTag from "@/components/DoStatusTag";
import StatusPill from "../_components/StatusPill";
import {
  Alert,
  Box,
  Button,
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
import { Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, List, ListItemButton, ListItemText, TextField } from "@mui/material";
import { uploadFile, publicFileUrl } from "@/helpers/fileUploader";
import { attachmentLine, type OrderAttachment, type ReportOption } from "@/helpers/wctOrders";

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
  /** Emailed to the customer at least once (else only confirmed). */
  emailed?: boolean;
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
  // WCT service report on the order (Phase 5)
  attachments?: OrderAttachment[];
}

const INVOICE_STATUS: Record<string, string> = { draft: "Draft", unconfirmed: "Draft", confirmed: "Confirmed", pending_payment: "Confirmed, awaiting payment", paid: "Paid" };
// "Sent" only when the invoice was actually emailed (the API's `emailed`).
const invoiceStatusLabel = (inv: { status: string; emailed?: boolean }) =>
  inv.status === "pending_payment" && inv.emailed ? "Sent, awaiting payment" : INVOICE_STATUS[inv.status] ?? inv.status;

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
  const [actionInfo, setActionInfo] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [reportNo, setReportNo] = useState("");
  const [options, setOptions] = useState<ReportOption[] | null>(null);
  const [attMenu, setAttMenu] = useState<{ pos: { left: number; top: number }; att: OrderAttachment } | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

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

  /** POST + reload; the error shows inline. */
  const post = async (path: string, body: any) => {
    try {
      const token = await getToken();
      const res = await request({ path, method: "POST" }, body, token ?? undefined);
      if (res?.success === false) throw new Error(res?.message || "Could not save");
      await load();
      return true;
    } catch (e: any) {
      setActionError(e?.message || "Could not save");
      return false;
    }
  };

  const uploadAttachment = async (file?: File) => {
    if (!file || !order) return;
    setUploading(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const meta = await uploadFile({ file, folder: `orders/${order.id}`, token });
      await post(`/orders/${order.id}/attachments`, { kind: "file", fileKey: meta.fileKey, fileName: meta.fileName, mimeType: meta.mimeType });
    } catch (e: any) {
      setActionError(e?.message || "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const loadOptions = async (number?: string) => {
    if (!order) return;
    setOptions(null);
    try {
      const token = await getToken();
      const res = await request({ path: `/orders/${order.id}/report-options${number ? `?number=${encodeURIComponent(number)}` : ""}`, method: "GET" }, {}, token ?? undefined);
      setOptions(Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : []);
    } catch {
      setOptions([]);
    }
  };
  const openLink = async () => {
    setReportNo("");
    setLinkOpen(true);
    await loadOptions();
  };

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
            <StatusPill label={orderStatusLabel(order.status)} color={orderStatusColor(order.status)} />
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
                    <StatusPill label={jobStatusLabel(j)} color={jobStatusColor(j)} variant={j.isDraft ? "outlined" : "filled"} />
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
      {actionInfo && (
        <Alert severity="info" sx={{ mt: 2 }} onClose={() => setActionInfo(null)}>
          {actionInfo}
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
                        <StatusPill label={invoiceStatusLabel(inv)} color={inv.status === "paid" ? "success" : inv.status === "pending_payment" ? "info" : "default"} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Box>
      )}

      <Box sx={{ mt: 3 }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }} flexWrap="wrap" useFlexGap>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            Service report
          </Typography>
          <Box sx={{ flex: 1 }} />
          <input ref={fileRef} type="file" accept="application/pdf,image/*" hidden onChange={(e) => void uploadAttachment(e.target.files?.[0])} />
          <Button size="small" variant="outlined" disabled={uploading} onClick={() => fileRef.current?.click()} data-tour="wct-order-upload-report">
            {uploading ? <CircularProgress size={16} /> : "Upload file"}
          </Button>
          <Button size="small" variant="outlined" onClick={() => void openLink()} data-tour="wct-order-link-report">
            Link a service report
          </Button>
        </Stack>
        {!order.attachments?.length ? (
          <Typography variant="body2" color="text.secondary">
            No service report on this order yet. Upload the file, or link a service report written in AIMS.
          </Typography>
        ) : (
          <TableContainer sx={{ border: 1, borderColor: "divider", borderRadius: 1 }}>
            <Table size="small">
              <TableBody>
                {order.attachments.map((a) => (
                  <TableRow
                    key={a.id}
                    hover
                    sx={{ cursor: "pointer" }}
                    onClick={() => (a.kind === "report" ? router.push(`/portal/maintenance-reports/${a.reportId}`) : window.open(publicFileUrl(a.fileKey!), "_blank", "noopener"))}
                  >
                    <TableCell sx={{ fontWeight: 600 }}>{attachmentLine(a).title}</TableCell>
                    <TableCell>{attachmentLine(a).detail}</TableCell>
                    <TableCell padding="checkbox" onClick={(e) => e.stopPropagation()}>
                      <IconButton size="small" aria-label="More actions" onClick={(e) => { e.stopPropagation(); setAttMenu({ pos: { left: e.clientX, top: e.clientY }, att: a }); }}>
                        <MoreVertIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Box>

      <Menu anchorReference="anchorPosition" anchorPosition={attMenu?.pos} open={!!attMenu} onClose={() => setAttMenu(null)}>
        <MenuItem
          sx={{ color: "error.main" }}
          onClick={async () => {
            const a = attMenu!.att;
            setAttMenu(null);
            if (!window.confirm(`Remove "${attachmentLine(a).title}" from this order?`)) return;
            await post(`/orders/${order.id}/attachments/remove`, { id: a.id });
          }}
        >
          Remove from order
        </MenuItem>
      </Menu>

      <Dialog open={linkOpen} onClose={() => setLinkOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Link a service report</DialogTitle>
        <DialogContent>
          <Stack direction="row" spacing={1} sx={{ mt: 1, mb: 1 }}>
            <TextField size="small" label="Report number" value={reportNo} onChange={(e) => setReportNo(e.target.value.replace(/\D/g, ""))} />
            <Button onClick={() => void loadOptions(reportNo)}>Find</Button>
          </Stack>
          {options === null ? (
            <CircularProgress size={20} />
          ) : options.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No service report found. The order&apos;s own jobs have none yet; search by report number.
            </Typography>
          ) : (
            <List dense>
              {options.map((r) => (
                <ListItemButton
                  key={r.id}
                  onClick={async () => {
                    if (await post(`/orders/${order.id}/attachments`, { kind: "report", reportId: r.id })) setLinkOpen(false);
                  }}
                >
                  <ListItemText
                    primary={`Service report ${r.reportNumber ? `#${r.reportNumber}` : "(draft)"}${r.jobNumber ? ` · job #${r.jobNumber}` : ""}`}
                    secondary={`${r.status === "completed" ? "Completed" : "Draft"}${r.technicianName ? ` · ${r.technicianName}` : ""}${r.ofThisOrder ? " · this order" : ""}`}
                  />
                </ListItemButton>
              ))}
            </List>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setLinkOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={invoiceAsk} onClose={() => setInvoiceAsk(false)} fullWidth maxWidth="xs">
        <DialogTitle>Invoice now</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {invoiceNowText(
              order.toInvoice ?? [],
              order.jobs.filter((j) => j.status !== "cancelled" && !j.invoiceId && !(order.toInvoice ?? []).includes(j.deliveryNumber)).length,
              (order.invoices?.length ?? 0) > 0,
            )}
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
                const out = res?.data ?? res;
                // The quotation was already billed and the jobs added nothing on top: no new invoice.
                if (out?.covered) setActionInfo(`No new invoice: nothing was added on top of the quotation, so job${(out.jobNumbers?.length ?? 0) === 1 ? "" : "s"} ${(out.jobNumbers ?? []).map((n: number) => `#${n}`).join(", ")} ${(out.jobNumbers?.length ?? 0) === 1 ? "is" : "are"} covered by ${out.name || "the order's invoice"}.`);
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
