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
  IconButton,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import { request } from "@/helpers/request";
import { useOrganization } from "@hooks/useOrganization";

/**
 * Office "Schedule a delivery" dialog. Picks ASSETS (+ quantities) — NOT specific
 * units — a date/time, and optionally a customer/project, then POSTs
 * /deliveries/scheduled to create a `scheduled` run (no rider, nothing reserved).
 * A rider claims it later by scanning any matching unit.
 */

interface AssetOption { id: string; name: string; skuKey: string }
interface CustomerOption { id: string; name: string; customerCode: string | null }
interface ProjectOption { id: string; name: string }
interface Row { asset: AssetOption | null; quantity: number }

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

  const [rows, setRows] = useState<Row[]>([{ asset: null, quantity: 1 }]);
  const [scheduledFor, setScheduledFor] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Asset search (shared list; each row's Autocomplete filters against it).
  const [assetOptions, setAssetOptions] = useState<AssetOption[]>([]);
  const [assetInput, setAssetInput] = useState("");
  const [assetSearching, setAssetSearching] = useState(false);

  // Optional customer → project.
  const [customerOptions, setCustomerOptions] = useState<CustomerOption[]>([]);
  const [customer, setCustomer] = useState<CustomerOption | null>(null);
  const [customerInput, setCustomerInput] = useState("");
  const [projectOptions, setProjectOptions] = useState<ProjectOption[]>([]);
  const [project, setProject] = useState<ProjectOption | null>(null);

  // Reset on (re)open.
  useEffect(() => {
    if (open) {
      setRows([{ asset: null, quantity: 1 }]);
      setScheduledFor("");
      setError(null);
      setCustomer(null);
      setProject(null);
      setCustomerInput("");
      setAssetInput("");
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

  // Debounced customer search.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const t = setTimeout(async () => {
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
            Array.isArray(docs) ? docs.map((c: any) => ({ id: c.id, name: c.name, customerCode: c.customerCode ?? null })) : [],
          );
        }
      } catch {
        /* optional */
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [customerInput, open, getToken]);

  // Load projects for the chosen customer.
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
        if (!cancelled) setProjectOptions(Array.isArray(docs) ? docs.map((p: any) => ({ id: p.id, name: p.name })) : []);
      } catch {
        /* optional */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [customer, getToken]);

  const setRow = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const validRows = rows.filter((r) => r.asset && r.quantity >= 1);
  const canSubmit = !!scheduledFor && validRows.length > 0 && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const res = await request(
        { path: "/deliveries/scheduled", method: "POST" },
        {
          scheduledFor: new Date(scheduledFor).toISOString(),
          items: validRows.map((r) => ({ assetId: r.asset!.id, quantity: r.quantity })),
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
          Pick the products (by type + quantity) and when they should go out. No unit is
          reserved now — a rider picks it up by scanning any matching unit in the field.
        </Typography>

        <TextField
          label="Scheduled for"
          type="datetime-local"
          value={scheduledFor}
          onChange={(e) => setScheduledFor(e.target.value)}
          fullWidth
          size="small"
          InputLabelProps={{ shrink: true }}
          sx={{ mb: 2 }}
        />

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
                onChange={(e) => setRow(i, { quantity: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                sx={{ width: 88 }}
                inputProps={{ min: 1 }}
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
        <Button size="small" startIcon={<AddIcon />} onClick={() => setRows((rs) => [...rs, { asset: null, quantity: 1 }])}>
          Add another product
        </Button>

        <Box sx={{ mt: 2 }}>
          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
            Customer / project (optional)
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
            renderInput={(params) => <TextField {...params} label="Customer" placeholder="Search customers" />}
            sx={{ mb: 1.5 }}
          />
          {customer && (
            <Autocomplete<ProjectOption, false, false, false>
              size="small"
              options={projectOptions}
              value={project}
              onChange={(_, picked) => setProject(picked)}
              getOptionLabel={(o) => o.name}
              isOptionEqualToValue={(a, b) => a.id === b.id}
              noOptionsText="No projects for this customer yet."
              renderInput={(params) => <TextField {...params} label="Project" placeholder="Pick a project" />}
            />
          )}
        </Box>

        {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>Cancel</Button>
        <Button variant="contained" onClick={submit} disabled={!canSubmit}>
          {submitting ? <CircularProgress size={18} /> : "Schedule"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
