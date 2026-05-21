"use client";

import React, { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { useTheme } from "@mui/material/styles";
import useMediaQuery from "@mui/material/useMediaQuery";
import dynamic from "next/dynamic";
import { request } from "@/helpers/request";

/**
 * Polls /maintenance-reports/:reportId/location-track every 10 s while the
 * delivery is active (no DO_ACK yet) and renders the route on a Leaflet map.
 * Polling stops automatically when isActive flips false.
 *
 * Shared between:
 *   - app/portal/projects/[id]/page.tsx          — "View Route" on Field Reports tab
 *   - containers/DocumentTemplates/components/TabbedDocumentCreator.tsx
 *                                                — "Show Route" on the DO editor header
 *
 * The reportId points at the DO_START MaintenanceServiceReport for the
 * delivery whose GPS pings populate the map.
 */

// Leaflet hits `window` at import time; client-side only.
const DeliveryRouteMap = dynamic(() => import("./DeliveryRouteMap"), {
  ssr: false,
  loading: () => (
    <Box sx={{ p: 6, display: "flex", justifyContent: "center" }}>
      <CircularProgress />
    </Box>
  ),
});

interface Props {
  reportId: string | null;
  open: boolean;
  onClose: () => void;
}

export default function DeliveryRouteDialog({ reportId, open, onClose }: Props) {
  const { getToken } = useAuth();
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down("sm"));
  const [track, setTrack] = useState<{
    isActive: boolean;
    pings: Array<{ id?: string; latitude: number; longitude: number; timestamp: string }>;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !reportId) {
      setTrack(null);
      setError(null);
      return;
    }
    let cancelled = false;

    const fetchTrack = async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const res = await request(
          { path: `/maintenance-reports/${reportId}/location-track`, method: "GET" },
          {},
          token,
        );
        if (cancelled) return;
        if (res?.success) {
          const payload = res.data;
          setTrack({
            isActive: !!payload?.isActive,
            pings: payload?.pings ?? [],
          });
        } else {
          setError(res?.message ?? "Failed to load delivery route");
        }
      } catch (err: any) {
        if (!cancelled) setError(err?.message ?? "Failed to load delivery route");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    setLoading(true);
    void fetchTrack();

    // Poll only while the delivery is still in progress. Once isActive
    // becomes false we stop — the route is final.
    const intervalId = window.setInterval(() => {
      if (cancelled) return;
      // Stop polling if we know the delivery has completed.
      if (track && !track.isActive) return;
      void fetchTrack();
    }, 10_000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
    // We intentionally don't depend on `track` — the effect would tear down
    // and re-create on every ping batch, defeating the polling cadence.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reportId, getToken]);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="lg" fullScreen={fullScreen}>
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1, pr: 1 }}>
        <Box sx={{ flex: 1 }}>
          Delivery route
          {track?.isActive && (
            <Chip size="small" color="info" label="Live" sx={{ ml: 1 }} />
          )}
        </Box>
        <IconButton onClick={onClose} size="small" aria-label="close">
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ p: 0 }}>
        {loading && !track && (
          <Box sx={{ p: 6, display: "flex", justifyContent: "center" }}>
            <CircularProgress />
          </Box>
        )}
        {error && !loading && (
          <Typography color="error" sx={{ py: 6, textAlign: "center" }}>
            {error}
          </Typography>
        )}
        {track && (
          <DeliveryRouteMap pings={track.pings} isActive={track.isActive} />
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
