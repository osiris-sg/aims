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
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import KeyboardIcon from "@mui/icons-material/Keyboard";
import PhotoCameraIcon from "@mui/icons-material/PhotoCamera";
import { toast } from "react-toastify";
import { request } from "@/helpers/request";
import { useNfcScan } from "../../hooks/useNfcScan";
import { hasNativeCamera, captureNativePhoto } from "../../lib/nativeCamera";

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

interface CustomerOption {
  id: string;
  name: string;
  customerCode: string | null;
}

interface ProjectOption {
  id: string;
  name: string;
}

const FIELD_BUTTON_SX = {
  py: 1.5,
  fontSize: "1rem",
  minHeight: 48,
} as const;

/**
 * Manual serial entry — the NFC-less path to the scan action chooser, for
 * units that can't carry a tag (e.g. submersible pumps that live underwater).
 * The picker lists any tracked asset with units. Pick the asset, key in the
 * unit serial, and land on the SAME /scan/asset/[assetId]?inventoryId= page a
 * physical tag scan reaches — every action there (delivery, assign) is
 * tag-independent.
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

  // ── Create-new branch (no exact match) ──────────────────────────────────────
  // Revealed after a lookup finds nothing. `nearMatches` are the typo-guard
  // "did you mean" candidates from the resolve response. createSerial is the
  // editable, upper-cased serial that will be minted.
  const [showCreate, setShowCreate] = useState(false);
  const [nearMatches, setNearMatches] = useState<ResolveMatch[]>([]);
  const [createSerial, setCreateSerial] = useState("");
  const [creating, setCreating] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Optional customer → project assignment (mirrors /scan/bind). Both optional.
  const [customerOptions, setCustomerOptions] = useState<CustomerOption[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerOption | null>(null);
  const [customerInput, setCustomerInput] = useState("");
  const [customerSearching, setCustomerSearching] = useState(false);
  const [projectOptions, setProjectOptions] = useState<ProjectOption[]>([]);
  const [selectedProject, setSelectedProject] = useState<ProjectOption | null>(null);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const prevCustomerRef = useRef<string | null>(null);

  // Load the picker's assets after NFC detection resolves (one request). The
  // list is the same on every device now — any tracked asset with units — so
  // `all` no longer changes the result; it's kept only for the old query param.
  // Exactly one result → preselect so the tech goes straight to the serial field.
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
  // Read one nameplate File → dataURL → AI plate extraction. `alreadySized` is
  // true for native camera shots (plugin-downsized) so extraction skips the
  // redundant main-thread compress; false for gallery/web picks (any size).
  const processPlateFile = (file: File, alreadySized = false) => {
    const reader = new FileReader();
    reader.onload = async () => {
      if (typeof reader.result === "string") await extractPlate(reader.result, alreadySized);
    };
    reader.readAsDataURL(file);
  };

  const onPlatePhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (cameraRef.current) cameraRef.current.value = ""; // allow re-picking the same file
    if (file) processPlateFile(file, false);
  };

  // "Scan nameplate" tap: use the in-app camera on native (works with no
  // external camera app); fall back to the file input on web / no camera.
  const onScanPlate = async () => {
    setPlateFailed(false);
    if (await hasNativeCamera()) {
      try {
        const file = await captureNativePhoto();
        if (file) processPlateFile(file, true);
        return;
      } catch {
        setPlateFailed(true); // camera unavailable — let them pick a photo instead
      }
    }
    cameraRef.current?.click();
  };

  const extractPlate = async (rawDataUrl: string, alreadySized = false) => {
    setExtracting(true);
    setPlateFailed(false);
    setReadSummary(null);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      // Native camera shots are already plugin-downsized — skip the redundant
      // main-thread compress; gallery/web picks still need it.
      const image = alreadySized ? rawDataUrl : await compressImage(rawDataUrl);
      const res = await request(
        { path: "/assets/manual-entry/extract-label", method: "POST", timeout: 120000 },
        { image },
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

  // Debounced customer search (300 ms) — same shape as /scan/bind. Only runs
  // once the create-new branch is open. Empty query returns the first 20.
  useEffect(() => {
    if (!showCreate) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setCustomerSearching(true);
      try {
        const token = await getToken();
        if (!token) return;
        const res = await request(
          { path: "/customers", method: "POST" },
          { page: 1, limit: 20, search: customerInput.trim() || undefined },
          token,
        );
        if (cancelled) return;
        const docs = res?.data?.docs;
        setCustomerOptions(
          Array.isArray(docs)
            ? docs.map((c: any) => ({ id: c.id, name: c.name, customerCode: c.customerCode ?? null }))
            : [],
        );
      } catch {
        // Non-fatal — the whole section is optional.
      } finally {
        if (!cancelled) setCustomerSearching(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [customerInput, showCreate, getToken]);

  // Load the selected customer's projects (backend filters by customerId).
  // Changing the customer resets the project pick.
  useEffect(() => {
    const currentCustomerId = selectedCustomer?.id ?? null;
    if (currentCustomerId !== prevCustomerRef.current) {
      setSelectedProject(null);
      setProjectOptions([]);
      prevCustomerRef.current = currentCustomerId;
    }
    if (!selectedCustomer) return;
    let cancelled = false;
    (async () => {
      setProjectsLoading(true);
      try {
        const token = await getToken();
        if (!token) return;
        const res = await request(
          { path: "/projects", method: "POST" },
          { page: 1, limit: 50, filters: { customerId: selectedCustomer.id } },
          token,
        );
        if (cancelled) return;
        const docs = res?.data?.docs;
        setProjectOptions(Array.isArray(docs) ? docs.map((p: any) => ({ id: p.id, name: p.name })) : []);
      } catch {
        // Non-fatal — optional section.
      } finally {
        if (!cancelled) setProjectsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedCustomer, getToken]);

  const resolve = async () => {
    const q = serial.trim();
    if (!q) return;
    setResolving(true);
    setError(null);
    setCandidates(null);
    setShowCreate(false);
    setNearMatches([]);
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
      const payload = res?.data ?? res;
      const matches: ResolveMatch[] = payload?.matches ?? [];
      if (matches.length === 1) {
        goToUnit(matches[0]);
      } else if (matches.length > 1) {
        setCandidates(matches);
      } else {
        // No exact match → open the create-new branch with the near-match typo
        // guard. createSerial seeds from what was typed (upper-cased).
        setNearMatches(Array.isArray(payload?.nearMatches) ? payload.nearMatches : []);
        setCreateSerial(q.toUpperCase());
        setShowCreate(true);
      }
    } catch (e: any) {
      setError(e?.message ?? "Lookup failed");
    } finally {
      setResolving(false);
    }
  };

  // Mint a new tagless unit under the chosen asset. Server backstop: if the
  // serial resolves to an existing unit, the endpoint returns it (exists=true)
  // and we route there instead of creating a duplicate. On create, optionally
  // deploy to the picked project (RENTAL), then land on the same chooser a
  // lookup reaches.
  const doCreate = async () => {
    const s = createSerial.trim();
    if (!s || !selectedAsset || creating) return;
    setConfirmOpen(false);
    setCreating(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const res = await request(
        { path: "/inventories/create-and-bind", method: "POST" },
        { assetId: selectedAsset.id, serial: s },
        token,
      );
      const payload = res?.data ?? res;
      if (res?.success === false) throw new Error(res?.message ?? "Could not create unit");
      const inventoryId: string | undefined = payload?.inventory?.id;
      const assetId: string | undefined = payload?.inventory?.assetId ?? selectedAsset.id;
      if (!inventoryId) throw new Error("Create returned no unit");

      if (payload?.exists || payload?.action === "matched") {
        toast.info(`${payload?.inventory?.sku ?? s} already exists — opening it`);
      } else {
        toast.success(`Created ${payload?.inventory?.sku ?? s}`);
        // Optional deploy to the picked project (best-effort; default RENTAL).
        if (selectedProject) {
          try {
            const dep = await request(
              { path: `/projects/${selectedProject.id}/field-deploy`, method: "POST" },
              { inventoryId, assetId, type: "RENTAL" },
              token,
            );
            if (dep?.success === false) throw new Error(dep?.message);
            toast.info(`Assigned to ${selectedProject.name}`);
          } catch (depErr: any) {
            console.error("field deploy failed (create succeeded):", depErr);
            toast.warning("Couldn't assign to project — do it later from the portal.");
          }
        }
      }
      router.push(`/scan/asset/${assetId}?inventoryId=${encodeURIComponent(inventoryId)}`);
    } catch (e: any) {
      setError(e?.message ?? "Could not create unit");
    } finally {
      setCreating(false);
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
        onClick={() => void onScanPlate()}
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

      {/* ── Create-new branch (revealed when a lookup found nothing) ────────── */}
      {showCreate && (
        <>
          <Divider sx={{ my: 0.5 }} />

          {/* Typo guard layer 1 — "did you mean" near-matches before creating. */}
          {nearMatches.length > 0 && (
            <Alert severity="warning">
              No exact match — did you mean:
              <Stack spacing={1} sx={{ mt: 1 }}>
                {nearMatches.map((m) => (
                  <Button
                    key={m.inventoryId}
                    size="small"
                    variant="outlined"
                    onClick={() => goToUnit(m)}
                    sx={{ justifyContent: "flex-start", textTransform: "none" }}
                  >
                    {m.sku} — {m.assetName ?? m.skuKey ?? ""} ({m.status})
                  </Button>
                ))}
              </Stack>
            </Alert>
          )}

          <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 2 }}>
            <Typography variant="subtitle2" fontWeight={700}>Create new unit</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ mb: 1.5, display: "block" }}>
              No unit found for that serial — mint a new one under the chosen asset.
            </Typography>
            <Stack spacing={1.5}>
              <TextField
                label="New unit serial"
                value={createSerial}
                onChange={(e) => setCreateSerial(e.target.value.toUpperCase())}
                inputProps={{ autoCapitalize: "characters", autoCorrect: "off", spellCheck: false }}
                fullWidth
              />
              {!selectedAsset && (
                <Alert severity="info">Pick the asset above before creating a unit.</Alert>
              )}

              {/* Optional customer → project assignment (mirrors /scan/bind; RENTAL). */}
              <Autocomplete<CustomerOption, false, false, false>
                options={customerOptions}
                value={selectedCustomer}
                onChange={(_, v) => setSelectedCustomer(v)}
                onInputChange={(_, v) => setCustomerInput(v)}
                getOptionLabel={(o) => o.name}
                isOptionEqualToValue={(a, b) => a.id === b.id}
                loading={customerSearching}
                renderInput={(params) => (
                  <TextField {...params} label="Customer (optional)" placeholder="Search customer" />
                )}
              />
              <Autocomplete<ProjectOption, false, false, false>
                options={projectOptions}
                value={selectedProject}
                onChange={(_, v) => setSelectedProject(v)}
                getOptionLabel={(o) => o.name}
                isOptionEqualToValue={(a, b) => a.id === b.id}
                loading={projectsLoading}
                disabled={!selectedCustomer}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Project (optional)"
                    placeholder={selectedCustomer ? "Search project" : "Pick a customer first"}
                  />
                )}
              />
              <Button
                variant="contained"
                fullWidth
                disabled={creating || !createSerial.trim() || !selectedAsset}
                onClick={() => setConfirmOpen(true)}
                sx={FIELD_BUTTON_SX}
              >
                {creating ? "Creating…" : "Create new unit"}
              </Button>
            </Stack>
          </Box>
        </>
      )}

      <Button variant="text" sx={{ color: "text.secondary", alignSelf: "center" }} onClick={() => router.push("/scan")}>
        Back to scan
      </Button>

      {/* Typo guard layer 2 — explicit confirm naming exactly what gets minted. */}
      <Dialog open={confirmOpen} onClose={() => !creating && setConfirmOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>Create new unit?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            This mints a NEW unit <b>{createSerial.trim()}</b> under{" "}
            <b>{selectedAsset ? `${selectedAsset.name} (${selectedAsset.skuKey})` : ""}</b>
            {selectedProject ? (
              <> and assigns it to <b>{selectedProject.name}</b> (rental)</>
            ) : null}
            . Only do this if the unit genuinely doesn&apos;t exist yet.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)} disabled={creating}>Cancel</Button>
          <Button variant="contained" onClick={() => void doCreate()} disabled={creating}>
            {creating ? <CircularProgress size={18} /> : "Create unit"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
