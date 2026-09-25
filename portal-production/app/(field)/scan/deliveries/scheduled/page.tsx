"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { Alert, Box, Button, Card, CardContent, CircularProgress, Stack, Typography } from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import EventIcon from "@mui/icons-material/Event";
import { RunSummary, fetchScheduledRuns } from "../../../lib/deliveryLists";
import { ScheduledRunCard } from "../../../components/DeliveryRunCards";

/**
 * Rider "Scheduled deliveries" list. Org-wide scheduled runs waiting to be
 * fulfilled, and the RUN-FIRST entry point into a delivery.
 *
 * Two ways into the same walk-through, both supported:
 *   scan-first  — start any matching unit as a normal delivery and pick its run
 *                 from the assign step; the backend merges it in. Unchanged.
 *   run-first   — tap an OUTBOUND run here to open its walk-through, then scan
 *                 item 1, item 2, … (this screen).
 *
 * Tapping a run is READ-ONLY NAVIGATION. It does NOT claim the run: both
 * binders require status === 'scheduled', so claiming here would make the
 * rider's first scan fail that guard. The claim (scheduled → in_progress,
 * rider + startedAt) still happens on the FIRST successful scan, inside
 * claimScheduled — so a rider who opens this and walks away locks nothing.
 *
 * RETURN runs stay informational: their slots are unit-bound from birth, so
 * claimScheduled finds no open asset slot and reserveUnit would reject a
 * rental unit. A return still joins its run automatically when the rider
 * scans the unit (join-on-scan in deliveries create()).
 */

export default function ScheduledDeliveriesPage() {
  const router = useRouter();
  const { getToken } = useAuth();
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const token = await getToken();
        if (!token) throw new Error("Not signed in");
        setRuns(await fetchScheduledRuns(token));
      } catch (e: any) {
        setError(e?.message ?? "Failed to load scheduled deliveries");
      }
    })();
  }, [getToken]);

  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2 }}>
      <Button
        startIcon={<ArrowBackIcon />}
        size="small"
        onClick={() => router.replace("/scan")}
        sx={{ alignSelf: "flex-start", color: "text.secondary" }}
      >
        Back
      </Button>
      <Stack direction="row" alignItems="center" spacing={1}>
        <EventIcon color="primary" />
        <Typography variant="h6" fontWeight={700}>Scheduled</Typography>
      </Stack>
      <Typography variant="body2" color="text.secondary">
        Tap a delivery to open it, then scan the units one at a time. Or start any matching unit from the scan page as usual — a delivery is matched to its run by the project you assign, a return by the unit you scan.
      </Typography>

      {error && <Alert severity="error">{error}</Alert>}

      {runs === null && !error ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
          <CircularProgress />
        </Box>
      ) : runs && runs.length === 0 ? (
        <Card variant="outlined">
          <CardContent>
            <Typography variant="body2" color="text.secondary">Nothing scheduled right now.</Typography>
          </CardContent>
        </Card>
      ) : (
        (runs ?? []).map((r) => (
          <ScheduledRunCard
            key={r.id}
            run={r}
            onStart={() => router.push(`/scan/delivery/${r.id}`)}
            onViewDo={(assetId, docId) => router.push(`/scan/asset/${assetId}/do/${docId}/view`)}
          />
        ))
      )}
    </Box>
  );
}
