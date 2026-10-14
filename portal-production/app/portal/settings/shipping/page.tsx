"use client";

// Org Settings → Shipping & documents (orgs with the SHIPMENTS module): the
// B/L instruction defaults new contracts start with, and the texts the in-app
// trade documents print — bank accounts, issuers and the 出庫・納入依頼書 宛先,
// the company seal, delivery profiles and QMJP by quarter. Moved here from the
// Shipments page (2026-10); "New shipments from PIs" stays there (an action).

import React from "react";
import { Alert, Box, Paper, Stack, Typography } from "@mui/material";
import { useConfiguration } from "@/app/portal/context/ConfigurationContext";
import { showShippingSettings } from "@/helpers/settingsVisibility";
import BlDefaultsForm from "@/app/portal/shipments/_components/BlDefaultsForm";
import DocSettingsForm from "@/app/portal/shipments/_components/DocSettingsForm";
import TradeTheme from "@/app/portal/shipments/_components/TradeTheme";

const Section = ({ title, hint, children, tour }: { title: string; hint: string; children: React.ReactNode; tour?: string }) => (
  <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 } }} data-tour={tour}>
    <Typography variant="h6" sx={{ fontWeight: 700 }}>
      {title}
    </Typography>
    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
      {hint}
    </Typography>
    {children}
  </Paper>
);

export default function ShippingSettingsPage() {
  const { isModuleEnabled, loading } = useConfiguration() as { isModuleEnabled: (code: string) => boolean; loading?: boolean };
  if (!loading && !showShippingSettings(isModuleEnabled)) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="info">Shipping &amp; documents settings are for organizations with the Shipments module.</Alert>
      </Box>
    );
  }
  return (
    <TradeTheme>
      <Box sx={{ p: { xs: 1.5, md: 3 }, maxWidth: 1000, mx: "auto" }}>
        <Typography variant="h5" sx={{ fontWeight: 800 }}>
          Shipping &amp; documents
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Defaults for new contracts and the texts printed on the documents made in Shipments. Existing contracts and documents keep what they were created with.
        </Typography>
        <Stack spacing={3}>
          <Section title="B/L instruction defaults" hint="Consignee and notify party that new contracts start with." tour="settings-bl-defaults">
            <BlDefaultsForm />
          </Section>
          <Section
            title="Document settings"
            hint="Bank accounts, issuers and the 出庫・納入依頼書 宛先, company seal, delivery profiles and QMJP by quarter."
            tour="settings-doc-settings"
          >
            <DocSettingsForm />
          </Section>
        </Stack>
      </Box>
    </TradeTheme>
  );
}
