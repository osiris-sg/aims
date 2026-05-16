"use client";

import React from "react";
import { Box } from "@mui/material";
import { OrganizationProvider } from "../portal/context/OrganizationContext";

interface Props {
  children: React.ReactNode;
}

/**
 * Mobile-first shell for the NFC field-scan PWA.
 * Bypasses the portal sidebar/navbar so the app feels native when wrapped
 * in Capacitor on Android/iOS, but keeps Clerk + Redux + Theme from the
 * root layout, plus its own OrganizationProvider so org context is available.
 */
export default function FieldLayout({ children }: Props) {
  return (
    <OrganizationProvider>
      <Box
        sx={{
          minHeight: "100vh",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          bgcolor: "background.default",
        }}
      >
        {children}
      </Box>
    </OrganizationProvider>
  );
}
