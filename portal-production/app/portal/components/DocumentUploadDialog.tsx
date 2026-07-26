"use client";

import React, { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { request } from "@/helpers/request";
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Stack,
  Typography,
} from "@mui/material";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import CloseIcon from "@mui/icons-material/Close";
import InsertDriveFileOutlinedIcon from "@mui/icons-material/InsertDriveFileOutlined";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import JSZip from "jszip";
import { toast } from "react-toastify";
import { uploadFile } from "@/helpers/fileUploader";

interface Props {
  open: boolean;
  onClose: () => void;
  documentType: string;       // AIMS doc type, e.g. INVOICE, DO, QUOTATION, PO, BILL
  documentLabel: string;      // human label for messaging
  onCreated?: () => void;     // called after any documents were created (list refresh)
  // "bill" routes each file through /bills/extract-create (supplier resolve +
  // bill creation) instead of the document-extraction pipeline. Same dialog,
  // same multi-file/ZIP behaviour — one consistent upload experience.
  mode?: "document" | "bill";
}

// Map AIMS document types to the extraction service's enum.
function toExtractionType(aimsType: string): string {
  const t = (aimsType || "").toUpperCase();
  if (["INVOICE", "TI", "TI2"].includes(t)) return "invoice";
  if (["DO", "DELIVERY_ORDER", "RDO"].includes(t)) return "delivery_order";
  if (["QUOTATION", "QO", "QO1", "QT"].includes(t)) return "quotation";
  if (["PO", "PURCHASE_ORDER"].includes(t)) return "purchase_order";
  // For types the extractor doesn't model (CN/DN/SO/PR/SAI/SAO), fall back to
  // a generic invoice shape — fields the editor doesn't need are simply ignored.
  return "invoice";
}

const SUPPORTED_EXT = /\.(jpe?g|png|gif|webp|bmp|pdf)$/i;
const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif",
  webp: "image/webp", bmp: "image/bmp", pdf: "application/pdf",
};
const MAX_FILE = 10 * 1024 * 1024;
const MAX_ZIP = 25 * 1024 * 1024;

type FileResult = { name: string; ok: boolean; id?: string; templateId?: string; error?: string };

export default function DocumentUploadDialog({ open, onClose, documentType, documentLabel, onCreated, mode = "document" }: Props) {
  const router = useRouter();
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number; name: string; stage: string } | null>(null);
  const [results, setResults] = useState<FileResult[] | null>(null);

  const reset = () => {
    setFiles([]);
    setBusy(false);
    setProgress(null);
    setResults(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleClose = () => {
    if (busy) return; // don't allow close mid-flight
    reset();
    onClose();
  };

  const isZip = (f: File) => /\.zip$/i.test(f.name) || f.type === "application/zip" || f.type === "application/x-zip-compressed";

  // Accept multiple files; ZIPs are expanded client-side and their supported
  // contents queued individually (guru 2026-07-26).
  const addFiles = async (list: FileList | File[] | null) => {
    if (!list) return;
    const incoming = Array.from(list);
    const accepted: File[] = [];
    for (const f of incoming) {
      if (isZip(f)) {
        if (f.size > MAX_ZIP) {
          toast.error(`${f.name}: ZIP is over 25 MB.`);
          continue;
        }
        try {
          const zip = await JSZip.loadAsync(f);
          let pulled = 0;
          for (const entry of Object.values(zip.files)) {
            if (entry.dir) continue;
            const base = entry.name.split("/").pop() || entry.name;
            if (base.startsWith(".") || entry.name.startsWith("__MACOSX")) continue;
            if (!SUPPORTED_EXT.test(base)) continue;
            const blob = await entry.async("blob");
            if (blob.size > MAX_FILE) {
              toast.warn(`${base} (in ${f.name}) skipped — over 10 MB.`);
              continue;
            }
            const ext = base.split(".").pop()!.toLowerCase();
            accepted.push(new File([blob], base, { type: MIME_BY_EXT[ext] || "application/octet-stream" }));
            pulled++;
          }
          if (!pulled) toast.warn(`${f.name}: no supported files inside (JPG, PNG, WebP, BMP, GIF, PDF).`);
        } catch {
          toast.error(`${f.name}: couldn't read the ZIP.`);
        }
        continue;
      }
      const okType = SUPPORTED_EXT.test(f.name) || /image\//.test(f.type) || f.type === "application/pdf";
      if (!okType) {
        toast.error(`${f.name}: unsupported type. Use JPG, PNG, WebP, PDF, or a ZIP of those.`);
        continue;
      }
      if (f.size > MAX_FILE) {
        toast.error(`${f.name} is over 10 MB.`);
        continue;
      }
      accepted.push(f);
    }
    if (!accepted.length) return;
    setResults(null);
    setFiles((prev) => {
      const seen = new Set(prev.map((p) => `${p.name}|${p.size}`));
      return [...prev, ...accepted.filter((f) => !seen.has(`${f.name}|${f.size}`))];
    });
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    void addFiles(e.dataTransfer.files);
  };

  const removeFile = (idx: number) => setFiles((prev) => prev.filter((_, i) => i !== idx));

  const processOne = async (file: File, token: string): Promise<FileResult> => {
    try {
      if (mode === "bill") {
        // Bills pipeline: S3 upload (kept as the bill's source document) +
        // extract-and-create in one backend call.
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        const uploaded = await uploadFile({ file, folder: "bills/attachments", token }).catch(() => null);
        const res = await request(
          { path: "/bills/extract-create", method: "POST" },
          { base64, mediaType: file.type || "application/pdf", filename: file.name, attachments: uploaded ? [uploaded] : [] },
          token
        );
        const bill = res?.data ?? res;
        if (!bill?.id) throw new Error(res?.message || "Failed to create bill");
        return { name: file.name, ok: true, id: bill.id };
      }
      // 1) Extract — multipart via raw fetch (the request helper is JSON-only).
      const fd = new FormData();
      fd.append("document", file);
      fd.append("documentType", toExtractionType(documentType));
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

      // 2) Save (unconfirmed) + match PO/customer/codes.
      const saveRes = await request(
        { path: "/documents/from-extraction", method: "POST" },
        { type: documentType, extracted, sourceFileUrl },
        token
      );
      if (!saveRes?.success || !saveRes?.data?.id) {
        throw new Error(saveRes?.message || "Failed to create document");
      }
      return { name: file.name, ok: true, id: saveRes.data.id, templateId: saveRes.data.templateId };
    } catch (err: any) {
      return { name: file.name, ok: false, error: err?.message || "Failed" };
    }
  };

  const run = async () => {
    if (!files.length || !organization?.id) return;
    const token = await getToken();
    if (!token) {
      toast.error("Not authenticated.");
      return;
    }
    setBusy(true);
    const out: FileResult[] = [];
    try {
      for (let i = 0; i < files.length; i++) {
        setProgress({ current: i + 1, total: files.length, name: files[i].name, stage: "Extracting" });
        // Clerk tokens are short-lived — refresh per file on long batches.
        const t = (await getToken()) || token;
        out.push(await processOne(files[i], t));
      }
      const okCount = out.filter((r) => r.ok).length;
      const failCount = out.length - okCount;
      if (okCount) onCreated?.();

      if (files.length === 1 && out[0].ok && mode === "document") {
        // Single file keeps the fast path: straight into the editor.
        toast.success(`${documentLabel} created`);
        router.push(`/portal/documents/${documentType}/${out[0].templateId}/${out[0].id}`);
        handleCloseAfterRun();
        return;
      }
      failCount
        ? toast.warn(`${okCount} document${okCount === 1 ? "" : "s"} created, ${failCount} failed`)
        : toast.success(`${okCount} document${okCount === 1 ? "" : "s"} created`);
      setResults(out);
      setFiles([]);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const handleCloseAfterRun = () => {
    reset();
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        Upload {documentLabel}
        <IconButton onClick={handleClose} disabled={busy} size="small">
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            Upload one or more JPG, PNG, WebP or PDF files — or a ZIP of them. Each file becomes its
            own document: fields extracted, PO looked up, customer matched, and lines coded from the
            Revenue Master File where they match.
          </Typography>

          <Box
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => !busy && fileInputRef.current?.click()}
            sx={{
              border: "1px dashed",
              borderColor: "divider",
              borderRadius: 1,
              p: 3,
              textAlign: "center",
              cursor: busy ? "default" : "pointer",
              bgcolor: "surfaceTones.low",
              "&:hover": { bgcolor: busy ? undefined : "surfaceTones.high" },
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,.pdf,application/pdf,.zip,application/zip"
              style={{ display: "none" }}
              onChange={(e) => {
                void addFiles(e.target.files);
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
              disabled={busy}
            />
            <Stack spacing={1} alignItems="center">
              <CloudUploadIcon fontSize="large" />
              <Typography variant="body2">
                {files.length ? "Add more files" : "Drop files here or click to choose"}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                JPG, PNG, WebP, PDF (max 10 MB each) or ZIP (max 25 MB)
              </Typography>
            </Stack>
          </Box>

          {files.length > 0 && (
            <List dense sx={{ border: 1, borderColor: "divider", borderRadius: 1, maxHeight: 200, overflow: "auto", py: 0 }}>
              {files.map((f, i) => (
                <ListItem
                  key={`${f.name}-${i}`}
                  secondaryAction={
                    !busy && (
                      <IconButton edge="end" size="small" onClick={() => removeFile(i)}>
                        <DeleteOutlineIcon fontSize="small" />
                      </IconButton>
                    )
                  }
                >
                  <ListItemIcon sx={{ minWidth: 32 }}>
                    <InsertDriveFileOutlinedIcon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText primary={f.name} secondary={`${(f.size / 1024).toFixed(0)} KB`} />
                </ListItem>
              ))}
            </List>
          )}

          {results && (
            <List dense sx={{ border: 1, borderColor: "divider", borderRadius: 1, maxHeight: 220, overflow: "auto", py: 0 }}>
              {results.map((r, i) => (
                <ListItem
                  key={`${r.name}-${i}`}
                  secondaryAction={
                    r.ok && mode === "document" && (
                      <Button
                        size="small"
                        onClick={() => {
                          router.push(`/portal/documents/${documentType}/${r.templateId}/${r.id}`);
                          handleCloseAfterRun();
                        }}
                      >
                        Open
                      </Button>
                    )
                  }
                >
                  <ListItemIcon sx={{ minWidth: 32 }}>
                    {r.ok ? (
                      <CheckCircleOutlineIcon fontSize="small" color="success" />
                    ) : (
                      <ErrorOutlineIcon fontSize="small" color="error" />
                    )}
                  </ListItemIcon>
                  <ListItemText primary={r.name} secondary={r.ok ? (mode === "bill" ? "Bill created" : "Created") : r.error} />
                </ListItem>
              ))}
            </List>
          )}

          {busy && progress && (
            <Stack direction="row" spacing={1} alignItems="center" justifyContent="center">
              <CircularProgress size={18} />
              <Typography variant="body2">
                Processing {progress.current} of {progress.total} — {progress.name}
              </Typography>
            </Stack>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={busy}>
          {results ? "Close" : "Cancel"}
        </Button>
        <Button variant="contained" onClick={run} disabled={!files.length || busy}>
          Upload &amp; Extract{files.length > 1 ? ` (${files.length})` : ""}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
