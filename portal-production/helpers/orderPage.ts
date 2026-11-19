// One order page for AIMS (native) and imported orders (WCT group, enableWctOrders; round 24, 2026-11-19).
//
// The order page is ONE layout (app/portal/orders/[id]/OrderPageLayout.tsx) fed by this pure adapter, one reading
// per order kind: the header (number, status, "Imported" tag), the info and money summary rows, the four numbered
// tracker cards (Quotation, Invoice, DO, Service report), the actions row, ONE Documents table, the Left to bill
// table, then Supplier invoices and Photos (collapsed). Both kinds give the same card keys, summary keys, action
// keys and Documents columns; only the values and each action's own gating differ. Pure: tested by orderPage.test.mjs.

import { HUB_ACTION_LABEL, hubNextStep, hubRowActions, hubStatus, hubStatusInfo, hubSteps, type HubActionKey } from "./wctOrderHub";
import { importedBilledPct, importedLinkSourceLabel, importedMoney, importedProgress, importedStatusHue, importedSteps, type ImportedLinkType } from "./importedOrders";
import { invoiceNowText, jobStatusLabel, orderStatusLabel } from "./wctOrders";

export type OrderKind = "native" | "imported";
export type OrderCardKey = "quotation" | "invoice" | "do" | "report";
export type OrderActionKey = "create-invoice" | "add-do" | "add-job" | "service-report" | "send-report" | "link-document" | "mark-complete" | "cancel-order";
export type OrderSummaryKey = "quoteTotal" | "billed" | "billedPct" | "billedQty" | "leftToBill" | "owed";

export const ORDER_CARD_KEYS: OrderCardKey[] = ["quotation", "invoice", "do", "report"];
export const ORDER_SUMMARY_KEYS: OrderSummaryKey[] = ["quoteTotal", "billed", "billedPct", "billedQty", "leftToBill", "owed"];
export const ORDER_ACTION_KEYS: OrderActionKey[] = ["create-invoice", "add-do", "add-job", "service-report", "send-report", "link-document", "mark-complete", "cancel-order"];
export const ORDER_DOC_COLUMNS = ["Document", "Date", "Status", "Linked by", "Amount", "Owed", "File", ""];
export const LEFT_TO_BILL_COLUMNS = ["Item", "Quoted", "Billed", "Left", "Unit price", "Amount"];
/** The page's sections, top to bottom (Supplier invoices and Photos start collapsed). */
export const ORDER_SECTIONS = ["header", "info", "summary", "tracker", "actions", "documents", "leftToBill", "supplierInvoices", "photos"] as const;
const ALL_LINK_TYPES: ImportedLinkType[] = ["QUOTATION", "INVOICE", "DELIVERY_ORDER", "SERVICE_REPORT"];

export interface OrderCardDoc {
  label: string;
  status?: string | null;
  href?: string | null;
}
/** A card's click: its first document, else its add action (nothing for a card with neither). */
export type OrderCardClick = { href: string } | { action: "add-do" | "service-report" | "create-invoice" } | null;
export interface OrderCard {
  key: OrderCardKey;
  title: string;
  done: boolean;
  current: boolean;
  date: string | null;
  note: string | null;
  /** A plain second line (an imported order's ERP DO no.). */
  subNote: string | null;
  docs: OrderCardDoc[];
  /** Shown when the card has no document: "Next" on the current step, else "Not yet". */
  empty: string;
  click: OrderCardClick;
}

export interface OrderField {
  key: string;
  label: string;
  value: string;
  href?: string | null;
}

export type AddJobMode = "quick" | "do-job" | "schedule";
export interface OrderAction {
  key: OrderActionKey;
  label: string;
  show: boolean;
  disabled: boolean;
  /** The next step: contained instead of outlined. */
  primary: boolean;
  /** Why it is greyed out (a tooltip), or null. */
  tip: string | null;
  tour: string;
  /** create-invoice: "create" | "open-draft"; mark-complete: "complete" | "reopen"; add-job: AddJobMode. */
  mode?: string | null;
  href?: string | null;
}

export interface OrderDocFile {
  label: "PDF" | "Photos";
  /** An API path (signed URL or bytes back). */
  path: string;
}
export interface OrderDocRow {
  key: string;
  kind: "quotation" | "invoice" | "creditNote" | "do" | "job" | "report" | "file";
  /** "Quotation", "Invoice", "DO", "Job", "Service report", "File". */
  type: string;
  /** The number (a link when href), or the file name. */
  number: string;
  /** A small line under the number (an imported invoice's ERP DO no.). */
  note?: string | null;
  /** A job under its DO (indented). */
  child?: boolean;
  date: string | null;
  status: string;
  by: string;
  amount: number | null;
  owed: number | null;
  href: string | null;
  file?: OrderDocFile | null;
  /** A file stored on the order (opens from storage). */
  fileKey?: string | null;
  /** The menu: a DO of the order (DO menu), a job (Open job / View DO), Unlink from order, Delete. */
  doId?: string;
  jobId?: string;
  jobDoHref?: string | null;
  /** Unlink from order (unlink-document): what the API takes; null with unlinkBlocked = shown greyed with that reason. */
  unlink?: { type: ImportedLinkType; id: string; name: string } | null;
  unlinkBlocked?: string | null;
  /** A file on the order: Unlink from order = remove it from the order (attachments/remove). */
  attachmentId?: string;
  /**
   * Delete (Elroy 2026-11-19): DELETE /documents/delete/:id on an AIMS draft (status draft / unconfirmed, not imported,
   * nothing paid), DELETE /maintenance-reports/:id on a service report of the order not sent yet. The API has the
   * final say (WCT group: a soft delete, refused for anything sent, confirmed, posted, paid or imported).
   */
  deletePath?: string | null;
}

/** Why a row cannot be unlinked (shown greyed in its menu). */
export const UNLINK_BLOCKED = {
  ownQuotation: "The order's own quotation",
  madeOnOrder: "Made on this order",
  writtenForOrder: "Written for this order",
  withInvoice: "Goes with its invoice",
  // Round 33: a linked DO billed by Create invoice stays while that invoice is live.
  billed: "Billed: void its invoice first",
} as const;

const docDelete = (id: string) => `/documents/delete/${id}`;

/** Delete is offered only on an AIMS draft with nothing paid (Elroy 2026-11-19); imported and finalized documents never. */
export function deletableDraft(d: { status?: string | null; imported?: boolean; erpImport?: unknown; paid?: number | null; cancelled?: boolean }): boolean {
  return isDraftStatus(d.status) && !d.imported && !d.erpImport && !d.cancelled && !(Number(d.paid) > 0.005);
}

export interface LeftToBillLine {
  description: string;
  quotedQty: number | null;
  billedQty: number | null;
  quantity: number;
  unitPrice: number;
  amount: number;
}

export interface OrderPageModel {
  kind: OrderKind;
  id: string;
  number: string;
  statusLabel: string;
  statusHue: string;
  imported: boolean;
  cancelled: boolean;
  manualFlow: boolean;
  info: OrderField[];
  summary: OrderField[];
  /** Beside the summary when there is one: Credited, the Complete mark. */
  extras: OrderField[];
  cards: OrderCard[];
  actions: OrderAction[];
  /** Native only: next steps that are not in the actions row (Schedule DO, Confirm invoice…), same handler as before. */
  nextSteps: Array<{ key: HubActionKey; label: string }>;
  documents: OrderDocRow[];
  leftToBill: LeftToBillLine[];
  supplierInvoices: { rows: any[]; total: number } | null;
  /** Link existing document: the types this order takes (an AIMS order: service reports only, round 24). */
  linkTypes: ImportedLinkType[];
}

export interface OrderPageContext {
  /** enableJobsCalendar: Add job opens the New job dialog with the quotation. */
  jobsCalendar?: boolean;
  /** Native: the page's DO-first reading (manual flow with DOs), passed in so the page keeps one definition. */
  doFirst?: boolean;
}

const linkedBy = (l?: { byName?: string | null } | null) => (l ? ["Linked", l.byName ? `by ${l.byName}` : ""].filter(Boolean).join(" ") : "");
const fmtMoney = (n: number | null | undefined) => (n == null || !Number.isFinite(Number(n)) ? "-" : importedMoney(n));
const orDash = (s: string | null | undefined) => (s && String(s).trim() ? String(s) : "-");
const docHref = (type: string, tpl: string | null | undefined, id: string | null | undefined) => (tpl && id ? `/portal/documents/${type}/${tpl}/${id}` : null);
const isDraftStatus = (s: unknown) => s === "draft" || s === "unconfirmed";

/** Can a service report be emailed (one completed on a job / DO, or a linked completed one)? */
export function serviceReportReady(o: any): boolean {
  return (o.jobReports ?? []).some((r: any) => r.status === "completed") || (o.attachments ?? []).some((a: any) => a.kind === "report" && a.report?.status === "completed");
}

/** How Add job works on this order: the New job dialog, a job on its first open DO, the schedule dialog, or not at all. */
export function addJobMode(o: any, ctx: OrderPageContext = {}): AddJobMode | null {
  if (o.status === "CANCELLED") return null;
  const manual = !!o.manualFlow;
  if (!manual) return "schedule";
  if (ctx.jobsCalendar && o.sourceQuotation) return "quick";
  return (o.deliveryOrders ?? []).some((d: any) => !d.completed) ? "do-job" : null;
}

/** "Current" the same way on both kinds: the quotation first, then Invoice and DO (either order), then the report. */
function markCurrent(cards: OrderCard[], stopped: boolean): OrderCard[] {
  cards.forEach((c) => (c.current = false));
  if (!stopped) {
    const [q, inv, d, r] = cards;
    if (!q.done) q.current = true;
    else if (!inv.done || !d.done) {
      inv.current = !inv.done;
      d.current = !d.done;
    } else if (!r.done) r.current = true;
  }
  cards.forEach((c) => (c.empty = c.current ? "Next" : "Not yet"));
  return cards;
}

const cardClick = (docs: OrderCardDoc[], add: "add-do" | "service-report" | "create-invoice" | null): OrderCardClick => {
  const href = docs.find((d) => d.href)?.href;
  if (href) return { href };
  return add ? { action: add } : null;
};

// ── Documents rows shared by both kinds: the order's DOs (jobs under each), jobs with no DO, service reports, files ──

function doStatusOf(d: any): string {
  if (d.completed) return "Completed";
  if (d.awaitingSignature) return "Awaiting signature";
  return (d.jobs ?? []).some((j: any) => j.isDraft === false) ? "Scheduled" : "Draft";
}

function workRows(o: any): OrderDocRow[] {
  const rows: OrderDocRow[] = [];
  const dos: any[] = o.deliveryOrders ?? [];
  const jobs: any[] = o.jobs ?? [];
  const jobRow = (j: any, child: boolean, doHrefOf: string | null): OrderDocRow => ({
    key: `j:${j.id}`,
    kind: "job",
    type: "Job",
    number: `#${j.deliveryNumber ?? ""}`,
    child,
    date: j.scheduledFor ?? null,
    status: jobStatusLabel(j),
    by: "",
    amount: null,
    owed: null,
    href: `/portal/deliveries/${j.id}`,
    jobId: j.id,
    jobDoHref: doHrefOf,
  });
  for (const d of dos) {
    const href = docHref("DELIVERY_ORDER", d.templateId, d.id);
    const doneJob = (d.jobs ?? []).find((j: any) => j.status === "completed");
    rows.push({
      key: `do:${d.id}`,
      kind: "do",
      type: "DO",
      number: d.name || "DO",
      date: d.date ?? null,
      status: doStatusOf(d),
      by: d.linkedOnly ? linkedBy(d.linked) || "Linked" : "",
      amount: null,
      owed: null,
      href,
      // The signed DO once its job is finished (the existing "Download signed DO").
      file: d.completed && doneJob ? { label: "PDF", path: `/delivery-group-posts/delivery/${doneJob.id}/signed-do?documentId=${d.id}` } : null,
      // Round 29: a DO linked to an AIMS order (Link existing document): Open + Unlink, not the order's DO menu.
      // Round 33: a linked DO billed by Create invoice stays on the order while that invoice is live.
      ...(d.linkedOnly
        ? d.invoiceId
          ? { unlink: null, unlinkBlocked: UNLINK_BLOCKED.billed }
          : { unlink: { type: "DELIVERY_ORDER" as const, id: d.id, name: d.name ?? "the DO" }, unlinkBlocked: null }
        : { doId: d.id, unlink: null, unlinkBlocked: UNLINK_BLOCKED.madeOnOrder }),
      deletePath: !d.completed && deletableDraft({ status: d.status, imported: d.imported === true }) ? docDelete(d.id) : null,
    });
    for (const j of jobs.filter((x) => x.deliveryOrder?.id === d.id)) rows.push(jobRow(j, true, href));
  }
  const doIds = new Set(dos.map((d) => d.id));
  for (const j of jobs.filter((x) => !x.deliveryOrder || !doIds.has(x.deliveryOrder.id))) {
    rows.push(jobRow(j, false, j.deliveryOrder ? docHref("DELIVERY_ORDER", j.deliveryOrder.templateId, j.deliveryOrder.id) : null));
  }
  const jobReports: any[] = o.jobReports ?? [];
  const jobReportIds = new Set(jobReports.map((r) => r.id));
  for (const r of jobReports) {
    rows.push({
      key: `r:${r.id}`,
      kind: "report",
      type: "Service report",
      number: r.reportNumber ? `#${r.reportNumber}` : "(draft)",
      date: r.date ?? null,
      status: r.sentAt ? "Sent" : r.status === "completed" ? (r.uploaded ? "Uploaded" : "Completed") : "Draft",
      by: "",
      amount: null,
      owed: null,
      href: `/portal/maintenance-reports/${r.id}`,
      file: r.photosFile ? { label: "Photos", path: `/maintenance-reports/${r.id}/photos-file` } : null,
      unlink: null,
      unlinkBlocked: UNLINK_BLOCKED.writtenForOrder,
      // A report written for the order, not sent yet (the report page's own Delete rule).
      deletePath: r.sentAt ? null : `/maintenance-reports/${r.id}`,
    });
  }
  for (const a of o.attachments ?? []) {
    const by = a.addedByName ? `Linked by ${a.addedByName}` : "Linked";
    if (a.kind === "report") {
      if (a.reportId && jobReportIds.has(a.reportId)) continue;
      const n = a.report?.reportNumber ?? a.reportNumber ?? null;
      const name = n ? `Service report #${n}` : "Service report";
      rows.push({
        key: `a:${a.id}`,
        kind: "report",
        type: "Service report",
        number: n ? `#${n}` : "(draft)",
        date: a.addedAt ?? null,
        status: a.report ? (a.report.status === "completed" ? "Completed" : "Draft") : "Report not found",
        by,
        amount: null,
        owed: null,
        href: a.reportId ? `/portal/maintenance-reports/${a.reportId}` : null,
        unlink: a.reportId ? { type: "SERVICE_REPORT", id: a.reportId, name } : null,
      });
    } else {
      rows.push({
        key: `a:${a.id}`,
        kind: "file",
        type: "File",
        number: a.label && a.label !== "Service report" ? a.label : a.fileName || "File",
        date: a.addedAt ?? null,
        status: "",
        by: a.addedByName ? `Added by ${a.addedByName}` : "",
        amount: null,
        owed: null,
        href: null,
        fileKey: a.fileKey ?? null,
        attachmentId: a.id,
      });
    }
  }
  return rows;
}

function leftLines(remaining: any): LeftToBillLine[] {
  if (!remaining || !(Number(remaining.remainingGross) > 0)) return [];
  return (remaining.lines ?? [])
    .filter((l: any) => l.priced && Number(l.amount) > 0)
    .map((l: any) => ({ description: String(l.description ?? "").split("\n")[0], quotedQty: l.quotedQty ?? null, billedQty: l.billedQty ?? null, quantity: Number(l.quantity) || 0, unitPrice: Number(l.unitPrice) || 0, amount: Number(l.amount) || 0 }));
}

const billedQtyText = (steps: any, progress: any) => importedSteps(steps) || importedProgress(progress) || "-";

function infoFields(o: any, date: string | null): OrderField[] {
  const q = o.sourceQuotation;
  return [
    { key: "customer", label: "Customer", value: orDash(o.customer?.name) },
    { key: "quotation", label: "Quotation", value: orDash(q?.name), href: q ? docHref(q.type || "QUOTATION", q.templateId ?? q.documentTemplateId, q.id) : null },
    { key: "date", label: "Order date", value: date ? fmtDate(date) : "-" },
    { key: "subject", label: "Subject", value: orDash(o.subject ?? null) },
  ];
}

/** DD/MM/YYYY from an ISO date or yyyy-mm-dd (Singapore calendar day for timestamps). */
export function fmtDate(v: string | null | undefined): string {
  if (!v) return "";
  const s = String(v);
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (ymd) return `${ymd[3]}/${ymd[2]}/${ymd[1]}`;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  const p = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Singapore" }).formatToParts(d);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${get("day")}/${get("month")}/${get("year")}`;
}

// ── AIMS (native) orders ───────────────────────────────────────────────────

/** Map a hub next step onto the actions row (null = not in the row: it gets its own button). */
function rowKeyOf(k: HubActionKey, createMode: string | null | undefined): OrderActionKey | null {
  if (k === "create-invoice") return "create-invoice";
  if (k === "view-invoice" && createMode === "open-draft") return "create-invoice";
  if (k === "add-job") return "add-job";
  if (k === "upload-report") return "service-report";
  if (k === "send-report" || k === "resend-report") return "send-report";
  return null;
}

/** Native Create invoice: what it does now (Invoice now / from the quotation), else the draft to open. */
export function nativeCreateInvoice(o: any): { show: boolean; mode: "create" | "open-draft"; disabled: boolean; fromQuotation: boolean; href: string | null } {
  const cancelled = o.status === "CANCELLED";
  const manual = !!o.manualFlow;
  const invoices: any[] = o.invoices ?? [];
  const fromQuotation = manual && !cancelled && !invoices.length && !o.toInvoice?.length && !o.toInvoiceDos?.length;
  // Manual flow (2026-11-19): "DO completed, invoice pending" always offers Create invoice (a DO with extra lines
  // after the invoice was made first needs a new invoice; the server opens the existing one when nothing is new).
  const doCompleted = manual && hubStatus(o.status) === "DO_COMPLETED";
  const canCreate = !cancelled && (!!o.toInvoice?.length || !!o.toInvoiceDos?.length || fromQuotation || doCompleted);
  const draft = invoices.find((i) => isDraftStatus(i.status) && !i.cancelled);
  if (!canCreate && draft) return { show: !!o.invoicing && !cancelled, mode: "open-draft", disabled: false, fromQuotation, href: draft.href ?? null };
  return { show: !!o.invoicing && !cancelled, mode: "create", disabled: !canCreate, fromQuotation, href: null };
}

/** Native Create invoice's question (Invoice now / from the quotation / completed DOs). */
export function nativeInvoiceAsk(o: any): string {
  const ci = nativeCreateInvoice(o);
  const quoteBilled = (o.invoices ?? []).length > 0;
  if (ci.fromQuotation || o.toInvoice?.length) {
    const openJobs = (o.jobs ?? []).filter((j: any) => j.status !== "cancelled" && !j.invoiceId && !(o.toInvoice ?? []).includes(j.deliveryNumber)).length;
    return invoiceNowText(o.toInvoice ?? [], openJobs, quoteBilled, ci.fromQuotation);
  }
  const dos: string[] = (o.toInvoiceDos ?? []).filter(Boolean);
  // Round 33: linked DOs (Link existing document) are billed with their own lines once the quotation is billed.
  const linked: string[] = (o.toInvoiceLinkedDos ?? []).filter(Boolean);
  if (dos.length) {
    if (quoteBilled && linked.length) {
      const own = dos.filter((d) => !linked.includes(d));
      return own.length
        ? `Create the invoice now for ${dos.join(", ")}? The quotation is already billed on this order: ${linked.join(", ")} ${linked.length === 1 ? "is" : "are"} invoiced with ${linked.length === 1 ? "its" : "their"} own lines, ${own.join(", ")} only for lines added on top of the quotation.`
        : `Create the invoice now for ${linked.join(", ")}? The quotation is already billed on this order, so ${linked.length === 1 ? "the DO's" : "their"} own lines are invoiced as they are on the DO.`;
    }
    return quoteBilled
      ? `Create the invoice now for ${dos.join(", ")}? The quotation is already billed on this order, so only lines added on top of it are invoiced. If there are none, no invoice is made.`
      : `Create the invoice now for ${dos.join(", ")}? It bills the quotation once, plus any lines added on top of it.`;
  }
  return "Create an invoice now for what the completed DOs carry on top of the quotation? When there is nothing new to bill, the order's invoice opens instead.";
}

export function nativeOrderPage(order: any, ctx: OrderPageContext = {}): OrderPageModel {
  // Round 29: an order marked complete reads Complete; its steps, Create invoice and the next steps read the status
  // its documents give underneath (completed.underlying).
  const marked = !!order.completed;
  const o = marked && order.completed?.underlying ? { ...order, status: order.completed.underlying } : order;
  const cancelled = order.status === "CANCELLED";
  const manualFlow = !!o.manualFlow;
  const doFirst = !!ctx.doFirst;
  const dos: any[] = o.deliveryOrders ?? [];
  const invoices: any[] = o.invoices ?? [];
  const ready = serviceReportReady(o);
  const awaitingDo = dos.some((d) => d.awaitingSignature && !(d.jobs ?? []).length);
  const ci = nativeCreateInvoice(o);
  const jobMode = addJobMode(order, ctx);

  const steps = hubSteps(o);
  const byKey = (k: string) => steps.find((s) => s.key === k)!;
  const add: Record<OrderCardKey, "add-do" | "service-report" | "create-invoice" | null> = {
    quotation: null,
    invoice: ci.show && ci.mode === "create" && !ci.disabled ? "create-invoice" : null,
    do: manualFlow && !cancelled ? "add-do" : null,
    report: "service-report",
  };
  const cards = markCurrent(
    ORDER_CARD_KEYS.map((k) => {
      const s = byKey(k);
      const docs = s.docs.map((d) => ({ label: d.label, status: d.status ?? null, href: d.href ?? null }));
      // Linked quotations (round 29) sit with the order's own on the Quotation card.
      if (k === "quotation") for (const x of o.quotations ?? []) docs.push({ label: x.name || "Quotation", status: null, href: docHref(x.type || "QUOTATION", x.templateId ?? x.documentTemplateId, x.id) });
      return { key: k, title: s.title, done: s.done, current: false, date: s.date, note: s.note ?? null, subNote: null, docs, empty: "", click: cardClick(docs, add[k]) };
    }),
    cancelled || marked,
  );

  const s = o.summary ?? null;
  const summary: OrderField[] = [
    { key: "quoteTotal", label: "Quotation total", value: fmtMoney(s?.quoteTotal ?? o.sourceQuotation?.total) },
    { key: "billed", label: "Billed", value: fmtMoney(s?.billed) },
    { key: "billedPct", label: "Billed %", value: importedBilledPct(s?.billedPct) || "-" },
    { key: "billedQty", label: "Billed qty", value: billedQtyText(s?.billingSteps, s?.progress) },
    { key: "leftToBill", label: "Left to bill", value: fmtMoney(s ? s.remaining?.remainingGross ?? 0 : null) },
    { key: "owed", label: "Owed", value: fmtMoney(s?.owed) },
  ];

  // The next step (as before): highlighted in the row, or its own button when it is not a row action.
  const next = cancelled || marked ? null : hubNextStep({ status: o.status, invoices, serviceReportReady: ready, doFirst, awaitingDo, manualFlow });
  const primaryKey = next ? rowKeyOf(next.primary, ci.mode) : null;
  const nextSteps = next
    ? [next.primary, next.secondary]
        .filter((k): k is HubActionKey => !!k && !rowKeyOf(k, ci.mode))
        .map((k) => ({ key: k, label: k === next.primary && next.label ? next.label : HUB_ACTION_LABEL[k] }))
    : [];
  const canCancel = !cancelled && !marked && hubRowActions(o.status, { doFirst }).includes("cancel-order");

  const actions: OrderAction[] = [
    { key: "create-invoice", label: ci.mode === "open-draft" ? "Open draft invoice" : "Create invoice", show: ci.show, disabled: ci.disabled, primary: false, tip: null, tour: "wct-order-create-invoice", mode: ci.mode, href: ci.href },
    { key: "add-do", label: "Add DO", show: manualFlow && !cancelled, disabled: false, primary: false, tip: null, tour: "wct-order-add-do" },
    { key: "add-job", label: "Add job", show: !!jobMode, disabled: false, primary: false, tip: null, tour: "wct-order-add-job", mode: jobMode },
    { key: "service-report", label: "Service report", show: true, disabled: false, primary: false, tip: null, tour: "wct-order-add-report" },
    { key: "send-report", label: "Send service report", show: manualFlow, disabled: !ready, primary: false, tip: ready ? null : "Complete or upload a service report first", tour: "wct-order-send-report" },
    { key: "link-document", label: "Link existing document", show: true, disabled: false, primary: false, tip: null, tour: "wct-order-link-document" },
    // Round 29: an AIMS order takes the Complete mark too (a reason; Reopen removes it); never on a cancelled order.
    { key: "mark-complete", label: marked ? "Reopen" : "Mark complete", show: !cancelled, disabled: false, primary: false, tip: null, tour: "wct-order-mark-complete", mode: marked ? "reopen" : "complete" },
    { key: "cancel-order", label: "Cancel order", show: canCancel, disabled: false, primary: false, tip: null, tour: "wct-order-cancel" },
  ];
  if (primaryKey) actions.forEach((a) => (a.primary = a.key === primaryKey && a.show && !a.disabled));

  const q = o.sourceQuotation;
  const qDoc = byKey("quotation").docs[0];
  const invDocs = byKey("invoice").docs;
  const documents: OrderDocRow[] = [
    ...(q
      ? [
          {
            key: `q:${q.id}`,
            kind: "quotation" as const,
            type: "Quotation",
            number: q.name || "Quotation",
            date: q.date ?? null,
            status: qDoc?.status ?? "",
            by: "",
            amount: q.total ?? null,
            owed: null,
            href: qDoc?.href ?? docHref(q.type || "QUOTATION", q.documentTemplateId, q.id),
            file: qDoc?.file ? { label: qDoc.file.label, path: qDoc.file.path } : null,
            unlink: null,
            unlinkBlocked: UNLINK_BLOCKED.ownQuotation,
          },
        ]
      : []),
    // Round 29: quotations linked to the order (Link existing document).
    ...(o.quotations ?? []).map((x: any) => ({
      key: `lq:${x.id}`,
      kind: "quotation" as const,
      type: "Quotation",
      number: x.name || "Quotation",
      date: x.date ?? null,
      status: x.status === "confirmed" ? "Confirmed" : x.status === "draft" || x.status === "unconfirmed" ? "Draft" : x.status ?? "",
      by: linkedBy(x.linked) || "Linked",
      amount: x.total ?? null,
      owed: null,
      href: docHref(x.type || "QUOTATION", x.templateId ?? x.documentTemplateId, x.id),
      unlink: { type: "QUOTATION" as const, id: x.id, name: x.name ?? "the quotation" },
      unlinkBlocked: null,
      deletePath: deletableDraft({ status: x.status }) ? docDelete(x.id) : null,
    })),
    ...invoices.map((i, n) => ({
      key: `i:${i.id}`,
      kind: "invoice" as const,
      type: "Invoice",
      number: i.name || "Invoice",
      note: i.split ? `Part ${i.split.part} of ${i.split.of}` : null,
      date: i.date ?? null,
      status: invDocs[n]?.status ?? "",
      by: "",
      amount: i.gross ?? i.total ?? null,
      owed: i.owed ?? null,
      href: i.href ?? null,
      file: o.id ? { label: "PDF" as const, path: `/orders/${o.id}/invoice-pdf?documentId=${i.id}` } : null,
      unlink: i.unlinkable ? { type: "INVOICE" as const, id: i.id, name: i.name ?? "the invoice" } : null,
      unlinkBlocked: i.unlinkable ? null : UNLINK_BLOCKED.madeOnOrder,
      deletePath: deletableDraft(i) ? docDelete(i.id) : null,
    })),
    ...workRows(o),
  ];

  return {
    kind: "native",
    id: o.id,
    number: o.orderNumber,
    statusLabel: orderStatusLabel(order.status),
    statusHue: hubStatusInfo(order.status).hue,
    imported: false,
    cancelled,
    manualFlow,
    info: infoFields(o, o.createdAt ?? null),
    summary,
    extras: marked
      ? [{ key: "completed", label: "Marked complete", value: [order.completed.reason, order.completed.byName, order.completed.at ? fmtDate(order.completed.at) : ""].filter(Boolean).join(", ") }]
      : [],
    cards,
    actions,
    nextSteps,
    documents,
    leftToBill: cancelled ? [] : leftLines(s?.remaining),
    supplierInvoices: o.supplierInvoices ?? null,
    // Link existing document on an AIMS order (round 29): quotations, DOs, service reports; invoices on the manual flow.
    linkTypes: manualFlow ? ["QUOTATION", "INVOICE", "DELIVERY_ORDER", "SERVICE_REPORT"] : ["QUOTATION", "DELIVERY_ORDER", "SERVICE_REPORT"],
  };
}

// ── Imported orders ────────────────────────────────────────────────────────

export function importedOrderPage(o: any, ctx: OrderPageContext = {}): OrderPageModel {
  const q = o.sourceQuotation;
  const manualFlow = !!o.manualFlow;
  const ready = serviceReportReady(o);
  const draft = o.draftInvoice ?? null;
  const draftHref = draft?.templateId ? `/portal/documents/INVOICE/${draft.templateId}/${draft.id}` : null;
  const invoices: any[] = o.invoices ?? [];
  const tracker: any[] = o.tracker ?? [];
  const t = (k: string) => tracker.find((s) => s.key === k) ?? {};
  const qDocs: OrderCardDoc[] = [q, ...(o.quotations ?? [])].filter(Boolean).map((x: any) => ({ label: x.name || "Quotation", status: null, href: docHref(x.type || "QUOTATION", x.templateId ?? x.documentTemplateId, x.id) }));
  const invDocs: OrderCardDoc[] = invoices.map((i) => ({ label: i.name || "Invoice", status: i.stateLabel ?? null, href: docHref(i.type || "INVOICE", i.templateId ?? i.documentTemplateId, i.id) }));
  const firstInvDate = invoices.map((i) => i.date).filter(Boolean).sort()[0] ?? null;
  const reportLabel = (l: string) => (l.startsWith("#") ? `Service report ${l}` : l);
  const canCreate = !!o.canInvoice && !draft;
  const doDocs: OrderCardDoc[] = (t("do").docs ?? []).map((d: any) => ({ label: d.label, status: d.status ?? null, href: d.href ?? null }));
  const repDocs: OrderCardDoc[] = (t("serviceReport").docs ?? []).map((d: any) => ({ label: reportLabel(String(d.label)), status: d.status ?? null, href: d.href ?? null }));
  const cards = markCurrent(
    [
      { key: "quotation", title: "Quotation", done: true, current: false, date: q?.date ?? null, note: null, subNote: null, docs: qDocs, empty: "", click: cardClick(qDocs, null) },
      { key: "invoice", title: "Invoice", done: t("invoice").state === "done", current: false, date: firstInvDate, note: t("invoice").note ?? null, subNote: null, docs: invDocs, empty: "", click: cardClick(invDocs, canCreate ? "create-invoice" : null) },
      { key: "do", title: "DO", done: t("do").state === "done", current: false, date: null, note: null, subNote: t("do").subNote ?? null, docs: doDocs, empty: "", click: cardClick(doDocs, manualFlow ? "add-do" : null) },
      { key: "report", title: "Service report", done: t("serviceReport").state === "done", current: false, date: null, note: null, subNote: null, docs: repDocs, empty: "", click: cardClick(repDocs, "service-report") },
    ],
    o.status === "COMPLETED",
  );

  const remainingGross = o.remaining?.remainingGross ?? 0;
  const summary: OrderField[] = [
    { key: "quoteTotal", label: "Quotation total", value: fmtMoney(o.quoteTotal ?? q?.total ?? null) },
    { key: "billed", label: "Billed", value: fmtMoney(o.billed ?? o.total) },
    { key: "billedPct", label: "Billed %", value: importedBilledPct(o.billedPct) || "-" },
    { key: "billedQty", label: "Billed qty", value: billedQtyText(o.billingSteps, o.progress) },
    { key: "leftToBill", label: "Left to bill", value: fmtMoney(remainingGross) },
    { key: "owed", label: "Owed", value: fmtMoney(o.owed) },
  ];
  const extras: OrderField[] = [];
  if (o.credited) extras.push({ key: "credited", label: "Credited", value: fmtMoney(o.credited) });
  if (o.completed) {
    extras.push({
      key: "completed",
      label: o.completed.auto ? "Complete (assumed closed)" : "Marked complete",
      value: [o.completed.reason, o.completed.byName, o.completed.at ? fmtDate(o.completed.at) : ""].filter(Boolean).join(", "),
    });
  }

  const jobMode = addJobMode(o, ctx);
  const nextIsInvoice = !draft && canCreate && ["PART_BILLED", "DO_DRAFT", "DO_COMPLETED"].includes(o.status);
  const actions: OrderAction[] = [
    { key: "create-invoice", label: draft ? `Open draft invoice${draft.name ? ` ${draft.name}` : ""}` : "Create invoice", show: !!draft || !!o.canInvoice, disabled: false, primary: !!draft || nextIsInvoice, tip: null, tour: "wct-order-create-invoice", mode: draft ? "open-draft" : "create", href: draftHref },
    { key: "add-do", label: "Add DO", show: manualFlow, disabled: false, primary: false, tip: null, tour: "wct-order-add-do" },
    { key: "add-job", label: "Add job", show: !!jobMode, disabled: false, primary: false, tip: null, tour: "wct-order-add-job", mode: jobMode },
    { key: "service-report", label: "Service report", show: true, disabled: false, primary: false, tip: null, tour: "wct-order-add-report" },
    { key: "send-report", label: "Send service report", show: manualFlow, disabled: !ready, primary: false, tip: ready ? null : "Complete or upload a service report first", tour: "wct-order-send-report" },
    { key: "link-document", label: "Link existing document", show: !!o.canLink, disabled: false, primary: false, tip: null, tour: "wct-order-link-document" },
    { key: "mark-complete", label: o.canReopen ? "Reopen" : "Mark complete", show: !!o.canComplete || !!o.canReopen, disabled: false, primary: false, tip: null, tour: "wct-order-mark-complete", mode: o.canReopen ? "reopen" : "complete" },
    // Imported orders are never cancelled (the API refuses).
    { key: "cancel-order", label: "Cancel order", show: false, disabled: true, primary: false, tip: null, tour: "wct-order-cancel" },
  ];

  const documents: OrderDocRow[] = [];
  if (q) {
    documents.push({
      key: `q:${q.id}`,
      kind: "quotation",
      type: "Quotation",
      number: q.name || "Quotation",
      date: q.date ?? null,
      status: "Imported",
      by: "",
      amount: q.total ?? null,
      owed: null,
      href: docHref(q.type || "QUOTATION", q.templateId ?? q.documentTemplateId, q.id),
      file: { label: "PDF", path: `/orders/${o.id}/quotation-pdf` },
      unlink: null,
      unlinkBlocked: UNLINK_BLOCKED.ownQuotation,
    });
  }
  for (const x of o.quotations ?? []) {
    documents.push({
      key: `lq:${x.id}`,
      kind: "quotation",
      type: "Quotation",
      number: x.name || "Quotation",
      date: x.date ?? null,
      status: "",
      by: linkedBy(x.linked),
      amount: x.total ?? null,
      owed: null,
      href: docHref(x.type || "QUOTATION", x.templateId ?? x.documentTemplateId, x.id),
      unlink: x.unlinkable ? { type: "QUOTATION", id: x.id, name: x.name ?? "the quotation" } : null,
      unlinkBlocked: x.unlinkable ? null : UNLINK_BLOCKED.madeOnOrder,
      deletePath: deletableDraft({ status: x.status, imported: x.imported === true }) ? docDelete(x.id) : null,
    });
  }
  for (const i of invoices) {
    const state = i.credit && i.state !== "CREDITED" ? `${i.stateLabel ?? ""}, credited ${importedMoney(i.credit)}` : i.stateLabel ?? "";
    documents.push({
      key: `i:${i.id}`,
      kind: "invoice",
      type: "Invoice",
      number: i.name || "Invoice",
      note: [i.split ? `Part ${i.split.part} of ${i.split.of}` : "", i.erpDoNumber ? `ERP DO ${i.erpDoNumber}` : ""].filter(Boolean).join(" · ") || null,
      date: i.date ?? null,
      status: state,
      by: i.linked ? linkedBy(i.linked) : importedLinkSourceLabel(i.linkSource),
      amount: i.total ?? null,
      owed: i.owed ?? null,
      href: docHref(i.type || "INVOICE", i.templateId ?? i.documentTemplateId, i.id),
      file: { label: "PDF", path: `/orders/${o.id}/invoice-pdf?documentId=${i.id}` },
      unlink: i.unlinkable ? { type: "INVOICE", id: i.id, name: i.name ?? "the invoice" } : null,
      unlinkBlocked: i.unlinkable ? null : UNLINK_BLOCKED.madeOnOrder,
      // An ERP invoice never; an AIMS one (made or linked here) while it is a draft with nothing paid.
      deletePath: i.native === true && deletableDraft(i) ? docDelete(i.id) : null,
    });
  }
  for (const c of o.creditNotes ?? []) {
    documents.push({ key: `cn:${c.id}`, kind: "creditNote", type: "Credit note", number: c.name || "Credit note", date: null, status: "", by: "", amount: c.total ?? null, owed: null, href: docHref(c.type || "CREDIT_NOTE", c.templateId ?? c.documentTemplateId, c.id), unlink: null, unlinkBlocked: UNLINK_BLOCKED.withInvoice });
  }
  // The order's AIMS DOs (jobs under each), jobs, service reports and files, as on an AIMS order; then the imported / linked DOs.
  const work = workRows(o);
  const firstNonDo = work.findIndex((r) => r.kind !== "do" && !(r.kind === "job" && r.child));
  const linkedDoRows: OrderDocRow[] = (o.linkedDos ?? []).map((d: any) => ({
    key: `ld:${d.id ?? d.name}`,
    kind: "do" as const,
    type: "DO",
    number: d.name || "DO",
    date: d.date ?? null,
    status: d.done ? "Completed" : "Draft",
    by: d.linked ? linkedBy(d.linked) : d.imported ? "Imported" : "",
    amount: null,
    owed: null,
    href: docHref("DELIVERY_ORDER", d.templateId, d.id),
    unlink: d.unlinkable && d.id ? { type: "DELIVERY_ORDER" as const, id: d.id, name: d.name ?? "the DO" } : null,
    unlinkBlocked: d.unlinkable && d.id ? null : UNLINK_BLOCKED.madeOnOrder,
    deletePath: d.id && !d.done && deletableDraft({ status: d.status, imported: d.imported === true }) ? docDelete(d.id) : null,
  }));
  const cut = firstNonDo < 0 ? work.length : firstNonDo;
  documents.push(...work.slice(0, cut), ...linkedDoRows, ...work.slice(cut));

  return {
    kind: "imported",
    id: o.id,
    number: o.orderNumber,
    statusLabel: o.statusLabel || o.status,
    statusHue: importedStatusHue(o.status),
    imported: true,
    cancelled: false,
    manualFlow,
    info: infoFields(o, q?.date ?? o.createdAt ?? null),
    summary,
    extras,
    cards,
    actions,
    nextSteps: [],
    documents,
    leftToBill: leftLines(o.remaining),
    supplierInvoices: o.supplierInvoices ?? null,
    linkTypes: o.canLink ? ALL_LINK_TYPES : [],
  };
}

/** The page model for either kind (an imported order carries imported: true). */
export function orderPageModel(o: any, ctx: OrderPageContext = {}): OrderPageModel {
  return o?.imported === true ? importedOrderPage(o, ctx) : nativeOrderPage(o, ctx);
}

export type DocRowMenuKey = "do-menu" | "open-job" | "view-do" | "open" | "unlink" | "delete";

/**
 * A Documents row's ⋮ menu items, in order. A job: Open job / View DO. Every document row: its DO menu (an AIMS DO on
 * the manual flow) or Open, then "Unlink from order" (greyed with its reason when the API would refuse it: the order's
 * own quotation, a document made on the order, a report written for it), then "Delete" on an AIMS draft only.
 */
export function docRowMenu(row: OrderDocRow, opts: { manualFlow: boolean }): DocRowMenuKey[] {
  if (row.kind === "job") return row.jobDoHref ? ["open-job", "view-do"] : ["open-job"];
  const out: DocRowMenuKey[] = [];
  if (row.kind === "do" && row.doId && opts.manualFlow) out.push("do-menu");
  else if (row.href || row.fileKey) out.push("open");
  out.push("unlink");
  if (row.deletePath) out.push("delete");
  return out;
}

/** Can "Unlink from order" act on this row (else it shows greyed with row.unlinkBlocked)? */
export const canUnlinkRow = (row: OrderDocRow) => !!row.unlink || !!row.attachmentId;
