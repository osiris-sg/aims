"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import MainCard from "@/components/MainCard";
import { request } from "@/helpers/request";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";
import JobFieldIcon, { JOB_FIELD_ICON_KEYS } from "@/components/jobFields/JobFieldIcon";
import { COLOUR_CHOICES, ICON_LABEL, JOB_FIELD_TYPES, JOB_FIELD_TYPE_LABEL, JobFieldDef, JobFieldType, displayFromForm, displaySummary } from "@/helpers/jobFields";

// Custom job fields (enableJobFields, 2026-11-01): the org admin defines the
// fields every job (Delivery run) carries — yes/no, text, date, file, link —
// and how each shows on the jobs calendar (icon + colours). A row opens the
// field; the kebab removes it (the values already on jobs are kept).

interface Form {
  id?: string;
  displayLabel: string;
  fieldType: JobFieldType;
  required: boolean;
  showOnCalendar: boolean;
  icon: string;
  yesColour: string | null;
  noColour: string | null;
  colour: string | null;
}

const blank: Form = { displayLabel: "", fieldType: "boolean", required: false, showOnCalendar: true, icon: "info", yesColour: "#2e7d32", noColour: null, colour: "#546e7a" };

function formOf(f: JobFieldDef): Form {
  const d = f.display || {};
  return {
    id: f.id,
    displayLabel: f.displayLabel,
    fieldType: f.fieldType as JobFieldType,
    required: !!f.required,
    showOnCalendar: !!d.showOnCalendar,
    icon: d.icon || "info",
    yesColour: d.colourByValue?.true ?? null,
    noColour: d.colourByValue?.false ?? null,
    colour: d.colour ?? "#546e7a",
  };
}

function ColourPick({ label, value, onChange, allowNone }: { label: string; value: string | null; onChange: (c: string | null) => void; allowNone?: boolean }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Stack direction="row" spacing={0.75} sx={{ mt: 0.5 }}>
        {allowNone && (
          <Tooltip title="Not shown">
            <Box
              role="button"
              aria-label="Not shown"
              onClick={() => onChange(null)}
              sx={{ width: 26, height: 26, borderRadius: "50%", border: 2, borderColor: value === null ? "text.primary" : "divider", cursor: "pointer", display: "grid", placeItems: "center", fontSize: 12 }}
            >
              —
            </Box>
          </Tooltip>
        )}
        {COLOUR_CHOICES.map((c) => (
          <Box
            key={c}
            role="button"
            aria-label={c}
            onClick={() => onChange(c)}
            sx={{ width: 26, height: 26, borderRadius: "50%", bgcolor: c, cursor: "pointer", outline: value === c ? "2px solid" : "none", outlineColor: "text.primary", outlineOffset: 2 }}
          />
        ))}
      </Stack>
    </Box>
  );
}

export default function JobFieldsSettingsPage() {
  const { getToken } = useAuth();
  const { isJobFieldsEnabled, isLoading } = useOrganizationFeatures();
  const [fields, setFields] = useState<JobFieldDef[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [menu, setMenu] = useState<{ pos: { left: number; top: number }; field: JobFieldDef } | null>(null);

  const load = useCallback(async () => {
    try {
      const token = await getToken();
      const res = await request({ path: "/job-fields", method: "GET" }, {}, token ?? undefined);
      const body = res?.data ?? res;
      setFields(Array.isArray(body?.fields) ? body.fields : []);
    } catch (e: any) {
      setError(e?.message || "Failed to load the job fields");
      setFields([]);
    }
  }, [getToken]);

  useEffect(() => {
    if (isJobFieldsEnabled) void load();
  }, [isJobFieldsEnabled, load]);

  const save = async () => {
    if (!form) return;
    if (!form.displayLabel.trim()) return setError("Give the field a name");
    setSaving(true);
    setError(null);
    try {
      const token = await getToken();
      const display = displayFromForm(form.fieldType, form);
      const res = form.id
        ? await request({ path: `/job-fields/${form.id}`, method: "PUT" }, { displayLabel: form.displayLabel.trim(), required: form.required, display }, token ?? undefined)
        : await request({ path: "/job-fields", method: "POST" }, { displayLabel: form.displayLabel.trim(), fieldType: form.fieldType, required: form.required, display }, token ?? undefined);
      if (res?.success === false) throw new Error(res?.message || "Could not save");
      setForm(null);
      await load();
    } catch (e: any) {
      const m = e?.message;
      setError((Array.isArray(m) ? m.join(". ") : m) || "Could not save");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (f: JobFieldDef) => {
    if (!window.confirm(`Remove the job field "${f.displayLabel}"? Jobs keep the values they already have; the field is no longer asked or shown.`)) return;
    try {
      const token = await getToken();
      const res = await request({ path: `/job-fields/${f.id}`, method: "DELETE" }, {}, token ?? undefined);
      if (res?.success === false) throw new Error(res?.message || "Could not remove");
      await load();
    } catch (e: any) {
      setError(e?.message || "Could not remove");
    }
  };

  if (isLoading) return null;
  if (!isJobFieldsEnabled) {
    return (
      <MainCard>
        <Alert severity="info">Job fields are not enabled for this organisation.</Alert>
      </MainCard>
    );
  }

  return (
    <MainCard>
      <Stack direction="row" alignItems="center" sx={{ mb: 1 }}>
        <Typography variant="h5" fontWeight={700}>
          Job fields
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Button variant="contained" disableElevation startIcon={<AddIcon />} onClick={() => setForm({ ...blank })} data-tour="job-fields-add">
          Add field
        </Button>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Your own fields on every job: filled in when a job is scheduled or on the delivery page. Fields shown on the calendar draw their icon on the job, in the colour of its value.
      </Typography>
      {error && (
        <Alert severity="warning" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {fields === null ? (
        <CircularProgress />
      ) : fields.length === 0 ? (
        <Alert severity="info">No job fields yet. Add one, e.g. “Permit required” (yes / no).</Alert>
      ) : (
        <TableContainer sx={{ border: 1, borderColor: "divider", borderRadius: 1 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell padding="checkbox" />
                <TableCell>Field</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Required</TableCell>
                <TableCell>Calendar</TableCell>
                <TableCell padding="checkbox" />
              </TableRow>
            </TableHead>
            <TableBody>
              {fields.map((f) => (
                <TableRow key={f.id} hover sx={{ cursor: "pointer" }} onClick={() => setForm(formOf(f))}>
                  <TableCell padding="checkbox">
                    <JobFieldIcon icon={f.display?.icon} fontSize="small" sx={{ color: f.display?.colourByValue?.true || f.display?.colour || "text.secondary" }} />
                  </TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{f.displayLabel}</TableCell>
                  <TableCell>{JOB_FIELD_TYPE_LABEL[f.fieldType as JobFieldType] ?? f.fieldType}</TableCell>
                  <TableCell>{f.required ? "Yes" : "No"}</TableCell>
                  <TableCell>{displaySummary(f)}</TableCell>
                  <TableCell padding="checkbox" onClick={(e) => e.stopPropagation()}>
                    <IconButton size="small" aria-label="More actions" onClick={(e) => { e.stopPropagation(); setMenu({ pos: { left: e.clientX, top: e.clientY }, field: f }); }}>
                      <MoreVertIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Menu anchorReference="anchorPosition" anchorPosition={menu?.pos} open={!!menu} onClose={() => setMenu(null)}>
        <MenuItem onClick={() => { const f = menu!.field; setMenu(null); setForm(formOf(f)); }}>Edit</MenuItem>
        <MenuItem sx={{ color: "error.main" }} onClick={() => { const f = menu!.field; setMenu(null); void remove(f); }}>
          Remove
        </MenuItem>
      </Menu>

      <Dialog open={!!form} onClose={() => setForm(null)} fullWidth maxWidth="sm">
        <DialogTitle>{form?.id ? "Edit job field" : "Add a job field"}</DialogTitle>
        {form && (
          <DialogContent dividers>
            <Stack spacing={2}>
              <TextField autoFocus label="Name" value={form.displayLabel} onChange={(e) => setForm({ ...form, displayLabel: e.target.value })} fullWidth size="small" />
              <TextField select label="Type" value={form.fieldType} onChange={(e) => setForm({ ...form, fieldType: e.target.value as JobFieldType })} size="small" disabled={!!form.id} helperText={form.id ? "The type can't change once jobs may have values." : " "}>
                {JOB_FIELD_TYPES.map((t) => (
                  <MenuItem key={t} value={t}>
                    {JOB_FIELD_TYPE_LABEL[t]}
                  </MenuItem>
                ))}
              </TextField>
              <FormControlLabel control={<Checkbox checked={form.required} onChange={(e) => setForm({ ...form, required: e.target.checked })} />} label="Required to schedule a job" />
              <FormControlLabel control={<Switch checked={form.showOnCalendar} onChange={(e) => setForm({ ...form, showOnCalendar: e.target.checked })} />} label="Show on the jobs calendar" />
              <Box>
                <Typography variant="caption" color="text.secondary">
                  Icon
                </Typography>
                <Stack direction="row" flexWrap="wrap" useFlexGap spacing={0.5} sx={{ mt: 0.5 }}>
                  {JOB_FIELD_ICON_KEYS.map((k) => (
                    <Tooltip key={k} title={ICON_LABEL[k] ?? k}>
                      <IconButton size="small" onClick={() => setForm({ ...form, icon: k })} sx={{ border: 1, borderColor: form.icon === k ? "primary.main" : "transparent" }} aria-label={ICON_LABEL[k] ?? k}>
                        <JobFieldIcon icon={k} fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  ))}
                </Stack>
              </Box>
              {form.showOnCalendar &&
                (form.fieldType === "boolean" ? (
                  <Stack direction={{ xs: "column", sm: "row" }} spacing={3}>
                    <ColourPick label="Colour when yes" value={form.yesColour} onChange={(c) => setForm({ ...form, yesColour: c })} allowNone />
                    <ColourPick label="Colour when no" value={form.noColour} onChange={(c) => setForm({ ...form, noColour: c })} allowNone />
                  </Stack>
                ) : (
                  <ColourPick label="Colour when filled in" value={form.colour} onChange={(c) => setForm({ ...form, colour: c })} />
                ))}
            </Stack>
          </DialogContent>
        )}
        <DialogActions>
          <Button onClick={() => setForm(null)}>Cancel</Button>
          <Button variant="contained" disableElevation disabled={saving} onClick={() => void save()}>
            {saving ? <CircularProgress size={18} /> : "Save"}
          </Button>
        </DialogActions>
      </Dialog>
    </MainCard>
  );
}
