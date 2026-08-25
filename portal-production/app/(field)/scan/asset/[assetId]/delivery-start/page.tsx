"use client";

import React, { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useAuth, useUser } from "@clerk/nextjs";
import { Alert, Box, Button, CircularProgress, Stack, TextField, Typography } from "@mui/material";
import LocalShippingIcon from "@mui/icons-material/LocalShipping";
import CameraAltIcon from "@mui/icons-material/CameraAlt";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import PlaceIcon from "@mui/icons-material/Place";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";

// One open scheduled run in the rider's picker. `matchesAsset` is false when the
// run has no open slot for this unit's asset (an office typo) — the run is still
// pickable so the rider is never locked out.
interface ScheduledRunOption {
  id: string;
  deliveryNumber: number;
  scheduledFor: string | null;
  deliveryAddress: string;
  customerName: string | null;
  openSlotCount: number;
  matchesAsset: boolean;
}
import { request } from "@/helpers/request";
import { uploadImage } from "@/helpers/imageUploader";
import PhotoCaptureField, { CapturedPhoto } from "@/components/delivery/PhotoCaptureField";
import GuidedPhotoCapture from "@/components/delivery/GuidedPhotoCapture";
import { minPhotosForAssetClass } from "@/helpers/assetClass";
import { useBackgroundLocationContext } from "../../../../context/BackgroundLocationContext";

/**
 * Start Delivery — first step of the two-step delivery flow. Enabled only
 * when an open DO exists for this asset and has not been started yet
 * (see canStartDelivery in getScanContext).
 *
 * Captures OPTIONAL condition photos at custody handover (folder: do-start)
 * — this is where the equipment's outbound state is evidenced. No notes or
 * signature at start; the customer signature is captured at acknowledge
 * time. Photos render in the DO's PROOF OF DELIVERY section under the
 * "Delivery Started" block.
 *
 *   Tap → POST /maintenance-reports {kind: DO_START, documentId, photos?}
 *       → bgLocationContext.start(reportId)  (foreground service + pings)
 *       → /scan/asset/:id/done
 */
export default function StartDeliveryPage() {
  const params = useParams();
  const router = useRouter();
  const search = useSearchParams();
  const { getToken } = useAuth();
  const { user } = useUser();
  const bgLocation = useBackgroundLocationContext();
  const assetId = params?.assetId as string;
  const inventoryId = search?.get("inventoryId") ?? null;
  // Standalone mode (Layer 3): no DO exists — create a Delivery run first,
  // then the DO_START MSR carries deliveryId instead of documentId.
  const standalone = search?.get("standalone") === "1";
  // RETURN mode (reverse delivery): collect a rental unit back to stock. Same
  // field flow (photo/GPS at pickup → collect-ack) minus the assign + install.
  const isReturn = search?.get("return") === "1";
  const verb = isReturn ? "Return" : "Delivery";
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Optional outbound-condition photos (no minimum) — same shared capture
  // component the ack step used to own; keys land on the DO_START MSR row.
  const [photos, setPhotos] = useState<CapturedPhoto[]>([]);
  const [uploading, setUploading] = useState(false);

  // Assign-at-start (2026-08): after DO_START, a standalone run parks in the
  // ASSIGN phase. The rider no longer picks a customer then a project — they
  // pick one of the office's SCHEDULED DELIVERIES (by drop address). The chosen
  // run supplies the project + customer, and the unit is merged into that run.
  // fieldDeploy defers the status flip, so the unit stays reserved until ack.
  // "photos" is a full-screen step, not a cramped inline block: the guided
  // sequence needs the whole viewport on a phone. Mirrors how after-ack steps.
  const [phase, setPhase] = useState<"start" | "photos" | "assign">("start");
  const [runId, setRunId] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);
  // Open scheduled runs to pick from, loaded when the assign phase opens.
  const [scheduledRuns, setScheduledRuns] = useState<ScheduledRunOption[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  // Clerk-auth'd upload closure for the shared PhotoCaptureField — the
  // component stays auth-agnostic; the token lives here (folder: do-start).
  const uploadDoStart = async (blob: Blob): Promise<string | null> => {
    const token = await getToken();
    if (!token) throw new Error("Not signed in");
    return uploadImage({ blob, folderName: "do-start", token });
  };

  // Pull the latest DO so we can attach the MSR to it. The action chooser
  // already verified one exists via canStartDelivery — this is a defensive
  // re-fetch in case the user deep-linked or refreshed.
  const [doId, setDoId] = useState<string | null>(null);
  const [doName, setDoName] = useState<string | null>(null);
  const [contextLoading, setContextLoading] = useState(true);
  // Equipment/Accessory for this asset — sets the condition-photo minimum.
  // Unknown falls back to Equipment, the stricter of the two.
  const [assetClass, setAssetClass] = useState<string | null>(null);
  // Condition-photo minimum (OSI-81): equipment gets the guided set, an
  // accessory keeps one. Direction-blind on purpose — a collection is captured
  // to the same standard as the outbound run so the two sets can be compared
  // before and after the hire.
  const requiredPhotos = minPhotosForAssetClass(assetClass);
  // Return flow: the unit's original outbound condition photos (signed URLs) for
  // the "Delivered condition" comparison strip, plus the damaged flag + comment.
  const [outboundPhotos, setOutboundPhotos] = useState<string[]>([]);
  // Parallel angle labels for the outbound photos (empty for units captured
  // before angle-labelling shipped) — drives per-angle pairing in the return
  // comparison. #2.
  const [outboundAngles, setOutboundAngles] = useState<string[]>([]);
  const [damaged, setDamaged] = useState<boolean | null>(null);
  const [damageComment, setDamageComment] = useState("");
  // Per-angle damage (returns, guided capture): parallel to photos[], one
  // answer per shot. The unit-level flag above is still used by the accessory
  // (free-form) path, which has no angles to ask about.
  const [photoDamaged, setPhotoDamaged] = useState<boolean[]>([]);
  const [photoComments, setPhotoComments] = useState<string[]>([]);
  // Pull the outbound condition photos once, only on a return with a known unit.
  useEffect(() => {
    if (!isReturn || !inventoryId) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const res = await request(
          { path: `/maintenance-reports/unit/${encodeURIComponent(inventoryId)}/outbound-photos`, method: "GET" },
          {},
          token,
        );
        const data = res?.data ?? res;
        if (!cancelled && Array.isArray(data?.photos)) {
          setOutboundPhotos(data.photos);
          setOutboundAngles(Array.isArray(data?.angles) ? data.angles : []);
        }
      } catch {
        // Non-fatal: no comparison strip, the return still proceeds.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isReturn, inventoryId, getToken]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Standalone runs have no DO to resolve, but they DO need the asset's
      // class to know how many condition photos to demand — so the fetch runs
      // either way and only the DO half is skipped below.
      try {
        const token = await getToken();
        if (!token) return;
        const invQuery = inventoryId ? `?inventoryId=${encodeURIComponent(inventoryId)}` : "";
        const res = await request(
          { path: `/maintenance-reports/scan-context/${assetId}${invQuery}`, method: "GET" },
          {},
          token,
        );
        if (cancelled) return;
        const data = res.data ?? res;
        if (data?.asset?.assetClass) setAssetClass(data.asset.assetClass);
        if (!standalone && data?.latestDeliveryOrder?.id) {
          setDoId(data.latestDeliveryOrder.id);
          setDoName(data.latestDeliveryOrder.name ?? null);
        }
      } catch {
        // ignore — confirm will fail loudly later if doId stays null
      } finally {
        if (!cancelled) setContextLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [assetId, getToken, inventoryId, standalone]);

  // Load the office's open scheduled deliveries when the assign phase opens.
  // EVERY open run is listed (not just those with a slot for this asset): the
  // list flags a mismatch but never hides a run, so an office typo can't lock
  // the rider out. assetId drives the per-run `matchesAsset` flag.
  useEffect(() => {
    if (phase !== "assign") return;
    let cancelled = false;
    (async () => {
      setRunsLoading(true);
      setRunsError(null);
      try {
        const token = await getToken();
        if (!token) return;
        const res = await request(
          { path: `/deliveries/scheduled-open?assetId=${encodeURIComponent(assetId)}`, method: "GET" },
          {},
          token,
        );
        if (cancelled) return;
        const list = res?.data ?? res;
        setScheduledRuns(Array.isArray(list) ? list : []);
      } catch (e: any) {
        if (!cancelled) setRunsError(e?.message ?? "Could not load scheduled deliveries");
      } finally {
        if (!cancelled) setRunsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [phase, assetId, getToken]);

  // Assign the started unit to the CHOSEN scheduled run (per-unit; deferred
  // flip). The backend merges this ad-hoc run into the chosen run and returns
  // the run to land on.
  const doAssign = async () => {
    if (!runId || !inventoryId || !selectedRunId || assigning) return;
    setAssigning(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const res = await request(
        { path: `/deliveries/${runId}/assign`, method: "POST" },
        { scheduledRunId: selectedRunId, inventoryId },
        token,
      );
      if (res?.success === false) throw new Error(res?.message ?? "Assignment failed");
      // The assign MERGED this unit into the chosen scheduled run (move-and-
      // discard) — THIS ad-hoc run is gone. Land on the run the backend says is
      // live (the chosen scheduled run).
      const effectiveRunId = res?.data?.runId ?? res?.runId ?? runId;
      router.replace(`/scan/delivery/${effectiveRunId}`);
    } catch (e: any) {
      setError(e?.message ?? "Assignment failed");
    } finally {
      setAssigning(false);
    }
  };

  const confirm = async () => {
    setError(null);
    if (!standalone && !doId) {
      setError("No open delivery order found for this asset.");
      return;
    }
    if (standalone && !inventoryId) {
      setError("Standalone delivery needs a specific scanned unit.");
      return;
    }
    // Standalone runs REQUIRE condition photos per unit — the outbound state
    // must be evidenced before the unit leaves (backend enforces this too).
    if (standalone && photos.length < requiredPhotos) {
      setError(
        requiredPhotos === 1
          ? `A condition photo of the unit is required before starting this ${verb.toLowerCase()}.`
          : `This unit is equipment, so it needs ${requiredPhotos} condition photos before starting this ${verb.toLowerCase()}. ${photos.length} so far.`,
      );
      return;
    }
    setSubmitting(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      // Snapshot the tech's display name onto the report so the office side
      // can render "Delivery By: <name>" in the printed DO without a Clerk
      // round-trip. Fallback chain: full name → first name → username →
      // primary email. Stored as MSR.technicianName (nullable column).
      const technicianName =
        user?.fullName ??
        user?.firstName ??
        user?.username ??
        user?.primaryEmailAddress?.emailAddress ??
        undefined;

      // Standalone (Layer 3): create the Delivery run FIRST — this atomically
      // reserves the scanned unit (a 400 here means it's already out) — then
      // the DO_START MSR carries deliveryId (documentId stays null).
      let deliveryId: string | null = null;
      if (standalone) {
        const runRes = await request(
          { path: "/deliveries", method: "POST" },
          {
            assetId,
            inventoryId,
            ...(technicianName ? { riderName: technicianName } : {}),
            // RETURN run: the backend skips reservation (the unit is out on
            // rental) and blocks a sold unit with the credit-note message.
            ...(isReturn ? { direction: "RETURN" } : {}),
          },
          token,
        );
        if (runRes.success === false) throw new Error(runRes.message ?? (isReturn ? "Could not start return" : "Could not start delivery"));
        deliveryId = runRes.data?.id ?? runRes.id;
        if (!deliveryId) throw new Error("No delivery id returned");
      }

      const res = await request(
        { path: "/maintenance-reports", method: "POST" },
        {
          assetId,
          ...(inventoryId ? { inventoryId } : {}),
          description: isReturn ? "Return started" : "Delivery started",
          kind: "DO_START",
          ...(standalone && deliveryId ? { deliveryId } : { documentId: doId }),
          ...(technicianName ? { technicianName } : {}),
          ...(photos.length ? { photos: photos.map((p) => p.key) } : {}),
          // Per-photo angle labels, parallel to photos[] (guided capture stamps
          // them; free-form leaves ""). Stored in serviceData.photoAngles so a
          // later return can pair each collection shot with its outbound angle.
          ...(photos.some((p) => p.angle)
            ? { angles: photos.map((p) => p.angle ?? "") }
            : {}),
          // Return flow: record the damaged flag (recorded only) + optional
          // comment. Damaged returns still go to instock exactly as today.
          ...(isReturn
            ? photoDamaged.length
              ? {
                  // Guided return: one answer per angle. The server derives the
                  // scalar `damaged` column from these, so it is not sent here.
                  photoDamaged,
                  photoComments,
                }
              : {
                  // Free-form return (accessory): the single unit-level answer.
                  damaged: damaged === true,
                  ...(damageComment.trim() ? { serviceData: { returnComment: damageComment.trim() } } : {}),
                }
            : {}),
        },
        token,
      );
      const reportId = res.data?.id ?? res.id;
      if (!reportId) throw new Error("No report id returned");
      // eslint-disable-next-line no-console
      console.log("[delivery-start] POST OK, starting background tracking", {
        reportId,
        assetId,
      });
      // Kick off the layout-level background tracker. Fire-and-forget — the
      // navigation below shouldn't be gated on the foreground service start
      // (which awaits Android permission prompts that can take seconds).
      void bgLocation.start(reportId);
      if (standalone && deliveryId) {
        // RETURN: the unit is already on a project — no assign step. Go straight
        // to the run basket to collect (acknowledge) and finish.
        if (isReturn) {
          router.replace(`/scan/delivery/${deliveryId}`);
          return;
        }
        // Standalone delivery: assign is the last step of starting — park in the
        // assign phase (optional project pick), then land on the basket.
        setRunId(deliveryId);
        setPhase("assign");
        setSubmitting(false);
        return;
      }
      // Carry inventoryId through to /done so its "Back to this asset" link
      // can restore the full scan context — without it the action chooser
      // can't find the DO that references this inventory unit and shows
      // "No delivery order" until the tech rescans the tag.
      const invQuery = inventoryId ? `?inventoryId=${encodeURIComponent(inventoryId)}` : "";
      router.replace(`/scan/asset/${assetId}/done${invQuery}`);
    } catch (e: any) {
      setError(e?.message ?? "Failed to start delivery");
    } finally {
      setSubmitting(false);
    }
  };

  // Human date for a scheduled run ("Tue, 26 Aug"), or null when undated.
  const formatScheduledFor = (iso: string | null): string | null => {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  };

  // ── ASSIGN phase (standalone, after DO_START) ───────────────────────────────
  // The rider picks one of the office's SCHEDULED DELIVERIES (by drop address).
  // Every open run is shown; a run with no slot for this unit's asset is flagged
  // but still pickable, so an office typo can't strand the rider.
  if (phase === "assign") {
    return (
      <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2.5, alignItems: "center" }}>
        <LocalShippingIcon sx={{ fontSize: 64, color: "primary.main", mt: 2 }} />
        <Typography variant="h6" fontWeight={700} sx={{ textAlign: "center" }}>
          Choose the delivery
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ textAlign: "center", maxWidth: 360 }}>
          Delivery started. Pick the scheduled delivery this unit is going out on. The office schedules
          these, and picking one assigns the unit to its project.
        </Typography>

        <Box sx={{ width: "100%", maxWidth: 360, display: "flex", flexDirection: "column", gap: 2 }}>
          {runsLoading ? (
            <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
              <CircularProgress size={28} />
            </Box>
          ) : runsError ? (
            <>
              <Alert severity="error">{runsError}</Alert>
              <Button variant="outlined" onClick={() => setPhase("assign")} fullWidth sx={{ minHeight: 44 }}>
                Try again
              </Button>
            </>
          ) : scheduledRuns.length === 0 ? (
            // NO OPEN SCHEDULED RUN. There is no ad-hoc fallback anymore, so this
            // must explain clearly that the office has to schedule a delivery
            // first, and let the rider re-check once they have.
            <Alert severity="info" icon={<LocalShippingIcon />}>
              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.5 }}>
                No scheduled deliveries yet
              </Typography>
              <Typography variant="body2">
                This unit is started and reserved, but there is no scheduled delivery to put it on. The
                office needs to schedule one for this drop first. Once they have, tap Refresh to pick it.
              </Typography>
              <Button
                variant="outlined"
                size="small"
                onClick={() => setPhase("assign")}
                sx={{ mt: 1.5, minHeight: 40 }}
                fullWidth
              >
                Refresh
              </Button>
            </Alert>
          ) : (
            <Stack spacing={1.25}>
              {scheduledRuns.map((run) => {
                const selected = selectedRunId === run.id;
                const when = formatScheduledFor(run.scheduledFor);
                return (
                  <Box
                    key={run.id}
                    onClick={() => setSelectedRunId(run.id)}
                    role="button"
                    sx={{
                      p: 1.5,
                      borderRadius: 2,
                      cursor: "pointer",
                      border: "2px solid",
                      borderColor: selected ? "primary.main" : "divider",
                      bgcolor: selected ? "action.selected" : "background.paper",
                      display: "flex",
                      flexDirection: "column",
                      gap: 0.5,
                    }}
                  >
                    <Stack direction="row" spacing={1} alignItems="flex-start">
                      <PlaceIcon fontSize="small" color={selected ? "primary" : "action"} sx={{ mt: 0.25 }} />
                      <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                        <Typography variant="body2" fontWeight={700} sx={{ wordBreak: "break-word" }}>
                          {run.deliveryAddress}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                          {when ? `${when} · ` : ""}Delivery #{run.deliveryNumber}
                          {run.customerName ? ` · ${run.customerName}` : ""}
                        </Typography>
                      </Box>
                    </Stack>
                    {!run.matchesAsset && (
                      <Stack direction="row" spacing={0.75} alignItems="center" sx={{ pl: 0.25 }}>
                        <WarningAmberIcon fontSize="small" color="warning" />
                        <Typography variant="caption" color="warning.main">
                          No matching item on this run. Your unit will be added as an extra.
                        </Typography>
                      </Stack>
                    )}
                  </Box>
                );
              })}
            </Stack>
          )}

          {error && <Alert severity="error">{error}</Alert>}

          {scheduledRuns.length > 0 && !runsLoading && (
            <Button
              variant="contained"
              onClick={doAssign}
              disabled={assigning || !selectedRunId}
              fullWidth
              sx={{ py: 1.5, fontSize: "1rem", minHeight: 48 }}
            >
              {assigning ? <CircularProgress size={20} color="inherit" /> : "Assign & continue"}
            </Button>
          )}
        </Box>
      </Box>
    );
  }

  // ── PHOTO STEP: the capture sequence gets the whole screen ──────────────
  if (phase === "photos") {
    const met = photos.length >= requiredPhotos;
    return (
      <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2, minHeight: "100vh" }}>
        <Typography variant="h6" fontWeight={700}>
          Condition photos
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {standalone
            ? `${requiredPhotos} photo${requiredPhotos === 1 ? "" : "s"} needed before this ${verb.toLowerCase()} can start.`
            : "Optional for this delivery."}
        </Typography>

        {/* Accessory returns get the static outbound strip; equipment returns
            compare per angle inside GuidedPhotoCapture. */}
        {isReturn && !(standalone && requiredPhotos > 1) && outboundPhotos.length > 0 && (
          <Box>
            <Typography variant="subtitle2" sx={{ mb: 0.25 }}>
              Delivered condition (for comparison)
            </Typography>
            <Stack direction="row" spacing={1} sx={{ overflowX: "auto", pb: 1 }}>
              {outboundPhotos.map((src, i) => (
                <Box
                  key={i}
                  component="img"
                  src={src}
                  alt=""
                  sx={{ width: 84, height: 84, flexShrink: 0, borderRadius: 1, objectFit: "cover", border: "1px solid", borderColor: "divider" }}
                />
              ))}
            </Stack>
          </Box>
        )}

        {standalone && requiredPhotos > 1 ? (
          <GuidedPhotoCapture
            photos={photos}
            onChange={setPhotos}
            upload={uploadDoStart}
            minPhotos={requiredPhotos}
            onError={(m) => setError(m || null)}
            onUploadingChange={setUploading}
            comparison={isReturn ? { photos: outboundPhotos, angles: outboundAngles } : undefined}
            damage={
              isReturn
                ? {
                    flags: photoDamaged,
                    comments: photoComments,
                    onChange: (flags, comments) => {
                      setPhotoDamaged(flags);
                      setPhotoComments(comments);
                    },
                  }
                : undefined
            }
          />
        ) : (
          <PhotoCaptureField
            label={standalone ? "Condition photos (required)" : "Condition photos (optional)"}
            photos={photos}
            onChange={setPhotos}
            upload={uploadDoStart}
            onError={(m) => setError(m || null)}
            onUploadingChange={setUploading}
          />
        )}

        {error && <Alert severity="error">{error}</Alert>}

        <Box sx={{ flexGrow: 1 }} />
        <Button
          variant="contained"
          onClick={() => {
            setError(null);
            setPhase("start");
          }}
          disabled={uploading}
          fullWidth
          sx={{ py: 1.5, fontSize: "1rem", minHeight: 48 }}
        >
          {uploading ? "Uploading…" : met ? "Done" : `Back (${photos.length} of ${requiredPhotos})`}
        </Button>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 3, alignItems: "center" }}>
      <LocalShippingIcon sx={{ fontSize: 80, color: "primary.main", mt: 4 }} />
      <Typography variant="h6" fontWeight={700} sx={{ textAlign: "center" }}>
        Start {verb}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ textAlign: "center", maxWidth: 360 }}>
        Confirm you&apos;re taking this equipment out for delivery. GPS tracking
        will begin and continue until you tap Acknowledge Delivery at the
        destination.
      </Typography>

      {standalone ? (
        <Box sx={{ p: 1.5, bgcolor: "action.hover", borderRadius: 1, minWidth: 280, textAlign: "center" }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
            New Delivery
          </Typography>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            No DO yet — the office links one later
          </Typography>
        </Box>
      ) : doName ? (
        <Box sx={{ p: 1.5, bgcolor: "action.hover", borderRadius: 1, minWidth: 280, textAlign: "center" }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
            Delivery Order
          </Typography>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {doName}
          </Typography>
        </Box>
      ) : null}

      {/* Return flow: the unit's original outbound condition photos, so the rider
          can compare before capturing the return condition below. For EQUIPMENT
          (guided) returns the comparison is per-angle inside GuidedPhotoCapture,
          so this static strip is shown only for the accessory (free-form) path. */}
      {isReturn && !(standalone && requiredPhotos > 1) && outboundPhotos.length > 0 && (
        <Box sx={{ width: "100%", maxWidth: 360 }}>
          <Typography variant="subtitle2" sx={{ mb: 0.25 }}>
            Delivered condition (for comparison)
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
            How this unit looked when it went out. Capture the return condition below.
          </Typography>
          <Stack direction="row" spacing={1} sx={{ overflowX: "auto", pb: 1 }}>
            {outboundPhotos.map((src, i) => (
              <Box
                key={i}
                component="img"
                src={src}
                alt=""
                sx={{ width: 84, height: 84, flexShrink: 0, borderRadius: 1, objectFit: "cover", border: "1px solid", borderColor: "divider" }}
              />
            ))}
          </Stack>
        </Box>
      )}

      {/* Photos live on their own screen (phase "photos"). This is just the
          entry point plus a progress summary. */}
      <Box sx={{ width: "100%", maxWidth: 360 }}>
        <Button
          variant={photos.length >= requiredPhotos ? "outlined" : "contained"}
          startIcon={photos.length >= requiredPhotos ? <CheckCircleIcon color="success" /> : <CameraAltIcon />}
          onClick={() => setPhase("photos")}
          disabled={submitting}
          fullWidth
          sx={{ py: 1.5, minHeight: 56, fontSize: "1rem" }}
        >
          {photos.length === 0
            ? standalone
              ? "Take Photos"
              : "Add Photos (optional)"
            : `Condition photos: ${photos.length} of ${requiredPhotos}`}
        </Button>
        {standalone && photos.length < requiredPhotos && (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5, textAlign: "center" }}>
            {requiredPhotos > 1
              ? "This unit is equipment, so it needs a full set of angles."
              : "One photo of the unit's condition is required."}
          </Typography>
        )}
      </Box>

      {/* Return flow: the unit-level damaged check, for the ACCESSORY (free-form)
          path only. Guided returns ask per angle inside GuidedPhotoCapture, so
          asking again here would be a second, contradictory answer.
          Recorded only; a damaged unit still returns to instock. */}
      {isReturn && !(standalone && requiredPhotos > 1) && (
        <Box sx={{ width: "100%", maxWidth: 360 }}>
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
            Damaged?
          </Typography>
          <Stack direction="row" spacing={1}>
            <Button
              variant={damaged === true ? "contained" : "outlined"}
              color={damaged === true ? "error" : "primary"}
              onClick={() => setDamaged(true)}
              fullWidth
              sx={{ minHeight: 44 }}
            >
              Yes
            </Button>
            <Button
              variant={damaged === false ? "contained" : "outlined"}
              onClick={() => setDamaged(false)}
              fullWidth
              sx={{ minHeight: 44 }}
            >
              No
            </Button>
          </Stack>
          <TextField
            label="Comment (optional)"
            placeholder="Note any damage or condition details"
            value={damageComment}
            onChange={(e) => setDamageComment(e.target.value)}
            fullWidth
            multiline
            minRows={2}
            size="small"
            sx={{ mt: 1.5 }}
          />
        </Box>
      )}

      {error && <Alert severity="error" sx={{ width: "100%", maxWidth: 360 }}>{error}</Alert>}

      <Stack direction="row" spacing={2} sx={{ mt: 2, width: "100%", maxWidth: 360 }}>
        <Button
          variant="outlined"
          onClick={() => router.back()}
          fullWidth
          disabled={submitting}
          sx={{ py: 1.5, px: 4, fontSize: "1rem", minHeight: 48 }}
        >
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={confirm}
          disabled={submitting || contextLoading || uploading || (!standalone && !doId) || (isReturn && !(standalone && requiredPhotos > 1) && damaged === null)}
          fullWidth
          sx={{ py: 1.5, px: 4, fontSize: "1rem", minHeight: 48 }}
        >
          {submitting ? <CircularProgress size={20} color="inherit" /> : uploading ? "Uploading…" : `Start ${verb}`}
        </Button>
      </Stack>
    </Box>
  );
}
