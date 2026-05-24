"use client";

import React, { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { Avatar, Box, Button, Card, CardActionArea, CardContent, Chip, CircularProgress, Stack, Typography, Alert } from "@mui/material";
import BuildIcon from "@mui/icons-material/Build";
import LocalShippingIcon from "@mui/icons-material/LocalShipping";
import AddBoxIcon from "@mui/icons-material/AddBox";
import { request } from "@/helpers/request";

interface ScanContext {
  asset: { id: string; name: string; skuKey: string; image?: string | null; description?: string | null };
  inventory: { id: string; sku: string; status: string; serialNumber: string | null; location: string | null } | null;
  latestDeliveryOrder: { id: string; name?: string | null; createdAt: string; status: string } | null;
  canStartDelivery: boolean;
  canAckDelivery: boolean;
  activeDeliveryStart: { id: string; createdAt: string; technicianName: string | null } | null;
  recentServiceReports: Array<{ id: string; createdAt: string; status: string }>;
}

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

  const { asset, inventory, latestDeliveryOrder } = data;
  const imageUrl = asset.image ? `${process.env.NEXT_PUBLIC_RESOURCE_URL ?? "https://aims-osiris.s3.ap-southeast-1.amazonaws.com/"}${asset.image}` : undefined;

  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 3 }}>
      <Stack direction="row" spacing={2} alignItems="center">
        <Avatar src={imageUrl} variant="rounded" sx={{ width: 72, height: 72 }}>
          {asset.name.slice(0, 2).toUpperCase()}
        </Avatar>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="h6" fontWeight={700}>{asset.name}</Typography>
          <Typography variant="body2" color="text.secondary">{asset.skuKey}</Typography>
          {inventory && (
            <Stack direction="row" spacing={1} sx={{ mt: 0.5, alignItems: "center", flexWrap: "wrap" }}>
              <Chip size="small" label={`Unit ${inventory.sku}`} />
              <Chip size="small" label={inventory.status} variant="outlined" />
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

      {/* Smart delivery card — single button that morphs between Start and
          Acknowledge based on the DO's current state. Disabled (with an
          explanatory caption) when neither action is available: no open DO
          on this asset, or the delivery cycle is already complete. */}
      <Card variant="outlined">
        <CardActionArea
          onClick={() => {
            const invQuery = inventory ? `?inventoryId=${encodeURIComponent(inventory.id)}` : "";
            if (data.canStartDelivery) {
              router.push(`/scan/asset/${assetId}/delivery-start${invQuery}`);
            } else if (data.canAckDelivery && latestDeliveryOrder) {
              router.push(`/scan/asset/${assetId}/do/${latestDeliveryOrder.id}${invQuery}`);
            }
          }}
          disabled={!data.canStartDelivery && !data.canAckDelivery}
        >
          <CardContent sx={{ display: "flex", gap: 2.5, alignItems: "center", py: 3, minHeight: 96 }}>
            {data.canAckDelivery ? (
              <LocalShippingIcon color="primary" sx={{ fontSize: 48 }} />
            ) : (
              <AddBoxIcon color={data.canStartDelivery ? "primary" : "disabled"} sx={{ fontSize: 48 }} />
            )}
            <Box>
              <Typography variant="h6" fontWeight={700}>
                {data.canAckDelivery ? "Acknowledge Delivery" : "Start Delivery"}
              </Typography>
              {data.canStartDelivery ? (
                <Typography variant="body2" color="text.secondary">
                  {latestDeliveryOrder?.name ?? latestDeliveryOrder?.id} · {latestDeliveryOrder ? new Date(latestDeliveryOrder.createdAt).toLocaleDateString() : ""}
                </Typography>
              ) : data.canAckDelivery ? (
                <Typography variant="body2" color="text.secondary">
                  {latestDeliveryOrder?.name ?? latestDeliveryOrder?.id}
                  {data.activeDeliveryStart?.technicianName ? ` · started by ${data.activeDeliveryStart.technicianName}` : data.activeDeliveryStart ? ` · started ${new Date(data.activeDeliveryStart.createdAt).toLocaleDateString()}` : ""}
                </Typography>
              ) : (
                <Typography variant="body2" color="text.secondary">No open delivery order</Typography>
              )}
            </Box>
          </CardContent>
        </CardActionArea>
      </Card>

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
