// WCT group orders as the hub (enableWctOrders, 2026-11-13): Quotation -> Order ->
// DO -> Invoice -> Service report. Pure helpers for the orders list (status
// pill, tabs, row menu) and the order page (4-step tracker, next step).
// The manual flow's statuses are the canonical ones; the older WCT statuses
// (WCT Racking / BC Air, not on the manual flow) map onto the same stages.

export type HubStatus =
  | "QUOTATION_SIGNED"
  | "DO_DRAFT"
  | "DO_SCHEDULED"
  | "AWAITING_VERIFICATION"
  | "DO_COMPLETED"
  | "INVOICE_DRAFT"
  | "INVOICED"
  | "PAID"
  | "SERVICE_REPORT_SENT"
  | "CANCELLED";

/** Every status in step order, with its label and its own colour. */
export const HUB_STATUSES: { key: HubStatus; label: string; hue: string }[] = [
  { key: "QUOTATION_SIGNED", label: "Quotation signed", hue: "#6366f1" },
  { key: "DO_DRAFT", label: "DO draft", hue: "#94a3b8" },
  { key: "DO_SCHEDULED", label: "DO scheduled", hue: "#0ea5e9" },
  { key: "AWAITING_VERIFICATION", label: "Awaiting customer signature", hue: "#f59e0b" },
  { key: "DO_COMPLETED", label: "DO completed", hue: "#14b8a6" },
  { key: "INVOICE_DRAFT", label: "Invoice draft", hue: "#f97316" },
  { key: "INVOICED", label: "Invoiced", hue: "#8b5cf6" },
  { key: "PAID", label: "Paid", hue: "#22c55e" },
  { key: "SERVICE_REPORT_SENT", label: "Service report sent", hue: "#15803d" },
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
  const always = new Set<HubStatus>(["DO_DRAFT", "DO_SCHEDULED", "DO_COMPLETED", "INVOICE_DRAFT", "INVOICED", "PAID", "SERVICE_REPORT_SENT"]);
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
  | "resend-report";

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
};

/** Destructive row actions: styled red and confirmed first. */
export const HUB_DESTRUCTIVE = new Set<HubActionKey>(["cancel-job", "cancel-order"]);

/** The row menu (⋮) by status: only what is valid at that step. */
export function hubRowActions(status: string | null | undefined): HubActionKey[] {
  switch (hubStatus(status)) {
    case "QUOTATION_SIGNED":
      return ["view-order", "view-quotation", "add-job", "cancel-order"];
    case "DO_DRAFT":
      return ["view-order", "view-quotation", "view-do", "schedule-do", "add-job", "cancel-order"];
    case "DO_SCHEDULED":
      return ["view-order", "view-do", "complete-do", "reschedule", "cancel-job"];
    case "AWAITING_VERIFICATION":
      return ["view-order", "view-do", "open-job"];
    case "DO_COMPLETED":
      return ["view-signed-do", "create-invoice"];
    case "INVOICE_DRAFT":
      return ["view-invoice", "confirm-invoice", "send-invoice"];
    case "INVOICED":
      return ["view-invoice", "record-payment", "upload-report", "send-report"];
    case "PAID":
      return ["view-invoice", "upload-report", "send-report"];
    case "SERVICE_REPORT_SENT":
      return ["view-order", "resend-report"];
    case "CANCELLED":
      return ["view-order"];
  }
}

/**
 * The order page's ONE primary button (the next step), with an optional second
 * one (Send invoice beside Confirm invoice). null = no button: "Completed" for a
 * finished order, nothing for a cancelled one.
 */
export function hubNextStep(o: { status?: string | null; invoices?: unknown[]; serviceReportReady?: boolean }): { primary: HubActionKey; secondary?: HubActionKey; label?: string } | null {
  switch (hubStatus(o.status)) {
    case "QUOTATION_SIGNED":
      return { primary: "add-job" };
    case "DO_DRAFT":
      return { primary: "schedule-do" };
    case "DO_SCHEDULED":
      return { primary: "complete-do" };
    case "AWAITING_VERIFICATION":
      return { primary: "open-job" };
    case "DO_COMPLETED":
      return (o.invoices?.length ?? 0) > 0 ? { primary: "view-invoice", label: "Open draft invoice" } : { primary: "create-invoice" };
    case "INVOICE_DRAFT":
      return { primary: "confirm-invoice", secondary: "send-invoice" };
    case "INVOICED":
    case "PAID":
      return o.serviceReportReady ? { primary: "send-report" } : { primary: "upload-report" };
    case "SERVICE_REPORT_SENT":
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
}

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
  jobs?: { id?: string; status: string; isDraft?: boolean; deliveryOrder?: { id: string; name?: string | null; tag?: string | null; templateId?: string | null } | null }[];
  invoices?: { id: string; name?: string | null; status?: string | null; type?: string | null; documentTemplateId?: string | null; href?: string | null }[];
  jobReports?: { id: string; reportNumber?: number | null; status: string; uploaded?: boolean; sentAt?: string | null; photosFile?: boolean }[];
}): HubStep[] {
  const idx = hubStatusIndex(order.status);
  const at = (k: HubStatus) => HUB_STATUSES.findIndex((x) => x.key === k);
  const cancelled = hubStatus(order.status) === "CANCELLED";
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
              status: q.status === "confirmed" ? "Signed / accepted" : q.status,
              href: docHref(q.type, q.documentTemplateId, q.id),
              file: q.status === "confirmed" && order.id ? { label: "PDF", path: `/orders/${order.id}/quotation-pdf` } : null,
            },
          ]
        : [],
    },
    {
      key: "do",
      title: "DO",
      done: reached("DO_COMPLETED"),
      current: false,
      date: ymd(d.DO_COMPLETED) ?? ymd(d.DO_SCHEDULED) ?? ymd(d.DO_DRAFT),
      docs: live
        .filter((j) => j.deliveryOrder)
        .map((j) => ({
          label: j.deliveryOrder!.name || "DO",
          status: j.deliveryOrder!.tag ?? null,
          href: docHref("DELIVERY_ORDER", j.deliveryOrder!.templateId, j.deliveryOrder!.id),
          // The signed DO, once the job is finished (the existing "Download signed DO").
          file: j.status === "completed" && j.id ? { label: "PDF" as const, path: `/delivery-group-posts/delivery/${j.id}/signed-do?documentId=${j.deliveryOrder!.id}` } : null,
        })),
    },
    {
      key: "invoice",
      title: "Invoice",
      done: reached("INVOICED"),
      current: false,
      date: ymd(d.PAID) ?? ymd(d.INVOICED) ?? ymd(d.INVOICE_DRAFT),
      docs: (order.invoices ?? []).map((i) => ({ label: i.name || "Invoice", status: invoiceStatusLabel(i.status), href: i.href ?? docHref(i.type || "INVOICE", i.documentTemplateId, i.id) })),
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
  if (!cancelled) {
    const firstOpen = steps.findIndex((s) => !s.done);
    if (firstOpen >= 0) steps[firstOpen].current = true;
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
}

export type HubTarget =
  | { href: string }
  | { dialog: "add-job" | "create-invoice" | "send-report" | "service-report" | "cancel-order" | "cancel-job"; jobId?: string | null }
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
      return job(c.draftJobId, "schedule");
    case "reschedule":
      return job(c.scheduledJobId, "schedule");
    case "complete-do":
      return job(c.scheduledJobId, "complete");
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
  if (t && "dialog" in t && (t.dialog === "add-job" || t.dialog === "create-invoice" || t.dialog === "send-report" || t.dialog === "service-report")) {
    return { href: `/portal/orders/${c.orderId}?open=${t.dialog}` };
  }
  return t;
}
