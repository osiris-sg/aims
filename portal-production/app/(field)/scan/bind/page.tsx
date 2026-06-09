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
  Typography,
} from "@mui/material";
import CameraAltIcon from "@mui/icons-material/CameraAlt";
import AddIcon from "@mui/icons-material/Add";
import { toast } from "react-toastify";
import { request } from "@/helpers/request";

interface AssetOption {
  id: string;
  name: string;
  skuKey: string;
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

  // Optional customer → project assignment. Both pickers are optional: the
  // tech can bind a tag without touching them, but if a project is picked the
  // new unit is assigned to it right after the bind succeeds.
  const [customerOptions, setCustomerOptions] = useState<CustomerOption[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerOption | null>(null);
  const [customerInput, setCustomerInput] = useState("");
  const [customerSearching, setCustomerSearching] = useState(false);
  const [projectOptions, setProjectOptions] = useState<ProjectOption[]>([]);
  const [selectedProject, setSelectedProject] = useState<ProjectOption | null>(null);
  const [projectsLoading, setProjectsLoading] = useState(false);
  // Tracks the last customer the project list was reset for, so a re-render that
  // only changes getToken's identity doesn't clear the tech's project pick.
  const prevCustomerRef = useRef<string | null>(null);

  // Inline "+ Create Project" dialog — same minimal flow as the quotation
  // editor's picker: name only, linked to the selected customer.
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [createProjectName, setCreateProjectName] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);

  const [error, setError] = useState<string | null>(null);

  // Auto-select on exact match. When the AI extraction (or the tech's typing)
  // lands on a query that exactly matches a catalog row's name or skuKey,
  // pre-pick it for them so they don't have to tap a single item in the
  // dropdown. Guarded by `!selectedAsset` so this doesn't fight a manual pick.
  useEffect(() => {
    if (selectedAsset || !searchInput.trim() || !assetOptions.length) return;
    const q = searchInput.trim().toLowerCase();
    const exact = assetOptions.find(
      (a) => a.name.toLowerCase() === q || a.skuKey.toLowerCase() === q,
    );
    if (exact) setSelectedAsset(exact);
  }, [assetOptions, searchInput, selectedAsset]);

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

  // Debounced customer search (300 ms tail), same shape as the asset search
  // above. Empty query returns the first 20 customers so the picker is usable
  // before the tech types.
  useEffect(() => {
    if (step !== "review") return;
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
        // Non-fatal — the whole section is optional; keep last results.
      } finally {
        if (!cancelled) setCustomerSearching(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [customerInput, step, getToken]);

  // Load the selected customer's projects. The backend filters by customerId
  // (both the direct FK and the legacy siteOffice→customer path), so no
  // client-side filtering is needed; the Autocomplete narrows as the tech
  // types. Clearing/changing the customer resets the project pick.
  useEffect(() => {
    // Only reset the project pick when the customer genuinely changes — not on
    // every effect run. getToken stays in deps so the fetch uses a fresh token,
    // but an unstable getToken identity must not wipe the tech's selection.
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
        setProjectOptions(
          Array.isArray(docs) ? docs.map((p: any) => ({ id: p.id, name: p.name })) : [],
        );
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

  // "+ Create Project" — minimal create linked to the selected customer,
  // mirroring the quotation editor's inline flow. Auto-selects the new row.
  const handleCreateProject = async () => {
    const trimmed = createProjectName.trim();
    if (!trimmed || !selectedCustomer) return;
    setCreatingProject(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const res = await request(
        { path: "/projects/create-by-name", method: "POST" },
        { name: trimmed, customerId: selectedCustomer.id },
        token,
      );
      if (res?.success && res.data?.id) {
        const created: ProjectOption = { id: res.data.id, name: res.data.name ?? trimmed };
        setProjectOptions((prev) => [created, ...prev]);
        setSelectedProject(created);
        setCreateProjectOpen(false);
        setCreateProjectName("");
        toast.success("Project created");
      } else {
        toast.error(res?.message ?? "Failed to create project");
      }
    } catch (e: any) {
      console.error("create project failed:", e);
      toast.error(e?.message ?? "Failed to create project");
    } finally {
      setCreatingProject(false);
    }
  };

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
      // Optional project deployment — best-effort. Creates a Deployment +
      // single-item DO on the backend so the unit shows up on the project
      // page's deployment cards (standalone Assignment rows don't render
      // there). The bind has already succeeded at this point, so a failure
      // here must never block the flow: log it, tell the tech the item was
      // still created, and move on. The office can deploy it from the portal.
      if (selectedProject) {
        try {
          const deployRes = await request(
            { path: `/projects/${selectedProject.id}/field-deploy`, method: "POST" },
            { inventoryId, assetId },
            token,
          );
          if (deployRes?.success === false) {
            throw new Error(deployRes?.message ?? "Deployment request failed");
          }
          toast.success(`Item created and deployed to ${selectedProject.name}`);
        } catch (deployErr) {
          console.error("field deploy failed (binding succeeded):", deployErr);
          toast.success("Item created");
          toast.warning("Couldn't deploy to project — deploy it later from the portal.");
        }
      } else {
        toast.success("Item created");
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

          <Divider sx={{ my: 1 }} />

          {/* Explicit section header (not just the divider caption) so the
              optional assignment block is unmissable on small screens even
              before the pickers have any options loaded. */}
          <Typography variant="subtitle2" fontWeight={700}>
            Assign to Project (optional)
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ mt: -1.5 }}>
            Pick a customer, then a project — the new item will be assigned to it.
          </Typography>

          <Autocomplete<CustomerOption, false, false, false>
            options={customerOptions}
            value={selectedCustomer}
            onChange={(_, picked) => setSelectedCustomer(picked)}
            onInputChange={(_, v, reason) => {
              // Same guard as the asset picker: ignore MUI's post-selection
              // "reset" so the formatted label doesn't pollute the query.
              if (reason === "input") setCustomerInput(v);
            }}
            getOptionLabel={(o) => (o.customerCode ? `${o.name} · ${o.customerCode}` : o.name)}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            loading={customerSearching}
            // Server-side search drives the option list — disable the
            // client-side filter so partial matches from the backend aren't
            // re-filtered away against the formatted label.
            filterOptions={(x) => x}
            renderOption={(props, option) => (
              <li {...props} key={option.id}>
                <Box>
                  <Typography variant="body2" fontWeight={600}>{option.name}</Typography>
                  {option.customerCode && (
                    <Typography variant="caption" color="text.secondary">{option.customerCode}</Typography>
                  )}
                </Box>
              </li>
            )}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Customer (optional)"
                placeholder="Search by name or code"
                InputProps={{
                  ...params.InputProps,
                  endAdornment: (
                    <>
                      {customerSearching && <CircularProgress size={18} />}
                      {params.InputProps.endAdornment}
                    </>
                  ),
                }}
              />
            )}
          />

          {selectedCustomer && (
            <Stack direction="row" spacing={1} alignItems="flex-start">
              <Autocomplete<ProjectOption, false, false, false>
                sx={{ flexGrow: 1 }}
                options={projectOptions}
                value={selectedProject}
                onChange={(_, picked) => setSelectedProject(picked)}
                getOptionLabel={(o) => o.name}
                isOptionEqualToValue={(a, b) => a.id === b.id}
                loading={projectsLoading}
                noOptionsText="No projects for this customer yet."
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Project (optional)"
                    placeholder="Pick a project"
                    InputProps={{
                      ...params.InputProps,
                      endAdornment: (
                        <>
                          {projectsLoading && <CircularProgress size={18} />}
                          {params.InputProps.endAdornment}
                        </>
                      ),
                    }}
                  />
                )}
              />
              <Button
                variant="outlined"
                onClick={() => setCreateProjectOpen(true)}
                startIcon={<AddIcon />}
                sx={{ whiteSpace: "nowrap", minHeight: 56 }}
              >
                Create
              </Button>
            </Stack>
          )}

          <Divider sx={{ my: 1 }} />

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

      {/* Create Project dialog — same minimal inline flow as the quotation
          editor's "+ Create new project": name only, linked to the selected
          customer, status defaults to pending. */}
      <Dialog
        open={createProjectOpen}
        onClose={() => (creatingProject ? null : setCreateProjectOpen(false))}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>Create Project</DialogTitle>
        <DialogContent>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
            For customer <strong>{selectedCustomer?.name}</strong>. Status defaults
            to pending; the office can fill in the rest later.
          </Typography>
          <TextField
            autoFocus
            fullWidth
            size="small"
            label="Project Name"
            value={createProjectName}
            onChange={(e) => setCreateProjectName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !creatingProject) {
                e.preventDefault();
                handleCreateProject();
              }
            }}
            disabled={creatingProject}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateProjectOpen(false)} disabled={creatingProject}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleCreateProject}
            disabled={creatingProject || !createProjectName.trim()}
            startIcon={creatingProject ? <CircularProgress size={14} color="inherit" /> : <AddIcon />}
          >
            Create
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
