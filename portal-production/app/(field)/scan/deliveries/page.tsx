"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import {
  Alert,
  Box,
  Card,
  CardActionArea,
  CardContent,
  CircularProgress,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import LocalShippingIcon from "@mui/icons-material/LocalShipping";
import SearchIcon from "@mui/icons-material/Search";
import { RunSummary, fetchInProgressRuns, resolveInProgressHref, runMatchesSearch } from "../../lib/deliveryLists";
import { InProgressRunCard } from "../../components/DeliveryRunCards";

/**
 * Rider "resume unfinished deliveries" list (field). Runs the rider started
 * and left mid-flow — abandoned before ack (no customer/project yet) or
 * partway through. Row tap opens the basket (/scan/delivery/[id]) which
 * renders each item's own resume action; we deliberately never deep-link to a
 * specific step.
 *
 * Data: GET /deliveries?mine=true&unfinished=true — rider-scoped, status in
 * {in_progress, delivered}. Customer/project shown only when present (born-
 * linked DO-first runs have them; pre-ack standalone runs show items + date).
 */

export default function ResumeDeliveriesPage() {
  const router = useRouter();
  const { getToken } = useAuth();
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  // Row being opened — the list payload omits assetId/inventoryId/reports, so a
  // tap fetches the full run and resolves the exact step to drop into.
  const [opening, setOpening] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) {
        setError("Not signed in");
        return;
      }
      setRuns(await fetchInProgressRuns(token));
    } catch (e: any) {
      setError(e?.message ?? "Failed to load deliveries");
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    void load();
  }, [load]);

  // Tap → fetch the full run and route straight to the step the rider left off
  // at (resumeHref picks the first unfinished item; the target page's own
  // resolver handles any finer sub-step). Falls back to the basket on error.
  const openRun = useCallback(
    async (id: string) => {
      setOpening(id);
      try {
        const token = await getToken().catch(() => null);
        router.push(await resolveInProgressHref(id, token));
      } finally {
        setOpening(null);
      }
    },
    [getToken, router],
  );

  // Client-side filter over fetched rows (shared with the Deliveries home).
  const filtered = useMemo(() => runs.filter((r) => runMatchesSearch(r, q)), [runs, q]);

  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2 }}>
      <Stack direction="row" alignItems="center" spacing={1}>
        <LocalShippingIcon color="primary" />
        <Typography variant="h6" fontWeight={700}>Your deliveries in progress</Typography>
      </Stack>
      <Typography variant="body2" color="text.secondary">
        Runs you started and haven&apos;t finished. Tap one to pick up where you left off.
      </Typography>

      {!loading && runs.length > 3 && (
        <TextField
          size="small"
          placeholder="Search delivery # or unit serial"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          InputProps={{ startAdornment: <SearchIcon fontSize="small" sx={{ mr: 1, color: "text.disabled" }} /> }}
        />
      )}

      {error && <Alert severity="error">{error}</Alert>}

      {loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
          <CircularProgress />
        </Box>
      ) : runs.length === 0 ? (
        <Box sx={{ textAlign: "center", py: 6, color: "text.secondary" }}>
          <Typography variant="body1">Nothing in progress — you&apos;re all caught up.</Typography>
        </Box>
      ) : filtered.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: "center" }}>
          No delivery matches &quot;{q}&quot;.
        </Typography>
      ) : (
        <Stack spacing={1.5}>
          {filtered.map((r) => (
            <InProgressRunCard
              key={r.id}
              run={r}
              opening={opening === r.id}
              disabled={opening !== null}
              onOpen={() => void openRun(r.id)}
            />
          ))}
        </Stack>
      )}

      <Box sx={{ flexGrow: 1 }} />
      <Card variant="outlined" sx={{ borderStyle: "dashed" }}>
        <CardActionArea onClick={() => router.push("/scan")}>
          <CardContent sx={{ display: "flex", alignItems: "center", gap: 1.5, py: 1.5 }}>
            <ArrowBackIcon color="action" />
            <Typography variant="body2">Back</Typography>
          </CardContent>
        </CardActionArea>
      </Card>
    </Box>
  );
}
