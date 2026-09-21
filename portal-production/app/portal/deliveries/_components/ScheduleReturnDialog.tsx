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
  useMediaQuery,
  useTheme,
} from "@mui/material";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import { request } from "@/helpers/request";
import { DatePicker } from "@mui/x-date-pickers/DatePicker";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import dayjs from "dayjs";

interface CustomerOption {
  id: string;
  name: string;
  customerCode: string | null;
}
interface ProjectOption {
  id: string;
  name: string;
}
// A line the office can collect back: a unit out on rental, OR a description-only
// (free-typed) deployment that has no unit at all. `key` is the stable id used
// for selection/basket (inventoryId for units, deploymentId for free-typed).
// `typed` is a THIRD variant, not a reuse of `freeTyped`: freeTyped REQUIRES a
// deploymentId (it is a deployment the office picked off the list), and a typed
// line has none by definition — it is text the office entered, which the backend
// either matches to an existing ACTIVE deployment or creates one for. Widening
// freeTyped's deploymentId to optional would lose that distinction at the submit
// boundary, where the two must go into different payload fields.
type ReturnLine =
  | { kind: "unit"; key: string; inventoryId: string; sku: string; assetName: string }
  | { kind: "freeTyped"; key: string; deploymentId: string; description: string }
  | { kind: "typed"; key: string; description: string };
// A line added to the basket carries its project for the mixed-project note.
type BasketLine = ReturnLine & { projectId: string; projectName: string };

const lineLabel = (l: ReturnLine): string =>
  l.kind === "unit" ? `${l.sku}${l.assetName ? ` · ${l.assetName}` : ""}` : l.description;

/**
 * Office "Schedule a return" dialog. CUSTOMER -> PROJECT -> that project's lines
 * to collect (units out on rental AND description-only free-typed deployments)
 * -> add to a basket. Repeatable across projects into ONE basket, then scheduled
 * date + time. Submits unit ids and deployment ids to POST
 * /deliveries/scheduled-return, which creates one scheduled RETURN run.
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
  const theme = useTheme();
  // Phone: this long form goes full-screen below sm
  const fullScreenDialog = useMediaQuery(theme.breakpoints.down("sm"));

  const [customerOptions, setCustomerOptions] = useState<CustomerOption[]>([]);
  const [customer, setCustomer] = useState<CustomerOption | null>(null);
  const [customerInput, setCustomerInput] = useState("");
  const [customerSearching, setCustomerSearching] = useState(false);

  const [projectOptions, setProjectOptions] = useState<ProjectOption[]>([]);
  const [project, setProject] = useState<ProjectOption | null>(null);
  const [projectsLoading, setProjectsLoading] = useState(false);

  // Lines for the currently-selected project, and which are ticked (by key).
  const [lines, setLines] = useState<ReturnLine[]>([]);
  const [linesLoading, setLinesLoading] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  // The accumulating basket across projects.
  const [basket, setBasket] = useState<BasketLine[]>([]);

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
    setLines([]);
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
    setLines([]);
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

  // Load the selected project's collectable lines. Reuses the generic
  // GET /projects/:id/deployments (every status), narrowed here to ACTIVE
  // deployments: a unit genuinely OUT on rental becomes a unit line; a
  // description-only deployment (its active assignment has no inventory AND no
  // asset) becomes a free-typed line shown by its description with no serial.
  useEffect(() => {
    setLines([]);
    setChecked(new Set());
    if (!project) return;
    let cancelled = false;
    (async () => {
      setLinesLoading(true);
      try {
        const token = await getToken();
        if (!token) return;
        const res = await request({ path: `/projects/${project.id}/deployments`, method: "GET" }, {}, token);
        if (cancelled) return;
        const data = res?.data ?? res;
        const deps: any[] = Array.isArray(data) ? data : data?.deployments ?? [];
        const rows: ReturnLine[] = [];
        const seenUnits = new Set<string>();
        for (const dep of deps) {
          if (dep?.status !== "ACTIVE") continue;
          const assignments: any[] = dep?.assignments ?? [];
          // Unit lines: any active assignment whose unit is genuinely out on rental.
          for (const a of assignments) {
            const inv = a?.inventory;
            if (inv?.id && inv.status === "rental" && !seenUnits.has(inv.id)) {
              seenUnits.add(inv.id);
              rows.push({ kind: "unit", key: inv.id, inventoryId: inv.id, sku: inv.sku ?? inv.id, assetName: a?.asset?.name ?? "" });
            }
          }
          // Free-typed line: a description-only deployment (no unit, no asset on
          // any active assignment) with a description. Shown with no serial.
          const descriptionOnly = assignments.length > 0 && assignments.every((a) => !a?.inventory?.id && !a?.asset?.id);
          const description = String(dep?.description ?? "").trim();
          if (descriptionOnly && description) {
            rows.push({ kind: "freeTyped", key: dep.id, deploymentId: dep.id, description });
          }
        }
        setLines(rows);
      } catch {
        /* non-fatal */
      } finally {
        if (!cancelled) setLinesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [project, getToken]);

  const basketKeys = useMemo(() => new Set(basket.map((b) => b.key)), [basket]);
  // Lines not already in the basket (a line can only be returned once).
  const selectableLines = lines.filter((l) => !basketKeys.has(l.key));

  const toggle = (key: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const addChecked = () => {
    if (!project || checked.size === 0) return;
    const toAdd = lines
      .filter((l) => checked.has(l.key) && !basketKeys.has(l.key))
      .map((l) => ({ ...l, projectId: project.id, projectName: project.name }));
    setBasket((prev) => [...prev, ...toAdd]);
    setChecked(new Set());
  };

  const removeFromBasket = (key: string) => setBasket((prev) => prev.filter((b) => b.key !== key));

  // ── free-typed line ──────────────────────────────────────────────────────
  // Goes STRAIGHT into the basket under the selected project: unlike the picker
  // rows above it has no id to check, so there is nothing to select. Duplicate
  // text is allowed on purpose — two "1 unit 60 es DG" lines are a real case
  // (two of them on site), and the backend pairs each to its own deployment.
  const [typedText, setTypedText] = useState("");
  const addTyped = () => {
    const text = typedText.trim();
    if (!project || !text) return;
    // Every typed line in one basket must share a project: the payload carries a
    // single projectId, and a typed line has no unit to infer one from.
    const otherProject = basket.find((b) => b.kind === "typed" && b.projectId !== project.id);
    if (otherProject) {
      setError("Free-typed lines must all be on one project. Schedule the other project's typed lines separately.");
      return;
    }
    setError(null);
    setBasket((prev) => [
      ...prev,
      { kind: "typed", key: `typed:${project.id}:${text}:${Date.now()}`, description: text, projectId: project.id, projectName: project.name },
    ]);
    setTypedText("");
  };

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
      const inventoryIds = basket.filter((b): b is BasketLine & { kind: "unit" } => b.kind === "unit").map((b) => b.inventoryId);
      const deploymentIds = basket
        .filter((b): b is BasketLine & { kind: "freeTyped" } => b.kind === "freeTyped")
        .map((b) => b.deploymentId);
      // Typed lines go by TEXT, not id. The backend needs the project to match or
      // create their deployment, and a typed line carries no unit to infer one
      // from — so send it explicitly. All typed lines in one basket must share a
      // project; the Add control below only allows adding under the selected one.
      const typedBasket = basket.filter((b): b is BasketLine & { kind: "typed" } => b.kind === "typed");
      const typedLines = typedBasket.map((b) => ({ description: b.description }));
      const typedProjectId = typedBasket.length ? typedBasket[0].projectId : null;
      const res = await request(
        { path: "/deliveries/scheduled-return", method: "POST" },
        {
          scheduledFor,
          customerId: customer.id,
          ...(inventoryIds.length ? { inventoryIds } : {}),
          ...(deploymentIds.length ? { deploymentIds } : {}),
          ...(typedLines.length ? { typedLines, projectId: typedProjectId } : {}),
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
    <Dialog
      open={open}
      onClose={() => {
        // Match the delivery dialog: click-outside / Escape SAVES a complete form
        // (only Cancel discards). Incomplete → say what's missing, never silent.
        if (submitting) return;
        if (canSubmit) void submit();
        else setError("Pick a customer, add at least one line and set a date to save. Press Cancel to discard.");
      }}
      fullWidth
      maxWidth="sm"
      fullScreen={fullScreenDialog}
    >
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

        {/* 2) PROJECT + its lines */}
        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
          Add items by project
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
            {linesLoading ? (
              <Box sx={{ display: "flex", justifyContent: "center", py: 2 }}>
                <CircularProgress size={22} />
              </Box>
            ) : selectableLines.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
                Nothing out to collect for this project{lines.length ? " (all already in the basket)" : ""}.
              </Typography>
            ) : (
              <>
                <Stack sx={{ maxHeight: 200, overflowY: "auto", border: "1px solid", borderColor: "divider", borderRadius: 1, px: 1, py: 0.5 }}>
                  {selectableLines.map((l) => (
                    <FormControlLabel
                      key={l.key}
                      control={<Checkbox size="small" checked={checked.has(l.key)} onChange={() => toggle(l.key)} />}
                      label={<Typography variant="body2">{lineLabel(l)}</Typography>}
                    />
                  ))}
                </Stack>
                <Button size="small" onClick={addChecked} disabled={checked.size === 0} sx={{ mt: 1, textTransform: "none" }}>
                  Add {checked.size || ""} selected to return
                </Button>
              </>
            )}

            {/* Free-typed line. Mirrors the outbound "Free type item" control:
                something on site that has no unit to pick — either it went out
                as a free-typed line already (the backend reuses that
                deployment), or it predates tracking (the backend creates one). */}
            <Box sx={{ mt: 2, pt: 2, borderTop: "1px dashed", borderColor: "divider" }}>
              <Typography variant="caption" sx={{ color: "text.secondary" }}>
                Not on the list? Add it by description.
              </Typography>
              <Stack direction="row" spacing={1} sx={{ mt: 0.5, flexWrap: { xs: "wrap", sm: "nowrap" }, rowGap: 1 }}>
                <TextField
                  size="small"
                  fullWidth
                  placeholder="e.g. 1 unit 60 es DG"
                  value={typedText}
                  onChange={(e) => setTypedText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTyped(); } }}
                  inputProps={{ maxLength: 500 }}
                />
                <Button size="small" variant="outlined" onClick={addTyped} disabled={!typedText.trim()} sx={{ whiteSpace: "nowrap", textTransform: "none" }}>
                  Add a free-typed item
                </Button>
              </Stack>
            </Box>
          </Box>
        )}

        {/* 3) BASKET */}
        {basket.length > 0 && (
          <>
            <Divider sx={{ mb: 1 }} />
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
              <Typography variant="subtitle2" fontWeight={700}>
                Items to collect ({basket.length})
              </Typography>
              {basketProjects.size > 1 && <Chip size="small" color="warning" variant="outlined" label="Mixed projects" />}
            </Stack>
            <Stack spacing={0.25} sx={{ mb: 2 }}>
              {basket.map((b) => (
                <Stack key={b.key} direction="row" alignItems="center" spacing={1}>
                  <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap>
                    {lineLabel(b)}
                    <Typography component="span" variant="caption" color="text.secondary">
                      {" "}
                      · {b.projectName}
                    </Typography>
                  </Typography>
                  <IconButton size="small" onClick={() => removeFromBasket(b.key)} aria-label="remove">
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </Stack>
              ))}
            </Stack>
            {basketProjects.size > 1 && (
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 2 }}>
                Items span more than one project, so the run is not tied to a single project. It still collects everything; per-project split is done later.
              </Typography>
            )}
          </>
        )}

        {/* 4) SCHEDULE */}
        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
          Collection date and time
        </Typography>
        <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
          {/* MUI DatePicker (Popper) instead of a native date input: its calendar
              flips above the field when there is no room below, so it stays fully
              clickable even though this field sits at the bottom of the form. */}
          <LocalizationProvider dateAdapter={AdapterDayjs}>
            <DatePicker
              label="Date"
              value={scheduleDate ? dayjs(scheduleDate) : null}
              onChange={(d) => setScheduleDate(d && d.isValid() ? d.format("YYYY-MM-DD") : "")}
              slotProps={{
                textField: { size: "small", InputLabelProps: { shrink: true }, sx: { flex: 1 } },
              }}
            />
          </LocalizationProvider>
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
