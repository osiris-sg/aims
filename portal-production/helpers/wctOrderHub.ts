// WCT group orders as the hub (enableWctOrders, 2026-11-13): Quotation -> Order ->
// DO -> Invoice -> Service report. Pure helpers for the orders list (status
// pill, tabs, row menu) and the order page (4-step tracker, next step).
// The manual flow's statuses are the canonical ones; the older WCT statuses
// (WCT Racking / BC Air, not on the manual flow) map onto the same stages.
// Invoice and DO in either order (2026-11-16): one row, Quotation -> Invoice ->
// DO -> Service report (WCT invoices first), but Invoice and DO each tick on
// their own whichever happens first; the service report comes last.

import { flowDocStatus } from "./wctStatusFlow";

export type HubStatus =
  | "QUOTATION_SIGNED"
  | "DO_DRAFT"
  | "DO_SCHEDULED"
  | "AWAITING_VERIFICATION"
  | "INVOICE_DRAFT_DO_PENDING"
  | "INVOICED_DO_PENDING"
  | "DO_COMPLETED"
  | "INVOICE_DRAFT"
  | "READY_FOR_SERVICE_REPORT"
  | "INVOICED"
  | "PAID"
  | "SERVICE_REPORT_SENT"
  | "MARKED_COMPLETE"
  | "CANCELLED";

/** Every status in step order, with its label and its own colour. */
export const HUB_STATUSES: { key: HubStatus; label: string; hue: string }[] = [
  { key: "QUOTATION_SIGNED", label: "Quotation signed", hue: "#6366f1" },
  { key: "DO_DRAFT", label: "DO draft", hue: "#94a3b8" },
  { key: "DO_SCHEDULED", label: "DO scheduled", hue: "#0ea5e9" },
  { key: "AWAITING_VERIFICATION", label: "Awaiting customer signature", hue: "#f59e0b" },
  { key: "INVOICE_DRAFT_DO_PENDING", label: "Invoice draft, DO pending", hue: "#fb923c" },
  { key: "INVOICED_DO_PENDING", label: "Invoiced, DO pending", hue: "#a855f7" },
  { key: "DO_COMPLETED", label: "DO completed, invoice pending", hue: "#14b8a6" },
  { key: "INVOICE_DRAFT", label: "Invoice draft", hue: "#f97316" },
  { key: "READY_FOR_SERVICE_REPORT", label: "Ready for service report", hue: "#8b5cf6" },
  // Older WCT orders (no manual flow) and manual-flow orders stored before 2026-11-16.
  { key: "INVOICED", label: "Invoiced", hue: "#6d28d9" },
  { key: "PAID", label: "Paid", hue: "#22c55e" },
  { key: "SERVICE_REPORT_SENT", label: "Service report sent", hue: "#15803d" },
  // Marked complete by the office with a reason (round 29); Reopen on the order page derives the status again.
  { key: "MARKED_COMPLETE", label: "Complete", hue: "#64748b" },
  { key: "CANCELLED", label: "Cancelled", hue: "#ef4444" },
];

/** The older WCT order statuses (no manual flow) on the hub's stages. */
const LEGACY: Record<string, HubStatus> = {
  OPEN: "DO_DRAFT",
  SCHEDULED: "DO_SCHEDULED",
  IN_PROGRESS: "DO_SCHEDULED",
  COMPLETED: "DO_COMPLETED",
  CLOSED: "SERVICE_REPORT_SENT",
};

export function hubStatus(status: string | null | undefined): HubStatus {
  const s = String(status || "");
  if (LEGACY[s]) return LEGACY[s];
  return (HUB_STATUSES.find((x) => x.key === s)?.key ?? "QUOTATION_SIGNED") as HubStatus;
}

export const hubStatusInfo = (status: string | null | undefined) => HUB_STATUSES.find((x) => x.key === hubStatus(status))!;
export const hubStatusIndex = (status: string | null | undefined) => HUB_STATUSES.findIndex((x) => x.key === hubStatus(status));

/** Tabs: All, then one per status that has orders or is a main step, with correct counts. */
export function hubTabs(orders: { status?: string | null }[]) {
  const counts = new Map<HubStatus, number>();
  for (const o of orders) counts.set(hubStatus(o.status), (counts.get(hubStatus(o.status)) ?? 0) + 1);
  const always = new Set<HubStatus>(["DO_DRAFT", "DO_SCHEDULED", "INVOICED_DO_PENDING", "DO_COMPLETED", "INVOICE_DRAFT", "READY_FOR_SERVICE_REPORT", "PAID", "SERVICE_REPORT_SENT"]);
  return [
    { key: "all" as const, label: "All", count: orders.length },
    ...HUB_STATUSES.filter((s) => always.has(s.key) || (counts.get(s.key) ?? 0) > 0).map((s) => ({ key: s.key, label: s.label, count: counts.get(s.key) ?? 0 })),
  ];
}

export const hubMatchesTab = (o: { status?: string | null }, tab: HubStatus | "all") => tab === "all" || hubStatus(o.status) === tab;

export type HubActionKey =
  | "view-order"
  | "view-quotation"
  | "view-do"
  | "view-signed-do"
  | "view-invoice"
  | "add-job"
  | "schedule-do"
  | "complete-do"
  | "open-job"
  | "reschedule"
  | "cancel-job"
  | "cancel-order"
  | "create-invoice"
  | "confirm-invoice"
  | "send-invoice"
  | "record-payment"
  | "upload-report"
  | "send-report"
  | "resend-report"
  | "sign-link";

export const HUB_ACTION_LABEL: Record<HubActionKey, string> = {
  "view-order": "View order",
  "view-quotation": "View quotation",
  "view-do": "View DO",
  "view-signed-do": "View signed DO",
  "view-invoice": "View invoice",
  "add-job": "Add job",
  "schedule-do": "Schedule DO",
  "complete-do": "Complete DO",
  "open-job": "Open job",
  reschedule: "Reschedule",
  "cancel-job": "Cancel job",
  "cancel-order": "Cancel order",
  "create-invoice": "Create invoice",
  "confirm-invoice": "Confirm invoice",
  "send-invoice": "Send invoice",
  "record-payment": "Record payment",
  "upload-report": "Add service report",
  "send-report": "Send service report",
  "resend-report": "Resend service report",
  "sign-link": "Send for signature",
};

/** Destructive row actions: styled red and confirmed first. */
export const HUB_DESTRUCTIVE = new Set<HubActionKey>(["cancel-job", "cancel-order"]);

/** The row menu (⋮) by status: only what is valid at that step. */
export function hubRowActions(status: string | null | undefined, opts: { doFirst?: boolean } = {}): HubActionKey[] {
  switch (hubStatus(status)) {
    case "QUOTATION_SIGNED":
      // Manual flow (2026-11-19): signed with no DO yet (disableAutoDraftDo): Create invoice here, Add DO on the order page.
      return opts.doFirst ? ["view-order", "view-quotation", "create-invoice", "cancel-order"] : ["view-order", "view-quotation", "add-job", "cancel-order"];
    case "DO_DRAFT":
      // DO first (manual flow, 2026-11-13): the DO is completed on its own; a job is optional.
      // Invoice first (2026-11-16): the invoice can be made before the DO.
      return opts.doFirst
        ? ["view-order", "view-quotation", "view-do", "complete-do", "sign-link", "create-invoice", "add-job", "cancel-order"]
        : ["view-order", "view-quotation", "view-do", "schedule-do", "add-job", "cancel-order"];
    case "DO_SCHEDULED":
      return opts.doFirst ? ["view-order", "view-do", "complete-do", "sign-link", "create-invoice", "reschedule", "cancel-job"] : ["view-order", "view-do", "complete-do", "reschedule", "cancel-job"];
    case "AWAITING_VERIFICATION":
      return opts.doFirst ? ["view-order", "view-do", "sign-link", "open-job", "create-invoice"] : ["view-order", "view-do", "open-job"];
    case "INVOICE_DRAFT_DO_PENDING":
      // 2026-11-17: an order whose invoices are all drafts can still be cancelled (they are voided with it).
      return ["view-order", "view-do", "complete-do", "sign-link", "view-invoice", "confirm-invoice", "send-invoice", "cancel-order"];
    case "INVOICED_DO_PENDING":
      return ["view-order", "view-do", "complete-do", "sign-link", "view-invoice", "record-payment"];
    case "DO_COMPLETED":
      return ["view-signed-do", "create-invoice"];
    case "INVOICE_DRAFT":
      return ["view-invoice", "confirm-invoice", "send-invoice"];
    case "READY_FOR_SERVICE_REPORT":
    case "INVOICED":
      return ["view-invoice", "record-payment", "upload-report", "send-report"];
    case "PAID":
      return ["view-invoice", "upload-report", "send-report"];
    case "SERVICE_REPORT_SENT":
      return ["view-order", "resend-report"];
    case "MARKED_COMPLETE":
    case "CANCELLED":
      return ["view-order"];
  }
}

/**
 * The order page's ONE primary button (the next step), with an optional second
 * one (Send invoice beside Confirm invoice). null = no button: "Completed" for a
 * finished order, nothing for a cancelled one.
 */
export function hubNextStep(o: { status?: string | null; invoices?: unknown[]; serviceReportReady?: boolean; doFirst?: boolean; awaitingDo?: boolean; manualFlow?: boolean }): { primary: HubActionKey; secondary?: HubActionKey; label?: string } | null {
  switch (hubStatus(o.status)) {
    case "QUOTATION_SIGNED":
      // Manual flow: no DO yet (disableAutoDraftDo, 2026-11-19); "Add DO" sits by the Documents heading.
      return o.doFirst ? { primary: "create-invoice" } : { primary: "add-job" };
    // DO first (2026-11-13): a DO step opens the DO itself, whose toolbar completes it (and adds a job, the sign link,
    // a service report). The order page has no Add job of its own.
    // Invoice first (2026-11-16): after the quotation, BOTH next steps (Create invoice and View DO), in either order.
    // Manual flow (2026-11-17): no "View DO" / "Confirm invoice" next-step buttons; the DO and the invoice are links
    // in the tracker and in Documents (and the draft invoice is made at signing).
    case "DO_DRAFT":
      return o.doFirst ? { primary: "create-invoice" } : { primary: "schedule-do" };
    case "DO_SCHEDULED":
      return o.doFirst ? { primary: "create-invoice" } : { primary: "complete-do" };
    case "AWAITING_VERIFICATION":
      return o.doFirst ? { primary: "create-invoice" } : o.awaitingDo ? { primary: "sign-link" } : { primary: "open-job" };
    case "INVOICE_DRAFT_DO_PENDING":
      return o.doFirst ? null : { primary: "confirm-invoice", secondary: "view-do" };
    case "INVOICED_DO_PENDING":
      return o.doFirst ? null : { primary: "view-do" };
    case "DO_COMPLETED":
      // Manual flow (2026-11-19): always Create invoice (invoice made first + a DO with extra lines completed: the
      // extras need a new invoice; "Open draft invoice" opened the first one).
      if (o.manualFlow) return { primary: "create-invoice" };
      return (o.invoices?.length ?? 0) > 0 ? { primary: "view-invoice", label: "Open draft invoice" } : { primary: "create-invoice" };
    case "INVOICE_DRAFT":
      return o.doFirst ? { primary: "send-invoice" } : { primary: "confirm-invoice", secondary: "send-invoice" };
    case "READY_FOR_SERVICE_REPORT":
    case "INVOICED":
    case "PAID":
      return o.serviceReportReady ? { primary: "send-report" } : { primary: "upload-report" };
    case "SERVICE_REPORT_SENT":
    case "MARKED_COMPLETE":
    case "CANCELLED":
      return null;
  }
}

export interface HubStepDoc {
  label: string;
  status?: string | null;
  href?: string | null;
  /** A file to open (API path): the signed quotation / signed DO PDF, or a report's photos file. */
  file?: { label: "PDF" | "Photos"; path: string } | null;
}
export interface HubStep {
  key: "quotation" | "do" | "invoice" | "report";
  title: string;
  done: boolean;
  current: boolean;
  date: string | null;
  docs: HubStepDoc[];
  /** Invoice and DO: either may be done first. */
  parallel?: boolean;
  /** Split payment (2026-11-17): "2 of 3 sent" under the Invoice step when its invoices are split parts. */
  note?: string | null;
}

/** Statuses where every DO is done / the invoice has gone out (each ticks on its own). */
const DO_DONE = new Set<HubStatus>(["DO_COMPLETED", "INVOICE_DRAFT", "READY_FOR_SERVICE_REPORT", "INVOICED", "PAID", "SERVICE_REPORT_SENT"]);
const INVOICE_DONE = new Set<HubStatus>(["INVOICED_DO_PENDING", "READY_FOR_SERVICE_REPORT", "INVOICED", "PAID", "SERVICE_REPORT_SENT"]);

const ymd = (v: unknown) => (typeof v === "string" && v ? v : null);

/**
 * The order page's 4-step tracker: Quotation -> DO -> Invoice -> Service report,
 * each with its documents (number + status), the date it was reached and a tick
 * once done. Built from the order detail the page already loads.
 */
export function hubSteps(order: {
  id?: string;
  status?: string | null;
  statusDates?: Record<string, string> | null;
  createdAt?: string | null;
  sourceQuotation?: { id: string; name?: string | null; status?: string | null; type?: string | null; documentTemplateId?: string | null } | null;
  /** DO first: the order's DOs with or without a job (the DO step lists these). */
  deliveryOrders?: { id: string; name?: string | null; tag?: string | null; templateId?: string | null; completed?: boolean; awaitingSignature?: boolean; jobs?: { id: string; status: string; isDraft?: boolean }[] }[];
  jobs?: { id?: string; status: string; isDraft?: boolean; deliveryOrder?: { id: string; name?: string | null; tag?: string | null; templateId?: string | null } | null }[];
  invoices?: { id: string; name?: string | null; status?: string | null; type?: string | null; documentTemplateId?: string | null; href?: string | null; extra?: boolean; split?: { part: number; of: number } | null; cancelled?: boolean; edited?: boolean }[];
  jobReports?: { id: string; reportNumber?: number | null; status: string; uploaded?: boolean; sentAt?: string | null; photosFile?: boolean }[];
  /** WCT group wording (enableWctStatusFlow): Pending / Accepted, Draft / Pending / Awaiting Payment / Paid, Draft / Pending / Accepted. */
  statusFlow?: boolean;
}): HubStep[] {
  const flow = order.statusFlow === true;
  const flowInvoice = (i: { status?: string | null; edited?: boolean }) => flowDocStatus({ type: "INVOICE", status: i.status, config: { savedAt: i.edited ? "1" : undefined } })?.label ?? invoiceStatusLabel(i.status);
  const idx = hubStatusIndex(order.status);
  const at = (k: HubStatus) => HUB_STATUSES.findIndex((x) => x.key === k);
  const st = hubStatus(order.status);
  const cancelled = st === "CANCELLED";
  const first = (...keys: string[]) => keys.map((k) => ymd((order.statusDates ?? ({} as any))[k])).find(Boolean) ?? null;
  const d = order.statusDates ?? {};
  const docHref = (type: string | null | undefined, tpl: string | null | undefined, id: string) => (tpl ? `/portal/documents/${type || "QUOTATION"}/${tpl}/${id}` : null);
  const q = order.sourceQuotation;
  const live = (order.jobs ?? []).filter((j) => j.status !== "cancelled");
  const reached = (k: HubStatus) => !cancelled && idx >= at(k);
  const steps: HubStep[] = [
    {
      key: "quotation",
      title: "Quotation",
      done: !!q && (reached("QUOTATION_SIGNED") || cancelled),
      current: false,
      date: ymd(d.QUOTATION_SIGNED) ?? ymd(order.createdAt),
      docs: q
        ? [
            {
              label: q.name || "Quotation",
              status: flow ? (flowDocStatus({ type: "QUOTATION", status: q.status })?.label ?? q.status) : q.status === "confirmed" ? "Signed / accepted" : q.status,
              href: docHref(q.type, q.documentTemplateId, q.id),
              file: q.status === "confirmed" && order.id ? { label: "PDF", path: `/orders/${order.id}/quotation-pdf` } : null,
            },
          ]
        : [],
    },
    {
      key: "invoice",
      title: "Invoice",
      done: !cancelled && INVOICE_DONE.has(st),
      current: false,
      parallel: true,
      date: first("INVOICED_DO_PENDING", "READY_FOR_SERVICE_REPORT", "INVOICED", "PAID") ?? first("INVOICE_DRAFT_DO_PENDING", "INVOICE_DRAFT"),
      docs: (order.invoices ?? []).map((i) => ({
        label: i.name || "Invoice",
        // An invoice for lines added to a DO on top of the quotation (2026-11-16).
        // Voided with the cancelled order (2026-11-17).
        status: i.cancelled ? "Voided" : flow ? (i.extra ? `Extra invoice, ${flowInvoice(i).toLowerCase()}` : flowInvoice(i)) : i.extra ? (i.status === "draft" || i.status === "unconfirmed" ? "Extra invoice draft" : `Extra invoice, ${invoiceStatusLabel(i.status).toLowerCase()}`) : invoiceStatusLabel(i.status),
        href: i.href ?? docHref(i.type || "INVOICE", i.documentTemplateId, i.id),
      })),
    },
    {
      key: "do",
      title: "DO",
      done: !cancelled && DO_DONE.has(st),
      current: false,
      parallel: true,
      date: first("DO_COMPLETED", "INVOICE_DRAFT", "READY_FOR_SERVICE_REPORT", "INVOICED", "PAID") ?? ymd(d.DO_SCHEDULED) ?? ymd(d.DO_DRAFT),
      docs: order.deliveryOrders
        ? order.deliveryOrders.map((d) => {
            const done = (d.jobs ?? []).find((j) => j.status === "completed");
            return {
              label: d.name || "DO",
              // Same words as the order page's Delivery orders section.
              status: flow
                ? d.completed ? "Accepted" : d.awaitingSignature || (d.jobs ?? []).some((j) => j.isDraft === false) ? "Pending" : "Draft"
                : d.completed ? "Completed" : d.awaitingSignature ? "Awaiting signature" : (d.jobs ?? []).some((j) => j.isDraft === false) ? "Scheduled" : "Draft",
              href: docHref("DELIVERY_ORDER", d.templateId, d.id),
              file: d.completed && done ? { label: "PDF" as const, path: `/delivery-group-posts/delivery/${done.id}/signed-do?documentId=${d.id}` } : null,
            };
          })
        : live
        .filter((j) => j.deliveryOrder)
        .map((j) => ({
          label: j.deliveryOrder!.name || "DO",
          status: flow && j.deliveryOrder!.tag === "Completed" ? "Accepted" : j.deliveryOrder!.tag ?? null,
          href: docHref("DELIVERY_ORDER", j.deliveryOrder!.templateId, j.deliveryOrder!.id),
          // The signed DO, once the job is finished (the existing "Download signed DO").
          file: j.status === "completed" && j.id ? { label: "PDF" as const, path: `/delivery-group-posts/delivery/${j.id}/signed-do?documentId=${j.deliveryOrder!.id}` } : null,
        })),
    },
    {
      key: "report",
      title: "Service report",
      done: reached("SERVICE_REPORT_SENT"),
      current: false,
      date: ymd((d as any).serviceReportSentAt) ?? ymd(d.SERVICE_REPORT_SENT),
      docs: (order.jobReports ?? []).map((r) => ({
        label: r.reportNumber ? `Service report #${r.reportNumber}` : "Service report (draft)",
        status: r.sentAt ? "Sent" : r.uploaded ? "Uploaded" : r.status === "completed" ? "Completed" : "Draft",
        href: `/portal/maintenance-reports/${r.id}`,
        file: r.photosFile ? { label: "Photos" as const, path: `/maintenance-reports/${r.id}/photos-file` } : null,
      })),
    },
  ];
  // Split payment: the Invoice step ticks only when every part has gone out (the status says so); it counts them.
  const invs = order.invoices ?? [];
  if (invs.some((i) => i.split)) steps[1].note = `${invs.filter((i) => !["draft", "unconfirmed"].includes(String(i.status ?? ""))).length} of ${invs.length} sent`;
  if (!cancelled) {
    // Quotation first; then Invoice and DO (either order: each is current until it is done); the report once both are.
    if (!steps[0].done) steps[0].current = true;
    else if (!steps[1].done || !steps[2].done) {
      steps[1].current = !steps[1].done;
      steps[2].current = !steps[2].done;
    } else if (!steps[3].done) steps[3].current = true;
  }
  return steps;
}

export function invoiceStatusLabel(s: string | null | undefined): string {
  switch (s) {
    case "draft":
    case "unconfirmed":
      return "Draft";
    case "confirmed":
      return "Confirmed";
    case "pending_payment":
      return "Sent, awaiting payment";
    case "paid":
      return "Paid";
    default:
      return s || "";
  }
}

/** Sort value of a row's status: step order, so sorting by Status walks the flow. */
export const hubStatusSortValue = (status: string | null | undefined) => hubStatusIndex(status);

/** What an order's actions work on (from the list row or the order page). */
export interface HubContext {
  orderId: string;
  quotationHref?: string | null;
  doHref?: string | null;
  invoiceHref?: string | null;
  draftJobId?: string | null;
  scheduledJobId?: string | null;
  completedJobId?: string | null;
  /** Manual order flow: a service report is created or uploaded from the order (customer + DO prefilled). */
  manualFlow?: boolean;
  /** DO first: the first open DO WITHOUT a job (completed on its own, from the order page). */
  openDoId?: string | null;
  /** DO first: a DO with no job waiting for the customer's signature on its link. */
  awaitingDoId?: string | null;
}

export type HubTarget =
  | { href: string }
  | { dialog: "add-job" | "create-invoice" | "send-report" | "service-report" | "cancel-order" | "cancel-job" | "complete-do" | "sign-link"; jobId?: string | null; doId?: string | null }
  | null;

/**
 * Where an action goes. Everything reuses an existing screen or dialog: the job
 * page opens its own schedule / Complete job dialog (?open=…), the order page
 * its Add job / Invoice now / Send service report dialogs. null = nothing to act
 * on (the menu hides it).
 */
export function hubActionTarget(key: HubActionKey, c: HubContext): HubTarget {
  const job = (id: string | null | undefined, open?: string) => (id ? { href: `/portal/deliveries/${id}${open ? `?open=${open}` : ""}` } : null);
  const href = (h: string | null | undefined) => (h ? { href: h } : null);
  switch (key) {
    case "view-order":
      return { href: `/portal/orders/${c.orderId}` };
    case "view-quotation":
      return href(c.quotationHref);
    case "view-do":
    case "view-signed-do":
      return href(c.doHref);
    case "view-invoice":
    case "confirm-invoice":
    case "send-invoice":
    case "record-payment":
      return href(c.invoiceHref);
    case "schedule-do":
      return c.manualFlow && !c.draftJobId ? { dialog: "add-job" } : job(c.draftJobId, "schedule");
    case "reschedule":
      return job(c.scheduledJobId, "schedule");
    case "complete-do":
      // DO first: a DO with no job is completed from the order page; a DO with a job, on its job.
      return c.manualFlow && c.openDoId ? { dialog: "complete-do", doId: c.openDoId } : job(c.scheduledJobId, "complete");
    case "open-job":
      return job(c.scheduledJobId ?? c.completedJobId);
    case "upload-report":
      return c.manualFlow ? { dialog: "service-report" } : job(c.completedJobId, "upload");
    case "cancel-job":
      return c.scheduledJobId ? { dialog: "cancel-job", jobId: c.scheduledJobId } : null;
    case "cancel-order":
      return { dialog: "cancel-order" };
    case "add-job":
      return { dialog: "add-job" };
    case "sign-link":
      // The DO already waiting for its signature, else the open DO (a link can be sent before Complete DO).
      return c.awaitingDoId || c.openDoId ? { dialog: "sign-link", doId: (c.awaitingDoId || c.openDoId) as string } : null;
    case "create-invoice":
      return { dialog: "create-invoice" };
    case "send-report":
    case "resend-report":
      return { dialog: "send-report" };
  }
}

/** On the list, the order page's own dialogs open on the order page (?open=…). */
export function hubListTarget(key: HubActionKey, c: HubContext): HubTarget {
  const t = hubActionTarget(key, c);
  if (t && "dialog" in t && (t.dialog === "add-job" || t.dialog === "create-invoice" || t.dialog === "send-report" || t.dialog === "service-report" || t.dialog === "complete-do" || t.dialog === "sign-link")) {
    return { href: `/portal/orders/${c.orderId}?open=${t.dialog}` };
  }
  return t;
}

/** One row of the order page's Documents list. */
export interface HubDocRow extends HubStepDoc {
  kind: "quotation" | "invoice" | "do" | "job" | "report";
  type: string;
  /** The DO's / job's id, for its row menu and to open it. */
  id?: string;
  /** A job row under its DO (indented). */
  child?: boolean;
}

/**
 * The order page's Documents list. Without `full` (orders off the manual flow):
 * the tracker's documents, as before. With `full` (manual flow, 2026-11-17, the
 * order page's only list): every invoice part with its PDF, every DO followed by
 * its jobs, jobs with no DO, and the service reports.
 */
export function hubDocuments(
  order: Parameters<typeof hubSteps>[0] & {
    jobs?: Array<{ id?: string; deliveryNumber?: number; status: string; isDraft?: boolean; verificationState?: string | null; deliveryOrder?: { id: string } | null }>;
  },
  opts: { full?: boolean; jobLabel?: (j: any) => string } = {},
): HubDocRow[] {
  const steps = hubSteps(order);
  const stepOf = (k: HubStep["key"]) => steps.find((s) => s.key === k)!;
  const quotation = stepOf("quotation").docs.map((d) => ({ kind: "quotation" as const, type: "Quotation", ...d }));
  const reports = stepOf("report").docs.map((d) => ({ kind: "report" as const, type: "Service report", ...d, status: `${d.status}${d.status !== "Draft" ? " · photos on the report" : ""}` }));
  if (!opts.full) {
    return [
      ...quotation,
      ...stepOf("invoice").docs.map((d) => ({ kind: "invoice" as const, type: "Invoice", ...d })),
      ...stepOf("do").docs.map((d) => ({ kind: "do" as const, type: "Delivery order", ...d })),
      ...reports,
    ];
  }
  const invoices = (order.invoices ?? []).map((i, n) => ({
    kind: "invoice" as const,
    type: "Invoice",
    ...stepOf("invoice").docs[n],
    id: i.id,
    file: order.id ? { label: "PDF" as const, path: `/orders/${order.id}/invoice-pdf?documentId=${i.id}` } : null,
  }));
  const jobs = order.jobs ?? [];
  const jobRow = (j: (typeof jobs)[number], child: boolean): HubDocRow => ({
    kind: "job",
    type: "Job",
    id: j.id,
    child,
    label: `#${j.deliveryNumber ?? ""}`,
    status: opts.jobLabel ? opts.jobLabel(j) : j.status,
    href: j.id ? `/portal/deliveries/${j.id}` : null,
  });
  const dos = (order.deliveryOrders ?? []).flatMap((d, n) => [
    { kind: "do" as const, type: "Delivery order", ...stepOf("do").docs[n], id: d.id } as HubDocRow,
    ...jobs.filter((j) => j.deliveryOrder?.id === d.id).map((j) => jobRow(j, true)),
  ]);
  const doIds = new Set((order.deliveryOrders ?? []).map((d) => d.id));
  const loose = jobs.filter((j) => !j.deliveryOrder || !doIds.has(j.deliveryOrder.id)).map((j) => jobRow(j, false));
  return [...quotation, ...invoices, ...dos, ...loose, ...reports];
}
