"use client";

import React, { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth, useClerk, useUser } from "@clerk/nextjs";
import { Box, Button, CircularProgress, Stack, Typography } from "@mui/material";
import Image from "next/image";
import logo from "@/components/Sidebar/aims-logo.png";
import { SITECLOCK_URL } from "@/components/TopNav/AppSwitcher";

/**
 * "No AIMS account" landing (AIMS ↔ SiteClock link, 2026-10).
 *
 * AIMS and SiteClock share one Clerk instance, so a SiteClock-only user
 * (phone-only Clerk account, no AIMS User/org) can hold a valid Clerk session
 * here. The portal's org bootstrap gets the "not assigned to any organization"
 * 403 for them and FieldOnlyGuard sends them here instead of spinning.
 *
 * Deliberately OUTSIDE /portal so the OrganizationProvider and FieldOnlyGuard
 * never run on it. Clerk middleware still protects it (not in isPublicRoute),
 * and the effect below bounces a stale signed-out tab to /sign-in.
 */
export default function NoAccountPage() {
  const router = useRouter();
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();
  const { signOut } = useClerk();

  useEffect(() => {
    if (isLoaded && !isSignedIn) router.replace("/sign-in");
  }, [isLoaded, isSignedIn, router]);

  if (!isLoaded || !isSignedIn) {
    return (
      <Box sx={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", bgcolor: "background.default" }}>
        <CircularProgress />
      </Box>
    );
  }

  // The identifier they signed in with: SiteClock accounts are phone-only, AIMS
  // accounts carry an email. Show whichever exists (phone first).
  const identifier =
    user?.primaryPhoneNumber?.phoneNumber ||
    user?.phoneNumbers?.[0]?.phoneNumber ||
    user?.primaryEmailAddress?.emailAddress ||
    user?.emailAddresses?.[0]?.emailAddress ||
    "";

  return (
    <Box
      sx={{
        // width/flex: the root layout renders this as a flex item, so without
        // them the card hugs the left edge instead of centering.
        minHeight: "100vh",
        width: "100%",
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        bgcolor: "background.default",
        color: "text.primary",
        p: 2,
      }}
    >
      <Stack
        alignItems="center"
        spacing={2}
        sx={{
          width: "100%",
          maxWidth: 420,
          p: 4,
          borderRadius: 3,
          bgcolor: "background.paper",
          border: "1px solid",
          borderColor: "divider",
          textAlign: "center",
        }}
      >
        {/* The mark sits on the same navy disc as the app switcher's AIMS tile
            (the PNG is not transparent, so it needs a dark backing). */}
        <Box sx={{ width: 56, height: 56, borderRadius: "50%", bgcolor: "#041627", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Image src={logo} alt="AIMS" width={28} height={28} style={{ display: "block" }} />
        </Box>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>
          You don&apos;t have an AIMS account
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Ask your admin to add you to an AIMS organization.
        </Typography>
        {identifier && (
          <Typography variant="body2" color="text.secondary">
            Signed in as <strong>{identifier}</strong>
          </Typography>
        )}
        <Stack spacing={1} sx={{ width: "100%", pt: 1 }}>
          <Button variant="contained" href={SITECLOCK_URL} fullWidth>
            Go to SiteClock
          </Button>
          <Button variant="text" color="inherit" fullWidth onClick={() => signOut({ redirectUrl: "/sign-in" })}>
            Sign out
          </Button>
        </Stack>
      </Stack>
    </Box>
  );
}
