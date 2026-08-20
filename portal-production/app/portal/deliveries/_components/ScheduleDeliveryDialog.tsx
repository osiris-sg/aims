"use client";

import React, { useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import {
  ASSET_CLASS_OPTIONS,
  DEFAULT_ASSET_CLASS,
  normalizeAssetClass,
  type AssetClass,
} from "@/helpers/assetClass";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import RequestQuoteIcon from "@mui/icons-material/RequestQuote";
import { request } from "@/helpers/request";
import ProjectContactPicker, { ContactLite } from "@/app/portal/projects/components/ProjectContactPicker";
import { useOrganization } from "@hooks/useOrganization";
import ExtractQuotationDialog from "@/containers/DocumentTemplates/components/ExtractQuotationDialog";

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
  document: {
    poNo?: string | null;
    machineLocation?: string | null;
  } | null;
  items: Array<{ asset: { id: string; name: string; skuKey: string } | null; quantity: number; description: string | null; assetClass?: string | null }>;
}

export default function ScheduleDeliveryDialog({
  open,
  onClose,
  onCreated,
  editRun,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  editRun?: EditRun | null;
}) {
  const { getToken } = useAuth();
  const { organization } = useOrganization();

  const [rows, setRows] = useState<Row[]>([{ asset: null, description: "", freeTyped: false, quantity: "1", assetClass: DEFAULT_ASSET_CLASS }]);
  // Date + time are held separately so BOTH are independently settable (a single
  // datetime-local left the time portion effectively uneditable for the office).
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("09:00");
  const [poNumber, setPoNumber] = useState("");
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
  const [projectContactIds, setProjectContactIds] = useState<string[]>([]);
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

  // Reset on (re)open — or PREFILL from the run being edited.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setNote(null);
    setCustomerInput("");
    setAssetInput("");
    setQuotations([]);
    // Re-arm the customer-change guard below: on a fresh open, the first run of
    // that effect must NOT be treated as a customer change.
    loadedForCustomerRef.current = undefined;
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
        setScheduleTime(`${pad(d.getHours())}:${pad(d.getMinutes())}`);
      } else {
        setScheduleDate("");
        setScheduleTime("09:00");
      }
      setPoNumber(editRun.document?.poNo ?? "");
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
    setPoNumber("");
    setAddress("");
    setAddressTouched(false);
    setMachineLocation("");
    setCustomer(null);
    setProject(null);
  }, [open, editRun]);

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

  // OSI-84 — load the chosen project's attached contacts (clear when none). The
  // DO's Attention is derived from the FIRST of these server-side, so the picker
  // selection is the only contact input.
  useEffect(() => {
    if (!project) {
      setProjectContactIds([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const res = await request({ path: `/projects/${project.id}/contacts`, method: "GET" }, {}, token);
        const list = (res?.data ?? res) as ContactLite[];
        if (cancelled) return;
        setProjectContactIds(Array.isArray(list) ? list.map((c) => c.id) : []);
      } catch {
        if (!cancelled) setProjectContactIds([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [project, getToken]);

  // Persist the project's contact set (this project already exists, so save now).
  const saveProjectContacts = async (ids: string[]) => {
    setProjectContactIds(ids);
    if (!project) return;
    try {
      const token = await getToken();
      if (!token) return;
      await request(
        { path: `/projects/${project.id}/contacts`, method: "PUT" },
        { contactIds: ids },
        token,
      );
    } catch {
      /* non-blocking: the picker keeps the selection; a later save can retry */
    }
  };

  // Auto-fill the delivery address from the PROJECT NAME — for this fleet a
  // project's name IS its site address (e.g. "Tuas Avenue 8"). Freely editable
  // afterwards; lands on the DO's "Deliver To".
  useEffect(() => {
    if (addressTouched) return;
    setAddress(project?.name || "");
  }, [project, addressTouched]);

  const setRow = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  // A row counts when it has qty ≥ 1 AND either a picked product OR (free-typed)
  // a non-empty description.
  const validRows = rows.filter(
    (r) => (r.freeTyped ? r.description.trim().length > 0 : !!r.asset) && (parseInt(r.quantity, 10) || 0) >= 1,
  );
  const canSubmit = !!scheduleDate && !!scheduleTime && !!project && validRows.length > 0 && !submitting;

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
  const applyQuotation = async (q: any) => {
    setQuoteOpen(false);
    setError(null);
    const cfg = q?.config || {};
    // Quotations in this org use `referenceNo`/`poNo` — read either (both empty in
    // current data, so this is defensive and simply won't fire).
    const poValue = cfg.poNo || cfg.referenceNo;
    if (poValue) setPoNumber(String(poValue));
    if (cfg.customerAddress) {
      setAddress(String(cfg.customerAddress));
      setAddressTouched(true);
    }
    // The project lives on the Document.projectId COLUMN (now surfaced top-level by
    // getDocumentsPaginated), not in config — real quotations only populate the
    // column. Prefer the column, fall back to legacy config.projectId.
    const pid = q?.projectId ?? cfg.projectId;
    const pname = q?.projectName ?? cfg.projectName;
    if (pid) {
      const match = projectOptions.find((p) => p.id === pid);
      setProject(match ?? { id: String(pid), name: pname || "Project from quotation" });
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
          const r = await request({ path: `/assets/${encodeURIComponent(id)}`, method: "GET" }, {}, token);
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
          const freeRow: Row = { asset: null, description: cleanText, freeTyped: true, quantity: qty, assetClass: DEFAULT_ASSET_CLASS };
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
      const parts = [`Quotation applied — ${matched}/${finalRows.length} line(s) matched a catalog product; the rest are free-typed.`];
      parts.push(filledPo ? "PO number filled." : "No PO on the quotation.");
      parts.push(filledProject ? "Project taken from the quotation." : "This quotation has no project — pick one below (required).");
      parts.push("Review products, quantities & address.");
      setNote(parts.join(" "));
    } else {
      const parts = ["Quotation applied — it had no line items."];
      parts.push(filledPo ? "PO number filled." : "No PO on the quotation.");
      parts.push(filledProject ? "Project taken from the quotation." : "This quotation has no project — pick one below (required).");
      setNote(parts.join(" "));
    }
  };

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
      const res = await request({ path: "/customers/create-by-name", method: "POST" }, { name: trimmed }, token);
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
  const handleCreateProject = async () => {
    const trimmed = createProjectName.trim();
    if (!trimmed || !customer) return;
    setCreatingProject(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const res = await request(
        { path: "/projects/create-by-name", method: "POST" },
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
    setSubmitting(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      // Combine the separate date + time into one local datetime → ISO.
      // A draft may have no date yet, so only build one when there is a date.
      const scheduledFor = scheduleDate
        ? new Date(`${scheduleDate}T${scheduleTime || "09:00"}`).toISOString()
        : undefined;
      const res = await request(
        editRun
          ? { path: `/deliveries/scheduled/${editRun.id}`, method: "PATCH" }
          : { path: "/deliveries/scheduled", method: "POST" },
        {
          ...(asDraft ? { isDraft: true } : {}),
          ...(scheduledFor ? { scheduledFor } : {}),
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
          ...(address.trim() ? { address: address.trim() } : {}),
          ...(machineLocation.trim() ? { machineLocation: machineLocation.trim() } : {}),
          ...(customer ? { customerId: customer.id } : {}),
          ...(project ? { projectId: project.id } : {}),
        },
        token,
      );
      if (res?.success === false) throw new Error(res?.message ?? (asDraft ? "Failed to save the draft" : "Failed to schedule delivery"));
      onCreated();
      onClose();
    } catch (e: any) {
      const m = e?.message;
      setError((Array.isArray(m) ? m.join(". ") : m) || "Failed to schedule delivery");
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
      maxWidth="sm"
    >
      <DialogTitle>{editRun ? "Edit scheduled delivery" : "Schedule a delivery"}</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          The run is fulfilled when a rider starts a matching unit in the field and assigns it to
          this project. No unit is reserved now.
        </Typography>

        {/* 1) CUSTOMER */}
        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
          Customer &amp; project
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

        {/* Quotation extraction — available once a customer is chosen. */}
        <Button
          size="small"
          startIcon={quoteLoading ? <CircularProgress size={16} /> : <RequestQuoteIcon />}
          onClick={openQuotations}
          disabled={!customer || quoteLoading}
          sx={{ mb: 1.5 }}
        >
          Extract from quotation
        </Button>

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

        {/* OSI-84 — contact people for this project (saved to the project). The
            DO's Attention uses the FIRST selected contact (primary-first). */}
        {project && (
          <Box sx={{ mb: 2 }}>
            <ProjectContactPicker
              customerId={customer?.id ?? null}
              value={projectContactIds}
              onChange={(ids) => void saveProjectContacts(ids)}
              label="Project contacts"
            />
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
              The Delivery Order&apos;s Attention uses the first selected contact.
            </Typography>
          </Box>
        )}

        {/* 3) ADDRESS (auto-filled from the project; freely editable → DO "Deliver To").
            When auto-filled, render the text as clearly-present, editable content
            (solid text + shrunk label + subtle highlight) so it never reads as a
            greyed placeholder. */}
        <TextField
          label="Delivery address"
          placeholder="Where the goods go — lands on the DO's Deliver To"
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
              ? "Auto-filled from the project — edit if needed"
              : "Where the goods go — lands on the DO's Deliver To"
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
          label="Machine location (optional)"
          placeholder="Specific spot on site — tower, floor, unit"
          value={machineLocation}
          onChange={(e) => setMachineLocation(e.target.value)}
          fullWidth
          size="small"
          helperText="More specific than the address — lands on the DO under Deliver To"
          sx={{ mb: 2 }}
        />

        {/* 4) PRODUCTS */}
        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
          Products
        </Typography>
        <Stack spacing={1.5} sx={{ mb: 1 }}>
          {rows.map((row, i) => (
            <Stack key={i} direction="row" spacing={1} alignItems="flex-start">
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
                  {ASSET_CLASS_OPTIONS.map((o) => (
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
          <Button size="small" startIcon={<AddIcon />} onClick={() => setRows((rs) => [...rs, { asset: null, description: "", freeTyped: true, quantity: "1", assetClass: DEFAULT_ASSET_CLASS }])}>
            Free type item
          </Button>
        </Stack>

        <Divider sx={{ my: 2 }} />

        {/* 5) SCHEDULING (last) — PO + date + time */}
        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
          Scheduling
        </Typography>
        <TextField
          label="PO number (optional)"
          placeholder="Customer's PO number"
          value={poNumber}
          onChange={(e) => setPoNumber(e.target.value)}
          fullWidth
          size="small"
          helperText='Lands on the draft DO as "Your PO No."'
          sx={{ mb: 2 }}
        />
        <Stack direction="row" spacing={1.5}>
          <TextField
            label="Date"
            type="date"
            value={scheduleDate}
            onChange={(e) => setScheduleDate(e.target.value)}
            fullWidth
            size="small"
            InputLabelProps={{ shrink: true }}
            required
          />
          <TextField
            label="Time"
            type="time"
            value={scheduleTime}
            onChange={(e) => setScheduleTime(e.target.value)}
            size="small"
            InputLabelProps={{ shrink: true }}
            inputProps={{ step: 300 }}
            sx={{ width: 140 }}
            required
          />
        </Stack>

        {note && <Alert severity="info" sx={{ mt: 2 }} onClose={() => setNote(null)}>{note}</Alert>}
        {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>Cancel</Button>
        <Button variant="contained" onClick={() => void submit(false)} disabled={!canSubmit}>
          {submitting ? <CircularProgress size={18} /> : editRun ? "Save changes" : "Schedule"}
        </Button>
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
          <Button variant="contained" onClick={handleCreateProject} disabled={creatingProject || !createProjectName.trim()}>
            {creatingProject ? <CircularProgress size={18} /> : "Create"}
          </Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  );
}
