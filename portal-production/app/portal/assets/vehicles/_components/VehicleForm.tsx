"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAppBack } from "@/app/portal/hooks/useAppBack";
import { useAuth } from "@clerk/nextjs";
import { Alert, Box, Button, CircularProgress, Paper, Stack, TextField, Typography } from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { toast } from "react-toastify";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";
import { useUserPermissions } from "@/app/portal/hooks/useUserPermissions";
import { canVehicles, vehiclesApi, type VehicleRow } from "@/helpers/wctVehicles";
import { VEHICLES_PATH, vehicleHref } from "@/helpers/wctNav";

/**
 * Add / edit a vehicle as a full page (2026-11-16; was the Edit details pop-up).
 * Same fields as the pop-up. Edit also holds Archive / Restore (it was in the
 * list's row menu). Save / Cancel go back to the vehicle (Add: to the new one,
 * Cancel to the list).
 */
type Fields = { vehicleNo: string; model: string; coeExpiry: string; lifespanExpiry: string; roadTaxExpiry: string; insuranceExpiry: string; inspectionExpiry: string; notes: string };
const EMPTY: Fields = { vehicleNo: "", model: "", coeExpiry: "", lifespanExpiry: "", roadTaxExpiry: "", insuranceExpiry: "", inspectionExpiry: "", notes: "" };
export const fieldsOf = (v: Partial<VehicleRow> | null | undefined): Fields => ({
  vehicleNo: v?.vehicleNo ?? "",
  model: v?.model ?? "",
  coeExpiry: v?.coeExpiry ?? "",
  lifespanExpiry: v?.lifespanExpiry ?? "",
  roadTaxExpiry: v?.roadTaxExpiry ?? "",
  insuranceExpiry: v?.insuranceExpiry ?? "",
  inspectionExpiry: v?.inspectionExpiry ?? "",
  notes: v?.notes ?? "",
});

const dateField = (label: string, value: string, onChange: (v: string) => void) => (
  <TextField size="small" type="date" label={label} value={value} onChange={(e) => onChange(e.target.value)} InputLabelProps={{ shrink: true }} fullWidth />
);

export default function VehicleForm({ id }: { id?: string }) {
  const router = useRouter();
  const { getToken } = useAuth();
  const { isWctVehiclesEnabled } = useOrganizationFeatures();
  const { hasPermission, userRoles } = useUserPermissions();
  const canEdit = canVehicles(userRoles, hasPermission, "update");
  const [vehicle, setVehicle] = useState<VehicleRow | null>(null);
  const [f, setF] = useState<Fields>(EMPTY);
  const [loading, setLoading] = useState(!!id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const back = id ? vehicleHref(id) : VEHICLES_PATH;
  // enableWctDocNav: the Back button = the previous page in the app, else `back`.
  const { goBack, enabled: inAppBack } = useAppBack();

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const token = await getToken();
        if (!token) throw new Error("Not signed in");
        const v = await vehiclesApi<VehicleRow>(`/${id}`, "GET", token);
        setVehicle(v);
        setF(fieldsOf(v));
      } catch (e: any) {
        setError(e?.message ?? "Could not load the vehicle");
      } finally {
        setLoading(false);
      }
    })();
  }, [id, getToken]);

  const set = (k: keyof Fields) => (v: string) => setF((p) => ({ ...p, [k]: v }));
  const call = async <T,>(fn: (token: string) => Promise<T>): Promise<T | null> => {
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      return await fn(token);
    } catch (e: any) {
      setError(e?.message ?? "Could not save");
      return null;
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    const res = await call((t) => (id ? vehiclesApi<VehicleRow>(`/${id}`, "PATCH", t, f) : vehiclesApi<VehicleRow>("", "POST", t, f)));
    if (!res) return;
    ((res as any)?.warnings ?? []).forEach((w: string) => toast.warning(w, { autoClose: 9000 }));
    router.push(vehicleHref(id ?? (res as VehicleRow).id));
  };
  const archive = async () => {
    if (!vehicle) return;
    const res = await call((t) => vehiclesApi(`/${vehicle.id}/archive`, "POST", t, { archived: !vehicle.archived }));
    if (res === null) return;
    toast.success(vehicle.archived ? `${vehicle.vehicleNo} restored` : `${vehicle.vehicleNo} archived`);
    router.push(vehicle.archived ? vehicleHref(vehicle.id) : VEHICLES_PATH);
  };

  if (!isWctVehiclesEnabled || !canEdit) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="info">{!isWctVehiclesEnabled ? "Vehicles are not enabled for this organisation." : "You can't edit vehicles."}</Alert>
      </Box>
    );
  }
  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 10 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2, maxWidth: 760 }}>
      <Box>
        <Button startIcon={<ArrowBackIcon />} onClick={() => goBack(back)} disabled={busy}>
          {inAppBack ? "Back" : id ? "Back to vehicle" : "Back to vehicles"}
        </Button>
      </Box>
      <Paper variant="outlined" sx={{ p: 2.5 }}>
        <Typography variant="h5" fontWeight={700} sx={{ mb: 2 }}>
          {id ? `Edit ${vehicle?.vehicleNo ?? "vehicle"}` : "Add vehicle"}
        </Typography>
        <Stack spacing={2}>
          <TextField size="small" label="Vehicle / Lorry No." placeholder="e.g. GBD1126U" value={f.vehicleNo} onChange={(e) => set("vehicleNo")(e.target.value)} required fullWidth />
          <TextField size="small" label="Model" placeholder="e.g. Nissan NV350 Panel Van" value={f.model} onChange={(e) => set("model")(e.target.value)} fullWidth />
          {dateField("COE Expiry Date", f.coeExpiry, set("coeExpiry"))}
          {dateField("Vehicle Lifespan Expiry Date", f.lifespanExpiry, set("lifespanExpiry"))}
          {dateField("Road tax expiry", f.roadTaxExpiry, set("roadTaxExpiry"))}
          {dateField("Insurance expiry", f.insuranceExpiry, set("insuranceExpiry"))}
          {dateField("Inspection due", f.inspectionExpiry, set("inspectionExpiry"))}
          <TextField size="small" label="Notes (optional)" value={f.notes} onChange={(e) => set("notes")(e.target.value)} multiline minRows={2} fullWidth />
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
        <Stack direction="row" spacing={1} justifyContent="space-between" sx={{ mt: 3 }} flexWrap="wrap" useFlexGap>
          <Box>
            {vehicle && (
              <Button color={vehicle.archived ? "primary" : "error"} variant="outlined" onClick={() => void archive()} disabled={busy} data-tour="vehicle-archive">
                {vehicle.archived ? "Restore" : "Archive"}
              </Button>
            )}
          </Box>
          <Stack direction="row" spacing={1}>
            <Button onClick={() => router.push(back)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="contained" onClick={() => void save()} disabled={busy || !f.vehicleNo.trim()} startIcon={busy ? <CircularProgress size={16} color="inherit" /> : undefined}>
              {id ? "Save" : "Add vehicle"}
            </Button>
          </Stack>
        </Stack>
      </Paper>
    </Box>
  );
}
