"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import KeyboardIcon from "@mui/icons-material/Keyboard";
import PhotoCameraIcon from "@mui/icons-material/PhotoCamera";
import { toast } from "react-toastify";
import { request } from "@/helpers/request";
import { useNfcScan } from "../../hooks/useNfcScan";

// Phone-camera JPEGs run 4–8 MB; Claude's image input cap is 5 MB. Resize to
// 1280px wide at JPEG quality 0.7 (~200–400 KB). Same settings as the bind page.
const compressImage = (dataUrl: string, maxWidth = 1280, quality = 0.7): Promise<string> =>
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
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.src = dataUrl;
  });

// Normalized match (strip non-alphanumerics + lowercase) so an OCR'd "KBZ 43.7"
// preselects the catalog "KBZ43.7". Exact-after-normalization only — no
// contains/prefix, so a partial read never mis-picks. Mirrors the bind page.
const norm = (s: string) => (s ?? "").replace(/[^a-z0-9]/gi, "").toLowerCase();

interface ManualAsset {
  id: string;
  name: string;
  skuKey: string;
}

interface ResolveMatch {
  inventoryId: string;
  sku: string;
  status: string;
  assetId: string;
  assetName: string | null;
  skuKey: string | null;
}

const FIELD_BUTTON_SX = {
  py: 1.5,
  fontSize: "1rem",
  minHeight: 48,
} as const;

/**
 * Manual serial entry — the NFC-less path to the scan action chooser, for
 * assets that can't carry a tag (allowManualEntry=true; e.g. submersible
 * pumps that live underwater). Pick the asset, key in the unit serial, and
 * land on the SAME /scan/asset/[assetId]?inventoryId= page a physical tag
 * scan reaches — every action there (delivery, assign) is tag-independent.
 */
export default function ManualEntryPage() {
  const router = useRouter();
  const { getToken } = useAuth();
  // Re-detect NFC capability here (the hook resolves it on mount, no scan
  // needed) rather than threading state from the scan home — a device without
  // NFC has no tap alternative, so it may manually enter ANY tracked asset.
  const nfc = useNfcScan();

  const [assets, setAssets] = useState<ManualAsset[] | null>(null);
  const [selectedAsset, setSelectedAsset] = useState<ManualAsset | null>(null);
  const [serial, setSerial] = useState("");
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Photo-to-serial (nameplate OCR). Optional shortcut alongside typing: snap
  // the plate, Claude reads model + serial, we autofill the serial and (if the
  // model maps to a listed asset) preselect it. Never auto-navigates.
  const cameraRef = useRef<HTMLInputElement>(null);
  const [extracting, setExtracting] = useState(false);
  const [readSummary, setReadSummary] = useState<string | null>(null);
  const [plateFailed, setPlateFailed] = useState(false);
  // True once the full (all tracked assets) list was loaded because this
  // device has no NFC — drives the "all assets available" UI note.
  const [showingAll, setShowingAll] = useState(false);
  // Multi-match disambiguation (theoretically possible after normalization).
  const [candidates, setCandidates] = useState<ResolveMatch[] | null>(null);

  // Load the picker's assets — but only after NFC detection resolves, so we
  // request the right list once. NFC-capable → allowManualEntry assets only;
  // no NFC → all=true widens to every tracked asset with units. Exactly one
  // result → preselect so the tech goes straight to the serial field.
  useEffect(() => {
    if (nfc.isSupported === undefined) return; // detection still in flight
    const all = nfc.isSupported === false;
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        if (!token) {
          setError("Not signed in");
          setAssets([]);
          return;
        }
        const res = await request(
          { path: `/assets/manual-entry${all ? "?all=true" : ""}`, method: "GET" },
          {},
          token,
        );
        if (cancelled) return;
        const list: ManualAsset[] = Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : [];
        setShowingAll(all);
        setAssets(list);
        if (list.length === 1) setSelectedAsset(list[0]);
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message ?? "Failed to load assets");
          setAssets([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getToken, nfc.isSupported]);

  // Camera → compress → extract. Kept separate from resolve(): reading the
  // plate only fills the form; the tech still taps "Find unit".
  const onPlatePhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (cameraRef.current) cameraRef.current.value = ""; // allow re-picking the same file
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      if (typeof reader.result === "string") await extractPlate(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const extractPlate = async (rawDataUrl: string) => {
    setExtracting(true);
    setPlateFailed(false);
    setReadSummary(null);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const compressed = await compressImage(rawDataUrl);
      const res = await request(
        { path: "/assets/manual-entry/extract-label", method: "POST", timeout: 120000 },
        { image: compressed },
        token,
      );
      const payload = res?.data ?? res;
      const model = typeof payload?.model === "string" && payload.model.trim() ? payload.model.trim() : null;
      const serialRead =
        typeof payload?.serial === "string" && payload.serial.trim() ? payload.serial.trim() : null;

      if (!model && !serialRead) {
        setPlateFailed(true);
        return;
      }
      if (serialRead) setSerial(serialRead);
      // Preselect the asset from the model — only when nothing is chosen yet, so
      // this never overrides a manual pick. Matches against the loaded list.
      if (model && !selectedAsset && assets) {
        const q = norm(model);
        const hit = assets.find((a) => norm(a.name) === q || norm(a.skuKey) === q);
        if (hit) setSelectedAsset(hit);
      }
      setReadSummary(
        serialRead
          ? `Read: ${serialRead}${model ? ` (${model})` : ""}`
          : `Read model ${model} — enter the serial manually.`,
      );
    } catch {
      setPlateFailed(true);
    } finally {
      setExtracting(false);
    }
  };

  const goToUnit = (m: ResolveMatch) => {
    // Wrong-asset pick: serials are org-unique, so we trust the serial over
    // the picker and land on the real owner — with a heads-up.
    if (selectedAsset && m.assetId !== selectedAsset.id) {
      toast.info(`${m.sku} belongs to ${m.assetName ?? m.skuKey ?? "another asset"}`);
    }
    router.push(`/scan/asset/${m.assetId}?inventoryId=${encodeURIComponent(m.inventoryId)}`);
  };

  const resolve = async () => {
    const q = serial.trim();
    if (!q) return;
    setResolving(true);
    setError(null);
    setCandidates(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const params = new URLSearchParams({ serial: q });
      if (selectedAsset) params.set("assetId", selectedAsset.id);
      const res = await request(
        { path: `/inventories/field-resolve?${params.toString()}`, method: "GET" },
        {},
        token,
      );
      const matches: ResolveMatch[] = (res?.data ?? res)?.matches ?? [];
      if (matches.length === 0) {
        setError(`No unit found for "${q}" — check the serial and try again.`);
      } else if (matches.length === 1) {
        goToUnit(matches[0]);
      } else {
        setCandidates(matches);
      }
    } catch (e: any) {
      setError(e?.message ?? "Lookup failed");
    } finally {
      setResolving(false);
    }
  };

  if (assets === null) {
    return (
      <Box sx={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <CircularProgress />
      </Box>
    );
  }

  if (assets.length === 0) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="info">
          {showingAll
            ? "No tracked assets with units are available for manual entry yet."
            : "No assets are enabled for manual serial entry. An admin can enable it per asset (“Allow manual serial entry” in the asset editor)."}
        </Alert>
        <Button sx={{ mt: 2 }} onClick={() => router.push("/scan")}>Back to scan</Button>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2.5 }}>
      <Stack direction="row" spacing={2} alignItems="center">
        <KeyboardIcon color="primary" sx={{ fontSize: 40 }} />
        <Box>
          <Typography variant="h6" fontWeight={700}>Enter serial manually</Typography>
          <Typography variant="body2" color="text.secondary">
            For assets without an NFC tag — key in the unit&apos;s serial number.
          </Typography>
        </Box>
      </Stack>

      {showingAll && (
        <Alert severity="info">
          NFC unavailable on this device — all assets available for manual entry.
        </Alert>
      )}

      {assets.length === 1 ? (
        <Chip label={`${assets[0].name} (${assets[0].skuKey})`} sx={{ alignSelf: "flex-start" }} />
      ) : (
        <Autocomplete<ManualAsset, false, false, false>
          options={assets}
          value={selectedAsset}
          onChange={(_, picked) => setSelectedAsset(picked)}
          getOptionLabel={(o) => `${o.name} (${o.skuKey})`}
          isOptionEqualToValue={(a, b) => a.id === b.id}
          renderInput={(params) => (
            <TextField {...params} label="Asset" placeholder="Pick the asset type" />
          )}
        />
      )}

      {/* Photo-to-serial shortcut — snap the nameplate instead of typing. The
          text field below stays fully usable either way. */}
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: "none" }}
        onChange={onPlatePhoto}
      />
      <Button
        variant="outlined"
        fullWidth
        startIcon={extracting ? <CircularProgress size={18} /> : <PhotoCameraIcon />}
        disabled={extracting}
        onClick={() => cameraRef.current?.click()}
        sx={FIELD_BUTTON_SX}
      >
        {extracting ? "Reading plate…" : "Scan nameplate"}
      </Button>

      {readSummary && <Alert severity="success">{readSummary}</Alert>}
      {plateFailed && (
        <Alert severity="warning">Couldn&apos;t read the plate — enter the serial manually.</Alert>
      )}

      <TextField
        label="Unit serial"
        placeholder="e.g. BI2026167"
        value={serial}
        onChange={(e) => {
          setSerial(e.target.value);
          setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !resolving) {
            e.preventDefault();
            void resolve();
          }
        }}
        inputProps={{ autoCapitalize: "characters", autoCorrect: "off", spellCheck: false }}
        fullWidth
        autoFocus={assets.length === 1}
      />

      {error && <Alert severity="error">{error}</Alert>}

      {candidates && (
        <Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Multiple units match — pick one:
          </Typography>
          <Stack spacing={1}>
            {candidates.map((m) => (
              <Box
                key={m.inventoryId}
                onClick={() => goToUnit(m)}
                sx={{ display: "flex", alignItems: "center", gap: 1.5, p: 1.5, border: 1, borderColor: "divider", borderRadius: 1, cursor: "pointer", "&:hover": { bgcolor: "action.hover" } }}
              >
                <Typography variant="body2" fontWeight={600}>{m.sku}</Typography>
                <Typography variant="caption" color="text.secondary">{m.assetName}</Typography>
                <Chip size="small" label={m.status} variant="outlined" />
              </Box>
            ))}
          </Stack>
        </Box>
      )}

      <Button
        variant="contained"
        fullWidth
        disabled={resolving || !serial.trim()}
        onClick={() => void resolve()}
        sx={FIELD_BUTTON_SX}
      >
        {resolving ? "Looking up..." : "Find unit"}
      </Button>

      <Button variant="text" sx={{ color: "text.secondary", alignSelf: "center" }} onClick={() => router.push("/scan")}>
        Back to scan
      </Button>
    </Box>
  );
}
