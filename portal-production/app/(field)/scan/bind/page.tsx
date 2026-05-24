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

type Step = "capture" | "review";

const FIELD_BUTTON_SX = {
  py: 1.5,
  fontSize: "1rem",
  minHeight: 48,
} as const;

// Phone-camera JPEGs run 4–8 MB; Claude's image input cap is 5 MB. Resize
// to 1280px wide at JPEG quality 0.7 — typically ~200–400 KB, well clear.
const compressImage = (dataUrl: string, maxWidth = 1280, quality = 0.7): Promise<string> => {
  return new Promise((resolve) => {
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
      const ctx = canvas.getContext("2d");
      ctx?.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.src = dataUrl;
  });
};

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
  // Field names map to the Inventory create-and-bind shape:
  //   model  → Asset.skuKey (the product/SKU identifier)
  //   serial → Inventory.serialNumber (audit/warranty reference only)
  const [model, setModel] = useState("");
  const [serial, setSerial] = useState("");
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
    reader.onload = async () => {
      if (typeof reader.result !== "string") return;
      const compressed = await compressImage(reader.result);
      setPhotoDataUrl(compressed);
    };
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
      setModel(extractedModel ?? "");
      setSerial(extractedSerial ?? "");
      setStep("review");
    } catch (e: any) {
      // Move to review anyway so the tech can type it in manually.
      setExtractionFailed(true);
      setModel("");
      setSerial("");
      setError(e?.message ?? "Couldn't analyze photo — enter details manually.");
      setStep("review");
    } finally {
      setAnalyzing(false);
    }
  };

  const createAndBind = async () => {
    setError(null);
    if (!model.trim()) return setError("Model is required.");
    if (!categoryId) return setError("Pick a category.");

    setCreating(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const categoryName = categories.find((c) => c.id === categoryId)?.name;
      const res = await request(
        { path: "/inventories/create-and-bind", method: "POST" },
        {
          model: model.trim(),
          serial: serial.trim() || undefined,
          categoryId,
          categoryName,
          nfcTagUid: uid,
        },
        token,
      );
      const payload = res?.data ?? res;
      const assetId = payload?.asset?.id;
      const inventoryId = payload?.inventory?.id;
      if (!assetId || !inventoryId) {
        throw new Error("Created but no asset/inventory id returned");
      }
      // Jump straight to the action chooser — same destination as a scan of
      // an already-bound tag, so the create-then-act flow has no dead end.
      router.replace(`/scan/asset/${assetId}?inventoryId=${inventoryId}`);
    } catch (e: any) {
      // Stay on review screen so the tech can correct (e.g. duplicate tag).
      setError(e?.message ?? "Failed to create inventory item.");
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
            label="Model"
            helperText="Product/SKU identifier (e.g. LION375). Becomes the Asset for this unit."
            value={model}
            onChange={(e) => setModel(e.target.value)}
            fullWidth
          />
          <TextField
            label="Serial number"
            helperText="From the nameplate. Stored for audit; the unit SKU is auto-generated."
            value={serial}
            onChange={(e) => setSerial(e.target.value)}
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

      {error && <Alert severity="error">{error}</Alert>}

      <Button sx={{ mt: 2 }} onClick={() => router.replace("/scan")}>Cancel</Button>
    </Box>
  );
}
