"use client";

import React, { useEffect, useState } from "react";
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
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import RequestQuoteIcon from "@mui/icons-material/RequestQuote";
import { request } from "@/helpers/request";
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
interface ProjectOption { id: string; name: string; siteOfficeAddress: string | null }
// quantity is a RAW STRING so the field is freely typeable; clamped on blur/submit.
interface Row { asset: AssetOption | null; quantity: string }

export default function ScheduleDeliveryDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { getToken } = useAuth();
  const { organization } = useOrganization();

  const [rows, setRows] = useState<Row[]>([{ asset: null, quantity: "1" }]);
  // Date + time are held separately so BOTH are independently settable (a single
  // datetime-local left the time portion effectively uneditable for the office).
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("09:00");
  const [poNumber, setPoNumber] = useState("");
  const [address, setAddress] = useState("");
  // Once the user edits the address, stop auto-overwriting it on project change.
  const [addressTouched, setAddressTouched] = useState(false);
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
  const [project, setProject] = useState<ProjectOption | null>(null);

  // Quotation extraction (opened after a customer is chosen).
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [quotations, setQuotations] = useState<any[]>([]);
  const [quoteLoading, setQuoteLoading] = useState(false);

  // Reset on (re)open.
  useEffect(() => {
    if (open) {
      setRows([{ asset: null, quantity: "1" }]);
      setScheduleDate("");
      setScheduleTime("09:00");
      setPoNumber("");
      setAddress("");
      setAddressTouched(false);
      setError(null);
      setNote(null);
      setCustomer(null);
      setProject(null);
      setCustomerInput("");
      setAssetInput("");
      setQuotations([]);
    }
  }, [open]);

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
  useEffect(() => {
    setProject(null);
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
            Array.isArray(docs)
              ? docs.map((p: any) => ({ id: p.id, name: p.name, siteOfficeAddress: p.siteOffice?.address ?? null }))
              : [],
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

  // Auto-fill the address from the project's site office (fallback: customer),
  // unless the user has already typed one.
  useEffect(() => {
    if (addressTouched) return;
    setAddress(project?.siteOfficeAddress || customer?.address || "");
  }, [project, customer, addressTouched]);

  const setRow = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const validRows = rows.filter((r) => r.asset && (parseInt(r.quantity, 10) || 0) >= 1);
  const canSubmit = !!scheduleDate && !!scheduleTime && !!project && validRows.length > 0 && !submitting;

  // Fetch the customer's CONFIRMED quotations and open the extract dialog.
  const openQuotations = async () => {
    if (!customer) return;
    setQuoteLoading(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const res = await request({ path: "/documents", method: "POST" }, { organizationId: organization?.id }, token);
      const qTypes = ["QUOTATION", "QT", "QO", "QO1", "QO2"];
      const list = (res?.data || []).filter(
        (d: any) =>
          qTypes.includes(String(d.documentType || d.type || "").toUpperCase()) &&
          d.config?.customerId === customer.id &&
          d.status === "confirmed",
      );
      setQuotations(list);
      setQuoteOpen(true);
      if (list.length === 0) setNote("No confirmed quotations found for this customer.");
    } catch (e: any) {
      setError(e?.message ?? "Couldn't load quotations");
    } finally {
      setQuoteLoading(false);
    }
  };

  // Apply a selected quotation: autofill project + address + PO + line items.
  // Quotation lines are description-only (no catalog assetId), so each is
  // best-effort resolved to a product via /assets/search; unmatched lines land
  // with their quantity and a blank product for the office to pick. All editable.
  const applyQuotation = async (q: any) => {
    setQuoteOpen(false);
    setError(null);
    const cfg = q?.config || {};
    if (cfg.poNo) setPoNumber(String(cfg.poNo));
    if (cfg.customerAddress) {
      setAddress(String(cfg.customerAddress));
      setAddressTouched(true);
    }
    if (cfg.projectId) {
      const match = projectOptions.find((p) => p.id === cfg.projectId);
      setProject(match ?? { id: String(cfg.projectId), name: cfg.projectName || "Project from quotation", siteOfficeAddress: null });
    }
    const items: any[] = Array.isArray(cfg.items) ? cfg.items : [];
    if (items.length) {
      let token: string | null = null;
      try {
        token = await getToken();
      } catch {
        /* ignore */
      }
      const resolved: Row[] = await Promise.all(
        items.map(async (it) => {
          const qty = String(Math.max(1, parseInt(it?.quantity, 10) || 1));
          const text = String(it?.itemCode || it?.sku || it?.description || "").trim();
          if (!text || !token) return { asset: null, quantity: qty };
          try {
            const r = await request(
              { path: `/assets/search?q=${encodeURIComponent(text.slice(0, 60))}`, method: "GET" },
              {},
              token,
            );
            const arr = Array.isArray(r?.data) ? r.data : Array.isArray(r) ? r : [];
            return { asset: arr[0] ?? null, quantity: qty };
          } catch {
            return { asset: null, quantity: qty };
          }
        }),
      );
      const finalRows = resolved.length ? resolved : [{ asset: null, quantity: "1" }];
      setRows(finalRows);
      const matched = finalRows.filter((r) => r.asset).length;
      setNote(`Quotation applied — ${matched}/${finalRows.length} line(s) matched a product. Review products, quantities & address.`);
    } else {
      setNote("Quotation applied (customer/project/address). It had no line items.");
    }
  };

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      // Combine the separate date + time into one local datetime → ISO.
      const scheduledFor = new Date(`${scheduleDate}T${scheduleTime}`).toISOString();
      const res = await request(
        { path: "/deliveries/scheduled", method: "POST" },
        {
          scheduledFor,
          items: validRows.map((r) => ({ assetId: r.asset!.id, quantity: Math.max(1, parseInt(r.quantity, 10) || 1) })),
          ...(poNumber.trim() ? { poNumber: poNumber.trim() } : {}),
          ...(address.trim() ? { address: address.trim() } : {}),
          ...(customer ? { customerId: customer.id } : {}),
          ...(project ? { projectId: project.id } : {}),
        },
        token,
      );
      if (res?.success === false) throw new Error(res?.message ?? "Failed to schedule delivery");
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
    <Dialog open={open} onClose={() => !submitting && onClose()} fullWidth maxWidth="sm">
      <DialogTitle>Schedule a delivery</DialogTitle>
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
          sx={{ mb: 1 }}
        />

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
          noOptionsText="No projects for this customer yet."
          renderInput={(params) => (
            <TextField
              {...params}
              label="Project"
              placeholder={customer ? "Pick a project" : "Pick a customer first"}
              required
              error={!!customer && !project}
              helperText="Required — the rider is matched back to this run by the project."
            />
          )}
          sx={{ mb: 2 }}
        />

        {/* 3) ADDRESS (auto-filled from the project; freely editable → DO "Deliver To") */}
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
          helperText="Auto-filled from the project; edit as needed."
          sx={{ mb: 2 }}
        />

        {/* 4) PRODUCTS */}
        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
          Products
        </Typography>
        <Stack spacing={1.5} sx={{ mb: 1 }}>
          {rows.map((row, i) => (
            <Stack key={i} direction="row" spacing={1} alignItems="flex-start">
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
        <Button size="small" startIcon={<AddIcon />} onClick={() => setRows((rs) => [...rs, { asset: null, quantity: "1" }])}>
          Add another product
        </Button>

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
        <Button variant="contained" onClick={submit} disabled={!canSubmit}>
          {submitting ? <CircularProgress size={18} /> : "Schedule"}
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
    </Dialog>
  );
}
