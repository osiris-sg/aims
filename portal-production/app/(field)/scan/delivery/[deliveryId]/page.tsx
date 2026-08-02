"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Stack, Typography } from "@mui/material";
import LocalShippingIcon from "@mui/icons-material/LocalShipping";
import QrCodeScannerIcon from "@mui/icons-material/QrCodeScanner";
import HandymanIcon from "@mui/icons-material/Handyman";
import { request } from "@/helpers/request";

/**
 * Standalone-delivery BASKET (Layer 3). The rider's view of an in-progress
 * Delivery run: every item with its status, per-item Ack / Install actions
 * (routing into the delivery ack/install pages → the shared sign flow), and
 * "Scan another unit" (→ /scan; the action chooser shows "Add to Delivery #N"
 * for the rider's open run and surfaces reservation 400s cleanly).
 *
 * Commerce-free by design: no prices, no stock — this is the physical run.
 * The office links/creates the DO later from the Deliveries queue.
 */

type ItemStatus = "not_delivered" | "delivering" | "not_installed" | "completed";

interface RunItem {
  id: string;
  assetId: string;
  inventoryId: string | null;
  description: string | null;
  quantity: number;
  deliveryStatus: ItemStatus;
  installSkipped: boolean;
  inventory: { id: string; sku: string; serialNumber: string | null; status: string } | null;
  asset: { id: string; name: string; skuKey: string } | null;
}

interface Run {
  id: string;
  deliveryNumber: number;
  status: "in_progress" | "delivered" | "completed" | "cancelled";
  riderName: string | null;
  siteAddress: string | null;
  startedAt: string;
  document: { id: string; name: string | null } | null;
  items: RunItem[];
}

const STATUS_CHIP: Record<ItemStatus, { label: string; color: "default" | "warning" | "info" | "success" }> = {
  not_delivered: { label: "Not delivered", color: "default" },
  delivering: { label: "Delivering", color: "warning" },
  not_installed: { label: "Delivered", color: "info" },
  completed: { label: "Completed", color: "success" },
};

const RUN_STATUS_LABEL: Record<Run["status"], string> = {
  in_progress: "In progress",
  delivered: "Delivered — awaiting installation",
  completed: "Completed",
  cancelled: "Cancelled",
};

export default function DeliveryBasketPage() {
  const params = useParams();
  const router = useRouter();
  const { getToken } = useAuth();
  const deliveryId = params?.deliveryId as string;
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) {
        setError("Not signed in");
        return;
      }
      const res = await request({ path: `/deliveries/${deliveryId}`, method: "GET" }, {}, token);
      if (res.success === false) setError(res.message ?? "Delivery not found");
      else setRun(res.data ?? res);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load delivery");
    } finally {
      setLoading(false);
    }
  }, [deliveryId, getToken]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <Box sx={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", minHeight: "60vh" }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error || !run) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{error ?? "Could not load delivery"}</Alert>
        <Button sx={{ mt: 2 }} onClick={() => router.push("/scan")}>Back to scan</Button>
      </Box>
    );
  }

  // Per-item route into the ack/install twins. The shared sign page needs the
  // ASSET id (its routes live under /scan/asset/[assetId]) — carried as query.
  const ackHref = (it: RunItem) =>
    `/scan/delivery/${run.id}/ack?assetId=${encodeURIComponent(it.assetId)}${it.inventoryId ? `&inventoryId=${encodeURIComponent(it.inventoryId)}` : ""}`;
  const installHref = (it: RunItem) =>
    `/scan/delivery/${run.id}/install?assetId=${encodeURIComponent(it.assetId)}${it.inventoryId ? `&inventoryId=${encodeURIComponent(it.inventoryId)}` : ""}`;

  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2.5 }}>
      <Stack direction="row" spacing={2} alignItems="center">
        <LocalShippingIcon color="primary" sx={{ fontSize: 44 }} />
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="h6" fontWeight={700}>Delivery #{run.deliveryNumber}</Typography>
          <Typography variant="body2" color="text.secondary">
            {RUN_STATUS_LABEL[run.status]}
            {run.document ? ` · DO ${run.document.name ?? ""}` : " · no DO yet"}
          </Typography>
        </Box>
      </Stack>

      <Typography variant="subtitle1" fontWeight={600}>
        Items ({run.items.length})
      </Typography>
      <Stack spacing={1}>
        {run.items.map((it) => {
          const chip = STATUS_CHIP[it.deliveryStatus] ?? { label: it.deliveryStatus, color: "default" as const };
          return (
            <Card key={it.id} variant="outlined">
              <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
                <Stack direction="row" alignItems="center" spacing={1}>
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography variant="body2" fontWeight={600} noWrap>
                      {it.description || it.asset?.name || it.inventory?.sku || "Item"}
                    </Typography>
                    {it.inventory?.sku && (
                      <Typography variant="caption" color="text.secondary" noWrap display="block">
                        {it.inventory.sku}
                      </Typography>
                    )}
                  </Box>
                  <Chip size="small" label={chip.label} color={chip.color} />
                </Stack>
                {(it.deliveryStatus === "delivering" || it.deliveryStatus === "not_installed") && (
                  <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
                    {it.deliveryStatus === "delivering" && (
                      <Button
                        size="small"
                        variant="contained"
                        startIcon={<LocalShippingIcon />}
                        onClick={() => router.push(ackHref(it))}
                        sx={{ minHeight: 40 }}
                      >
                        Acknowledge
                      </Button>
                    )}
                    {it.deliveryStatus === "not_installed" && (
                      <Button
                        size="small"
                        variant="contained"
                        startIcon={<HandymanIcon />}
                        onClick={() => router.push(installHref(it))}
                        sx={{ minHeight: 40 }}
                      >
                        Complete installation
                      </Button>
                    )}
                  </Stack>
                )}
              </CardContent>
            </Card>
          );
        })}
      </Stack>

      {run.status === "in_progress" && (
        <Button
          variant="outlined"
          size="large"
          startIcon={<QrCodeScannerIcon />}
          onClick={() => router.push("/scan")}
          sx={{ py: 1.5, minHeight: 48 }}
        >
          Scan another unit
        </Button>
      )}
      <Typography variant="caption" color="text.secondary" sx={{ textAlign: "center" }}>
        Tap a unit&apos;s tag (or use manual entry) — the asset screen will offer
        &quot;Add to Delivery #{run.deliveryNumber}&quot;.
      </Typography>

      <Button
        variant="text"
        sx={{ mt: 2, color: "text.secondary", alignSelf: "center" }}
        onClick={() => router.push("/scan")}
      >
        Done for now
      </Button>
    </Box>
  );
}
