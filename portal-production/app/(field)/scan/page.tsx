"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { Box, Button, Stack, TextField, Typography, Alert, CircularProgress } from "@mui/material";
import NfcIcon from "@mui/icons-material/Nfc";
import { request } from "@/helpers/request";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";

type NfcCapability = "checking" | "supported" | "unsupported";

/**
 * Scan landing.
 *
 * On NFC tap we read the chip's hardware UID (serialNumber). Every NFC tag
 * has one — no tag-writing tool needed. We hit /assets/by-nfc-uid/:uid:
 *   - 200 → asset is already bound, jump to the action chooser
 *   - 404 → unbound tag, jump to /scan/bind to attach it to a SKU
 */
export default function ScanLandingPage() {
  const router = useRouter();
  const { getToken } = useAuth();
  const { features, isLoading } = useOrganizationFeatures();
  const [nfcStatus, setNfcStatus] = useState<NfcCapability>("checking");
  const [scanError, setScanError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [manualSku, setManualSku] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    setNfcStatus("NDEFReader" in window ? "supported" : "unsupported");
  }, []);

  const resolveTag = async (uid: string) => {
    setBusy(true);
    setScanError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const res = await request(
        { path: `/assets/by-nfc-uid/${encodeURIComponent(uid)}`, method: "GET" },
        {},
        token,
      );
      const asset = res.data ?? res;
      if (asset?.id) {
        router.push(`/scan/asset/${asset.id}`);
        return;
      }
      router.push(`/scan/bind?uid=${encodeURIComponent(uid)}`);
    } catch (e: any) {
      // The request helper surfaces 404 as a thrown error in many setups.
      // Treat any non-success as "unbound tag" and push to bind.
      const status = e?.response?.status ?? e?.status;
      if (status === 404) {
        router.push(`/scan/bind?uid=${encodeURIComponent(uid)}`);
        return;
      }
      setScanError(e?.message ?? "Lookup failed");
    } finally {
      setBusy(false);
    }
  };

  const startScan = async () => {
    setScanError(null);
    try {
      const NDEFReader = (window as unknown as { NDEFReader: new () => any }).NDEFReader;
      const reader = new NDEFReader();
      await reader.scan();
      reader.onreading = (event: any) => {
        const uid = event.serialNumber as string | undefined;
        if (!uid) {
          setScanError("Tag has no readable serial number.");
          return;
        }
        resolveTag(uid);
      };
    } catch (err: any) {
      setScanError(err?.message ?? "Failed to start NFC scan.");
    }
  };

  const goManual = async () => {
    if (!manualSku.trim()) return;
    setBusy(true);
    setScanError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const res = await request(
        { path: `/assets/skuKey/${encodeURIComponent(manualSku.trim())}`, method: "GET" },
        {},
        token,
      );
      const asset = res.data ?? res;
      if (asset?.id) {
        router.push(`/scan/asset/${asset.id}`);
      } else {
        setScanError("No asset with that SKU");
      }
    } catch (e: any) {
      setScanError(e?.message ?? "Lookup failed");
    } finally {
      setBusy(false);
    }
  };

  if (isLoading) {
    return (
      <Box sx={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <CircularProgress />
      </Box>
    );
  }

  if (features.enableFieldScanApp === false) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="info">
          Field scan is not enabled for your organization. Ask an admin to enable it under Admin → Configuration → Feature Flags.
        </Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ flex: 1, p: 3, display: "flex", flexDirection: "column", gap: 3, alignItems: "center", justifyContent: "center", textAlign: "center" }}>
      <NfcIcon sx={{ fontSize: 96, color: "primary.main" }} />
      <Typography variant="h5" fontWeight={600}>Tap an asset tag</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 320 }}>
        Hold your phone close to the NFC sticker on the asset.
      </Typography>

      {nfcStatus === "supported" && (
        <Button variant="contained" size="large" onClick={startScan} disabled={busy} sx={{ minWidth: 220 }}>
          {busy ? "Looking up..." : "Start scanning"}
        </Button>
      )}

      {nfcStatus === "unsupported" && (
        <Alert severity="warning" sx={{ width: "100%", maxWidth: 360 }}>
          NFC scanning requires Chrome on Android. You can enter the SKU manually below.
        </Alert>
      )}

      {scanError && (
        <Alert severity="error" sx={{ width: "100%", maxWidth: 360 }}>{scanError}</Alert>
      )}

      <Stack spacing={1} sx={{ width: "100%", maxWidth: 360, mt: 2 }}>
        <Typography variant="caption" color="text.secondary">Or enter asset SKU manually</Typography>
        <TextField size="small" placeholder="e.g. AF-90" value={manualSku} onChange={(e) => setManualSku(e.target.value)} />
        <Button variant="outlined" onClick={goManual} disabled={!manualSku.trim() || busy}>Open</Button>
      </Stack>
    </Box>
  );
}
