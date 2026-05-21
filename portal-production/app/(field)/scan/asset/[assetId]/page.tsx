"use client";

import React, { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { Avatar, Box, Button, Card, CardActionArea, CardContent, CircularProgress, Stack, Typography, Alert } from "@mui/material";
import BuildIcon from "@mui/icons-material/Build";
import LocalShippingIcon from "@mui/icons-material/LocalShipping";
import AddBoxIcon from "@mui/icons-material/AddBox";
import { request } from "@/helpers/request";

interface ScanContext {
  asset: { id: string; name: string; skuKey: string; image?: string | null; description?: string | null };
  latestDeliveryOrder: { id: string; name?: string | null; createdAt: string; status: string } | null;
  canStartDelivery: boolean;
  canAckDelivery: boolean;
  activeDeliveryStart: { id: string; createdAt: string; technicianName: string | null } | null;
  recentServiceReports: Array<{ id: string; createdAt: string; status: string }>;
}

export default function AssetActionChooser() {
  const params = useParams();
  const router = useRouter();
  const { getToken } = useAuth();
  const assetId = params?.assetId as string;
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
        const res = await request(
          { path: `/maintenance-reports/scan-context/${assetId}`, method: "GET" },
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
  }, [assetId, getToken]);

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

  const { asset, latestDeliveryOrder } = data;
  const imageUrl = asset.image ? `${process.env.NEXT_PUBLIC_RESOURCE_URL ?? "https://aims-osiris.s3.ap-southeast-1.amazonaws.com/"}${asset.image}` : undefined;

  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 3 }}>
      <Stack direction="row" spacing={2} alignItems="center">
        <Avatar src={imageUrl} variant="rounded" sx={{ width: 72, height: 72 }}>
          {asset.name.slice(0, 2).toUpperCase()}
        </Avatar>
        <Box>
          <Typography variant="h6" fontWeight={700}>{asset.name}</Typography>
          <Typography variant="body2" color="text.secondary">{asset.skuKey}</Typography>
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
            if (data.canStartDelivery) {
              router.push(`/scan/asset/${assetId}/delivery-start`);
            } else if (data.canAckDelivery && latestDeliveryOrder) {
              router.push(`/scan/asset/${assetId}/do/${latestDeliveryOrder.id}`);
            }
          }}
          disabled={!data.canStartDelivery && !data.canAckDelivery}
        >
          <CardContent sx={{ display: "flex", gap: 2, alignItems: "center" }}>
            {data.canAckDelivery ? (
              <LocalShippingIcon color="primary" sx={{ fontSize: 40 }} />
            ) : (
              <AddBoxIcon color={data.canStartDelivery ? "primary" : "disabled"} sx={{ fontSize: 40 }} />
            )}
            <Box>
              <Typography variant="subtitle1" fontWeight={600}>
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
              ) : !latestDeliveryOrder ? (
                <Typography variant="body2" color="text.secondary">No open DO for this asset</Typography>
              ) : (
                <Typography variant="body2" color="text.secondary">Delivery complete</Typography>
              )}
            </Box>
          </CardContent>
        </CardActionArea>
      </Card>

      <Card variant="outlined">
        <CardActionArea onClick={() => router.push(`/scan/asset/${assetId}/service/new`)}>
          <CardContent sx={{ display: "flex", gap: 2, alignItems: "center" }}>
            <BuildIcon color="primary" sx={{ fontSize: 40 }} />
            <Box>
              <Typography variant="subtitle1" fontWeight={600}>
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
    </Box>
  );
}
