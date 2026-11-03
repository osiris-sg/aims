"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import React, { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth, useClerk, useSignIn, useUser } from "@clerk/nextjs";
import { request } from "@/helpers/request";
import { Alert, Box, Button, CircularProgress, Paper, Stack, TextField, Typography } from "@mui/material";

/**
 * "Set your password" (2026-11-03). A person added with "Add user" whose email
 * had no login gets an email with a one-time link here (?ticket=<Clerk sign-in
 * token>, 7 days). The ticket signs them in, then they choose a password.
 * A login whose password the admin set at Add user replaces it once through
 * POST /users/me/first-password (Clerk itself would ask for the current one).
 * Public in middleware.ts: the visitor is not signed in when they arrive.
 */
type Stage = "working" | "form" | "done" | "hasPassword" | "otherSession" | "badLink";

const clerkMessage = (e: any, fallback: string) => e?.errors?.[0]?.longMessage || e?.errors?.[0]?.message || e?.message || fallback;

function SetPassword() {
  const ticket = useSearchParams().get("ticket");
  const { isLoaded: signInLoaded, signIn, setActive } = useSignIn();
  const { isLoaded: userLoaded, isSignedIn, user } = useUser();
  const { signOut } = useClerk();
  const { getToken } = useAuth();
  // Signed in by this page's ticket with a password already set: the admin set it, so the server replaces it.
  const [viaServer, setViaServer] = useState(false);
  const [stage, setStage] = useState<Stage>("working");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const usedTicket = useRef(false);

  useEffect(() => {
    if (!signInLoaded || !userLoaded) return;
    if (isSignedIn) {
      // Already signed in when the link was opened: a login with no password (the new person, e.g. after a
      // reload) chooses one; an account that has a password is someone else here, who must sign out first.
      if (user?.passwordEnabled) {
        if (usedTicket.current) {
          setViaServer(true);
          return setStage("form");
        }
        return setStage(ticket ? "otherSession" : "hasPassword");
      }
      return setStage("form");
    }
    if (!ticket) return setStage("badLink");
    if (usedTicket.current) return;
    usedTicket.current = true;
    (async () => {
      try {
        const res = await signIn!.create({ strategy: "ticket", ticket });
        if (res.status === "complete" && res.createdSessionId) await setActive!({ session: res.createdSessionId });
        else setStage("badLink");
      } catch {
        setStage("badLink");
      }
    })();
  }, [signInLoaded, userLoaded, isSignedIn, ticket, user, signIn, setActive]);

  const save = async () => {
    setError(null);
    if (password.length < 8) return setError("Use at least 8 characters.");
    if (password !== confirm) return setError("The two passwords are not the same.");
    setBusy(true);
    try {
      if (viaServer) {
        const token = await getToken();
        const res: any = await request({ method: "POST", path: "/users/me/first-password" }, { newPassword: password }, token ?? undefined);
        if (res?.success === false) {
          if (res?.details?.statusCode === 403 || /Forgot password/.test(String(res?.message))) return setStage("hasPassword");
          throw new Error(res?.message || "The password could not be saved. Please try again.");
        }
        await user?.reload();
      } else {
        await user!.updatePassword({ newPassword: password, signOutOfOtherSessions: false } as any);
      }
      setStage("done");
    } catch (e: any) {
      setError(clerkMessage(e, "The password could not be saved. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  const email = user?.primaryEmailAddress?.emailAddress;
  const goToAims = (
    <Button variant="contained" href="/portal">
      Go to AIMS
    </Button>
  );

  return (
    <Paper variant="outlined" sx={{ p: 4, width: "100%", maxWidth: 420, bgcolor: "background.paper" }}>
      <Typography variant="h5" sx={{ fontWeight: 600, mb: 2 }}>
        Set your password
      </Typography>
      {stage === "working" && (
        <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
          <CircularProgress size={28} />
        </Box>
      )}
      {stage === "form" && (
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            {viaServer
              ? "Your admin set a password for you. Choose your own to replace it."
              : email
                ? `Choose a password for ${email}.`
                : "Choose a password for your AIMS login."}
          </Typography>
          <TextField label="New password" type="password" size="small" fullWidth autoFocus autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <TextField label="Confirm password" type="password" size="small" fullWidth autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} />
          {error && <Alert severity="warning">{error}</Alert>}
          <Button variant="contained" onClick={save} disabled={busy}>
            {busy ? <CircularProgress size={18} /> : "Save password"}
          </Button>
        </Stack>
      )}
      {stage === "done" && (
        <Stack spacing={2}>
          <Alert severity="success">{email ? `Your password is set. Next time, sign in with ${email} and this password.` : "Your password is set."}</Alert>
          {goToAims}
        </Stack>
      )}
      {stage === "hasPassword" && (
        <Stack spacing={2}>
          <Typography variant="body2">You already have a password. To change it, use &quot;Forgot password&quot; on the sign-in page.</Typography>
          {goToAims}
        </Stack>
      )}
      {stage === "otherSession" && (
        <Stack spacing={2}>
          <Typography variant="body2">
            {email ? `You are signed in as ${email}.` : "Another account is signed in on this browser."} Sign out to use this link.
          </Typography>
          <Button variant="contained" onClick={() => signOut({ redirectUrl: window.location.href })}>
            Sign out and continue
          </Button>
        </Stack>
      )}
      {stage === "badLink" && (
        <Stack spacing={2}>
          <Typography variant="body2">This link has expired or was already used. Use &quot;Forgot password&quot; on the sign-in page with your email address, or ask your admin.</Typography>
          <Button variant="contained" href="/sign-in">
            Go to sign in
          </Button>
        </Stack>
      )}
    </Paper>
  );
}

export default function Page() {
  return (
    <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", width: "100%", minHeight: "100vh", px: 2, bgcolor: "background.default" }}>
      <Suspense fallback={<CircularProgress size={28} />}>
        <SetPassword />
      </Suspense>
    </Box>
  );
}
