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
  Stack,
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSaving(false);
    setAsset(editing?.asset ?? presetAsset ?? null);
    setDueDate(editing?.dueDate ?? "");
    setNotes(editing?.notes ?? "");
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
  const canSave = !!asset && /^\d{4}-\d{2}-\d{2}$/.test(dueDate) && dueDate >= today && !saving;

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
            { dueDate, notes: notes.trim() || null },
            token,
          )
        : await request(
            { path: "/maintenance-schedules", method: "POST" },
            { assetId: asset.id, dueDate, notes: notes.trim() || undefined },
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
