"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { request } from "@/helpers/request";
import { toast } from "react-toastify";
import MainCard from "@/components/MainCard";
import DoStatusTag from "@/components/DoStatusTag";
import StatusPill from "../_components/StatusPill";
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
  Tooltip,
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
import { OrderJobPhotos } from "@/components/delivery/JobPhotos";
import SendServiceReportDialog from "@/components/orders/SendServiceReportDialog";
import OrderHubPanel from "./OrderHubPanel";
import OrderDosSection, { type OrderDo } from "./OrderDosSection";
import OfficeCompleteJobDialog from "@/components/delivery/OfficeCompleteJobDialog";
import CustomerSignLink from "@/components/delivery/CustomerSignLink";
import { serviceReportFlowHref, type ServiceReportPrefill } from "@/helpers/serviceReportFlow";
import { hubActionTarget, hubStatusInfo, type HubActionKey } from "@/helpers/wctOrderHub";

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
  scheduledAllDay?: boolean;
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
  // The supplier invoices tagged to this order's quotation (2026-11-03): job costs, read-only.
  // 2026-11-04: quotations are per SIN line — quotationAmount = this quotation's lines only; total = their sum.
  supplierInvoices?: { rows: Array<{ id: string; billNumber: string; supplierName: string | null; billDate: string | null; quotationAmount?: number; totalAmount: number; currency: string; void: boolean }>; total: number };
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
  const [sendReportOpen, setSendReportOpen] = useState(false);
  // Manual order flow (2026-11-13): "Add service report" = a small Create new / Upload file menu at the click,
  // each going to the Service Reports page's own flow with the customer + DO prefilled (no dialog here).
  const [srMenu, setSrMenu] = useState<{ pos: { left: number; top: number }; doId: string | null } | null>(null);
  const addReportBtn = React.useRef<HTMLButtonElement>(null);
  const openSrMenuAtButton = (doId: string | null = null) => {
    const r = addReportBtn.current?.getBoundingClientRect();
    setSrMenu({ pos: r ? { left: r.left, top: r.bottom } : { left: window.innerWidth / 2, top: 120 }, doId });
  };
  // DO first (manual flow, 2026-11-13): complete a DO with no job; its sign link; a report for one DO.
  const [completeDo, setCompleteDo] = useState<OrderDo | null>(null);
  const [signLinkDo, setSignLinkDo] = useState<OrderDo | null>(null);

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

  // Orders list row menu (?open=…): open this page's own dialog once the order is in.
  const openedFromList = React.useRef(false);
  useEffect(() => {
    if (!order || openedFromList.current || typeof window === "undefined") return;
    openedFromList.current = true;
    const open = new URLSearchParams(window.location.search).get("open");
    if (open === "add-job") setAddOpen(true);
    else if (open === "create-invoice") setInvoiceAsk(true);
    else if (open === "send-report") setSendReportOpen(true);
    else if (open === "service-report") openSrMenuAtButton();
    else if (open === "complete-do") {
      const d = ((order as any).deliveryOrders as OrderDo[] | undefined)?.find((x) => !x.completed);
      if (d) setCompleteDo(d);
    } else if (open === "sign-link") {
      const d = ((order as any).deliveryOrders as OrderDo[] | undefined)?.find((x) => x.awaitingSignature && !x.jobs.length);
      if (d) setSignLinkDo(d);
    }
  }, [order]);

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
  // Service reports: the order's job reports, and the linked / uploaded ones not already among them.
  const jobReports: Array<{ id: string; reportNumber: number | null; status: string; jobNumber: number | null; uploaded: boolean; sentAt: string | null }> = (order as any).jobReports ?? [];
  const jobReportIds = new Set(jobReports.map((r) => r.id));
  const otherAttachments = (order.attachments ?? []).filter((a) => !(a.kind === "report" && a.reportId && jobReportIds.has(a.reportId)));
  const canSendReport =
    jobReports.some((r) => r.status === "completed") || (order.attachments ?? []).some((a: any) => a.kind === "report" && a.report?.status === "completed");
  // Orders hub (2026-11-13): the tracker's next-step button reuses the existing screens and dialogs.
  const liveJobs = order.jobs.filter((j) => j.status !== "cancelled");
  // DO first: the order's DOs; the first one completable on its own (no job, no product line).
  const dos: OrderDo[] = (order as any).deliveryOrders ?? [];
  const doFirst = !!(order as any).manualFlow && dos.length > 0;
  // Complete DO works on any open DO, with or without a job (the server takes the job's way when it has one).
  const openDo = dos.find((d) => !d.completed) ?? null;
  const awaitingDo = dos.find((d) => d.awaitingSignature && !d.jobs.length) ?? null;
  const addJobForDo = async (d: OrderDo) => {
    try {
      const token = await getToken();
      const res: any = await request({ path: `/deliveries/order-dos/${d.id}/job`, method: "POST" }, {}, token ?? undefined);
      if (res?.success === false) throw new Error(res?.message || "Could not add the job");
      const r = res?.data ?? res;
      if (r?.id) router.push(`/portal/deliveries/${r.id}?open=schedule`);
    } catch (e: any) {
      setActionError(e?.message || "Could not add the job");
    }
  };
  const runHub = (key: HubActionKey, pos?: { left: number; top: number }) => {
    const draftInvoice = (order.invoices ?? []).find((i: any) => i.status === "draft" || i.status === "unconfirmed");
    const lastInvoice = (order.invoices ?? []).slice(-1)[0];
    const firstDo = liveJobs.find((j) => j.deliveryOrder)?.deliveryOrder;
    const t = hubActionTarget(key, {
      orderId: order.id,
      quotationHref: q ? `/portal/documents/${q.type}/${q.documentTemplateId}/${q.id}` : null,
      // DO first: View DO opens the order's first open DO (else its last one).
      doHref: doFirst
        ? ((d) => (d?.templateId ? `/portal/documents/DELIVERY_ORDER/${d.templateId}/${d.id}` : null))(dos.find((d) => !d.completed) ?? dos[dos.length - 1])
        : firstDo
          ? `/portal/documents/DELIVERY_ORDER/${(firstDo as any).templateId}/${firstDo.id}`
          : null,
      invoiceHref: ((draftInvoice ?? lastInvoice) as any)?.href ?? null,
      draftJobId: liveJobs.find((j) => j.isDraft)?.id ?? null,
      scheduledJobId: liveJobs.find((j) => !j.isDraft && j.status !== "completed")?.id ?? null,
      completedJobId: [...liveJobs].reverse().find((j) => j.status === "completed")?.id ?? null,
      manualFlow: !!(order as any).manualFlow,
      openDoId: openDo?.id ?? null,
      awaitingDoId: awaitingDo?.id ?? null,
    });
    if (!t) return;
    if ("href" in t) router.push(t.href);
    // DO first: Add job makes a job for the order's first open DO (a job always belongs to a DO).
    else if (t.dialog === "add-job") {
      if (doFirst) void addJobForDo(dos.find((d) => !d.completed) ?? dos[0]);
      else setAddOpen(true);
    } else if (t.dialog === "create-invoice") setInvoiceAsk(true);
    else if (t.dialog === "send-report") setSendReportOpen(true);
    else if (t.dialog === "service-report") (pos ? setSrMenu({ pos, doId: null }) : openSrMenuAtButton());
    else if (t.dialog === "complete-do" && openDo) setCompleteDo(openDo);
    else if (t.dialog === "sign-link" && awaitingDo) setSignLinkDo(awaitingDo);
  };
  // The report's customer and DO, prefilled: the order's customer, the DO of its last finished job (else its first DO).
  const srPrefillFor = (doId: string | null): ServiceReportPrefill => ({
    customer: order.customer ? { id: order.customer.id, name: order.customer.name } : null,
    doId:
      doId ??
      ([...dos].reverse().find((d) => d.completed) ?? dos[0])?.id ??
      ([...liveJobs].reverse().find((j) => j.status === "completed" && j.deliveryOrder) ?? liveJobs.find((j) => j.deliveryOrder))?.deliveryOrder?.id ??
      null,
  });
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
            <StatusPill label={orderStatusLabel(order.status)} color={orderStatusColor(order.status)} hue={hubStatusInfo(order.status).hue} />
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
        {/* Hidden on a cancelled order, and when Add job is already the next-step button below. */}
        {order.status !== "CANCELLED" && order.status !== "QUOTATION_SIGNED" && !doFirst && (
          <Button
            variant="outlined"
            startIcon={<AddIcon />}
            onClick={() => {
              // Prefilled with the quoted lines still to deliver (2026-11-13); empty with a note when nothing is left.
              if ((order as any).prefill?.note) toast.info(`${(order as any).prefill.note} The job starts empty.`);
              setAddOpen(true);
            }}
            data-tour="wct-order-add-job"
          >
            Add job
          </Button>
        )}
      </Stack>

      <OrderHubPanel order={order} serviceReportReady={canSendReport} onAction={runHub} doFirst={doFirst} awaitingDo={!!awaitingDo} />
      {(order as any).manualFlow && (
        <OrderDosSection
          orderId={order.id}
          dos={dos}
          cancelled={order.status === "CANCELLED"}
          onReload={load}
          onCompleteDo={(d) => setCompleteDo(d)}
          onSignLink={(d) => setSignLinkDo(d)}
        />
      )}
      {completeDo && (
        <OfficeCompleteJobDialog
          open
          onClose={() => setCompleteDo(null)}
          deliveryId=""
          doId={completeDo.id}
          productSlots={(completeDo.products ?? []).map((p) => ({ assetId: p.assetId, name: p.name, quantity: 1 }))}
          jobLabel={completeDo.name || "the DO"}
          defaultName={(order as any).customer?.name ?? null}
          onDone={(mode) => {
            const d = completeDo;
            setCompleteDo(null);
            if (mode === "sign_link") setSignLinkDo(d);
            void load();
          }}
        />
      )}
      <Dialog open={!!signLinkDo} onClose={() => setSignLinkDo(null)} fullWidth maxWidth="sm">
        <DialogTitle>Customer sign link</DialogTitle>
        <DialogContent>{signLinkDo && <CustomerSignLink documentId={signLinkDo.id} doName={signLinkDo.name} />}</DialogContent>
        <DialogActions>
          <Button onClick={() => setSignLinkDo(null)}>Close</Button>
        </DialogActions>
      </Dialog>

      <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
        Jobs
      </Typography>
      {order.jobs.length === 0 ? (
        <Alert severity="info">{doFirst ? "No jobs. A job is optional: use Add job in a DO's menu for a date or a technician." : "No jobs yet. Use Add job to schedule the first one."}</Alert>
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
                  <TableCell sx={{ whiteSpace: "nowrap" }}>{fmtJobWhen(j.scheduledFor, j.scheduledAllDay)}</TableCell>
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
            <Button size="small" variant="outlined" disabled={(!order.toInvoice?.length && !(order as any).toInvoiceDos?.length) || invoicing} onClick={() => setInvoiceAsk(true)} data-tour="wct-order-invoice-now">
              Invoice now
            </Button>
          </Stack>
          {!order.invoices?.length ? (
            <Typography variant="body2" color="text.secondary">
              {order.toInvoice?.length
                ? `${order.toInvoice.length} verified job${order.toInvoice.length === 1 ? "" : "s"} not invoiced yet. The order is invoiced automatically once every job is done and verified, or use Invoice now.`
                : (order as any).toInvoiceDos?.length ? `${(order as any).toInvoiceDos.join(", ")} completed, not invoiced yet. The order is invoiced automatically once every DO is completed, or use Invoice now.` : doFirst ? "The order is invoiced once every DO is completed." : "The order is invoiced once every job is done and verified."}
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

      {/* Job photos from SiteClock, one group per job (orgs with the SiteClock link; renders nothing otherwise). */}
      <OrderPhotosSection orderId={order.id} />

      <Box sx={{ mt: 3 }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }} flexWrap="wrap" useFlexGap>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            Service report
          </Typography>
          <Box sx={{ flex: 1 }} />
          {(order as any).manualFlow && (
            <Button ref={addReportBtn} size="small" variant="contained" disableElevation onClick={(e) => setSrMenu({ pos: { left: e.clientX, top: e.clientY }, doId: null })} data-tour="wct-order-add-report">
              Add service report
            </Button>
          )}
          <input ref={fileRef} type="file" accept="application/pdf,image/*" hidden onChange={(e) => void uploadAttachment(e.target.files?.[0])} />
          <Button size="small" variant="outlined" disabled={uploading} onClick={() => fileRef.current?.click()} data-tour="wct-order-upload-report">
            {uploading ? <CircularProgress size={16} /> : "Upload file"}
          </Button>
          <Button size="small" variant="outlined" onClick={() => void openLink()} data-tour="wct-order-link-report">
            Link a service report
          </Button>
          {/* Manual order flow: email the order's service report(s) to the customer. */}
          {(order as any).manualFlow && (
            <Tooltip title={canSendReport ? "" : "Complete or upload a service report first"}>
              <span>
                <Button size="small" variant="contained" disableElevation disabled={!canSendReport} onClick={() => setSendReportOpen(true)} data-tour="wct-order-send-report">
                  Send service report
                </Button>
              </span>
            </Tooltip>
          )}
        </Stack>
        {(order as any).manualFlow && (order as any).statusDates?.serviceReportSentAt && (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
            Sent to the customer on {moment((order as any).statusDates.serviceReportSentAt).format("DD/MM/YYYY HH:mm")}
          </Typography>
        )}
        <SendServiceReportDialog
          open={sendReportOpen}
          onClose={() => setSendReportOpen(false)}
          orderId={order.id}
          orderNumber={(order as any).orderNumber}
          defaultEmail={(order as any).customer?.email ?? null}
          onSent={(r) => {
            setActionInfo(`Service report sent to ${r.sentTo.join(", ")}`);
            void load();
          }}
        />
        {/* The service reports on the order's own jobs (drafts too), each with its status. */}
        {jobReports.length > 0 && (
          <TableContainer sx={{ border: 1, borderColor: "divider", borderRadius: 1, mb: 1 }}>
            <Table size="small">
              <TableBody>
                {jobReports.map((r) => (
                  <TableRow key={r.id} hover sx={{ cursor: "pointer" }} onClick={() => router.push(`/portal/maintenance-reports/${r.id}`)}>
                    <TableCell sx={{ fontWeight: 600 }}>{r.reportNumber ? `Service report #${r.reportNumber}` : "Service report (draft)"}</TableCell>
                    <TableCell>{r.jobNumber ? `Job #${r.jobNumber}` : ""}</TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        variant={r.status === "completed" ? "filled" : "outlined"}
                        color={r.status === "completed" ? "success" : "default"}
                        label={r.status === "completed" ? (r.uploaded ? "Uploaded" : "Completed") : "Draft"}
                      />
                      {r.sentAt && (
                        <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                          Sent {moment(r.sentAt).format("DD/MM/YYYY")}
                        </Typography>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
        {!otherAttachments.length ? (
          jobReports.length ? null : (
          <Typography variant="body2" color="text.secondary">
            No service report on this order yet. Upload the file, or link a service report written in AIMS.
          </Typography>
          )
        ) : (
          <TableContainer sx={{ border: 1, borderColor: "divider", borderRadius: 1 }}>
            <Table size="small">
              <TableBody>
                {otherAttachments.map((a) => (
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

      {/* Supplier invoices tagged with this order's quotation (their Quotation No.): what the job cost. Read-only. */}
      <Box sx={{ mt: 3 }} data-tour="wct-order-supplier-invoices">
        <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
          Supplier invoices
        </Typography>
        {!order.supplierInvoices?.rows?.length ? (
          <Typography variant="body2" color="text.secondary">
            No supplier invoice lines tagged to {order.sourceQuotation?.name || "this order's quotation"} yet. Set the Quotation No. on a supplier invoice's lines to list it here.
          </Typography>
        ) : (
          <TableContainer sx={{ border: 1, borderColor: "divider", borderRadius: 1 }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Invoice #</TableCell>
                  <TableCell>Supplier</TableCell>
                  <TableCell>Date</TableCell>
                  <TableCell align="right">Total</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {order.supplierInvoices.rows.map((b) => (
                  <TableRow key={b.id} hover sx={{ cursor: "pointer", opacity: b.void ? 0.55 : 1 }} onClick={() => router.push(`/portal/accounting/payables/purchase-journal?bill=${b.id}`)}>
                    <TableCell sx={{ fontWeight: 600 }}>
                      {b.billNumber}
                      {b.void ? " (void)" : ""}
                    </TableCell>
                    <TableCell>{b.supplierName || "-"}</TableCell>
                    <TableCell>{b.billDate ? new Date(b.billDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "-"}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums", textDecoration: b.void ? "line-through" : "none" }}>
                      {/* This quotation's lines; the invoice's whole total under it, smaller. */}
                      {b.currency} {(b.quotationAmount ?? b.totalAmount).toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      <Typography component="div" variant="caption" color="text.secondary">
                        of {b.currency} {b.totalAmount.toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell colSpan={3} sx={{ fontWeight: 700 }}>
                    Supplier invoices total
                  </TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                    SGD {order.supplierInvoices.total.toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </TableCell>
                </TableRow>
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

      <Menu anchorReference="anchorPosition" anchorPosition={srMenu?.pos} open={!!srMenu} onClose={() => setSrMenu(null)}>
        <MenuItem
          onClick={() => {
            const doId = srMenu?.doId ?? null;
            setSrMenu(null);
            router.push(serviceReportFlowHref("new", srPrefillFor(doId)));
          }}
        >
          Create new
        </MenuItem>
        <MenuItem
          onClick={() => {
            const doId = srMenu?.doId ?? null;
            setSrMenu(null);
            router.push(serviceReportFlowHref("upload", srPrefillFor(doId)));
          }}
        >
          Upload file
        </MenuItem>
      </Menu>

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

/** The order's "Photos" heading + the per-job photo groups; the whole block hides for orgs without the SiteClock link. */
function OrderPhotosSection({ orderId }: { orderId: string }) {
  const [shown, setShown] = React.useState(true);
  if (!shown) return null;
  return (
    <Box sx={{ mt: 3 }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
        Photos
      </Typography>
      <OrderJobPhotos orderId={orderId} onUnavailable={() => setShown(false)} />
    </Box>
  );
}
