"use client";

// PUBLIC (no login): the client's live project schedule. The token URL is
// shared by the designer on WhatsApp; every visit renders the LATEST calendar,
// so shifted/changed dates are always up to date. Paper-styled on purpose.

import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Alert, Box, CircularProgress, Container } from "@mui/material";

export default function PublicSchedulePage() {
  const { token } = useParams<{ token: string }>();
  const base = process.env.NEXT_PUBLIC_BACKEND_API_URL;
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${base}/public/schedule/${token}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json?.message || "This link is not valid");
        setHtml((json?.data ?? json)?.html || "");
      } catch (e: any) {
        setError(e.message || "This link is not valid");
      }
    })();
  }, [base, token]);

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "#f3f4f6", py: { xs: 0, md: 3 } }}>
      <Container maxWidth="lg" disableGutters>
        {error && <Alert severity="warning" sx={{ m: 2 }}>{error} — please ask your designer for an updated link.</Alert>}
        {!html && !error && (
          <Box sx={{ display: "flex", justifyContent: "center", pt: 10 }}>
            <CircularProgress />
          </Box>
        )}
        {html && <iframe title="Project schedule" srcDoc={html} sandbox="allow-same-origin" style={{ width: "100%", height: "96vh", border: 0, background: "#fff" }} />}
      </Container>
    </Box>
  );
}
