"use client";

import React from "react";
import Link from "next/link";
import { Alert, Button } from "@mui/material";
import MainCard from "@/components/MainCard";
import Permissions from "./components/Permissions";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";

export default function PermissionsPage() {
  const { isRolePresetsEnabled } = useOrganizationFeatures();
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
              Go to Users
            </Button>
          }
        >
          Roles are preset for this organisation (Admin, Sales, Accounting, Operations, Technician, Viewer). Pick a role when you add or edit a user.
        </Alert>
      </MainCard>
    );
  }
  return <Permissions />;
}
