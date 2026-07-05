"use client";

import React, { useEffect } from "react";
import { Box, CircularProgress, IconButton, Tooltip } from "@mui/material";
import LogoutIcon from "@mui/icons-material/Logout";
import { useAuth, useClerk } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { useRoleGate } from "../portal/hooks/useRoleGate";

/**
 * Mobile-first shell for the "normal user" document-submit app (route: /submit).
 *
 * Isolation (mirrors FieldOnlyGuard's client-side pattern — roles are RBAC,
 * fetched from GET /users/me/roles, not Clerk metadata):
 *   - not signed in                 → /sign-in
 *   - field-tech-only               → /scan (their home)
 *   - neither normal_user nor admin → /portal
 *   - normal_user OR admin          → allowed (admins may view it too)
 *
 * The reciprocal bounces (normal_user out of /portal and /scan) live in
 * FieldOnlyGuard and (field)/layout.tsx.
 */
export default function SubmitLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { isLoaded, isSignedIn } = useAuth();
  const { signOut } = useClerk();
  const { loading, onlyFieldTech, hasNormalUser, isAdmin } = useRoleGate();

  useEffect(() => {
    if (isLoaded && !isSignedIn) router.replace("/sign-in");
  }, [isLoaded, isSignedIn, router]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || loading) return;
    if (hasNormalUser || isAdmin) return; // allowed on /submit
    if (onlyFieldTech) router.replace("/scan");
    else router.replace("/portal");
  }, [isLoaded, isSignedIn, loading, hasNormalUser, isAdmin, onlyFieldTech, router]);

  const handleSignOut = async () => {
    await signOut();
    router.replace("/");
  };

  const allowed = isLoaded && isSignedIn && !loading && (hasNormalUser || isAdmin);
  if (!allowed) {
    return (
      <Box sx={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
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
      <ToastContainer position="top-center" autoClose={3000} hideProgressBar newestOnTop closeOnClick pauseOnFocusLoss={false} draggable />
    </Box>
  );
}
