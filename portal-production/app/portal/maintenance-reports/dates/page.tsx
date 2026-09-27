"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
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
  TextField,
  Typography,
} from "@mui/material";
import EventIcon from "@mui/icons-material/Event";
import SearchIcon from "@mui/icons-material/Search";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import { request } from "@/helpers/request";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";
import MaintenanceScheduleDialog, {
  MaintenanceAssetOption,
  MaintenanceScheduleEdit,
} from "@/components/maintenance/MaintenanceScheduleDialog";
import { daysUntil, fmtDay } from "@/components/maintenance/maintenanceDates";

/**
 * Service Reports -> Maintenance Dates (Biofuel, 2026-09). One row per asset
 * with deployed units or a planned date: the next maintenance date, how many
 * units are out on rental and sold, and how many are done this cycle.
 * Read path: GET /maintenance-schedules?search=. Row click opens the asset.
 */

interface ScheduleDto {
  id: string;
  dueDate: string;
  notes: string | null;
  remindedAt: string | null;
}

interface AssetRow {
  assetId: string;
  assetName: string;
  skuKey: string | null;
  schedule: ScheduleDto | null;
  lastDueDate: string | null;
  rentalCount: number;
  soldCount: number;
  doneCount: number | null;
  notDoneCount: number | null;
}

export default function MaintenanceDatesPage() {
  const router = useRouter();
  const { getToken } = useAuth();
  const { isMaintenanceDatesEnabled, isLoading: featuresLoading } = useOrganizationFeatures();
  const [rows, setRows] = useState<AssetRow[]>([]);
  const [today, setToday] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [dialog, setDialog] = useState<{ editing?: MaintenanceScheduleEdit; preset?: MaintenanceAssetOption } | null>(null);
  const [menu, setMenu] = useState<{ pos: { left: number; top: number }; row: AssetRow } | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<AssetRow | null>(null);
  const [acting, setActing] = useState(false);
  const [actionMsg, setActionMsg] = useState<{ text: string; severity: "success" | "error" } | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const qs = search ? `?search=${encodeURIComponent(search)}` : "";
      const res = await request({ path: `/maintenance-schedules${qs}`, method: "GET" }, {}, token);
      if (res?.success === false) throw new Error(res.message ?? "Failed to load maintenance dates");
      const data = res?.data ?? res;
      setRows(data?.docs ?? []);
      setToday(data?.today ?? "");
    } catch (e: any) {
      setError(e?.message ?? "Failed to load maintenance dates");
    } finally {
      setLoading(false);
    }
  }, [getToken, search]);

  useEffect(() => {
    if (isMaintenanceDatesEnabled) void load();
  }, [load, isMaintenanceDatesEnabled]);

  const cancelDate = async () => {
    const row = confirmCancel;
    if (!row?.schedule) return;
    setActing(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const res = await request({ path: `/maintenance-schedules/${row.schedule.id}/cancel`, method: "POST" }, {}, token);
      if (res?.success === false) throw new Error(res.message ?? "Could not cancel the date");
      setActionMsg({ text: `Maintenance date for ${row.assetName} cancelled.`, severity: "success" });
      setConfirmCancel(null);
      void load();
    } catch (e: any) {
      setActionMsg({ text: e?.message ?? "Could not cancel the date", severity: "error" });
    } finally {
      setActing(false);
    }
  };

  const assetOf = (r: AssetRow): MaintenanceAssetOption => ({ id: r.assetId, name: r.assetName, skuKey: r.skuKey });

  if (!featuresLoading && !isMaintenanceDatesEnabled) {
    return (
      <Box sx={{ px: { xs: 1.5, md: 3 }, py: 3 }}>
        <Alert severity="info">Maintenance Dates is not enabled for this organization.</Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ px: { xs: 1.5, md: 3 }, py: 3, display: "flex", flexDirection: "column", gap: 2 }}>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ flexWrap: { xs: "wrap", md: "nowrap" }, rowGap: 1 }}>
        <Box>
          <Typography variant="h5" fontWeight={700}>
            Maintenance Dates
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Plan maintenance per asset. Every deployed unit (rental and sold) is due; a unit is done once it has a
            signed service report since the previous date.
          </Typography>
        </Box>
        <Box sx={{ flex: 1 }} />
        <Button variant="contained" startIcon={<EventIcon />} onClick={() => setDialog({})} data-tour="maintenance-schedule-button">
          Schedule maintenance
        </Button>
      </Stack>

      <TextField
        placeholder="Search by asset name or SKU"
        size="small"
        value={searchInput}
        onChange={(e) => setSearchInput(e.target.value)}
        InputProps={{ startAdornment: <SearchIcon fontSize="small" sx={{ mr: 1, color: "text.secondary" }} /> }}
        fullWidth
      />

      {error && <Alert severity="error">{error}</Alert>}
      {actionMsg && (
        <Alert severity={actionMsg.severity} onClose={() => setActionMsg(null)}>
          {actionMsg.text}
        </Alert>
      )}

      <TableContainer component={Paper} variant="outlined">
        <Table>
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 600 }}>Asset</TableCell>
              <TableCell sx={{ fontWeight: 600, width: 200 }}>Next date</TableCell>
              <TableCell sx={{ fontWeight: 600, width: 100 }} align="right">
                Rental
              </TableCell>
              <TableCell sx={{ fontWeight: 600, width: 100 }} align="right">
                Sold
              </TableCell>
              <TableCell sx={{ fontWeight: 600, width: 200 }}>This cycle</TableCell>
              <TableCell sx={{ width: 56 }} />
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} align="center" sx={{ py: 6 }}>
                  <CircularProgress size={28} />
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} align="center" sx={{ py: 6, color: "text.secondary" }}>
                  {search ? "No assets match this search." : "No deployed assets or maintenance dates yet."}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => {
                const days = r.schedule && today ? daysUntil(r.schedule.dueDate, today) : null;
                return (
                  <TableRow
                    key={r.assetId}
                    hover
                    sx={{ cursor: "pointer" }}
                    onClick={() => router.push(`/portal/maintenance-reports/dates/${r.assetId}`)}
                  >
                    <TableCell>
                      <Typography variant="body2" fontWeight={600}>
                        {r.assetName}
                      </Typography>
                      {r.skuKey && (
                        <Typography variant="caption" color="text.secondary">
                          {r.skuKey}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      {r.schedule ? (
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Typography variant="body2">{fmtDay(r.schedule.dueDate)}</Typography>
                          {days !== null && (
                            <Chip
                              size="small"
                              variant="outlined"
                              color={days <= 7 ? "warning" : "default"}
                              label={days === 0 ? "Today" : `in ${days} day${days === 1 ? "" : "s"}`}
                            />
                          )}
                        </Stack>
                      ) : (
                        <Typography variant="body2" color="text.secondary">
                          Not scheduled
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell align="right">{r.rentalCount}</TableCell>
                    <TableCell align="right">{r.soldCount}</TableCell>
                    <TableCell>
                      {r.doneCount === null ? (
                        <Typography variant="body2" color="text.secondary">
                          No date
                        </Typography>
                      ) : (
                        <Stack direction="row" spacing={0.75}>
                          <Chip size="small" color="success" variant="outlined" label={`${r.doneCount} done`} />
                          <Chip
                            size="small"
                            color={r.notDoneCount ? "warning" : "default"}
                            variant="outlined"
                            label={`${r.notDoneCount} not done`}
                          />
                        </Stack>
                      )}
                    </TableCell>
                    <TableCell align="right">
                      <IconButton
                        size="small"
                        aria-label="Maintenance date actions"
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenu({ pos: { left: e.clientX, top: e.clientY }, row: r });
                        }}
                      >
                        <MoreVertIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Menu anchorReference="anchorPosition" anchorPosition={menu?.pos} open={!!menu} onClose={() => setMenu(null)}>
        {menu && !menu.row.schedule && (
          <MenuItem
            onClick={() => {
              const row = menu.row;
              setMenu(null);
              setDialog({ preset: assetOf(row) });
            }}
          >
            Schedule maintenance
          </MenuItem>
        )}
        {menu?.row.schedule && (
          <MenuItem
            onClick={() => {
              const row = menu.row;
              setMenu(null);
              setDialog({
                editing: { id: row.schedule!.id, asset: assetOf(row), dueDate: row.schedule!.dueDate, notes: row.schedule!.notes },
              });
            }}
          >
            Edit date
          </MenuItem>
        )}
        {menu?.row.schedule && (
          <MenuItem
            sx={{ color: "error.main" }}
            onClick={() => {
              const row = menu.row;
              setMenu(null);
              setConfirmCancel(row);
            }}
          >
            Cancel date
          </MenuItem>
        )}
      </Menu>

      <Dialog open={!!confirmCancel} onClose={() => !acting && setConfirmCancel(null)}>
        {confirmCancel?.schedule && (
          <>
            <DialogTitle>Cancel maintenance date?</DialogTitle>
            <DialogContent>
              <DialogContentText>
                The {fmtDay(confirmCancel.schedule.dueDate)} date for {confirmCancel.assetName} is cancelled and no
                reminder is sent. You can schedule a new date at any time.
              </DialogContentText>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setConfirmCancel(null)} disabled={acting}>
                Keep it
              </Button>
              <Button onClick={() => void cancelDate()} color="error" variant="contained" disabled={acting}>
                {acting ? "Working…" : "Cancel date"}
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>

      <MaintenanceScheduleDialog
        open={!!dialog}
        onClose={() => setDialog(null)}
        onSaved={() => void load()}
        editing={dialog?.editing ?? null}
        presetAsset={dialog?.preset ?? null}
      />
    </Box>
  );
}
