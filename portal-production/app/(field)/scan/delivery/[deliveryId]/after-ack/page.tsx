"use client";

import React, { useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
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
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import AssignmentTurnedInIcon from "@mui/icons-material/AssignmentTurnedIn";
import HandymanIcon from "@mui/icons-material/Handyman";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import PrintIcon from "@mui/icons-material/Print";
import { request } from "@/helpers/request";
import { uploadImage } from "@/helpers/imageUploader";
import PhotoCaptureField, { CapturedPhoto } from "@/components/delivery/PhotoCaptureField";
import SignaturePadField, { SignaturePadHandle } from "@/components/delivery/SignaturePadField";
import { useBackgroundLocationContext } from "../../../../context/BackgroundLocationContext";

interface CustomerOption {
  id: string;
  name: string;
  customerCode: string | null;
}

interface ProjectOption {
  id: string;
  name: string;
}

const FIELD_BUTTON_SX = { py: 1.5, fontSize: "1rem", minHeight: 48 } as const;

/**
 * AFTER-ACK flow (reordered): the ack page creates a DRAFT DO_ACK (GPS +
 * photos) and routes here for the rest — signature comes LAST:
 *
 *   1. ASSIGN — customer → project (+ RENTAL/SALE), prefilled, skippable.
 *      Committed immediately via /deliveries/:id/assign (fieldDeploy path);
 *      back/re-edit = re-assign ('moved'), never undo.
 *   2. INSTALL PROMPT — needed? YES reveals install photos; NO defers a
 *      skip-install to Confirm. Pure client state — freely reversible.
 *   3. SIGN + "Confirm and Print DO" — ONE customer signature. Confirm:
 *      sign(ackMSR) [item → not_installed, run recompute, water-sg — now WITH
 *      project/customer], then the install choice (skip-install, or an
 *      inline-signed DO_INSTALL create carrying the install photos), then the
 *      run folds. Printing is a future hook on the done screen.
 *
 * RESUME (server-derived): entered without ackMsrId, the draft DO_ACK is
 * found from the run's reports; an existing active assignment skips to the
 * install prompt. No ack MSR at all → bounce to the ack page.
 */
export default function AfterAckPage() {
  const params = useParams();
  const router = useRouter();
  const search = useSearchParams();
  const { getToken } = useAuth();
  const bgLocation = useBackgroundLocationContext();
  const deliveryId = params?.deliveryId as string;
  const assetId = search?.get("assetId") ?? "";
  const inventoryId = search?.get("inventoryId") ?? null;

  const [step, setStep] = useState<"assign" | "install" | "sign" | "done">("assign");
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  // Client-carried flow state: {ackMsrId, installChoice, installPhotos,
  // signature (in the pad)} — everything else is server-committed as it happens.
  const [ackMsrId, setAckMsrId] = useState<string | null>(search?.get("ackMsrId") ?? null);
  const [resolving, setResolving] = useState(true);
  const [installChoice, setInstallChoice] = useState<"yes" | "no" | null>(null);
  const [installPhotos, setInstallPhotos] = useState<CapturedPhoto[]>([]);
  const [photosUploading, setPhotosUploading] = useState(false);
  const [signedByName, setSignedByName] = useState("");
  const sigRef = useRef<SignaturePadHandle>(null);

  const uploadDoInstall = async (blob: Blob): Promise<string | null> => {
    const token = await getToken();
    if (!token) throw new Error("Not signed in");
    return uploadImage({ blob, folderName: "do-install", token });
  };

  // Customer → project pickers (same shape as the walk-around Assign page).
  const [customerOptions, setCustomerOptions] = useState<CustomerOption[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerOption | null>(null);
  const [customerInput, setCustomerInput] = useState("");
  const [customerSearching, setCustomerSearching] = useState(false);
  const [projectOptions, setProjectOptions] = useState<ProjectOption[]>([]);
  const [selectedProject, setSelectedProject] = useState<ProjectOption | null>(null);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [deploymentType, setDeploymentType] = useState<"RENTAL" | "SALE">("RENTAL");
  const prevCustomerRef = useRef<string | null>(null);
  // Prefill from the run's current drop target — applied once on load.
  const prefillProjectRef = useRef<string | null>(null);

  // Inline "+ Create Project" (same minimal flow as the Assign page).
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [createProjectName, setCreateProjectName] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);

  // Inline "+ Create Customer" — same minimal flow, one step earlier in the
  // cascade: a brand-new site has no customer to hang the project off yet.
  const [createCustomerOpen, setCreateCustomerOpen] = useState(false);
  const [createCustomerName, setCreateCustomerName] = useState("");
  const [creatingCustomer, setCreatingCustomer] = useState(false);

  // Missing unit context (deep link / refresh) → back to the basket.
  useEffect(() => {
    if (!assetId || !inventoryId) router.replace(`/scan/delivery/${deliveryId}`);
  }, [assetId, inventoryId, deliveryId, router]);

  // Mount: prefill the pickers from the run, resolve the draft DO_ACK when
  // arriving without ackMsrId (RESUME), and derive the entry step — an
  // existing active assignment jumps straight to the install prompt.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const res = await request({ path: `/deliveries/${deliveryId}`, method: "GET" }, {}, token);
        if (cancelled) return;
        const run = res.data ?? res;
        if (run?.customer?.id) {
          setSelectedCustomer({ id: run.customer.id, name: run.customer.name, customerCode: null });
          prefillProjectRef.current = run.projectId ?? null;
        }
        // Resolve the ack MSR (query param wins; else the unit's DO_ACK from
        // the run's reports — draft preferred, signed accepted for old-flow
        // stragglers). None at all → the unit isn't acked: back to ack.
        let msrId = search?.get("ackMsrId") ?? null;
        if (!msrId && inventoryId) {
          const reports: Array<{ id: string; kind: string; status: string; inventoryId: string | null }> =
            run?.reports ?? [];
          const acks = reports.filter((r) => r.kind === "DO_ACK" && r.inventoryId === inventoryId);
          msrId = (acks.find((r) => r.status !== "completed") ?? acks[acks.length - 1])?.id ?? null;
        }
        if (!msrId) {
          router.replace(
            `/scan/delivery/${deliveryId}/ack?assetId=${encodeURIComponent(assetId)}${
              inventoryId ? `&inventoryId=${encodeURIComponent(inventoryId)}` : ""
            }`,
          );
          return;
        }
        setAckMsrId(msrId);
        // Resume step: active assignment already exists → install prompt
        // (back to assign stays available for re-edit).
        if (assetId && inventoryId) {
          try {
            const ctx = await request(
              { path: `/maintenance-reports/scan-context/${assetId}?inventoryId=${encodeURIComponent(inventoryId)}`, method: "GET" },
              {},
              token,
            );
            if (!cancelled && (ctx.data ?? ctx)?.activeAssignment) setStep("install");
          } catch {
            // Non-fatal — start at assign.
          }
        }
      } catch {
        // Non-fatal — the rider just picks from scratch.
      } finally {
        if (!cancelled) setResolving(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deliveryId, getToken]);

  // Debounced customer search (300 ms tail). Empty query returns the first 20.
  useEffect(() => {
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
        // Non-fatal — keep last results visible.
      } finally {
        if (!cancelled) setCustomerSearching(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [customerInput, getToken]);

  // Load the selected customer's projects; apply the run prefill once.
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
        const options: ProjectOption[] = Array.isArray(docs)
          ? docs.map((p: any) => ({ id: p.id, name: p.name }))
          : [];
        setProjectOptions(options);
        if (prefillProjectRef.current) {
          const match = options.find((p) => p.id === prefillProjectRef.current);
          if (match) setSelectedProject(match);
          prefillProjectRef.current = null;
        }
      } catch {
        // Non-fatal.
      } finally {
        if (!cancelled) setProjectsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedCustomer, getToken]);

  const openCreateCustomer = () => {
    // Seed the dialog with whatever the rider already typed into the picker —
    // they only reach "no match" after typing the site's name.
    setCreateCustomerName(customerInput.trim());
    setCreateCustomerOpen(true);
  };

  const handleCreateCustomer = async () => {
    const trimmed = createCustomerName.trim();
    if (!trimmed) return;
    setCreatingCustomer(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      // Narrow field-flow endpoint (customers:create-by-name — the permission
      // rider roles hold; the full /customers/create is office-gated). Same
      // service underneath; the server generates the customerCode.
      const res = await request({ path: "/customers/create-by-name", method: "POST" }, { name: trimmed }, token);
      const created = res?.data;
      if (res?.success && created?.id) {
        const option: CustomerOption = {
          id: created.id,
          name: created.name ?? trimmed,
          customerCode: created.customerCode ?? null,
        };
        setCustomerOptions((prev) => [option, ...prev]);
        setSelectedCustomer(option);
        // Controlled inputValue — keep the field showing the new pick.
        setCustomerInput(option.customerCode ? `${option.name} (${option.customerCode})` : option.name);
        setCreateCustomerOpen(false);
        setCreateCustomerName("");
      } else {
        setError(res?.message ?? "Failed to create customer");
      }
    } catch (e: any) {
      setError(e?.message ?? "Failed to create customer");
    } finally {
      setCreatingCustomer(false);
    }
  };

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
      } else {
        setError(res?.message ?? "Failed to create project");
      }
    } catch (e: any) {
      setError(e?.message ?? "Failed to create project");
    } finally {
      setCreatingProject(false);
    }
  };

  const doAssign = async () => {
    if (!selectedProject || !inventoryId) return;
    setWorking(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const res = await request(
        { path: `/deliveries/${deliveryId}/assign`, method: "POST" },
        { projectId: selectedProject.id, inventoryId, type: deploymentType },
        token,
      );
      if (res?.success === false) throw new Error(res?.message ?? "Assignment failed");
      setStep("install");
    } catch (e: any) {
      setError(e?.message ?? "Failed to assign to project");
    } finally {
      setWorking(false);
    }
  };

  // FINAL CONFIRM — the point of no return, strictly ordered:
  //   1. sign(ackMSR) — item → not_installed, deliveredAt, run recompute,
  //      water-sg dispatch (now with project/customer attached).
  //   2. Install choice: NO → skip-install (→ completed, installSkipped);
  //      YES → inline-signed DO_INSTALL create carrying the install photos
  //      (the create path applies the 'install' transition itself).
  //   3. Run folds; background GPS tracking stops. Printing = future hook.
  const doConfirm = async () => {
    if (!ackMsrId || !inventoryId) return;
    if (!sigRef.current || sigRef.current.isEmpty()) {
      setError("Customer signature is required");
      return;
    }
    setWorking(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const signature = sigRef.current.toDataUrl();
      const name = signedByName.trim() || undefined;

      const signRes = await request(
        { path: `/maintenance-reports/${ackMsrId}/sign`, method: "POST" },
        { signature, signedByName: name },
        token,
      );
      if (signRes?.success === false) throw new Error(signRes?.message ?? "Failed to sign acknowledgement");

      if (installChoice === "no") {
        const res = await request(
          { path: `/deliveries/${deliveryId}/items/skip-install`, method: "POST" },
          { inventoryId },
          token,
        );
        if (res?.success === false) throw new Error(res?.message ?? "Could not record the no-install choice");
      } else {
        const res = await request(
          { path: "/maintenance-reports", method: "POST" },
          {
            assetId,
            inventoryId,
            description: "Installation completed",
            kind: "DO_INSTALL",
            deliveryId,
            photos: installPhotos.map((p) => p.key),
            signature,
            ...(name ? { signedByName: name } : {}),
          },
          token,
        );
        if (res?.success === false) throw new Error(res?.message ?? "Could not record the installation");
      }

      // Ack is signed — the delivery leg is over; stop background tracking
      // (same semantics as the old sign page, fire-and-forget).
      void bgLocation.stop();
      setStep("done");
    } catch (e: any) {
      setError(e?.message ?? "Confirm failed");
    } finally {
      setWorking(false);
    }
  };

  if (resolving) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 10 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (step === "done") {
    return (
      <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2.5, alignItems: "center", textAlign: "center" }}>
        <CheckCircleIcon sx={{ fontSize: 96, color: "success.main", mt: 6 }} />
        <Typography variant="h5" fontWeight={700}>Delivery confirmed</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 360 }}>
          Acknowledgement signed{installChoice === "no" ? " — installation not needed" : " and installation recorded"}.
        </Typography>
        {/* Future hook: render/print the DO PDF from here. */}
        <Button variant="outlined" startIcon={<PrintIcon />} disabled fullWidth sx={{ ...FIELD_BUTTON_SX, maxWidth: 360 }}>
          Print DO — coming soon
        </Button>
        <Button
          variant="contained"
          onClick={() => router.replace(`/scan/delivery/${deliveryId}`)}
          fullWidth
          sx={{ ...FIELD_BUTTON_SX, maxWidth: 360 }}
        >
          Back to delivery
        </Button>
        <Button variant="text" onClick={() => router.replace("/scan")} sx={{ color: "text.secondary" }}>
          Scan next
        </Button>
      </Box>
    );
  }

  if (step === "sign") {
    return (
      <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2 }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Button startIcon={<ArrowBackIcon />} size="small" onClick={() => setStep("install")} disabled={working} sx={{ color: "text.secondary" }}>
            Back
          </Button>
        </Stack>
        <Typography variant="h6" fontWeight={700}>Customer signature</Typography>
        <Typography variant="body2" color="text.secondary">
          One signature confirms the delivery{installChoice === "yes" ? " and the installation" : ""}.
        </Typography>

        <TextField
          label="Recipient name (optional)"
          size="small"
          value={signedByName}
          onChange={(e) => setSignedByName(e.target.value)}
        />

        <SignaturePadField ref={sigRef} />

        {error && <Alert severity="error">{error}</Alert>}

        <Stack direction="row" spacing={2} sx={{ mt: 1 }}>
          <Button variant="outlined" onClick={() => sigRef.current?.clear()} fullWidth disabled={working} sx={FIELD_BUTTON_SX}>
            Clear
          </Button>
          <Button variant="contained" onClick={doConfirm} disabled={working} fullWidth sx={FIELD_BUTTON_SX}>
            {working ? <CircularProgress size={20} color="inherit" /> : "Confirm and Print DO"}
          </Button>
        </Stack>
      </Box>
    );
  }

  if (step === "install") {
    return (
      <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 3, alignItems: "center" }}>
        <Stack direction="row" sx={{ width: "100%" }}>
          <Button startIcon={<ArrowBackIcon />} size="small" onClick={() => setStep("assign")} sx={{ color: "text.secondary" }}>
            Back
          </Button>
        </Stack>
        <HandymanIcon sx={{ fontSize: 72, color: "primary.main" }} />
        <Typography variant="h6" fontWeight={700}>Installation needed?</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ textAlign: "center", maxWidth: 360 }}>
          If this unit needs installing on site, capture the proof photos here —
          the customer signs once for everything at the next step.
        </Typography>
        {error && <Alert severity="error" sx={{ width: "100%", maxWidth: 360 }}>{error}</Alert>}
        <Stack spacing={1.5} sx={{ width: "100%", maxWidth: 360, mt: 1 }}>
          <Button
            variant={installChoice === "yes" ? "contained" : "outlined"}
            startIcon={<HandymanIcon />}
            onClick={() => setInstallChoice("yes")}
            fullWidth
            sx={FIELD_BUTTON_SX}
          >
            Yes — installation needed
          </Button>
          {installChoice === "yes" && (
            <>
              <PhotoCaptureField
                label="Proof of installation"
                photos={installPhotos}
                onChange={setInstallPhotos}
                upload={uploadDoInstall}
                onError={(m) => setError(m || null)}
                onUploadingChange={setPhotosUploading}
              />
              <Button
                variant="contained"
                onClick={() => setStep("sign")}
                disabled={photosUploading}
                fullWidth
                sx={FIELD_BUTTON_SX}
              >
                Continue to signature
              </Button>
            </>
          )}
          <Button
            variant={installChoice === "no" ? "contained" : "outlined"}
            startIcon={<CheckCircleOutlineIcon />}
            onClick={() => {
              setInstallChoice("no");
              setStep("sign");
            }}
            fullWidth
            sx={FIELD_BUTTON_SX}
          >
            No — installation not needed
          </Button>
        </Stack>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2.5 }}>
      {/* Back exits to the basket — the ack draft persists and re-entry
          resumes from it (re-running the ack page would mint a second draft). */}
      <Stack direction="row">
        <Button
          startIcon={<ArrowBackIcon />}
          size="small"
          onClick={() => router.replace(`/scan/delivery/${deliveryId}`)}
          sx={{ color: "text.secondary" }}
        >
          Back to delivery
        </Button>
      </Stack>
      <Stack direction="row" spacing={1.5} alignItems="center">
        <AssignmentTurnedInIcon color="primary" sx={{ fontSize: 40 }} />
        <Box>
          <Typography variant="h6" fontWeight={700}>Assign to project</Typography>
          <Typography variant="body2" color="text.secondary">
            Delivered — record which project this unit now belongs to.
          </Typography>
        </Box>
      </Stack>

      {error && <Alert severity="error">{error}</Alert>}

      <Autocomplete
        options={customerOptions}
        value={selectedCustomer}
        loading={customerSearching}
        onChange={(_, v) => setSelectedCustomer(v)}
        inputValue={customerInput}
        onInputChange={(_, v) => setCustomerInput(v)}
        getOptionLabel={(o) => (o.customerCode ? `${o.name} (${o.customerCode})` : o.name)}
        isOptionEqualToValue={(o, v) => o.id === v.id}
        renderInput={(params) => <TextField {...params} label="Customer" />}
        filterOptions={(x) => x}
        noOptionsText={
          <Button size="small" startIcon={<AddIcon />} onClick={openCreateCustomer}>
            Create customer
          </Button>
        }
      />
      {!selectedCustomer && (
        <Button
          size="small"
          startIcon={<AddIcon />}
          onClick={openCreateCustomer}
          sx={{ alignSelf: "flex-start", textTransform: "none", mt: -1.5 }}
        >
          New customer
        </Button>
      )}

      <Autocomplete
        options={projectOptions}
        value={selectedProject}
        loading={projectsLoading}
        onChange={(_, v) => setSelectedProject(v)}
        getOptionLabel={(o) => o.name}
        isOptionEqualToValue={(o, v) => o.id === v.id}
        disabled={!selectedCustomer}
        renderInput={(params) => (
          <TextField {...params} label={selectedCustomer ? "Project" : "Pick a customer first"} />
        )}
        noOptionsText={
          <Button size="small" startIcon={<AddIcon />} onClick={() => setCreateProjectOpen(true)}>
            Create project
          </Button>
        }
      />
      {selectedCustomer && (
        <Button
          size="small"
          startIcon={<AddIcon />}
          onClick={() => setCreateProjectOpen(true)}
          sx={{ alignSelf: "flex-start", textTransform: "none" }}
        >
          New project for {selectedCustomer.name}
        </Button>
      )}

      <ToggleButtonGroup
        value={deploymentType}
        exclusive
        onChange={(_, v) => v && setDeploymentType(v)}
        fullWidth
        size="small"
      >
        <ToggleButton value="RENTAL">Rental</ToggleButton>
        <ToggleButton value="SALE">Sale</ToggleButton>
      </ToggleButtonGroup>

      <Stack spacing={1.5} sx={{ mt: 1 }}>
        <Button
          variant="contained"
          onClick={doAssign}
          disabled={working || !selectedProject}
          fullWidth
          sx={FIELD_BUTTON_SX}
        >
          {working ? <CircularProgress size={20} /> : "Assign & continue"}
        </Button>
        <Button
          variant="text"
          onClick={() => setStep("install")}
          disabled={working}
          fullWidth
          sx={{ color: "text.secondary" }}
        >
          Skip for now
        </Button>
      </Stack>

      {/* Inline create-customer dialog */}
      <Dialog open={createCustomerOpen} onClose={() => !creatingCustomer && setCreateCustomerOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>New customer</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            label="Customer name"
            value={createCustomerName}
            onChange={(e) => setCreateCustomerName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreateCustomer()}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateCustomerOpen(false)} disabled={creatingCustomer}>Cancel</Button>
          <Button variant="contained" onClick={handleCreateCustomer} disabled={creatingCustomer || !createCustomerName.trim()}>
            {creatingCustomer ? <CircularProgress size={18} /> : "Create"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Inline create-project dialog */}
      <Dialog open={createProjectOpen} onClose={() => !creatingProject && setCreateProjectOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>New project</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            label="Project name"
            value={createProjectName}
            onChange={(e) => setCreateProjectName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreateProject()}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateProjectOpen(false)} disabled={creatingProject}>Cancel</Button>
          <Button variant="contained" onClick={handleCreateProject} disabled={creatingProject || !createProjectName.trim()}>
            {creatingProject ? <CircularProgress size={18} /> : "Create"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
