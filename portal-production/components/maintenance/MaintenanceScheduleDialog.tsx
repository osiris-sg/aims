"use client";

import React, { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import {
  Alert,
  Autocomplete,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import { DatePicker } from "@mui/x-date-pickers/DatePicker";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import dayjs from "dayjs";
import { request } from "@/helpers/request";

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

/**
 * Schedule (or edit) a maintenance date for an ASSET: every deployed unit of
 * that product, rental and sold, is due on the date. Shared by Service Reports
 * -> Maintenance Dates and the Deliveries page. The date is a calendar date
 * (no time), sent as YYYY-MM-DD.
 */
export default function MaintenanceScheduleDialog({ open, onClose, onSaved, editing, presetAsset }: Props) {
  const { getToken } = useAuth();
  const [asset, setAsset] = useState<MaintenanceAssetOption | null>(null);
  const [assetInput, setAssetInput] = useState("");
  const [assetOptions, setAssetOptions] = useState<MaintenanceAssetOption[]>([]);
  const [assetSearching, setAssetSearching] = useState(false);
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  // Recurring: "every N weeks / months" (1-24). On edit it applies to the
  // occurrences after this one; the date itself changes this occurrence only.
  const [repeatOn, setRepeatOn] = useState(false);
  const [repeatEvery, setRepeatEvery] = useState("3");
  const [repeatUnit, setRepeatUnit] = useState<"WEEK" | "MONTH">("MONTH");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSaving(false);
    setAsset(editing?.asset ?? presetAsset ?? null);
    setDueDate(editing?.dueDate ?? "");
    setNotes(editing?.notes ?? "");
    setRepeatOn(!!editing?.repeatEvery);
    setRepeatEvery(String(editing?.repeatEvery ?? 3));
    setRepeatUnit(editing?.repeatUnit === "WEEK" ? "WEEK" : "MONTH");
    setAssetInput("");
  }, [open, editing, presetAsset]);

  // Debounced asset search: the same permission-safe endpoint the Schedule
  // Delivery dialog uses.
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

  const today = dayjs().format("YYYY-MM-DD");
  const everyNum = Number(repeatEvery);
  const repeatValid = !repeatOn || (Number.isInteger(everyNum) && everyNum >= 1 && everyNum <= 24);
  const canSave = !!asset && /^\d{4}-\d{2}-\d{2}$/.test(dueDate) && dueDate >= today && repeatValid && !saving;
  const repeatPayload = repeatOn ? { every: everyNum, unit: repeatUnit } : null;
  // On edit, only send the rule when it changed, so editing the date alone
  // never touches the series.
  const repeatChanged =
    !!editing &&
    (repeatOn !== !!editing.repeatEvery ||
      (repeatOn && (everyNum !== editing.repeatEvery || repeatUnit !== editing.repeatUnit)));

  const save = async () => {
    if (!canSave || !asset) return;
    setSaving(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const res = editing
        ? await request(
            { path: `/maintenance-schedules/${editing.id}`, method: "PATCH" },
            { dueDate, notes: notes.trim() || null, ...(repeatChanged ? { repeat: repeatPayload } : {}) },
            token,
          )
        : await request(
            { path: "/maintenance-schedules", method: "POST" },
            { assetId: asset.id, dueDate, notes: notes.trim() || undefined, ...(repeatPayload ? { repeat: repeatPayload } : {}) },
            token,
          );
      if (res?.success === false) throw new Error(res.message ?? "Could not save the maintenance date");
      onSaved?.();
      onClose();
    } catch (e: any) {
      setError(e?.message ?? "Could not save the maintenance date");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={() => !saving && onClose()} maxWidth="xs" fullWidth>
      <DialogTitle>{editing ? "Edit maintenance date" : "Schedule maintenance"}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {editing ? (
            <TextField label="Asset" size="small" value={editing.asset.name} disabled fullWidth />
          ) : (
            <Autocomplete<MaintenanceAssetOption, false, false, false>
              size="small"
              options={assetOptions}
              filterOptions={(x) => x}
              value={asset}
              onChange={(_, picked) => setAsset(picked)}
              onInputChange={(_, v, reason) => {
                if (reason === "input") setAssetInput(v);
              }}
              getOptionLabel={(o) => (o.skuKey ? `${o.name} · ${o.skuKey}` : o.name)}
              isOptionEqualToValue={(a, b) => a.id === b.id}
              loading={assetSearching}
              renderInput={(params) => <TextField {...params} label="Asset" placeholder="Search by name or SKU" required />}
            />
          )}
          <Typography variant="caption" color="text.secondary" sx={{ mt: "4px !important" }}>
            Every deployed unit of this asset, rental and sold, is due on this date. Field techs and the office get a
            reminder 7 days before.
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
          {saving ? <CircularProgress size={18} /> : editing ? "Save changes" : "Schedule"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
