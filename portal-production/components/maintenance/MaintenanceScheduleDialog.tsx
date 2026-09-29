"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  InputAdornment,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import { DatePicker } from "@mui/x-date-pickers/DatePicker";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import dayjs from "dayjs";
import { request } from "@/helpers/request";
import { fmtDay } from "./maintenanceDates";

export interface MaintenanceAssetOption {
  id: string;
  name: string;
  skuKey?: string | null;
}

export interface MaintenanceScheduleEdit {
  id: string;
  asset: MaintenanceAssetOption;
  dueDate: string; // YYYY-MM-DD
  notes: string | null;
  /** Repeat rule of this occurrence (null = one-off). */
  repeatEvery?: number | null;
  repeatUnit?: "WEEK" | "MONTH" | string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
  /** Edit this date instead of creating one (the asset is fixed). */
  editing?: MaintenanceScheduleEdit | null;
  /** Start a new date with this asset already picked. */
  presetAsset?: MaintenanceAssetOption | null;
}

interface BatchResult {
  scheduled: number;
  failed: number;
  results: Array<{ assetId: string; assetName: string | null; ok: boolean; error?: string }>;
}

/**
 * Schedule a maintenance date for one or SEVERAL assets (every deployed unit of
 * each product, rental and sold, is due on the date), or edit one asset's date.
 * One date + optional repeat + notes apply to every selected asset; each gets
 * its own schedule. Assets that already have an upcoming date are shown greyed
 * with that date and can't be picked. Shared by Service Reports -> Maintenance
 * Dates and the Deliveries page. Dates are calendar dates sent as YYYY-MM-DD.
 */
export default function MaintenanceScheduleDialog({ open, onClose, onSaved, editing, presetAsset }: Props) {
  const { getToken } = useAuth();
  const [selected, setSelected] = useState<Map<string, MaintenanceAssetOption>>(new Map());
  const [assetInput, setAssetInput] = useState("");
  const [assetOptions, setAssetOptions] = useState<MaintenanceAssetOption[]>([]);
  const [assetSearching, setAssetSearching] = useState(false);
  // assetId -> its upcoming maintenance date (those can't be scheduled again).
  const [upcoming, setUpcoming] = useState<Map<string, string>>(new Map());
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  // Recurring: "every N weeks / months" (1-24). On edit it applies to the
  // occurrences after this one; the date itself changes this occurrence only.
  const [repeatOn, setRepeatOn] = useState(false);
  const [repeatEvery, setRepeatEvery] = useState("3");
  const [repeatUnit, setRepeatUnit] = useState<"WEEK" | "MONTH">("MONTH");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BatchResult | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSaving(false);
    setResult(null);
    setSelected(new Map(presetAsset && !editing ? [[presetAsset.id, presetAsset]] : []));
    setDueDate(editing?.dueDate ?? "");
    setNotes(editing?.notes ?? "");
    setRepeatOn(!!editing?.repeatEvery);
    setRepeatEvery(String(editing?.repeatEvery ?? 3));
    setRepeatUnit(editing?.repeatUnit === "WEEK" ? "WEEK" : "MONTH");
    setAssetInput("");
  }, [open, editing, presetAsset]);

  // Which assets already have an upcoming date (greyed out in the picker).
  useEffect(() => {
    if (!open || editing) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const res = await request({ path: "/maintenance-schedules", method: "GET" }, {}, token);
        const docs: Array<{ assetId: string; schedule: { dueDate: string } | null }> = (res?.data ?? res)?.docs ?? [];
        if (!cancelled) setUpcoming(new Map(docs.filter((d) => d.schedule).map((d) => [d.assetId, d.schedule!.dueDate])));
      } catch {
        /* the server still refuses a second date; greying is a convenience */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, editing, getToken]);

  // Debounced asset search: the same permission-safe endpoint the Schedule
  // Delivery dialog uses (up to 50 matches).
  useEffect(() => {
    if (!open || editing) return;
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
        /* keep the last results */
      } finally {
        if (!cancelled) setAssetSearching(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [assetInput, open, editing, getToken]);

  const selectable = useMemo(() => assetOptions.filter((a) => !upcoming.has(a.id)), [assetOptions, upcoming]);
  const allFilteredSelected = selectable.length > 0 && selectable.every((a) => selected.has(a.id));
  const toggle = (a: MaintenanceAssetOption) =>
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(a.id)) next.delete(a.id);
      else next.set(a.id, a);
      return next;
    });
  const toggleAllFiltered = () =>
    setSelected((prev) => {
      const next = new Map(prev);
      if (allFilteredSelected) selectable.forEach((a) => next.delete(a.id));
      else selectable.forEach((a) => next.set(a.id, a));
      return next;
    });

  const today = dayjs().format("YYYY-MM-DD");
  const everyNum = Number(repeatEvery);
  const repeatValid = !repeatOn || (Number.isInteger(everyNum) && everyNum >= 1 && everyNum <= 24);
  const hasAssets = editing ? true : selected.size > 0;
  const canSave = hasAssets && /^\d{4}-\d{2}-\d{2}$/.test(dueDate) && dueDate >= today && repeatValid && !saving;
  const repeatPayload = repeatOn ? { every: everyNum, unit: repeatUnit } : null;
  // On edit, only send the rule when it changed, so editing the date alone
  // never touches the series.
  const repeatChanged =
    !!editing &&
    (repeatOn !== !!editing.repeatEvery ||
      (repeatOn && (everyNum !== editing.repeatEvery || repeatUnit !== editing.repeatUnit)));

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      if (editing) {
        const res = await request(
          { path: `/maintenance-schedules/${editing.id}`, method: "PATCH" },
          { dueDate, notes: notes.trim() || null, ...(repeatChanged ? { repeat: repeatPayload } : {}) },
          token,
        );
        if (res?.success === false) throw new Error(res.message ?? "Could not save the maintenance date");
        onSaved?.();
        onClose();
        return;
      }
      const res = await request(
        { path: "/maintenance-schedules/batch", method: "POST" },
        {
          assetIds: Array.from(selected.keys()),
          dueDate,
          notes: notes.trim() || undefined,
          ...(repeatPayload ? { repeat: repeatPayload } : {}),
        },
        token,
      );
      if (res?.success === false) throw new Error(res.message ?? "Could not schedule maintenance");
      const out = (res?.data ?? res) as BatchResult;
      setResult(out);
      if (out.scheduled > 0) onSaved?.();
    } catch (e: any) {
      setError(e?.message ?? "Could not save the maintenance date");
    } finally {
      setSaving(false);
    }
  };

  // ── after a batch save: the summary
  if (result) {
    const ok = result.results.filter((r) => r.ok);
    const bad = result.results.filter((r) => !r.ok);
    return (
      <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
        <DialogTitle>Schedule maintenance</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ mt: 1 }}>
            {ok.length > 0 && (
              <Alert severity="success">
                Scheduled {ok.length} {ok.length === 1 ? "asset" : "assets"} for {fmtDay(dueDate)}
                {bad.length === 0 ? "." : ":"}
                {bad.length > 0 && (
                  <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                    {ok.map((r) => (
                      <li key={r.assetId}>{r.assetName ?? r.assetId}</li>
                    ))}
                  </Box>
                )}
              </Alert>
            )}
            {bad.length > 0 && (
              <Alert severity={ok.length ? "warning" : "error"}>
                {bad.length === 1 ? "1 asset was" : `${bad.length} assets were`} not scheduled:
                <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                  {bad.map((r) => (
                    <li key={r.assetId}>
                      <b>{r.assetName ?? r.assetId}</b>: {r.error}
                    </li>
                  ))}
                </Box>
              </Alert>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button variant="contained" onClick={onClose}>
            Done
          </Button>
        </DialogActions>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onClose={() => !saving && onClose()} maxWidth="sm" fullWidth>
      <DialogTitle>{editing ? "Edit maintenance date" : "Schedule maintenance"}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {editing ? (
            <TextField label="Asset" size="small" value={editing.asset.name} disabled fullWidth />
          ) : (
            <Box>
              <TextField
                size="small"
                fullWidth
                placeholder="Search assets by name or SKU"
                value={assetInput}
                onChange={(e) => setAssetInput(e.target.value)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon fontSize="small" />
                    </InputAdornment>
                  ),
                  endAdornment: assetSearching ? <CircularProgress size={16} /> : null,
                }}
              />
              <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mt: 0.5 }}>
                <FormControlLabel
                  control={
                    <Checkbox
                      size="small"
                      checked={allFilteredSelected}
                      indeterminate={!allFilteredSelected && selectable.some((a) => selected.has(a.id))}
                      onChange={toggleAllFiltered}
                      disabled={selectable.length === 0}
                    />
                  }
                  label={<Typography variant="body2">Select all{assetInput.trim() ? " results" : ""} ({selectable.length})</Typography>}
                />
                <Typography variant="body2" color="text.secondary">
                  {selected.size} selected
                </Typography>
              </Stack>
              <List
                dense
                disablePadding
                sx={{ maxHeight: 240, overflowY: "auto", border: 1, borderColor: "divider", borderRadius: 1 }}
              >
                {assetOptions.length === 0 && !assetSearching && (
                  <Typography variant="body2" color="text.secondary" sx={{ p: 1.5 }}>
                    No assets match this search.
                  </Typography>
                )}
                {assetOptions.map((a) => {
                  const taken = upcoming.get(a.id);
                  return (
                    <ListItemButton key={a.id} dense disabled={!!taken} onClick={() => toggle(a)}>
                      <ListItemIcon sx={{ minWidth: 36 }}>
                        <Checkbox size="small" edge="start" checked={selected.has(a.id)} disabled={!!taken} tabIndex={-1} disableRipple />
                      </ListItemIcon>
                      <ListItemText
                        primary={a.name}
                        secondary={taken ? `Already scheduled for ${fmtDay(taken)}` : a.skuKey || undefined}
                        primaryTypographyProps={{ variant: "body2" }}
                        secondaryTypographyProps={{ variant: "caption" }}
                      />
                    </ListItemButton>
                  );
                })}
              </List>
              {selected.size > 0 && (
                <Stack direction="row" spacing={0.75} sx={{ mt: 1, flexWrap: "wrap", rowGap: 0.75 }}>
                  {Array.from(selected.values()).map((a) => (
                    <Chip key={a.id} size="small" label={a.name} onDelete={() => toggle(a)} />
                  ))}
                </Stack>
              )}
            </Box>
          )}
          <Typography variant="caption" color="text.secondary" sx={{ mt: "4px !important" }}>
            Every deployed unit of {editing || selected.size <= 1 ? "this asset" : "these assets"}, rental and sold, is due on
            this date. Field techs and the office get a reminder 7 days before.
          </Typography>
          <LocalizationProvider dateAdapter={AdapterDayjs}>
            <DatePicker
              label="Maintenance date"
              value={dueDate ? dayjs(dueDate) : null}
              minDate={dayjs(today)}
              onChange={(d) => setDueDate(d && d.isValid() ? d.format("YYYY-MM-DD") : "")}
              slotProps={{ textField: { size: "small", fullWidth: true, required: true, InputLabelProps: { shrink: true } } }}
            />
          </LocalizationProvider>
          <FormControlLabel
            control={<Switch checked={repeatOn} onChange={(e) => setRepeatOn(e.target.checked)} />}
            label="Repeat"
            sx={{ mt: "4px !important" }}
          />
          {repeatOn && (
            <Stack direction="row" spacing={1} alignItems="flex-start" sx={{ mt: "4px !important" }}>
              <TextField
                label="Every"
                size="small"
                type="number"
                value={repeatEvery}
                onChange={(e) => setRepeatEvery(e.target.value.replace(/[^0-9]/g, ""))}
                inputProps={{ min: 1, max: 24, inputMode: "numeric" }}
                error={!repeatValid}
                helperText={!repeatValid ? "1 to 24" : " "}
                sx={{ width: 110 }}
              />
              <TextField
                select
                label="Unit"
                size="small"
                value={repeatUnit}
                onChange={(e) => setRepeatUnit(e.target.value === "WEEK" ? "WEEK" : "MONTH")}
                sx={{ flex: 1 }}
              >
                <MenuItem value="WEEK">{everyNum === 1 ? "Week" : "Weeks"}</MenuItem>
                <MenuItem value="MONTH">{everyNum === 1 ? "Month" : "Months"}</MenuItem>
              </TextField>
            </Stack>
          )}
          {editing && repeatOn && (
            <Typography variant="caption" color="text.secondary" sx={{ mt: "0 !important" }}>
              A new date changes this occurrence only. A new repeat rule applies to the dates after this one.
            </Typography>
          )}
          <TextField
            label="Notes"
            size="small"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            multiline
            minRows={2}
            fullWidth
            placeholder="Optional, e.g. filter change and calibration"
          />
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button variant="contained" onClick={() => void save()} disabled={!canSave}>
          {saving ? (
            <CircularProgress size={18} />
          ) : editing ? (
            "Save changes"
          ) : selected.size > 1 ? (
            `Schedule ${selected.size} assets`
          ) : (
            "Schedule"
          )}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
