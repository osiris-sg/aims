"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Stack, Typography } from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import EventIcon from "@mui/icons-material/Event";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import { request } from "@/helpers/request";

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

interface SchedItem {
  id: string;
  quantity: number | null;
  description: string | null;
  assetId: string | null;
  inventoryId: string | null;
  // Enriched by the list endpoint from the bound unit (null until one is
  // scanned in). An office-scheduled slot has an assetId but no unit yet.
  sku?: string | null;
}
interface SchedRun {
  id: string;
  deliveryNumber: number;
  direction?: "OUTBOUND" | "RETURN";
  scheduledFor: string | null;
  siteAddress: string | null;
  items: SchedItem[];
  project: { id: string; name: string } | null;
  customer: { id: string; name: string } | null;
  // The run's pre-created draft DO (PO number + a full-DO link target).
  document: { id: string; name: string | null; poNo: string | null } | null;
}

const fmt = (d: string | null) =>
  d ? new Date(d).toLocaleString("en-GB", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

export default function ScheduledDeliveriesPage() {
  const router = useRouter();
  const { getToken } = useAuth();
  const [runs, setRuns] = useState<SchedRun[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const token = await getToken();
        if (!token) throw new Error("Not signed in");
        const res = await request({ path: `/deliveries?status=scheduled&limit=100`, method: "GET" }, {}, token);
        if (res.success === false) throw new Error(res.message ?? "Failed to load scheduled deliveries");
        setRuns(((res.data ?? res).docs ?? []) as SchedRun[]);
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
        Back to scan
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
        (runs ?? []).map((r) => {
          const isReturn = r.direction === "RETURN";
          // Deliveries: show still-open (unbound) slots — a bound item means
          // someone already started picking it up. Returns are unit-bound from
          // birth, so their manifest IS the units to collect.
          const open = r.items.filter((i) => !i.inventoryId);
          const rows = isReturn ? r.items : open.length ? open : r.items;
          // OUTBOUND runs are enterable (claimScheduled binds by open asset slot).
          // Returns are not — see the header note — so their card stays inert.
          const enterable = !isReturn;
          return (
            <Card key={r.id} variant="outlined" sx={enterable ? { borderColor: "primary.main" } : undefined}>
              <CardContent sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
                <Stack direction="row" alignItems="center" spacing={1}>
                  <Typography variant="subtitle2" fontWeight={700} sx={{ fontFamily: "monospace" }}>
                    #{r.deliveryNumber}
                  </Typography>
                  <Chip size="small" color={isReturn ? "secondary" : "primary"} variant="outlined" label={isReturn ? "Return" : "Delivery"} />
                  <Chip size="small" color="primary" label={fmt(r.scheduledFor)} />
                </Stack>
                {(r.customer?.name || r.project?.name || r.siteAddress) && (
                  <Typography variant="body2" color="text.secondary">
                    {r.project?.name ?? r.customer?.name ?? r.siteAddress}
                  </Typography>
                )}
                {r.document?.poNo && (
                  <Typography variant="body2">
                    <b>PO No.:</b> {r.document.poNo}
                  </Typography>
                )}
                {isReturn && (
                  <Typography variant="caption" color="text.secondary">Collect:</Typography>
                )}
                <Stack spacing={0.25} sx={{ mt: 0.5 }}>
                  {rows.map((i) => {
                    // Same precedence the walk-through uses (description first,
                    // /scan/delivery/[deliveryId]). A unit-backed line shows its
                    // serial; an office slot that no unit has been scanned into
                    // yet says so rather than showing a blank or a dash.
                    const label = i.description || "Item";
                    const suffix = i.sku
                      ? ` — ${i.sku}`
                      : i.assetId && !i.inventoryId
                        ? " — unit not yet assigned"
                        : "";
                    return (
                      <Typography key={i.id} variant="body2">
                        • {label}
                        {i.quantity && i.quantity > 1 ? ` ×${i.quantity}` : ""}
                        {suffix && (
                          <Typography component="span" variant="body2" color="text.secondary">
                            {suffix}
                          </Typography>
                        )}
                      </Typography>
                    );
                  })}
                </Stack>
                <Stack direction="row" spacing={1} sx={{ mt: 0.5, flexWrap: "wrap", rowGap: 1 }}>
                  {/* Navigation only — the run is NOT claimed until the first
                      scan lands in claimScheduled. */}
                  {enterable && (
                    <Button
                      size="small"
                      variant="contained"
                      startIcon={<PlayArrowIcon />}
                      sx={{ textTransform: "none", minHeight: 40 }}
                      onClick={() => router.push(`/scan/delivery/${r.id}`)}
                    >
                      Start this delivery
                    </Button>
                  )}
                  {!isReturn && r.document?.id && r.items[0]?.assetId && (
                    <Button
                      size="small"
                      variant="text"
                      sx={{ textTransform: "none", minHeight: 40 }}
                      onClick={() => router.push(`/scan/asset/${r.items[0].assetId}/do/${r.document!.id}/view`)}
                    >
                      View full DO
                    </Button>
                  )}
                </Stack>
              </CardContent>
            </Card>
          );
        })
      )}
    </Box>
  );
}
