"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth, useUser } from "@clerk/nextjs";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Grid,
  IconButton,
  Link,
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
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import PersonAddAlt1Icon from "@mui/icons-material/PersonAddAlt1";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import LockIcon from "@mui/icons-material/Lock";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import { toast } from "react-toastify";
import { useOrganization } from "@hooks/useOrganization";
import { useUserPermissions } from "@/app/portal/hooks/useUserPermissions";
import { ReportPrintExportButton } from "@/app/portal/accounting/_lib/report-export";
import {
  LOG_TYPES,
  LOG_TYPE_COLOR,
  LOG_TYPE_LABEL,
  LOG_TYPE_SHORT,
  canVehicles,
  expiryChip,
  fetchVehicleLogPdf,
  fileUrl,
  filterEntries,
  fmtDate,
  fmtKm,
  fmtMoney,
  vehiclesApi,
  type MoneyPeriod,
  type VehicleDetail,
  type VehicleLogEntry,
} from "@/helpers/wctVehicles";
import { ApproveRepairDialog, AssignDriverDialog, DeleteEntryDialog, LogEntryDialog, UnlockRepairDialog, VehicleFormDialog } from "../_components/VehicleDialogs";

type DialogKind = "driver" | "entry" | "edit" | "delete" | "approve" | "unlock" | "vehicle";

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

function Expiry({ date, days }: { date: string | null | undefined; days: number | null | undefined }) {
  const chip = expiryChip(days ?? null);
  return (
    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
      <span>{fmtDate(date)}</span>
      {chip && <Chip size="small" label={chip.label} color={chip.color} variant="outlined" />}
    </Stack>
  );
}

/** One period of the money card: the total and the types that have spending. */
function MoneyColumn({ title, p }: { title: string; p: MoneyPeriod }) {
  const parts = LOG_TYPES.filter((t) => p.byType[t] > 0);
  return (
    <Box sx={{ flex: 1, minWidth: 180 }}>
      <Typography variant="caption" color="text.secondary">
        {title}
      </Typography>
      <Typography variant="h6" fontWeight={700} sx={{ fontVariantNumeric: "tabular-nums" }}>
        {fmtMoney(p.total)}
      </Typography>
      {parts.length ? (
        parts.map((t) => (
          <Stack key={t} direction="row" justifyContent="space-between" sx={{ typography: "caption", color: "text.secondary" }}>
            <span>{LOG_TYPE_SHORT[t]}</span>
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{fmtMoney(p.byType[t])}</span>
          </Stack>
        ))
      ) : (
        <Typography variant="caption" color="text.disabled">
          Nothing spent
        </Typography>
      )}
    </Box>
  );
}

/**
 * One vehicle's LOG BOOK (enableWctVehicles; log book 2026-11-16): the current
 * driver (the latest "Driver assigned" entry), last mileage and expiry warnings,
 * the money it has cost (this month / this year / all time by type), and every
 * transaction newest first with type and date filters. "Assign new driver" and
 * "Add log entry" add entries; a row opens its entry, the three dots hold Edit,
 * Approve / Unlock repair (admins) and Delete. Print / Export prints the log in
 * the paper form's layout and exports it to Excel / CSV with the amounts.
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
  const [dialog, setDialog] = useState<{ kind: DialogKind; entry?: VehicleLogEntry | null } | null>(null);
  const [menu, setMenu] = useState<{ pos: { left: number; top: number }; entry: VehicleLogEntry } | null>(null);
  const [filter, setFilter] = useState<{ type: string; from: string; to: string }>({ type: "", from: "", to: "" });
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

  const rows = useMemo(() => filterEntries(v?.entries ?? [], filter), [v, filter]);
  const filtered = !!(filter.type || filter.from || filter.to);
  const rowsTotal = Math.round(rows.reduce((t, e) => t + (e.amount ?? 0), 0) * 100) / 100;

  const done = () => {
    setDialog(null);
    void load();
  };

  const pdfBlob = async () => {
    const token = await getToken();
    if (!token) throw new Error("Not signed in");
    return fetchVehicleLogPdf(id, token, filter);
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
      toast.error(e?.message ?? "Could not print the log");
    }
  };
  const saveForm = async () => {
    try {
      const url = URL.createObjectURL(await pdfBlob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `Vehicle log book ${v?.vehicleNo ?? ""}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save the log");
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

  // Excel / CSV: the log as filtered on screen (oldest first, with amounts) and the money summary.
  const exportModel = () => ({
    title: `VEHICLE / LORRY LOG BOOK: ${v.vehicleNo}`,
    orgName: organization?.name ?? "",
    metaLines: [
      `Model : ${v.model ?? "-"}`,
      `Current driver : ${v.currentDriver ?? "-"}`,
      `COE Expiry Date : ${fmtDate(v.coeExpiry)}`,
      `Vehicle Lifespan Expiry Date : ${fmtDate(v.lifespanExpiry)}`,
      ...(filtered ? [`Filter : ${[filter.type ? LOG_TYPE_LABEL[filter.type as keyof typeof LOG_TYPE_LABEL] : "", filter.from ? `from ${fmtDate(filter.from)}` : "", filter.to ? `to ${fmtDate(filter.to)}` : ""].filter(Boolean).join(", ")}`] : []),
    ],
    tables: [
      {
        heading: "Log",
        headers: ["No.", "Date", "Type", "Details", "Driver", "Mileage (km)", "Amount (SGD)", "Attachment", "Repair Approved By", "Repair Approved Date", "Entered by"],
        rows: [
          ...[...rows].reverse().map((e, i) => [
            String(i + 1),
            fmtDate(e.date),
            e.typeLabel,
            e.details,
            e.driverName ?? "",
            e.mileage != null ? String(e.mileage) : "",
            e.amount != null ? e.amount.toFixed(2) : "",
            e.attachment ? e.attachment.fileName || "Attached" : "",
            e.repairApprovedBy ?? "",
            e.repairApprovedAt ? fmtDate(e.repairApprovedAt) : "",
            e.createdByName ?? "",
          ]),
          ["", "", "", "TOTAL", "", "", rowsTotal.toFixed(2), "", "", "", ""],
        ],
        boldRows: [rows.length],
      },
      {
        heading: "Money spent (SGD)",
        headers: ["Type", "This month", "This year", "All time"],
        rows: [
          ...LOG_TYPES.map((t) => [LOG_TYPE_LABEL[t], v.summary.month.byType[t].toFixed(2), v.summary.year.byType[t].toFixed(2), v.summary.all.byType[t].toFixed(2)]),
          ["TOTAL", v.summary.month.total.toFixed(2), v.summary.year.total.toFixed(2), v.summary.all.total.toFixed(2)],
        ],
        boldRows: [LOG_TYPES.length],
      },
    ],
  });

  const extraExpiries = [
    { label: "Road tax expiry", date: v.roadTaxExpiry, days: v.roadTaxDays },
    { label: "Insurance expiry", date: v.insuranceExpiry, days: v.insuranceDays },
    { label: "Inspection due", date: v.inspectionExpiry, days: v.inspectionDays },
  ].filter((x) => !!x.date);

  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => router.push("/portal/vehicles")}>
          Back to vehicles
        </Button>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {canEdit && !v.archived && (
            <>
              <Button variant="outlined" startIcon={<PersonAddAlt1Icon />} onClick={() => setDialog({ kind: "driver" })} data-tour="vehicle-assign-driver">
                Assign new driver
              </Button>
              <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialog({ kind: "entry" })} data-tour="vehicle-add-log-entry">
                Add log entry
              </Button>
            </>
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
            <Field label="Current driver">{v.currentDriver ? `${v.currentDriver} since ${fmtDate(v.driverSince)}` : "Not assigned"}</Field>
          </Grid>
          <Grid item xs={6} md={3}>
            <Field label="Last mileage">{fmtKm(v.lastMileage)}</Field>
          </Grid>
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
          {extraExpiries.map((x) => (
            <Grid item xs={6} md={3} key={x.label}>
              <Field label={x.label}>
                <Expiry date={x.date} days={x.days} />
              </Field>
            </Grid>
          ))}
          {v.notes && (
            <Grid item xs={12}>
              <Field label="Notes">{v.notes}</Field>
            </Grid>
          )}
        </Grid>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2.5 }} data-tour="vehicle-money-summary">
        <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
          Money spent
        </Typography>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={3} divider={<Divider orientation="vertical" flexItem />}>
          <MoneyColumn title="This month" p={v.summary.month} />
          <MoneyColumn title="This year" p={v.summary.year} />
          <MoneyColumn title="All time" p={v.summary.all} />
        </Stack>
      </Paper>

      <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" alignItems={{ xs: "stretch", md: "center" }} gap={1}>
        <Typography variant="h6" fontWeight={700}>
          Log book
        </Typography>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ xs: "stretch", sm: "center" }}>
          <TextField select size="small" label="Type" value={filter.type} onChange={(e) => setFilter((f) => ({ ...f, type: e.target.value }))} sx={{ minWidth: 220 }}>
            <MenuItem value="">All types</MenuItem>
            {LOG_TYPES.map((t) => (
              <MenuItem key={t} value={t}>
                {LOG_TYPE_LABEL[t]}
              </MenuItem>
            ))}
          </TextField>
          <TextField size="small" type="date" label="From" value={filter.from} onChange={(e) => setFilter((f) => ({ ...f, from: e.target.value }))} InputLabelProps={{ shrink: true }} />
          <TextField size="small" type="date" label="To" value={filter.to} onChange={(e) => setFilter((f) => ({ ...f, to: e.target.value }))} InputLabelProps={{ shrink: true }} />
          {filtered && <Button onClick={() => setFilter({ type: "", from: "", to: "" })}>Clear</Button>}
        </Stack>
      </Stack>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 600 }}>Date</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Type</TableCell>
              <TableCell sx={{ fontWeight: 600, width: "32%" }}>Details</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Driver</TableCell>
              <TableCell sx={{ fontWeight: 600 }} align="right">
                Mileage
              </TableCell>
              <TableCell sx={{ fontWeight: 600 }} align="right">
                Amount
              </TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Attachment</TableCell>
              {canEdit && <TableCell sx={{ width: 48 }} />}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} align="center" sx={{ py: 5, color: "text.secondary" }}>
                  {filtered ? "No entries match the filters." : `Nothing logged yet.${canEdit && !v.archived ? " Use Assign new driver or Add log entry." : ""}`}
                </TableCell>
              </TableRow>
            )}
            {rows.map((e) => (
              <TableRow key={e.id} hover={canEdit} sx={{ cursor: canEdit ? "pointer" : "default" }} onClick={() => canEdit && !e.repairLocked && setDialog({ kind: "edit", entry: e })}>
                <TableCell sx={{ whiteSpace: "nowrap" }}>{fmtDate(e.date)}</TableCell>
                <TableCell>
                  <Chip size="small" variant="outlined" color={LOG_TYPE_COLOR[e.type]} label={e.typeLabel} />
                </TableCell>
                <TableCell sx={{ whiteSpace: "pre-wrap" }}>
                  {e.details || "-"}
                  {e.type === "REPAIR" && (
                    <Box sx={{ mt: 0.5 }}>
                      {e.repairLocked ? (
                        <Tooltip title="Approved and locked">
                          <Stack direction="row" spacing={0.5} alignItems="center" sx={{ typography: "caption", color: "success.main" }}>
                            <LockIcon fontSize="inherit" />
                            <span>
                              Approved by {e.repairApprovedBy}, {fmtDate(e.repairApprovedAt)}
                            </span>
                          </Stack>
                        </Tooltip>
                      ) : (
                        <Chip size="small" color="warning" variant="outlined" label="To approve" />
                      )}
                    </Box>
                  )}
                  {e.repairUnlocks.length > 0 && (
                    <Typography variant="caption" color="text.secondary" display="block">
                      Unlocked {e.repairUnlocks.length}x, last by {e.repairUnlocks[e.repairUnlocks.length - 1].byName ?? "an admin"}: {e.repairUnlocks[e.repairUnlocks.length - 1].reason}
                    </Typography>
                  )}
                </TableCell>
                <TableCell>{e.driverName ?? "-"}</TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>
                  {e.mileage != null ? e.mileage.toLocaleString("en-SG") : "-"}
                </TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                  {e.amount != null ? fmtMoney(e.amount) : "-"}
                </TableCell>
                <TableCell onClick={(ev) => ev.stopPropagation()}>
                  {e.attachment ? (
                    <Link href={fileUrl(e.attachment.key)} target="_blank" rel="noopener" sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
                      <AttachFileIcon fontSize="inherit" />
                      {e.attachment.fileName || "Open"}
                    </Link>
                  ) : (
                    "-"
                  )}
                </TableCell>
                {canEdit && (
                  <TableCell onClick={(ev) => ev.stopPropagation()}>
                    <IconButton size="small" aria-label="More" onClick={(ev) => setMenu({ pos: { left: ev.clientX, top: ev.clientY }, entry: e })}>
                      <MoreVertIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                )}
              </TableRow>
            ))}
            {rows.length > 0 && (
              <TableRow>
                <TableCell colSpan={5} align="right" sx={{ fontWeight: 700 }}>
                  {filtered ? "Total (filtered)" : "Total"}
                </TableCell>
                <TableCell align="right" sx={{ fontWeight: 700, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                  {fmtMoney(rowsTotal)}
                </TableCell>
                <TableCell colSpan={canEdit ? 2 : 1} />
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Menu open={!!menu} onClose={() => setMenu(null)} anchorReference="anchorPosition" anchorPosition={menu?.pos}>
        {!menu?.entry.repairLocked && (
          <MenuItem
            onClick={() => {
              setDialog({ kind: "edit", entry: menu!.entry });
              setMenu(null);
            }}
          >
            Edit
          </MenuItem>
        )}
        {canApprove && menu?.entry.type === "REPAIR" && !menu.entry.repairLocked && (
          <MenuItem
            sx={{ color: "success.main" }}
            onClick={() => {
              setDialog({ kind: "approve", entry: menu.entry });
              setMenu(null);
            }}
          >
            Approve repair
          </MenuItem>
        )}
        {canApprove && menu?.entry.repairLocked && (
          <MenuItem
            sx={{ color: "warning.main" }}
            onClick={() => {
              setDialog({ kind: "unlock", entry: menu.entry });
              setMenu(null);
            }}
          >
            Unlock repair
          </MenuItem>
        )}
        {!menu?.entry.repairLocked && (
          <MenuItem
            sx={{ color: "error.main" }}
            onClick={() => {
              setDialog({ kind: "delete", entry: menu!.entry });
              setMenu(null);
            }}
          >
            Delete
          </MenuItem>
        )}
      </Menu>

      <AssignDriverDialog open={dialog?.kind === "driver"} onClose={() => setDialog(null)} vehicle={v} drivers={drivers} onDone={done} />
      <LogEntryDialog open={dialog?.kind === "entry" || dialog?.kind === "edit"} onClose={() => setDialog(null)} vehicle={v} drivers={drivers} entry={dialog?.kind === "edit" ? dialog.entry : null} onDone={done} />
      <DeleteEntryDialog open={dialog?.kind === "delete"} onClose={() => setDialog(null)} entry={dialog?.entry ?? null} onDone={done} />
      <ApproveRepairDialog open={dialog?.kind === "approve"} onClose={() => setDialog(null)} entry={dialog?.entry ?? null} myName={user?.fullName || user?.primaryEmailAddress?.emailAddress || ""} onDone={done} />
      <UnlockRepairDialog open={dialog?.kind === "unlock"} onClose={() => setDialog(null)} entry={dialog?.entry ?? null} onDone={done} />
      <VehicleFormDialog open={dialog?.kind === "vehicle"} onClose={() => setDialog(null)} vehicle={v} onDone={done} />

      {/* The paper form is printed from here (same-origin blob). */}
      <iframe ref={printFrame} title="Vehicle log book" style={{ position: "absolute", width: 0, height: 0, border: 0, visibility: "hidden" }} />
    </Box>
  );
}
