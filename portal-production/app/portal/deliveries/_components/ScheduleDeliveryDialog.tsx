"use client";

import React, { useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  IconButton,
  InputAdornment,
  MenuItem,
  Stack,
  TextField,
  Typography,
  Step,
  StepLabel,
  Stepper,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import {
  ASSET_CLASS_OPTIONS,
  SERVICE_LINE_CLASS_OPTIONS,
  DEFAULT_ASSET_CLASS,
  normalizeAssetClass,
  type AssetClass,
} from "@/helpers/assetClass";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import SearchIcon from "@mui/icons-material/Search";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import RequestQuoteIcon from "@mui/icons-material/RequestQuote";
import HandshakeIcon from "@mui/icons-material/Handshake";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import { request } from "@/helpers/request";
import SaleOrderSelectDialog, { SaleOrderRow, toSaleOrderRow } from "./SaleOrderSelectDialog";
import DocumentUploadDialog from "@/app/portal/components/DocumentUploadDialog";
import ProjectContactPicker, { ContactLite, ContactAssignment } from "@/app/portal/projects/components/ProjectContactPicker";
import { useOrganization } from "@hooks/useOrganization";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";
import { runWords } from "@/helpers/jobWording";
import { ACTIVE_ORG_KEY } from "@/helpers/multiOrg";
import ExtractQuotationDialog from "@/containers/DocumentTemplates/components/ExtractQuotationDialog";
import SiteClockSchedulePicker, { SiteClockPick } from "./SiteClockSchedulePicker";
import type { AddJobPrefill } from "@/helpers/wctOrders";
import JobFieldsEditor from "@/components/jobFields/JobFieldsEditor";
import { JobFieldDef, jobFieldProblem } from "@/helpers/jobFields";
import { DatePicker } from "@mui/x-date-pickers/DatePicker";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import dayjs from "dayjs";
import JobDayPreview, { SlotHintsAlert, SplitIf, SPLIT_PAPER_SX } from "@/components/Dashboard/jobs-calendar/JobDayPreview";

/**
 * Office "Schedule a delivery" dialog. Field order (top→bottom): CUSTOMER →
 * PROJECT → ADDRESS → products (asset + qty) → scheduled date + time (LAST).
 * Customer & project are REQUIRED (the rider is matched back to this run by the
 * project they assign in the field). The address auto-fills from the project's
 * site office (falling back to the customer) but stays freely editable, and
 * lands on the draft DO's "Deliver To". A quotation can be extracted (after the
 * customer is chosen) to autofill project / address / line items.
 */

interface AssetOption { id: string; name: string; skuKey: string }
interface CustomerOption { id: string; name: string; customerCode: string | null; address: string | null }
interface ProjectOption { id: string; name: string }
// quantity is a RAW STRING so the field is freely typeable; clamped on blur/submit.
// A row is EITHER a catalog product (asset set) OR free-typed (asset null +
// description). quantity is shared.
// assetClass applies to free-typed rows only — a catalog row reads its class
// off the picked asset.
interface Row { asset: AssetOption | null; description: string; freeTyped: boolean; quantity: string; assetClass: AssetClass }

// What a schedule may be based on (enableScheduleWizard). Mirrors the backend's
// src/deliveries/schedule-source.ts — keep the two in step.
//   QUOTATION   — an existing confirmed quotation. Chosen, never uploaded:
//                 quotations are raised in AIMS (guru 2026-11-24).
//   SALES_ORDER — the customer PO. Chosen from the list, or uploaded and read
//                 by the extractor (which mints the SALES_ORDER document).
//   CONTRACT    — a master contract. An uploaded FILE only: no document, no
//                 list, nothing to point at, which is why this is one shape
//                 with optional fields rather than three typed pointers.
type ScheduleSourceKind = "QUOTATION" | "SALES_ORDER" | "CONTRACT";
interface ScheduleSource {
  kind: ScheduleSourceKind;
  documentId?: string;
  number?: string;
  fileName?: string;
  fileUrl?: string;
}

/** The paperwork step's three cards, in the order guru asked for them. */
const SOURCE_CHOICES: Array<{ kind: ScheduleSourceKind; title: string; blurb: string; icon: React.ReactNode }> = [
  {
    kind: "QUOTATION",
    title: "Quotation",
    blurb: "A confirmed quotation of this customer's. Fills the project, address and line items.",
    icon: <RequestQuoteIcon />,
  },
  {
    kind: "SALES_ORDER",
    title: "Sales Order (customer PO)",
    blurb: "Pick one, or upload the customer's PO and let AIMS read it. Fills the same fields.",
    icon: <ReceiptLongIcon />,
  },
  {
    kind: "CONTRACT",
    title: "Master contract",
    blurb: "A standing agreement. The file is kept with this delivery; the rest is filled in by hand.",
    icon: <HandshakeIcon />,
  },
];

// Quotation descriptions are rich text (the editor stores HTML like
// "<b>100-Ton Excavator</b><div><i>Note: …</i></div>"). Convert to plain text
// for the free-typed field and any text search: block boundaries → \n, tags
// stripped, entities decoded, blank lines dropped. Never let raw markup leak into
// the field or a search query (it matches nothing).
function htmlToText(input: unknown): string {
  const raw = String(input ?? "");
  if (!raw) return "";
  if (!/[<&]/.test(raw)) return raw.trim(); // plain already
  let s = raw
    .replace(/<\s*(br|hr)\s*\/?\s*>/gi, "\n")
    .replace(/<\/\s*(div|p|li|tr|h[1-6])\s*>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, ""); // strip remaining tags
  if (typeof document !== "undefined") {
    const el = document.createElement("textarea");
    el.innerHTML = s;
    s = el.value; // decode entities via the DOM
  } else {
    s = s
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'");
  }
  return s
    .split("\n")
    .map((line) => line.replace(/[^\S\n]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

// A still-scheduled run to edit (prefill + PATCH instead of create). Shape mirrors
// the run detail's findById payload.
interface EditRun {
  id: string;
  customer: { id: string; name: string; customerCode?: string | null } | null;
  project: { id: string; name: string } | null;
  siteAddress: string | null;
  scheduledFor: string | null;
  /** All-day job (2026-11-10): the date only, no specific time. */
  scheduledAllDay?: boolean;
  document: {
    poNo?: string | null;
    saleOrderId?: string | null;
    machineLocation?: string | null;
  } | null;
  items: Array<{ asset: { id: string; name: string; skuKey: string } | null; quantity: number; description: string | null; assetClass?: string | null }>;
  // SiteClock link (enableSiteClockLink orgs): the worker this run is scheduled on.
  siteclock?: { workerId: string | null; workerName: string | null; durationMin: number } | null;
  // Custom job fields (enableJobFields): this run's values ({ fieldId: value }).
  jobFieldValues?: Record<string, any> | null;
}

export default function ScheduleDeliveryDialog({
  open,
  onClose,
  onCreated,
  editRun,
  prefill,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  editRun?: EditRun | null;
  // WCT orders "Add job" (enableWctOrders): a NEW job of this order, the form
  // pre-filled with its customer, site and quotation lines. Create mode only.
  prefill?: AddJobPrefill | null;
}) {
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const { isQuotationToDeliveryEnabled, isSiteClockLinkEnabled, isJobFieldsEnabled, isWctOrdersEnabled, isManualOrderFlowEnabled, isOptionalSaleOrderEnabled, isJobsCalendarEnabled, isOfficeDoEditsEnabled, isScheduleWizardEnabled } = useOrganizationFeatures();
  // Round 39 #8 (WCT group: WCT orders + the jobs calendar): a large dialog, the form on the left and the day's jobs on
  // the right. Every other org keeps the old dialog.
  const split = !!isWctOrdersEnabled && !!isJobsCalendarEnabled;
  const [slotHintLines, setSlotHintLines] = useState<string[]>([]);
  // WCT reads "job" (helpers/jobWording.ts).
  const w = runWords(!!isWctOrdersEnabled);
  // Custom job fields (enableJobFields): the org's fields + this job's values.
  const [jobFieldDefs, setJobFieldDefs] = useState<JobFieldDef[]>([]);
  const [jobFieldValues, setJobFieldValues] = useState<Record<string, any>>({});
  // Service-job org (enableQuotationToDelivery — WCT 2026-10-27): a run is a job
  // from an accepted quotation, not a rental deployment. No Project and no Sales
  // Order sections at all (the backend relaxes the same two rules under the same
  // flag), the address comes from the customer, and a free-typed line is
  // Equipment or SERVICE (work done on site) rather than Equipment or Accessory.
  const serviceJobs = isQuotationToDeliveryEnabled;
  const newFreeClass: AssetClass = serviceJobs ? "SERVICE" : DEFAULT_ASSET_CLASS;
  const freeClassOptions = serviceJobs ? SERVICE_LINE_CLASS_OPTIONS : ASSET_CLASS_OPTIONS;
  const theme = useTheme();
  // Phone: this long form goes full-screen below sm
  const fullScreenDialog = useMediaQuery(theme.breakpoints.down("sm"));

  const [rows, setRows] = useState<Row[]>([{ asset: null, description: "", freeTyped: false, quantity: "1", assetClass: DEFAULT_ASSET_CLASS }]);
  // Date + time are held separately so BOTH are independently settable (a single
  // datetime-local left the time portion effectively uneditable for the office).
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("09:00");
  // "No specific time" (all-day job, 2026-11-10): the date only. Off by default.
  const [allDay, setAllDay] = useState(false);
  // SiteClock link (WCT): worker + job length. Sent only when the org's link is
  // live (scLive), so a form that couldn't load SiteClock never clears a pick.
  const [scPick, setScPick] = useState<SiteClockPick>({ workerId: null, workerName: null, durationMin: null });
  const [scLive, setScLive] = useState(false);
  // The PO is no longer typed — it comes from a selected Sales Order (a Document
  // of type SALES_ORDER). poNumber stays as the DISPLAY string written to
  // config.poNo; saleOrder carries the pointer written to config.saleOrderId.
  const [poNumber, setPoNumber] = useState("");
  const [saleOrder, setSaleOrder] = useState<SaleOrderRow | null>(null);
  const [soRows, setSoRows] = useState<SaleOrderRow[]>([]);
  const [soOpen, setSoOpen] = useState(false);
  const [soLoading, setSoLoading] = useState(false);
  const [soUploadOpen, setSoUploadOpen] = useState(false);
  // Raw /documents/paginated rows for the Sales Orders above, keyed by id.
  const soDocsRef = useRef<Map<string, any>>(new Map());
  const [poTouched, setPoTouched] = useState(false);
  const [address, setAddress] = useState("");
  // Once the user edits the address, stop auto-overwriting it on project change.
  const [addressTouched, setAddressTouched] = useState(false);
  // Machine location — free-text sub-location (tower/floor/unit) under the address.
  const [machineLocation, setMachineLocation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // Asset search (shared list; each row's Autocomplete filters against it).
  const [assetOptions, setAssetOptions] = useState<AssetOption[]>([]);
  const [assetInput, setAssetInput] = useState("");
  const [assetSearching, setAssetSearching] = useState(false);

  // Customer -> project.
  const [customerOptions, setCustomerOptions] = useState<CustomerOption[]>([]);
  const [customer, setCustomer] = useState<CustomerOption | null>(null);
  const [customerInput, setCustomerInput] = useState("");
  const [customerSearching, setCustomerSearching] = useState(false);
  const [projectOptions, setProjectOptions] = useState<ProjectOption[]>([]);
  // Customer id the project list was last loaded for. undefined until the
  // effect below has run for this opening of the dialog.
  const loadedForCustomerRef = useRef<string | null | undefined>(undefined);
  const [project, setProject] = useState<ProjectOption | null>(null);
  // OSI-84 — the chosen project's contact people (as ids). Loaded when a project
  // is picked; edits are persisted straight to the project (PUT), since the
  // project already exists here.
  const [projectContacts, setProjectContacts] = useState<ContactAssignment[]>([]);
  // Whether this project has a DO contact and an Invoice contact. Read from
  // GET /customer-info/project/:id, which already buckets the SAME ProjectContact
  // rows into { DO, INVOICE, UNGROUPED } — no new endpoint needed.
  const [contactCoverage, setContactCoverage] = useState<{ DO: number; INVOICE: number; UNGROUPED: number } | null>(null);
  // Customer-information link for this project, minted from here.
  const [ciLink, setCiLink] = useState<string | null>(null);
  // The DO's Attention is derived server-side from the project's FIRST contact
  // (primary-first, else earliest-attached) — the office picks contacts via the
  // ProjectContactPicker below, no free-text snapshot here.
  // Inline create (customers:create-by-name / projects:create-by-name) so a new
  // customer or project can be minted without leaving the dialog.
  const [createCustomerOpen, setCreateCustomerOpen] = useState(false);
  const [createCustomerName, setCreateCustomerName] = useState("");
  const [creatingCustomer, setCreatingCustomer] = useState(false);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [createProjectName, setCreateProjectName] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);

  // Quotation extraction (opened after a customer is chosen).
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [quotations, setQuotations] = useState<any[]>([]);
  const [quoteLoading, setQuoteLoading] = useState(false);

  // ── STEPPED SCHEDULE (enableScheduleWizard, Biofuel 2026-11-24) ────────────
  // The one long form becomes five steps: Customer -> Paperwork -> Site &
  // contacts -> Products -> Schedule.
  //
  // CREATE ONLY. An edit already has its paperwork behind it, and walking five
  // steps to move a time would be worse than the form this replaces. "Add job"
  // (WCT orders) is create-mode too, but it arrives pre-filled from its order
  // and belongs to a different org's flow, so it keeps the flat form as well.
  const wizard = !!isScheduleWizardEnabled && !editRun && !prefill;
  const [activeStep, setActiveStep] = useState(0);
  // WHAT this schedule is based on. The point of the whole wizard: a run never
  // goes out with nothing behind it. Sent as dto.scheduleSource, and the
  // backend enforces the same rule, so a stale tab cannot schedule around it.
  const [source, setSource] = useState<ScheduleSource | null>(null);
  // Which of the three she is filling in. Null until she chooses, so the step
  // opens as a question rather than three half-forms at once.
  const [sourceKind, setSourceKind] = useState<ScheduleSourceKind | null>(null);
  const [contractBusy, setContractBusy] = useState(false);
  const contractInputRef = useRef<HTMLInputElement | null>(null);
  // A project the applied document implies but the org does not have yet. Held
  // as a SUGGESTION and never created behind her back: step 3 shows the name,
  // editable, with a Create button (guru 2026-11-24 — "ask her to confirm").
  const [projectSuggestion, setProjectSuggestion] = useState<string | null>(null);

  // Reset on (re)open — or PREFILL from the run being edited.
  useEffect(() => {
    if (!open || !isJobFieldsEnabled) return;
    setJobFieldValues(editRun?.jobFieldValues ? { ...editRun.jobFieldValues } : {});
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        const res = await request({ path: "/job-fields", method: "GET" }, {}, token ?? undefined);
        const body = res?.data ?? res;
        if (!cancelled) setJobFieldDefs(Array.isArray(body?.fields) ? body.fields : []);
      } catch {
        if (!cancelled) setJobFieldDefs([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, isJobFieldsEnabled, editRun, getToken]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setNote(null);
    setCustomerInput("");
    setAssetInput("");
    setQuotations([]);
    // Stepped schedule: back to step 1 with nothing chosen on every opening.
    setActiveStep(0);
    setSource(null);
    setSourceKind(null);
    setProjectSuggestion(null);
    setContractBusy(false);
    // Re-arm the customer-change guard below: on a fresh open, the first run of
    // that effect must NOT be treated as a customer change.
    loadedForCustomerRef.current = undefined;
    setScLive(false);
    setScPick({
      workerId: editRun?.siteclock?.workerId ?? null,
      workerName: editRun?.siteclock?.workerName ?? null,
      durationMin: editRun?.siteclock?.durationMin ?? null,
    });
    if (editRun) {
      // Edit mode: prefill from the still-scheduled run + its draft DO.
      setRows(
        editRun.items.length
          ? editRun.items.map((it) =>
              it.asset
                ? { asset: it.asset, description: "", freeTyped: false, quantity: String(Math.max(1, it.quantity || 1)), assetClass: DEFAULT_ASSET_CLASS }
                : { asset: null, description: it.description ?? "", freeTyped: true, quantity: String(Math.max(1, it.quantity || 1)), assetClass: normalizeAssetClass(it.assetClass) },
            )
          : [{ asset: null, description: "", freeTyped: false, quantity: "1", assetClass: DEFAULT_ASSET_CLASS }],
      );
      const pad = (n: number) => String(n).padStart(2, "0");
      if (editRun.scheduledFor) {
        const d = new Date(editRun.scheduledFor);
        setScheduleDate(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
        // An all-day job's 00:00 is not a time to edit: keep the default under the tick.
        setScheduleTime(editRun.scheduledAllDay ? "09:00" : `${pad(d.getHours())}:${pad(d.getMinutes())}`);
      } else {
        setScheduleDate("");
        setScheduleTime("09:00");
      }
      setAllDay(!!editRun.scheduledAllDay);
      setPoNumber(editRun.document?.poNo ?? "");
      // Restore the pointer so re-saving an edited run keeps its Sales Order.
      // The run summary carries poNo + saleOrderId; the display columns are
      // filled in when the picker list loads (matched on id).
      setSaleOrder(
        editRun.document?.saleOrderId
          ? { id: editRun.document.saleOrderId, name: editRun.document?.poNo ?? "", customerName: "", customerPo: editRun.document?.poNo ?? "" }
          : null,
      );
      setPoTouched(false);
      setAddress(editRun.siteAddress ?? "");
      setAddressTouched(true); // keep the saved address; don't auto-overwrite on project load
      setMachineLocation(editRun.document?.machineLocation ?? "");
      setCustomer(editRun.customer ? { id: editRun.customer.id, name: editRun.customer.name, customerCode: editRun.customer.customerCode ?? null, address: null } : null);
      setProject(editRun.project ? { id: editRun.project.id, name: editRun.project.name } : null);
      return;
    }
    // Create mode: blank form.
    setRows([{ asset: null, description: "", freeTyped: false, quantity: "1", assetClass: DEFAULT_ASSET_CLASS }]);
    setScheduleDate("");
    setScheduleTime("09:00");
    setAllDay(false);
    setPoNumber("");
    setSaleOrder(null);
    setPoTouched(false);
    setAddress("");
    setAddressTouched(false);
    setMachineLocation("");
    setCustomer(null);
    setProject(null);
    if (prefill) {
      // "Add job" on an order: the order's customer, its site and the
      // quotation's lines (catalog lines as products, the rest free-typed),
      // kept like an edit-mode prefill so the customer load doesn't overwrite them.
      if (prefill.lines.length) {
        setRows(
          prefill.lines.map((l) =>
            l.asset
              ? { asset: { id: l.asset.id, name: l.asset.name, skuKey: l.asset.skuKey ?? "" }, description: "", freeTyped: false, quantity: String(Math.max(1, l.quantity || 1)), assetClass: DEFAULT_ASSET_CLASS }
              : { asset: null, description: l.description, freeTyped: true, quantity: String(Math.max(1, l.quantity || 1)), assetClass: normalizeAssetClass(l.assetClass) },
          ),
        );
      }
      setAddress(prefill.siteAddress ?? "");
      setAddressTouched(!!prefill.siteAddress);
      setCustomer(prefill.customer ? { id: prefill.customer.id, name: prefill.customer.name, customerCode: prefill.customer.customerCode, address: prefill.customer.address } : null);
    }
  }, [open, editRun, prefill]);

  // Debounced asset search.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      setAssetSearching(true);
      try {
        const token = await getToken();
        if (!token) return;
        const q = assetInput.trim();
        const res = await request(
          { path: `/assets/search${q ? `?q=${encodeURIComponent(q)}` : ""}`, method: "GET" },
          {},
          token,
        );
        if (!cancelled) setAssetOptions(Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : []);
      } catch {
        /* keep last results */
      } finally {
        if (!cancelled) setAssetSearching(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [assetInput, open, getToken]);

  // Debounced customer search (now carries the address for auto-fill).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      setCustomerSearching(true);
      try {
        const token = await getToken();
        if (!token) return;
        const res = await request(
          { path: "/customers", method: "POST" },
          { page: 1, limit: 20, search: customerInput.trim() || undefined },
          token,
        );
        const docs = res?.data?.docs;
        if (!cancelled) {
          setCustomerOptions(
            Array.isArray(docs)
              ? docs.map((c: any) => ({ id: c.id, name: c.name, customerCode: c.customerCode ?? null, address: c.address ?? null }))
              : [],
          );
        }
      } catch {
        /* optional */
      } finally {
        if (!cancelled) setCustomerSearching(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [customerInput, open, getToken]);

  // Load projects for the chosen customer (now carries the site-office address).
  //
  // Only a genuine customer CHANGE clears the picked project. This used to call
  // setProject(null) unconditionally, which fired once on open and wiped the
  // edit-mode prefill: the prefill set customer AND project, the customer
  // change woke this effect, and the project was gone before the user saw the
  // form. undefined = this effect has not run since the dialog opened.
  useEffect(() => {
    const previousCustomerId = loadedForCustomerRef.current;
    const nextCustomerId = customer?.id ?? null;
    if (previousCustomerId !== undefined && previousCustomerId !== nextCustomerId) {
      setProject(null);
    }
    loadedForCustomerRef.current = nextCustomerId;
    setProjectOptions([]);
    if (!customer) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const res = await request(
          { path: "/projects", method: "POST" },
          { page: 1, limit: 50, filters: { customerId: customer.id } },
          token,
        );
        const docs = res?.data?.docs;
        if (!cancelled) {
          setProjectOptions(
            Array.isArray(docs) ? docs.map((p: any) => ({ id: p.id, name: p.name })) : [],
          );
        }
      } catch {
        /* optional */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [customer, getToken]);

  // OSI-84 — load the chosen project's attached contacts (clear when none).
  // GET /projects/:id/contacts now returns LINKS ({ linkId, group, source,
  // contact }), so a person holding both a DO and an Invoice link arrives as two
  // entries and the picker can show both roles ticked.
  useEffect(() => {
    if (!project) {
      setProjectContacts([]);
      setContactCoverage(null);
      setCiLink(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const res = await request({ path: `/projects/${project.id}/contacts`, method: "GET" }, {}, token);
        const list = (res?.data ?? res) as Array<{ group: string | null; contact: ContactLite }>;
        if (cancelled) return;
        setProjectContacts(
          Array.isArray(list)
            ? list.map((l) => ({
                contactId: l.contact.id,
                group: l.group === "DO" || l.group === "INVOICE" ? l.group : null,
              }))
            : [],
        );
      } catch {
        if (!cancelled) setProjectContacts([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [project, getToken]);

  // Coverage — does this project have a DO contact and an Invoice contact?
  // Derived from the picker's own assignments so ticking a role updates the
  // banner immediately, without a round-trip.
  useEffect(() => {
    if (!project) return;
    const cov = {
      DO: projectContacts.filter((a) => a.group === "DO").length,
      INVOICE: projectContacts.filter((a) => a.group === "INVOICE").length,
      UNGROUPED: projectContacts.filter((a) => !a.group).length,
    };
    setContactCoverage(cov);
  }, [project, projectContacts]);

  // Resolve the link once per project, and ONLY when a role is actually
  // missing — a fully-contacted project never touches the endpoint at all.
  // Keyed on the project id so switching back and forth does not re-resolve.
  const ciResolvedForRef = useRef<string | null>(null);
  useEffect(() => {
    const pid = project?.id;
    if (!pid || !contactCoverage) return;
    if (contactCoverage.DO && contactCoverage.INVOICE) return; // nothing to ask for
    if (ciResolvedForRef.current === pid) return;
    ciResolvedForRef.current = pid;
    void resolveCustomerInfoLink(pid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, contactCoverage?.DO, contactCoverage?.INVOICE]);

  // Persist the project's contact set (this project already exists, so save now).
  const saveProjectContacts = async (next: ContactAssignment[]) => {
    setProjectContacts(next);
    if (!project) return;
    try {
      const token = await getToken();
      if (!token) return;
      await request(
        { path: `/projects/${project.id}/contacts`, method: "PUT", quiet: true },
        { contacts: next },
        token,
      );
    } catch {
      /* non-blocking: the picker keeps the selection; a later save can retry */
    }
  };

  // Resolve the customer-information link for THIS project, automatically.
  //
  // READ BEFORE MINTING. GET /customer-info/project/:id is side-effect free and
  // already returns `liveUnsubmitted` — the outstanding request createRequest
  // would have reused. Checking it first means opening the dialog on a project
  // that already has a live link creates NOTHING; only a project that genuinely
  // has no outstanding link mints one. Without this read, merely browsing
  // projects in the dropdown would POST on every change.
  //
  // What still happens, deliberately: the first time the dialog lands on a
  // project that is short a role AND has no live link, one CustomerInfoRequest
  // is created. Re-opening reuses it (createRequest keys reuse on
  // organizationId + projectId), so it is one row per project, not per open.
  // A SUBMITTED request is not reused by design — its link is spent — so a
  // project whose contacts came back incomplete will mint one fresh link, then
  // reuse that.
  //
  // The read needs customer-info:read, which every role holds; only the mint
  // needs customer-info:create, which Admin and superadmin hold. A refusal is
  // swallowed: the link simply does not appear, which is the same outcome as
  // before and better than an error on a dialog the user did not ask to mint on.
  const resolveCustomerInfoLink = async (projectId: string) => {
    if (!customer?.id) return;
    try {
      const token = await getToken();
      if (!token) return;
      const guestUrl = (t: string) => `${window.location.origin}/guest/customer-info/${t}`;

      const view = await request({ path: `/customer-info/project/${projectId}`, method: "GET", quiet: true }, {}, token);
      const vdata = view?.data ?? view;
      const live = vdata?.liveUnsubmitted;
      if (live?.token) {
        setCiLink(guestUrl(live.token));
        return;
      }

      const res = await request(
        { path: "/customer-info", method: "POST", quiet: true },
        { customerId: customer.id, projectId },
        token,
      );
      const data = res?.data ?? res;
      if (res?.success === false || !data?.token) return; // no permission, or refused
      setCiLink(guestUrl(data.token));
    } catch {
      /* non-blocking: no link shown */
    }
  };

  // Load every SALES_ORDER document for the org. Deliberately NOT filtered by
  // status — all 75 existing Sales Orders are `unconfirmed`, so a confirmed-only
  // filter (the one the quotation picker uses) would return nothing. Not
  // filtered by customer either: the picker's own customer dropdown does that
  // client-side, and it needs the full list to build its options.
  const loadSaleOrders = async (): Promise<SaleOrderRow[]> => {
    const token = await getToken();
    if (!token) return [];
    const res = await request(
      { path: "/documents/paginated", method: "POST" },
      { organizationId: organization?.id, documentTypes: ["SALES_ORDER", "SO"], limit: 500 },
      token,
    );
    const body = res?.data ?? res;
    const docs: any[] = Array.isArray(body) ? body : Array.isArray(body?.docs) ? body.docs : [];
    // Keep the RAW documents beside the display rows: SaleOrderRow carries only
    // the four columns the picker shows, and the stepped dialog auto-fills from
    // the document's config (address, project, line items) exactly as the
    // quotation step does.
    soDocsRef.current = new Map(docs.map((d: any) => [String(d?.id ?? ""), d]));
    return docs.map(toSaleOrderRow);
  };

  const openSaleOrders = async () => {
    setSoLoading(true);
    setSoOpen(true);
    try {
      const rows = await loadSaleOrders();
      setSoRows(rows);
      // An edit-mode run restores only the pointer; fill in its display columns
      // now that the list is here, so the field reads as a real Sales Order.
      setSaleOrder((cur) => (cur && !cur.customerName ? rows.find((r) => r.id === cur.id) ?? cur : cur));
    } catch (e: any) {
      setError(e?.message ?? "Couldn't load Sales Orders");
    } finally {
      setSoLoading(false);
    }
  };

  const selectSaleOrder = async (row: SaleOrderRow) => {
    setSaleOrder(row);
    // config.poNo keeps the DISPLAY string. The customer PO is what the DO has
    // always printed as "Your PO No."; fall back to the Sales Order number when a
    // freshly uploaded one has no reference extracted yet.
    setPoNumber(row.customerPo || row.name || "");
    setPoTouched(true);
    // Stepped dialog: a Sales Order is one of the three things a schedule may be
    // based on, and it auto-fills the rest through the SAME engine the quotation
    // step uses — address, project and line items off its config. Gated on the
    // wizard: on every other org picking a Sales Order still only sets the PO,
    // exactly as it did before (it is chosen mid-form there, and refilling the
    // lines underneath someone would throw away what they typed).
    if (!wizard) return;
    const raw = soDocsRef.current.get(row.id);
    if (raw) await applySourceDocument(raw, "SALES_ORDER");
    else setSource({ kind: "SALES_ORDER", documentId: row.id, ...(row.name ? { number: row.name } : {}) });
  };

  // Extraction and document creation are both fully awaited server-side (POST
  // /document-extraction/extract, then POST /documents/from-extraction), so by
  // the time this fires the Document row EXISTS. Nothing is queued, so the new
  // Sales Order is immediately selectable — reload the list and select it.
  const onSaleOrderUploaded = async (created: Array<{ id: string; templateId?: string }>) => {
    if (!created.length) return;
    try {
      const rows = await loadSaleOrders();
      setSoRows(rows);
      const fresh = rows.find((r) => r.id === created[0].id);
      if (fresh) await selectSaleOrder(fresh);
      else setSoOpen(true); // extracted but not matched — let them pick it manually
    } catch {
      /* non-blocking: the document exists; reopening the picker will show it */
    }
  };

  /**
   * MASTER CONTRACT (stepped dialog): upload the file and keep it with the run.
   *
   * It mints NO document and appears in no list — guru 2026-11-24: "just an
   * uploaded file". So there is nothing to pick later and nothing to price
   * from; it is evidence that the delivery is covered by a standing agreement,
   * and the office fills the rest of the steps by hand.
   *
   * Posted to /document-extraction/extract rather than /uploads/image, for two
   * reasons: it is the ONLY file endpoint this dialog's users are already
   * proven to reach (the Sales Order upload beside it uses the same
   * permission), and it stashes the file to S3 and hands back its URL, which is
   * what has to be recorded. Its extracted FIELDS are deliberately ignored — a
   * master contract is rates and terms, not a delivery.
   */
  const uploadContract = async (file: File) => {
    setContractBusy(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const fd = new FormData();
      fd.append("document", file);
      fd.append("documentType", "invoice"); // the extractor needs a shape; nothing is read back
      const apiBase = process.env.NEXT_PUBLIC_BACKEND_API_URL || "http://localhost:4040";
      // X-Active-Org-Id by hand: this is a multipart POST, so it cannot go
      // through the `request` helper that injects the header for every other
      // call. Without it an admin "viewing as" another org uploads into their
      // OWN org — the file is stashed under the wrong organisation's S3 prefix
      // (seen on dev: a Biofuel contract landed under osiris-platform).
      const activeOrgId =
        typeof window !== "undefined" ? window.sessionStorage.getItem(ACTIVE_ORG_KEY) : null;
      const res = await fetch(`${apiBase}/document-extraction/extract`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          ...(activeOrgId ? { "X-Active-Org-Id": activeOrgId } : {}),
        },
        body: fd,
      });
      const json = await res.json();
      if (!res.ok || !json?.success) throw new Error(json?.message || "Could not read that file");
      const fileUrl = json?.data?.metadata?.sourceFileUrl ?? json?.metadata?.sourceFileUrl ?? null;
      // No URL means the S3 stash failed (the endpoint treats that as
      // non-fatal). There would be nothing to keep, and the backend rejects a
      // CONTRACT source with no file — so say so rather than appear to succeed.
      if (!fileUrl) throw new Error("The file was read but could not be stored. Please try again.");
      setSource({ kind: "CONTRACT", fileName: file.name, fileUrl: String(fileUrl), number: file.name });
      setNote(`Master contract attached: ${file.name}. Fill in the site, products and date on the next steps.`);
    } catch (e: any) {
      setError(e?.message ?? "Could not upload the contract");
    } finally {
      setContractBusy(false);
      if (contractInputRef.current) contractInputRef.current.value = "";
    }
  };

  // The exact value the auto-fill last wrote. A hand-edit makes `address` differ
  // from this; auto-fill "owns" the field only while the two still match, so a
  // genuinely typed address is never clobbered.
  const autoFilledAddrRef = useRef("");
  // Last project the auto-fill acted on — the ref-compare that detects a GENUINE
  // project change (same pattern as loadedForCustomerRef), so switching to a
  // different project re-fills the address rather than leaving the old one.
  const prevProjectIdRef = useRef<string | null | undefined>(undefined);
  const addressRef = useRef(address);
  addressRef.current = address;

  // Auto-fill the delivery address from the PROJECT NAME — for this fleet a
  // project's name IS its site address (e.g. "Tuas Avenue 8"). Re-fills on a real
  // project change so a DIFFERENT project updates the address; but a hand-edited
  // address (differs from the last auto-fill) SURVIVES the switch — typing is
  // never silently discarded. Freely editable; lands on the DO's "Deliver To".
  useEffect(() => {
    const nextId = project?.id ?? null;
    if (prevProjectIdRef.current === nextId) return; // not a genuine project change
    prevProjectIdRef.current = nextId;
    const current = addressRef.current;
    if (current && current !== autoFilledAddrRef.current) return; // hand-edited: keep it
    const filled = project?.name || "";
    autoFilledAddrRef.current = filled;
    setAddress(filled);
    setAddressTouched(false); // it is an auto-fill again, not a hand-edit
  }, [project]);

  // Service-job org: there is no project, so the delivery address auto-fills
  // from the CUSTOMER's address instead — same genuine-change detection and the
  // same hand-edit protection as the project fill above.
  const prevAddrCustomerIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!serviceJobs) return;
    const nextId = customer?.id ?? null;
    if (prevAddrCustomerIdRef.current === nextId) return;
    prevAddrCustomerIdRef.current = nextId;
    const current = addressRef.current;
    if (current && current !== autoFilledAddrRef.current) return; // hand-edited: keep it
    const filled = customer?.address || "";
    autoFilledAddrRef.current = filled;
    setAddress(filled);
    setAddressTouched(false);
  }, [serviceJobs, customer]);

  const setRow = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  // A row counts when it has qty ≥ 1 AND either a picked product OR (free-typed)
  // a non-empty description.
  const validRows = rows.filter(
    (r) => (r.freeTyped ? r.description.trim().length > 0 : !!r.asset) && (parseInt(r.quantity, 10) || 0) >= 1,
  );
  // A Sales Order is REQUIRED to schedule, mirroring projectId: the backend
  // enforces the same rule in the service. A DRAFT is deliberately exempt — a
  // job can arrive before its Sales Order does, and the office must still be
  // able to park the run rather than lose what they typed. Orgs with
  // enableQuotationToDelivery (service jobs from an accepted quotation — WCT)
  // schedule without a Project or a Sale Order; the backend relaxes the same
  // two rules for them.
  const canSubmit =
    !!scheduleDate &&
    (allDay || !!scheduleTime) &&
    // Stepped dialog: a real schedule is always based on a quotation, a Sales
    // Order or a master contract. Save as draft stays open with nothing.
    (!wizard || !!source) &&
    // enableOptionalSaleOrder (Biofuel): the Project is still needed, the Sales Order is not.
    (isQuotationToDeliveryEnabled || (!!project && (!!saleOrder || isOptionalSaleOrderEnabled))) &&
    validRows.length > 0 &&
    !submitting;

  // ── the five steps ────────────────────────────────────────────────────────
  // Each one states what it still needs; Next stays disabled and says so, which
  // beats a dead button. The LAST step has no Next — it has Schedule, gated by
  // canSubmit above. Save as draft is offered from EVERY step, because the
  // backend lets a draft be parked with nothing and a job regularly arrives
  // before its paperwork does.
  const STEPS = ["Customer", "Paperwork", "Site & contacts", "Products", "Schedule"];
  const stepBlocked = (n: number): string | null => {
    if (n === 0) return customer ? null : "Pick a customer to continue.";
    if (n === 1) return source ? null : "Choose a quotation, a Sales Order or a master contract to continue.";
    if (n === 2) return serviceJobs || project ? null : "Pick or create a project to continue.";
    if (n === 3) return validRows.length > 0 ? null : "Add at least one product or free-typed item to continue.";
    return null;
  };
  const blocked = stepBlocked(activeStep);
  /** A section renders when its step is open — or always, on the flat form. */
  const onStep = (n: number) => !wizard || activeStep === n;

  // Fetch the customer's CONFIRMED quotations and open the extract dialog.
  // /documents is server-paginated (default 20 newest of ANY type), so we MUST
  // filter server-side (type + status + customer) and read the `docs` array —
  // otherwise real quotations (buried past the 20-doc window) never load.
  const openQuotations = async () => {
    if (!customer) return;
    setQuoteLoading(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const res = await request(
        { path: "/documents/paginated", method: "POST" },
        {
          organizationId: organization?.id,
          documentTypes: ["QUOTATION", "QT", "QO", "QO1", "QO2"],
          status: "confirmed",
          customerId: customer.id,
          limit: 200,
        },
        token,
      );
      // getDocumentsPaginated → { docs, total, ... }; helper nests it under .data.
      const body = res?.data ?? res;
      const docs: any[] = Array.isArray(body) ? body : Array.isArray(body?.docs) ? body.docs : [];
      // Server already scoped to confirmed quotations for this customer; keep only
      // the ones that actually carry line items to pull.
      const list = docs.filter((d: any) => Array.isArray(d.config?.items) && d.config.items.length > 0);
      setQuotations(list);
      setQuoteOpen(true);
      if (list.length === 0) setNote("No confirmed quotations with line items found for this customer.");
    } catch (e: any) {
      setError(e?.message ?? "Couldn't load quotations");
    } finally {
      setQuoteLoading(false);
    }
  };

  // Apply a selected quotation: autofill project + address + PO + line items.
  // Quotation lines carry a REAL catalog pointer (itemCode → skuKey, and an
  // inventoryItemId that actually holds the asset id), so matching keys on that —
  // NOT fuzzy text (the catalog name "100 TON EXCAVATOR" isn't a substring of the
  // quoted "100-Ton Excavator with Operator"). Descriptions are rich text → HTML
  // is stripped before display/search. Unmatched lines land free-typed. All editable.
  const applySourceDocument = async (q: any, kind: ScheduleSourceKind) => {
    setQuoteOpen(false);
    setError(null);
    // Human label for the summary line below — the same engine now serves the
    // quotation step and the Sales Order step, and a note that says "Quotation
    // applied" after picking a Sales Order reads as a bug.
    const docLabel = kind === "SALES_ORDER" ? "Sales Order" : "Quotation";
    // WHAT this schedule is based on. Set before anything can fail below: the
    // office picked it, so it is chosen whether or not every field maps across.
    setSource({ kind, documentId: String(q?.id ?? ""), ...(q?.name ? { number: String(q.name) } : {}) });
    const cfg = q?.config || {};
    // Quotations in this org use `referenceNo`/`poNo` — read either (both empty in
    // current data, so this is defensive and simply won't fire).
    const poValue = cfg.poNo || cfg.referenceNo;
    if (poValue) setPoNumber(String(poValue));
    // Service-job org: the quotation's Job Location is where the work happens
    // (guru 2026-10-27), so it beats the billing address.
    const jobLocation = serviceJobs ? cfg.documentInfo?.location || cfg.documentInfo?.jobLocation || cfg.location : null;
    if (jobLocation) {
      setAddress(String(jobLocation));
      setAddressTouched(true);
    } else if (cfg.customerAddress) {
      setAddress(String(cfg.customerAddress));
      setAddressTouched(true);
    }
    // The project lives on the Document.projectId COLUMN (now surfaced top-level by
    // getDocumentsPaginated), not in config — real quotations only populate the
    // column. Prefer the column, fall back to legacy config.projectId.
    const pid = q?.projectId ?? cfg.projectId;
    const pname = q?.projectName ?? cfg.projectName;
    if (pid && !serviceJobs) {
      const match = projectOptions.find((p) => p.id === pid);
      setProject(match ?? { id: String(pid), name: pname || `Project from ${docLabel.toLowerCase()}` });
      setProjectSuggestion(null);
    } else if (!serviceJobs) {
      // The document carries no project, which is the common case — real
      // quotations rarely do. Rather than leave her to hunt for one, SUGGEST a
      // name and let her confirm it on the site step (guru 2026-11-24). The
      // suggestion is the delivery address, because for this fleet a project's
      // NAME is its site address ("Tuas Avenue 8") — the convention the address
      // auto-fill below already depends on. First line only: an address block
      // makes a project name nobody can pick out of a list.
      const candidate = String(jobLocation || cfg.customerAddress || pname || "")
        .split("\n")[0]
        .trim()
        .slice(0, 80);
      setProjectSuggestion(candidate || null);
    }
    const filledPo = !!poValue;
    const filledProject = !!pid;
    const items: any[] = Array.isArray(cfg.items) ? cfg.items : [];
    if (items.length) {
      let token: string | null = null;
      try {
        token = await getToken();
      } catch {
        /* ignore */
      }
      // Reuse the permission-safe /assets/search the picker already uses. Its
      // filter is a name|skuKey SUBSTRING match, so for an itemCode we additionally
      // require an EXACT skuKey (avoids EXC100 matching EXC1000).
      const searchAssets = async (query: string): Promise<AssetOption[]> => {
        if (!query || !token) return [];
        try {
          const r = await request(
            { path: `/assets/search?q=${encodeURIComponent(query.slice(0, 60))}`, method: "GET" },
            {},
            token,
          );
          return Array.isArray(r?.data) ? r.data : Array.isArray(r) ? r : [];
        } catch {
          return [];
        }
      };
      // inventoryItemId on a quotation line actually holds the ASSET id — resolve
      // by id, best-effort (may 403 for some roles → caught → skip to next tier).
      const assetById = async (id: string): Promise<AssetOption | null> => {
        if (!id || !token) return null;
        try {
          const r = await request({ path: `/assets/${encodeURIComponent(id)}`, method: "GET", quiet: true }, {}, token);
          const a: any = r?.data ?? r;
          return a && a.id ? { id: a.id, name: a.name, skuKey: a.skuKey } : null;
        } catch {
          return null;
        }
      };
      const resolved: Row[] = await Promise.all(
        items.map(async (it) => {
          const qty = String(Math.max(1, parseInt(it?.quantity, 10) || 1));
          const cleanText = htmlToText(it?.description);
          // Nothing matched → FREE-TYPED with PLAIN-TEXT description, so no line is
          // silently dropped and no raw HTML leaks into the field.
          const freeRow: Row = { asset: null, description: cleanText, freeTyped: true, quantity: qty, assetClass: newFreeClass };
          if (!token) return freeRow;
          // 1. PRIMARY — itemCode → exact skuKey (the reliable catalog key).
          const itemCode = String(it?.itemCode || "").trim();
          if (itemCode) {
            const hit = (await searchAssets(itemCode)).find(
              (a) => (a.skuKey || "").toLowerCase() === itemCode.toLowerCase(),
            );
            if (hit) return { asset: hit, description: "", freeTyped: false, quantity: qty, assetClass: DEFAULT_ASSET_CLASS };
          }
          // 2. FALLBACK — inventoryItemId (asset id), if the role can read it.
          const invId = String(it?.inventoryItemId || "").trim();
          if (invId) {
            const byId = await assetById(invId);
            if (byId) return { asset: byId, description: "", freeTyped: false, quantity: qty, assetClass: DEFAULT_ASSET_CLASS };
          }
          // 3. LAST RESORT — HTML-stripped fuzzy text (first line only).
          const firstLine = cleanText.split("\n")[0] || "";
          if (firstLine) {
            const arr = await searchAssets(firstLine);
            if (arr[0]) return { asset: arr[0], description: "", freeTyped: false, quantity: qty, assetClass: DEFAULT_ASSET_CLASS };
          }
          return freeRow;
        }),
      );
      const finalRows = resolved.length ? resolved : [{ asset: null, description: "", freeTyped: false, quantity: "1", assetClass: DEFAULT_ASSET_CLASS }];
      setRows(finalRows);
      const matched = finalRows.filter((r) => !r.freeTyped).length;
      // Honest summary: matched count + SEPARATELY whether project/PO were filled.
      // Never imply the project came from the quotation (they don't carry one).
      const parts = [`${docLabel} applied: ${matched}/${finalRows.length} line(s) matched a catalog product; the rest are free-typed.`];
      parts.push(filledPo ? "PO number filled." : `No PO on the ${docLabel.toLowerCase()}.`);
      if (!serviceJobs) parts.push(filledProject ? `Project taken from the ${docLabel.toLowerCase()}.` : `This ${docLabel.toLowerCase()} has no project. Pick or create one on the next step (required).`);
      parts.push("Review products, quantities & address.");
      setNote(parts.join(" "));
    } else {
      const parts = [`${docLabel} applied. It had no line items.`];
      parts.push(filledPo ? "PO number filled." : `No PO on the ${docLabel.toLowerCase()}.`);
      if (!serviceJobs) parts.push(filledProject ? `Project taken from the ${docLabel.toLowerCase()}.` : `This ${docLabel.toLowerCase()} has no project. Pick or create one on the next step (required).`);
      setNote(parts.join(" "));
    }
  };

  /** The quotation picker's callback — unchanged for every org. */
  const applyQuotation = (q: any) => applySourceDocument(q, "QUOTATION");

  // Inline create-customer: seed the dialog with whatever was typed in the picker.
  const openCreateCustomer = () => {
    setCreateCustomerName(customerInput.trim());
    setCreateCustomerOpen(true);
  };
  const handleCreateCustomer = async () => {
    const trimmed = createCustomerName.trim();
    if (!trimmed) return;
    setCreatingCustomer(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const res = await request({ path: "/customers/create-by-name", method: "POST", ownError: true }, { name: trimmed }, token);
      const created = res?.data;
      if (res?.success && created?.id) {
        const option: CustomerOption = { id: created.id, name: created.name ?? trimmed, customerCode: created.customerCode ?? null, address: created.address ?? null };
        setCustomerOptions((prev) => [option, ...prev]);
        setCustomer(option);
        setCreateCustomerOpen(false);
        setCreateCustomerName("");
      } else {
        setError(res?.message ?? "Failed to create customer");
      }
    } catch (e: any) {
      setError(e?.message ?? "Failed to create customer");
    } finally {
      setCreatingCustomer(false);
    }
  };
  // nameOverride: the stepped dialog's "create the suggested project" button
  // passes the name straight in. Reading createProjectName there would get the
  // PREVIOUS render's value (setState is not synchronous), so the project would
  // be created under the wrong name — or none at all on the first click.
  const handleCreateProject = async (nameOverride?: string) => {
    const trimmed = (nameOverride ?? createProjectName).trim();
    if (!trimmed || !customer) return;
    setCreatingProject(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const res = await request(
        { path: "/projects/create-by-name", method: "POST", ownError: true },
        { name: trimmed, customerId: customer.id },
        token,
      );
      if (res?.success && res.data?.id) {
        const createdP: ProjectOption = { id: res.data.id, name: res.data.name ?? trimmed };
        setProjectOptions((prev) => [createdP, ...prev]);
        setProject(createdP);
        setCreateProjectOpen(false);
        setCreateProjectName("");
      } else {
        setError(res?.message ?? "Failed to create project");
      }
    } catch (e: any) {
      setError(e?.message ?? "Failed to create project");
    } finally {
      setCreatingProject(false);
    }
  };

  const submit = async (asDraft = false) => {
    // A DRAFT saves whatever has been entered, however little. Only a real
    // schedule needs the full set.
    if (!asDraft && !canSubmit) return;
    // Custom job fields: a bad value stops the save; a required one only for a real schedule.
    const jfProblem = jobFieldDefs.map((f) => jobFieldProblem(f, jobFieldValues[f.id], { checkRequired: !asDraft })).find(Boolean);
    if (jfProblem) {
      setError(jfProblem);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      // Combine the separate date + time into one local datetime → ISO.
      // A draft may have no date yet, so only build one when there is a date.
      // All-day: the date only (yyyy-MM-dd); the server stores the day's 00:00.
      const scheduledFor = scheduleDate
        ? allDay
          ? scheduleDate
          : new Date(`${scheduleDate}T${scheduleTime || "09:00"}`).toISOString()
        : undefined;
      const res = await request(
        editRun
          ? { path: `/deliveries/scheduled/${editRun.id}`, method: "PATCH", ownError: true }
          : { path: "/deliveries/scheduled", method: "POST", ownError: true },
        {
          ...(asDraft ? { isDraft: true } : {}),
          ...(scheduledFor ? { scheduledFor } : {}),
          scheduledAllDay: allDay,
          items: validRows.map((r) =>
            r.freeTyped
              ? {
                  description: r.description.trim(),
                  quantity: Math.max(1, parseInt(r.quantity, 10) || 1),
                  assetClass: r.assetClass,
                }
              : { assetId: r.asset!.id, quantity: Math.max(1, parseInt(r.quantity, 10) || 1) },
          ),
          ...(poNumber.trim() ? { poNumber: poNumber.trim() } : {}),
          ...(saleOrder ? { saleOrderId: saleOrder.id } : {}),
          // Stepped dialog: WHAT this schedule is based on. The backend applies
          // the same rule, so this is not merely a record of the choice.
          ...(source ? { scheduleSource: source } : {}),
          ...(address.trim() ? { address: address.trim() } : {}),
          ...(machineLocation.trim() ? { machineLocation: machineLocation.trim() } : {}),
          ...(customer ? { customerId: customer.id } : {}),
          ...(project ? { projectId: project.id } : {}),
          // WCT orders "Add job": the new job belongs to the order.
          ...(!editRun && prefill ? { orderId: prefill.orderId } : {}),
          // Custom job fields: every field's current value (null clears).
          ...(isJobFieldsEnabled && jobFieldDefs.length
            ? { jobFields: Object.fromEntries(jobFieldDefs.map((f) => [f.id, jobFieldValues[f.id] === "" || jobFieldValues[f.id] === undefined ? null : jobFieldValues[f.id]])) }
            : {}),
          // Send the picker's CURRENT selection so the backend persists it before
          // deriving the DO's Attention. The pick-time PUT still fires for instant
          // feedback, but this closes the race where the DO is built before that
          // fire-and-forget save commits. Only with a project (the backend keys
          // ProjectContact on it); untouched, this re-sends the loaded set.
          ...(project ? { contacts: projectContacts } : {}),
          // SiteClock link: the current pick (null = None → the backend cancels a job it made).
          ...(isSiteClockLinkEnabled && scLive
            ? {
                siteclockWorkerId: scPick.workerId,
                siteclockWorkerName: scPick.workerName,
                ...(scPick.durationMin ? { siteclockDurationMin: scPick.durationMin } : {}),
              }
            : {}),
        },
        token,
      );
      if (res?.success === false) throw new Error(res?.message ?? (asDraft ? "Failed to save the draft" : `Failed to schedule ${w.noun}`));
      onCreated();
      onClose();
    } catch (e: any) {
      const m = e?.message;
      setError((Array.isArray(m) ? m.join(". ") : m) || `Failed to schedule ${w.noun}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={() => {
        // Click-outside / Escape SAVES. A complete form becomes a real schedule;
        // an incomplete one is saved as a DRAFT to come back to, however little
        // was entered. An unfinished schedule is not an error. Only Cancel
        // discards.
        if (submitting) return;
        void submit(!canSubmit);
      }}
      fullWidth
      maxWidth={split ? false : "sm"}
      fullScreen={fullScreenDialog}
      PaperProps={split && !fullScreenDialog ? { sx: SPLIT_PAPER_SX } : undefined}
    >
      <DialogTitle>{editRun ? `Edit scheduled ${w.noun}` : prefill ? `Add a job to ${prefill.orderNumber}` : `Schedule a ${w.noun}`}</DialogTitle>
      <DialogContent dividers sx={split ? { display: "flex", flexDirection: "column", minHeight: 0 } : undefined}>
        <SplitIf
          split={split}
          preview={
            <JobDayPreview
              date={scheduleDate}
              time={allDay ? null : scheduleTime}
              allDay={allDay}
              durationMin={scPick.durationMin ?? 60}
              team={scPick.workerName}
              excludeId={editRun?.id ?? null}
              onPick={(sl) => {
                setScheduleDate(sl.date);
                if (sl.time) {
                  setScheduleTime(sl.time);
                  setAllDay(false);
                } else setAllDay(true);
              }}
              onHints={setSlotHintLines}
            />
          }
        >
        {/* STEPPER — the stepped dialog's own header. Hidden on every org that
            keeps the flat form, and on an edit (which keeps it too). */}
        {wizard && (
          <Stepper activeStep={activeStep} alternativeLabel sx={{ mb: 2.5 }}>
            {STEPS.map((label) => (
              <Step key={label}>
                <StepLabel>{label}</StepLabel>
              </Step>
            ))}
          </Stepper>
        )}

        {onStep(0) && (<>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {serviceJobs && isManualOrderFlowEnabled
            ? "The job is done by the office: when the work is finished, open the job and use Complete job for the customer's sign-off."
            : serviceJobs
            ? "The job appears on the field app once scheduled. The technician starts it on site and the customer signs at the end."
            : "The run is fulfilled when a rider starts a matching unit in the field and assigns it to this project. No unit is reserved now."}
        </Typography>

        {/* 1) CUSTOMER */}
        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
          {/* The flat form really does hold both under this heading. In the
              stepped dialog the project has a step of its own, so saying
              "& project" here promises something this step does not have. */}
          {serviceJobs || wizard ? "Customer" : "Customer & project"}
        </Typography>
        <Autocomplete<CustomerOption, false, false, false>
          size="small"
          options={customerOptions}
          filterOptions={(x) => x}
          value={customer}
          onChange={(_, picked) => setCustomer(picked)}
          onInputChange={(_, v, reason) => {
            if (reason === "input") setCustomerInput(v);
          }}
          getOptionLabel={(o) => (o.customerCode ? `${o.name} · ${o.customerCode}` : o.name)}
          isOptionEqualToValue={(a, b) => a.id === b.id}
          loading={customerSearching}
          renderInput={(params) => <TextField {...params} label="Customer" placeholder="Search customers" required />}
          noOptionsText={
            <Button size="small" startIcon={<AddIcon />} onClick={openCreateCustomer}>
              Create customer
            </Button>
          }
          sx={{ mb: 0.5 }}
        />
        {!customer && (
          <Button size="small" startIcon={<AddIcon />} onClick={openCreateCustomer} sx={{ textTransform: "none", mb: 1 }}>
            New customer
          </Button>
        )}
        </>)}

        {/* ── STEP 2 of the stepped dialog: WHAT IS THIS BASED ON? ───────────
            The reason the wizard exists. Three ways, and no fourth: a confirmed
            quotation, the customer's Sales Order, or a master contract. She
            picks the KIND first, so the step reads as a question instead of
            three half-filled forms competing for attention. */}
        {wizard && onStep(1) && (
          <>
            <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.5 }}>
              What is this delivery based on?
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              Every scheduled delivery is backed by paperwork. Choose one to continue.
            </Typography>
            <Stack spacing={1} sx={{ mb: 2 }}>
              {/* A service-job org has no Sales Order section at all, so offering
                  the card would open onto nothing. Nobody runs both flags today;
                  this just keeps the step honest if anyone ever does. */}
              {SOURCE_CHOICES.filter((c) => !(serviceJobs && c.kind === "SALES_ORDER")).map((c) => {
                const picked = sourceKind === c.kind;
                const chosen = source?.kind === c.kind;
                return (
                  <Box
                    key={c.kind}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSourceKind(c.kind)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSourceKind(c.kind);
                      }
                    }}
                    sx={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 1.25,
                      p: 1.5,
                      borderRadius: 1,
                      cursor: "pointer",
                      border: 1,
                      // Theme tokens only: this has to read in dark mode too.
                      borderColor: picked ? "primary.main" : "divider",
                      bgcolor: picked ? "action.selected" : "transparent",
                      "&:hover": { bgcolor: "action.hover" },
                    }}
                  >
                    <Box sx={{ color: picked ? "primary.main" : "text.secondary", mt: "2px" }}>{c.icon}</Box>
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Typography variant="body2" fontWeight={600}>
                        {c.title}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" display="block">
                        {c.blurb}
                      </Typography>
                    </Box>
                    {chosen && <CheckCircleIcon fontSize="small" color="success" />}
                  </Box>
                );
              })}
            </Stack>
            {/* What was chosen, in words, so she can see it survived the step. */}
            {source && (
              <Alert severity="success" icon={<CheckCircleIcon fontSize="inherit" />} sx={{ mb: 2 }}>
                {source.kind === "QUOTATION" ? "Quotation" : source.kind === "SALES_ORDER" ? "Sales Order" : "Master contract"}
                {source.number ? `: ${source.number}` : ""}
              </Alert>
            )}
          </>
        )}

        {/* Quotation extraction — available once a customer is chosen. In the
            stepped dialog it belongs to the paperwork step and only shows when
            she has chosen "Quotation"; every other org keeps it where it was,
            directly under the customer. */}
        {onStep(1) && (!wizard || sourceKind === "QUOTATION") && (
        <Button
          size="small"
          variant={wizard ? "outlined" : "text"}
          startIcon={quoteLoading ? <CircularProgress size={16} /> : <RequestQuoteIcon />}
          onClick={openQuotations}
          disabled={!customer || quoteLoading}
          sx={{ mb: 1.5 }}
        >
          {wizard ? "Choose a quotation" : "Extract from quotation"}
        </Button>
        )}

        {/* MASTER CONTRACT — an uploaded file and nothing more (no document, no
            list). Stepped dialog only; no other org has the concept. */}
        {wizard && onStep(1) && sourceKind === "CONTRACT" && (
          <Box sx={{ mb: 2 }}>
            <input
              ref={contractInputRef}
              type="file"
              accept="application/pdf,image/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadContract(f);
              }}
            />
            <Button
              variant="outlined"
              size="small"
              startIcon={contractBusy ? <CircularProgress size={16} /> : <CloudUploadIcon />}
              disabled={contractBusy}
              onClick={() => contractInputRef.current?.click()}
            >
              {source?.kind === "CONTRACT" ? "Replace the contract file" : "Upload master contract"}
            </Button>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.75 }}>
              PDF or image, up to 10MB. The file is kept with this delivery; fill in the site, products and date yourself.
            </Typography>
          </Box>
        )}

        {/* Service-job org: no Project, no Sales Order — the run is a job from
            an accepted quotation (see serviceJobs above). */}
        {!serviceJobs && onStep(2) && (
          <>
            {/* 2) PROJECT */}
            <Autocomplete<ProjectOption, false, false, false>
              size="small"
              options={projectOptions}
              value={project}
              onChange={(_, picked) => setProject(picked)}
              getOptionLabel={(o) => o.name}
              isOptionEqualToValue={(a, b) => a.id === b.id}
              disabled={!customer}
              noOptionsText={
                <Button size="small" startIcon={<AddIcon />} onClick={() => setCreateProjectOpen(true)}>
                  Create project
                </Button>
              }
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Project"
                  placeholder={customer ? "Pick a project" : "Pick a customer first"}
                  required
                  error={!!customer && !project}
                  helperText="Required. The rider is matched back to this run by the project."
                />
              )}
              sx={{ mb: 0.5 }}
            />
            {customer && (
              <Button size="small" startIcon={<AddIcon />} onClick={() => setCreateProjectOpen(true)} sx={{ textTransform: "none", mb: 2 }}>
                New project for {customer.name}
              </Button>
            )}

            {/* The applied document implies a site this org has no project for.
                Suggest the name — never create it silently (guru 2026-11-24:
                "ask her to confirm"). The suggestion is the delivery address,
                because for this fleet a project's NAME is its site address, the
                convention the address auto-fill above already relies on. */}
            {wizard && !project && projectSuggestion && customer && (
              <Alert severity="info" sx={{ mb: 2 }} onClose={() => setProjectSuggestion(null)}>
                <Typography variant="body2" sx={{ mb: 1 }}>
                  No project matches this {source?.kind === "SALES_ORDER" ? "Sales Order" : "quotation"}. Create one?
                </Typography>
                <Stack direction="row" spacing={1} alignItems="flex-start" sx={{ flexWrap: "wrap", rowGap: 1 }}>
                  <TextField
                    size="small"
                    label="Project name"
                    value={projectSuggestion}
                    onChange={(e) => setProjectSuggestion(e.target.value)}
                    sx={{ flex: 1, minWidth: 200 }}
                    InputLabelProps={{ shrink: true }}
                  />
                  <Button
                    variant="contained"
                    size="small"
                    disabled={creatingProject || !projectSuggestion.trim()}
                    startIcon={creatingProject ? <CircularProgress size={16} color="inherit" /> : <AddIcon />}
                    onClick={async () => {
                      // Reuse the one create path (projects/create-by-name) that
                      // the New project dialog already uses — a second one would
                      // drift from it.
                      setCreateProjectName(projectSuggestion);
                      await handleCreateProject(projectSuggestion);
                      setProjectSuggestion(null);
                    }}
                    sx={{ mt: 0.25 }}
                  >
                    Create
                  </Button>
                </Stack>
              </Alert>
            )}

            {/* OSI-84 — contact people for this project (saved to the project). The
                DO's Attention uses the FIRST selected contact (primary-first). */}
            {project && (
              <Box sx={{ mb: 2 }}>
                {/* A CHOOSING surface, not an editing one. Contacts arrive through
                    the customer information form, so this dialog neither creates
                    them (allowAddContact) nor shows their details (showDetails) nor
                    assigns their roles. The PICKER stays — it is how the office
                    chooses between two submitted DO contacts and corrects a bad
                    submission, which otherwise needs a whole new link. The role
                    rides on each chip so DO and Invoice are tellable apart at a
                    glance.

                    roleView="DELIVERY" narrows the VIEW to the people a delivery is
                    about — the DO contacts, or everything ungrouped on a project
                    that has no roles — using the same fallback the DO's Attention
                    resolver uses. It does NOT narrow what is saved: hidden links
                    ride back out through onChange, because this dialog's save
                    replaces the project's whole picker-owned set. */}
                <ProjectContactPicker
                  customerId={customer?.id ?? null}
                  value={projectContacts}
                  onChange={(next) => void saveProjectContacts(next)}
                  allowAddContact={false}
                  showDetails={false}
                  roleView="DELIVERY"
                  label="Delivery contacts"
                  // enableOfficeDoEdits (Biofuel): the office may add a contact here
                  // (name + phone, email optional). It is saved to the customer and
                  // selected at once, so the DO prints it. Other orgs: unchanged.
                  {...(isOfficeDoEditsEnabled ? { addContactMode: "inline" as const } : {})}
                />

                {/* Missing a role -> show the customer-information link outright.
                    No chips, no prose, no button: if the office has to be told the
                    project is short a contact, the useful thing is the link itself,
                    already there to copy. Nothing renders when both roles are
                    present — there is nothing to ask for. */}
                {contactCoverage && (!contactCoverage.DO || !contactCoverage.INVOICE) && ciLink && (
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
                    <TextField
                      value={ciLink}
                      size="small"
                      fullWidth
                      label="Customer information link"
                      InputProps={{ readOnly: true }}
                      InputLabelProps={{ shrink: true }}
                      onFocus={(e) => e.target.select()}
                    />
                    <Button size="small" onClick={() => void navigator.clipboard?.writeText(ciLink)}>
                      Copy
                    </Button>
                  </Stack>
                )}
              </Box>
            )}

          </>
        )}

        {/* 2b) SALE ORDER — in the flat form it sits directly below the contacts
            and is REQUIRED to schedule. In the stepped dialog it is one of the
            three answers to "what is this based on?", so it lives on the
            paperwork step and only shows once she has chosen it.
            Replaces the old free-typed PO number either way: the office picks a
            real SALES_ORDER document, so the run carries a pointer
            (config.saleOrderId) a later invoice can walk back to for prices,
            not just a PO string. */}
        {!serviceJobs && onStep(1) && (!wizard || sourceKind === "SALES_ORDER") && (
          <>
            {!wizard && <Divider sx={{ my: 2 }} />}
            <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
              Sales Order
            </Typography>
            <TextField
              label="Sales Order"
              placeholder="No Sales Order selected"
              value={saleOrder ? `${saleOrder.name}${saleOrder.customerPo ? ` · ${saleOrder.customerPo}` : ""}` : ""}
              onClick={() => void openSaleOrders()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  void openSaleOrders();
                }
              }}
              fullWidth
              size="small"
              required={!isOptionalSaleOrderEnabled}
              error={!isOptionalSaleOrderEnabled && poTouched && !saleOrder}
              InputProps={{
                readOnly: true,
                endAdornment: (
                  <InputAdornment position="end">
                    {saleOrder ? (
                      <IconButton
                        size="small"
                        aria-label="Clear the selected Sales Order"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSaleOrder(null);
                          setPoNumber("");
                          setPoTouched(true);
                        }}
                      >
                        <DeleteOutlineIcon fontSize="small" />
                      </IconButton>
                    ) : (
                      <SearchIcon fontSize="small" color="action" />
                    )}
                  </InputAdornment>
                ),
              }}
              InputLabelProps={{ shrink: true }}
              helperText={
                isOptionalSaleOrderEnabled
                  ? undefined
                  : poTouched && !saleOrder
                  ? "Pick a Sales Order (required to schedule). Save as draft if it does not exist yet."
                  : 'The Sales Order\'s customer PO lands on the draft DO as "Your PO No."'
              }
              sx={{ cursor: "pointer", "& .MuiInputBase-input": { cursor: "pointer" } }}
            />
            {/* Upload only. "Find" is gone — the search icon inside the field opens
                the picker, and the field itself is clickable. Sits tight under the
                field rather than a row away. */}
            <Button
              size="small"
              startIcon={<CloudUploadIcon />}
              onClick={() => setSoUploadOpen(true)}
              sx={{ mt: 0.5, alignSelf: "flex-start" }}
            >
              Upload Sales Order
            </Button>

          </>
        )}

        {onStep(2) && (<>
        {/* 3) ADDRESS (auto-filled from the project; freely editable → DO "Deliver To").
            When auto-filled, render the text as clearly-present, editable content
            (solid text + shrunk label + subtle highlight) so it never reads as a
            greyed placeholder. */}
        <TextField
          label={isWctOrdersEnabled ? "Site address" : "Delivery address"}
          placeholder="Where the goods go. It lands on the DO's Deliver To."
          value={address}
          onChange={(e) => {
            setAddress(e.target.value);
            setAddressTouched(true);
          }}
          fullWidth
          size="small"
          multiline
          minRows={2}
          // Keep the label floated so the filled address sits plainly in the box;
          // force normal weight so the label never renders bold.
          InputLabelProps={{ shrink: true, sx: { fontWeight: 400 } }}
          helperText={
            address && !addressTouched
              ? (serviceJobs ? "Auto-filled from the customer's address. Edit if needed." : "Auto-filled from the project. Edit if needed.")
              : "Where the goods go. It lands on the DO's Deliver To."
          }
          sx={{
            mb: 2,
            // Full-strength text (never the muted placeholder colour).
            "& .MuiInputBase-input": { color: "text.primary", opacity: 1, fontWeight: 500 },
            // Subtle highlight while the value is still the project's auto-fill.
            ...(address && !addressTouched
              ? { "& .MuiOutlinedInput-root": { backgroundColor: "action.hover" } }
              : {}),
          }}
        />

        {/* Machine location — free-text sub-location beneath the address (tower,
            floor, unit). NOT a saved list; per-delivery detail. Lands on the DO's
            config.machineLocation, rendered under "Deliver To". */}
        <TextField
          label={serviceJobs ? "Location on site (optional)" : "Machine location (optional)"}
          placeholder={serviceJobs ? "Specific spot on site (kitchen, level, unit)" : "Specific spot on site (tower, floor, unit)"}
          value={machineLocation}
          onChange={(e) => setMachineLocation(e.target.value)}
          fullWidth
          size="small"
          helperText="More specific than the address. It lands on the DO under Deliver To."
          sx={{ mb: 2 }}
        />

        </>)}

        {onStep(3) && (<>
        {/* 4) PRODUCTS */}
        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
          {serviceJobs ? "Items" : "Products"}
        </Typography>
        <Stack spacing={1.5} sx={{ mb: 1 }}>
          {rows.map((row, i) => (
            // Phone: qty/type fields wrap under the product picker instead of clipping
            <Stack key={i} direction="row" spacing={1} alignItems="flex-start" sx={{ flexWrap: { xs: "wrap", sm: "nowrap" }, rowGap: 1 }}>
              {row.freeTyped ? (
                // Free-typed line: a description (no catalog product). Carries to the
                // DO as a plain line; a rider can never unit-bind to it.
                <TextField
                  size="small"
                  label="Free-typed item"
                  placeholder="e.g. 1 set 25 mm 5 core cable"
                  value={row.description}
                  onChange={(e) => setRow(i, { description: e.target.value })}
                  sx={{ flex: 1 }}
                />
              ) : (
                <Autocomplete<AssetOption, false, false, false>
                  sx={{ flex: 1 }}
                  size="small"
                  options={assetOptions}
                  filterOptions={(x) => x}
                  value={row.asset}
                  onChange={(_, picked) => setRow(i, { asset: picked })}
                  onInputChange={(_, v, reason) => {
                    if (reason === "input") setAssetInput(v);
                  }}
                  getOptionLabel={(o) => `${o.name} · ${o.skuKey}`}
                  isOptionEqualToValue={(a, b) => a.id === b.id}
                  loading={assetSearching}
                  renderInput={(params) => (
                    <TextField {...params} label="Product" placeholder="Search by name or SKU" />
                  )}
                />
              )}
              {/* Free-typed rows set their class here (no catalog product behind the
                  line); it decides how many photos the field must take. On the SAME
                  line as the description and qty. */}
              {row.freeTyped && (
                <TextField
                  select
                  size="small"
                  label="Type"
                  value={row.assetClass}
                  onChange={(e) => setRow(i, { assetClass: normalizeAssetClass(e.target.value) })}
                  sx={{ width: 140 }}
                >
                  {freeClassOptions.map((o) => (
                    <MenuItem key={o.value} value={o.value}>
                      {o.label}
                    </MenuItem>
                  ))}
                </TextField>
              )}
              <TextField
                label="Qty"
                type="number"
                size="small"
                value={row.quantity}
                onChange={(e) => setRow(i, { quantity: e.target.value.replace(/[^0-9]/g, "") })}
                onBlur={() => setRow(i, { quantity: String(Math.max(1, parseInt(row.quantity, 10) || 1)) })}
                sx={{ width: 88 }}
                inputProps={{ min: 1, inputMode: "numeric" }}
              />
              <IconButton
                aria-label="remove"
                onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((_, idx) => idx !== i) : rs))}
                disabled={rows.length === 1}
                sx={{ mt: 0.5 }}
              >
                <DeleteOutlineIcon />
              </IconButton>
            </Stack>
          ))}
        </Stack>
        <Stack direction="row" spacing={1}>
          <Button size="small" startIcon={<AddIcon />} onClick={() => setRows((rs) => [...rs, { asset: null, description: "", freeTyped: false, quantity: "1", assetClass: DEFAULT_ASSET_CLASS }])}>
            Add product
          </Button>
          <Button size="small" startIcon={<AddIcon />} onClick={() => setRows((rs) => [...rs, { asset: null, description: "", freeTyped: true, quantity: "1", assetClass: newFreeClass }])}>
            Free type item
          </Button>
        </Stack>

        </>)}

        {onStep(4) && (<>
        {!wizard && <Divider sx={{ my: 2 }} />}

        {/* 5) SCHEDULING (last) — date + time. The PO moved up to sit with the
            Sales Order picker, directly below the contacts. */}
        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
          Scheduling
        </Typography>
        <Stack direction="row" spacing={1.5} sx={{ flexWrap: { xs: "wrap", sm: "nowrap" }, rowGap: 1.5 }}>
          {/* MUI DatePicker (Popper) instead of a native date input: its calendar
              flips above the field when there is no room below, so it stays fully
              clickable even though this field sits low in the form. */}
          <LocalizationProvider dateAdapter={AdapterDayjs}>
            <DatePicker
              format="DD/MM/YYYY"
              label="Date"
              value={scheduleDate ? dayjs(scheduleDate) : null}
              onChange={(d) => setScheduleDate(d && d.isValid() ? d.format("YYYY-MM-DD") : "")}
              slotProps={{
                textField: { size: "small", fullWidth: true, required: true, InputLabelProps: { shrink: true } },
              }}
            />
          </LocalizationProvider>
          {!allDay && (
            <TextField
              label="Time"
              type="time"
              value={scheduleTime}
              onChange={(e) => setScheduleTime(e.target.value)}
              size="small"
              InputLabelProps={{ shrink: true }}
              inputProps={{ step: 300 }}
              sx={{ width: 140, flexShrink: 0 }}
              required
            />
          )}
          <FormControlLabel
            control={<Checkbox size="small" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />}
            label="No specific time"
            sx={{ flexShrink: 0, mr: 0, whiteSpace: "nowrap" }}
          />
        </Stack>
        {isSiteClockLinkEnabled && (
          <SiteClockSchedulePicker open={open} value={scPick} onChange={setScPick} onEnabled={setScLive} scheduleTime={scheduleTime} allDay={allDay} />
        )}

        {isJobFieldsEnabled && jobFieldDefs.length > 0 && (
          <Box sx={{ mt: 2.5 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
              Job details
            </Typography>
            <JobFieldsEditor fields={jobFieldDefs} values={jobFieldValues} onChange={setJobFieldValues} checkRequired disabled={submitting} />
          </Box>
        )}

        </>)}

        {note && <Alert severity="info" sx={{ mt: 2 }} onClose={() => setNote(null)}>{note}</Alert>}
        {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
        </SplitIf>
      </DialogContent>
      {split && <SlotHintsAlert lines={slotHintLines} />}
      {/* Why the blocker reads as text rather than a tooltip: a disabled Next
          with no explanation is the single most common complaint about stepped
          forms. It sits where the eye already is, next to the button. */}
      {wizard && blocked && (
        <Typography variant="caption" color="text.secondary" sx={{ px: 3, pb: 0.5, textAlign: "right" }}>
          {blocked}
        </Typography>
      )}
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>Cancel</Button>
        <Box sx={{ flexGrow: 1 }} />
        {/* Save as draft, from any step. The backend has always allowed a draft
            with almost nothing on it, and the office needs that when the job is
            booked before its paperwork lands. */}
        {wizard && (
          <Button onClick={() => void submit(true)} disabled={submitting}>
            Save as draft
          </Button>
        )}
        {wizard && activeStep > 0 && (
          <Button onClick={() => setActiveStep((n) => Math.max(0, n - 1))} disabled={submitting}>
            Back
          </Button>
        )}
        {wizard && activeStep < STEPS.length - 1 ? (
          <Button variant="contained" onClick={() => setActiveStep((n) => n + 1)} disabled={!!blocked || submitting}>
            Next
          </Button>
        ) : (
          <Button variant="contained" onClick={() => void submit(false)} disabled={!canSubmit}>
            {submitting ? <CircularProgress size={18} /> : editRun ? "Save changes" : "Schedule"}
          </Button>
        )}
      </DialogActions>

      <ExtractQuotationDialog
        open={quoteOpen}
        onClose={() => setQuoteOpen(false)}
        onSelectQuotation={applyQuotation}
        quotations={quotations as any}
        selectedCustomerId={customer?.id}
        selectedCustomerName={customer?.name}
      />

      {/* Inline create-customer dialog */}
      <Dialog open={createCustomerOpen} onClose={() => !creatingCustomer && setCreateCustomerOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>New customer</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            label="Customer name"
            value={createCustomerName}
            onChange={(e) => setCreateCustomerName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreateCustomer()}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateCustomerOpen(false)} disabled={creatingCustomer}>Cancel</Button>
          <Button variant="contained" onClick={handleCreateCustomer} disabled={creatingCustomer || !createCustomerName.trim()}>
            {creatingCustomer ? <CircularProgress size={18} /> : "Create"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Inline create-project dialog */}
      <Dialog open={createProjectOpen} onClose={() => !creatingProject && setCreateProjectOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>New project</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            label="Project name"
            value={createProjectName}
            onChange={(e) => setCreateProjectName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreateProject()}
            sx={{ mt: 1 }}
          />
        </DialogContent>

        <DialogActions>
          <Button onClick={() => setCreateProjectOpen(false)} disabled={creatingProject}>Cancel</Button>
          <Button variant="contained" onClick={() => void handleCreateProject()} disabled={creatingProject || !createProjectName.trim()}>
            {creatingProject ? <CircularProgress size={18} /> : "Create"}
          </Button>
        </DialogActions>
      </Dialog>
      {/* Sales Order picker — Locate Customer styling, with Upload in its footer
          so an office user who cannot find the order can create it in place. */}
      <SaleOrderSelectDialog
        open={soOpen}
        onClose={() => setSoOpen(false)}
        rows={soRows}
        loading={soLoading}
        onSelect={selectSaleOrder}
        footerAction={
          <Button size="small" startIcon={<CloudUploadIcon />} onClick={() => { setSoOpen(false); setSoUploadOpen(true); }}>
            Upload Sales Order
          </Button>
        }
      />

      {/* Same dialog the Sales Orders page uses, with navigation suppressed:
          its single-file fast path routes into the document editor, which would
          throw away the half-entered schedule behind it. */}
      <DocumentUploadDialog
        open={soUploadOpen}
        onClose={() => setSoUploadOpen(false)}
        documentType="SALES_ORDER"
        documentLabel="Sales Order"
        navigateOnSingle={false}
        onCreated={(created) => void onSaleOrderUploaded(created)}
      />
    </Dialog>
  );
}
