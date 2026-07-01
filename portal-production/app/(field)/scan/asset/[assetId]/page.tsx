"use client";

import React, { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { Avatar, Box, Button, Card, CardActionArea, CardContent, Chip, CircularProgress, Stack, Typography, Alert } from "@mui/material";
import BuildIcon from "@mui/icons-material/Build";
import LocalShippingIcon from "@mui/icons-material/LocalShipping";
import HandymanIcon from "@mui/icons-material/Handyman";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import DescriptionIcon from "@mui/icons-material/Description";
import { request } from "@/helpers/request";

type DeliveryItemStatus = "not_delivered" | "delivering" | "not_installed" | "completed";

interface DeliveryItem {
  id: string;
  lineNumber: number | null;
  sku: string | null;
  // Physical unit SKU from getScanContext (resolved from the linked Inventory
  // row); shown as the row sub-label. DocumentItem.sku is often null.
  unitSku?: string | null;
  description: string | null;
  // Unit identity surfaced by getScanContext (Phase 5 part 1) so ANY row is
  // independently actionable — not just the scanned one.
  inventoryId: string | null;
  itemId: string;
  itemType: "INVENTORY" | "ASSET";
  deliveryStatus: DeliveryItemStatus;
  canStart: boolean;
  canAck: boolean;
  canInstall: boolean;
  canSkip: boolean;
}

interface ScanContext {
  asset: { id: string; name: string; skuKey: string; image?: string | null; description?: string | null };
  inventory: { id: string; sku: string; status: string; serialNumber: string | null; location: string | null } | null;
  latestDeliveryOrder: { id: string; name?: string | null; createdAt: string; status: string } | null;
  deliveryStage: "start" | "ack_delivery" | "ack_install" | "completed" | null;
  // Per-item delivery rows for the resolved DO (Phase 5). Optional — absent on
  // legacy/non-DO contexts, where the single morphing card is the fallback.
  deliveryItems?: DeliveryItem[];
  resolvedDeliveryOrder: { id: string; name?: string | null; status: string } | null;
  canStartDelivery: boolean;
  canAckDelivery: boolean;
  activeDeliveryStart: { id: string; createdAt: string; technicianName: string | null } | null;
  installableDeliveryOrder: { id: string; name?: string | null; createdAt: string; status: string } | null;
  canAckInstall: boolean;
  recentServiceReports: Array<{ id: string; createdAt: string; status: string }>;
}

// Per-item status → chip label + colour for the delivery-items list.
const STATUS_CHIP: Record<DeliveryItemStatus, { label: string; color: "default" | "warning" | "info" | "success" }> = {
  not_delivered: { label: "Not delivered", color: "default" },
  delivering: { label: "Delivering", color: "warning" },
  not_installed: { label: "Delivered", color: "info" },
  completed: { label: "Completed", color: "success" },
};

export default function AssetActionChooser() {
  const params = useParams();
  const router = useRouter();
  const search = useSearchParams();
  const { getToken } = useAuth();
  const assetId = params?.assetId as string;
  const inventoryId = search?.get("inventoryId") ?? null;
  const [data, setData] = useState<ScanContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        if (!token) {
          setError("Not signed in");
          setLoading(false);
          return;
        }
        const inventoryQuery = inventoryId ? `?inventoryId=${encodeURIComponent(inventoryId)}` : "";
        const res = await request(
          { path: `/maintenance-reports/scan-context/${assetId}${inventoryQuery}`, method: "GET" },
          {},
          token,
        );
        if (cancelled) return;
        if (res.success === false) {
          setError(res.message ?? "Asset not found");
        } else {
          setData(res.data ?? res);
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Failed to load asset");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [assetId, getToken, inventoryId]);

  if (loading) {
    return (
      <Box sx={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error || !data) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{error ?? "Could not load asset"}</Alert>
        <Button sx={{ mt: 2 }} onClick={() => router.push("/scan")}>Back to scan</Button>
      </Box>
    );
  }

  const { asset, inventory, deliveryStage, resolvedDeliveryOrder } = data;
  const imageUrl = asset.image ? `${process.env.NEXT_PUBLIC_RESOURCE_URL ?? "https://aims-osiris.s3.ap-southeast-1.amazonaws.com/"}${asset.image}` : undefined;

  // Per-item delivery list (Phase 5). The scanned unit (search param / resolved
  // inventory) is highlighted; every other row shows its status so the tech sees
  // the rest of the items on this DO. Each row acts on ITS OWN unit id.
  const deliveryItems = data.deliveryItems ?? [];
  const scannedUnitId = inventory?.id ?? inventoryId ?? null;

  // Single morphing delivery card driven by deliveryStage. The backend resolves
  // ONE delivery order (resolvedDeliveryOrder) and never re-picks, so a
  // completed DO stays "Completed" and can't regress to Start.
  const invQuery = inventory ? `?inventoryId=${encodeURIComponent(inventory.id)}` : "";
  const doRef = resolvedDeliveryOrder?.name ?? resolvedDeliveryOrder?.id ?? "";

  const deliveryCard: { title: string; subtitle: string; icon: React.ReactNode; onClick?: () => void } = (() => {
    switch (deliveryStage) {
      case "start":
        return {
          title: "Start Delivery",
          subtitle: doRef,
          icon: <LocalShippingIcon color="primary" sx={{ fontSize: 48 }} />,
          onClick: () => router.push(`/scan/asset/${assetId}/delivery-start${invQuery}`),
        };
      case "ack_delivery":
        return {
          title: "Acknowledge Delivery",
          subtitle: doRef,
          icon: <LocalShippingIcon color="primary" sx={{ fontSize: 48 }} />,
          onClick: () => {
            if (resolvedDeliveryOrder) router.push(`/scan/asset/${assetId}/do/${resolvedDeliveryOrder.id}${invQuery}`);
          },
        };
      case "ack_install":
        return {
          title: "Complete Installation",
          subtitle: doRef ? `${doRef} · delivered, awaiting installation` : "Delivered, awaiting installation",
          icon: <HandymanIcon color="primary" sx={{ fontSize: 48 }} />,
          onClick: () => {
            if (resolvedDeliveryOrder) router.push(`/scan/asset/${assetId}/install/${resolvedDeliveryOrder.id}${invQuery}`);
          },
        };
      case "completed":
        return {
          title: "Completed",
          subtitle: doRef ? `${doRef} · delivered & installed` : "Delivered & installed",
          icon: <CheckCircleIcon color="success" sx={{ fontSize: 48 }} />,
        };
      default:
        // null stage: no delivery order for this asset/unit. Mirror the prior
        // no-DO behaviour — a disabled "Start Delivery" card.
        return {
          title: "Start Delivery",
          subtitle: "No open delivery order",
          icon: <LocalShippingIcon color="disabled" sx={{ fontSize: 48 }} />,
        };
    }
  })();

  const deliveryCardInner = (
    <CardContent sx={{ display: "flex", gap: 2.5, alignItems: "center", py: 3, minHeight: 96 }}>
      {deliveryCard.icon}
      <Box>
        <Typography variant="h6" fontWeight={700}>{deliveryCard.title}</Typography>
        <Typography variant="body2" color="text.secondary">{deliveryCard.subtitle}</Typography>
      </Box>
    </CardContent>
  );

  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 3 }}>
      <Stack direction="row" spacing={2} alignItems="center">
        <Avatar src={imageUrl} variant="rounded" sx={{ width: 72, height: 72 }}>
          {asset.name.slice(0, 2).toUpperCase()}
        </Avatar>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="h6" fontWeight={700}>{asset.name}</Typography>
          {inventory && (
            <Stack direction="row" spacing={1} sx={{ mt: 0.5, alignItems: "center", flexWrap: "wrap" }}>
              <Chip size="small" label={`Unit ${inventory.sku}`} />
              {inventory.serialNumber && (
                <Typography variant="caption" color="text.secondary">SN {inventory.serialNumber}</Typography>
              )}
            </Stack>
          )}
        </Box>
      </Stack>

      <Typography variant="subtitle1" fontWeight={600} sx={{ mt: 2 }}>
        What are you doing?
      </Typography>

      {/* Single morphing delivery card: Start Delivery → Acknowledge Delivery →
          Complete Installation → Completed, driven by deliveryStage. */}
      <Card variant="outlined">
        {deliveryCard.onClick ? (
          <CardActionArea onClick={deliveryCard.onClick}>{deliveryCardInner}</CardActionArea>
        ) : deliveryStage === "completed" ? (
          // Completed: non-interactive but full-colour (not greyed) so it reads
          // as a positive done state.
          deliveryCardInner
        ) : (
          // No actionable DO: disabled / greyed.
          <CardActionArea disabled>{deliveryCardInner}</CardActionArea>
        )}
      </Card>

      {/* Per-item delivery list (Phase 5). Augments the single morphing card:
          one row per item on the resolved DO, each with a status chip + the
          action available from ITS OWN status, acting on ITS OWN unit id. Hidden
          when getScanContext returns no deliveryItems (legacy/non-DO) → the card
          above remains the fallback. */}
      {deliveryItems.length > 0 && (
        <Box>
          <Typography variant="subtitle1" fontWeight={600} sx={{ mt: 2, mb: 1 }}>
            Items on this delivery ({deliveryItems.length})
          </Typography>
          <Stack spacing={1}>
            {deliveryItems.map((row) => {
              const isScanned =
                scannedUnitId != null &&
                (row.inventoryId === scannedUnitId || row.itemId === scannedUnitId);
              const chip = STATUS_CHIP[row.deliveryStatus] ?? { label: row.deliveryStatus, color: "default" as const };
              return (
                <Card
                  key={row.id}
                  variant="outlined"
                  sx={isScanned ? { borderColor: "primary.main", borderWidth: 2 } : undefined}
                >
                  <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
                    <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                      <Box sx={{ minWidth: 0, flex: 1 }}>
                        <Typography variant="body2" fontWeight={600} noWrap>
                          {row.description || row.unitSku || `Item ${row.lineNumber ?? ""}`}
                        </Typography>
                        {row.unitSku && (
                          <Typography variant="caption" color="text.secondary" noWrap display="block">
                            {row.unitSku}
                          </Typography>
                        )}
                      </Box>
                      {isScanned && <Chip size="small" label="Scanned" color="primary" variant="outlined" />}
                      <Chip size="small" label={chip.label} color={chip.color} />
                    </Stack>
                  </CardContent>
                </Card>
              );
            })}
          </Stack>
        </Box>
      )}

      {/* View the linked delivery order, read-only. Shown only when a DO is
          actually associated with this unit (any stage). */}
      {resolvedDeliveryOrder && (
        <Card variant="outlined">
          <CardActionArea onClick={() => router.push(`/scan/asset/${assetId}/do/${resolvedDeliveryOrder.id}/view`)}>
            <CardContent sx={{ display: "flex", gap: 2.5, alignItems: "center", py: 3, minHeight: 96 }}>
              <DescriptionIcon color="primary" sx={{ fontSize: 48 }} />
              <Box>
                <Typography variant="h6" fontWeight={700}>
                  View Delivery Order
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {resolvedDeliveryOrder.name ?? resolvedDeliveryOrder.id} — read-only
                </Typography>
              </Box>
            </CardContent>
          </CardActionArea>
        </Card>
      )}

      <Card variant="outlined">
        <CardActionArea onClick={() => {
          const invQuery = inventory ? `?inventoryId=${encodeURIComponent(inventory.id)}` : "";
          router.push(`/scan/asset/${assetId}/service/new${invQuery}`);
        }}>
          <CardContent sx={{ display: "flex", gap: 2.5, alignItems: "center", py: 3, minHeight: 96 }}>
            <BuildIcon color="primary" sx={{ fontSize: 48 }} />
            <Box>
              <Typography variant="h6" fontWeight={700}>
                Maintenance Service Report
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Capture photos and customer signature for work performed
              </Typography>
            </Box>
          </CardContent>
        </CardActionArea>
      </Card>

      {data.recentServiceReports.length > 0 && (
        <Box>
          <Typography variant="caption" color="text.secondary">
            Recent activity ({data.recentServiceReports.length})
          </Typography>
        </Box>
      )}

      <Button
        variant="text"
        sx={{ mt: 4, color: "text.secondary", alignSelf: "center" }}
        onClick={() => router.push("/scan")}
      >
        Scan another asset
      </Button>
    </Box>
  );
}
