"use client";

import React, { useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { request } from "@/helpers/request";
import { Box, Button, CircularProgress, IconButton, Stack, Typography } from "@mui/material";
import PhotoCameraIcon from "@mui/icons-material/PhotoCamera";
import PhotoLibraryIcon from "@mui/icons-material/PhotoLibrary";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import DescriptionIcon from "@mui/icons-material/Description";

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
  | "SAO";
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
];
const TYPES = TYPE_GROUPS.flatMap((g) => g.types);

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

  const resetInputs = () => {
    if (cameraRef.current) cameraRef.current.value = "";
    if (galleryRef.current) galleryRef.current.value = "";
  };

  const resetAll = () => {
    setDocType(null);
    setFile(null);
    setPhase("idle");
    setErrorMsg(null);
    resetInputs();
  };

  const backToChooser = () => {
    setDocType(null);
    setFile(null);
    setErrorMsg(null);
    resetInputs();
  };

  const pickFile = (f: File | null) => {
    if (!f) return;
    const ok = /\/(jpe?g|png|gif|webp|bmp|pdf)$/i.test(f.type) || f.type === "application/pdf";
    if (!ok) {
      setErrorMsg("Please use a photo (JPG/PNG) or a PDF.");
      return;
    }
    if (f.size > 10 * 1024 * 1024) {
      setErrorMsg("That file is over 10 MB — try a smaller photo.");
      return;
    }
    setErrorMsg(null);
    setFile(f);
  };

  const submit = async () => {
    if (!file || !docType) return;
    try {
      const token = await getToken();
      if (!token) {
        setErrorMsg("You're signed out. Please sign in again.");
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
    <Box sx={{ minHeight: "100vh", display: "flex", flexDirection: "column", p: 3, gap: 2 }}>
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
        onChange={(e) => pickFile(e.target.files?.[0] || null)}
      />
      {/* Fallback: gallery / files, PDFs allowed. */}
      <input
        ref={galleryRef}
        type="file"
        accept="image/*,application/pdf,.pdf"
        style={{ display: "none" }}
        onChange={(e) => pickFile(e.target.files?.[0] || null)}
      />

      <Stack spacing={2} sx={{ mt: 1 }}>
        <Button
          variant="contained"
          size="large"
          fullWidth
          startIcon={<PhotoCameraIcon />}
          onClick={() => cameraRef.current?.click()}
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

      {file && (
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

      <Box sx={{ flexGrow: 1 }} />

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
  );
}
