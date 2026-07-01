"use client";

// Read-only Delivery Order view for the field app. Reached from the scan/asset
// screen's "View Delivery Order" card. Reuses the office DO renderer
// (CleanDocumentPreview) with the same fetch + transform pipeline as the portal
// view page — line items, customer, and the Proof-of-Delivery signature block —
// in a scrollable container. Purely read-only: no edit / sign / delete actions.
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { Alert, Box, Button, CircularProgress, IconButton, Stack, Typography } from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { request } from "@/helpers/request";
import CleanDocumentPreview from "@/containers/DocumentTemplates/components/CleanDocumentPreview";
import { transformBackendDataForForm } from "@/containers/DocumentTemplates/utils/documentDataTransformer";

// CleanDocumentPreview renders every branch at a fixed A4 Paper width
// (`width: "210mm"` ≈ 794px @96dpi). On a phone that overflows → the doc opens
// zoomed-in with horizontal scroll. This field read-only view therefore scales
// the whole document down to fit the viewport WIDTH by default; pinch-zoom still
// works to inspect detail. The office preview + print/PDF paths are untouched —
// they keep the fixed A4 width (this scaling lives only in this page).
const DOC_WIDTH_PX = 794; // 210mm @ 96dpi — CleanDocumentPreview's fixed Paper width

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

  // Fit-to-width scaling (field/mobile). scrollRef measures the available width;
  // paperRef is the fixed-A4 render whose height we read to reserve the scaled
  // layout box (a CSS transform doesn't shrink the layout box on its own).
  const scrollRef = useRef<HTMLDivElement>(null);
  const paperRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [scaledHeight, setScaledHeight] = useState<number | undefined>(undefined);

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

  // Recompute the fit-to-width scale on container resize / rotation and whenever
  // the rendered content height changes (e.g. logo/images load late). scale =
  // min(1, availableWidth / A4width): the whole DO fits horizontally, and we
  // never upscale past 1 (so a wide screen keeps the natural A4 look).
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    const paper = paperRef.current;
    if (!scroller || !paper) return;
    const recompute = () => {
      const avail = scroller.clientWidth; // no horizontal padding ⇒ true usable width
      const s = avail > 0 ? Math.min(1, avail / DOC_WIDTH_PX) : 1;
      setScale(s);
      setScaledHeight(paper.offsetHeight * s); // offsetHeight = pre-transform (natural) height
    };
    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(scroller);
    ro.observe(paper);
    return () => ro.disconnect();
  }, [data, variant, maintenanceReports]);

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

      {/* Scrollable read-only preview, fit-to-width by default. The inner Paper
          renders at fixed A4 width and is CSS-scaled down to the viewport; the
          wrapper reserves the SCALED box so scrolling/centering stay correct.
          No horizontal padding ⇒ scrollRef.clientWidth is the true usable width.
          Pinch-zoom still works to inspect detail. */}
      <Box ref={scrollRef} sx={{ flex: 1, overflow: "auto", py: 2, bgcolor: "#f5f5f5" }}>
        <Box sx={{ width: DOC_WIDTH_PX * scale, height: scaledHeight, mx: "auto" }}>
          <Box
            ref={paperRef}
            sx={{
              width: DOC_WIDTH_PX,
              transformOrigin: "top left",
              transform: `scale(${scale})`,
              bgcolor: "#fff",
              boxShadow: 1,
            }}
          >
            <CleanDocumentPreview
              documentType={variant}
              data={data}
              organization={organization}
              maintenanceReports={maintenanceReports}
            />
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
