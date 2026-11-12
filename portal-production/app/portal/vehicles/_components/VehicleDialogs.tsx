"use client";

import React, { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { Alert, Autocomplete, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from "@mui/material";
import { toast } from "react-toastify";
import { todayIso } from "@/helpers/orgToday";
import { fmtDate, fmtKm, vehiclesApi, type VehicleRow, type VehicleUsage } from "@/helpers/wctVehicles";

/**
 * Every Vehicles form (2026-11-12). Each dialog posts one request and hands the
 * result back through onDone; mileage that goes backwards still saves and the
 * server's warnings show as toasts so the reading can be checked.
 */

type Driver = { id: string; name: string };

const showWarnings = (res: any) => (res?.warnings ?? []).forEach((w: string) => toast.warning(w, { autoClose: 9000 }));

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
const kmField = (label: string, value: string, onChange: (v: string) => void, helperText?: string) => (
  <TextField size="small" label={label} value={value} onChange={(e) => onChange(e.target.value.replace(/[^\d,]/g, ""))} inputProps={{ inputMode: "numeric" }} InputProps={{ endAdornment: <Typography variant="body2" color="text.secondary">km</Typography> }} helperText={helperText} required fullWidth />
);

// ------------------------------------------------------------------ vehicle

export function VehicleFormDialog({ open, onClose, vehicle, onDone }: { open: boolean; onClose: () => void; vehicle?: VehicleRow | null; onDone: (v: VehicleRow) => void }) {
  const [f, setF] = useState({ vehicleNo: "", model: "", coeExpiry: "", lifespanExpiry: "", notes: "" });
  const s = useSubmit(onDone);
  useEffect(() => {
    if (!open) return;
    s.setError(null);
    setF({ vehicleNo: vehicle?.vehicleNo ?? "", model: vehicle?.model ?? "", coeExpiry: vehicle?.coeExpiry ?? "", lifespanExpiry: vehicle?.lifespanExpiry ?? "", notes: vehicle?.notes ?? "" });
  }, [open, vehicle]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: keyof typeof f) => (v: string) => setF((p) => ({ ...p, [k]: v }));
  return (
    <Shell
      open={open}
      onClose={onClose}
      title={vehicle ? `Edit ${vehicle.vehicleNo}` : "Add vehicle"}
      busy={s.busy}
      error={s.error}
      submitLabel={vehicle ? "Save" : "Add vehicle"}
      disabled={!f.vehicleNo.trim()}
      onSubmit={() => s.run((t) => (vehicle ? vehiclesApi(`/${vehicle.id}`, "PATCH", t, f) : vehiclesApi("", "POST", t, f)))}
    >
      <TextField size="small" label="Vehicle / Lorry No." placeholder="e.g. GBD1126U" value={f.vehicleNo} onChange={(e) => set("vehicleNo")(e.target.value)} required fullWidth />
      <TextField size="small" label="Model" placeholder="e.g. Nissan NV350 Panel Van" value={f.model} onChange={(e) => set("model")(e.target.value)} fullWidth />
      {dateField("COE Expiry Date", f.coeExpiry, set("coeExpiry"))}
      {dateField("Vehicle Lifespan Expiry Date", f.lifespanExpiry, set("lifespanExpiry"))}
      <TextField size="small" label="Notes (optional)" value={f.notes} onChange={(e) => set("notes")(e.target.value)} multiline minRows={2} fullWidth />
    </Shell>
  );
}

// ------------------------------------------------------------------ driver picker

export function DriverField({ drivers, userId, name, onChange }: { drivers: Driver[]; userId: string | null; name: string; onChange: (v: { userId: string | null; name: string }) => void }) {
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
      renderInput={(params) => <TextField {...params} label="Assigned driver" helperText="Pick a WCT user, or type a name" required />}
    />
  );
}

// ------------------------------------------------------------------ usage

export function StartUsageDialog({ open, onClose, vehicle, drivers, onDone }: { open: boolean; onClose: () => void; vehicle: VehicleRow; drivers: Driver[]; onDone: () => void }) {
  const [driver, setDriver] = useState<{ userId: string | null; name: string }>({ userId: null, name: "" });
  const [startDate, setStartDate] = useState(todayIso());
  const [km, setKm] = useState("");
  const s = useSubmit(onDone);
  useEffect(() => {
    if (!open) return;
    s.setError(null);
    setDriver({ userId: null, name: "" });
    setStartDate(todayIso());
    setKm(vehicle.lastMileage != null ? String(vehicle.lastMileage) : "");
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Shell
      open={open}
      onClose={onClose}
      title={`Start usage: ${vehicle.vehicleNo}`}
      busy={s.busy}
      error={s.error}
      submitLabel="Start usage"
      disabled={!driver.name.trim() || !startDate || !km}
      onSubmit={() =>
        s.run((t) => vehiclesApi(`/${vehicle.id}/usages/start`, "POST", t, { driverUserId: driver.userId, driverName: driver.name, startDate, startMileage: km }))
      }
    >
      <DriverField drivers={drivers} userId={driver.userId} name={driver.name} onChange={setDriver} />
      {dateField("Usage start date", startDate, setStartDate, true)}
      {kmField("Mileage at start", km, setKm, vehicle.lastMileage != null ? `Last recorded: ${fmtKm(vehicle.lastMileage)}` : undefined)}
    </Shell>
  );
}

export function EndUsageDialog({ open, onClose, usage, vehicleNo, onDone }: { open: boolean; onClose: () => void; usage: VehicleUsage | null; vehicleNo: string; onDone: () => void }) {
  const [endDate, setEndDate] = useState(todayIso());
  const [km, setKm] = useState("");
  const s = useSubmit(onDone);
  useEffect(() => {
    if (!open) return;
    s.setError(null);
    setEndDate(todayIso());
    setKm("");
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!usage) return null;
  return (
    <Shell
      open={open}
      onClose={onClose}
      title={`End usage: ${vehicleNo}`}
      busy={s.busy}
      error={s.error}
      submitLabel="End usage"
      disabled={!endDate || !km}
      onSubmit={() => s.run((t) => vehiclesApi(`/usages/${usage.id}/end`, "POST", t, { endDate, endMileage: km }))}
    >
      <Typography variant="body2" color="text.secondary">
        {usage.driverName} since {fmtDate(usage.startDate)}, {fmtKm(usage.startMileage)} at start.
      </Typography>
      {dateField("Usage end date", endDate, setEndDate, true)}
      {kmField("Mileage at end", km, setKm)}
    </Shell>
  );
}

export function EditUsageDialog({ open, onClose, usage, drivers, onDone }: { open: boolean; onClose: () => void; usage: VehicleUsage | null; drivers: Driver[]; onDone: () => void }) {
  const [f, setF] = useState({ userId: null as string | null, name: "", startDate: "", startKm: "", endDate: "", endKm: "" });
  const s = useSubmit(onDone);
  useEffect(() => {
    if (!open || !usage) return;
    s.setError(null);
    setF({
      userId: usage.driverUserId,
      name: usage.driverName,
      startDate: usage.startDate,
      startKm: String(usage.startMileage),
      endDate: usage.endDate ?? "",
      endKm: usage.endMileage != null ? String(usage.endMileage) : "",
    });
  }, [open, usage]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!usage) return null;
  return (
    <Shell
      open={open}
      onClose={onClose}
      title="Edit usage"
      busy={s.busy}
      error={s.error}
      submitLabel="Save"
      disabled={!f.name.trim() || !f.startDate || !f.startKm}
      onSubmit={() =>
        s.run((t) =>
          vehiclesApi(`/usages/${usage.id}`, "PATCH", t, {
            driverUserId: f.userId,
            driverName: f.name,
            startDate: f.startDate,
            startMileage: f.startKm,
            endDate: f.endDate || null,
            endMileage: f.endKm || null,
          }),
        )
      }
    >
      <DriverField drivers={drivers} userId={f.userId} name={f.name} onChange={(d) => setF((p) => ({ ...p, userId: d.userId, name: d.name }))} />
      {dateField("Usage start date", f.startDate, (v) => setF((p) => ({ ...p, startDate: v })), true)}
      {kmField("Mileage at start", f.startKm, (v) => setF((p) => ({ ...p, startKm: v })))}
      {dateField("Usage end date", f.endDate, (v) => setF((p) => ({ ...p, endDate: v })))}
      <TextField
        size="small"
        label="Mileage at end"
        value={f.endKm}
        onChange={(e) => setF((p) => ({ ...p, endKm: e.target.value.replace(/[^\d,]/g, "") }))}
        helperText="Leave the end date and mileage empty while the vehicle is still in use"
        fullWidth
      />
    </Shell>
  );
}

// ------------------------------------------------------------------ repair

export function RepairDialog({ open, onClose, usage, onDone }: { open: boolean; onClose: () => void; usage: VehicleUsage | null; onDone: () => void }) {
  const [text, setText] = useState("");
  const s = useSubmit(onDone);
  useEffect(() => {
    if (!open) return;
    s.setError(null);
    setText(usage?.repairDetails ?? "");
  }, [open, usage]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!usage) return null;
  return (
    <Shell
      open={open}
      onClose={onClose}
      title="Log damage or repair"
      busy={s.busy}
      error={s.error}
      submitLabel="Save"
      onSubmit={() => s.run((t) => vehiclesApi(`/usages/${usage.id}/repair`, "PUT", t, { repairDetails: text }))}
    >
      <Typography variant="body2" color="text.secondary">
        {usage.driverName}, {fmtDate(usage.startDate)}
        {usage.endDate ? ` to ${fmtDate(usage.endDate)}` : " (in use)"}
      </Typography>
      <TextField size="small" label="Damage / issue / repair details" value={text} onChange={(e) => setText(e.target.value)} multiline minRows={3} fullWidth autoFocus />
    </Shell>
  );
}

export function ApproveRepairDialog({ open, onClose, usage, myName, onDone }: { open: boolean; onClose: () => void; usage: VehicleUsage | null; myName: string; onDone: () => void }) {
  const [by, setBy] = useState("");
  const [date, setDate] = useState(todayIso());
  const s = useSubmit(onDone);
  useEffect(() => {
    if (!open) return;
    s.setError(null);
    setBy(myName);
    setDate(todayIso());
  }, [open, myName]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!usage) return null;
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
      onSubmit={() => s.run((t) => vehiclesApi(`/usages/${usage.id}/approve`, "POST", t, { approvedBy: by, approvedDate: date }))}
    >
      <Alert severity="info" variant="outlined">
        {usage.repairDetails}
      </Alert>
      <TextField size="small" label="Repair approved by" value={by} onChange={(e) => setBy(e.target.value)} required fullWidth />
      {dateField("Repair approved date", date, setDate, true)}
      <Typography variant="caption" color="text.secondary">
        Once approved the repair is locked. Only an admin can unlock it, with a reason.
      </Typography>
    </Shell>
  );
}

export function UnlockRepairDialog({ open, onClose, usage, onDone }: { open: boolean; onClose: () => void; usage: VehicleUsage | null; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const s = useSubmit(onDone);
  useEffect(() => {
    if (!open) return;
    s.setError(null);
    setReason("");
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!usage) return null;
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
      onSubmit={() => s.run((t) => vehiclesApi(`/usages/${usage.id}/unlock`, "POST", t, { reason }))}
    >
      <Typography variant="body2">
        Approved by {usage.repairApprovedBy} on {fmtDate(usage.repairApprovedAt)}. Unlocking removes the approval so the details can be changed; it is recorded with your reason in the Activity Log.
      </Typography>
      <TextField size="small" label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} required multiline minRows={2} fullWidth autoFocus />
    </Shell>
  );
}
