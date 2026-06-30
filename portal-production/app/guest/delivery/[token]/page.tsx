"use client";

/**
 * Guest delivery surface (Phase 6) — NO LOGIN. A driver opens this with only a
 * share-link token in the URL. It deliberately imports no Clerk hooks and no
 * (field) layout; every call hits the @Public() /public/delivery/:token
 * endpoints with NO auth token (the request helper omits Authorization when the
 * token arg is undefined). The backend authorises + scopes entirely from the
 * URL token's delivery order.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Stack,
  Typography,
} from "@mui/material";
import { request } from "@/helpers/request";

type DeliveryItemStatus = "not_delivered" | "delivering" | "not_installed" | "completed";

interface DeliveryItem {
  id: string;
  itemId: string;
  itemType: "INVENTORY" | "ASSET";
  sku: string | null;
  description: string | null;
  quantity: number;
  deliveryStatus: DeliveryItemStatus;
  canStart: boolean;
  canAck: boolean;
  canInstall: boolean;
  canSkip: boolean;
}

interface GuestView {
  documentNumber: string | null;
  status: string;
  customerName: string;
  deliveryItems: DeliveryItem[];
}

const STATUS_CHIP: Record<DeliveryItemStatus, { label: string; color: "default" | "warning" | "info" | "success" }> = {
  not_delivered: { label: "Not delivered", color: "default" },
  delivering: { label: "Delivering", color: "warning" },
  not_installed: { label: "Delivered (not installed)", color: "info" },
  completed: { label: "Completed", color: "success" },
};

type Action = "start" | "ack" | "install" | "skip";

export default function GuestDeliveryPage() {
  const params = useParams();
  const token = (params?.token as string) || "";

  const [view, setView] = useState<GuestView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyItem, setBusyItem] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      // token arg intentionally undefined → no Authorization header sent.
      const res = await request({ path: `/public/delivery/${token}`, method: "GET" }, {}, undefined);
      setView(res?.data ?? res);
    } catch {
      setError("This delivery link is invalid, expired, or no longer available.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (token) load();
  }, [token, load]);

  const advance = async (item: DeliveryItem, action: Action) => {
    setBusyItem(item.id);
    setError(null);
    try {
      const res = await request(
        { path: `/public/delivery/${token}/advance`, method: "POST" },
        { itemId: item.itemId, action },
        undefined,
      );
      setView(res?.data ?? res);
    } catch {
      setError("Could not update that item. Please try again.");
    } finally {
      setBusyItem(null);
    }
  };

  const onPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      // formData=true, token undefined → multipart POST with no auth header.
      await request({ path: `/public/delivery/${token}/photo`, method: "POST" }, formData, undefined, undefined, true, true);
    } catch {
      setError("Photo upload failed. Please try again.");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh", width: "100vw" }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error && !view) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh", width: "100vw", p: 2 }}>
        <Alert severity="error" sx={{ maxWidth: 420 }}>{error}</Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ minHeight: "100vh", width: "100vw", bgcolor: "background.default", p: 2 }}>
      <Box sx={{ maxWidth: 560, mx: "auto" }}>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>Delivery {view?.documentNumber || ""}</Typography>
        <Typography variant="body2" color="text.secondary">{view?.customerName}</Typography>
        <Typography variant="caption" color="text.secondary">Status: {view?.status}</Typography>

        {error && <Alert severity="error" sx={{ my: 1 }}>{error}</Alert>}

        <Stack spacing={1.5} sx={{ mt: 2 }}>
          {(view?.deliveryItems ?? []).map((row) => {
            const chip = STATUS_CHIP[row.deliveryStatus] ?? { label: row.deliveryStatus, color: "default" as const };
            const busy = busyItem === row.id;
            return (
              <Card key={row.id} variant="outlined">
                <CardContent sx={{ p: 1.5, "&:last-child": { pb: 1.5 } }}>
                  <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 1 }}>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" }}>
                        {row.description || row.sku || "Item"}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {row.sku ? `${row.sku} · ` : ""}Qty {row.quantity}
                      </Typography>
                    </Box>
                    <Chip size="small" label={chip.label} color={chip.color} />
                  </Box>

                  <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: "wrap" }}>
                    {row.canStart && (
                      <Button size="small" variant="contained" disabled={busy} onClick={() => advance(row, "start")}>Start delivery</Button>
                    )}
                    {row.canAck && (
                      <Button size="small" variant="contained" disabled={busy} onClick={() => advance(row, "ack")}>Mark delivered</Button>
                    )}
                    {row.canInstall && (
                      <Button size="small" variant="contained" disabled={busy} onClick={() => advance(row, "install")}>Mark installed</Button>
                    )}
                    {row.canSkip && (
                      <Button size="small" variant="outlined" disabled={busy} onClick={() => advance(row, "skip")}>Skip installation</Button>
                    )}
                    {busy && <CircularProgress size={18} sx={{ alignSelf: "center" }} />}
                  </Stack>
                </CardContent>
              </Card>
            );
          })}
        </Stack>

        <Box sx={{ mt: 3 }}>
          <Button variant="outlined" component="label" fullWidth>
            Add proof-of-delivery photo
            <input ref={fileInputRef} type="file" accept="image/*" capture="environment" hidden onChange={onPhoto} />
          </Button>
        </Box>
      </Box>
    </Box>
  );
}
