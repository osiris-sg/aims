"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import CameraAltIcon from "@mui/icons-material/CameraAlt";
import { request } from "@/helpers/request";

interface Category {
  id: string;
  name: string;
}

type Step = "capture" | "review" | "success";

const FIELD_BUTTON_SX = {
  py: 1.5,
  fontSize: "1rem",
  minHeight: 48,
} as const;

/**
 * Field create-and-bind flow. The technician arrives here because the scanned
 * NFC tag isn't bound to anything. They photograph the equipment nameplate,
 * Claude vision extracts the model + serial, they review/edit, and a single
 * POST creates the asset and binds the tag.
 */
export default function BindTagPage() {
  const router = useRouter();
  const search = useSearchParams();
  const { getToken } = useAuth();
  const uid = search?.get("uid") ?? "";

  const [step, setStep] = useState<Step>("capture");

  // Capture step
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  // Review step
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [categories, setCategories] = useState<Category[]>([]);
  const [extractionFailed, setExtractionFailed] = useState(false);
  const [creating, setCreating] = useState(false);

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const res = await request({ path: "/categories", method: "GET" }, {}, token);
        const list: Category[] = Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : [];
        if (cancelled) return;
        setCategories(list);
        const equipment = list.find((c) => c.name.toLowerCase() === "equipment");
        if (equipment) setCategoryId(equipment.id);
      } catch {
        // Categories load failure is non-fatal — the user can still type the
        // name/sku; we'll surface the error when they hit Create & Bind.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getToken]);

  const onPickPhoto = () => fileInputRef.current?.click();

  const onPhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setPhotoDataUrl(typeof reader.result === "string" ? reader.result : null);
    reader.readAsDataURL(file);
  };

  const analyze = async () => {
    if (!photoDataUrl) return;
    setError(null);
    setAnalyzing(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const res = await request(
        { path: "/assets/extract-label", method: "POST" },
        { image: photoDataUrl },
        token,
      );
      const payload = res?.data ?? res;
      const extractedModel = typeof payload?.model === "string" ? payload.model : null;
      const extractedSerial = typeof payload?.serial === "string" ? payload.serial : null;

      if (!extractedModel && !extractedSerial) {
        setExtractionFailed(true);
      } else {
        setExtractionFailed(false);
      }
      setName(extractedModel ?? "");
      setSku(extractedSerial ?? "");
      setStep("review");
    } catch (e: any) {
      // Move to review anyway so the tech can type it in manually.
      setExtractionFailed(true);
      setName("");
      setSku("");
      setError(e?.message ?? "Couldn't analyze photo — enter details manually.");
      setStep("review");
    } finally {
      setAnalyzing(false);
    }
  };

  const createAndBind = async () => {
    setError(null);
    if (!name.trim()) return setError("Name is required.");
    if (!sku.trim()) return setError("SKU is required.");
    if (!categoryId) return setError("Pick a category.");

    setCreating(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      await request(
        { path: "/assets/create-and-bind", method: "POST" },
        { name: name.trim(), skuKey: sku.trim(), categoryId, nfcTagUid: uid },
        token,
      );
      setStep("success");
    } catch (e: any) {
      // Stay on review screen so the tech can correct (e.g. duplicate SKU).
      setError(e?.message ?? "Failed to create asset.");
    } finally {
      setCreating(false);
    }
  };

  if (!uid) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">Missing tag UID — go back and tap again.</Alert>
        <Button sx={{ mt: 2 }} onClick={() => router.replace("/scan")}>Back to scan</Button>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2 }}>
      <Typography variant="h6" fontWeight={700}>New tag</Typography>
      <Typography variant="caption" color="text.secondary" sx={{ wordBreak: "break-all" }}>
        Tag UID: {uid}
      </Typography>

      {step === "capture" && (
        <>
          <Typography variant="body2" color="text.secondary">
            Take a photo of the equipment&apos;s nameplate. We&apos;ll read the model and serial automatically.
          </Typography>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            style={{ display: "none" }}
            onChange={onPhotoChange}
          />

          <Button
            variant="contained"
            color="primary"
            fullWidth
            startIcon={<CameraAltIcon />}
            onClick={onPickPhoto}
            sx={FIELD_BUTTON_SX}
          >
            {photoDataUrl ? "Retake photo" : "Scan Equipment Label"}
          </Button>

          {photoDataUrl && (
            <Box sx={{ mt: 1 }}>
              <Box
                component="img"
                src={photoDataUrl}
                alt="Nameplate preview"
                sx={{
                  width: "100%",
                  maxHeight: 320,
                  objectFit: "contain",
                  borderRadius: 1,
                  border: "1px solid",
                  borderColor: "divider",
                }}
              />
              <Button
                variant="contained"
                fullWidth
                disabled={analyzing}
                onClick={analyze}
                sx={{ ...FIELD_BUTTON_SX, mt: 2 }}
              >
                {analyzing ? (
                  <Stack direction="row" spacing={1} alignItems="center">
                    <CircularProgress size={18} color="inherit" />
                    <span>Reading label...</span>
                  </Stack>
                ) : (
                  "Analyze"
                )}
              </Button>
            </Box>
          )}
        </>
      )}

      {step === "review" && (
        <>
          <Typography variant="body2" color="text.secondary">
            Review the details below. Edit anything that&apos;s wrong, then create.
          </Typography>

          {extractionFailed && (
            <Alert severity="warning">
              Couldn&apos;t read the label automatically — please enter manually.
            </Alert>
          )}

          <TextField
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth
          />
          <TextField
            label="SKU"
            value={sku}
            onChange={(e) => setSku(e.target.value)}
            fullWidth
          />
          <TextField
            select
            label="Category"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            fullWidth
            disabled={!categories.length}
            helperText={categories.length ? undefined : "Loading categories..."}
          >
            {categories.map((c) => (
              <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>
            ))}
          </TextField>

          <Button
            variant="contained"
            color="primary"
            fullWidth
            disabled={creating}
            onClick={createAndBind}
            sx={FIELD_BUTTON_SX}
          >
            {creating ? "Creating..." : "Create & Bind"}
          </Button>

          <Button
            variant="text"
            fullWidth
            onClick={() => {
              setStep("capture");
              setError(null);
            }}
          >
            Back to photo
          </Button>
        </>
      )}

      {step === "success" && (
        <>
          <Alert severity="success">Asset created and NFC tag bound</Alert>
          <Button
            variant="contained"
            color="primary"
            fullWidth
            onClick={() => router.replace("/scan")}
            sx={FIELD_BUTTON_SX}
          >
            Scan another asset
          </Button>
        </>
      )}

      {error && <Alert severity="error">{error}</Alert>}

      {step !== "success" && (
        <Button sx={{ mt: 2 }} onClick={() => router.replace("/scan")}>Cancel</Button>
      )}
    </Box>
  );
}
