"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  Typography,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import QrCodeScannerIcon from "@mui/icons-material/QrCodeScanner";
import DrawIcon from "@mui/icons-material/Draw";
import { request } from "@/helpers/request";

/**
 * MAINTENANCE REPORTS — the landing screen.
 *
 * BOTH, deliberately: a way to start a new report AND the recent completed
 * ones. The technician arriving here has one of exactly two errands — begin
 * work on a machine, or look up what was done last time — and splitting those
 * across two screens would make the common case a two-tap hunt for no gain.
 *
 * "Start a new report" routes through the SERIAL PICKER rather than straight
 * into the form, because a report is always about a specific unit: the form
 * needs an assetId and an inventoryId, and the picker is the existing,
 * NFC-or-type-it way of naming one. That keeps a single entry point to the
 * form rather than a second, subtly different one.
 *
 * Reports still awaiting a signature live on their own screen (Ongoing
 * reports) and are only summarised here — they are a different job, with a
 * different urgency.
 */

interface ReportRow {
  id: string;
  reportNumber: number | null;
  status: string;
  createdAt: string;
  serviceData: {
    customerName?: string | null;
    model?: string | null;
    serial?: string | null;
    serviceDate?: string | null;
  } | null;
  asset: { name: string | null } | null;
  inventory: { sku: string | null } | null;
}

export default function MaintenanceReportsPage() {
  const router = useRouter();
  const { getToken } = useAuth();
  const [done, setDone] = useState<ReportRow[] | null>(null);
  const [ongoingCount, setOngoingCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const [completed, draft] = await Promise.all([
        request({ path: "/maintenance-reports?status=completed&limit=25", method: "GET" }, {}, token),
        request({ path: "/maintenance-reports?status=draft&limit=1", method: "GET" }, {}, token),
      ]);
      const docs = completed?.docs ?? completed?.data?.docs ?? completed?.data ?? [];
      setDone(Array.isArray(docs) ? docs : []);
      const t = draft?.total ?? draft?.data?.total ?? 0;
      setOngoingCount(Number(t) || 0);
    } catch (e: any) {
      setError(e?.message ?? "Could not load maintenance reports");
      setDone([]);
    }
  }, [getToken]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2 }}>
      <Stack direction="row" alignItems="center" spacing={1}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => router.push("/scan")}>
          Back
        </Button>
      </Stack>

      <Typography variant="h6" fontWeight={700}>
        Maintenance reports
      </Typography>

      <Button
        variant="contained"
        size="large"
        startIcon={<QrCodeScannerIcon />}
        onClick={() => router.push("/scan/manual")}
        fullWidth
        sx={{ minHeight: 56 }}
      >
        Start a new report
      </Button>
      <Typography variant="caption" color="text.secondary" sx={{ mt: -1 }}>
        Scan or pick the machine first — a report is always about one unit.
      </Typography>

      {ongoingCount > 0 && (
        <Button
          variant="outlined"
          color="warning"
          size="large"
          startIcon={<DrawIcon />}
          onClick={() => router.push("/scan/reports/ongoing")}
          fullWidth
          sx={{ minHeight: 52 }}
        >
          {ongoingCount} awaiting signature
        </Button>
      )}

      <Divider />

      <Typography variant="subtitle2" fontWeight={700}>
        Recently completed
      </Typography>

      {error && <Alert severity="error">{error}</Alert>}

      {!done ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
          <CircularProgress />
        </Box>
      ) : done.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No completed reports yet.
        </Typography>
      ) : (
        <List dense sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 0 }}>
          {done.map((r: ReportRow) => (
            <ListItemButton
              key={r.id}
              onClick={() => router.push(`/scan/reports/${r.id}/print`)}
              sx={{ minHeight: 64 }}
            >
              <ListItemText
                primary={
                  <>
                    <strong>#{r.reportNumber ?? "—"}</strong>{"  "}
                    {r.serviceData?.customerName || "—"}
                  </>
                }
                secondary={[
                  r.serviceData?.model || r.asset?.name,
                  r.serviceData?.serial || r.inventory?.sku,
                  r.serviceData?.serviceDate,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              />
              <Chip size="small" label="Signed" color="success" variant="outlined" />
            </ListItemButton>
          ))}
        </List>
      )}
    </Box>
  );
}
