"use client";

import React, { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { Alert, Autocomplete, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, MenuItem, Stack, TextField, Typography } from "@mui/material";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import CloseIcon from "@mui/icons-material/Close";
import { toast } from "react-toastify";
import { todayIso } from "@/helpers/orgToday";
import { uploadFile } from "@/helpers/fileUploader";
import { useOrganization } from "@hooks/useOrganization";
import { LOG_TYPES, LOG_TYPE_LABEL, RENEWAL_KINDS, fmtDate, fmtKm, fmtMoney, vehiclesApi, type LogAttachment, type LogType, type VehicleLogEntry, type VehicleRow } from "@/helpers/wctVehicles";

/**
 * The log book pop-ups (2026-11-12; log book 2026-11-16; add / edit vehicle is a
 * full page since 2026-11-16, VehicleForm.tsx). Each dialog posts one
 * request and hands the result back through onDone; mileage that goes backwards
 * still saves and the server's warnings show as toasts so the reading can be
 * checked; a renewal that moved an expiry date says so.
 */

type Driver = { id: string; name: string };

const showWarnings = (res: any) => {
  (res?.warnings ?? []).forEach((w: string) => toast.warning(w, { autoClose: 9000 }));
  if (res?.renewed) toast.success(`${res.renewed.label} expiry on the vehicle is now ${fmtDate(res.renewed.expiry)}`);
};

function useSubmit(onDone: (res: any) => void) {
  const { getToken } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: (token: string) => Promise<any>) => {
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const res = await fn(token);
      showWarnings(res);
      onDone(res);
    } catch (e: any) {
      setError(e?.message ?? "Could not save");
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, run };
}

function Shell({ open, title, onClose, busy, error, onSubmit, submitLabel, submitColor, children, disabled }: any) {
  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {children}
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="contained" color={submitColor ?? "primary"} onClick={onSubmit} disabled={busy || disabled} startIcon={busy ? <CircularProgress size={16} color="inherit" /> : undefined}>
          {submitLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

const dateField = (label: string, value: string, onChange: (v: string) => void, required = false) => (
  <TextField size="small" type="date" label={label} value={value} onChange={(e) => onChange(e.target.value)} InputLabelProps={{ shrink: true }} required={required} fullWidth />
);
const kmField = (label: string, value: string, onChange: (v: string) => void, helperText?: string, required = false) => (
  <TextField size="small" label={label} value={value} onChange={(e) => onChange(e.target.value.replace(/[^\d,]/g, ""))} inputProps={{ inputMode: "numeric" }} InputProps={{ endAdornment: <Typography variant="body2" color="text.secondary">km</Typography> }} helperText={helperText} required={required} fullWidth />
);
const moneyField = (label: string, value: string, onChange: (v: string) => void, required = false) => (
  <TextField size="small" label={label} value={value} onChange={(e) => onChange(e.target.value.replace(/[^\d.,]/g, ""))} inputProps={{ inputMode: "decimal" }} InputProps={{ startAdornment: <Typography variant="body2" color="text.secondary" sx={{ mr: 0.5 }}>S$</Typography> }} required={required} fullWidth />
);

// ------------------------------------------------------------------ driver picker

export function DriverField({ drivers, userId, name, onChange, label = "Driver", required = true }: { drivers: Driver[]; userId: string | null; name: string; onChange: (v: { userId: string | null; name: string }) => void; label?: string; required?: boolean }) {
  const value = userId ? drivers.find((d) => d.id === userId) ?? { id: userId, name } : name;
  return (
    <Autocomplete
      freeSolo
      size="small"
      options={drivers}
      value={value as any}
      getOptionLabel={(o: any) => (typeof o === "string" ? o : o.name)}
      isOptionEqualToValue={(a: any, b: any) => (typeof b === "string" ? a.name === b : a.id === b.id)}
      onChange={(_, v: any) => onChange(v && typeof v === "object" ? { userId: v.id, name: v.name } : { userId: null, name: v ?? "" })}
      onInputChange={(_, text, reason) => {
        if (reason === "input") onChange({ userId: null, name: text });
      }}
      renderInput={(params) => <TextField {...params} label={label} helperText="Pick a WCT user, or type a name" required={required} />}
    />
  );
}

// ------------------------------------------------------------------ log book

/** A receipt / photo / PDF on an entry: upload, show, remove. */
function AttachmentField({ value, onChange, onBusy }: { value: LogAttachment | null; onChange: (v: LogAttachment | null) => void; onBusy: (b: boolean) => void }) {
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const [busy, setBusy] = useState(false);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    onBusy(true);
    try {
      const token = await getToken();
      if (!token || !organization?.id) throw new Error("Not signed in");
      const up = await uploadFile({ file, folder: `vehicles/${organization.id}/log`, token });
      onChange({ key: up.fileKey, fileName: up.fileName, mimeType: up.mimeType });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not upload the file");
    } finally {
      setBusy(false);
      onBusy(false);
    }
  };
  return (
    <Box>
      {value ? (
        <Stack direction="row" spacing={1} alignItems="center">
          <AttachFileIcon fontSize="small" color="action" />
          <Typography variant="body2" sx={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {value.fileName || "Attachment"}
          </Typography>
          <IconButton size="small" aria-label="Remove attachment" onClick={() => onChange(null)}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Stack>
      ) : (
        <Button component="label" size="small" variant="outlined" startIcon={busy ? <CircularProgress size={14} /> : <AttachFileIcon />} disabled={busy}>
          {busy ? "Uploading…" : "Attach receipt / photo / PDF"}
          <input hidden type="file" accept="image/*,application/pdf" onChange={(e) => void pick(e.target.files?.[0])} />
        </Button>
      )}
    </Box>
  );
}

/** "Assign new driver": driver, date, mileage. */
export function AssignDriverDialog({ open, onClose, vehicle, drivers, onDone }: { open: boolean; onClose: () => void; vehicle: VehicleRow; drivers: Driver[]; onDone: () => void }) {
  const [driver, setDriver] = useState<{ userId: string | null; name: string }>({ userId: null, name: "" });
  const [date, setDate] = useState(todayIso());
  const [km, setKm] = useState("");
  const s = useSubmit(onDone);
  useEffect(() => {
    if (!open) return;
    s.setError(null);
    setDriver({ userId: null, name: "" });
    setDate(todayIso());
    setKm(vehicle.lastMileage != null ? String(vehicle.lastMileage) : "");
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Shell
      open={open}
      onClose={onClose}
      title={`Assign new driver: ${vehicle.vehicleNo}`}
      busy={s.busy}
      error={s.error}
      submitLabel="Assign driver"
      disabled={!driver.name.trim() || !date}
      onSubmit={() => s.run((t) => vehiclesApi(`/${vehicle.id}/log`, "POST", t, { type: "DRIVER", driverUserId: driver.userId, driverName: driver.name, date, mileage: km }))}
    >
      {vehicle.currentDriver && (
        <Typography variant="body2" color="text.secondary">
          Now with {vehicle.currentDriver} since {fmtDate(vehicle.driverSince)}.
        </Typography>
      )}
      <DriverField drivers={drivers} userId={driver.userId} name={driver.name} onChange={setDriver} />
      {dateField("Date", date, setDate, true)}
      {kmField("Mileage", km, setKm, vehicle.lastMileage != null ? `Last recorded: ${fmtKm(vehicle.lastMileage)}` : "Optional")}
    </Shell>
  );
}

type EntryForm = {
  type: LogType;
  date: string;
  description: string;
  mileage: string;
  amount: string;
  driverUserId: string | null;
  driverName: string;
  vendor: string;
  renewalKind: string;
  renewalExpiry: string;
  attachment: LogAttachment | null;
};

/** "Add log entry" (any type) and Edit (the type stays). */
export function LogEntryDialog({
  open,
  onClose,
  vehicle,
  drivers,
  entry,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  vehicle: VehicleRow & { currentDriverUserId?: string | null };
  drivers: Driver[];
  entry?: VehicleLogEntry | null;
  onDone: () => void;
}) {
  const blank = (): EntryForm => ({
    type: "FUEL",
    date: todayIso(),
    description: "",
    mileage: "",
    amount: "",
    driverUserId: vehicle.currentDriverUserId ?? null,
    driverName: vehicle.currentDriver ?? "",
    vendor: "",
    renewalKind: "",
    renewalExpiry: "",
    attachment: null,
  });
  const [f, setF] = useState<EntryForm>(blank);
  const [uploading, setUploading] = useState(false);
  const s = useSubmit(onDone);
  useEffect(() => {
    if (!open) return;
    s.setError(null);
    setF(
      entry
        ? {
            type: entry.type,
            date: entry.date,
            description: entry.description ?? "",
            mileage: entry.mileage != null ? String(entry.mileage) : "",
            amount: entry.amount != null ? String(entry.amount) : "",
            driverUserId: entry.driverUserId,
            driverName: entry.driverName ?? "",
            vendor: entry.vendor ?? "",
            renewalKind: entry.renewalKind ?? "",
            renewalExpiry: entry.renewalExpiry ?? "",
            attachment: entry.attachment,
          }
        : blank(),
    );
  }, [open, entry]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = <K extends keyof EntryForm>(k: K) => (v: EntryForm[K]) => setF((p) => ({ ...p, [k]: v }));
  const t = f.type;
  const missing =
    !f.date ||
    (t === "DRIVER" && !f.driverName.trim()) ||
    (t === "REPAIR" && !f.description.trim() && !f.vendor.trim()) ||
    (t === "RENEWAL" && !f.renewalKind) ||
    ((t === "FUEL" || t === "PARKING") && !entry && !f.amount);
  const body = () => ({
    type: t,
    date: f.date,
    description: f.description,
    mileage: f.mileage,
    amount: f.amount,
    driverUserId: f.driverUserId,
    driverName: f.driverName,
    vendor: f.vendor,
    renewalKind: f.renewalKind,
    renewalExpiry: f.renewalExpiry,
    attachment: f.attachment,
  });
  return (
    <Shell
      open={open}
      onClose={onClose}
      title={entry ? `Edit: ${entry.typeLabel}` : `Add log entry: ${vehicle.vehicleNo}`}
      busy={s.busy || uploading}
      error={s.error}
      submitLabel={entry ? "Save" : "Add entry"}
      disabled={missing}
      onSubmit={() => s.run((tk) => (entry ? vehiclesApi(`/log/${entry.id}`, "PATCH", tk, body()) : vehiclesApi(`/${vehicle.id}/log`, "POST", tk, body())))}
    >
      <TextField select size="small" label="Type" value={t} onChange={(e) => set("type")(e.target.value as LogType)} disabled={!!entry} fullWidth data-tour="vehicle-log-type">
        {LOG_TYPES.map((k) => (
          <MenuItem key={k} value={k}>
            {LOG_TYPE_LABEL[k]}
          </MenuItem>
        ))}
      </TextField>
      {dateField("Date", f.date, set("date"), true)}
      {t === "RENEWAL" && (
        <>
          <TextField select size="small" label="Renewed" value={f.renewalKind} onChange={(e) => set("renewalKind")(e.target.value)} required fullWidth>
            {RENEWAL_KINDS.map((k) => (
              <MenuItem key={k.key} value={k.key}>
                {k.label}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            size="small"
            type="date"
            label="New expiry date (optional)"
            value={f.renewalExpiry}
            onChange={(e) => set("renewalExpiry")(e.target.value)}
            InputLabelProps={{ shrink: true }}
            helperText="Also updates this date on the vehicle"
            fullWidth
          />
        </>
      )}
      {t === "REPAIR" && <TextField size="small" label="Vendor / workshop" value={f.vendor} onChange={(e) => set("vendor")(e.target.value)} fullWidth />}
      <TextField
        size="small"
        label={t === "REPAIR" ? "Damage / issue / repair details" : "Description"}
        value={f.description}
        onChange={(e) => set("description")(e.target.value)}
        multiline
        minRows={t === "REPAIR" ? 3 : 1}
        required={t === "REPAIR" && !f.vendor.trim()}
        fullWidth
      />
      <DriverField
        drivers={drivers}
        userId={f.driverUserId}
        name={f.driverName}
        onChange={(d) => setF((p) => ({ ...p, driverUserId: d.userId, driverName: d.name }))}
        label={t === "DRIVER" ? "Driver" : "Driver (optional)"}
        required={t === "DRIVER"}
      />
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
        {kmField("Mileage (optional)", f.mileage, set("mileage"), vehicle.lastMileage != null ? `Last recorded: ${fmtKm(vehicle.lastMileage)}` : undefined)}
        {moneyField(t === "FUEL" || t === "PARKING" ? "Amount" : "Amount (optional)", f.amount, set("amount"), (t === "FUEL" || t === "PARKING") && !entry)}
      </Stack>
      <AttachmentField value={f.attachment} onChange={set("attachment")} onBusy={setUploading} />
      {t === "REPAIR" && (
        <Typography variant="caption" color="text.secondary">
          An admin approves the repair from the entry&apos;s menu; once approved it is locked.
        </Typography>
      )}
    </Shell>
  );
}

export function DeleteEntryDialog({ open, onClose, entry, onDone }: { open: boolean; onClose: () => void; entry: VehicleLogEntry | null; onDone: () => void }) {
  const s = useSubmit(onDone);
  useEffect(() => {
    if (open) s.setError(null);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!entry) return null;
  return (
    <Shell open={open} onClose={onClose} title="Delete log entry?" busy={s.busy} error={s.error} submitLabel="Delete" submitColor="error" onSubmit={() => s.run((t) => vehiclesApi(`/log/${entry.id}`, "DELETE", t))}>
      <Typography variant="body2">
        {fmtDate(entry.date)} · {entry.typeLabel}
        {entry.amount != null ? ` · ${fmtMoney(entry.amount)}` : ""}
        {entry.details ? ` · ${entry.details}` : ""}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        It disappears from the log and the totals. The deletion is recorded in the Activity Log.
      </Typography>
    </Shell>
  );
}

// ------------------------------------------------------------------ repair approval

export function ApproveRepairDialog({ open, onClose, entry, myName, onDone }: { open: boolean; onClose: () => void; entry: VehicleLogEntry | null; myName: string; onDone: () => void }) {
  const [by, setBy] = useState("");
  const [date, setDate] = useState(todayIso());
  const s = useSubmit(onDone);
  useEffect(() => {
    if (!open) return;
    s.setError(null);
    setBy(myName);
    setDate(todayIso());
  }, [open, myName]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!entry) return null;
  return (
    <Shell
      open={open}
      onClose={onClose}
      title="Approve repair"
      busy={s.busy}
      error={s.error}
      submitLabel="Approve"
      submitColor="success"
      disabled={!by.trim() || !date}
      onSubmit={() => s.run((t) => vehiclesApi(`/log/${entry.id}/approve`, "POST", t, { approvedBy: by, approvedDate: date }))}
    >
      <Alert severity="info" variant="outlined">
        {entry.details}
        {entry.amount != null ? ` (${fmtMoney(entry.amount)})` : ""}
      </Alert>
      <TextField size="small" label="Repair approved by" value={by} onChange={(e) => setBy(e.target.value)} required fullWidth />
      {dateField("Repair approved date", date, setDate, true)}
      <Typography variant="caption" color="text.secondary">
        Once approved the repair is locked. Only an admin can unlock it, with a reason.
      </Typography>
    </Shell>
  );
}

export function UnlockRepairDialog({ open, onClose, entry, onDone }: { open: boolean; onClose: () => void; entry: VehicleLogEntry | null; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const s = useSubmit(onDone);
  useEffect(() => {
    if (!open) return;
    s.setError(null);
    setReason("");
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!entry) return null;
  return (
    <Shell
      open={open}
      onClose={onClose}
      title="Unlock approved repair"
      busy={s.busy}
      error={s.error}
      submitLabel="Unlock"
      submitColor="warning"
      disabled={!reason.trim()}
      onSubmit={() => s.run((t) => vehiclesApi(`/log/${entry.id}/unlock`, "POST", t, { reason }))}
    >
      <Typography variant="body2">
        Approved by {entry.repairApprovedBy} on {fmtDate(entry.repairApprovedAt)}. Unlocking removes the approval so the entry can be changed; it is recorded with your reason in the Activity Log.
      </Typography>
      <TextField size="small" label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} required multiline minRows={2} fullWidth autoFocus />
    </Shell>
  );
}
