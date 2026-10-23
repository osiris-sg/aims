"use client";

// Round AD — the short link in a WhatsApp push: https://app.ai-ms.io/go/<token>. Behind Clerk (middleware.ts
// protects everything but the public token pages), so a signed-out person lands on sign-in first. The backend
// resolves the token only for a member of the link's org (or an osiris admin, whose target carries ?aorg= so the
// tab opens under that org); anything else is "expired or not yours" — the token reveals nothing by itself.

import React, { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { Box, Button, CircularProgress, Typography } from "@mui/material";
import { request } from "@/helpers/request";

export default function GoPage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    const token = String(params?.token ?? "").toLowerCase();
    if (!/^[a-z0-9]{6,12}$/.test(token)) {
      setError("This link is not valid.");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const jwt = await getToken();
        if (!jwt) throw new Error("Not signed in");
        const res = await request({ path: `/go/${token}`, method: "GET" }, {}, jwt);
        const path = String((res?.data ?? res)?.path ?? "");
        if (!res || res.success === false || !path.startsWith("/portal")) throw new Error("expired");
        if (!cancelled) router.replace(path);
      } catch {
        if (!cancelled) setError("This link has expired or is not yours.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn, params?.token, getToken, router]);

  return (
    <Box sx={{ minHeight: "60vh", display: "flex", alignItems: "center", justifyContent: "center", p: 3 }} data-tour="go-link">
      {error ? (
        <Box sx={{ textAlign: "center" }}>
          <Typography variant="body1" sx={{ mb: 2 }}>
            {error}
          </Typography>
          <Button variant="contained" onClick={() => router.replace("/portal")} sx={{ textTransform: "none" }}>
            Open AIMS
          </Button>
        </Box>
      ) : (
        <CircularProgress size={28} />
      )}
    </Box>
  );
}
