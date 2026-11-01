"use client";

import React from "react";
import Link from "next/link";
import { Alert, Button } from "@mui/material";
import MainCard from "@/components/MainCard";
import Permissions from "./components/Permissions";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";
import { useTranslations } from "next-intl";

export default function PermissionsPage() {
  const { isRolePresetsEnabled } = useOrganizationFeatures();
  const t = useTranslations("users.roles");
  // Preset-role orgs (guru 2026-10-27): roles and their permissions are built
  // in and not editable by the client — the only choice is which role a user
  // gets, made on the Users page.
  if (isRolePresetsEnabled) {
    return (
      <MainCard>
        <Alert
          severity="info"
          action={
            <Button component={Link} href="/portal/user-management/users" color="inherit" size="small">
              {t("goToUsers")}
            </Button>
          }
        >
          {t("presetNote")}
        </Alert>
      </MainCard>
    );
  }
  return <Permissions />;
}
