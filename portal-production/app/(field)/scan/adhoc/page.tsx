"use client";

import React, { useCallback } from "react";
import { useRouter } from "next/navigation";
import { Alert, Box, Card, CardActionArea, CardContent, CircularProgress, Stack, Typography } from "@mui/material";
import LocalShippingIcon from "@mui/icons-material/LocalShipping";
import AssignmentReturnIcon from "@mui/icons-material/AssignmentReturn";
import NfcIcon from "@mui/icons-material/Nfc";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";
import { useFieldAppBar } from "@/app/(field)/components/FieldAppBar";
import FieldBackButton from "../../components/FieldBackButton";

/**
 * AD-HOC chooser (2026-10-22), reached from the "Ad-hoc" button on the
 * Deliveries home. Three ways forward:
 *   New delivery      -> the existing ad-hoc delivery flow, unchanged (/scan/new:
 *                        tap a tag or key in a serial, then delivery-start).
 *   New return        -> keyed-in item IDs collected on site (/scan/adhoc/return).
 *   Scan or tag a unit -> /scan/new?from=adhoc (2026-10-23): look a unit up or
 *                        tag a new one, nothing started; the marker brings every
 *                        back on that trip here instead of the Deliveries home.
 */
export default function AdHocChooserPage() {
  const router = useRouter();
  const { features, isLoading } = useOrganizationFeatures();

  // Back to the Deliveries home on the tab it was on; replace on a cold deep link.
  const goHome = useCallback(() => {
    if (typeof window !== "undefined" && window.history.length > 1) router.back();
    else router.replace("/scan");
  }, [router]);
  useFieldAppBar({ title: "Ad-hoc", onBack: goHome });

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
          Field scan is not enabled for your organization. Ask an admin to enable it under Admin, Configuration, Feature Flags.
        </Alert>
      </Box>
    );
  }

  const options: Array<{ title: string; subtitle: string; icon: React.ReactNode; href: string }> = [
    {
      title: "New delivery",
      subtitle: "Scan or key in the units going out. The office attaches the project afterwards.",
      icon: <LocalShippingIcon color="primary" sx={{ fontSize: 40 }} />,
      href: "/scan/new",
    },
    {
      title: "New return",
      subtitle: "Key in the IDs of the items you are bringing back, then take the customer's signature.",
      icon: <AssignmentReturnIcon color="primary" sx={{ fontSize: 40 }} />,
      href: "/scan/adhoc/return",
    },
    {
      title: "Scan or tag a unit",
      subtitle: "Look up a unit or tag a new one. No delivery or return.",
      icon: <NfcIcon color="primary" sx={{ fontSize: 40 }} />,
      href: "/scan/new?from=adhoc",
    },
  ];

  return (
    <Box sx={{ flex: 1, p: 2, display: "flex", flexDirection: "column", gap: 2 }}>
      <Typography variant="body2" color="text.secondary">
        Nothing scheduled for this stop? Record it here.
      </Typography>
      <Stack spacing={1.5}>
        {options.map((o) => (
          <Card key={o.href} variant="outlined" sx={{ borderRadius: "16px" }}>
            <CardActionArea onClick={() => router.push(o.href)} sx={{ minHeight: 96 }}>
              <CardContent sx={{ display: "flex", alignItems: "center", gap: 2, py: 2.5 }}>
                {o.icon}
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
                    {o.title}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    {o.subtitle}
                  </Typography>
                </Box>
                <ChevronRightIcon sx={{ color: "text.disabled" }} />
              </CardContent>
            </CardActionArea>
          </Card>
        ))}
      </Stack>
      <Box sx={{ flexGrow: 1 }} />
      <FieldBackButton to="/scan" />
    </Box>
  );
}
