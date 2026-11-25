"use client";

// Field > Clock-ins (FIELD_PLAN.md phase 3; ported from SiteClock web Flagged.tsx / LiveSite.tsx @62b7d9d).
// Flagged clock-ins to approve (with a corrected time, or the start time of a missed clock-in) or reject,
// the off-site ones that were only marked, who is on site now, the face check log, and every clock-in.
import * as React from "react";
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Link, Stack, Tab, Tabs, TextField, Typography,
} from "@mui/material";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import PageTable from "@/components/PageTable";
import { fieldAtLeast } from "@/helpers/fieldModule";
import { FLAG_LABEL, approveBody, toLocalInput } from "@/helpers/fieldJobs";
import FieldGate from "../_components/FieldGate";
import { useFieldApi, type FieldMe } from "../_lib/useField";

const time = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
const mapLink = (lat: number, lng: number) => `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}`;

export default function FieldClockInsPage() {
  return <FieldGate area="punches" title="Clock-ins">{(me) => <ClockIns me={me} />}</FieldGate>;
}

/** The selfie taken with a flagged clock-in (AIMS phone app): the reviewer checks it is the worker. */
function Selfie({ id, get }: { id: string; get: <T>(path: string) => Promise<T> }) {
  const q = useQuery({ queryKey: ["field-punch-photo", id], queryFn: () => get<{ url: string }>(`/field/punches/${id}/photo`), staleTime: 4 * 60_000, retry: false });
  if (q.isLoading) return <Typography color="text.secondary">Loading the selfie…</Typography>;
  if (!q.data?.url) return <Typography color="text.secondary">The selfie could not be loaded.</Typography>;
  // eslint-disable-next-line @next/next/no-img-element
  return <Box component="img" src={q.data.url} alt="Selfie taken with this clock-in" sx={{ width: "100%", maxWidth: 280, borderRadius: 2, alignSelf: "center" }} />;
}

function ClockIns({ me }: { me: FieldMe }) {
  const { get, send } = useFieldApi();
  const qc = useQueryClient();
  const canReview = fieldAtLeast(me.access.levels.punches, "approve");
  const [tab, setTab] = React.useState(0);
  const flagged = useQuery({ queryKey: ["field-flagged"], queryFn: () => get<{ punches: any[] }>(`/field/punches/flagged`), refetchInterval: 30_000 });
  const marked = useQuery({ queryKey: ["field-marked"], queryFn: () => get<{ punches: any[] }>(`/field/punches/marked`), enabled: tab === 1 });
  const live = useQuery({ queryKey: ["field-live"], queryFn: () => get<{ sites: any[] }>(`/field/punches/live`), enabled: tab === 2, refetchInterval: 30_000 });
  const face = useQuery({ queryKey: ["field-face"], queryFn: () => get<{ punches: any[] }>(`/field/punches/face-log`), enabled: tab === 3 });
  const all = useQuery({ queryKey: ["field-punches"], queryFn: () => get<{ punches: any[] }>(`/field/punches`), enabled: tab === 4 });
  const [review, setReview] = React.useState<{ p: any; clockInAt: string; punchAt: string; note: string } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const run = async (fn: () => Promise<any>, done?: () => void) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      done?.();
      await Promise.all(["field-flagged", "field-marked", "field-live", "field-punches"].map((k) => qc.invalidateQueries({ queryKey: [k] })));
    } catch (e: any) {
      setError(e?.message || "Could not save");
    } finally {
      setBusy(false);
    }
  };

  const base = [
    { id: "when", header: "When", cell: ({ row }: any) => time(row.original.serverTime) },
    { id: "who", header: "Worker", cell: ({ row }: any) => row.original.worker.name },
    { id: "type", header: "", cell: ({ row }: any) => (row.original.type === "IN" ? "In" : "Out") },
    { id: "site", header: "Site", cell: ({ row }: any) => row.original.site?.name ?? "" },
    { id: "job", header: "Job", cell: ({ row }: any) => row.original.job?.title ?? "" },
    { id: "reason", header: "Why", cell: ({ row }: any) => (row.original.flagReason ? <Chip size="small" label={FLAG_LABEL[row.original.flagReason] ?? row.original.flagReason} /> : null) },
    {
      id: "where",
      header: "Where",
      cell: ({ row }: any) => (
        <Stack direction="row" gap={1} alignItems="center" onClick={(e) => e.stopPropagation()}>
          <span>{Math.round(row.original.distanceM)} m</span>
          <Link href={mapLink(row.original.lat, row.original.lng)} target="_blank" rel="noreferrer">Map</Link>
        </Stack>
      ),
    },
  ];
  const flaggedCols = [...base, { id: "note", header: "Worker note", cell: ({ row }: any) => row.original.workerNote ?? "" }];
  const allCols = [...base, { id: "status", header: "State", cell: ({ row }: any) => ({ OK: "OK", FLAGGED: "To review", APPROVED: "Approved", REJECTED: "Rejected" } as any)[row.original.status] }];
  const faceCols = [...base.slice(0, 4), { id: "face", header: "Face check", cell: ({ row }: any) => `${row.original.faceResult}${row.original.faceScore != null ? ` (${row.original.faceScore.toFixed(2)})` : ""}` }];

  return (
    <>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }} variant="scrollable">
        <Tab label={`To review (${flagged.data?.punches.length ?? 0})`} />
        <Tab label="Marked" />
        <Tab label="On site now" />
        <Tab label="Face check" />
        <Tab label="All clock-ins" />
      </Tabs>
      {tab === 0 && (
        <PageTable columns={flaggedCols as any} data={flagged.data?.punches ?? []} tableName="To review" loading={flagged.isLoading} clientPaging noSelectionColumn
          onRowClick={(p: any) => canReview && setReview({ p, clockInAt: p.needsClockIn && p.suggestedClockInAt ? toLocalInput(p.suggestedClockInAt) : "", punchAt: toLocalInput(p.serverTime), note: "" })} />
      )}
      {tab === 1 && <PageTable columns={base as any} data={marked.data?.punches ?? []} tableName="Marked off-site" loading={marked.isLoading} clientPaging noSelectionColumn />}
      {tab === 2 && (
        <Stack gap={2}>
          {(live.data?.sites ?? []).length === 0 && <Typography color="text.secondary">No one is clocked in.</Typography>}
          {(live.data?.sites ?? []).map((s) => (
            <Box key={s.id} sx={{ border: 1, borderColor: "divider", borderRadius: 2, p: 2 }}>
              <Stack direction="row" gap={1} alignItems="center" sx={{ mb: 1 }}>
                <Typography variant="h6">{s.name}</Typography>
                <Chip size="small" label={`${s.people.length} on site`} />
                <Link href={mapLink(s.lat, s.lng)} target="_blank" rel="noreferrer">Map</Link>
              </Stack>
              <Stack direction="row" gap={1} flexWrap="wrap">
                {s.people.map((p: any) => (
                  <Chip key={p.entryId} variant="outlined" color={p.insideFence === false ? "warning" : "default"} label={`${p.name} since ${new Date(p.clockInAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}${p.insideFence === false ? ", clocked in outside" : ""}`} />
                ))}
              </Stack>
            </Box>
          ))}
        </Stack>
      )}
      {tab === 3 && <PageTable columns={faceCols as any} data={face.data?.punches ?? []} tableName="Face check, last 7 days" loading={face.isLoading} clientPaging noSelectionColumn />}
      {tab === 4 && <PageTable columns={allCols as any} data={all.data?.punches ?? []} tableName="Clock-ins, last 7 days" loading={all.isLoading} clientPaging noSelectionColumn />}

      <Dialog open={!!review} onClose={() => !busy && setReview(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{review ? `${review.p.worker.name}, clock-${review.p.type === "IN" ? "in" : "out"} at ${review.p.site?.name ?? ""}` : ""}</DialogTitle>
        <DialogContent dividers>
          {review && (
            <Stack gap={2}>
              <Typography>
                {FLAG_LABEL[review.p.flagReason] ?? review.p.flagReason}, {Math.round(review.p.distanceM)} m from the site, GPS within {Math.round(review.p.accuracyM)} m.
                {review.p.address ? ` ${review.p.address}` : ""}
              </Typography>
              {review.p.workerNote && <Alert severity="info">{review.p.workerNote}</Alert>}
              {review.p.hasPhoto && !review.p.photoCopied && <Typography color="text.secondary">The selfie is still in SiteClock.</Typography>}
              {review.p.hasPhoto && review.p.photoCopied && <Selfie id={review.p.id} get={get} />}
              <TextField type="datetime-local" label="Time of this clock-in or out" InputLabelProps={{ shrink: true }} value={review.punchAt} onChange={(e) => setReview({ ...review, punchAt: e.target.value })} />
              {review.p.needsClockIn && (
                <TextField type="datetime-local" label="They started at" InputLabelProps={{ shrink: true }} value={review.clockInAt} onChange={(e) => setReview({ ...review, clockInAt: e.target.value })} />
              )}
              <TextField label="Note" value={review.note} onChange={(e) => setReview({ ...review, note: e.target.value })} inputProps={{ maxLength: 300 }} />
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button color="error" sx={{ mr: "auto" }} disabled={busy} onClick={() => review && void run(() => send(`/field/punches/${review.p.id}/reject`, "POST", { note: review.note }), () => setReview(null))}>
            Reject
          </Button>
          <Button onClick={() => setReview(null)} disabled={busy}>Cancel</Button>
          <Button variant="contained" disableElevation disabled={busy || (review?.p.needsClockIn && !review.clockInAt)}
            onClick={() => review && void run(() => send(`/field/punches/${review.p.id}/approve`, "POST", approveBody(review, review.p.serverTime)), () => setReview(null))}>
            Approve
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
