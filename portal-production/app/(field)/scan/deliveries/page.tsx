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
import LocalShippingIcon from "@mui/icons-material/LocalShipping";
import SearchIcon from "@mui/icons-material/Search";
import { request } from "@/helpers/request";

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

type RunStatus = "in_progress" | "delivered" | "completed" | "cancelled";

interface RunItem {
  id: string;
  deliveryStatus: "not_delivered" | "delivering" | "not_installed" | "completed";
  sku: string | null;
  serialNumber: string | null;
}

interface Run {
  id: string;
  deliveryNumber: number;
  status: RunStatus;
  riderName: string | null;
  siteAddress: string | null;
  startedAt: string;
  createdAt: string;
  items: RunItem[];
  document: { id: string; name: string | null } | null;
  project: { id: string; name: string } | null;
  customer: { id: string; name: string } | null;
}

const STATUS_CHIP: Record<RunStatus, { label: string; color: "warning" | "info" | "success" | "default" }> = {
  in_progress: { label: "In progress", color: "warning" },
  delivered: { label: "Delivered", color: "info" },
  completed: { label: "Completed", color: "success" },
  cancelled: { label: "Cancelled", color: "default" },
};

// Compact relative time — riders scan the same day, so "2h ago" beats a date.
const relTime = (iso: string): string => {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const mins = Math.max(0, Math.round((now - then) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
};

// "LION375-001 +2" — first unit sku (fallback serial), then a remainder count.
const itemLabel = (items: RunItem[]): string => {
  if (items.length === 0) return "No items";
  const first = items[0].sku ?? items[0].serialNumber ?? "1 item";
  return items.length > 1 ? `${first} +${items.length - 1}` : first;
};

const progressHint = (items: RunItem[]): string => {
  const done = items.filter((i) => i.deliveryStatus === "completed").length;
  return `${done} of ${items.length} delivered`;
};

export default function ResumeDeliveriesPage() {
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
        { path: `/deliveries?mine=true&unfinished=true&limit=100`, method: "GET" },
        {},
        token,
      );
      if (res.success === false) throw new Error(res.message ?? "Failed to load deliveries");
      setRuns((res.data ?? res).docs ?? []);
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
          {filtered.map((r) => {
            const chip = STATUS_CHIP[r.status] ?? { label: r.status, color: "default" as const };
            // Customer/project only when present — pre-ack standalone runs have
            // neither, so the item label + time carry the identity instead.
            const context = r.project?.name ?? r.customer?.name ?? r.document?.name ?? null;
            return (
              <Card key={r.id} variant="outlined">
                <CardActionArea onClick={() => router.push(`/scan/delivery/${r.id}`)}>
                  <CardContent sx={{ py: 1.75 }}>
                    <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                      <Typography variant="subtitle1" fontWeight={700} sx={{ fontFamily: "monospace" }}>
                        #{r.deliveryNumber}
                      </Typography>
                      <Chip size="small" label={chip.label} color={chip.color} />
                      <Box sx={{ flexGrow: 1 }} />
                      <Typography variant="caption" color="text.secondary">
                        {relTime(r.startedAt ?? r.createdAt)}
                      </Typography>
                    </Stack>
                    <Typography variant="body2" fontWeight={600} noWrap>
                      {itemLabel(r.items)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" display="block">
                      {progressHint(r.items)}
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
