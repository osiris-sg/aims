"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth, useUser } from "@clerk/nextjs";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Divider,
  FormControlLabel,
  LinearProgress,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import PrintIcon from "@mui/icons-material/Print";
import DownloadIcon from "@mui/icons-material/Download";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import DoneAllIcon from "@mui/icons-material/DoneAll";
import { request } from "@/helpers/request";
import { uploadImage } from "@/helpers/imageUploader";
import { useFieldAppBar } from "@/app/(field)/components/FieldAppBar";
import { FIELD_BUTTON_SX } from "@/app/(field)/components/fieldUi";
import { useMsrPrint } from "@/app/(field)/components/MsrPrintSurface";
import PhotoCaptureField, { CapturedPhoto } from "@/components/delivery/PhotoCaptureField";
import {
  TEMPLATE_VERSIONS,
  WCT_JOB_TYPE_GROUPS,
  WCT_MAX_PHOTOS_PER_GRID,
  wctSectionsFor,
  type WctSectionResult,
  type WctServiceData,
} from "@/lib/msr-templates";

/**
 * WCT service job — the SERVICE itself, walked step by step (guru 2026-10-27:
 * "once he starts delivery the next step is to start the service as well and
 * then the flow starts"). Reached straight from Start delivery on the run; the
 * customer's sign-off comes AFTER this walk.
 *
 *   JOB      — company / location / date (from the run), tick the job types,
 *              "Start service"
 *   per section the ticks call for:
 *     BEFORE — the Before photos, "Work done → After photos"
 *     AFTER  — the After photos + the ✓ work lines, "Next"
 *     (a single-grid section — Unit Location, Area Cleaning — is one step)
 *   FINISH   — remarks, customer email, "Finish service"
 *   then     — the service lines are ended and the run goes to the customer
 *              signature; the report has its number and is emailed.
 *
 * Every step is SAVED on the scheduled report (PATCH /maintenance-reports/:id/
 * draft) as it happens, so leaving the page, a reload or a phone that sleeps
 * between the Before and the After photos loses nothing: reopening the run
 * resumes exactly where the technician was.
 *
 * The run's DO_START condition photo of the service line seeds the "Unit
 * Location" grid so the first page needs nothing re-shot.
 */

interface RunItem {
  id: string;
  description: string | null;
  assetId: string | null;
  inventoryId: string | null;
  assetClass?: string | null;
  deliveryStatus: string;
}
interface RunReport {
  id: string;
  kind: string;
  status: string;
  photos?: string[] | null;
  deliveryItemId?: string | null;
}
interface Run {
  id: string;
  deliveryNumber: number;
  status: string;
  siteAddress: string | null;
  completedAt: string | null;
  scheduledFor?: string | null;
  items: RunItem[];
  reports: RunReport[];
  customer: { id: string; name: string } | null;
}

const S3 = process.env.NEXT_PUBLIC_RESOURCE_URL ?? "https://aims-osiris.s3.ap-southeast-1.amazonaws.com/";
const toPhoto = (key: string): CapturedPhoto => ({ key, previewUrl: /^(https?:|data:)/i.test(key) ? key : `${S3}${key}` });
const isoDate = (v?: string | null): string => {
  const d = v ? new Date(v) : new Date();
  const x = Number.isNaN(d.getTime()) ? new Date() : d;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
};

type Grid = { before: CapturedPhoto[]; after: CapturedPhoto[]; photos: CapturedPhoto[]; lines: Set<number> };
type Grids = Record<string, Grid>;
/** Where the technician is in the walk. */
type Cursor = { phase: "job" } | { phase: "section"; index: number; sub: "before" | "after" | "photo" } | { phase: "finish" };

/** The shape saved under serviceData.draft (keys only — photos are S3 keys). */
interface Draft {
  jobTypes: string[];
  grids: Record<string, { before: string[]; after: string[]; photos: string[]; lines: number[] }>;
  customerName: string;
  jobLocation: string;
  serviceDate: string;
  clientEmail: string;
  remarks: string;
  cursor: Cursor;
}

export default function WctServiceReportPage() {
  const params = useParams();
  const router = useRouter();
  const { getToken } = useAuth();
  const { user } = useUser();
  const deliveryId = String(params?.deliveryId ?? "");

  const [run, setRun] = useState<Run | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<Cursor>({ phase: "job" });
  const [customerName, setCustomerName] = useState("");
  const [jobLocation, setJobLocation] = useState("");
  const [serviceDate, setServiceDate] = useState(isoDate());
  const [clientEmail, setClientEmail] = useState("");
  const [jobTypes, setJobTypes] = useState<Set<string>>(new Set());
  const [grids, setGrids] = useState<Grids>({});
  const [remarks, setRemarks] = useState("");
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string; reportNumber: number | null } | null>(null);
  const [restored, setRestored] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const { surface: printSurface, printReport, downloadReport, busy: printBusy } = useMsrPrint();

  const technicianName =
    user?.fullName ?? user?.firstName ?? user?.username ?? user?.primaryEmailAddress?.emailAddress ?? undefined;

  // The service line(s) this walk is for; the report SCHEDULED with the run
  // (a draft row the office's schedule created — completed at the end, which
  // is when it gets its number); and a report already written.
  const serviceItems = useMemo(() => (run?.items ?? []).filter((i) => String(i.assetClass ?? "").toUpperCase() === "SERVICE"), [run]);
  const scheduledDraft = useMemo(() => (run?.reports ?? []).find((r) => r.kind === "SERVICE" && r.status !== "completed") ?? null, [run]);
  const existing = useMemo(() => (run?.reports ?? []).find((r) => r.kind === "SERVICE" && r.status === "completed") ?? null, [run]);
  const sections = useMemo(() => wctSectionsFor(Array.from(jobTypes)), [jobTypes]);

  // ── load the run, then resume from the saved draft when there is one ──────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        if (!token) throw new Error("Not signed in");
        const res = await request({ path: `/deliveries/${deliveryId}`, method: "GET" }, {}, token);
        if (cancelled) return;
        if (res?.success === false) throw new Error(res?.message ?? "Could not load the delivery");
        const r = (res?.data ?? res) as Run;
        setRun(r);
        setCustomerName(r.customer?.name ?? "");
        setJobLocation(r.siteAddress ?? "");
        setServiceDate(isoDate(r.completedAt ?? r.scheduledFor ?? null));
        const draftRow = (r.reports ?? []).find((x) => x.kind === "SERVICE" && x.status !== "completed");
        if (draftRow) {
          try {
            const full = await request({ path: `/maintenance-reports/${draftRow.id}`, method: "GET" }, {}, token);
            const d: Draft | undefined = (full?.data ?? full)?.serviceData?.draft;
            if (!cancelled && d && Array.isArray(d.jobTypes)) {
              setJobTypes(new Set(d.jobTypes));
              const g: Grids = {};
              for (const [id, v] of Object.entries(d.grids ?? {})) {
                g[id] = {
                  before: (v.before ?? []).map(toPhoto),
                  after: (v.after ?? []).map(toPhoto),
                  photos: (v.photos ?? []).map(toPhoto),
                  lines: new Set(v.lines ?? []),
                };
              }
              setGrids(g);
              if (d.customerName) setCustomerName(d.customerName);
              if (d.jobLocation) setJobLocation(d.jobLocation);
              if (d.serviceDate) setServiceDate(d.serviceDate);
              if (d.clientEmail) setClientEmail(d.clientEmail);
              if (d.remarks) setRemarks(d.remarks);
              if (d.cursor && d.cursor.phase) setCursor(d.cursor);
            }
          } catch {
            /* no draft to resume — start from the top */
          }
        }
      } catch (e: any) {
        if (!cancelled) setLoadError(e?.message ?? "Could not load the delivery");
      } finally {
        if (!cancelled) {
          setRestored(true);
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deliveryId, getToken]);

  // Every section the ticks call for gets a grid (a restored one is kept); the
  // service line's DO_START condition photos seed Unit Location once.
  useEffect(() => {
    setGrids((prev) => {
      const next: Grids = { ...prev };
      for (const s of sections) {
        if (next[s.id]) continue;
        const seed =
          s.id === "UNIT_LOCATION"
            ? (run?.reports ?? [])
                .filter((r) => r.kind === "DO_START" && (serviceItems.length === 0 || serviceItems.some((it) => it.id === r.deliveryItemId)))
                .flatMap((r) => r.photos ?? [])
                .slice(0, WCT_MAX_PHOTOS_PER_GRID)
                .map(toPhoto)
            : [];
        next[s.id] = { before: [], after: [], photos: seed, lines: new Set(s.lines.map((_, i) => i)) };
      }
      return next;
    });
  }, [sections, run, serviceItems]);

  // ── autosave the walk on the scheduled report ─────────────────────────────
  const draftOf = useCallback((): Draft => {
    const g: Draft["grids"] = {};
    for (const [id, v] of Object.entries(grids)) {
      g[id] = { before: v.before.map((p) => p.key), after: v.after.map((p) => p.key), photos: v.photos.map((p) => p.key), lines: Array.from(v.lines).sort((a, b) => a - b) };
    }
    return { jobTypes: Array.from(jobTypes), grids: g, customerName, jobLocation, serviceDate, clientEmail, remarks, cursor };
  }, [grids, jobTypes, customerName, jobLocation, serviceDate, clientEmail, remarks, cursor]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef<string>("");
  useEffect(() => {
    if (!restored || !scheduledDraft || created || existing) return;
    const payload = draftOf();
    const json = JSON.stringify(payload);
    if (json === lastSaved.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        setSaveState("saving");
        const token = await getToken();
        if (!token) throw new Error("Not signed in");
        const res = await request({ path: `/maintenance-reports/${scheduledDraft.id}/draft`, method: "PATCH" }, { draft: payload }, token);
        if (res?.success === false) throw new Error(res?.message ?? "save failed");
        lastSaved.current = json;
        setSaveState("saved");
      } catch {
        setSaveState("failed");
      }
    }, 600);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [draftOf, restored, scheduledDraft, created, existing, getToken]);

  const upload = async (blob: Blob): Promise<string | null> => {
    const token = await getToken();
    if (!token) throw new Error("Not signed in");
    const key = await uploadImage({ blob, folderName: "maintenance-reports", token });
    return key || null;
  };
  const setGrid = (id: string, patch: Partial<Grid>) => setGrids((g) => ({ ...g, [id]: { ...g[id], ...patch } }));
  const toggleJobType = (id: string) =>
    setJobTypes((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  // A restored cursor can point past the sections the (changed) ticks call for
  // — fall back to the job step rather than a blank page.
  useEffect(() => {
    if (restored && cursor.phase === "section" && !sections[cursor.index]) setCursor({ phase: "job" });
  }, [restored, cursor, sections]);

  // ── the walk ──────────────────────────────────────────────────────────────
  const firstStepOf = (index: number): Cursor => ({ phase: "section", index, sub: sections[index]?.mode === "before-after" ? "before" : "photo" });
  const goNext = () => {
    setError(null);
    if (cursor.phase === "job") {
      setCursor(sections.length ? firstStepOf(0) : { phase: "finish" });
      return;
    }
    if (cursor.phase === "section") {
      if (cursor.sub === "before") {
        setCursor({ phase: "section", index: cursor.index, sub: "after" });
        return;
      }
      const nextIndex = cursor.index + 1;
      setCursor(nextIndex < sections.length ? firstStepOf(nextIndex) : { phase: "finish" });
    }
  };
  const goBack = () => {
    setError(null);
    if (cursor.phase === "job") {
      router.replace(run?.status === "completed" ? `/scan/deliveries/finished/${deliveryId}` : `/scan/delivery/${deliveryId}`);
      return;
    }
    if (cursor.phase === "section") {
      if (cursor.sub === "after") {
        setCursor({ phase: "section", index: cursor.index, sub: "before" });
        return;
      }
      if (cursor.index === 0) {
        setCursor({ phase: "job" });
        return;
      }
      const prev = cursor.index - 1;
      setCursor({ phase: "section", index: prev, sub: sections[prev]?.mode === "before-after" ? "after" : "photo" });
      return;
    }
    setCursor(sections.length ? { phase: "section", index: sections.length - 1, sub: sections[sections.length - 1].mode === "before-after" ? "after" : "photo" } : { phase: "job" });
  };

  // Progress: job + one step per grid (two for a before/after section) + finish.
  const totalSteps = 1 + sections.reduce((n, s) => n + (s.mode === "before-after" ? 2 : 1), 0) + 1;
  const stepNumber = (() => {
    if (cursor.phase === "job") return 1;
    if (cursor.phase === "finish") return totalSteps;
    let n = 1;
    for (let i = 0; i < cursor.index; i++) n += sections[i].mode === "before-after" ? 2 : 1;
    return n + (cursor.sub === "after" ? 2 : 1);
  })();
  const stepTitle = (() => {
    if (cursor.phase === "job") return "Job";
    if (cursor.phase === "finish") return "Finish";
    const s = sections[cursor.index];
    const name = s ? `${s.heading}${s.subject ? ` ${s.subject}` : ""}` : "Section";
    return cursor.sub === "before" ? `${name} — Before` : cursor.sub === "after" ? `${name} — After` : name;
  })();

  // ── finish: complete the scheduled report, then the customer's sign-off ──
  const finish = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const wct: WctServiceData = { jobTypes: Array.from(jobTypes), sections: {} };
      for (const s of sections) {
        const g = grids[s.id];
        if (!g) continue;
        const r: WctSectionResult = {};
        if (s.mode === "before-after") {
          r.before = g.before.map((p) => p.key);
          r.after = g.after.map((p) => p.key);
        } else {
          r.photos = g.photos.map((p) => p.key);
        }
        // Store the ticked line indexes only when one was un-ticked; absent = all.
        if (g.lines.size !== s.lines.length) r.lines = Array.from(g.lines).sort((a, b) => a - b);
        wct.sections[s.id] = r;
      }
      const serviceData = {
        templateId: "WCT_V1",
        templateVersion: TEMPLATE_VERSIONS.WCT_V1,
        customerName: customerName.trim() || null,
        jobLocation: jobLocation.trim() || null,
        clientEmail: clientEmail.trim() || null,
        serviceDate,
        remarks: remarks.trim() || null,
        wct,
      };
      const description = remarks.trim() || serviceItems.map((i) => i.description).filter(Boolean).join(", ") || "Service report";
      // The scheduled row is completed in place; a run scheduled before reports
      // were scheduled with it (or an ad-hoc job) creates one now.
      const res = scheduledDraft
        ? await request(
            { path: `/maintenance-reports/${scheduledDraft.id}/complete`, method: "POST" },
            {
              serviceData,
              description,
              ...(technicianName ? { technicianName } : {}),
              ...(serviceItems[0] ? { deliveryItemId: serviceItems[0].id } : {}),
            },
            token,
          )
        : await request(
            { path: "/maintenance-reports", method: "POST" },
            {
              kind: "SERVICE",
              deliveryId,
              ...(serviceItems[0] ? { deliveryItemId: serviceItems[0].id } : {}),
              description,
              ...(technicianName ? { technicianName } : {}),
              paymentRequired: false,
              serviceData,
            },
            token,
          );
      if (res?.success === false) throw new Error(res?.message ?? "Could not create the service report");
      const row = res?.data ?? res;
      setCreated({ id: row.id, reportNumber: row.reportNumber ?? null });
      // The job is still open: end the service lines (the unsigned "End
      // Delivery" the DO flow does) and go straight to the customer signature.
      if (run?.status !== "completed") {
        const ack = await request({ path: `/deliveries/${deliveryId}/ack-all`, method: "POST" }, {}, token);
        if (ack?.success === false) throw new Error(ack?.message ?? "Could not end the service lines");
        router.replace(`/scan/delivery/${deliveryId}/finalize`);
        return;
      }
    } catch (e: any) {
      setError(e?.message ?? "Could not finish the service");
    } finally {
      setSubmitting(false);
    }
  };

  // A job that was already signed off before this walk existed: the report is
  // the last thing, so it just lands on the finished screen.
  const continueToSignOff = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const res = await request({ path: `/deliveries/${deliveryId}/ack-all`, method: "POST" }, {}, token);
      if (res?.success === false) throw new Error(res?.message ?? "Could not end the service lines");
      router.replace(`/scan/delivery/${deliveryId}/finalize`);
    } catch (e: any) {
      setError(e?.message ?? "Could not continue to the sign-off");
      setSubmitting(false);
    }
  };

  useFieldAppBar({
    title: "Service",
    subtitle: run && !created ? `Delivery #${run.deliveryNumber} · Step ${stepNumber} of ${totalSteps} · ${stepTitle}` : run ? `Delivery #${run.deliveryNumber}` : undefined,
    onBack: created ? undefined : goBack,
    backDisabled: submitting || uploading,
  });

  if (loading) {
    return (
      <Box sx={{ p: 2, display: "flex", justifyContent: "center", pt: 6 }}>
        <CircularProgress />
      </Box>
    );
  }
  if (loadError || !run) {
    return (
      <Box sx={{ p: 2 }}>
        <Alert severity="error">{loadError ?? "Delivery not found"}</Alert>
        <Button sx={{ mt: 2 }} onClick={() => router.back()}>Back</Button>
      </Box>
    );
  }

  const doneId = created?.id ?? existing?.id ?? null;
  if (doneId) {
    return (
      <Box sx={{ p: 2, display: "flex", flexDirection: "column", gap: 2, alignItems: "stretch" }}>
        {printSurface}
        <Stack alignItems="center" spacing={1} sx={{ py: 3, textAlign: "center" }}>
          <CheckCircleIcon sx={{ fontSize: 80, color: "success.main" }} />
          <Typography variant="h5">{created ? "Service report created" : "Service report already written"}</Typography>
          <Typography variant="body2" color="text.secondary">
            {created?.reportNumber != null ? `Report #${String(created.reportNumber).padStart(6, "0")} · ` : ""}
            Delivery #{run.deliveryNumber}{created ? " · emailed to the customer when an email is on file" : ""}
          </Typography>
        </Stack>
        {printBusy && <Alert severity="info">{printBusy}</Alert>}
        <Button variant="contained" startIcon={<PrintIcon />} onClick={() => void printReport(doneId).catch((e) => setError(e?.message))} disabled={!!printBusy} fullWidth sx={FIELD_BUTTON_SX}>
          Print report
        </Button>
        <Button variant="outlined" startIcon={<DownloadIcon />} onClick={() => void downloadReport(doneId).catch((e) => setError(e?.message))} disabled={!!printBusy} fullWidth sx={FIELD_BUTTON_SX}>
          Download PDF
        </Button>
        {error && <Alert severity="error">{error}</Alert>}
        {run.status === "completed" ? (
          <Button variant="text" onClick={() => router.replace(`/scan/deliveries/finished/${run.id}`)} fullWidth sx={FIELD_BUTTON_SX}>
            Back to delivery
          </Button>
        ) : (
          <Button variant="contained" color="success" onClick={() => void continueToSignOff()} disabled={submitting} fullWidth sx={FIELD_BUTTON_SX}>
            {submitting ? "One moment…" : "Continue to customer sign-off"}
          </Button>
        )}
      </Box>
    );
  }

  const canStart = jobTypes.size > 0 && customerName.trim().length > 0;
  const section = cursor.phase === "section" ? sections[cursor.index] : null;
  const grid = section ? grids[section.id] : null;
  const saveNote = saveState === "saving" ? "Saving…" : saveState === "saved" ? "Progress saved" : saveState === "failed" ? "Could not save progress — check the connection" : "";

  return (
    <Box sx={{ p: 2, display: "flex", flexDirection: "column", gap: 2.5, pb: 6 }}>
      <Box>
        <Typography variant="subtitle1">{stepTitle}</Typography>
        <LinearProgress variant="determinate" value={(stepNumber / totalSteps) * 100} sx={{ mt: 1, borderRadius: 1, height: 6 }} />
        {scheduledDraft && saveNote && (
          <Typography variant="caption" color={saveState === "failed" ? "error.main" : "text.secondary"} sx={{ display: "block", mt: 0.5 }}>
            {saveNote}
          </Typography>
        )}
      </Box>
      {serviceItems.length === 0 && (
        <Alert severity="warning">This delivery has no Service line. The report is still written against the run.</Alert>
      )}

      {/* JOB — what is being done today */}
      {cursor.phase === "job" && (
        <Stack spacing={2}>
          <Alert severity="info">
            {run.status === "completed"
              ? "The job is signed off. Write the service report now — it goes to the customer by email."
              : "Tick what is being done today, then take the Before photos, do the work, take the After photos. The customer signs at the end."}
          </Alert>
          <TextField label="Company" value={customerName} onChange={(e) => setCustomerName(e.target.value)} fullWidth size="small" />
          <TextField label="Location" value={jobLocation} onChange={(e) => setJobLocation(e.target.value)} fullWidth size="small" multiline minRows={2} />
          <TextField label="Date of Servicing" type="date" value={serviceDate} onChange={(e) => setServiceDate(e.target.value)} fullWidth size="small" InputLabelProps={{ shrink: true }} />
          <Divider />
          <Typography variant="subtitle2">Type of Service/Job</Typography>
          {WCT_JOB_TYPE_GROUPS.map((g) => (
            <Box key={g.id}>
              <Typography variant="body2" sx={{ fontWeight: 600, textDecoration: "underline", mb: 0.5 }}>{g.title}</Typography>
              {g.items.map((it) => (
                <FormControlLabel
                  key={it.id}
                  sx={{ display: "flex", alignItems: "flex-start", ml: 0, mb: 0.25 }}
                  control={<Checkbox checked={jobTypes.has(it.id)} onChange={() => toggleJobType(it.id)} sx={{ py: 0.5 }} />}
                  label={
                    <Box sx={{ pt: 0.6 }}>
                      <Typography variant="body2">{it.label}</Typography>
                      {it.sub && <Typography variant="caption" color="text.secondary">- {it.sub}</Typography>}
                      {it.note && <Typography variant="caption" sx={{ display: "block", color: "error.main", fontStyle: "italic" }}>{it.note}</Typography>}
                    </Box>
                  }
                />
              ))}
            </Box>
          ))}
          {!canStart && <Typography variant="caption" color="text.secondary">Tick at least one job type to start.</Typography>}
          {error && <Alert severity="error">{error}</Alert>}
          <Button variant="contained" size="large" startIcon={<PlayArrowIcon />} onClick={goNext} disabled={!canStart} fullWidth sx={FIELD_BUTTON_SX}>
            Start service
          </Button>
        </Stack>
      )}

      {/* ONE SECTION — Before, then After (or the single grid) */}
      {cursor.phase === "section" && section && grid && (
        <Stack spacing={2}>
          <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1.5 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              {section.heading}{section.subject ? ` ${section.subject}` : ""}
            </Typography>
            {cursor.sub === "before" && (
              <>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  Take the Before photos, then do the work.
                </Typography>
                <PhotoCaptureField label="Before" photos={grid.before} onChange={(p) => setGrid(section.id, { before: p })} upload={upload} maxPhotos={WCT_MAX_PHOTOS_PER_GRID} onError={(m) => setError(m || null)} onUploadingChange={setUploading} />
              </>
            )}
            {cursor.sub === "after" && (
              <>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  Work done — take the After photos and un-tick anything not done.
                </Typography>
                <PhotoCaptureField label="After" photos={grid.after} onChange={(p) => setGrid(section.id, { after: p })} upload={upload} maxPhotos={WCT_MAX_PHOTOS_PER_GRID} onError={(m) => setError(m || null)} onUploadingChange={setUploading} />
              </>
            )}
            {cursor.sub === "photo" && (
              <PhotoCaptureField label="Photo" photos={grid.photos} onChange={(p) => setGrid(section.id, { photos: p })} upload={upload} maxPhotos={WCT_MAX_PHOTOS_PER_GRID} onError={(m) => setError(m || null)} onUploadingChange={setUploading} />
            )}
            {cursor.sub !== "before" && (
              <Box sx={{ mt: 1 }}>
                {section.lines.map((line, i) => (
                  <FormControlLabel
                    key={i}
                    sx={{ display: "flex", alignItems: "flex-start", ml: 0 }}
                    control={
                      <Checkbox
                        size="small"
                        checked={grid.lines.has(i)}
                        onChange={() => {
                          const n = new Set(grid.lines);
                          if (n.has(i)) n.delete(i);
                          else n.add(i);
                          setGrid(section.id, { lines: n });
                        }}
                        sx={{ py: 0.25 }}
                      />
                    }
                    label={<Typography variant="body2" sx={{ pt: 0.4 }}>{line}</Typography>}
                  />
                ))}
              </Box>
            )}
          </Box>
          {error && <Alert severity="error">{error}</Alert>}
          <Button variant="contained" size="large" onClick={goNext} disabled={uploading} fullWidth sx={FIELD_BUTTON_SX}>
            {cursor.sub === "before" ? "Work done → After photos" : cursor.index + 1 < sections.length ? "Next" : "All done → finish"}
          </Button>
        </Stack>
      )}

      {/* FINISH — remarks, email, complete the report, then the sign-off */}
      {cursor.phase === "finish" && (
        <Stack spacing={2}>
          <TextField label="Remarks (optional)" value={remarks} onChange={(e) => setRemarks(e.target.value)} fullWidth multiline minRows={3} />
          <TextField label="Customer email (optional — the report is emailed here)" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} fullWidth size="small" />
          <Typography variant="body2" color="text.secondary">
            {customerName || "—"} · {jobLocation || "—"} · {serviceDate} · {jobTypes.size} job type{jobTypes.size === 1 ? "" : "s"} · {sections.length} photo section{sections.length === 1 ? "" : "s"}
          </Typography>
          {error && <Alert severity="error">{error}</Alert>}
          <Button variant="contained" color="success" size="large" startIcon={<DoneAllIcon />} onClick={finish} disabled={submitting || uploading} fullWidth sx={FIELD_BUTTON_SX}>
            {submitting ? <CircularProgress size={20} color="inherit" /> : run.status === "completed" ? "Create service report" : "Finish service → customer sign-off"}
          </Button>
        </Stack>
      )}
    </Box>
  );
}
