"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import {
  Alert,
  Box,
  Breadcrumbs,
  Button,
  Chip,
  CircularProgress,
  Link as MuiLink,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import EventIcon from "@mui/icons-material/Event";
import NextLink from "next/link";
import { request } from "@/helpers/request";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";
import MaintenanceScheduleDialog, { MaintenanceScheduleEdit } from "@/components/maintenance/MaintenanceScheduleDialog";
import { daysUntil, fmtDay } from "@/components/maintenance/maintenanceDates";

/**
 * Maintenance Dates -> one asset (Biofuel, 2026-09): the next date, past and
 * cancelled dates, and every deployed unit (rental and sold) with a Done / Not
 * done chip for the current cycle and a link to its last service report.
 * Read path: GET /maintenance-schedules/assets/:assetId.
 */

interface ScheduleDto {
  id: string;
  dueDate: string;
  notes: string | null;
  createdAt: string;
  remindedAt: string | null;
  cancelledAt: string | null;
  repeatEvery: number | null;
  repeatUnit: "WEEK" | "MONTH" | null;
  repeatLabel: string | null;
}

interface UnitRow {
  inventoryId: string;
  sku: string;
  serialNumber: string | null;
  type: "RENTAL" | "SALE";
  customerName: string | null;
  projectId: string;
  projectName: string;
  projectNumber: string | null;
  site: string | null;
  deployedDate: string | null;
  lastReport: { id: string; reportNumber: number | null; signedAt: string } | null;
  done: boolean | null;
}

interface Detail {
  today: string;
  asset: { id: string; name: string; skuKey: string | null };
  schedule: ScheduleDto | null;
  cycleStart: string | null;
  history: ScheduleDto[];
  rentalCount: number;
  soldCount: number;
  doneCount: number | null;
  notDoneCount: number | null;
  units: UnitRow[];
}

const fmtStamp = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";

export default function MaintenanceAssetPage() {
  const params = useParams<{ assetId: string }>();
  const assetId = params?.assetId as string;
  const router = useRouter();
  const { getToken } = useAuth();
  const { isMaintenanceDatesEnabled, isLoading: featuresLoading } = useOrganizationFeatures();
  const [data, setData] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ editing?: MaintenanceScheduleEdit } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const res = await request({ path: `/maintenance-schedules/assets/${assetId}`, method: "GET" }, {}, token);
      if (res?.success === false) throw new Error(res.message ?? "Failed to load the asset");
      setData((res?.data ?? res) as Detail);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load the asset");
    } finally {
      setLoading(false);
    }
  }, [assetId, getToken]);

  useEffect(() => {
    if (isMaintenanceDatesEnabled && assetId) void load();
  }, [load, isMaintenanceDatesEnabled, assetId]);

  if (!featuresLoading && !isMaintenanceDatesEnabled) {
    return (
      <Box sx={{ px: { xs: 1.5, md: 3 }, py: 3 }}>
        <Alert severity="info">Maintenance Dates is not enabled for this organization.</Alert>
      </Box>
    );
  }

  const s = data?.schedule ?? null;
  const days = s && data ? daysUntil(s.dueDate, data.today) : null;

  return (
    <Box sx={{ px: { xs: 1.5, md: 3 }, py: 3, display: "flex", flexDirection: "column", gap: 2 }}>
      <Breadcrumbs>
        <MuiLink component={NextLink} href="/portal/maintenance-reports/dates" underline="hover" color="inherit">
          Maintenance Dates
        </MuiLink>
        <Typography color="text.primary">{data?.asset.name ?? "Asset"}</Typography>
      </Breadcrumbs>

      {error && <Alert severity="error">{error}</Alert>}
      {loading && !data ? (
        <Box sx={{ py: 6, textAlign: "center" }}>
          <CircularProgress size={28} />
        </Box>
      ) : data ? (
        <>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Stack direction="row" alignItems="flex-start" spacing={2} sx={{ flexWrap: { xs: "wrap", md: "nowrap" }, rowGap: 1.5 }}>
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="h5" fontWeight={700}>
                  {data.asset.name}
                </Typography>
                {data.asset.skuKey && (
                  <Typography variant="body2" color="text.secondary">
                    {data.asset.skuKey}
                  </Typography>
                )}
                <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1.5, flexWrap: "wrap", rowGap: 1 }}>
                  <Typography variant="subtitle2">Next maintenance:</Typography>
                  {s ? (
                    <>
                      <Typography variant="subtitle2" fontWeight={700}>
                        {fmtDay(s.dueDate)}
                      </Typography>
                      {s.repeatLabel && <Chip size="small" variant="outlined" color="info" label={s.repeatLabel} />}
                      {days !== null && (
                        <Chip
                          size="small"
                          variant="outlined"
                          color={days <= 7 ? "warning" : "default"}
                          label={days === 0 ? "Today" : `in ${days} day${days === 1 ? "" : "s"}`}
                        />
                      )}
                      {s.remindedAt && <Chip size="small" variant="outlined" label={`Reminder sent ${fmtStamp(s.remindedAt)}`} />}
                    </>
                  ) : (
                    <Typography variant="subtitle2" color="text.secondary">
                      Not scheduled
                    </Typography>
                  )}
                </Stack>
                {s?.notes && (
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, whiteSpace: "pre-wrap" }}>
                    {s.notes}
                  </Typography>
                )}
                <Typography variant="body2" sx={{ mt: 1 }}>
                  {data.rentalCount} on rental, {data.soldCount} sold
                  {data.doneCount !== null && `. This cycle: ${data.doneCount} done, ${data.notDoneCount} not done`}
                  {data.cycleStart && ` (reports signed since ${fmtStamp(data.cycleStart)})`}
                </Typography>
              </Box>
              <Box sx={{ flex: 1 }} />
              <Button
                variant="contained"
                startIcon={<EventIcon />}
                onClick={() =>
                  setDialog(
                    s
                      ? {
                          editing: {
                            id: s.id,
                            asset: { id: data.asset.id, name: data.asset.name, skuKey: data.asset.skuKey },
                            dueDate: s.dueDate,
                            notes: s.notes,
                            repeatEvery: s.repeatEvery,
                            repeatUnit: s.repeatUnit,
                          },
                        }
                      : {},
                  )
                }
              >
                {s ? "Edit date" : "Schedule maintenance"}
              </Button>
            </Stack>

            {data.history.length > 0 && (
              <Box sx={{ mt: 2 }}>
                <Typography variant="subtitle2" sx={{ mb: 0.75 }}>
                  History
                </Typography>
                <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", rowGap: 1 }}>
                  {data.history.map((h) => (
                    <Chip
                      key={h.id}
                      size="small"
                      variant="outlined"
                      label={h.cancelledAt ? `${fmtDay(h.dueDate)} (cancelled)` : fmtDay(h.dueDate)}
                      sx={h.cancelledAt ? { textDecoration: "line-through", color: "text.secondary" } : undefined}
                    />
                  ))}
                </Stack>
              </Box>
            )}
          </Paper>

          <TableContainer component={Paper} variant="outlined">
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>Serial</TableCell>
                  <TableCell sx={{ fontWeight: 600, width: 90 }}>Type</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Customer</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Project</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Site</TableCell>
                  <TableCell sx={{ fontWeight: 600, width: 120 }}>Deployed</TableCell>
                  <TableCell sx={{ fontWeight: 600, width: 170 }}>Last service report</TableCell>
                  <TableCell sx={{ fontWeight: 600, width: 110 }}>This cycle</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.units.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} align="center" sx={{ py: 6, color: "text.secondary" }}>
                      No units of this asset are deployed right now.
                    </TableCell>
                  </TableRow>
                ) : (
                  data.units.map((u) => (
                    <TableRow
                      key={u.inventoryId}
                      hover
                      sx={{ cursor: u.lastReport ? "pointer" : "default" }}
                      onClick={() => u.lastReport && router.push(`/portal/maintenance-reports/${u.lastReport.id}`)}
                    >
                      <TableCell>
                        <Typography variant="body2" fontWeight={600}>
                          {u.sku}
                        </Typography>
                        {u.serialNumber && u.serialNumber !== u.sku && (
                          <Typography variant="caption" color="text.secondary">
                            {u.serialNumber}
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        <Chip size="small" variant="outlined" color={u.type === "RENTAL" ? "info" : "default"} label={u.type === "RENTAL" ? "Rental" : "Sold"} />
                      </TableCell>
                      <TableCell>{u.customerName ?? ""}</TableCell>
                      <TableCell>
                        <MuiLink
                          component={NextLink}
                          href={`/portal/projects/${u.projectId}`}
                          underline="hover"
                          onClick={(e: React.MouseEvent) => e.stopPropagation()}
                        >
                          {u.projectNumber ? `${u.projectNumber} ${u.projectName}` : u.projectName}
                        </MuiLink>
                      </TableCell>
                      <TableCell>{u.site ?? ""}</TableCell>
                      <TableCell>{fmtStamp(u.deployedDate)}</TableCell>
                      <TableCell>
                        {u.lastReport ? (
                          <MuiLink
                            component={NextLink}
                            href={`/portal/maintenance-reports/${u.lastReport.id}`}
                            underline="hover"
                            onClick={(e: React.MouseEvent) => e.stopPropagation()}
                          >
                            #{u.lastReport.reportNumber ?? "?"}, {fmtStamp(u.lastReport.signedAt)}
                          </MuiLink>
                        ) : (
                          <Typography variant="body2" color="text.secondary">
                            None yet
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        {u.done === null ? (
                          <Typography variant="body2" color="text.secondary">
                            No date
                          </Typography>
                        ) : u.done ? (
                          <Chip size="small" color="success" label="Done" />
                        ) : (
                          <Chip size="small" color="warning" variant="outlined" label="Not done" />
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      ) : null}

      <MaintenanceScheduleDialog
        open={!!dialog}
        onClose={() => setDialog(null)}
        onSaved={() => void load()}
        editing={dialog?.editing ?? null}
        presetAsset={data ? { id: data.asset.id, name: data.asset.name, skuKey: data.asset.skuKey } : null}
      />
    </Box>
  );
}
