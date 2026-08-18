"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  IconButton,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import { request } from "@/helpers/request";

interface CustomerOption {
  id: string;
  name: string;
  customerCode: string | null;
}
interface ProjectOption {
  id: string;
  name: string;
}
// A unit currently out on rental under the chosen project, available to collect.
interface UnitRow {
  inventoryId: string;
  sku: string;
  assetName: string;
}
// A unit added to the return basket (carries its project for the mixed-project note).
interface BasketUnit extends UnitRow {
  projectId: string;
  projectName: string;
}

/**
 * Office "Schedule a return" dialog. CUSTOMER -> PROJECT -> that project's units
 * currently out on rental (multi-select) -> add to a basket. Repeatable across
 * projects into ONE basket, then scheduled date + time. Submits the unit ids to
 * POST /deliveries/scheduled-return, which creates one scheduled RETURN run
 * (unit-bound items, no document, no reservation).
 */
export default function ScheduleReturnDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { getToken } = useAuth();

  const [customerOptions, setCustomerOptions] = useState<CustomerOption[]>([]);
  const [customer, setCustomer] = useState<CustomerOption | null>(null);
  const [customerInput, setCustomerInput] = useState("");
  const [customerSearching, setCustomerSearching] = useState(false);

  const [projectOptions, setProjectOptions] = useState<ProjectOption[]>([]);
  const [project, setProject] = useState<ProjectOption | null>(null);
  const [projectsLoading, setProjectsLoading] = useState(false);

  // Units for the currently-selected project, and which are ticked.
  const [units, setUnits] = useState<UnitRow[]>([]);
  const [unitsLoading, setUnitsLoading] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  // The accumulating basket across projects.
  const [basket, setBasket] = useState<BasketUnit[]>([]);

  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("09:00");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset everything each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setCustomerOptions([]);
    setCustomer(null);
    setCustomerInput("");
    setProjectOptions([]);
    setProject(null);
    setUnits([]);
    setChecked(new Set());
    setBasket([]);
    setScheduleDate("");
    setScheduleTime("09:00");
    setNotes("");
    setError(null);
  }, [open]);

  // Debounced customer search.
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
        if (cancelled) return;
        const docs = res?.data?.docs;
        setCustomerOptions(
          Array.isArray(docs) ? docs.map((c: any) => ({ id: c.id, name: c.name, customerCode: c.customerCode ?? null })) : [],
        );
      } catch {
        /* keep last results */
      } finally {
        if (!cancelled) setCustomerSearching(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [customerInput, open, getToken]);

  // Load the selected customer's projects; changing customer clears the pick.
  useEffect(() => {
    setProject(null);
    setProjectOptions([]);
    setUnits([]);
    setChecked(new Set());
    if (!customer) return;
    let cancelled = false;
    (async () => {
      setProjectsLoading(true);
      try {
        const token = await getToken();
        if (!token) return;
        const res = await request(
          { path: "/projects", method: "POST" },
          { page: 1, limit: 50, filters: { customerId: customer.id } },
          token,
        );
        if (cancelled) return;
        const docs = res?.data?.docs;
        setProjectOptions(Array.isArray(docs) ? docs.map((p: any) => ({ id: p.id, name: p.name })) : []);
      } catch {
        /* non-fatal */
      } finally {
        if (!cancelled) setProjectsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [customer, getToken]);

  // Load the selected project's units currently out on rental (from its ACTIVE
  // deployments). Reuses GET /projects/:id/deployments.
  useEffect(() => {
    setUnits([]);
    setChecked(new Set());
    if (!project) return;
    let cancelled = false;
    (async () => {
      setUnitsLoading(true);
      try {
        const token = await getToken();
        if (!token) return;
        const res = await request({ path: `/projects/${project.id}/deployments`, method: "GET" }, {}, token);
        if (cancelled) return;
        const data = res?.data ?? res;
        const deps: any[] = Array.isArray(data) ? data : data?.deployments ?? [];
        const rows: UnitRow[] = [];
        const seen = new Set<string>();
        for (const dep of deps) {
          for (const a of dep?.assignments ?? []) {
            const inv = a?.inventory;
            // Only units genuinely OUT on rental can be collected back.
            if (inv?.id && inv.status === "rental" && !seen.has(inv.id)) {
              seen.add(inv.id);
              rows.push({ inventoryId: inv.id, sku: inv.sku ?? inv.id, assetName: a?.asset?.name ?? "" });
            }
          }
        }
        setUnits(rows);
      } catch {
        /* non-fatal */
      } finally {
        if (!cancelled) setUnitsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [project, getToken]);

  const basketIds = useMemo(() => new Set(basket.map((b) => b.inventoryId)), [basket]);
  // Units not already in the basket (a unit can only be returned once).
  const selectableUnits = units.filter((u) => !basketIds.has(u.inventoryId));

  const toggle = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const addChecked = () => {
    if (!project || checked.size === 0) return;
    const toAdd = units
      .filter((u) => checked.has(u.inventoryId) && !basketIds.has(u.inventoryId))
      .map((u) => ({ ...u, projectId: project.id, projectName: project.name }));
    setBasket((prev) => [...prev, ...toAdd]);
    setChecked(new Set());
  };

  const removeFromBasket = (id: string) => setBasket((prev) => prev.filter((b) => b.inventoryId !== id));

  // Projects represented in the basket — drives the mixed-project note.
  const basketProjects = useMemo(() => new Set(basket.map((b) => b.projectId)), [basket]);

  const canSubmit = !!customer && basket.length > 0 && !!scheduleDate && !!scheduleTime && !submitting;

  const submit = async () => {
    if (!canSubmit || !customer) return;
    setSubmitting(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const scheduledFor = new Date(`${scheduleDate}T${scheduleTime}`).toISOString();
      const res = await request(
        { path: "/deliveries/scheduled-return", method: "POST" },
        {
          scheduledFor,
          customerId: customer.id,
          inventoryIds: basket.map((b) => b.inventoryId),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        },
        token,
      );
      if (res?.success === false) throw new Error(res?.message ?? "Failed to schedule return");
      onCreated();
      onClose();
    } catch (e: any) {
      const m = e?.message;
      setError((Array.isArray(m) ? m.join(". ") : m) || "Failed to schedule return");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={() => !submitting && onClose()} fullWidth maxWidth="sm">
      <DialogTitle>Schedule a return</DialogTitle>
      <DialogContent dividers>
        {/* 1) CUSTOMER */}
        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
          Customer
        </Typography>
        <Autocomplete
          options={customerOptions}
          value={customer}
          loading={customerSearching}
          onChange={(_, v) => setCustomer(v)}
          onInputChange={(_, v) => setCustomerInput(v)}
          getOptionLabel={(o) => (o.customerCode ? `${o.name} (${o.customerCode})` : o.name)}
          isOptionEqualToValue={(a, b) => a.id === b.id}
          renderInput={(params) => <TextField {...params} size="small" placeholder="Search customer" />}
          filterOptions={(x) => x}
          sx={{ mb: 2 }}
        />

        {/* 2) PROJECT + its units */}
        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
          Add units by project
        </Typography>
        <Autocomplete
          options={projectOptions}
          value={project}
          loading={projectsLoading}
          onChange={(_, v) => setProject(v)}
          getOptionLabel={(o) => o.name}
          isOptionEqualToValue={(a, b) => a.id === b.id}
          disabled={!customer}
          renderInput={(params) => (
            <TextField {...params} size="small" placeholder={customer ? "Choose a project" : "Pick a customer first"} />
          )}
          sx={{ mb: 1 }}
        />

        {project && (
          <Box sx={{ mb: 2 }}>
            {unitsLoading ? (
              <Box sx={{ display: "flex", justifyContent: "center", py: 2 }}>
                <CircularProgress size={22} />
              </Box>
            ) : selectableUnits.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
                No units out on rental for this project{units.length ? " (all already in the basket)" : ""}.
              </Typography>
            ) : (
              <>
                <Stack sx={{ maxHeight: 200, overflowY: "auto", border: "1px solid", borderColor: "divider", borderRadius: 1, px: 1, py: 0.5 }}>
                  {selectableUnits.map((u) => (
                    <FormControlLabel
                      key={u.inventoryId}
                      control={<Checkbox size="small" checked={checked.has(u.inventoryId)} onChange={() => toggle(u.inventoryId)} />}
                      label={
                        <Typography variant="body2">
                          {u.sku}
                          {u.assetName ? ` · ${u.assetName}` : ""}
                        </Typography>
                      }
                    />
                  ))}
                </Stack>
                <Button size="small" onClick={addChecked} disabled={checked.size === 0} sx={{ mt: 1, textTransform: "none" }}>
                  Add {checked.size || ""} selected to return
                </Button>
              </>
            )}
          </Box>
        )}

        {/* 3) BASKET */}
        {basket.length > 0 && (
          <>
            <Divider sx={{ mb: 1 }} />
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
              <Typography variant="subtitle2" fontWeight={700}>
                Units to collect ({basket.length})
              </Typography>
              {basketProjects.size > 1 && <Chip size="small" color="warning" variant="outlined" label="Mixed projects" />}
            </Stack>
            <Stack spacing={0.25} sx={{ mb: 2 }}>
              {basket.map((b) => (
                <Stack key={b.inventoryId} direction="row" alignItems="center" spacing={1}>
                  <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap>
                    {b.sku}
                    {b.assetName ? ` · ${b.assetName}` : ""}
                    <Typography component="span" variant="caption" color="text.secondary">
                      {" "}
                      · {b.projectName}
                    </Typography>
                  </Typography>
                  <IconButton size="small" onClick={() => removeFromBasket(b.inventoryId)} aria-label="remove">
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </Stack>
              ))}
            </Stack>
            {basketProjects.size > 1 && (
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 2 }}>
                Units span more than one project, so the run is not tied to a single project. It still collects every unit; per-project split is done later.
              </Typography>
            )}
          </>
        )}

        {/* 4) SCHEDULE */}
        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
          Collection date and time
        </Typography>
        <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
          <TextField
            type="date"
            size="small"
            value={scheduleDate}
            onChange={(e) => setScheduleDate(e.target.value)}
            InputLabelProps={{ shrink: true }}
            sx={{ flex: 1 }}
          />
          <TextField
            type="time"
            size="small"
            value={scheduleTime}
            onChange={(e) => setScheduleTime(e.target.value)}
            InputLabelProps={{ shrink: true }}
            sx={{ width: 130 }}
          />
        </Stack>

        <TextField
          label="Notes (optional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          fullWidth
          size="small"
          multiline
          minRows={2}
        />

        {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>Cancel</Button>
        <Button variant="contained" onClick={submit} disabled={!canSubmit}>
          {submitting ? <CircularProgress size={20} color="inherit" /> : "Schedule return"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
