"use client";

// Project schedule: pick activities from the firm's standard sequence with a
// date range → they land on the weekly Mon–Sun calendar (their "Project
// Schedule" sheet). List view edits each activity's dates; Print renders the
// client-facing calendar from the server (same HTML as the PDF).

import React, { useCallback, useEffect, useMemo, useState } from "react";
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
  Divider,
  FormControlLabel,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/DeleteOutline";
import PrintIcon from "@mui/icons-material/PrintOutlined";
import CalendarMonthIcon from "@mui/icons-material/CalendarMonthOutlined";
import ListAltIcon from "@mui/icons-material/ListAltOutlined";
import UpdateIcon from "@mui/icons-material/Update";
import ShareIcon from "@mui/icons-material/IosShareOutlined";
import { toast } from "react-toastify";
import { useIdProjectApi, type Schedule, type ScheduleItem } from "./api";

const DAY = 86400000;
const isoToday = () => new Date().toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => new Date(new Date(iso).getTime() + n * DAY).toISOString().slice(0, 10);
const fmt = (iso: string) => new Date(iso).toLocaleDateString("en-SG", { day: "2-digit", month: "short" });
const fmtFull = (iso: string) => new Date(iso).toLocaleDateString("en-SG", { day: "2-digit", month: "short", year: "numeric" });

export default function ScheduleTab({ projectId }: { projectId: string }) {
  const api = useIdProjectApi();
  const [data, setData] = useState<Schedule | null>(null);
  const [view, setView] = useState<"calendar" | "list">("calendar");
  const [addOpen, setAddOpen] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const [printHtml, setPrintHtml] = useState<string | null>(null);
  const [shiftOpen, setShiftOpen] = useState(false);
  const [shiftDays, setShiftDays] = useState("7");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api.getSchedule(projectId));
    } catch (e: any) {
      toast.error(e.message || "Failed to load schedule");
    }
  }, [api, projectId]);
  useEffect(() => {
    load();
  }, [load]);

  const openPrint = async () => {
    setPrintOpen(true);
    setPrintHtml(null);
    try {
      const r = await api.getScheduleHtml(projectId);
      setPrintHtml(r.html);
    } catch (e: any) {
      toast.error(e.message || "Failed to render");
    }
  };

  if (!data)
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
        <CircularProgress />
      </Box>
    );

  return (
    <Box sx={{ width: "100%", minWidth: 0 }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5, flexWrap: "wrap", rowGap: 1 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          Project schedule
        </Typography>
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          {data.header.projectSite}
          {data.header.contractNo ? ` · ${data.header.contractNo}` : ""}
          {data.header.manager ? ` · PM ${data.header.manager}` : ""}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <ToggleButtonGroup size="small" exclusive value={view} onChange={(_, v) => v && setView(v)}>
          <ToggleButton value="calendar">
            <CalendarMonthIcon fontSize="small" sx={{ mr: 0.5 }} /> Calendar
          </ToggleButton>
          <ToggleButton value="list">
            <ListAltIcon fontSize="small" sx={{ mr: 0.5 }} /> List
          </ToggleButton>
        </ToggleButtonGroup>
        <Tooltip title="Push every activity later/earlier by N days (site delays)">
          <Button size="small" startIcon={<UpdateIcon />} onClick={() => setShiftOpen(true)} disabled={!data.items.length} sx={{ textTransform: "none" }}>
            Shift
          </Button>
        </Tooltip>
        <Tooltip title="A live link for the client — always shows the latest schedule, even after shifts">
          <Button
            size="small"
            variant="outlined"
            startIcon={<ShareIcon />}
            onClick={async () => {
              try {
                const r = await api.createScheduleLink(projectId);
                const url = /^https?:/i.test(r.url) ? r.url : `${window.location.origin}${r.url.startsWith("/") ? "" : "/"}${r.url}`;
                await navigator.clipboard.writeText(url).catch(() => {});
                toast.success("Client link copied — paste it into WhatsApp");
              } catch (e: any) {
                toast.error(e.message || "Could not create link");
              }
            }}
            sx={{ textTransform: "none" }}
          >
            Client link
          </Button>
        </Tooltip>
        <Button size="small" variant="outlined" startIcon={<PrintIcon />} onClick={openPrint} sx={{ textTransform: "none" }}>
          Print / PDF
        </Button>
        <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={() => setAddOpen(true)} sx={{ textTransform: "none" }}>
          Add activities
        </Button>
      </Stack>

      {data.items.length === 0 && (
        <Alert severity="info" sx={{ mb: 1.5 }}>
          No activities yet. "Add activities" lets you tick items from the standard sequence (3D discussion → shopping → site survey → hacking → … → furniture move-in) and give each a date range; they appear on the weekly calendar below.
        </Alert>
      )}

      {view === "calendar" ? <CalendarView data={data} /> : <ListView data={data} onChange={load} />}

      <AddActivitiesDialog open={addOpen} sequence={data.sequence} projectId={projectId} onClose={() => setAddOpen(false)} onAdded={load} />

      <Dialog open={printOpen} onClose={() => setPrintOpen(false)} fullWidth maxWidth="lg" PaperProps={{ sx: { borderRadius: 2, height: "90vh" } }}>
        <DialogTitle sx={{ py: 1.5 }}>Client schedule</DialogTitle>
        <DialogContent sx={{ p: 0, bgcolor: "#e9e9e9" }}>
          {printHtml ? <iframe id="idq-schedule-frame" title="Schedule" srcDoc={printHtml} sandbox="allow-same-origin allow-modals" style={{ width: "100%", height: "100%", border: 0, background: "#fff" }} /> : <Box sx={{ display: "flex", justifyContent: "center", pt: 8 }}><CircularProgress /></Box>}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPrintOpen(false)}>Close</Button>
          <Button variant="contained" startIcon={<PrintIcon />} disabled={!printHtml} onClick={() => (document.getElementById("idq-schedule-frame") as HTMLIFrameElement | null)?.contentWindow?.print()}>
            Print / Save PDF
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={shiftOpen} onClose={() => setShiftOpen(false)} PaperProps={{ sx: { borderRadius: 2 } }}>
        <DialogTitle>Shift the whole schedule</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ color: "text.secondary", mb: 1.5 }}>
            Moves every activity by the number of days (negative = earlier). Use it when the site is delayed and the whole sequence slides.
          </Typography>
          <TextField label="Days" size="small" value={shiftDays} onChange={(e) => setShiftDays(e.target.value)} inputProps={{ inputMode: "numeric" }} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShiftOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={busy || !Number(shiftDays)}
            onClick={async () => {
              setBusy(true);
              try {
                await api.shiftSchedule(projectId, Number(shiftDays));
                setShiftOpen(false);
                load();
              } catch (e: any) {
                toast.error(e.message || "Shift failed");
              } finally {
                setBusy(false);
              }
            }}
          >
            Shift
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

// ── weekly calendar (their sheet on screen) ───────────────────────────────
function CalendarView({ data }: { data: Schedule }) {
  if (!data.weeks.length) return null;
  const todayIso = isoToday();
  return (
    <Box sx={{ overflowX: "auto", width: "100%" }}>
      <Box sx={{ minWidth: 980 }}>
        {data.weeks.map((w) => (
          <Box key={w.index} sx={{ display: "grid", gridTemplateColumns: "64px repeat(7, minmax(0, 1fr))", border: 1, borderColor: "divider", borderRadius: 1.5, overflow: "hidden", mb: 1.25 }}>
            <Box sx={{ bgcolor: "action.selected", p: 1, fontWeight: 800, fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center" }}>Wk {w.index}</Box>
            {w.days.map((d) => {
              const sun = d.dow === "Sun";
              const isToday = d.iso === todayIso;
              return (
                <Box key={d.iso} sx={{ borderLeft: 1, borderColor: "divider", minHeight: 96, bgcolor: sun ? "action.hover" : "transparent" }}>
                  <Box sx={{ px: 1, py: 0.5, borderBottom: 1, borderColor: "divider", display: "flex", justifyContent: "space-between", bgcolor: isToday ? "primary.main" : "action.hover", color: isToday ? "primary.contrastText" : "text.primary" }}>
                    <Typography variant="caption" sx={{ fontWeight: 700 }}>
                      {d.dow}
                    </Typography>
                    <Typography variant="caption">{fmt(d.iso)}</Typography>
                  </Box>
                  <Stack spacing={0.5} sx={{ p: 0.75 }}>
                    {d.holiday && <Chip size="small" color="error" label={`${d.holiday} · PH`} sx={{ height: 20, "& .MuiChip-label": { fontSize: 10.5, px: 0.75 } }} />}
                    {sun && (
                      <Typography variant="caption" sx={{ color: "text.disabled", fontWeight: 700, fontSize: 10 }}>
                        WORKERS OFF DAY
                      </Typography>
                    )}
                    {d.work.map((l, i) => (
                      <Chip key={`${l}-${i}`} size="small" color="warning" variant="filled" label={l} sx={{ height: "auto", "& .MuiChip-label": { fontSize: 11, whiteSpace: "normal", px: 0.75, py: 0.25, lineHeight: 1.25 } }} />
                    ))}
                    {d.notes.map((n, i) => (
                      <Chip key={`n-${i}`} size="small" color="success" variant="outlined" label={n} sx={{ height: "auto", "& .MuiChip-label": { fontSize: 10.5, whiteSpace: "normal", px: 0.75, py: 0.25, lineHeight: 1.25, fontStyle: "italic" } }} />
                    ))}
                  </Stack>
                </Box>
              );
            })}
          </Box>
        ))}
      </Box>
    </Box>
  );
}

// ── list editor ───────────────────────────────────────────────────────────
function ListView({ data, onChange }: { data: Schedule; onChange: () => void }) {
  const api = useIdProjectApi();
  const [drafts, setDrafts] = useState<Record<string, Partial<ScheduleItem>>>({});
  const save = async (it: ScheduleItem) => {
    const d = drafts[it.id];
    if (!d) return;
    try {
      await api.updateScheduleItem(it.id, d);
      setDrafts((s) => {
        const n = { ...s };
        delete n[it.id];
        return n;
      });
      onChange();
    } catch (e: any) {
      toast.error(e.message || "Update failed");
    }
  };
  return (
    <Box sx={{ overflowX: "auto", width: "100%" }}>
      <Table size="small" sx={{ minWidth: 820 }}>
        <TableHead>
          <TableRow>
            <TableCell>Activity</TableCell>
            <TableCell>Type</TableCell>
            <TableCell>Start</TableCell>
            <TableCell>End</TableCell>
            <TableCell>Days</TableCell>
            <TableCell />
          </TableRow>
        </TableHead>
        <TableBody>
          {data.items.map((it) => {
            const d = drafts[it.id] || {};
            const start = (d.startDate ?? it.startDate).slice(0, 10);
            const end = (d.endDate ?? it.endDate).slice(0, 10);
            const days = Math.round((new Date(end).getTime() - new Date(start).getTime()) / DAY) + 1;
            return (
              <TableRow key={it.id} hover>
                <TableCell sx={{ minWidth: 280 }}>
                  <TextField size="small" variant="standard" fullWidth value={d.label ?? it.label} onChange={(e) => setDrafts((s) => ({ ...s, [it.id]: { ...d, label: e.target.value } }))} InputProps={{ disableUnderline: true, sx: { fontSize: 13.5 } }} />
                </TableCell>
                <TableCell>
                  <TextField select size="small" value={d.kind ?? it.kind} onChange={(e) => setDrafts((s) => ({ ...s, [it.id]: { ...d, kind: e.target.value as any } }))} inputProps={{ style: { padding: "4px 8px" } }}>
                    <MenuItem value="work">Work</MenuItem>
                    <MenuItem value="note">Note / reminder</MenuItem>
                    <MenuItem value="holiday">Holiday / no entry</MenuItem>
                  </TextField>
                </TableCell>
                <TableCell>
                  <TextField size="small" type="date" value={start} onChange={(e) => setDrafts((s) => ({ ...s, [it.id]: { ...d, startDate: e.target.value } }))} inputProps={{ style: { padding: "4px 8px" } }} />
                </TableCell>
                <TableCell>
                  <TextField size="small" type="date" value={end} onChange={(e) => setDrafts((s) => ({ ...s, [it.id]: { ...d, endDate: e.target.value } }))} inputProps={{ style: { padding: "4px 8px" } }} />
                </TableCell>
                <TableCell sx={{ color: "text.secondary" }}>{days}</TableCell>
                <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
                  {drafts[it.id] && (
                    <Button size="small" variant="contained" onClick={() => save(it)} sx={{ textTransform: "none", mr: 0.5 }}>
                      Save
                    </Button>
                  )}
                  <IconButton size="small" onClick={() => api.removeScheduleItem(it.id).then(onChange)} sx={{ "&:hover": { color: "error.main" } }}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </TableCell>
              </TableRow>
            );
          })}
          {data.items.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} sx={{ textAlign: "center", color: "text.secondary", py: 4 }}>
                No activities yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </Box>
  );
}

// ── add dialog: tick activities, set each one's dates ─────────────────────
function AddActivitiesDialog({ open, sequence, projectId, onClose, onAdded }: { open: boolean; sequence: string[]; projectId: string; onClose: () => void; onAdded: () => void }) {
  const api = useIdProjectApi();
  const [picked, setPicked] = useState<Record<string, { start: string; end: string }>>({});
  const [custom, setCustom] = useState("");
  const [rangeStart, setRangeStart] = useState(isoToday());
  const [rangeEnd, setRangeEnd] = useState(isoToday());
  const [sequential, setSequential] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setPicked({});
      setCustom("");
      setRangeStart(isoToday());
      setRangeEnd(addDays(isoToday(), 13)); // default: a two-week window
    }
  }, [open]);

  const labels = useMemo(() => Object.keys(picked), [picked]);

  // Spread a set of labels across the range: back-to-back in sequence order,
  // every activity gets at least ONE day, and if the range is shorter than the
  // activity count the schedule simply extends past the To date — never piles
  // everything onto one day.
  const spread = (keys: string[], from: string, to: string, seq: boolean): Record<string, { start: string; end: string }> => {
    const order = [...sequence, ...keys.filter((l) => !sequence.includes(l))].filter((l) => keys.includes(l));
    const next: Record<string, { start: string; end: string }> = {};
    if (!seq) {
      for (const l of order) next[l] = { start: from, end: to };
      return next;
    }
    const total = Math.max(1, Math.round((new Date(to).getTime() - new Date(from).getTime()) / DAY) + 1);
    const per = Math.max(1, Math.floor(total / Math.max(1, order.length)));
    let cursor = from;
    for (const l of order) {
      const end = addDays(cursor, per - 1);
      next[l] = { start: cursor, end };
      cursor = addDays(end, 1);
    }
    return next;
  };

  // Ticking recalculates the whole spread live (fine-tuned dates are re-derived
  // when the ticked set changes — fine-tune AFTER picking everything).
  const toggle = (label: string) =>
    setPicked((p) => {
      const keys = p[label] ? Object.keys(p).filter((k) => k !== label) : [...Object.keys(p), label];
      return spread(keys, rangeStart, rangeEnd, sequential);
    });

  const applyRange = () => setPicked((p) => spread(Object.keys(p), rangeStart, rangeEnd, sequential));

  const submit = async () => {
    const items = labels.map((l) => ({ label: l, kind: "work", startDate: picked[l].start, endDate: picked[l].end }));
    if (!items.length) return;
    setBusy(true);
    try {
      await api.addScheduleItems(projectId, items);
      toast.success(`${items.length} activit${items.length === 1 ? "y" : "ies"} added`);
      onAdded();
      onClose();
    } catch (e: any) {
      toast.error(e.message || "Add failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md" PaperProps={{ sx: { borderRadius: 2, height: "86vh" } }}>
      <DialogTitle>Add activities to the schedule</DialogTitle>
      <DialogContent dividers sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 2, p: 2 }}>
        <Box sx={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
            Standard sequence (top → bottom)
          </Typography>
          <List dense sx={{ flex: 1, overflowY: "auto", border: 1, borderColor: "divider", borderRadius: 1.5 }}>
            {sequence.map((l, i) => (
              <ListItemButton key={l} dense onClick={() => toggle(l)} selected={!!picked[l]}>
                <Checkbox size="small" edge="start" checked={!!picked[l]} tabIndex={-1} disableRipple />
                <ListItemText primary={`${i + 1}. ${l}`} primaryTypographyProps={{ variant: "body2" }} />
              </ListItemButton>
            ))}
          </List>
          <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
            <TextField size="small" fullWidth placeholder="Custom activity…" value={custom} onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => e.key === "Enter" && custom.trim() && (toggle(custom.trim()), setCustom(""))} />
            <Button size="small" variant="outlined" disabled={!custom.trim()} onClick={() => { toggle(custom.trim()); setCustom(""); }} sx={{ textTransform: "none", whiteSpace: "nowrap" }}>
              Add custom
            </Button>
          </Stack>
        </Box>
        <Box sx={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
            Dates
          </Typography>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
            <TextField label="From" type="date" size="small" InputLabelProps={{ shrink: true }} value={rangeStart} onChange={(e) => setRangeStart(e.target.value)} />
            <TextField label="To" type="date" size="small" InputLabelProps={{ shrink: true }} value={rangeEnd} onChange={(e) => setRangeEnd(e.target.value)} />
            <Button size="small" variant="outlined" onClick={applyRange} disabled={!labels.length} sx={{ textTransform: "none", whiteSpace: "nowrap" }}>
              Apply to ticked
            </Button>
          </Stack>
          <FormControlLabel control={<Checkbox size="small" checked={sequential} onChange={(e) => setSequential(e.target.checked)} />} label={<Typography variant="caption">Spread the ticked activities one after another across the range (untick = every activity gets the whole range). If the range is shorter than the list, the schedule extends past the To date.</Typography>} sx={{ mb: 1, alignItems: "flex-start", "& .MuiCheckbox-root": { pt: 0 } }} />
          <Divider sx={{ mb: 1 }} />
          <Typography variant="caption" sx={{ color: "text.secondary", mb: 0.5 }}>
            {labels.length} selected — fine-tune each start/end here
          </Typography>
          <Box sx={{ flex: 1, overflowY: "auto" }}>
            {labels.length === 0 && (
              <Typography variant="body2" sx={{ color: "text.disabled", p: 2, textAlign: "center" }}>
                Tick activities on the left — they spread across the date range automatically, in sequence order.
              </Typography>
            )}
            {[...sequence, ...labels.filter((l) => !sequence.includes(l))]
              .filter((l) => picked[l])
              .map((l) => (
                <Stack key={l} direction="row" spacing={1} alignItems="center" sx={{ py: 0.5 }}>
                  <Typography variant="body2" sx={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {l}
                  </Typography>
                  <TextField type="date" size="small" value={picked[l].start} onChange={(e) => setPicked((p) => ({ ...p, [l]: { ...p[l], start: e.target.value } }))} inputProps={{ style: { padding: "4px 6px", fontSize: 12 } }} />
                  <TextField type="date" size="small" value={picked[l].end} onChange={(e) => setPicked((p) => ({ ...p, [l]: { ...p[l], end: e.target.value } }))} inputProps={{ style: { padding: "4px 6px", fontSize: 12 } }} />
                  <Typography variant="caption" sx={{ color: "text.disabled", width: 36, textAlign: "right" }}>
                    {Math.max(1, Math.round((new Date(picked[l].end).getTime() - new Date(picked[l].start).getTime()) / DAY) + 1)}d
                  </Typography>
                </Stack>
              ))}
          </Box>
        </Box>
      </DialogContent>
      <DialogActions>
        <Typography variant="caption" sx={{ color: "text.secondary", mr: "auto", pl: 1 }}>
          Sundays are workers' off days and never receive work; public holidays are flagged automatically.
        </Typography>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={busy || !labels.length} onClick={submit}>
          {busy ? "Adding…" : `Add ${labels.length || ""}`}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// keep the helper referenced for future range presets
void fmtFull;
