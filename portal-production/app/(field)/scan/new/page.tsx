"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { Box, Button, Typography, Alert, CircularProgress } from "@mui/material";
import NfcIcon from "@mui/icons-material/Nfc";
import KeyboardIcon from "@mui/icons-material/Keyboard";
import { request } from "@/helpers/request";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";
import { useNfcScan } from "../../hooks/useNfcScan";
import FieldBackButton from "../../components/FieldBackButton";
import { useFieldAppBar } from "@/app/(field)/components/FieldAppBar";
import { exitFor, isAdhocOrigin, withOrigin } from "../../lib/scanOrigin";

/**
 * Scan a unit (reached from the Ad-hoc chooser: "New delivery", or "Scan or
 * tag a unit" which adds ?from=adhoc so every back on the trip returns to the
 * chooser rather than the Deliveries home).
 *
 * This is the old scan landing, minus its list shortcuts (those now live on
 * the home tabs). On NFC tap we read the chip's hardware UID. Every NFC tag has
 * one, no tag-writing tool needed. We hit /assets/by-nfc-uid/:uid:
 *   - 200 → asset is already bound, jump to the action chooser
 *   - 404 → unbound tag, jump to /scan/bind to attach it to a SKU
 *
 * NFC implementation is platform-abstracted by useNfcScan: native (Capacitor +
 * Capgo plugin) when running in the Android shell, Web NFC (NDEFReader) on
 * Chrome-Android browsers, unsupported elsewhere.
 */
export default function ScanUnitPage() {
  const router = useRouter();
  const search = useSearchParams();
  const adhoc = isAdhocOrigin(search);
  const { getToken } = useAuth();
  const { features, isLoading } = useOrganizationFeatures();
  const nfc = useNfcScan();
  const [scanError, setScanError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Back to where the trip began (the chooser, or the Deliveries home). Pop
  // history when we came from it, so the home comes back on the same tab
  // (?tab=…); replace only when there is nothing to pop (a cold deep link).
  const goHome = useCallback(() => {
    if (typeof window !== "undefined" && window.history.length > 1) router.back();
    else router.replace(exitFor(adhoc));
  }, [router, adhoc]);

  useFieldAppBar({ title: "Scan", onBack: goHome });

  const resolveTag = useCallback(
    async (uid: string) => {
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
        // New shape: { inventory, asset }. The endpoint resolves the tag to a
        // specific inventory unit and includes its parent asset for the chooser.
        const payload = res.data ?? res;
        const assetId = payload?.asset?.id;
        const inventoryId = payload?.inventory?.id;
        if (assetId) {
          const query = inventoryId ? `?inventoryId=${encodeURIComponent(inventoryId)}` : "";
          router.push(withOrigin(`/scan/asset/${assetId}${query}`, adhoc));
          return;
        }
        router.push(withOrigin(`/scan/bind?uid=${encodeURIComponent(uid)}`, adhoc));
      } catch (e: any) {
        // The request helper surfaces 404 as a thrown error in many setups.
        // Treat any non-success as "unbound tag" and push to bind.
        const status = e?.response?.status ?? e?.status;
        if (status === 404) {
          router.push(withOrigin(`/scan/bind?uid=${encodeURIComponent(uid)}`, adhoc));
          return;
        }
        setScanError(e?.message ?? "Lookup failed");
      } finally {
        setBusy(false);
      }
    },
    [getToken, router, adhoc],
  );

  // React to a scanned tag. The hook auto-stops after a successful read, so
  // we just observe `uid` and dispatch the lookup.
  useEffect(() => {
    if (nfc.uid) resolveTag(nfc.uid);
  }, [nfc.uid, resolveTag]);

  useEffect(() => {
    if (nfc.error) setScanError(nfc.error);
  }, [nfc.error]);

  if (isLoading) {
    return (
      <Box sx={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <CircularProgress />
      </Box>
    );
  }

  if (features.enableFieldScanApp === false) {
    return (
      <Box sx={{ p: 2 }}>
        <Alert severity="info">
          Field scan is not enabled for your organization. Ask an admin to enable it under Admin → Configuration → Feature Flags.
        </Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column" }}>
      <Box sx={{ flex: 1, p: 2, display: "flex", flexDirection: "column", gap: 3, alignItems: "center", justifyContent: "center", textAlign: "center" }}>
        <NfcIcon sx={{ fontSize: 96, color: "primary.main" }} />
        <Typography variant="h5">Tap an asset tag</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 320 }}>
          Hold your phone close to the NFC sticker on the asset.
        </Typography>

        {nfc.isSupported === undefined && (
          <CircularProgress size={24} />
        )}

        {nfc.isSupported === true && (
          <Button
            variant="contained"
            size="large"
            onClick={nfc.startScan}
            disabled={busy || nfc.isScanning}
            startIcon={<NfcIcon />}
            sx={{
              minWidth: 260,
              py: 2,
              px: 5,
              fontSize: "1.125rem",
              minHeight: 64,
              "& .MuiButton-startIcon > *:first-of-type": { fontSize: 32 },
            }}
          >
            {busy ? "Looking up..." : nfc.isScanning ? "Scanning…" : "Tap to scan"}
          </Button>
        )}

        {nfc.isSupported === false && (
          <Alert severity="warning" sx={{ width: "100%", maxWidth: 360 }}>
            NFC is not available on this device. Use manual serial entry below,
            or the SiteJobs app on an NFC-capable phone.
          </Alert>
        )}

        {/* Manual serial entry: the NFC-less path for untaggable units (any
            tracked asset with units). Primary CTA when the device has no NFC. */}
        <Button
          variant={nfc.isSupported === false ? "contained" : "outlined"}
          size="large"
          onClick={() => router.push(withOrigin("/scan/manual", adhoc))}
          startIcon={<KeyboardIcon />}
          sx={{ minWidth: 260, minHeight: 52 }}
        >
          Enter serial manually
        </Button>

        {scanError && (
          <Alert severity="error" sx={{ width: "100%", maxWidth: 360 }}>{scanError}</Alert>
        )}
      </Box>
      {/* Same exit as the back arrow in the app bar. */}
      <Box sx={{ px: 2, pb: 2 }}>
        <FieldBackButton />
      </Box>
    </Box>
  );
}
