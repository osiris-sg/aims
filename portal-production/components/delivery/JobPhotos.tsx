"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import React, { useCallback, useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, Stack, Typography } from "@mui/material";
import { request } from "@/helpers/request";
import { useUserPermissions } from "@/app/portal/hooks/useUserPermissions";
import { JobPhoto, OrderJobGroup, TAG_COLOR, jobHeading, photoCaption, urlsStale } from "@/helpers/jobPhotos";

/**
 * Job photos from SiteClock (WCT 2026-11-02, orgs with the SiteClock link):
 * the photos workers took on the job in the SiteClock app, sent to AIMS by
 * SiteClock. DeliveryJobPhotos sits on the delivery (job) page, OrderJobPhotos
 * on the order page (grouped by job). Click opens the full view with Download;
 * admins (documents:update) can Hide one (kept and logged, hidden in AIMS only).
 * The image URLs are presigned for 15 minutes, so the list is fetched again
 * before a view opens once they are close to lapsing.
 */

async function fetchJson(getToken: () => Promise<string | null>, path: string, method: "GET" | "POST" = "GET") {
  const token = await getToken();
  if (!token) throw new Error("Not signed in");
  const res: any = await request({ path, method }, {}, token);
  if (res?.success === false) {
    const m = res?.details?.message ?? res?.message;
    throw new Error((Array.isArray(m) ? m.join(". ") : m) || "Request failed");
  }
  return res?.success === true && "data" in res ? res.data : res;
}

function useCanHide() {
  const { hasPermission, userRoles } = useUserPermissions();
  return hasPermission("documents", "update") || userRoles.length === 0;
}

export function JobPhotoStrip({ photos, onOpen }: { photos: JobPhoto[]; onOpen: (p: JobPhoto) => void }) {
  return (
    <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
      {photos.map((p) => (
        <Box key={p.id} sx={{ width: 132 }}>
          <Box
            component="button"
            type="button"
            onClick={() => onOpen(p)}
            sx={{ p: 0, border: 1, borderColor: "divider", borderRadius: 1, overflow: "hidden", cursor: "pointer", display: "block", width: 132, height: 132, bgcolor: "action.hover" }}
          >
            <Box component="img" src={p.thumbUrl} alt={p.tagLabel} loading="lazy" sx={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          </Box>
          <Chip size="small" color={TAG_COLOR[p.tag] ?? "default"} label={p.tagLabel} sx={{ mt: 0.5, maxWidth: "100%" }} />
          <Typography variant="caption" color="text.secondary" component="div" sx={{ lineHeight: 1.3, mt: 0.25 }}>
            {photoCaption(p)}
          </Typography>
        </Box>
      ))}
    </Stack>
  );
}

function PhotoViewer({ photo, canHide, onClose, onHidden }: { photo: JobPhoto | null; canHide: boolean; onClose: () => void; onHidden: () => void }) {
  const { getToken } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setError(null), [photo?.id]);
  const hide = async () => {
    if (!photo || !window.confirm("Hide this photo? It stays stored and the hide is logged, but it no longer shows in AIMS (SiteClock keeps its copy).")) return;
    setBusy(true);
    try {
      await fetchJson(getToken, `/job-photos/${photo.id}/hide`, "POST");
      onHidden();
    } catch (e: any) {
      setError(e?.message || "Could not hide the photo");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={!!photo} onClose={onClose} maxWidth="lg" fullWidth>
      {photo && (
        <>
          <DialogContent sx={{ p: 1.5 }}>
            <Box component="img" src={photo.url} alt={photo.tagLabel} sx={{ width: "100%", maxHeight: "75vh", objectFit: "contain", display: "block", bgcolor: "action.hover", borderRadius: 1 }} />
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mt: 1.5 }}>
              <Chip size="small" color={TAG_COLOR[photo.tag] ?? "default"} label={photo.tagLabel} />
              <Typography variant="body2" color="text.secondary">
                {photoCaption(photo)} · from SiteClock
              </Typography>
            </Stack>
            {photo.note && (
              <Typography variant="body2" sx={{ mt: 1 }}>
                Note: {photo.note}
              </Typography>
            )}
            {error && (
              <Alert severity="warning" sx={{ mt: 1 }}>
                {error}
              </Alert>
            )}
          </DialogContent>
          <DialogActions>
            {canHide && (
              <Button color="error" onClick={hide} disabled={busy} sx={{ mr: "auto" }}>
                Hide
              </Button>
            )}
            <Button component="a" href={photo.downloadUrl}>
              Download
            </Button>
            <Button variant="contained" onClick={onClose}>
              Close
            </Button>
          </DialogActions>
        </>
      )}
    </Dialog>
  );
}

/** Opens a photo, fetching fresh URLs first when they are about to lapse. */
function useViewer(photos: JobPhoto[], reload: () => Promise<JobPhoto[]>) {
  const [open, setOpen] = useState<JobPhoto | null>(null);
  const openPhoto = async (p: JobPhoto) => {
    if (!urlsStale(photos)) return setOpen(p);
    const fresh = await reload();
    setOpen(fresh.find((x) => x.id === p.id) ?? null);
  };
  return { open, setOpen, openPhoto };
}

export function DeliveryJobPhotos({ deliveryId }: { deliveryId: string }) {
  const { getToken } = useAuth();
  const canHide = useCanHide();
  const [data, setData] = useState<{ enabled: boolean; photos: JobPhoto[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async (): Promise<JobPhoto[]> => {
    try {
      const d = await fetchJson(getToken, `/deliveries/${deliveryId}/job-photos`);
      setData(d);
      setError(null);
      return d?.photos ?? [];
    } catch (e: any) {
      setError(e?.message || "Could not load the job photos");
      return [];
    }
  }, [getToken, deliveryId]);
  useEffect(() => {
    void load();
  }, [load]);
  const photos = data?.photos ?? [];
  const { open, setOpen, openPhoto } = useViewer(photos, load);
  if (!data?.enabled && !error) return null;
  return (
    <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1.5, p: 2 }} data-tour="job-photos">
      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
        Job photos (SiteClock)
      </Typography>
      {error && <Alert severity="warning">{error}</Alert>}
      {!error && !photos.length && (
        <Typography variant="body2" color="text.secondary">
          No photos yet. Photos the worker takes on this job in SiteClock show here.
        </Typography>
      )}
      {photos.length > 0 && <JobPhotoStrip photos={photos} onOpen={(p) => void openPhoto(p)} />}
      <PhotoViewer photo={open} canHide={canHide} onClose={() => setOpen(null)} onHidden={() => { setOpen(null); void load(); }} />
    </Box>
  );
}

export function OrderJobPhotos({ orderId, onUnavailable }: { orderId: string; onUnavailable?: () => void }) {
  const { getToken } = useAuth();
  const canHide = useCanHide();
  const [data, setData] = useState<{ enabled: boolean; jobs: OrderJobGroup[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async (): Promise<JobPhoto[]> => {
    try {
      const d = await fetchJson(getToken, `/orders/${orderId}/job-photos`);
      setData(d);
      setError(null);
      return (d?.jobs ?? []).flatMap((j: OrderJobGroup) => j.photos);
    } catch (e: any) {
      setError(e?.message || "Could not load the photos");
      return [];
    }
  }, [getToken, orderId]);
  useEffect(() => {
    void load();
  }, [load]);
  const jobs = data?.jobs ?? [];
  const all = jobs.flatMap((j) => j.photos);
  const { open, setOpen, openPhoto } = useViewer(all, load);
  const unavailable = !!data && !data.enabled;
  useEffect(() => {
    if (unavailable) onUnavailable?.();
  }, [unavailable, onUnavailable]);
  if (!data && !error) return <CircularProgress size={20} />;
  if (!data?.enabled && !error) return null;
  return (
    <Box data-tour="order-photos">
      {error && <Alert severity="warning">{error}</Alert>}
      {!error && !jobs.length && (
        <Typography variant="body2" color="text.secondary">
          No jobs yet.
        </Typography>
      )}
      <Stack spacing={2}>
        {jobs.map((j) => (
          <Box key={j.deliveryId}>
            <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.75 }}>
              {jobHeading(j)}
            </Typography>
            {j.photos.length ? (
              <JobPhotoStrip photos={j.photos} onOpen={(p) => void openPhoto(p)} />
            ) : (
              <Typography variant="body2" color="text.secondary">
                No photos yet.
              </Typography>
            )}
          </Box>
        ))}
      </Stack>
      <PhotoViewer photo={open} canHide={canHide} onClose={() => setOpen(null)} onHidden={() => { setOpen(null); void load(); }} />
    </Box>
  );
}
