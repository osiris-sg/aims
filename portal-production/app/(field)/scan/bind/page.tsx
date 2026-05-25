"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  CircularProgress,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import CameraAltIcon from "@mui/icons-material/CameraAlt";
import { request } from "@/helpers/request";

interface AssetOption {
  id: string;
  name: string;
  skuKey: string;
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
 * NFC tag isn't bound to anything. They:
 *   1. Photograph the equipment nameplate (AI extracts model + serial as hints)
 *   2. Pick an existing Asset from the org's catalog (the picker pre-filters
 *      by the extracted model). Serial stays editable.
 *   3. POST creates one Inventory unit under the chosen Asset and binds the
 *      tag to it.
 *
 * Creating a new Asset from the field is intentionally not supported — SKU
 * management is an office responsibility. The "no match" path tells the tech
 * to ask the office to add the product.
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
  const [assetOptions, setAssetOptions] = useState<AssetOption[]>([]);
  const [selectedAsset, setSelectedAsset] = useState<AssetOption | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [searching, setSearching] = useState(false);
  const [serial, setSerial] = useState("");
  const [extractionFailed, setExtractionFailed] = useState(false);
  const [creating, setCreating] = useState(false);

  const [error, setError] = useState<string | null>(null);

  // Debounced asset search. Fires on every searchInput change with a 250 ms
  // tail so typing doesn't hammer the backend on field LTE. The empty-q case
  // returns the first 50 assets so the picker is usable before the tech types.
  useEffect(() => {
    if (step !== "review") return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const token = await getToken();
        if (!token) return;
        const q = searchInput.trim();
        const path = q ? `/assets/search?q=${encodeURIComponent(q)}` : "/assets/search";
        const res = await request({ path, method: "GET" }, {}, token);
        if (cancelled) return;
        const list: AssetOption[] = Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : [];
        setAssetOptions(list);
      } catch {
        // Non-fatal — keep last results visible; show error only on submit.
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchInput, step, getToken]);

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
      // Pre-fill the picker query so it surfaces the matching catalog row(s)
      // immediately. The tech still has to confirm by tapping — we never
      // auto-select even on an exact match.
      setSearchInput(extractedModel ?? "");
      setSelectedAsset(null);
      setSerial(extractedSerial ?? "");
      setStep("review");
    } catch (e: any) {
      // Move to review anyway so the tech can pick + enter manually.
      setExtractionFailed(true);
      setSearchInput("");
      setSelectedAsset(null);
      setSerial("");
      setError(e?.message ?? "Couldn't analyze photo — please pick the product manually.");
      setStep("review");
    } finally {
      setAnalyzing(false);
    }
  };

  const createAndBind = async () => {
    setError(null);
    if (!selectedAsset) return setError("Pick the product this unit is.");

    setCreating(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const res = await request(
        { path: "/inventories/create-and-bind", method: "POST" },
        {
          assetId: selectedAsset.id,
          serial: serial.trim() || undefined,
          nfcTagUid: uid,
        },
        token,
      );
      // The request helper returns { success:false, message } on error rather
      // than throwing — surface that as a real error so the tech sees the
      // backend's actual reason (e.g. tag already bound) instead of a silent
      // "no id returned" fallback.
      if (res?.success === false) {
        throw new Error(res?.message ?? "Failed to create inventory item.");
      }
      const payload = res?.data;
      const assetId = payload?.asset?.id;
      const inventoryId = payload?.inventory?.id;
      if (!assetId || !inventoryId) {
        throw new Error("Unexpected response from server.");
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
            Pick the product this unit is, then confirm. New products can only be added by the office.
          </Typography>

          {extractionFailed && (
            <Alert severity="warning">
              Couldn&apos;t read the label automatically — please pick the product manually.
            </Alert>
          )}

          <Autocomplete<AssetOption, false, false, false>
            options={assetOptions}
            value={selectedAsset}
            inputValue={searchInput}
            onChange={(_, picked) => setSelectedAsset(picked)}
            onInputChange={(_, v) => setSearchInput(v)}
            getOptionLabel={(o) => `${o.name} · ${o.skuKey}`}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            loading={searching}
            noOptionsText="No matching product. Ask the office to add it to the catalog."
            renderOption={(props, option) => (
              <li {...props} key={option.id}>
                <Box>
                  <Typography variant="body2" fontWeight={600}>{option.name}</Typography>
                  <Typography variant="caption" color="text.secondary">{option.skuKey}</Typography>
                </Box>
              </li>
            )}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Product"
                placeholder="Search by name or SKU"
                helperText={
                  selectedAsset
                    ? `Selected: ${selectedAsset.name} · ${selectedAsset.skuKey}`
                    : "Type to filter the catalog."
                }
                InputProps={{
                  ...params.InputProps,
                  endAdornment: (
                    <>
                      {searching && <CircularProgress size={18} />}
                      {params.InputProps.endAdornment}
                    </>
                  ),
                }}
              />
            )}
          />

          <TextField
            label="Serial number"
            helperText="From the nameplate. Stored for audit; the unit SKU is auto-generated."
            value={serial}
            onChange={(e) => setSerial(e.target.value)}
            fullWidth
          />

          <Button
            variant="contained"
            color="primary"
            fullWidth
            disabled={creating || !selectedAsset}
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
