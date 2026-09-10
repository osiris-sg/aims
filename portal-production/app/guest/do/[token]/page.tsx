"use client";

/**
 * View-only Delivery Order page (2026). A no-login recipient with only the
 * tokenised URL sees the DO rendered EXACTLY as the portal preview does — the
 * Biofuel replica layout when the org matches, inline proof photos with
 * click-to-zoom, and the same header/footer. There is NO dashboard, nav,
 * sidebar or link elsewhere in the app. A revoked or unknown token shows a
 * single neutral message that reveals nothing about whether the token ever
 * existed.
 *
 * The ONE action available here (2026-09) is signing: when the DO carries no
 * signature the RECEIVED BY box becomes clickable and the customer signs in
 * place. That posts to a single token-scoped endpoint which writes signature
 * fields and nothing else — it does not finalise the run, mint a document or
 * trigger an invoice. Everything else on the page remains read-only.
 */

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import {
  Alert,
  Box,
  Button,
  Card,
  CircularProgress,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  GlobalStyles,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import PictureAsPdfIcon from "@mui/icons-material/PictureAsPdf";
import { useReactToPrint } from "react-to-print";
import { request } from "@/helpers/request";
import CleanDocumentPreview from "@/containers/DocumentTemplates/components/CleanDocumentPreview";
import SignaturePadField, { type SignaturePadHandle } from "@/components/delivery/SignaturePadField";

// CleanDocumentPreview renders the DO at a fixed A4 Paper width
// (`width: "210mm"` ≈ 794px @96dpi). On a phone that overflows, so the customer
// used to see only the left half and had to scroll sideways. This guest page
// therefore scales the WHOLE document down to fit the viewport width — the full
// page is visible like a PDF viewer, and native pinch-zoom still works for
// detail (we add no touch-action lock and no custom pinch handler, and the route
// sets no maximum-scale). At/above the document width nothing scales — desktop
// centering is unchanged. The Paper's own width is never touched.
const DOC_WIDTH_PX = 794; // 210mm @ 96dpi — CleanDocumentPreview's fixed Paper width

// Print sheet rules for the guest DO.
//
// This used to set `@page { margin: 0 }` so that a RIGID 210×297mm Paper mapped
// 1:1 onto the sheet — an EXACT fit with zero tolerance. That only holds while
// nothing at all reduces the printable area, and plenty does: a margin chosen in
// the print dialog, a printer's unprintable ring, sub-pixel rounding of 210mm.
// When it did, Chrome clipped the overflow (right edge cut mid-word, footer gone)
// while Safari quietly shrink-to-fit, which is exactly the browser inconsistency
// we must not depend on.
//
// Now the page box reserves a 6mm ring for the printer and CleanDocumentPreview's
// DO sheet is 186×277mm inside the resulting 198×285mm band — genuinely smaller
// than the paper, so there is real tolerance on every edge and no engine ever has
// to scale. The DO override below must out-specify the shared
// `[data-print-paper] { padding: 0 }` rule, which the other document types still
// rely on; `[data-print-paper][data-print-sheet="do"]` does that regardless of
// source order. Blank margin boxes suppress the browser URL/date header.
const PRINT_PAGE_STYLE = `
  @page {
    size: A4;
    margin: 6mm;
    @top-left { content: ""; }
    @top-center { content: ""; }
    @top-right { content: ""; }
    @bottom-left { content: ""; }
    @bottom-center { content: ""; }
    @bottom-right { content: ""; }
  }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; margin: 0; padding: 0; }
    [data-print-paper] { padding: 0 !important; }
    [data-print-paper][data-print-sheet="do"] {
      width: 186mm !important;
      min-height: 0 !important;
      margin: 0 auto !important;
      padding: 8mm !important;
    }
  }
`;

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

  // ── Signing ──────────────────────────────────────────────────────────────
  // Local to this page ON PURPOSE: CleanDocumentPreview is shared with the
  // authenticated portal and must stay a pure renderer that never POSTs. It
  // raises onSignRequest; the token, the dialog and the write live here.
  const [signOpen, setSignOpen] = useState(false);
  const [signName, setSignName] = useState("");
  // Defaults to today in the BROWSER's timezone. toISOString() would render the
  // UTC day, which is yesterday for anyone west of Greenwich after 00:00 local.
  const todayLocal = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const [signDate, setSignDate] = useState(todayLocal);
  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);
  const padRef = useRef<SignaturePadHandle>(null);

  const openSignDialog = useCallback(() => {
    setSignName("");
    setSignDate(todayLocal());
    setSignError(null);
    setSignOpen(true);
  }, []);

  const submitSignature = useCallback(async () => {
    setSignError(null);
    const name = signName.trim();
    if (!name) {
      setSignError("Please enter the name of the person signing.");
      return;
    }
    if (!padRef.current || padRef.current.isEmpty()) {
      setSignError("Please sign in the box above.");
      return;
    }
    const signature = padRef.current.toDataUrl();
    setSigning(true);
    try {
      const res: any = await request(
        { path: `/public/document/${token}/sign`, method: "POST" },
        { name, signature, signedDate: signDate || undefined },
      );
      const body = res?.data ?? res;
      // The shared request helper does NOT throw on an HTTP error — it resolves
      // to { success: false, message }. Branch on that FIRST, or a 400/429 would
      // read as a success and the dialog would close on a write that never
      // happened.
      if (body?.success === false) {
        setSignError(body?.message || "Could not save the signature. Please try again.");
        return;
      }
      if (body?.ok === false) {
        // The backend reports "already signed" rather than succeeding silently,
        // so surface it and refresh — the box below will render the signature
        // that beat us to it.
        setSignError(body?.message || "This delivery order could not be signed.");
        await load();
        return;
      }
      setSignOpen(false);
      // Refetch rather than patching local state: the signature the customer now
      // sees is the one the server stored, read back the same way every other
      // viewer will read it.
      await load();
    } catch (e: any) {
      setSignError(e?.message || "Could not save the signature. Please try again.");
    } finally {
      setSigning(false);
    }
  }, [signName, signDate, token, load]);

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

  // Download-as-PDF: the SAME mechanism as the portal editor's Print/PDF —
  // react-to-print clones ONLY the document subtree (printContentRef) into a
  // print frame with PRINT_PAGE_STYLE, so the customer saves it as PDF from the
  // browser dialog. Because only the subtree is printed, the on-screen scale
  // transform, page background and floating button never reach the sheet.
  // There is NO server PDF renderer for DOs (that is OSI-87, out of scope).
  const printContentRef = useRef<HTMLDivElement>(null);
  const handleDownloadPdf = useReactToPrint({
    contentRef: printContentRef,
    documentTitle: view?.data?.name || "Delivery Order",
    pageStyle: PRINT_PAGE_STYLE,
  });

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
      {/* Fallback for a customer who presses Cmd/Ctrl+P instead of the button:
          the same sheet rules as PRINT_PAGE_STYLE (A4 with a 6mm printer ring,
          and the DO sheet sized to 186×277mm inside it — see PRINT_PAGE_STYLE
          for why an exact 210×297mm fit was the bug) so both paths print
          identically at any viewport and in any browser.
          The body reset drops the app's flex/100vh shell and the grey page
          background so the print is the document only; print-color-adjust:exact
          keeps the document's grey header bars/borders. CleanDocumentPreview is
          shared with the portal and is NOT touched. */}
      <GlobalStyles
        styles={{
          "@media print": {
            "@page": { size: "A4", margin: "6mm" },
            "[data-print-paper]": { padding: "0 !important" },
            '[data-print-paper][data-print-sheet="do"]': {
              width: "186mm !important",
              minHeight: "0 !important",
              margin: "0 auto !important",
              padding: "8mm !important",
            },
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
            {/* Print root: react-to-print clones THIS subtree only, so it sits
                inside the transformed box (the transform is on the parent and
                is not cloned) — exactly how the portal wraps the preview. */}
            <div ref={printContentRef}>
              <CleanDocumentPreview
                documentType={view.documentType || "DO"}
                data={view.data || {}}
                organization={view.organization}
                maintenanceReports={view.maintenanceReports}
                publicShareToken={token}
                onSignRequest={openSignDialog}
              />
            </div>
          </Box>
        </Box>
      </Box>

      {/* Signing dialog. Rendered in a portal, so the page's fit-to-width scale
          transform does not affect it and the pad is full size on a phone. */}
      <Dialog open={signOpen} onClose={() => !signing && setSignOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Sign this delivery order</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {signError && <Alert severity="error">{signError}</Alert>}
            <TextField
              label="Name"
              size="small"
              fullWidth
              autoFocus
              value={signName}
              onChange={(e) => setSignName(e.target.value)}
              disabled={signing}
              inputProps={{ maxLength: 120 }}
            />
            <Box>
              <Typography variant="caption" sx={{ color: "text.secondary" }}>
                Signature
              </Typography>
              <SignaturePadField ref={padRef} />
              <Button size="small" onClick={() => padRef.current?.clear()} disabled={signing} sx={{ mt: 0.5 }}>
                Clear
              </Button>
            </Box>
            <TextField
              label="Date"
              type="date"
              size="small"
              fullWidth
              value={signDate}
              onChange={(e) => setSignDate(e.target.value)}
              disabled={signing}
              InputLabelProps={{ shrink: true }}
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setSignOpen(false)} disabled={signing}>
            Cancel
          </Button>
          <Button variant="contained" onClick={submitSignature} disabled={signing}>
            {signing ? "Saving…" : "Sign"}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
