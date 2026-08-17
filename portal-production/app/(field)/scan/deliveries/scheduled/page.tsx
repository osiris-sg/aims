"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Stack, Typography } from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import EventIcon from "@mui/icons-material/Event";
import { request } from "@/helpers/request";

/**
 * Rider "Scheduled deliveries" list (read-only). Org-wide scheduled runs waiting
 * for a rider to pick up — the rider claims one by SCANNING any unit whose asset
 * matches a scheduled item (which routes through the scan chooser's "Start
 * scheduled delivery" card). This screen is just the manifest of what's due.
 */

interface SchedItem {
  id: string;
  quantity: number | null;
  description: string | null;
  assetId: string | null;
  inventoryId: string | null;
}
interface SchedRun {
  id: string;
  deliveryNumber: number;
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
        <Typography variant="h6" fontWeight={700}>Scheduled deliveries</Typography>
      </Stack>
      <Typography variant="body2" color="text.secondary">
        Scan any unit of a scheduled product to pick up its delivery.
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
          // Show only still-open (unbound) scheduled slots — a bound item means
          // someone already started picking that unit up.
          const open = r.items.filter((i) => !i.inventoryId);
          return (
            <Card key={r.id} variant="outlined">
              <CardContent sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
                <Stack direction="row" alignItems="center" spacing={1}>
                  <Typography variant="subtitle2" fontWeight={700} sx={{ fontFamily: "monospace" }}>
                    #{r.deliveryNumber}
                  </Typography>
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
                <Stack spacing={0.25} sx={{ mt: 0.5 }}>
                  {(open.length ? open : r.items).map((i) => (
                    <Typography key={i.id} variant="body2">
                      • {i.description ?? "Item"}{i.quantity && i.quantity > 1 ? ` ×${i.quantity}` : ""}
                    </Typography>
                  ))}
                </Stack>
                {r.document?.id && r.items[0]?.assetId && (
                  <Button
                    size="small"
                    variant="text"
                    sx={{ alignSelf: "flex-start", textTransform: "none", mt: 0.5 }}
                    onClick={() => router.push(`/scan/asset/${r.items[0].assetId}/do/${r.document!.id}/view`)}
                  >
                    View full DO
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })
      )}
    </Box>
  );
}
