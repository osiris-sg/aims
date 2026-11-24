"use client";

import { useAppBack } from "@/app/portal/hooks/useAppBack";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { request } from "@/helpers/request";
import { requestFailed } from "@/helpers/requestOutcome";
import { toast } from "react-toastify";
import MainCard from "@/components/MainCard";
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, ListItemText, Menu, MenuItem, Tooltip } from "@mui/material";
import ScheduleDeliveryDialog from "@/app/portal/deliveries/_components/ScheduleDeliveryDialog";
import { addJobPrefill, type OrderAttachment, type PrefillLine } from "@/helpers/wctOrders";
import { uploadFile, publicFileUrl } from "@/helpers/fileUploader";
import SendServiceReportDialog from "@/components/orders/SendServiceReportDialog";
import { OrderDoMenu, useAddDo, type OrderDo } from "./OrderDosSection";
import OfficeCompleteJobDialog from "@/components/delivery/OfficeCompleteJobDialog";
import DoSignLinkDialog from "@/components/delivery/DoSignLinkDialog";
import QuickJobDialog from "@/components/Dashboard/jobs-calendar/QuickJobDialog";
import { linkedToast } from "@/helpers/quickJobQuotation";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";
import { ORDER_FILE_ACCEPT, orderUploadTip, serviceReportFlowHref, serviceReportMenuItems, type ServiceReportPrefill } from "@/helpers/serviceReportFlow";
import { hubActionTarget, type HubActionKey } from "@/helpers/wctOrderHub";
import { invoiceDialogLines, type ImportedLinkType } from "@/helpers/importedOrders";
import { canUnlinkRow, docRowMenu, nativeInvoiceAsk, orderPageModel, type OrderAction, type OrderCard, type OrderDocRow } from "@/helpers/orderPage";
import OrderPageLayout from "./OrderPageLayout";
import { CancelOrderDialog, ConfirmRowDialog, InvoiceLinesDialog, LinkDocumentDialog, MarkCompleteDialog, type InvoiceLineDraft } from "./OrderPageDialogs";

// WCT order page (enableWctOrders). Round 24 (2026-11-19): ONE layout for AIMS (native) and imported orders
// (OrderPageLayout, fed by helpers/orderPage.ts): the numbered tracker cards, the summary row, one actions row
// (Create invoice, Add DO, Add job, Service report, Send service report, Link existing document, Mark complete /
// Reopen, Cancel order where allowed), one Documents table, Left to bill, then Supplier invoices and Photos
// (collapsed). This page owns the data, the dialogs and every call; each action keeps its own gating.
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
  /** Bills only lines added on top of the quotation (2026-11-16). */
  extra?: boolean;
  /** Made from the quotation before any DO was done. */
  fromQuotation?: boolean;
  /** Round 24: the Documents row (gross with GST, owed once confirmed, the invoice date). */
  gross?: number;
  owed?: number | null;
  date?: string | null;
}
export interface WctOrder {
  id: string;
  orderNumber: string;
  status: string;
  createdAt: string;
  customer: { id: string; name: string; customerCode: string | null; address: string | null } | null;
  sourceQuotation: { id: string; name: string; status: string; type: string; documentTemplateId: string; date?: string | null; total?: number | null } | null;
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

type Pos = { left: number; top: number };

/** fixture: /preview/wct-order only (screenshots without sign-in); the page itself always fetches. */
export default function WctOrderDetail({ id, fixture }: { id: string; fixture?: WctOrder | Record<string, any> }) {
  const router = useRouter();
  const { goBack } = useAppBack();
  const { organization } = useOrganization();
  const { getToken } = useAuth();
  const [order, setOrder] = useState<WctOrder | null>((fixture as WctOrder) ?? null);
  const [loading, setLoading] = useState(!fixture);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [invoiceAsk, setInvoiceAsk] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionInfo, setActionInfo] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [sendReportOpen, setSendReportOpen] = useState(false);
  // One "Service report" menu (round 12): New / Upload file (manual flow) or Upload file, and Link existing; at the click.
  const [srMenu, setSrMenu] = useState<{ pos: Pos; doId: string | null } | null>(null);
  // DO first (manual flow, 2026-11-13): complete a DO with no job; its sign link; a DO row's menu.
  const [completeDo, setCompleteDo] = useState<OrderDo | null>(null);
  // "Upload completed DO" (2026-11-23): the same Complete DO dialog, opened on Upload signed DO.
  const [completeMode, setCompleteMode] = useState<"stamped_do" | undefined>(undefined);
  const uploadDo = (d: OrderDo) => {
    setCompleteMode("stamped_do");
    setCompleteDo(d);
  };
  useEffect(() => {
    if (!completeDo) setCompleteMode(undefined);
  }, [completeDo]);
  const [signLinkDo, setSignLinkDo] = useState<OrderDo | null>(null);
  const [doMenu, setDoMenu] = useState<{ pos: Pos; d: OrderDo; row: OrderDocRow } | null>(null);
  // Unlink from order / Delete on a Documents row (Elroy 2026-11-19): asked first, naming the document.
  const [rowAsk, setRowAsk] = useState<{ kind: "unlink" | "delete"; row: OrderDocRow } | null>(null);
  const [rowMenu, setRowMenu] = useState<{ pos: Pos; row: OrderDocRow } | null>(null);
  // Add job = the calendar's New job, with this order's quotation (manual flow + jobs calendar).
  const [jobOpen, setJobOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState<ImportedLinkType | null>(null);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [cancelAsk, setCancelAsk] = useState(false);
  const [invOpen, setInvOpen] = useState(false);
  const [invLines, setInvLines] = useState<InvoiceLineDraft[]>([]);
  // WCT group soft delete of drafts (enableSoftDeleteDrafts): Delete hides the draft, its number stays as a gap.
  const { isJobsCalendarEnabled, isSoftDeleteDraftsEnabled: softDelete, isWctStatusFlowEnabled } = useOrganizationFeatures();

  const load = useCallback(async () => {
    if (fixture || !organization?.id) return;
    try {
      const token = await getToken();
      const res = await request({ path: `/orders/${id}`, method: "GET", ownError: true }, {}, token ?? undefined);
      if (res?.success === false || !res?.data) throw new Error(res?.message || "Order not found");
      setOrder(res.data);
      setError(null);
    } catch (e: any) {
      setError(e?.message || "Failed to load the order");
    } finally {
      setLoading(false);
    }
  }, [organization?.id, getToken, id, fixture]);

  useEffect(() => {
    load();
  }, [load]);

  /** POST; failures show the portal's error toast. Returns the reply, or null when the call failed. */
  const post = async (path: string, body: any = {}, what = "save") => {
    setBusy(what);
    try {
      const token = await getToken();
      const res: any = await request({ path, method: "POST" }, body, token ?? undefined);
      return requestFailed(res) ? null : res;
    } finally {
      setBusy(null);
    }
  };

  const { addDo, adding: addingDo } = useAddDo(id, () => load());
  // Memoised: the dialog re-applies its prefill whenever this object changes.
  const prefill = useMemo(() => (order ? addJobPrefill(order) : null), [order]);

  const o: any = order;
  const liveJobs = (order?.jobs ?? []).filter((j) => j.status !== "cancelled");
  // DO first: the order's DOs; the first one completable on its own (no job, no product line).
  const dos: OrderDo[] = (order as any)?.deliveryOrders ?? [];
  const manualFlow = !!(order as any)?.manualFlow;
  // An order with no DO and no job yet (disableAutoDraftDo, 2026-11-19: signing made no DO) is DO first too.
  const doFirst = manualFlow && (dos.length > 0 || !liveJobs.length);
  const model = useMemo(() => (order ? orderPageModel(order, { jobsCalendar: !!isJobsCalendarEnabled, doFirst, statusFlow: !!isWctStatusFlowEnabled }) : null), [order, isJobsCalendarEnabled, doFirst, isWctStatusFlowEnabled]);
  const imported = o?.imported === true;

  const openSrMenuAtButton = (doId: string | null = null) => {
    const r = typeof document !== "undefined" ? document.querySelector('[data-action="service-report"]')?.getBoundingClientRect() : null;
    setSrMenu({ pos: r ? { left: r.left, top: r.bottom } : { left: window.innerWidth / 2, top: 120 }, doId });
  };

  // Orders list row menu (?open=…): open this page's own dialog once the order is in.
  const openedFromList = React.useRef(false);
  useEffect(() => {
    if (!order || !model || openedFromList.current || typeof window === "undefined") return;
    openedFromList.current = true;
    const open = new URLSearchParams(window.location.search).get("open");
    const act = (k: OrderAction["key"]) => model.actions.find((a) => a.key === k && a.show && !a.disabled);
    if (open === "add-job") {
      const a = act("add-job");
      if (a) runAction(a);
      else setAddOpen(true);
    } else if (open === "create-invoice") {
      const a = act("create-invoice");
      if (a) runAction(a);
    } else if (open === "send-report") setSendReportOpen(true);
    else if (open === "service-report") openSrMenuAtButton();
    else if (open === "complete-do") {
      const d = dos.find((x) => !x.completed);
      if (d) setCompleteDo(d);
    } else if (open === "sign-link") {
      const d = dos.find((x) => x.awaitingSignature && !x.jobs.length) ?? dos.find((x) => !x.completed);
      if (d) setSignLinkDo(d);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order, model]);

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "60vh" }}>
        <CircularProgress />
      </Box>
    );
  }
  if (error || !order || !model) {
    return (
      <MainCard>
        <Alert severity="error">{error || "Order not found"}</Alert>
      </MainCard>
    );
  }

  const q = order.sourceQuotation;
  // Complete DO works on any open DO, with or without a job (the server takes the job's way when it has one).
  const openDo = dos.find((d) => !d.completed) ?? null;
  const awaitingDo = dos.find((d) => d.awaitingSignature && !d.jobs.length) ?? null;

  const addJobForDo = async (d: OrderDo | undefined) => {
    if (!d) return;
    const res: any = await post(`/deliveries/order-dos/${d.id}/job`, {}, "add-job");
    const r = res?.data ?? res;
    if (r?.id) router.push(`/portal/deliveries/${r.id}?open=schedule`);
  };

  const uploadAttachment = async (file?: File) => {
    if (!file) return;
    setUploading(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const meta = await uploadFile({ file, folder: `orders/${order.id}`, token });
      if (await post(`/orders/${order.id}/attachments`, { kind: "file", fileKey: meta.fileKey, fileName: meta.fileName, mimeType: meta.mimeType })) await load();
    } catch (e: any) {
      toast.error(e?.message || "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  // ── Create invoice: AIMS orders = Invoice now / from the quotation, or (round 36) the lines dialog for what is left
  // while the order is billed below its quotation total; imported orders = the lines dialog. The number is always the
  // org's next INV number, given by the server. ──
  const openInvoiceDialog = () => {
    setInvLines(invoiceDialogLines(o));
    setInvOpen(true);
  };
  const createInvoice = async () => {
    const res: any = await post(`/orders/${order.id}/invoice-remaining`, {
      lines: invLines.map((l) => ({ description: l.description.trim(), quantity: Number(l.quantity), unitPrice: Number(l.unitPrice) })),
    }, "create-invoice");
    if (!res || requestFailed(res)) return;
    setInvOpen(false);
    const href = res?.data?.href ?? res?.href;
    if (href) router.push(href);
    else void load();
  };
  const invoiceNow = async () => {
    const res: any = await post(`/orders/${order.id}/invoice-now`, {}, "create-invoice");
    if (!res || requestFailed(res)) return;
    setInvoiceAsk(false);
    const out = res?.data ?? res;
    // The order already has its invoice (made at signing, 2026-11-17): open it, never a second one.
    if (out?.existing && out.href) {
      router.push(out.href);
      return;
    }
    // The quotation was already billed and the jobs added nothing on top: no new invoice.
    if (out?.covered) setActionInfo(`No new invoice: nothing was added on top of the quotation, so job${(out.jobNumbers?.length ?? 0) === 1 ? "" : "s"} ${(out.jobNumbers ?? []).map((n: number) => `#${n}`).join(", ")} ${(out.jobNumbers?.length ?? 0) === 1 ? "is" : "are"} covered by ${out.name || "the order's invoice"}.`);
    await load();
  };

  // ── Imported orders: Mark complete / Reopen ──
  const markComplete = async () => {
    const res: any = await post(`/orders/${order.id}/mark-complete`, { reason: reason.trim() }, "mark-complete");
    if (!res || requestFailed(res)) return;
    setCompleteOpen(false);
    setReason("");
    void load();
  };
  const reopen = async () => {
    const res: any = await post(`/orders/${order.id}/reopen`, {}, "mark-complete");
    if (!res || requestFailed(res)) return;
    void load();
  };

  // ── AIMS orders: Cancel order (where the Orders list allows it) ──
  const cancelOrder = async () => {
    const res: any = await post(`/orders/${order.id}/cancel`, {}, "cancel-order");
    if (!res || requestFailed(res)) return;
    setCancelAsk(false);
    toast.success(`Order ${order.orderNumber} cancelled`);
    void load();
  };

  const rowName = (r: OrderDocRow) => (r.kind === "file" ? r.number : `${r.type} ${r.number}`);
  // Unlink from order: a linked document (unlink-document, same rules on both kinds), or a file (attachments/remove).
  const unlink = async (r: OrderDocRow) => {
    const res: any = r.unlink
      ? await post(`/orders/${order.id}/unlink-document`, { type: r.unlink.type, id: r.unlink.id }, "unlink")
      : r.attachmentId
        ? await post(`/orders/${order.id}/attachments/remove`, { id: r.attachmentId }, "unlink")
        : null;
    if (!res || requestFailed(res)) return;
    setRowAsk(null);
    toast.success(`${rowName(r)} unlinked from ${order.orderNumber}`);
    void load();
  };
  // Delete: an AIMS draft / an unsent service report only (the API refuses anything else; its message shows as the toast).
  const deleteDoc = async (r: OrderDocRow) => {
    if (!r.deletePath) return;
    setBusy("delete");
    try {
      const token = await getToken();
      const res: any = await request({ path: r.deletePath, method: "DELETE" }, {}, token ?? undefined);
      if (!res || requestFailed(res)) return;
      setRowAsk(null);
      toast.success(`${rowName(r)} deleted`);
      void load();
    } finally {
      setBusy(null);
    }
  };
  /** A row's own items (all but the DO menu), each closing the menu first. */
  const rowItems = (r: OrderDocRow, close: () => void) =>
    docRowMenu(r, { manualFlow })
      .filter((k) => k !== "do-menu")
      .map((k) => {
        const go = (fn: () => void) => () => {
          close();
          fn();
        };
        if (k === "open-job") return <MenuItem key={k} onClick={go(() => r.href && router.push(r.href))}>Open job</MenuItem>;
        if (k === "view-do") return <MenuItem key={k} onClick={go(() => r.jobDoHref && router.push(r.jobDoHref))}>View DO</MenuItem>;
        if (k === "open") return <MenuItem key={k} onClick={go(() => openRow(r))}>Open</MenuItem>;
        if (k === "unlink")
          return canUnlinkRow(r) ? (
            <MenuItem key={k} sx={{ color: "error.main" }} onClick={go(() => setRowAsk({ kind: "unlink", row: r }))} data-tour="wct-order-unlink">
              Unlink from order
            </MenuItem>
          ) : (
            <MenuItem key={k} disabled>
              <ListItemText primary="Unlink from order" secondary={r.unlinkBlocked} />
            </MenuItem>
          );
        return (
          <MenuItem key={k} sx={{ color: "error.main" }} onClick={go(() => setRowAsk({ kind: "delete", row: r }))} data-tour="wct-order-delete-draft">
            Delete
          </MenuItem>
        );
      });

  function runAction(a: OrderAction, e?: React.MouseEvent<HTMLElement>) {
    const pos = e ? { left: e.clientX, top: e.clientY } : null;
    switch (a.key) {
      case "create-invoice":
        if (a.mode === "open-draft" && a.href) router.push(a.href);
        else if (imported || a.mode === "remaining") openInvoiceDialog();
        else setInvoiceAsk(true);
        return;
      case "add-do":
        void addDo();
        return;
      case "add-job":
        if (a.mode === "quick") setJobOpen(true);
        else if (a.mode === "do-job") void addJobForDo(openDo ?? undefined);
        else {
          // Prefilled with the quoted lines still to deliver (2026-11-13); empty with a note when nothing is left.
          if (o.prefill?.note) toast.info(`${o.prefill.note} The job starts empty.`);
          setAddOpen(true);
        }
        return;
      case "service-report":
        if (pos) setSrMenu({ pos, doId: null });
        else openSrMenuAtButton();
        return;
      case "send-report":
        setSendReportOpen(true);
        return;
      case "link-document":
        setLinkOpen(model!.linkTypes[0] ?? "SERVICE_REPORT");
        return;
      case "mark-complete":
        if (a.mode === "reopen") void reopen();
        else setCompleteOpen(true);
        return;
      case "cancel-order":
        setCancelAsk(true);
        return;
    }
  }

  // The native next steps that are not in the actions row (Schedule DO, Complete DO, Confirm invoice…), as before.
  const runHub = (key: HubActionKey, pos?: Pos) => {
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
      manualFlow,
      openDoId: openDo?.id ?? null,
      awaitingDoId: awaitingDo?.id ?? null,
    });
    if (!t) return;
    if ("href" in t) router.push(t.href);
    // DO first: Add job makes a job for the order's first open DO (a job always belongs to a DO).
    else if (t.dialog === "add-job") {
      if (doFirst) void addJobForDo(dos.find((d) => !d.completed) ?? dos[0]);
      else setAddOpen(true);
    } else if (t.dialog === "create-invoice") {
      const a = model.actions.find((x) => x.key === "create-invoice" && x.show && !x.disabled);
      if (a) runAction(a);
      else setInvoiceAsk(true);
    }
    else if (t.dialog === "send-report") setSendReportOpen(true);
    else if (t.dialog === "service-report") (pos ? setSrMenu({ pos, doId: null }) : openSrMenuAtButton());
    else if (t.dialog === "complete-do" && openDo) setCompleteDo(openDo);
    else if (t.dialog === "sign-link" && (awaitingDo ?? openDo)) setSignLinkDo((awaitingDo ?? openDo) as OrderDo);
  };

  const onCard = (c: OrderCard, pos: Pos) => {
    const click = c.click;
    if (!click) return;
    if ("href" in click) router.push(click.href);
    else if (click.action === "add-do") void addDo();
    else if (click.action === "service-report") setSrMenu({ pos, doId: null });
    else {
      const a = model.actions.find((x) => x.key === "create-invoice");
      if (a) runAction(a);
    }
  };

  const openRow = (r: OrderDocRow) => {
    if (r.href) router.push(r.href);
    else if (r.fileKey) window.open(publicFileUrl(r.fileKey), "_blank", "noopener");
  };

  // A file from the API: the quotation / invoice PDF (a signed URL back), the signed DO or a photos file (the bytes).
  const openFile = async (r: OrderDocRow) => {
    if (!r.file) return openRow(r);
    // The uploaded signed / stamped DO: the stored file itself (as the DO's attachments open it).
    if (r.file.fileKey) return void window.open(publicFileUrl(r.file.fileKey), "_blank", "noopener");
    const tab = window.open("", "_blank");
    try {
      const token = await getToken();
      const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
      const activeOrg = window.sessionStorage.getItem("aims-admin-active-org");
      if (activeOrg) headers["X-Active-Org-Id"] = activeOrg;
      const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_API_URL}${r.file.path}`, { headers });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message || `Could not open the file (${res.status})`);
      }
      let url: string;
      if ((res.headers.get("content-type") || "").includes("application/json")) {
        const j = await res.json();
        url = (j?.data ?? j)?.url;
        if (!url) throw new Error("The file is not available");
      } else {
        url = URL.createObjectURL(await res.blob());
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
      if (tab) tab.location.href = url;
      else window.open(url, "_blank");
    } catch (e: any) {
      tab?.close();
      toast.error(e?.message || "Could not open the file");
    }
  };

  const onRowMenu = (row: OrderDocRow, pos: Pos) => {
    const items = docRowMenu(row, { manualFlow });
    if (items[0] === "do-menu") {
      const d = dos.find((x) => x.id === row.doId);
      if (d) setDoMenu({ pos, d, row });
      return;
    }
    setRowMenu({ pos, row });
  };

  // The report's customer and DO, prefilled: the order's customer, its last completed DO (else its first DO, a job's DO, a linked DO).
  const srPrefillFor = (doId: string | null): ServiceReportPrefill => ({
    customer: order.customer ? { id: order.customer.id, name: order.customer.name } : null,
    doId:
      doId ??
      ([...dos].reverse().find((d) => d.completed) ?? dos[0])?.id ??
      ([...liveJobs].reverse().find((j) => j.status === "completed" && j.deliveryOrder) ?? liveJobs.find((j) => j.deliveryOrder))?.deliveryOrder?.id ??
      (o.linkedDos ?? []).find((d: any) => d.id)?.id ??
      null,
  });

  return (
    <OrderPageLayout
      model={model}
      onUploadDo={(id) => {
        const d = dos.find((x) => x.id === id);
        if (d) uploadDo(d);
      }}
      onBack={() => goBack("/portal/orders")}
      onAction={(a, e) => runAction(a, e)}
      onNextStep={(k, pos) => runHub(k, pos)}
      onCard={onCard}
      onRow={openRow}
      onRowMenu={onRowMenu}
      onFile={(r) => void openFile(r)}
      busy={{ "add-do": addingDo, "service-report": uploading, "create-invoice": busy === "create-invoice", "mark-complete": busy === "mark-complete", "add-job": busy === "add-job" }}
      photos={!fixture}
      alerts={
        actionInfo ? (
          <Alert severity="info" sx={{ mb: 2 }} onClose={() => setActionInfo(null)}>
            {actionInfo}
          </Alert>
        ) : null
      }
    >
      <input ref={fileRef} type="file" accept={ORDER_FILE_ACCEPT} hidden onChange={(e) => void uploadAttachment(e.target.files?.[0])} />

      <Menu anchorReference="anchorPosition" anchorPosition={rowMenu?.pos} open={!!rowMenu} onClose={() => setRowMenu(null)}>
        {rowMenu ? rowItems(rowMenu.row, () => setRowMenu(null)) : []}
      </Menu>

      <OrderDoMenu
        menu={doMenu}
        onClose={() => setDoMenu(null)}
        cancelled={model.cancelled}
        onCompleteDo={(d) => {
          setCompleteMode(undefined);
          setCompleteDo(d);
        }}
        onUploadDo={uploadDo}
        onSignLink={(d) => setSignLinkDo(d)}
        extra={doMenu ? rowItems(doMenu.row, () => setDoMenu(null)) : []}
      />
      <ConfirmRowDialog
        open={!!rowAsk}
        busy={!!busy}
        title={rowAsk ? (rowAsk.kind === "unlink" ? `Unlink ${rowName(rowAsk.row)} from ${order.orderNumber}?` : `Delete "${rowAsk.row.number}"?`) : ""}
        text={
          rowAsk?.kind === "unlink"
            ? "The document itself stays as it is; only its link to this order goes."
            : softDelete || rowAsk?.row.kind === "report"
              ? "Its number stays as a gap."
              : "This can't be undone."
        }
        confirmLabel={rowAsk?.kind === "unlink" ? "Unlink from order" : "Delete"}
        onClose={() => setRowAsk(null)}
        onConfirm={() => rowAsk && void (rowAsk.kind === "unlink" ? unlink(rowAsk.row) : deleteDoc(rowAsk.row))}
      />

      <Menu anchorReference="anchorPosition" anchorPosition={srMenu?.pos} open={!!srMenu} onClose={() => setSrMenu(null)}>
        {serviceReportMenuItems(manualFlow).map((it) => {
          const item = (
            <MenuItem
              key={it.key}
              data-tour={it.tour}
              onClick={() => {
                const doId = srMenu?.doId ?? null;
                setSrMenu(null);
                // Manual flow: the Service Reports page's own New / Upload flow, customer + DO prefilled.
                if (it.key === "new" || (it.key === "upload" && manualFlow)) router.push(serviceReportFlowHref(it.key, srPrefillFor(doId)));
                // Otherwise Upload file stores the file on the order.
                else if (it.key === "upload") fileRef.current?.click();
                else setLinkOpen("SERVICE_REPORT");
              }}
            >
              {it.label}
            </MenuItem>
          );
          return it.key === "upload" ? (
            <Tooltip key={it.key} title={orderUploadTip(manualFlow)} placement="right">
              {item}
            </Tooltip>
          ) : (
            item
          );
        })}
      </Menu>

      {jobOpen && q && (
        <QuickJobDialog
          open
          withQuotation
          initialQuotationId={q.id}
          onClose={() => setJobOpen(false)}
          onSaved={(_id, r) => {
            setJobOpen(false);
            toast.success(linkedToast(r, q.name));
            void load();
          }}
        />
      )}
      <ScheduleDeliveryDialog open={addOpen} onClose={() => setAddOpen(false)} onCreated={() => void load()} prefill={prefill} />
      {completeDo && (
        <OfficeCompleteJobDialog
          open
          onClose={() => setCompleteDo(null)}
          deliveryId=""
          doId={completeDo.id}
          productSlots={(completeDo.products ?? []).map((p) => ({ assetId: p.assetId, name: p.name, quantity: 1 }))}
          jobLabel={completeDo.name || "the DO"}
          defaultName={order.customer?.name ?? null}
          signCustomer={{ name: order.customer?.name ?? null, email: (order as any).customer?.email ?? null, phone: (order as any).customer?.phone ?? null }}
          initialMode={completeMode}
          onDone={(mode) => {
            const d = completeDo;
            setCompleteDo(null);
            if (mode === "sign_link") setSignLinkDo(d);
            void load();
          }}
        />
      )}
      {/* A DO's Send for signature (2026-11-25): the quotation's sign link, DO version (signing completes the DO). */}
      <DoSignLinkDialog
        open={!!signLinkDo}
        documentId={signLinkDo?.id ?? ""}
        doName={signLinkDo?.name ?? null}
        customer={{ name: order.customer?.name ?? null, email: (order as any).customer?.email ?? null, phone: (order as any).customer?.phone ?? null }}
        onClose={() => {
          setSignLinkDo(null);
          void load();
        }}
      />
      <SendServiceReportDialog
        open={sendReportOpen}
        onClose={() => setSendReportOpen(false)}
        orderId={order.id}
        orderNumber={order.orderNumber}
        defaultEmail={(order as any).customer?.email ?? null}
        onSent={(r) => {
          setActionInfo(`Service report sent to ${r.sentTo.join(", ")}`);
          void load();
        }}
      />
      <LinkDocumentDialog
        open={!!linkOpen}
        onClose={() => setLinkOpen(null)}
        orderId={order.id}
        orderNumber={order.orderNumber}
        types={model.linkTypes}
        initialType={linkOpen ?? "SERVICE_REPORT"}
        onLinked={() => void load()}
      />

      <Dialog open={invoiceAsk} onClose={() => !busy && setInvoiceAsk(false)} fullWidth maxWidth="xs">
        <DialogTitle>Create invoice</DialogTitle>
        <DialogContent>
          <DialogContentText>{nativeInvoiceAsk(order)}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setInvoiceAsk(false)} disabled={!!busy}>
            Cancel
          </Button>
          <Button variant="contained" disableElevation disabled={!!busy} onClick={() => void invoiceNow()}>
            Create invoice
          </Button>
        </DialogActions>
      </Dialog>
      <InvoiceLinesDialog open={invOpen} busy={!!busy} lines={invLines} onLines={setInvLines} onClose={() => setInvOpen(false)} onCreate={() => void createInvoice()} />
      <MarkCompleteDialog open={completeOpen} busy={!!busy} reason={reason} onReason={setReason} onClose={() => setCompleteOpen(false)} onConfirm={() => void markComplete()} />
      <CancelOrderDialog open={cancelAsk} busy={!!busy} orderNumber={order.orderNumber} hasInvoices={(order.invoices ?? []).length > 0} onClose={() => setCancelAsk(false)} onConfirm={() => void cancelOrder()} />
    </OrderPageLayout>
  );
}
