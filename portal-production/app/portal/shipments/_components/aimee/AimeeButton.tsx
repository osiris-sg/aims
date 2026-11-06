"use client";

// Round BL — "AIMEE" in a record header / on an email card: opens the AIMEE side panel on what is in view. Shown only
// where the panel exists (an org with the SHIPMENTS module and AIMEE on), so other orgs see no new button.

import React from "react";
import { Button, Tooltip } from "@mui/material";
import { useTranslations } from "next-intl";
import AimeeFace from "@/app/portal/chat/AimeeFace";
import { useConfiguration } from "@/app/portal/context/ConfigurationContext";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";
import { aimeePreviewOn, openDock } from "./bridge";

/** True on an org that has the AIMEE side panel. */
export function useAimeeOn(): boolean {
  const { isAimsChatEnabled, isLoading } = useOrganizationFeatures();
  const cfg = useConfigurationOrNull();
  return aimeePreviewOn() || (!!cfg && !isLoading && !cfg.loading && isAimsChatEnabled && cfg.isModuleEnabled("SHIPMENTS"));
}

/** The configuration, or null outside its provider (the /preview pages render the real cards without one). */
function useConfigurationOrNull(): ReturnType<typeof useConfiguration> | null {
  try {
    return useConfiguration();
  } catch {
    return null;
  }
}

export default function AimeeButton({ variant = "record", aboveModal, onOpen, dataTour }: { variant?: "record" | "email"; aboveModal?: boolean; onOpen?: () => void; dataTour?: string }) {
  const on = useAimeeOn();
  const t = useTranslations("aimee.dock");
  if (!on) return null;
  const email = variant === "email";
  return (
    <Tooltip title={email ? t("askAboutEmailHint") : t("buttonHint")}>
      <Button
        size="small"
        variant="outlined"
        onClick={(e) => {
          e.stopPropagation();
          onOpen?.();
          openDock({ aboveModal });
        }}
        startIcon={<AimeeFace size={18} track={false} />}
        data-tour={dataTour ?? (email ? "aimee-email-button" : "aimee-record-button")}
        sx={{ textTransform: "none", borderRadius: 999, flexShrink: 0, fontWeight: 700 }}
      >
        {email ? t("askAboutEmail") : t("button")}
      </Button>
    </Tooltip>
  );
}
