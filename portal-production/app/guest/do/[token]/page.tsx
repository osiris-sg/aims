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

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Box, Button, Card, CircularProgress, Container, GlobalStyles, Typography } from "@mui/material";
import PictureAsPdfIcon from "@mui/icons-material/PictureAsPdf";
import { request } from "@/helpers/request";
import CleanDocumentPreview from "@/containers/DocumentTemplates/components/CleanDocumentPreview";

// CleanDocumentPreview renders the DO at a fixed A4 Paper width
// (`width: "210mm"` ≈ 794px @96dpi). On a phone that overflows, so the customer
// used to see only the left half and had to scroll sideways. This guest page
// therefore scales the WHOLE document down to fit the viewport width — the full
// page is visible like a PDF viewer, and native pinch-zoom still works for
// detail (we add no touch-action lock and no custom pinch handler, and the route
// sets no maximum-scale). At/above the document width nothing scales — desktop
// centering is unchanged. The Paper's own width is never touched.
const DOC_WIDTH_PX = 794; // 210mm @ 96dpi — CleanDocumentPreview's fixed Paper width

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

  // Fit-to-width scaling. scrollRef measures the usable viewport width; paperRef
  // is the fixed-A4 render whose natural height we read to RESERVE the scaled
  // layout box — a CSS transform doesn't shrink the element's own box, so without
  // this the page would keep the unscaled height and leave a large empty area
  // below the document.
  const scrollRef = useRef<HTMLDivElement>(null);
  const paperRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [scaledHeight, setScaledHeight] = useState<number | undefined>(undefined);

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    const paper = paperRef.current;
    if (!scroller || !paper) return;
    const recompute = () => {
      const avail = scroller.clientWidth; // no horizontal padding ⇒ true usable width
      // min(1, …): never scale UP past the fixed A4 width, so desktop is unchanged.
      const s = avail > 0 ? Math.min(1, avail / DOC_WIDTH_PX) : 1;
      setScale(s);
      setScaledHeight(paper.offsetHeight * s); // offsetHeight = pre-transform (natural) height
    };
    recompute();
    // ResizeObserver catches viewport width changes (the scroller is flex-grow)
    // and the document's own height settling. window listeners cover the explicit
    // resize / orientation-change cases some browsers only settle after firing.
    const ro = new ResizeObserver(recompute);
    ro.observe(scroller);
    ro.observe(paper);
    window.addEventListener("resize", recompute);
    window.addEventListener("orientationchange", recompute);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", recompute);
      window.removeEventListener("orientationchange", recompute);
    };
  }, [view]);

  // Download-as-PDF: open the browser's print dialog, from which the customer
  // saves as PDF. There is NO server PDF renderer for DOs (that is OSI-87, out of
  // scope) and no new endpoint. The @media print rules below strip the scale
  // transform, the button and the page background so the print is the document
  // only, at full A4 size.
  const handleDownloadPdf = () => window.print();

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
    <>
      {/* Print rules scoped to this guest page only (CleanDocumentPreview is
          shared with the portal and is NOT touched). @page margin:0 so the
          210mm-wide document maps 1:1 onto A4 with nothing cut off — a non-zero
          page margin would push the padding-stripped 210mm Paper wider than the
          printable area and clip it. The body reset drops the app's flex/100vh
          shell and the grey page background so the print is the document only;
          print-color-adjust:exact keeps the document's grey header bars/borders. */}
      <GlobalStyles
        styles={{
          "@media print": {
            "@page": { size: "A4", margin: 0 },
            "body.ROOT_LAYOUT": {
              display: "block",
              width: "auto",
              height: "auto",
              minHeight: 0,
              margin: 0,
              padding: 0,
              background: "#fff",
              WebkitPrintColorAdjust: "exact",
              printColorAdjust: "exact",
            },
          },
        }}
      />

      {/* Floating page control — fixed to the viewport corner, clearly OUTSIDE
          the document so it reads as a page action, not part of the DO. Hidden
          in print so it never lands in the saved PDF. */}
      <Box sx={{ position: "fixed", bottom: 16, right: 16, zIndex: 1200, "@media print": { display: "none" } }}>
        <Button variant="contained" startIcon={<PictureAsPdfIcon />} onClick={handleDownloadPdf}>
          Download PDF
        </Button>
      </Box>

      {/* The app's <body class="ROOT_LAYOUT"> is `display:flex; width:100vw`, so
          this wrapper is a flex ITEM. flexGrow makes it fill the full viewport (the
          page background spans the whole width); minWidth:0 lets it shrink on a
          phone. overflowX:hidden because the document is now SCALED to fit rather
          than scrolled sideways — there is nothing to scroll horizontally, and this
          guards against a sub-pixel rounding scrollbar. (overflowY computes to auto,
          so a tall document still scrolls vertically. Native pinch-zoom is
          unaffected — it zooms the visual viewport, not this scroll container.) */}
      <Box
        ref={scrollRef}
        sx={{
          flexGrow: 1,
          minWidth: 0,
          minHeight: "100vh",
          bgcolor: "#f5f5f5",
          py: { xs: 1, sm: 3 },
          overflowX: "hidden",
          // Print: this box is the on-screen shell only. Drop the grey background,
          // padding and scroll clipping so the untransformed document below prints
          // cleanly and is never clipped.
          "@media print": { bgcolor: "transparent", p: 0, minHeight: 0, overflow: "visible", display: "block" },
        }}
      >
        {/* Outer box carries the SCALED width + reserved height and centres itself
            (mx:auto). Inner box is the fixed-A4 render, transformed from its
            top-left so the scaled content aligns to the outer box's left; centering
            is done by the outer box, not the transform. Click-to-zoom on photos and
            the route dialog are rendered by CleanDocumentPreview into a portal, so
            they are unaffected by this transform and work at any scale. */}
        <Box
          sx={{
            width: DOC_WIDTH_PX * scale,
            height: scaledHeight,
            mx: "auto",
            // Print: undo the scaled layout box so the full-size document is
            // neither clipped nor left with empty space around it.
            "@media print": { width: "auto", height: "auto", mx: 0 },
          }}
        >
          <Box
            ref={paperRef}
            sx={{
              width: DOC_WIDTH_PX,
              transformOrigin: "top left",
              transform: `scale(${scale})`,
              // Print MUST ignore the narrow-screen scale — otherwise the PDF
              // comes out shrunk (and clipped to the scaled box). Force the
              // document to full A4 size regardless of the viewport width.
              "@media print": { transform: "none", width: DOC_WIDTH_PX },
            }}
          >
            <CleanDocumentPreview
              documentType={view.documentType || "DO"}
              data={view.data || {}}
              organization={view.organization}
              maintenanceReports={view.maintenanceReports}
              publicShareToken={token}
            />
          </Box>
        </Box>
      </Box>
    </>
  );
}
