"use client";

import React, { useEffect, useMemo, useState } from "react";
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
 * WCT SERVICE REPORT — captured from the FINISHED job (2026-10-27).
 *
 * The WCT flow is Quotation → DO → service done → invoice → service report:
 * once the run is signed off and its invoice exists, the technician writes the
 * customer's report here — the paper's "Type of Service/Job" ticks, then the
 * Before / After photos of each equipment serviced with the standard work
 * lines, the area-cleaning photo and any remarks. There is no customer
 * signature on this document (the customer signed the DO), so submitting it
 * completes it: it gets its running number, is emailed to the customer and
 * lands on the office's Service Reports page, linked to the run and invoice.
 *
 *   step 1  Job      — company / location / date (from the run), job types
 *   step 2  Photos   — one block per section the job types call for
 *   step 3  Submit   — remarks, customer email, create
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

type Grids = Record<string, { before: CapturedPhoto[]; after: CapturedPhoto[]; photos: CapturedPhoto[]; lines: Set<number> }>;

const STEPS = ["Job", "Photos", "Submit"] as const;

export default function WctServiceReportPage() {
  const params = useParams();
  const router = useRouter();
  const { getToken } = useAuth();
  const { user } = useUser();
  const deliveryId = String(params?.deliveryId ?? "");

  const [run, setRun] = useState<Run | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [step, setStep] = useState(1);
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

  const { surface: printSurface, printReport, downloadReport, busy: printBusy } = useMsrPrint();

  const technicianName =
    user?.fullName ?? user?.firstName ?? user?.username ?? user?.primaryEmailAddress?.emailAddress ?? undefined;

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
      } catch (e: any) {
        if (!cancelled) setLoadError(e?.message ?? "Could not load the delivery");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deliveryId, getToken]);

  // The service line(s) this report is for; the report SCHEDULED with the run
  // (a draft row the office's schedule created — completed here, which is when
  // it gets its number); and a report already written.
  const serviceItems = useMemo(() => (run?.items ?? []).filter((i) => String(i.assetClass ?? "").toUpperCase() === "SERVICE"), [run]);
  const scheduledDraft = useMemo(() => (run?.reports ?? []).find((r) => r.kind === "SERVICE" && r.status !== "completed") ?? null, [run]);
  const existing = useMemo(() => (run?.reports ?? []).find((r) => r.kind === "SERVICE" && r.status === "completed") ?? null, [run]);

  const sections = useMemo(() => wctSectionsFor(Array.from(jobTypes)), [jobTypes]);

  // Every section the ticks call for gets a grid; the service line's DO_START
  // condition photos seed Unit Location once.
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

  const upload = async (blob: Blob): Promise<string | null> => {
    const token = await getToken();
    if (!token) throw new Error("Not signed in");
    const key = await uploadImage({ blob, folderName: "maintenance-reports", token });
    return key || null;
  };

  const setGrid = (id: string, patch: Partial<Grids[string]>) => setGrids((g) => ({ ...g, [id]: { ...g[id], ...patch } }));

  const toggleJobType = (id: string) =>
    setJobTypes((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const submit = async () => {
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
    } catch (e: any) {
      setError(e?.message ?? "Could not create the service report");
    } finally {
      setSubmitting(false);
    }
  };

  // After the report: mark every service line delivered (the unsigned "End
  // Delivery" the DO flow does) and hand over to the one customer signature.
  const [finishing, setFinishing] = useState(false);
  const continueToSignOff = async () => {
    setFinishing(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const res = await request({ path: `/deliveries/${deliveryId}/ack-all`, method: "POST" }, {}, token);
      if (res?.success === false) throw new Error(res?.message ?? "Could not end the service lines");
      router.replace(`/scan/delivery/${deliveryId}/finalize`);
    } catch (e: any) {
      setError(e?.message ?? "Could not continue to the sign-off");
      setFinishing(false);
    }
  };
  const stepName = STEPS[step - 1];
  useFieldAppBar({
    title: "Service Report",
    subtitle: run && !created ? `Delivery #${run.deliveryNumber} · Step ${step} of ${STEPS.length} · ${stepName}` : run ? `Delivery #${run.deliveryNumber}` : undefined,
    // Step 1's Back goes to the finished-delivery screen (finalize lands here
    // directly, so history would lead back into the sign-off), which keeps
    // saying the report is pending until it is written.
    // Step 1's Back returns to where the job is: the run page while the job is
    // still open (the report is written during the job, before the sign-off),
    // the finished-delivery screen once it is completed.
    onBack: created
      ? undefined
      : () => (step === 1 ? router.replace(run?.status === "completed" ? `/scan/deliveries/finished/${deliveryId}` : `/scan/delivery/${deliveryId}`) : setStep((v) => v - 1)),
    backDisabled: submitting,
  });

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 10 }}>
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
          /* The job is still open: the report is written, now the customer
             signs. End the service lines (unsigned) and go to the sign-off. */
          <Button
            variant="contained"
            color="success"
            onClick={() => void continueToSignOff()}
            disabled={finishing}
            fullWidth
            sx={FIELD_BUTTON_SX}
          >
            {finishing ? "One moment…" : "Continue to customer sign-off"}
          </Button>
        )}
      </Box>
    );
  }

  const canLeaveJob = jobTypes.size > 0 && customerName.trim().length > 0;

  return (
    <Box sx={{ p: 2, display: "flex", flexDirection: "column", gap: 2.5, pb: 6 }}>
      <Box>
        <Typography variant="subtitle1">{stepName}</Typography>
        <LinearProgress variant="determinate" value={(step / STEPS.length) * 100} sx={{ mt: 1, borderRadius: 1, height: 6 }} />
      </Box>

      {serviceItems.length === 0 && (
        <Alert severity="warning">This delivery has no Service line. The report is still written against the run.</Alert>
      )}
      {step === 1 && (
        <Alert severity="info">
          {run.status === "completed"
            ? "The job is signed off. Write the service report now — it goes to the customer by email."
            : "Write the service report for the work done. The customer signs off right after."}
        </Alert>
      )}

      {stepName === "Job" && (
        <Stack spacing={2}>
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
          {!canLeaveJob && <Typography variant="caption" color="text.secondary">Tick at least one job type to continue.</Typography>}
        </Stack>
      )}

      {stepName === "Photos" && (
        <Stack spacing={3}>
          {sections.map((s) => {
            const g = grids[s.id];
            if (!g) return null;
            return (
              <Box key={s.id} sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1.5 }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  {s.heading}{s.subject ? ` ${s.subject}` : ""}
                </Typography>
                {s.mode === "before-after" ? (
                  <>
                    <PhotoCaptureField label="Before" photos={g.before} onChange={(p) => setGrid(s.id, { before: p })} upload={upload} maxPhotos={WCT_MAX_PHOTOS_PER_GRID} onError={(m) => setError(m || null)} onUploadingChange={setUploading} />
                    <PhotoCaptureField label="After" photos={g.after} onChange={(p) => setGrid(s.id, { after: p })} upload={upload} maxPhotos={WCT_MAX_PHOTOS_PER_GRID} onError={(m) => setError(m || null)} onUploadingChange={setUploading} />
                  </>
                ) : (
                  <PhotoCaptureField label="Photo" photos={g.photos} onChange={(p) => setGrid(s.id, { photos: p })} upload={upload} maxPhotos={WCT_MAX_PHOTOS_PER_GRID} onError={(m) => setError(m || null)} onUploadingChange={setUploading} />
                )}
                <Box sx={{ mt: 1 }}>
                  {s.lines.map((line, i) => (
                    <FormControlLabel
                      key={i}
                      sx={{ display: "flex", alignItems: "flex-start", ml: 0 }}
                      control={
                        <Checkbox
                          size="small"
                          checked={g.lines.has(i)}
                          onChange={() => {
                            const n = new Set(g.lines);
                            if (n.has(i)) n.delete(i);
                            else n.add(i);
                            setGrid(s.id, { lines: n });
                          }}
                          sx={{ py: 0.25 }}
                        />
                      }
                      label={<Typography variant="body2" sx={{ pt: 0.4 }}>{line}</Typography>}
                    />
                  ))}
                </Box>
              </Box>
            );
          })}
        </Stack>
      )}

      {stepName === "Submit" && (
        <Stack spacing={2}>
          <TextField label="Remarks (optional)" value={remarks} onChange={(e) => setRemarks(e.target.value)} fullWidth multiline minRows={3} />
          <TextField label="Customer email (optional — the report is emailed here)" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} fullWidth size="small" type="email" helperText="Leave blank to use the customer's email on file." />
          <Typography variant="body2" color="text.secondary">
            {customerName || "—"} · {jobLocation || "—"} · {serviceDate} · {jobTypes.size} job type{jobTypes.size === 1 ? "" : "s"} · {sections.length} photo section{sections.length === 1 ? "" : "s"}
          </Typography>
        </Stack>
      )}

      {error && <Alert severity="error">{error}</Alert>}

      {stepName === "Submit" ? (
        <Button variant="contained" onClick={submit} disabled={submitting || uploading} fullWidth sx={FIELD_BUTTON_SX}>
          {submitting ? <CircularProgress size={20} color="inherit" /> : "Create service report"}
        </Button>
      ) : (
        <Button variant="contained" onClick={() => setStep((v) => v + 1)} disabled={uploading || (stepName === "Job" && !canLeaveJob)} fullWidth sx={FIELD_BUTTON_SX}>
          Next
        </Button>
      )}
    </Box>
  );
}
