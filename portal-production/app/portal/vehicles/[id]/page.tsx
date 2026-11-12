"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth, useUser } from "@clerk/nextjs";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Grid,
  IconButton,
  Menu,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import StopIcon from "@mui/icons-material/Stop";
import EditIcon from "@mui/icons-material/Edit";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import LockIcon from "@mui/icons-material/Lock";
import { toast } from "react-toastify";
import { useOrganization } from "@hooks/useOrganization";
import { useUserPermissions } from "@/app/portal/hooks/useUserPermissions";
import { ReportPrintExportButton } from "@/app/portal/accounting/_lib/report-export";
import { canVehicles, expiryChip, fetchVehicleLogPdf, fmtDate, fmtKm, vehiclesApi, type VehicleDetail, type VehicleUsage } from "@/helpers/wctVehicles";
import {
  ApproveRepairDialog,
  EditUsageDialog,
  EndUsageDialog,
  RepairDialog,
  StartUsageDialog,
  UnlockRepairDialog,
  VehicleFormDialog,
} from "../_components/VehicleDialogs";

type DialogKind = "start" | "end" | "edit" | "repair" | "approve" | "unlock" | "vehicle";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Box sx={{ mb: 1.5 }}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Box sx={{ typography: "body1", fontWeight: 500 }}>{children}</Box>
    </Box>
  );
}

function Expiry({ date, days }: { date: string | null; days: number | null }) {
  const chip = expiryChip(days);
  return (
    <Stack direction="row" spacing={1} alignItems="center">
      <span>{fmtDate(date)}</span>
      {chip && <Chip size="small" label={chip.label} color={chip.color} variant="outlined" />}
    </Stack>
  );
}

/**
 * One vehicle (enableWctVehicles, 2026-11-12): its details and the usage &
 * repair log, newest first. Start / End usage at the top; each row's three dots
 * hold End usage, Edit, Log damage or repair, Approve repair (admins) and
 * Unlock (admins, with a reason). Print / Export prints the paper "Vehicle /
 * Lorry Usage & Repair Form" the server draws.
 */
export default function VehiclePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { getToken } = useAuth();
  const { user } = useUser();
  const { organization } = useOrganization();
  const { hasPermission, userRoles } = useUserPermissions();
  const canEdit = canVehicles(userRoles, hasPermission, "update");
  const canApprove = canVehicles(userRoles, hasPermission, "approve");
  const [v, setV] = useState<VehicleDetail | null>(null);
  const [drivers, setDrivers] = useState<Array<{ id: string; name: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ kind: DialogKind; usage?: VehicleUsage | null } | null>(null);
  const [menu, setMenu] = useState<{ pos: { left: number; top: number }; usage: VehicleUsage } | null>(null);
  const printFrame = useRef<HTMLIFrameElement>(null);

  const load = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      setV(await vehiclesApi<VehicleDetail>(`/${id}`, "GET", token));
    } catch (e: any) {
      setError(e?.message ?? "Could not load the vehicle");
    }
  }, [id, getToken]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!canEdit) return;
    (async () => {
      const token = await getToken();
      if (token) setDrivers(await vehiclesApi(`/drivers`, "GET", token).catch(() => []));
    })();
  }, [canEdit, getToken]);

  const done = () => {
    setDialog(null);
    void load();
  };

  const pdfBlob = async () => {
    const token = await getToken();
    if (!token) throw new Error("Not signed in");
    return fetchVehicleLogPdf(id, token);
  };
  const printForm = async () => {
    try {
      const url = URL.createObjectURL(await pdfBlob());
      const frame = printFrame.current!;
      frame.onload = () => {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
      };
      frame.src = url;
      setTimeout(() => URL.revokeObjectURL(url), 120_000);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not print the form");
    }
  };
  const saveForm = async () => {
    try {
      const url = URL.createObjectURL(await pdfBlob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `Vehicle usage log ${v?.vehicleNo ?? ""}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save the form");
    }
  };

  if (error && !v) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{error}</Alert>
        <Button sx={{ mt: 2 }} startIcon={<ArrowBackIcon />} onClick={() => router.push("/portal/vehicles")}>
          Back to vehicles
        </Button>
      </Box>
    );
  }
  if (!v) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 10 }}>
        <CircularProgress />
      </Box>
    );
  }

  const open = v.usages.find((u) => u.open) ?? null;
  // Excel / CSV of the log (Print and Save as PDF are the paper form).
  const exportModel = () => ({
    title: `VEHICLE / LORRY USAGE & REPAIR FORM: ${v.vehicleNo}`,
    orgName: organization?.name ?? "",
    metaLines: [`Model : ${v.model ?? "-"}`, `COE Expiry Date : ${fmtDate(v.coeExpiry)}`, `Vehicle Lifespan Expiry Date : ${fmtDate(v.lifespanExpiry)}`],
    tables: [
      {
        headers: ["No.", "Assigned Driver", "Usage Start Date", "Mileage at Start (km)", "Usage End Date", "Mileage at End (km)", "Damage / Issue / Repair Details", "Repair Approved By", "Repair Approved Date"],
        rows: [...v.usages].reverse().map((u, i) => [
          String(i + 1),
          u.driverName,
          fmtDate(u.startDate),
          String(u.startMileage),
          u.endDate ? fmtDate(u.endDate) : "",
          u.endMileage != null ? String(u.endMileage) : "",
          u.repairDetails ?? "",
          u.repairApprovedBy ?? "",
          u.repairApprovedAt ? fmtDate(u.repairApprovedAt) : "",
        ]),
      },
    ],
  });

  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => router.push("/portal/vehicles")}>
          Back to vehicles
        </Button>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {canEdit && !v.archived && !open && (
            <Button variant="contained" startIcon={<PlayArrowIcon />} onClick={() => setDialog({ kind: "start" })} data-tour="vehicle-start-usage">
              Start usage
            </Button>
          )}
          {canEdit && open && (
            <Button variant="contained" color="warning" startIcon={<StopIcon />} onClick={() => setDialog({ kind: "end", usage: open })} data-tour="vehicle-end-usage">
              End usage
            </Button>
          )}
          <Box data-tour="vehicle-print">
            <ReportPrintExportButton getModel={exportModel} onPrint={() => void printForm()} onSavePdf={() => void saveForm()} size="medium" />
          </Box>
        </Stack>
      </Stack>

      {error && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Paper variant="outlined" sx={{ p: 2.5 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 1 }}>
          <Box>
            <Typography variant="h5" fontWeight={700}>
              {v.vehicleNo}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {v.model ?? "Model not set"}
              {v.archived ? " · Archived" : ""}
            </Typography>
          </Box>
          {canEdit && (
            <Button size="small" startIcon={<EditIcon />} onClick={() => setDialog({ kind: "vehicle" })}>
              Edit details
            </Button>
          )}
        </Stack>
        <Grid container spacing={2}>
          <Grid item xs={6} md={3}>
            <Field label="COE Expiry Date">
              <Expiry date={v.coeExpiry} days={v.coeDays} />
            </Field>
          </Grid>
          <Grid item xs={6} md={3}>
            <Field label="Vehicle Lifespan Expiry Date">
              <Expiry date={v.lifespanExpiry} days={v.lifespanDays} />
            </Field>
          </Grid>
          <Grid item xs={6} md={3}>
            <Field label="Current driver">{open ? `${open.driverName} since ${fmtDate(open.startDate)}` : "Available"}</Field>
          </Grid>
          <Grid item xs={6} md={3}>
            <Field label="Last mileage">{fmtKm(v.lastMileage)}</Field>
          </Grid>
          {v.notes && (
            <Grid item xs={12}>
              <Field label="Notes">{v.notes}</Field>
            </Grid>
          )}
        </Grid>
      </Paper>

      <Typography variant="h6" fontWeight={700}>
        Usage &amp; repair log
      </Typography>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 600 }}>Assigned driver</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Start</TableCell>
              <TableCell sx={{ fontWeight: 600 }} align="right">Mileage at start</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>End</TableCell>
              <TableCell sx={{ fontWeight: 600 }} align="right">Mileage at end</TableCell>
              <TableCell sx={{ fontWeight: 600, width: "30%" }}>Damage / issue / repair</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Repair approved</TableCell>
              {canEdit && <TableCell sx={{ width: 48 }} />}
            </TableRow>
          </TableHead>
          <TableBody>
            {v.usages.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} align="center" sx={{ py: 5, color: "text.secondary" }}>
                  No usage logged yet.{canEdit && !v.archived ? " Use Start usage when a driver takes the vehicle." : ""}
                </TableCell>
              </TableRow>
            )}
            {v.usages.map((u) => (
              <TableRow
                key={u.id}
                hover={canEdit}
                sx={{ cursor: canEdit ? "pointer" : "default" }}
                onClick={() => canEdit && setDialog({ kind: "edit", usage: u })}
              >
                <TableCell>{u.driverName}</TableCell>
                <TableCell>{fmtDate(u.startDate)}</TableCell>
                <TableCell align="right">{u.startMileage.toLocaleString("en-SG")}</TableCell>
                <TableCell>{u.open ? <Chip size="small" color="info" variant="outlined" label="In use" /> : fmtDate(u.endDate)}</TableCell>
                <TableCell align="right">{u.endMileage != null ? u.endMileage.toLocaleString("en-SG") : "-"}</TableCell>
                <TableCell sx={{ whiteSpace: "pre-wrap" }}>
                  {u.repairDetails ?? "-"}
                  {u.repairUnlocks.length > 0 && (
                    <Typography variant="caption" color="text.secondary" display="block">
                      Unlocked {u.repairUnlocks.length}x, last by {u.repairUnlocks[u.repairUnlocks.length - 1].byName ?? "an admin"}: {u.repairUnlocks[u.repairUnlocks.length - 1].reason}
                    </Typography>
                  )}
                </TableCell>
                <TableCell>
                  {u.repairLocked ? (
                    <Tooltip title="Approved and locked">
                      <Stack direction="row" spacing={0.5} alignItems="center">
                        <LockIcon fontSize="inherit" color="success" />
                        <span>
                          {u.repairApprovedBy}, {fmtDate(u.repairApprovedAt)}
                        </span>
                      </Stack>
                    </Tooltip>
                  ) : u.repairDetails ? (
                    <Chip size="small" color="warning" variant="outlined" label="To approve" />
                  ) : (
                    "-"
                  )}
                </TableCell>
                {canEdit && (
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <IconButton size="small" aria-label="More" onClick={(e) => setMenu({ pos: { left: e.clientX, top: e.clientY }, usage: u })}>
                      <MoreVertIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Menu open={!!menu} onClose={() => setMenu(null)} anchorReference="anchorPosition" anchorPosition={menu?.pos}>
        {menu?.usage.open && <MenuItem onClick={() => { setDialog({ kind: "end", usage: menu.usage }); setMenu(null); }}>End usage</MenuItem>}
        <MenuItem onClick={() => { setDialog({ kind: "edit", usage: menu!.usage }); setMenu(null); }}>Edit usage</MenuItem>
        {!menu?.usage.repairLocked && (
          <MenuItem data-tour="vehicle-log-repair" onClick={() => { setDialog({ kind: "repair", usage: menu!.usage }); setMenu(null); }}>
            Log damage or repair
          </MenuItem>
        )}
        {canApprove && menu?.usage.repairDetails && !menu.usage.repairLocked && (
          <MenuItem sx={{ color: "success.main" }} onClick={() => { setDialog({ kind: "approve", usage: menu.usage }); setMenu(null); }}>
            Approve repair
          </MenuItem>
        )}
        {canApprove && menu?.usage.repairLocked && (
          <MenuItem sx={{ color: "warning.main" }} onClick={() => { setDialog({ kind: "unlock", usage: menu.usage }); setMenu(null); }}>
            Unlock repair
          </MenuItem>
        )}
      </Menu>

      <StartUsageDialog open={dialog?.kind === "start"} onClose={() => setDialog(null)} vehicle={v} drivers={drivers} onDone={done} />
      <EndUsageDialog open={dialog?.kind === "end"} onClose={() => setDialog(null)} usage={dialog?.usage ?? null} vehicleNo={v.vehicleNo} onDone={done} />
      <EditUsageDialog open={dialog?.kind === "edit"} onClose={() => setDialog(null)} usage={dialog?.usage ?? null} drivers={drivers} onDone={done} />
      <RepairDialog open={dialog?.kind === "repair"} onClose={() => setDialog(null)} usage={dialog?.usage ?? null} onDone={done} />
      <ApproveRepairDialog open={dialog?.kind === "approve"} onClose={() => setDialog(null)} usage={dialog?.usage ?? null} myName={user?.fullName || user?.primaryEmailAddress?.emailAddress || ""} onDone={done} />
      <UnlockRepairDialog open={dialog?.kind === "unlock"} onClose={() => setDialog(null)} usage={dialog?.usage ?? null} onDone={done} />
      <VehicleFormDialog open={dialog?.kind === "vehicle"} onClose={() => setDialog(null)} vehicle={v} onDone={done} />

      {/* The paper form is printed from here (same-origin blob). */}
      <iframe ref={printFrame} title="Vehicle usage form" style={{ position: "absolute", width: 0, height: 0, border: 0, visibility: "hidden" }} />
    </Box>
  );
}
