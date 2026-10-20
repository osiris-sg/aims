"use client";

import React, { useEffect } from "react";
import { Box, GlobalStyles, IconButton, Tooltip } from "@mui/material";
import LogoutIcon from "@mui/icons-material/Logout";
import { ThemeProvider } from "@mui/material/styles";
import { useAuth, useClerk } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { OrganizationProvider } from "../../portal/context/OrganizationContext";
import { BackgroundLocationProvider } from "../context/BackgroundLocationContext";
import { PushNotificationsProvider, unregisterDeviceToken } from "../context/PushNotificationsContext";
import { useRoleGate } from "../../portal/hooks/useRoleGate";
import { useThemeMode } from "@/contexts/ThemeModeContext";
import { fieldDarkTheme, fieldLightTheme } from "@/themes/fieldTheme";

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
export default function FieldShell({ children }: Props) {
  const router = useRouter();
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const { signOut } = useClerk();
  const { onlyNormalUser } = useRoleGate();
  const { mode } = useThemeMode();
  const fieldTheme = mode === "dark" ? fieldDarkTheme : fieldLightTheme;

  // If Clerk has loaded and the user isn't signed in, bounce out of the field
  // app — every endpoint requires a token, so staying here just shows blank
  // screens or 401-error toasts forever.
  useEffect(() => {
    if (isLoaded && !isSignedIn) {
      router.replace("/sign-in");
    }
  }, [isLoaded, isSignedIn, router]);

  // A document-submit-only user has no business in the field flow — send them
  // to their own app (mirrors FieldOnlyGuard bouncing them out of /portal).
  useEffect(() => {
    if (onlyNormalUser) router.replace("/submit");
  }, [onlyNormalUser, router]);

  const handleSignOut = async () => {
    // Drop this device's push token BEFORE signOut(): the DELETE is
    // authenticated, so once the Clerk session is gone there is no way to name
    // the token any more and the row would linger until FCM reports it dead.
    // Never allowed to block the sign-out itself.
    await unregisterDeviceToken(getToken);
    await signOut();
    router.replace("/");
  };

  return (
    <OrganizationProvider>
      <BackgroundLocationProvider>
        <PushNotificationsProvider>
          {/* The field app's own look (SiteClock-style, themes/fieldTheme).
              Scoped to this route group: the office portal keeps its theme,
              and the printed documents re-enter it via OfficeThemeScope. */}
          <ThemeProvider theme={fieldTheme}>
            <GlobalStyles
              styles={{
                body: { backgroundColor: fieldTheme.palette.background.default, color: fieldTheme.palette.text.primary },
                // react-toastify, themed like SiteClock's floating snackbars.
                ".Toastify__toast": {
                  borderRadius: 12,
                  fontFamily: fieldTheme.typography.fontFamily,
                  fontSize: 14,
                  fontWeight: 500,
                  minHeight: 52,
                  boxShadow: "0 6px 20px rgba(0,0,0,0.18)",
                  margin: "0 12px 8px",
                },
                ".Toastify__toast-container--top-center": { top: "calc(8px + env(safe-area-inset-top, 0px))" },
                ".Toastify__toast-theme--light": {
                  background: fieldTheme.palette.mode === "dark" ? "#2A2F36" : "#1F2933",
                  color: "#F4F6F9",
                },
                ".Toastify__toast-theme--dark": { background: "#E3E6EB", color: "#1A1C1F" },
                ".Toastify__close-button": { color: "inherit", opacity: 0.7 },
              }}
            />
            <Box
              sx={{
                minHeight: "100vh",
                width: "100%",
                display: "flex",
                flexDirection: "column",
                bgcolor: "background.default",
                color: "text.primary",
                fontFamily: fieldTheme.typography.fontFamily,
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
              {/* Field-flow toasts (e.g. "Item created and assigned to …"). Lives
                  at the layout level so a toast fired right before a
                  router.replace survives the navigation. */}
              <ToastContainer
                position="top-center"
                autoClose={3000}
                hideProgressBar
                newestOnTop
                closeOnClick
                pauseOnFocusLoss={false}
                draggable
                theme={mode === "dark" ? "dark" : "light"}
              />
            </Box>
          </ThemeProvider>
        </PushNotificationsProvider>
      </BackgroundLocationProvider>
    </OrganizationProvider>
  );
}
