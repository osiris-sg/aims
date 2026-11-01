"use client";

// Org Settings → Shipping & documents (orgs with the SHIPMENTS module): the
// B/L instruction defaults new contracts start with, and the texts the in-app
// trade documents print — bank accounts, issuers and the 出庫・納入依頼書 宛先,
// the company seal, delivery profiles and QMJP by quarter. Moved here from the
// Shipments page (2026-10); "New shipments from PIs" stays there (an action).
// Email intake: the org's forwarding address + the emails received (read-only),
// and the sender filter (Off / Trial run / Enforce + the allow-list).

import React from "react";
import { Alert, Box, Paper, Stack, Typography } from "@mui/material";
import { useConfiguration } from "@/app/portal/context/ConfigurationContext";
import { showShippingSettings } from "@/helpers/settingsVisibility";
import BlDefaultsForm from "@/app/portal/shipments/_components/BlDefaultsForm";
import DocSettingsForm from "@/app/portal/shipments/_components/DocSettingsForm";
import EmailIntakePanel from "@/app/portal/shipments/_components/EmailIntakePanel";
import EmailFilterForm from "@/app/portal/shipments/_components/EmailFilterForm";
import FilterPreviewPanel, { EmailFilterExtras } from "@/app/portal/shipments/_components/FilterPreviewPanel";
import EstimatorRatesForm from "@/app/portal/shipments/_components/EstimatorRatesForm";
import AlertRulesForm from "@/app/portal/shipments/_components/AlertRulesForm";
import TradeTheme from "@/app/portal/shipments/_components/TradeTheme";
import { useTranslations } from "next-intl";

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
  const t = useTranslations("settings.shipping");
  if (!loading && !showShippingSettings(isModuleEnabled)) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="info">{t("onlyShipments")}</Alert>
      </Box>
    );
  }
  return (
    <TradeTheme>
      <Box sx={{ p: { xs: 1.5, md: 3 }, maxWidth: 1000, mx: "auto" }}>
        <Typography variant="h5" sx={{ fontWeight: 800 }}>
          {t("title")}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          {t("intro")}
        </Typography>
        <Stack spacing={3}>
          <Section title={t("blTitle")} hint={t("blHint")} tour="settings-bl-defaults">
            <BlDefaultsForm />
          </Section>
          <Section
            title={t("docTitle")}
            hint={t("docHint")}
            tour="settings-doc-settings"
          >
            <DocSettingsForm />
          </Section>
          <Section
            title={t("estTitle")}
            hint={t("estHint")}
            tour="settings-estimator"
          >
            <EstimatorRatesForm />
          </Section>
          <Section title={t("alertsTitle")} hint={t("alertsHint")} tour="settings-alerts">
            <AlertRulesForm />
          </Section>
          <Section
            title={t("intakeTitle")}
            hint={t("intakeHint")}
            tour="settings-email-intake"
          >
            <EmailIntakePanel />
          </Section>
          <Section
            title={t("filterTitle")}
            hint={t("filterHint")}
            tour="settings-email-filter"
          >
            <EmailFilterForm />
            <Typography variant="subtitle2" sx={{ mt: 3, mb: 1 }}>
              {t("filterPreview")}
            </Typography>
            <FilterPreviewPanel />
            <EmailFilterExtras />
          </Section>
        </Stack>
      </Box>
    </TradeTheme>
  );
}
