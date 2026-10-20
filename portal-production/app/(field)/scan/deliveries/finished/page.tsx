"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { Alert, Box, CircularProgress, Stack, TextField, Typography } from "@mui/material";
import PrintIcon from "@mui/icons-material/Print";
import SearchIcon from "@mui/icons-material/Search";
import SearchOffIcon from "@mui/icons-material/SearchOff";
import { RunSummary, fetchCompletedRuns, runMatchesSearch } from "../../../lib/deliveryLists";
import { CompletedRunCard } from "../../../components/DeliveryRunCards";
import FieldBackButton from "../../../components/FieldBackButton";
import { useFieldAppBar } from "@/app/(field)/components/FieldAppBar";
import { EmptyState } from "@/app/(field)/components/fieldUi";

/**
 * Rider "finished deliveries — reprint" list (field). The rider's own COMPLETED
 * runs from the last 7 days, so a receipt can be reprinted after the fact (paper
 * lost, smudged, a second copy for the office). Row tap opens a read-only detail
 * view (/scan/deliveries/finished/[id]) with a REPRINT button.
 *
 * Data: GET /deliveries?mine=true&status=completed — rider-scoped, terminal
 * runs only. The 7-day window is a client-side DISPLAY filter (nothing is
 * deleted); older completed runs still exist, they're just not listed here.
 */

export default function FinishedDeliveriesPage() {
  const router = useRouter();
  const { getToken } = useAuth();
  useFieldAppBar({ title: "Reprint a delivery" });
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) {
        setError("Not signed in");
        return;
      }
      // 7-day window applied inside fetchCompletedRuns (display filter): the
      // endpoint returns all completed runs; we only list recent ones for reprint.
      setRuns(await fetchCompletedRuns(token));
    } catch (e: any) {
      setError(e?.message ?? "Failed to load deliveries");
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    void load();
  }, [load]);

  // Client-side filter over fetched rows (shared with the Deliveries home).
  const filtered = useMemo(() => runs.filter((r) => runMatchesSearch(r, q)), [runs, q]);

  return (
    <Box sx={{ p: 2, display: "flex", flexDirection: "column", gap: 2 }}>
      <Typography variant="body2" color="text.secondary">
        Deliveries you completed in the last 7 days. Tap one to view it and reprint the receipt.
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
        <EmptyState icon={<PrintIcon />} message="No deliveries completed in the last 7 days." />
      ) : filtered.length === 0 ? (
        <EmptyState icon={<SearchOffIcon />} message={<>No delivery matches &quot;{q}&quot;.</>} />
      ) : (
        <Stack spacing={1.5}>
          {filtered.map((r) => (
            <CompletedRunCard key={r.id} run={r} onOpen={() => router.push(`/scan/deliveries/finished/${r.id}`)} />
          ))}
        </Stack>
      )}

      <Box sx={{ flexGrow: 1 }} />
      {/* Same target as before (router.push("/scan")), in the shared bottom Back. */}
      <FieldBackButton to="/scan" />
    </Box>
  );
}
