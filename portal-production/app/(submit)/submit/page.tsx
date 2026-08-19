"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { request } from "@/helpers/request";
import { canUseInAppCamera, captureNativePhoto } from "@/app/(field)/lib/nativeCamera";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  IconButton,
  LinearProgress,
  Stack,
  Typography,
} from "@mui/material";
import PhotoCameraIcon from "@mui/icons-material/PhotoCamera";
import PhotoLibraryIcon from "@mui/icons-material/PhotoLibrary";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import DescriptionIcon from "@mui/icons-material/Description";
import CloseIcon from "@mui/icons-material/Close";
import DeleteIcon from "@mui/icons-material/Delete";

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

// idle = building the batch; uploading = intake in flight; done = queued + history.
type Phase = "idle" | "uploading" | "done";

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
    // BILL is routed to the dedicated bills pipeline by the async worker
    // (server-side), so the client just uploads it like any other type.
    types: [{ value: "BILL", label: "Bill (supplier invoice)" }],
  },
];
const TYPES = TYPE_GROUPS.flatMap((g) => g.types);

// Compress gallery/file images before upload (phone JPEGs are 4–8 MB; resize to
// 1280px @ q0.7 ≈ 200–400 KB) so the intake upload is fast on mobile data.
// Native camera shots arrive pre-sized (1600/q70) and skip this.
const compressImageToBlob = (dataUrl: string, maxWidth = 1280, quality = 0.7): Promise<Blob> =>
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

interface BatchItem {
  id: string;
  file: File;
  previewUrl: string | null; // object URL for images; null for PDFs
}

interface SubmitJob {
  id: string;
  batchId: string;
  docType: string;
  status: "QUEUED" | "PROCESSING" | "DONE" | "FAILED";
  fileName: string | null;
  reason: string | null;
  sequenceWarning: { missing: string[]; type: string } | null;
  documentId: string | null;
  createdAt: string;
}

const STATUS_CHIP: Record<SubmitJob["status"], { label: string; color: "default" | "info" | "warning" | "success" | "error" }> = {
  QUEUED: { label: "Queued", color: "default" },
  PROCESSING: { label: "Processing", color: "info" },
  DONE: { label: "Done", color: "success" },
  FAILED: { label: "Failed", color: "error" },
};

const apiBase = process.env.NEXT_PUBLIC_BACKEND_API_URL || "http://localhost:4040";

// Upload ONE file to the async intake with real progress (fetch can't report
// upload progress — XHR can). All files in a submission share `batchId`.
const uploadOne = (
  file: File,
  docType: string,
  batchId: string,
  token: string,
  onProgress: (pct: number) => void,
): Promise<void> =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const fd = new FormData();
    fd.append("files", file, file.name);
    fd.append("docType", docType);
    fd.append("batchId", batchId);
    xhr.open("POST", `${apiBase}/submit/jobs`);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`));
    xhr.onerror = () => reject(new Error("Upload failed"));
    xhr.send(fd);
  });

/**
 * Normal-user submit: pick a type → add one or more photos/files → upload
 * (async intake, 202) → they're free once each shows uploaded. Extraction +
 * draft creation run server-side; the history below (polled) shows each file's
 * outcome so failures are visible and the user can act.
 */
export default function SubmitPage() {
  const { getToken } = useAuth();
  const [docType, setDocType] = useState<DocType | null>(null);
  const [items, setItems] = useState<BatchItem[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [submittedCount, setSubmittedCount] = useState(0);
  const [jobs, setJobs] = useState<SubmitJob[]>([]);
  const [viewer, setViewer] = useState<BatchItem | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const idRef = useRef(0);

  const currentLabel = TYPES.find((t) => t.value === docType)?.label ?? "Document";

  // Revoke all preview object URLs on unmount.
  useEffect(() => {
    return () => {
      items.forEach((i) => i.previewUrl && URL.revokeObjectURL(i.previewUrl));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll the caller's own recent jobs while the done screen is open.
  useEffect(() => {
    if (phase !== "done") return;
    let active = true;
    const load = async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const res = await request({ path: "/submit/jobs/mine", method: "GET" }, {}, token);
        if (active && res?.success !== false) setJobs(((res.data ?? res) as SubmitJob[]) ?? []);
      } catch {
        // best-effort — the list just doesn't refresh this tick
      }
    };
    void load();
    const iv = setInterval(load, 4000);
    return () => {
      active = false;
      clearInterval(iv);
    };
  }, [phase, getToken]);

  const addFile = useCallback(async (f: File | null, alreadySized = false) => {
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
    let file = f;
    if (!isPdf && !alreadySized) {
      try {
        const blob = await compressImageToBlob(await fileToDataUrl(f));
        if (blob.size > 0) file = new File([blob], f.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
      } catch {
        // keep original
      }
    }
    setErrorMsg(null);
    setItems((prev) => [
      ...prev,
      { id: `it-${idRef.current++}`, file, previewUrl: isPdf ? null : URL.createObjectURL(file) },
    ]);
  }, []);

  // Native in-app camera (fast, no external app); else the capture <input>.
  const onTakePhoto = async () => {
    if (canUseInAppCamera()) {
      try {
        const f = await captureNativePhoto();
        if (f) await addFile(f, true);
        return;
      } catch {
        setErrorMsg("Camera unavailable — choose a photo from your gallery instead.");
        return;
      }
    }
    cameraRef.current?.click();
  };

  const removeItem = (id: string) => {
    setItems((prev) => {
      const gone = prev.find((i) => i.id === id);
      if (gone?.previewUrl) URL.revokeObjectURL(gone.previewUrl);
      return prev.filter((i) => i.id !== id);
    });
  };

  const backToChooser = () => {
    items.forEach((i) => i.previewUrl && URL.revokeObjectURL(i.previewUrl));
    setItems([]);
    setDocType(null);
    setErrorMsg(null);
    setProgress({});
    if (cameraRef.current) cameraRef.current.value = "";
    if (galleryRef.current) galleryRef.current.value = "";
  };

  const startOver = () => {
    setJobs([]);
    setSubmittedCount(0);
    backToChooser();
  };

  // Upload each file (shared batchId). Uploaded items are dropped as they go, so
  // a mid-batch failure leaves ONLY the un-uploaded ones — a retry never
  // double-submits. Once all upload, extraction is server-side (fire-and-forget).
  const doSubmit = async () => {
    if (!items.length || !docType) return;
    const token = await getToken();
    if (!token) {
      setErrorMsg("You're signed out. Please sign in again.");
      return;
    }
    const batchId =
      typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${idRef.current}`;
    setPhase("uploading");
    setErrorMsg(null);
    const count = items.length;
    let remaining = [...items];
    try {
      for (const it of items) {
        setProgress((p) => ({ ...p, [it.id]: 0 }));
        await uploadOne(it.file, docType, batchId, token, (pct) => setProgress((p) => ({ ...p, [it.id]: pct })));
        if (it.previewUrl) URL.revokeObjectURL(it.previewUrl);
        remaining = remaining.filter((x) => x.id !== it.id);
      }
      setItems([]);
      setSubmittedCount(count);
      setPhase("done");
    } catch {
      setItems(remaining); // only the un-uploaded remain — safe to retry
      setErrorMsg("Upload interrupted — keep the app open and tap Submit to finish the rest.");
      setPhase("idle");
    }
  };

  // ── Done + history ──────────────────────────────────────────────────────
  if (phase === "done") {
    return (
      <Box sx={{ minHeight: "100vh", display: "flex", flexDirection: "column", p: 3, pt: 4, gap: 2 }}>
        <Box textAlign="center">
          <CheckCircleIcon sx={{ fontSize: 72, color: "success.main" }} />
          <Typography variant="h5" fontWeight={700}>
            Submitted!
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {submittedCount} document{submittedCount === 1 ? "" : "s"} sent for processing. You can close the app — we&apos;ll
            keep working on them.
          </Typography>
        </Box>

        <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 1 }}>
          Your recent submissions
        </Typography>
        <Stack spacing={1.25}>
          {jobs.length === 0 ? (
            <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
              <CircularProgress size={24} />
            </Box>
          ) : (
            jobs.map((j) => {
              const chip = STATUS_CHIP[j.status] ?? { label: j.status, color: "default" as const };
              const typeLabel = TYPES.find((t) => t.value === j.docType)?.label ?? j.docType;
              return (
                <Box key={j.id} sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1, p: 1.5 }}>
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Typography variant="body2" fontWeight={600} noWrap>
                        {j.fileName || typeLabel}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" noWrap display="block">
                        {typeLabel}
                      </Typography>
                    </Box>
                    <Chip size="small" label={chip.label} color={chip.color} />
                  </Stack>
                  {j.status === "FAILED" && j.reason && (
                    <Typography variant="caption" color="error" sx={{ display: "block", mt: 0.5 }}>
                      {j.reason}
                    </Typography>
                  )}
                  {j.sequenceWarning?.missing?.length ? (
                    <Alert severity="warning" sx={{ mt: 1, py: 0 }}>
                      {j.sequenceWarning.missing.join(", ")} look missing before this — upload {j.sequenceWarning.missing.length === 1 ? "it" : "them"} too if you have {j.sequenceWarning.missing.length === 1 ? "it" : "them"}.
                    </Alert>
                  ) : null}
                </Box>
              );
            })
          )}
        </Stack>

        <Box sx={{ mt: "auto", pt: 2 }}>
          <Button variant="contained" size="large" fullWidth onClick={startOver} sx={{ py: 1.5, fontSize: "1.1rem" }}>
            Submit more
          </Button>
        </Box>
      </Box>
    );
  }

  // ── Type chooser ────────────────────────────────────────────────────────
  if (!docType) {
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
            <Typography variant="overline" color="text.secondary" sx={{ display: "block", mb: 1, letterSpacing: 1 }}>
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

  const uploading = phase === "uploading";

  // ── Batch build ─────────────────────────────────────────────────────────
  return (
    <Box
      sx={{
        minHeight: "100vh",
        "@supports (min-height: 100dvh)": { minHeight: "100dvh" },
        display: "flex",
        flexDirection: "column",
        p: 3,
        pb: 0,
        gap: 2,
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <IconButton onClick={backToChooser} aria-label="Back" size="small" disabled={uploading}>
          <ArrowBackIcon />
        </IconButton>
        <Typography variant="h6" fontWeight={700}>
          {currentLabel}
        </Typography>
      </Box>

      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: "none" }}
        onChange={(e) => void addFile(e.target.files?.[0] || null)}
      />
      <input
        ref={galleryRef}
        type="file"
        accept="image/*,application/pdf,.pdf"
        multiple
        style={{ display: "none" }}
        onChange={(e) => {
          Array.from(e.target.files ?? []).forEach((f) => void addFile(f));
          if (galleryRef.current) galleryRef.current.value = "";
        }}
      />

      <Stack direction="row" spacing={1.5}>
        <Button
          variant="contained"
          fullWidth
          startIcon={<PhotoCameraIcon />}
          onClick={() => void onTakePhoto()}
          disabled={uploading}
          sx={{ py: 1.75 }}
        >
          Add photo
        </Button>
        <Button
          variant="outlined"
          fullWidth
          startIcon={<PhotoLibraryIcon />}
          onClick={() => galleryRef.current?.click()}
          disabled={uploading}
          sx={{ py: 1.75 }}
        >
          Gallery / files
        </Button>
      </Stack>

      {/* Batch list */}
      <Stack spacing={1}>
        {items.map((it) => (
          <Box
            key={it.id}
            sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1, p: 1, display: "flex", alignItems: "center", gap: 1.5 }}
          >
            {it.previewUrl ? (
              <Box
                component="img"
                src={it.previewUrl}
                alt=""
                onClick={() => !uploading && setViewer(it)}
                sx={{ width: 48, height: 48, borderRadius: 1, objectFit: "cover", bgcolor: "grey.100", cursor: "pointer", flexShrink: 0 }}
              />
            ) : (
              <DescriptionIcon color="action" sx={{ fontSize: 40, flexShrink: 0 }} />
            )}
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography variant="body2" noWrap>
                {it.file.name}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {(it.file.size / 1024).toFixed(0)} KB
              </Typography>
              {uploading && (
                <LinearProgress
                  variant="determinate"
                  value={progress[it.id] ?? 0}
                  sx={{ mt: 0.5, borderRadius: 1 }}
                />
              )}
            </Box>
            {uploading ? (
              (progress[it.id] ?? 0) >= 100 ? (
                <CheckCircleIcon color="success" fontSize="small" />
              ) : (
                <Typography variant="caption" color="text.secondary">
                  {progress[it.id] ?? 0}%
                </Typography>
              )
            ) : (
              <IconButton size="small" aria-label="Remove" onClick={() => removeItem(it.id)}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            )}
          </Box>
        ))}
      </Stack>

      {errorMsg && (
        <Typography variant="body2" color="error">
          {errorMsg}
        </Typography>
      )}

      {/* Sticky submit bar */}
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
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", textAlign: "center", mb: 1 }}>
          {items.length === 0
            ? "Add one or more photos to enable Submit."
            : uploading
              ? "Keep the app open until every file shows ✓."
              : `${items.length} ready — keep the app open while they upload.`}
        </Typography>
        <Button
          variant="contained"
          color="primary"
          size="large"
          fullWidth
          disabled={items.length === 0 || uploading}
          onClick={() => void doSubmit()}
          startIcon={uploading ? <CircularProgress size={18} color="inherit" /> : undefined}
          sx={{ py: 1.75, fontSize: "1.1rem" }}
        >
          {uploading ? "Uploading…" : `Submit ${items.length || ""} document${items.length === 1 ? "" : "s"}`.trim()}
        </Button>
      </Box>

      {/* Full-screen viewer */}
      <Dialog open={!!viewer} onClose={() => setViewer(null)} fullScreen>
        <Box sx={{ display: "flex", alignItems: "center", p: 1, gap: 1 }}>
          <IconButton onClick={() => setViewer(null)} aria-label="Close preview">
            <CloseIcon />
          </IconButton>
          <Typography variant="body2" noWrap>
            {viewer?.file.name}
          </Typography>
        </Box>
        {viewer?.previewUrl && (
          <Box sx={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", bgcolor: "common.black", overflow: "auto" }}>
            <Box component="img" src={viewer.previewUrl} alt="" sx={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
          </Box>
        )}
      </Dialog>
    </Box>
  );
}
