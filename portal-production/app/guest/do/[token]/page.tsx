"use client";

/**
 * View-only Delivery Order page (2026). A no-login recipient with only the
 * tokenised URL sees the DO rendered EXACTLY as the portal preview does — the
 * Biofuel replica layout when the org matches, inline proof photos with
 * click-to-zoom, and the same header/footer. There is NO dashboard, nav,
 * sidebar, link elsewhere in the app, or action of any kind: the page only
 * fetches a read-only payload from a GET endpoint and renders it. A revoked or
 * unknown token shows a single neutral message that reveals nothing about
 * whether the token ever existed.
 */

import React, { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Box, Card, CircularProgress, Container, Typography } from "@mui/material";
import { request } from "@/helpers/request";
import CleanDocumentPreview from "@/containers/DocumentTemplates/components/CleanDocumentPreview";

interface PublicDocView {
  state: "ok" | "revoked" | "notfound";
  documentType?: string;
  data?: any;
  organization?: any;
  maintenanceReports?: any[];
}

function NeutralMessage() {
  return (
    <Container maxWidth="sm" sx={{ py: 8 }}>
      <Card sx={{ p: 4, textAlign: "center" }}>
        <Typography variant="h6" fontWeight={700} gutterBottom>
          Link not available
        </Typography>
        <Typography variant="body2" color="text.secondary">
          This link is not available. Please ask the sender for a current one.
        </Typography>
      </Card>
    </Container>
  );
}

export default function PublicDocumentViewPage() {
  const params = useParams();
  const token = params?.token as string;

  const [view, setView] = useState<PublicDocView | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const res: any = await request({ path: `/public/document/${token}`, method: "GET" }, {});
      const v = (res?.data ?? res) as PublicDocView;
      setView(v);
    } catch {
      // Any transport/parse failure collapses to the same neutral message — no
      // stack traces, no hint about whether the token existed.
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 10 }}>
        <CircularProgress />
      </Box>
    );
  }

  // Revoked, not-found, or any failure all render the same neutral message.
  if (failed || !view || view.state !== "ok") {
    return <NeutralMessage />;
  }

  return (
    // The app's <body class="ROOT_LAYOUT"> is `display:flex; width:100vw`, so
    // this wrapper is a flex ITEM. Without flexGrow it shrinks to the document's
    // width and hugs the left, leaving the raw body background beside it. flexGrow
    // makes it fill the full viewport (page background spans the whole width);
    // the document's own Paper (margin: 0 auto) then centres inside it. minWidth:0
    // + overflowX let a viewport narrower than the A4 page scroll horizontally
    // instead of being clipped. The Paper's own width is untouched.
    <Box sx={{ flexGrow: 1, minWidth: 0, minHeight: "100vh", bgcolor: "#f5f5f5", py: { xs: 1, sm: 3 }, overflowX: "auto" }}>
      <CleanDocumentPreview
        documentType={view.documentType || "DO"}
        data={view.data || {}}
        organization={view.organization}
        maintenanceReports={view.maintenanceReports}
        publicShareToken={token}
      />
    </Box>
  );
}
