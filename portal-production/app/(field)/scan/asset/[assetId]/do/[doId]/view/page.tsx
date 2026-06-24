"use client";

// Read-only Delivery Order view for the field app. Reached from the scan/asset
// screen's "View Delivery Order" card. Reuses the office DO renderer
// (CleanDocumentPreview) with the same fetch + transform pipeline as the portal
// view page — line items, customer, and the Proof-of-Delivery signature block —
// in a scrollable container. Purely read-only: no edit / sign / delete actions.
import React, { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { Alert, Box, Button, CircularProgress, IconButton, Stack, Typography } from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { request } from "@/helpers/request";
import CleanDocumentPreview from "@/containers/DocumentTemplates/components/CleanDocumentPreview";
import { transformBackendDataForForm } from "@/containers/DocumentTemplates/utils/documentDataTransformer";

export default function ViewDeliveryOrderPage() {
  const params = useParams();
  const router = useRouter();
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const doId = params?.doId as string;

  const [data, setData] = useState<any>(null);
  const [variant, setVariant] = useState<string>("DO");
  const [maintenanceReports, setMaintenanceReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDoc = useCallback(async () => {
    if (!doId) return;
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      // Single field-gated aggregator (field-scan:access) — returns the DO
      // config, its proof-of-delivery reports, the resolved template variant,
      // and the field config in one org-scoped response. Replaces the three
      // office document/template calls the field-tech role can't hit.
      const res = await request({ path: `/maintenance-reports/do-view/${doId}`, method: "GET" }, {}, token);
      if (res?.success === false || !res?.data) {
        throw new Error(res?.message ?? "Delivery order not found");
      }
      const { document, documentNumber, status, maintenanceReports: reports, templateVariant, fieldConfig } = res.data;

      // Same transform the office view uses, so the field render matches.
      const formData = transformBackendDataForForm(document?.config ?? {}, fieldConfig);
      formData.name = documentNumber;
      formData.documentNumber = documentNumber;
      formData.status = status;

      setVariant(templateVariant || "DO");
      setData(formData);
      setMaintenanceReports(Array.isArray(reports) ? reports : []);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load delivery order");
    } finally {
      setLoading(false);
    }
  }, [doId, getToken]);

  useEffect(() => {
    fetchDoc();
  }, [fetchDoc]);

  if (loading) {
    return (
      <Box sx={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", minHeight: "60vh" }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error || !data) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{error ?? "Could not load delivery order"}</Alert>
        <Button sx={{ mt: 2 }} startIcon={<ArrowBackIcon />} onClick={() => router.back()}>
          Back
        </Button>
      </Box>
    );
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Sticky field header with a back button — read-only, no actions. */}
      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        sx={{
          p: 2,
          borderBottom: 1,
          borderColor: "divider",
          position: "sticky",
          top: 0,
          bgcolor: "background.paper",
          zIndex: 1,
        }}
      >
        <IconButton onClick={() => router.back()} size="small">
          <ArrowBackIcon />
        </IconButton>
        <Box>
          <Typography variant="h6" fontWeight={700}>Delivery Order</Typography>
          <Typography variant="caption" color="text.secondary">
            {data.documentNumber || data.name || ""} · {data.status || ""}
          </Typography>
        </Box>
      </Stack>

      {/* Scrollable read-only preview (CleanDocumentPreview is a pure renderer). */}
      <Box sx={{ flex: 1, overflow: "auto", p: 2, bgcolor: "#f5f5f5" }}>
        <Box sx={{ maxWidth: 820, mx: "auto", bgcolor: "#fff", boxShadow: 1 }}>
          <CleanDocumentPreview
            documentType={variant}
            data={data}
            organization={organization}
            maintenanceReports={maintenanceReports}
          />
        </Box>
      </Box>
    </Box>
  );
}
