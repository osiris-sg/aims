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
  Stack,
  Typography,
} from "@mui/material";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import CloseIcon from "@mui/icons-material/Close";
import InsertDriveFileOutlinedIcon from "@mui/icons-material/InsertDriveFileOutlined";
import { toast } from "react-toastify";

interface Props {
  open: boolean;
  onClose: () => void;
  documentType: string;       // AIMS doc type, e.g. INVOICE, DO, QUOTATION, PO
  documentLabel: string;      // human label for messaging
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

export default function DocumentUploadDialog({ open, onClose, documentType, documentLabel }: Props) {
  const router = useRouter();
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<"idle" | "extracting" | "saving">("idle");

  const reset = () => {
    setFile(null);
    setStage("idle");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleClose = () => {
    if (stage !== "idle") return; // don't allow close mid-flight
    reset();
    onClose();
  };

  const handleFile = (f: File | null) => {
    if (!f) return;
    const ok = /\/(jpe?g|png|gif|webp|bmp|pdf)$/i.test(f.type) || f.type === "application/pdf";
    if (!ok) {
      toast.error("Unsupported file type. Use JPG, PNG, WebP, or PDF.");
      return;
    }
    if (f.size > 10 * 1024 * 1024) {
      toast.error("File is over 10 MB.");
      return;
    }
    setFile(f);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    handleFile(e.dataTransfer.files?.[0] || null);
  };

  const run = async () => {
    if (!file || !organization?.id) return;
    try {
      const token = await getToken();
      if (!token) {
        toast.error("Not authenticated.");
        return;
      }

      // 1) Extract — call the existing extraction endpoint via raw fetch
      //    (it expects multipart/form-data, which the `request` helper doesn't do).
      setStage("extracting");
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
      // The API wraps responses; extracted payload is at result.data.data.
      const extracted = extractJson?.data?.data || extractJson?.data;
      const sourceFileUrl =
        extractJson?.data?.metadata?.sourceFileUrl ?? extractJson?.metadata?.sourceFileUrl ?? null;

      // 2) Save as draft + match PO + match customer.
      setStage("saving");
      const saveRes = await request(
        { path: "/documents/from-extraction", method: "POST" },
        { type: documentType, extracted, sourceFileUrl },
        token
      );
      if (!saveRes?.success || !saveRes?.data?.id) {
        throw new Error(saveRes?.message || "Failed to create draft");
      }

      const { id, templateId, matched } = saveRes.data;

      // Feedback on what we auto-linked.
      const bits: string[] = [];
      if (matched?.customerId) bits.push("customer");
      if (matched?.projectId) bits.push("project (matched PO)");
      const suffix = bits.length ? ` — linked ${bits.join(" + ")}` : "";
      toast.success(`Draft ${documentLabel} created${suffix}`);

      router.push(`/portal/documents/${documentType}/${templateId}/${id}`);
      handleClose();
    } catch (err: any) {
      console.error("Upload flow failed:", err);
      toast.error(err?.message || "Upload failed");
      setStage("idle");
    }
  };

  const busy = stage !== "idle";

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
            Upload a JPG, PNG, WebP, or PDF. We&apos;ll extract the fields, look up the PO number,
            and if a matching PO exists in this org the draft will be tagged to its project automatically.
          </Typography>

          <Box
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => !busy && fileInputRef.current?.click()}
            sx={{
              border: "1px dashed",
              borderColor: "divider",
              borderRadius: 1,
              p: 4,
              textAlign: "center",
              cursor: busy ? "default" : "pointer",
              bgcolor: "surfaceTones.low",
              "&:hover": { bgcolor: busy ? undefined : "surfaceTones.high" },
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,.pdf,application/pdf"
              style={{ display: "none" }}
              onChange={(e) => handleFile(e.target.files?.[0] || null)}
              disabled={busy}
            />
            {file ? (
              <Stack spacing={1} alignItems="center">
                <InsertDriveFileOutlinedIcon fontSize="large" />
                <Typography variant="body2">{file.name}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {(file.size / 1024).toFixed(0)} KB
                </Typography>
              </Stack>
            ) : (
              <Stack spacing={1} alignItems="center">
                <CloudUploadIcon fontSize="large" />
                <Typography variant="body2">Drop a file here or click to choose</Typography>
                <Typography variant="caption" color="text.secondary">
                  JPG, PNG, WebP, PDF — max 10 MB
                </Typography>
              </Stack>
            )}
          </Box>

          {busy && (
            <Stack direction="row" spacing={1} alignItems="center" justifyContent="center">
              <CircularProgress size={18} />
              <Typography variant="body2">
                {stage === "extracting" ? "Extracting fields…" : "Creating draft…"}
              </Typography>
            </Stack>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="contained" onClick={run} disabled={!file || busy}>
          Upload &amp; Extract
        </Button>
      </DialogActions>
    </Dialog>
  );
}
