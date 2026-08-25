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
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import CameraAltIcon from "@mui/icons-material/CameraAlt";
import AddIcon from "@mui/icons-material/Add";
import NfcIcon from "@mui/icons-material/Nfc";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import Chip from "@mui/material/Chip";
import { toast } from "react-toastify";
import { request } from "@/helpers/request";
import { uploadImage } from "@/helpers/imageUploader";
import { capturePosition } from "@/helpers/geolocation";
import { canUseInAppCamera, captureNativePhoto } from "../../lib/nativeCamera";
import {
  ASSET_CLASS_OPTIONS,
  DEFAULT_ASSET_CLASS,
  normalizeAssetClass,
  type AssetClass,
} from "@/helpers/assetClass";
import { compressImageDataUrl } from "../../lib/imageCompress";
import { useNfcScan } from "../../hooks/useNfcScan";

interface AssetOption {
  id: string;
  name: string;
  skuKey: string;
  // Equipment or Accessory — decides how many photos tagging demands.
  assetClass?: AssetClass;
}

// One inline child-asset section (SIDS → TSS, Sim Card, …). The tech types the
// real serial and taps its own tag; all optional. Rendered by the child's REAL
// asset name, never a generic "component".
interface ChildRow {
  childAssetId: string;
  name: string; // the child asset's real name (TSS, Sim Card, ZZTestChild)
  serial: string;
  tagUid: string | null;
  failed?: boolean; // a per-child bind failed on submit (parent stays bound)
}

type Step = "capture" | "review";

const FIELD_BUTTON_SX = {
  py: 1.5,
  fontSize: "1rem",
  minHeight: 48,
} as const;

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
  const nfc = useNfcScan(); // for the inline CHILD tags (parent tag is the URL uid)

  const [step, setStep] = useState<Step>("capture");

  // Inline child-asset tagging (below the parent serial). Populated when the
  // selected parent asset has tracked auto-create children.
  const [childRows, setChildRows] = useState<ChildRow[]>([]);
  const [activeChildId, setActiveChildId] = useState<string | null>(null); // which child is capturing a tag
  const childHandledUidRef = useRef<string | null>(null);
  // "Add a child asset type" dialog.
  const [addTypeOpen, setAddTypeOpen] = useState(false);
  const [newChildName, setNewChildName] = useState("");
  const [newChildSkuKey, setNewChildSkuKey] = useState("");
  const [childSkuKeyEdited, setChildSkuKeyEdited] = useState(false);
  const [creatingChildType, setCreatingChildType] = useState(false);
  const [addTypeError, setAddTypeError] = useState<string | null>(null);
  // "Create new product" dialog — top-level asset when the nameplate matches no
  // catalog row. Name prefilled from the OCR'd model; skuKey auto-suggested,
  // editable. The backend forces the "New" category + dedupes.
  const [createAssetOpen, setCreateAssetOpen] = useState(false);
  const [newAssetName, setNewAssetName] = useState("");
  const [newAssetSkuKey, setNewAssetSkuKey] = useState("");
  // Equipment vs Accessory for a field-created product. Defaults to Equipment,
  // the stricter photo rule, so an unconsidered choice never under-documents.
  const [newAssetClass, setNewAssetClass] = useState<AssetClass>(DEFAULT_ASSET_CLASS);
  const [assetSkuKeyEdited, setAssetSkuKeyEdited] = useState(false);
  const [creatingAsset, setCreatingAsset] = useState(false);
  const [createAssetError, setCreateAssetError] = useState<string | null>(null);
  // Option C: uppercase → alphanumerics only → first 5 of the base, with any
  // trailing digits preserved so suffix-differentiated names stay distinct
  // ("ZZTestChild"→"ZZTES", "ZZTestChild2"→"ZZTES2"). Freely editable after.
  const suggestSkuKey = (name: string) => {
    const cleaned = name.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const m = cleaned.match(/^(.*?)(\d*)$/);
    const base = m?.[1] ?? cleaned;
    const trailingDigits = m?.[2] ?? "";
    return base.slice(0, 5) + trailingDigits;
  };

  // Capture step
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  // Review step
  const [assetOptions, setAssetOptions] = useState<AssetOption[]>([]);
  const [selectedAsset, setSelectedAsset] = useState<AssetOption | null>(null);
  // Red-highlight the Product field when nothing is picked (the disabled-button
  // trap). Set on blur / failed submit; cleared on a valid selection.
  const [productError, setProductError] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [searching, setSearching] = useState(false);
  const [serial, setSerial] = useState("");
  const [extractionFailed, setExtractionFailed] = useState(false);
  const [creating, setCreating] = useState(false);

  // One-shot GPS at tag time. Captured once when the tech reaches the review
  // step so the fix is ready (and any denial is surfaced) before they commit —
  // the bind button stays instant. undefined = not yet attempted, null =
  // denied/timeout/no signal (bind still allowed, with a warning), object = fix.
  const [taggedCoords, setTaggedCoords] = useState<
    { latitude: number; longitude: number; accuracy: number | null } | null | undefined
  >(undefined);
  const [locating, setLocating] = useState(false);

  // Tagging registers the unit and NOTHING more (2026-08): the old optional
  // customer/project assignment was removed — a newly tagged unit is left
  // instock and unassigned, ready to be delivered through a scheduled run.

  // Set when the backend returns ALREADY_TAGGED: the matched unit already has a
  // different tag, so we ask the tech before overwriting (rebind orphans the
  // old tag). Confirming re-submits the bind with confirmRebind: true.
  const [rebindPrompt, setRebindPrompt] = useState<{ message: string; unitSku?: string } | null>(null);

  const [error, setError] = useState<string | null>(null);

  // Auto-select on exact match. When the AI extraction (or the tech's typing)
  // lands on a query that exactly matches a catalog row's name or skuKey,
  // pre-pick it for them so they don't have to tap a single item in the
  // dropdown. Guarded by `!selectedAsset` so this doesn't fight a manual pick.
  useEffect(() => {
    if (selectedAsset || !searchInput.trim() || !assetOptions.length) return;
    // NORMALIZED exact match: strip non-alphanumerics + lowercase — the SAME
    // scheme createAndBind uses for serials (inventories.service.ts). Lets an
    // AI-extracted "AF 100" auto-select the catalog "AF100" (space vs none).
    // EXACT after normalization ONLY — no contains/prefix, so a partial like
    // "AF" never auto-picks "AF100" mid-typing, and near-SKUs don't collide.
    const norm = (s: string) => (s ?? "").replace(/[^a-z0-9]/gi, "").toLowerCase();
    const q = norm(searchInput);
    if (!q) return;
    const exact = assetOptions.find(
      (a) => norm(a.name) === q || norm(a.skuKey) === q,
    );
    if (exact) setSelectedAsset(exact);
  }, [assetOptions, searchInput, selectedAsset]);

  // Load the selected parent asset's tracked auto-create child asset TYPES so
  // we can render one inline tag section per child (TSS, Sim Card, …).
  useEffect(() => {
    if (!selectedAsset) {
      setChildRows([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const res = await request(
          { path: `/assets/${selectedAsset.id}/child-assets`, method: "GET" },
          {},
          token,
        );
        if (cancelled) return;
        const kids = (res?.data ?? res) as Array<{ id: string; name: string }>;
        setChildRows(
          Array.isArray(kids)
            ? kids.map((k) => ({ childAssetId: k.id, name: k.name, serial: "", tagUid: null }))
            : [],
        );
      } catch {
        // Non-fatal — the parent bind still works without child sections.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedAsset, getToken]);

  // Inline child-tag NFC: when a child section is capturing, observe the scan
  // and assign the tag to THAT child row (the parent tag is the static URL uid).
  useEffect(() => {
    const scanned = nfc.uid;
    if (!scanned || scanned === childHandledUidRef.current || !activeChildId) return;
    childHandledUidRef.current = scanned;
    setChildRows((rows) => rows.map((r) => (r.childAssetId === activeChildId ? { ...r, tagUid: scanned, failed: false } : r)));
    setActiveChildId(null);
    if (nfc.isScanning) void nfc.stopScan();
  }, [nfc.uid, activeChildId, nfc]);

  const startChildTagScan = (childAssetId: string) => {
    childHandledUidRef.current = null;
    setActiveChildId(childAssetId);
    if (nfc.isSupported && !nfc.isScanning) void nfc.startScan();
  };

  // "Add a child asset type" — creates the child asset (no placeholder yet;
  // the parent unit isn't bound), then appends its row ready to fill + tag.
  const createChildType = async () => {
    const name = newChildName.trim();
    const skuKey = newChildSkuKey.trim();
    if (!name || !skuKey || !selectedAsset) return;
    setCreatingChildType(true);
    setAddTypeError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const res = await request(
        { path: "/assets/create-child", method: "POST" },
        { parentAssetId: selectedAsset.id, name, skuKey },
        token,
      );
      if (res?.success === false) {
        // NestJS validation returns message as a string[] — join it so the
        // tech sees the real reason ("skuKey should not be empty") rather than
        // a bare "Bad request" / "[object Object]".
        const raw = res?.message;
        throw new Error(Array.isArray(raw) ? raw.join(". ") : raw ?? "Could not create the child asset");
      }
      const data = res?.data ?? res;
      if (data?.collision) {
        setAddTypeError(`Code "${skuKey}" already exists (${data.asset?.name ?? "another asset"}). Pick a different code.`);
        return;
      }
      setChildRows((rows) => [...rows, { childAssetId: data.asset.id, name: data.asset.name, serial: "", tagUid: null }]);
      setAddTypeOpen(false);
    } catch (e: any) {
      const m = e?.message;
      setAddTypeError((Array.isArray(m) ? m.join(". ") : m) || "Could not create the child asset");
    } finally {
      setCreatingChildType(false);
    }
  };

  // "Create new product" — open the dialog seeded from whatever's in the picker
  // query (the OCR'd model, or the tech's typing). skuKey auto-suggested from
  // the name, editable.
  const openCreateAsset = () => {
    const seed = searchInput.trim();
    setNewAssetName(seed);
    setNewAssetSkuKey(suggestSkuKey(seed));
    setNewAssetClass(DEFAULT_ASSET_CLASS);
    setAssetSkuKeyEdited(false);
    setCreateAssetError(null);
    setCreateAssetOpen(true);
  };

  // Mint a top-level asset (name + skuKey). The backend dedupes: an exact-skuKey
  // collision or a normalized-exact name/skuKey match returns the EXISTING asset
  // instead of a twin — we select that one. Only a genuinely new product is
  // created; either way we auto-select and continue the bind.
  const handleCreateAsset = async () => {
    const name = newAssetName.trim();
    const skuKey = newAssetSkuKey.trim();
    if (!name || !skuKey) return;
    setCreatingAsset(true);
    setCreateAssetError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const res = await request(
        { path: "/assets/create-basic", method: "POST" },
        { name, skuKey, assetClass: newAssetClass },
        token,
      );
      if (res?.success === false) {
        const raw = res?.message;
        throw new Error(Array.isArray(raw) ? raw.join(". ") : raw ?? "Could not create the product");
      }
      const data = res?.data ?? res;
      // Exact-skuKey collision: keep the dialog open so the tech can pick a
      // different code, and name the clashing product.
      if (data?.collision) {
        setCreateAssetError(
          `Code "${skuKey}" already exists (${data.asset?.name ?? "another product"}). Pick a different code, or search for it in the list.`,
        );
        return;
      }
      const asset = data?.asset;
      if (!asset?.id) throw new Error("Unexpected response from server.");
      const option: AssetOption = {
        id: asset.id,
        name: asset.name,
        skuKey: asset.skuKey,
        assetClass: normalizeAssetClass(asset.assetClass),
      };
      // Surface it in the options + lock it in as the selection, then continue.
      setAssetOptions((prev) => [option, ...prev.filter((o) => o.id !== option.id)]);
      setSelectedAsset(option);
      setSearchInput(`${option.name} · ${option.skuKey}`);
      setProductError(false);
      setCreateAssetOpen(false);
      // data.matched → a normalized-exact twin already existed; we selected it
      // rather than duplicating. Tell the tech which happened.
      toast.success(data?.matched ? `Selected existing product ${asset.name}` : `Product "${asset.name}" created`);
    } catch (e: any) {
      const m = e?.message;
      setCreateAssetError((Array.isArray(m) ? m.join(". ") : m) || "Could not create the product");
    } finally {
      setCreatingAsset(false);
    }
  };

  // Capture the tag-time GPS fix once, when the review step opens. Best-effort:
  // capturePosition resolves null on denial/timeout/no signal, which we surface
  // as a warning — it never blocks the bind. Done here (not at submit) so the
  // fix has time to resolve while the tech picks the product and the warning is
  // seen in-context before they commit.
  useEffect(() => {
    if (step !== "review" || taggedCoords !== undefined) return;
    let cancelled = false;
    (async () => {
      setLocating(true);
      const coords = await capturePosition();
      if (cancelled) return;
      setTaggedCoords(coords);
      setLocating(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [step, taggedCoords]);

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

  // Read one nameplate File → compressed dataURL preview. ALL sources are
  // compressed: the native Sunmi camera ignores takePhoto's resize and returns
  // raw 8 MP frames, so there's nothing "already sized" to trust. compression
  // runs off the main thread.
  const processPhotoFile = (file: File) => {
    void compressImageDataUrl(file).then(setPhotoDataUrl);
  };

  // "Scan Equipment Label" tap: in-app camera on native (works with no external
  // camera app); fall back to the file input on web / no camera.
  const onPickPhoto = async () => {
    if (canUseInAppCamera()) {
      try {
        const file = await captureNativePhoto();
        if (file) processPhotoFile(file);
        return;
      } catch {
        toast.info("Camera unavailable — choose an existing photo instead.");
      }
    }
    fileInputRef.current?.click();
  };

  const onPhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processPhotoFile(file);
  };

  const analyze = async () => {
    if (!photoDataUrl) return;
    setError(null);
    setAnalyzing(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const res = await request(
        // AI label extraction (vision call) can run well past the JSON default,
        // especially on a Render cold start — give it a longer per-call timeout.
        { path: "/assets/extract-label", method: "POST", timeout: 120000 },
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
      // Pre-fill the picker query so it surfaces matching catalog row(s)
      // immediately. The auto-select effect above will lock in the pick when
      // exactly one row matches on name or skuKey — no tap needed in the
      // happy path. Ambiguous results still require a manual selection.
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

  const createAndBind = async (confirmRebind = false) => {
    setError(null);
    if (!selectedAsset) return setError("Pick the product this unit is.");

    setCreating(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      // Best-effort: persist the nameplate photo so the bind is backtrackable.
      // A failed upload must NOT block the bind — proceed with photoKey omitted.
      let photoKey: string | undefined;
      if (photoDataUrl) {
        try {
          const blob = await (await fetch(photoDataUrl)).blob();
          const key = await uploadImage({ blob, folderName: "inventory-bind", token });
          photoKey = key || undefined;
        } catch (err) {
          console.warn("Nameplate photo upload failed; binding without it.", err);
        }
      }
      const res = await request(
        { path: "/inventories/create-and-bind", method: "POST" },
        {
          assetId: selectedAsset.id,
          serial: serial.trim() || undefined,
          nfcTagUid: uid,
          ...(confirmRebind ? { confirmRebind: true } : {}),
          ...(photoKey ? { photoKey } : {}),
          // Tag-time GPS (best-effort). Omitted entirely when unavailable so the
          // backend leaves the tagged* columns null; accuracy only when present.
          ...(taggedCoords
            ? {
                taggedLatitude: taggedCoords.latitude,
                taggedLongitude: taggedCoords.longitude,
                ...(taggedCoords.accuracy != null
                  ? { taggedLocationAccuracy: taggedCoords.accuracy }
                  : {}),
              }
            : {}),
        },
        token,
      );
      // The request helper returns { success:false, message, code?, details? }
      // on error rather than throwing. Branch on the backend's structured code.
      if (res?.success === false) {
        const code = res?.code ?? res?.details?.code;
        // The matched unit already has a DIFFERENT tag — ask before overwriting
        // (rebinding orphans the old tag). The dialog re-submits with confirm.
        if (code === "ALREADY_TAGGED") {
          setRebindPrompt({
            message: res?.message ?? "This unit already has a tag.",
            unitSku: res?.details?.unitSku,
          });
          return; // finally resets `creating`; the dialog drives the retry
        }
        // Several units share this serial under the product — can't auto-pick.
        if (code === "AMBIGUOUS_SERIAL") {
          const cands = Array.isArray(res?.details?.candidates) ? res.details.candidates.join(", ") : "";
          setError(`${res?.message ?? "Multiple matching units."}${cands ? ` (${cands})` : ""}`);
          return;
        }
        throw new Error(res?.message ?? "Failed to create inventory item.");
      }
      const payload = res?.data;
      const assetId = payload?.asset?.id;
      const inventoryId = payload?.inventory?.id;
      if (!assetId || !inventoryId) {
        throw new Error("Unexpected response from server.");
      }

      // Match-vs-create feedback so the tech knows whether a new unit was minted
      // or the tag attached to an existing one (matched by serial).
      const action = payload?.action;
      const unitSku = payload?.inventory?.sku;
      const successMsg =
        action === "matched"
          ? `Tag bound to existing unit ${unitSku}`
          : `New unit ${unitSku} created and tagged`;

      // Tagging registers the unit and NOTHING more: no project/customer
      // assignment here. The unit is left instock and unassigned, ready to be
      // delivered through a scheduled run.
      toast.success(successMsg);
      // ── INLINE CHILD TAGGING ──────────────────────────────────────────────
      // Ordering: the parent bind above completed and spawned the placeholders
      // (createAndBind's create path runs autoCreateChildUnits, returning them
      // in untaggedChildren). NOW, for each child the tech filled in, complete
      // its placeholder: match by child assetId, then create-and-bind with
      // targetInventoryId (de-PENDINGs the sku + flips pending→instock, attaches
      // the tag). Only on the create path — a matched (existing) parent spawns
      // no placeholders, so there's nothing to complete.
      const spawned: Array<{ id: string; assetId: string }> = Array.isArray(payload?.untaggedChildren)
        ? payload.untaggedChildren
        : [];
      const toTag = childRows.filter((c) => c.tagUid); // only the ones the tech tagged
      let childFailures = 0;
      if (action !== "matched" && toTag.length && spawned.length) {
        for (const child of toTag) {
          const placeholder = spawned.find((s) => s.assetId === child.childAssetId);
          if (!placeholder) {
            childFailures++;
            setChildRows((rows) => rows.map((r) => (r.childAssetId === child.childAssetId ? { ...r, failed: true } : r)));
            continue;
          }
          try {
            const cRes = await request(
              { path: "/inventories/create-and-bind", method: "POST" },
              {
                assetId: child.childAssetId,
                targetInventoryId: placeholder.id,
                nfcTagUid: child.tagUid,
                serial: child.serial.trim() || undefined,
              },
              token,
            );
            if (cRes?.success === false) throw new Error(cRes?.message ?? "child bind failed");
            toast.success(`${child.name} tagged`);
          } catch (childErr) {
            // Parent bind is NOT rolled back — the placeholder stays pending for
            // a retry. Mark the row and count it.
            childFailures++;
            setChildRows((rows) => rows.map((r) => (r.childAssetId === child.childAssetId ? { ...r, failed: true } : r)));
            console.error(`child tag failed for ${child.name}:`, childErr);
          }
        }
        if (childFailures > 0) {
          toast.warning(`${childFailures} child asset(s) couldn't be tagged — retry from the office.`);
        }
      }

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

  // User-fixable conditions blocking "Create & Bind". Product is the only one
  // (serial + Assign-to-Project are optional); `creating` is a transient
  // in-flight state, not a validation error, so it's excluded here.
  const bindBlockers: string[] = [];
  if (!selectedAsset) bindBlockers.push("Product");

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
            onClick={() => void onPickPhoto()}
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
            Pick the product this unit is, then confirm. Not in the catalog? Create it below.
          </Typography>

          {extractionFailed && (
            <Alert severity="warning">
              Couldn&apos;t read the label automatically — please pick the product manually.
            </Alert>
          )}

          {/* Tag-time location status. Strongly encouraged but never blocking:
              a failed fix shows a prominent warning yet the bind still proceeds. */}
          {locating && (
            <Alert severity="info" icon={<CircularProgress size={18} />}>
              Capturing location…
            </Alert>
          )}
          {taggedCoords === null && (
            <Alert severity="warning">
              ⚠ Location not captured — GPS unavailable. Enable location and re-tag if possible.
            </Alert>
          )}
          {taggedCoords && (
            <Alert severity="success" sx={{ py: 0 }}>
              Location captured
              {taggedCoords.accuracy != null ? ` (±${Math.round(taggedCoords.accuracy)} m)` : ""}
            </Alert>
          )}

          <Autocomplete<AssetOption, false, false, false>
            options={assetOptions}
            // Server (/assets/search) is authoritative — it already matches on
            // name+skuKey. Disable MUI's client-side re-filter, which otherwise
            // matches the input against getOptionLabel and can SILENTLY hide a
            // valid server result (e.g. a just-renamed asset). Mirrors the
            // customer picker below.
            filterOptions={(x) => x}
            value={selectedAsset}
            inputValue={searchInput}
            onChange={(_, picked) => {
              setSelectedAsset(picked);
              // Reflect the pick IN the input box (not just helper text) so the
              // selection is unmistakable; clear any "no product" error.
              setSearchInput(picked ? `${picked.name} · ${picked.skuKey}` : "");
              if (picked) setProductError(false);
            }}
            // Live validation: flag the field red if the tech leaves it without
            // having selected a product from the list.
            onBlur={() => setProductError(!selectedAsset)}
            // Gate on reason === 'input' so MUI's post-selection "reset" (which
            // fires with the formatted option label like "LION375 · LION375")
            // doesn't pollute the search query and trigger a useless backend
            // call that finds nothing.
            onInputChange={(_, v, reason) => {
              if (reason === "input") setSearchInput(v);
            }}
            getOptionLabel={(o) => `${o.name} · ${o.skuKey}`}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            loading={searching}
            noOptionsText={
              <Button size="small" startIcon={<AddIcon />} onClick={openCreateAsset} sx={{ textTransform: "none" }}>
                Create new product
              </Button>
            }
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
                error={productError && !selectedAsset}
                helperText={
                  productError && !selectedAsset
                    ? "Please select a product from the list."
                    : selectedAsset
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

          {/* Near-match "did you mean" gate. Once a product is picked (incl. the
              auto-select on a normalized-exact match), this hides — so creation
              is only ever reached when nothing in the catalog matches. When
              there ARE candidates they sit in the dropdown above ("did you
              mean?"); this line nudges "pick one, or create". */}
          {!selectedAsset && searchInput.trim() && !searching && (
            <Alert severity="info" icon={false} sx={{ py: 0.75 }}>
              {assetOptions.length > 0 ? (
                <>
                  No exact match for <strong>{searchInput.trim()}</strong>. Pick the right one above, or{" "}
                </>
              ) : (
                <>
                  No product matches <strong>{searchInput.trim()}</strong>.{" "}
                </>
              )}
              <Button size="small" startIcon={<AddIcon />} onClick={openCreateAsset} sx={{ textTransform: "none" }}>
                Create new product
              </Button>
            </Alert>
          )}

          <TextField
            label="Serial number"
            helperText="From the nameplate. Stored for audit; the unit SKU is auto-generated."
            value={serial}
            onChange={(e) => setSerial(e.target.value)}
            fullWidth
          />

          {/* Inline child-asset tagging — one section per child asset of the
              selected parent, each labelled by its REAL name (TSS, Sim Card…).
              All optional: bind the parent alone, or tag any children too. */}
          {(childRows.length > 0 || selectedAsset) && (
            <>
              <Divider sx={{ my: 1 }} />
              <Typography variant="subtitle2" fontWeight={700}>
                Child assets (optional)
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ mt: -1.5 }}>
                Tag each child of this unit — type its serial and tap its own tag.
              </Typography>
              {childRows.map((c) => (
                <Box key={c.childAssetId} sx={{ border: "1px solid", borderColor: c.failed ? "error.main" : "divider", borderRadius: 1, p: 1.5 }}>
                  <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                    <Typography variant="body2" fontWeight={700} sx={{ flex: 1 }}>{c.name}</Typography>
                    {c.tagUid ? (
                      <Chip size="small" color="success" icon={<CheckCircleIcon />} label="Tag captured" />
                    ) : (
                      <Button
                        size="small"
                        variant={activeChildId === c.childAssetId ? "outlined" : "contained"}
                        startIcon={activeChildId === c.childAssetId ? <CircularProgress size={14} /> : <NfcIcon />}
                        onClick={() => (activeChildId === c.childAssetId ? (nfc.stopScan(), setActiveChildId(null)) : startChildTagScan(c.childAssetId))}
                      >
                        {activeChildId === c.childAssetId ? "Hold tag…" : "Tag"}
                      </Button>
                    )}
                  </Stack>
                  <TextField
                    size="small"
                    fullWidth
                    label={`${c.name} serial (optional)`}
                    value={c.serial}
                    onChange={(e) =>
                      setChildRows((rows) => rows.map((r) => (r.childAssetId === c.childAssetId ? { ...r, serial: e.target.value } : r)))
                    }
                  />
                </Box>
              ))}
              <Button
                variant="outlined"
                startIcon={<AddIcon />}
                onClick={() => {
                  setNewChildName("");
                  setNewChildSkuKey("");
                  setChildSkuKeyEdited(false);
                  setAddTypeError(null);
                  setAddTypeOpen(true);
                }}
                disabled={!selectedAsset}
              >
                Add a child asset type
              </Button>
            </>
          )}

          <Divider sx={{ my: 1 }} />

          {/* Blocking-condition summary — names the field(s) stopping the
              disabled button so a greyed CTA is never a silent dead-end. The
              only submit blocker on this form is an unpicked Product (serial +
              assignment are optional); rendered as a list so it stays correct
              if more required fields are ever added. */}
          {!creating && bindBlockers.length > 0 && (
            <Alert severity="warning" icon={false} sx={{ py: 0.75 }}>
              To continue, complete: <strong>{bindBlockers.join(", ")}</strong>
            </Alert>
          )}

          <Button
            variant="contained"
            color="primary"
            fullWidth
            disabled={creating || !selectedAsset}
            onClick={() => {
              // Belt-and-braces: if somehow reachable while blocked, surface
              // the field error too (mirrors the summary).
              if (!selectedAsset) {
                setProductError(true);
                return;
              }
              createAndBind();
            }}
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

      {/* Add a child asset type — name + skuKey → new child asset under the
          selected parent, appears as a new inline section ready to tag. */}
      <Dialog open={addTypeOpen} onClose={() => !creatingChildType && setAddTypeOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>Add a child asset type</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            A new type of child asset for {selectedAsset?.name ?? "this unit"}. Name
            and code only — the office fills in pricing, category and the rest later.
          </Typography>
          <TextField
            autoFocus
            fullWidth
            size="small"
            label="Child asset name"
            placeholder="e.g. Flow Meter"
            value={newChildName}
            onChange={(e) => {
              const v = e.target.value;
              setNewChildName(v);
              if (!childSkuKeyEdited) setNewChildSkuKey(suggestSkuKey(v));
            }}
            disabled={creatingChildType}
            sx={{ mb: 1.5 }}
          />
          <TextField
            fullWidth
            size="small"
            label="Code (SKU key)"
            placeholder="e.g. FLOWMETER"
            value={newChildSkuKey}
            onChange={(e) => {
              setChildSkuKeyEdited(true);
              setNewChildSkuKey(e.target.value);
            }}
            disabled={creatingChildType}
            helperText="A unique code for this child asset type."
          />
          {addTypeError && <Alert severity="error" sx={{ mt: 1.5 }}>{addTypeError}</Alert>}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddTypeOpen(false)} disabled={creatingChildType}>Cancel</Button>
          <Button variant="contained" onClick={createChildType} disabled={creatingChildType || !newChildName.trim() || !newChildSkuKey.trim()}>
            {creatingChildType ? <CircularProgress size={18} /> : "Create"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Create new product — top-level asset when the nameplate matches no
          catalog row. Name prefilled from the OCR model; skuKey auto-suggested.
          Lands in the "New" category for the office to price + re-file. */}
      <Dialog open={createAssetOpen} onClose={() => !creatingAsset && setCreateAssetOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>Create new product</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            A brand-new catalog product. Name and code only — it lands in the
            &ldquo;New&rdquo; category and the office fills in pricing and the rest later.
          </Typography>
          <TextField
            autoFocus
            fullWidth
            size="small"
            label="Product name"
            placeholder="e.g. NewAsset1"
            value={newAssetName}
            onChange={(e) => {
              const v = e.target.value;
              setNewAssetName(v);
              if (!assetSkuKeyEdited) setNewAssetSkuKey(suggestSkuKey(v));
            }}
            disabled={creatingAsset}
            sx={{ mb: 1.5 }}
          />
          <TextField
            fullWidth
            size="small"
            label="Code (SKU key)"
            placeholder="e.g. NEWASSET1"
            value={newAssetSkuKey}
            onChange={(e) => {
              setAssetSkuKeyEdited(true);
              setNewAssetSkuKey(e.target.value);
            }}
            disabled={creatingAsset}
            helperText="A unique code for this product."
          />
          {/* Equipment needs a full set of photos when a unit is tagged; an
              accessory needs one. Defaults to Equipment. Toggle rather than a
              select so it stays a big tap target in the field. */}
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 2, mb: 0.5 }}>
            Type
          </Typography>
          <ToggleButtonGroup
            value={newAssetClass}
            exclusive
            fullWidth
            size="small"
            color="primary"
            disabled={creatingAsset}
            onChange={(_, next) => {
              // exclusive group returns null when re-clicking the active button;
              // keep the current value so one option is always selected.
              if (next) setNewAssetClass(normalizeAssetClass(next));
            }}
          >
            {ASSET_CLASS_OPTIONS.map((o) => (
              <ToggleButton key={o.value} value={o.value}>
                {o.label}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
            Equipment needs a full set of photos when tagged. Accessory needs one.
          </Typography>
          {createAssetError && <Alert severity="error" sx={{ mt: 1.5 }}>{createAssetError}</Alert>}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateAssetOpen(false)} disabled={creatingAsset}>Cancel</Button>
          <Button variant="contained" onClick={handleCreateAsset} disabled={creatingAsset || !newAssetName.trim() || !newAssetSkuKey.trim()}>
            {creatingAsset ? <CircularProgress size={18} /> : "Create"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Rebind confirm — shown when the matched unit already has a different
          tag. Confirming re-submits the bind with confirmRebind: true. */}
      <Dialog open={!!rebindPrompt} onClose={() => !creating && setRebindPrompt(null)}>
        <DialogTitle>Rebind tag?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            {rebindPrompt?.message} Rebind anyway?
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRebindPrompt(null)} disabled={creating}>
            Cancel
          </Button>
          <Button
            variant="contained"
            color="warning"
            disabled={creating}
            onClick={() => {
              setRebindPrompt(null);
              createAndBind(true);
            }}
          >
            {creating ? "Rebinding…" : "Rebind anyway"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
