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
  Chip,
  CircularProgress,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import PrintIcon from "@mui/icons-material/Print";
import SearchIcon from "@mui/icons-material/Search";
import { request } from "@/helpers/request";

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

interface RunItem {
  id: string;
  deliveryStatus: "not_delivered" | "delivering" | "not_installed" | "completed";
  sku: string | null;
  serialNumber: string | null;
}

interface Run {
  id: string;
  deliveryNumber: number;
  status: string;
  riderName: string | null;
  siteAddress: string | null;
  completedAt: string | null;
  startedAt: string;
  createdAt: string;
  items: RunItem[];
  document: { id: string; name: string | null } | null;
  project: { id: string; name: string } | null;
  customer: { id: string; name: string } | null;
}

// 7-day display window — the run's completion time (fallback createdAt for any
// historic completed row that predates completedAt stamping).
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const runTime = (r: Run): number => new Date(r.completedAt ?? r.createdAt).getTime();

// Compact relative time — same idiom as the resume list.
const relTime = (ms: number): string => {
  const mins = Math.max(0, Math.round((Date.now() - ms) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ms).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
};

// "LION375-001 +2" — first unit sku (fallback serial), then a remainder count.
const itemLabel = (items: RunItem[]): string => {
  if (items.length === 0) return "No items";
  const first = items[0].sku ?? items[0].serialNumber ?? "1 item";
  return items.length > 1 ? `${first} +${items.length - 1}` : first;
};

export default function FinishedDeliveriesPage() {
  const router = useRouter();
  const { getToken } = useAuth();
  const [runs, setRuns] = useState<Run[]>([]);
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
      const res = await request(
        { path: `/deliveries?mine=true&status=completed&limit=100`, method: "GET" },
        {},
        token,
      );
      if (res.success === false) throw new Error(res.message ?? "Failed to load deliveries");
      // 7-day window applied here (display filter) — the endpoint returns all
      // completed runs; we only list recent ones for reprint.
      const all: Run[] = (res.data ?? res).docs ?? [];
      const now = Date.now();
      setRuns(all.filter((r) => now - runTime(r) <= WINDOW_MS));
    } catch (e: any) {
      setError(e?.message ?? "Failed to load deliveries");
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    void load();
  }, [load]);

  // Client-side filter over fetched rows: delivery number OR item sku/serial.
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return runs;
    return runs.filter((r) => {
      if (`#${r.deliveryNumber}`.includes(term) || String(r.deliveryNumber).includes(term)) return true;
      return r.items.some(
        (i) =>
          (i.sku && i.sku.toLowerCase().includes(term)) ||
          (i.serialNumber && i.serialNumber.toLowerCase().includes(term)),
      );
    });
  }, [runs, q]);

  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2 }}>
      <Stack direction="row" alignItems="center" spacing={1}>
        <PrintIcon color="primary" />
        <Typography variant="h6" fontWeight={700}>Reprint a delivery</Typography>
      </Stack>
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
        <Box sx={{ textAlign: "center", py: 6, color: "text.secondary" }}>
          <Typography variant="body1">No deliveries completed in the last 7 days.</Typography>
        </Box>
      ) : filtered.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: "center" }}>
          No delivery matches &quot;{q}&quot;.
        </Typography>
      ) : (
        <Stack spacing={1.5}>
          {filtered.map((r) => {
            const context = r.project?.name ?? r.customer?.name ?? r.document?.name ?? null;
            return (
              <Card key={r.id} variant="outlined">
                <CardActionArea onClick={() => router.push(`/scan/deliveries/finished/${r.id}`)}>
                  <CardContent sx={{ py: 1.75 }}>
                    <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                      <Typography variant="subtitle1" fontWeight={700} sx={{ fontFamily: "monospace" }}>
                        #{r.deliveryNumber}
                      </Typography>
                      <Chip size="small" label="Completed" color="success" />
                      <Box sx={{ flexGrow: 1 }} />
                      <Typography variant="caption" color="text.secondary">
                        {relTime(runTime(r))}
                      </Typography>
                    </Stack>
                    <Typography variant="body2" fontWeight={600} noWrap>
                      {itemLabel(r.items)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" display="block">
                      {r.items.length} item{r.items.length === 1 ? "" : "s"}
                      {context ? ` · ${context}` : ""}
                    </Typography>
                  </CardContent>
                </CardActionArea>
              </Card>
            );
          })}
        </Stack>
      )}

      <Box sx={{ flexGrow: 1 }} />
      <Card variant="outlined" sx={{ borderStyle: "dashed" }}>
        <CardActionArea onClick={() => router.push("/scan")}>
          <CardContent sx={{ display: "flex", alignItems: "center", gap: 1.5, py: 1.5 }}>
            <ArrowBackIcon color="action" />
            <Typography variant="body2">Back to scan</Typography>
          </CardContent>
        </CardActionArea>
      </Card>
    </Box>
  );
}
