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
  List,
  ListItemButton,
  ListItemText,
  Stack,
  Typography,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import DrawIcon from "@mui/icons-material/Draw";
import { request } from "@/helpers/request";

/**
 * ONGOING REPORTS — maintenance reports awaiting a signature.
 *
 * These are reports the technician submitted with Skip because the person who
 * signs was not on site. They are complete in every other respect: numbered,
 * with all findings stored. Server-side they sit at `status: draft` and carry
 * no signature, the same shape a scheduled delivery uses to mean "real, but not
 * finished yet".
 *
 * Grouped by customer on purpose. The whole reason Skip exists is that a
 * technician works several machines for one client and the signatory appears
 * once at the end — so the list they need is "everything this client still owes
 * me a signature for", not a flat chronological feed.
 *
 * Follows the scheduled-deliveries list pattern: one fetch on mount, a plain
 * tap-through list, no filters.
 */

interface OngoingReport {
  id: string;
  reportNumber: number | null;
  createdAt: string;
  technicianName: string | null;
  serviceData: {
    customerName?: string | null;
    model?: string | null;
    serial?: string | null;
    serviceDate?: string | null;
    templateId?: string | null;
  } | null;
  asset: { name: string | null } | null;
  inventory: { sku: string | null } | null;
}

export default function OngoingReportsPage() {
  const router = useRouter();
  const { getToken } = useAuth();
  const [reports, setReports] = useState<OngoingReport[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const res = await request(
        { path: "/maintenance-reports?status=draft&limit=100", method: "GET" },
        {},
        token,
      );
      const docs = res?.docs ?? res?.data?.docs ?? res?.data ?? [];
      setReports(Array.isArray(docs) ? docs : []);
    } catch (e: any) {
      setError(e?.message ?? "Could not load reports awaiting signature");
      setReports([]);
    }
  }, [getToken]);

  useEffect(() => {
    void load();
  }, [load]);

  // Re-read on focus: the technician signs one, comes back, and the list must
  // not still show it.
  useEffect(() => {
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  // Customer first, newest first within each — see the docblock.
  const grouped = React.useMemo(() => {
    const by = new Map<string, OngoingReport[]>();
    for (const r of reports ?? []) {
      const key = r.serviceData?.customerName?.trim() || "Unknown customer";
      if (!by.has(key)) by.set(key, []);
      by.get(key)!.push(r);
    }
    Array.from(by.values()).forEach((list: OngoingReport[]) =>
      list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    );
    return Array.from(by.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [reports]);

  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2 }}>
      <Stack direction="row" alignItems="center" spacing={1}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => router.push("/scan")}>
          Back
        </Button>
      </Stack>

      <Box>
        <Typography variant="h6" fontWeight={700}>
          Ongoing reports
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Reports waiting for a signature. Tap one to sign it.
        </Typography>
      </Box>

      {error && <Alert severity="error">{error}</Alert>}

      {!reports ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
          <CircularProgress />
        </Box>
      ) : reports.length === 0 ? (
        <Alert severity="success">Nothing is waiting for a signature.</Alert>
      ) : (
        grouped.map(([customer, list]) => (
          <Box key={customer}>
            <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.5 }}>
              {customer}
              <Chip size="small" label={list.length} sx={{ ml: 1 }} />
            </Typography>
            <List dense sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 0 }}>
              {list.map((r: OngoingReport) => (
                <ListItemButton
                  key={r.id}
                  onClick={() => router.push(`/scan/reports/${r.id}/sign`)}
                  sx={{ minHeight: 64 }}
                >
                  <DrawIcon color="warning" sx={{ mr: 1.5 }} />
                  <ListItemText
                    primary={
                      <>
                        <strong>#{r.reportNumber ?? "—"}</strong>
                        {"  "}
                        {r.serviceData?.model || r.asset?.name || "Report"}
                      </>
                    }
                    secondary={[
                      r.serviceData?.serial || r.inventory?.sku,
                      r.serviceData?.serviceDate,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  />
                </ListItemButton>
              ))}
            </List>
          </Box>
        ))
      )}
    </Box>
  );
}
