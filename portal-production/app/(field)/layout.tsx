"use client";

import React, { useEffect } from "react";
import { Box, IconButton, Tooltip } from "@mui/material";
import LogoutIcon from "@mui/icons-material/Logout";
import { useAuth, useClerk } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { OrganizationProvider } from "../portal/context/OrganizationContext";
import { BackgroundLocationProvider } from "./context/BackgroundLocationContext";

interface Props {
  children: React.ReactNode;
}

/**
 * Mobile-first shell for the NFC field-scan PWA.
 *
 * Bypasses the portal sidebar/navbar so the app feels native when wrapped
 * in Capacitor on Android/iOS, but keeps Clerk + Redux + Theme from the
 * root layout, plus its own OrganizationProvider so org context is
 * available everywhere in the field flow.
 *
 * Critically: the BackgroundLocationProvider lives here, at the layout
 * level, NOT on the per-page hook. The Capgo background-geolocation
 * plugin's JS callback is captured by whichever React tree called
 * BackgroundGeolocation.start() — if we registered it on /sign and then
 * router.replace'd to /done, the callback's owning component would
 * unmount and the native foreground service would keep running but
 * deliver location updates into a dead closure. Anchoring the provider
 * at the layout keeps the callback alive across every navigation inside
 * the (field) route group.
 *
 * The provider also runs resumeIfActive() on mount, which restarts
 * tracking after app kill if localStorage indicates an in-flight delivery.
 */
export default function FieldLayout({ children }: Props) {
  const router = useRouter();
  const { isLoaded, isSignedIn } = useAuth();
  const { signOut } = useClerk();

  // If Clerk has loaded and the user isn't signed in, bounce out of the field
  // app — every endpoint requires a token, so staying here just shows blank
  // screens or 401-error toasts forever.
  useEffect(() => {
    if (isLoaded && !isSignedIn) {
      router.replace("/sign-in");
    }
  }, [isLoaded, isSignedIn, router]);

  const handleSignOut = async () => {
    await signOut();
    router.replace("/");
  };

  return (
    <OrganizationProvider>
      <BackgroundLocationProvider>
        <Box
          sx={{
            minHeight: "100vh",
            width: "100%",
            display: "flex",
            flexDirection: "column",
            bgcolor: "background.default",
          }}
        >
          <Tooltip title="Sign out">
            <IconButton
              aria-label="Sign out"
              size="small"
              onClick={handleSignOut}
              sx={{
                position: "fixed",
                top: 8,
                right: 8,
                zIndex: 1200,
                color: "text.secondary",
                bgcolor: "background.paper",
                boxShadow: 1,
                "&:hover": { bgcolor: "background.paper" },
              }}
            >
              <LogoutIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          {children}
        </Box>
      </BackgroundLocationProvider>
    </OrganizationProvider>
  );
}
