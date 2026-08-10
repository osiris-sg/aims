"use client";

import React, { useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { request } from "@/helpers/request";
import { hasNativeCamera, captureNativePhoto } from "@/app/(field)/lib/nativeCamera";
import { Alert, Box, Button, CircularProgress, Dialog, IconButton, Stack, Typography } from "@mui/material";
import PhotoCameraIcon from "@mui/icons-material/PhotoCamera";
import PhotoLibraryIcon from "@mui/icons-material/PhotoLibrary";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import DescriptionIcon from "@mui/icons-material/Description";
import CloseIcon from "@mui/icons-material/Close";

type DocType =
  | "DO"
  | "QUOTATION"
  | "INVOICE"
  | "SALES_ORDER"
  | "CREDIT_NOTE"
  | "DEBIT_NOTE"
  | "PO"
  | "PR"
  | "SAI"
  | "SAO"
  | "BILL";
type Phase = "idle" | "extracting" | "saving" | "done";

// Type strings match the portal's per-type list pages (createDocumentType in
// app/portal/sales|inventory/constants.ts) so template resolution behaves the
// same as portal uploads. All 10 resolve to a Biofuel-owned template
// (verified against createFromExtraction's resolver). DO is kept (not
// DELIVERY_ORDER) — it's what this page has always sent and resolves fine.
const TYPE_GROUPS: { group: string; types: { value: DocType; label: string }[] }[] = [
  {
    group: "Sales",
    types: [
      { value: "DO", label: "Delivery Order" },
      { value: "QUOTATION", label: "Quotation" },
      { value: "INVOICE", label: "Invoice" },
      { value: "SALES_ORDER", label: "Sales Order" },
      { value: "CREDIT_NOTE", label: "Credit Note" },
      { value: "DEBIT_NOTE", label: "Debit Note" },
    ],
  },
  {
    group: "Inventory",
    types: [
      { value: "PO", label: "Purchase Order" },
      { value: "PR", label: "Purchase Return" },
      { value: "SAI", label: "Stock Adjustment In" },
      { value: "SAO", label: "Stock Adjustment Out" },
    ],
  },
  {
    group: "Purchases",
    types: [
      // BILL takes the dedicated bills pipeline (one-call extract-create),
      // not the two-step documents flow — see the branch in submit().
      { value: "BILL", label: "Bill (supplier invoice)" },
    ],
  },
];
const TYPES = TYPE_GROUPS.flatMap((g) => g.types);

// Compression lifted from components/delivery/PhotoCaptureField (same
// rationale): phone-camera JPEGs run 4–8 MB; resize to 1280px @ q0.7 —
// typically ~200–400 KB — so the submit-time upload is fast on mobile data.
// canvas.toBlob (not toDataURL+fetch) so the Blob keeps a real MIME type.
const compressImageToBlob = (
  dataUrl: string,
  maxWidth = 1280,
  quality = 0.7,
): Promise<Blob> =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      let w = img.width;
      let h = img.height;
      if (w > maxWidth) {
        h = (h * maxWidth) / w;
        w = maxWidth;
      }
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d")?.drawImage(img, 0, 0, w, h);
      canvas.toBlob((blob) => resolve(blob ?? new Blob([], { type: "image/jpeg" })), "image/jpeg", quality);
    };
    img.src = dataUrl;
  });

const fileToDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

// Same mapping DocumentUploadDialog uses: AIMS doc type → extraction enum.
function toExtractionType(aimsType: string): string {
  const t = (aimsType || "").toUpperCase();
  if (["INVOICE", "TI", "TI2"].includes(t)) return "invoice";
  if (["DO", "DELIVERY_ORDER", "RDO"].includes(t)) return "delivery_order";
  if (["QUOTATION", "QO", "QO1", "QT"].includes(t)) return "quotation";
  if (["PO", "PURCHASE_ORDER"].includes(t)) return "purchase_order";
  return "invoice";
}

/**
 * The entire "normal user" app: pick a type → photograph it → AI-extract
 * (existing Claude pipeline) → saved as a DRAFT → "Submitted!". No customer
 * picking, no editing, no history. Reuses DocumentUploadDialog's exact
 * two-step flow (raw multipart POST /document-extraction/extract, then
 * POST /documents/from-extraction which creates a draft).
 */
export default function SubmitPage() {
  const { getToken } = useAuth();
  const [docType, setDocType] = useState<DocType | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  // Photo preview: object URL for the captured image (null for PDFs), revoked
  // on replace/unmount by the effect's cleanup. Tap opens the full-screen viewer.
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  // Sequence-gap notice from the backend (best-effort) — shown on the done
  // screen so the user can upload the numbers in between. Never blocks.
  const [sequenceWarning, setSequenceWarning] = useState<{ missing: string[]; type: string } | null>(null);
  useEffect(() => {
    if (!file || file.type === "application/pdf") {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const resetInputs = () => {
    if (cameraRef.current) cameraRef.current.value = "";
    if (galleryRef.current) galleryRef.current.value = "";
  };

  const resetAll = () => {
    setDocType(null);
    setFile(null);
    setPhase("idle");
    setErrorMsg(null);
    setSequenceWarning(null);
    resetInputs();
  };

  const backToChooser = () => {
    setDocType(null);
    setFile(null);
    setErrorMsg(null);
    resetInputs();
  };

  // `alreadySized` = the native camera already downsized this (targetWidth/Height
  // 1600, plugin-side, off the main thread) — skip the redundant main-thread
  // canvas compression, which was the post-capture stall. Gallery/file picks
  // (any size) still get compressed here.
  const pickFile = async (f: File | null, alreadySized = false) => {
    if (!f) return;
    const isPdf = f.type === "application/pdf";
    const ok = /\/(jpe?g|png|gif|webp|bmp|pdf)$/i.test(f.type) || isPdf;
    if (!ok) {
      setErrorMsg("Please use a photo (JPG/PNG) or a PDF.");
      return;
    }
    if (f.size > 10 * 1024 * 1024) {
      setErrorMsg("That file is over 10 MB — try a smaller photo.");
      return;
    }
    // Compress camera/gallery images before they sit in state, so the
    // submit-time upload is a few hundred KB, not several MB. Best-effort —
    // any failure keeps the original file. PDFs and pre-sized shots pass through.
    if (!isPdf && !alreadySized) {
      try {
        const blob = await compressImageToBlob(await fileToDataUrl(f));
        if (blob.size > 0) {
          f = new File([blob], f.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
        }
      } catch {
        // keep original
      }
    }
    setErrorMsg(null);
    setFile(f);
  };

  // "Take photo": in-app camera on native (fast, works with no external camera
  // app), else the capture <input> on web / no-camera.
  const onTakePhoto = async () => {
    if (await hasNativeCamera()) {
      try {
        const f = await captureNativePhoto();
        if (f) await pickFile(f, true);
        return;
      } catch {
        setErrorMsg("Camera unavailable — choose a photo from your gallery instead.");
        return;
      }
    }
    cameraRef.current?.click();
  };

  const submit = async () => {
    if (!file || !docType) return;
    try {
      const token = await getToken();
      if (!token) {
        setErrorMsg("You're signed out. Please sign in again.");
        return;
      }

      // BILL: dedicated one-call pipeline — POST /bills/extract-create does
      // extraction AND creates the unconfirmed bill in one step. postOnSave:
      // false = machine-intake semantics: NO journal entry until the office
      // reviews it (an OCR misread must never touch the books). The office
      // finds it in Bills → Unconfirmed / the Posting Queue.
      if (docType === "BILL") {
        setPhase("extracting");
        const dataUrl = await fileToDataUrl(file);
        const res = await request(
          { path: "/bills/extract-create", method: "POST" },
          { base64: dataUrl, mediaType: file.type, filename: file.name, postOnSave: false },
          token
        );
        if (!res?.success || !res?.data?.id) {
          throw new Error(res?.message || "Failed to save the bill");
        }
        setPhase("done");
        return;
      }

      // 1) Extract — raw multipart POST (the request helper doesn't do FormData).
      setPhase("extracting");
      const fd = new FormData();
      fd.append("document", file);
      fd.append("documentType", toExtractionType(docType));
      const apiBase = process.env.NEXT_PUBLIC_BACKEND_API_URL || "http://localhost:4040";
      const extractRes = await fetch(`${apiBase}/document-extraction/extract`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const extractJson = await extractRes.json();
      if (!extractRes.ok || !extractJson?.success) {
        throw new Error(extractJson?.message || "Extraction failed");
      }
      const extracted = extractJson?.data?.data || extractJson?.data;
      const sourceFileUrl =
        extractJson?.data?.metadata?.sourceFileUrl ?? extractJson?.metadata?.sourceFileUrl ?? null;

      // 2) Save as a DRAFT (from-extraction → createBasicDocument, status draft).
      setPhase("saving");
      const saveRes = await request(
        { path: "/documents/from-extraction", method: "POST" },
        { type: docType, extracted, sourceFileUrl },
        token
      );
      if (!saveRes?.success || !saveRes?.data?.id) {
        throw new Error(saveRes?.message || "Failed to save");
      }
      // Best-effort sequence-gap notice — shown on the done screen (additive;
      // absent when there's no gap or it couldn't be determined).
      const warn = saveRes?.data?.sequenceWarning;
      if (warn?.missing?.length) setSequenceWarning(warn);
      setPhase("done");
    } catch (err: any) {
      console.error("Submit flow failed:", err);
      setErrorMsg("Something went wrong. Please try again.");
      setPhase("idle");
    }
  };

  const busy = phase === "extracting" || phase === "saving";
  const currentLabel = TYPES.find((t) => t.value === docType)?.label ?? "document";

  // ── Submitted! ──────────────────────────────────────────────────────────
  if (phase === "done") {
    return (
      <Box
        sx={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          p: 3,
          gap: 2,
        }}
      >
        <CheckCircleIcon sx={{ fontSize: 96, color: "success.main" }} />
        <Typography variant="h4" fontWeight={700}>
          Submitted!
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Your {currentLabel.toLowerCase()} was sent for review.
        </Typography>
        {sequenceWarning && (
          <Alert severity="warning" sx={{ maxWidth: 360, width: "100%", textAlign: "left" }}>
            Heads up — {sequenceWarning.missing.join(", ")}{" "}
            {sequenceWarning.missing.length === 1 ? "looks" : "look"} missing before this one. If you have{" "}
            {sequenceWarning.missing.length === 1 ? "it" : "them"}, upload{" "}
            {sequenceWarning.missing.length === 1 ? "it" : "them"} too.
          </Alert>
        )}
        <Button
          variant="contained"
          size="large"
          onClick={resetAll}
          sx={{ maxWidth: 360, width: "100%", mt: 2, py: 1.5, fontSize: "1.1rem" }}
        >
          Submit another
        </Button>
      </Box>
    );
  }

  // ── Processing ──────────────────────────────────────────────────────────
  if (busy) {
    return (
      <Box
        sx={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          p: 3,
          gap: 2,
        }}
      >
        <CircularProgress size={56} />
        <Typography variant="h6">{phase === "extracting" ? "Reading your document…" : "Saving…"}</Typography>
        <Typography variant="body2" color="text.secondary">
          This can take a few seconds.
        </Typography>
      </Box>
    );
  }

  // ── Type chooser ────────────────────────────────────────────────────────
  if (!docType) {
    // 10 types: top-aligned scrollable list (centering would clip on phones),
    // grouped Sales / Inventory with the original 3 first under Sales.
    return (
      <Box sx={{ minHeight: "100vh", display: "flex", flexDirection: "column", p: 3, pt: 4, gap: 2.5 }}>
        <Box textAlign="center">
          <Typography variant="h5" fontWeight={700}>
            Submit a document
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Choose what you&apos;re submitting.
          </Typography>
        </Box>
        {TYPE_GROUPS.map((g) => (
          <Box key={g.group}>
            <Typography
              variant="overline"
              color="text.secondary"
              sx={{ display: "block", mb: 1, letterSpacing: 1 }}
            >
              {g.group}
            </Typography>
            <Stack spacing={1.5}>
              {g.types.map((t) => (
                <Button
                  key={t.value}
                  variant="outlined"
                  size="large"
                  fullWidth
                  startIcon={<DescriptionIcon />}
                  onClick={() => {
                    setErrorMsg(null);
                    setDocType(t.value);
                  }}
                  sx={{ py: 1.75, fontSize: "1.05rem", justifyContent: "flex-start", pl: 3 }}
                >
                  {t.label}
                </Button>
              ))}
            </Stack>
          </Box>
        ))}
      </Box>
    );
  }

  // ── Capture ─────────────────────────────────────────────────────────────
  return (
    <Box
      sx={{
        // 100dvh tracks the VISIBLE mobile viewport (URL bar expanded or not);
        // plain 100vh overflows it by the bar height and hid the Submit button
        // below the fold. vh stays as the fallback for pre-dvh browsers.
        minHeight: "100vh",
        "@supports (min-height: 100dvh)": { minHeight: "100dvh" },
        display: "flex",
        flexDirection: "column",
        p: 3,
        pb: 0, // the sticky footer bar carries its own bottom padding
        gap: 2,
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <IconButton onClick={backToChooser} aria-label="Back" size="small">
          <ArrowBackIcon />
        </IconButton>
        <Typography variant="h6" fontWeight={700}>
          {currentLabel}
        </Typography>
      </Box>

      {/* Camera-first: `capture="environment"` opens the rear camera on mobile. */}
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: "none" }}
        onChange={(e) => void pickFile(e.target.files?.[0] || null)}
      />
      {/* Fallback: gallery / files, PDFs allowed. */}
      <input
        ref={galleryRef}
        type="file"
        accept="image/*,application/pdf,.pdf"
        style={{ display: "none" }}
        onChange={(e) => void pickFile(e.target.files?.[0] || null)}
      />

      <Stack spacing={2} sx={{ mt: 1 }}>
        <Button
          variant="contained"
          size="large"
          fullWidth
          startIcon={<PhotoCameraIcon />}
          onClick={() => void onTakePhoto()}
          sx={{ py: 2.5, fontSize: "1.15rem" }}
        >
          Take photo
        </Button>
        <Button
          variant="outlined"
          size="large"
          fullWidth
          startIcon={<PhotoLibraryIcon />}
          onClick={() => galleryRef.current?.click()}
          sx={{ py: 1.75 }}
        >
          Choose from gallery / files
        </Button>
      </Stack>

      {/* Image: tappable thumbnail preview. PDFs keep the icon card. */}
      {file && previewUrl && (
        <Box
          onClick={() => setViewerOpen(true)}
          sx={{
            mt: 1,
            border: "1px solid",
            borderColor: "divider",
            borderRadius: 1,
            overflow: "hidden",
            cursor: "pointer",
          }}
        >
          <Box
            component="img"
            src={previewUrl}
            alt="Captured document"
            sx={{ display: "block", width: "100%", maxHeight: 260, objectFit: "contain", bgcolor: "grey.100" }}
          />
          <Box sx={{ px: 1.5, py: 1, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Typography variant="caption" color="text.secondary" noWrap sx={{ mr: 1 }}>
              {file.name} · {(file.size / 1024).toFixed(0)} KB
            </Typography>
            <Typography variant="caption" color="primary" sx={{ flexShrink: 0 }}>
              Tap to view
            </Typography>
          </Box>
        </Box>
      )}
      {file && !previewUrl && (
        <Box
          sx={{
            mt: 1,
            p: 2,
            border: "1px solid",
            borderColor: "divider",
            borderRadius: 1,
            display: "flex",
            alignItems: "center",
            gap: 1,
          }}
        >
          <DescriptionIcon color="action" />
          <Box sx={{ overflow: "hidden" }}>
            <Typography variant="body2" noWrap>
              {file.name}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {(file.size / 1024).toFixed(0)} KB
            </Typography>
          </Box>
        </Box>
      )}

      {errorMsg && (
        <Typography variant="body2" color="error">
          {errorMsg}
        </Typography>
      )}

      {/* Sticky submit bar: always visible regardless of content height or the
          mobile URL bar; safe-area padding clears iOS home indicators. */}
      <Box
        sx={{
          position: "sticky",
          bottom: 0,
          mt: "auto",
          mx: -3,
          px: 3,
          pt: 1.5,
          pb: "calc(env(safe-area-inset-bottom, 0px) + 12px)",
          bgcolor: "background.default",
          borderTop: "1px solid",
          borderColor: "divider",
        }}
      >
        {!file && (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", textAlign: "center", mb: 1 }}>
            Take or choose a photo to enable Submit.
          </Typography>
        )}
        <Button
          variant="contained"
          color="primary"
          size="large"
          fullWidth
          disabled={!file}
          onClick={submit}
          sx={{ py: 1.75, fontSize: "1.1rem" }}
        >
          Submit
        </Button>
      </Box>

      {/* Full-screen photo viewer */}
      <Dialog open={viewerOpen} onClose={() => setViewerOpen(false)} fullScreen>
        <Box sx={{ display: "flex", alignItems: "center", p: 1, gap: 1 }}>
          <IconButton onClick={() => setViewerOpen(false)} aria-label="Close preview">
            <CloseIcon />
          </IconButton>
          <Typography variant="body2" noWrap>
            {file?.name}
          </Typography>
        </Box>
        {previewUrl && (
          <Box sx={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", bgcolor: "common.black", overflow: "auto" }}>
            <Box component="img" src={previewUrl} alt="Captured document" sx={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
          </Box>
        )}
      </Dialog>
    </Box>
  );
}
