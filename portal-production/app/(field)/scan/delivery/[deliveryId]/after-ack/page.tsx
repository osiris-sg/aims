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
import { request } from "@/helpers/request";

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
 * AFTER-ACK step of the standalone delivery flow (delivery-first #3 + #4).
 * The sign page routes here once the customer signs the acknowledgement:
 *
 *   1. ASSIGN — pick customer → project (+ RENTAL/SALE), prefilled with the
 *      run's current drop target. POST /deliveries/:id/assign delegates to
 *      the same fieldDeploy path as the walk-around Assign page. Skippable —
 *      assignment can still happen later from the scan chooser.
 *   2. INSTALL PROMPT — "Installation needed?" YES → the existing install
 *      flow (photos + signature). NO → POST items/skip-install: the item
 *      completes with installSkipped, no signature, back to the basket.
 */
export default function AfterAckPage() {
  const params = useParams();
  const router = useRouter();
  const search = useSearchParams();
  const { getToken } = useAuth();
  const deliveryId = params?.deliveryId as string;
  const assetId = search?.get("assetId") ?? "";
  const inventoryId = search?.get("inventoryId") ?? null;

  const [step, setStep] = useState<"assign" | "install">("assign");
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

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

  // Prefill the pickers with the run's current project/customer.
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
      } catch {
        // Non-fatal — the rider just picks from scratch.
      }
    })();
    return () => {
      cancelled = true;
    };
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

  const doSkipInstall = async () => {
    if (!inventoryId) return;
    setWorking(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const res = await request(
        { path: `/deliveries/${deliveryId}/items/skip-install`, method: "POST" },
        { inventoryId },
        token,
      );
      if (res?.success === false) throw new Error(res?.message ?? "Could not skip installation");
      router.replace(`/scan/delivery/${deliveryId}`);
    } catch (e: any) {
      setError(e?.message ?? "Could not skip installation");
      setWorking(false);
    }
  };

  const installHref = `/scan/delivery/${deliveryId}/install?assetId=${encodeURIComponent(assetId)}${
    inventoryId ? `&inventoryId=${encodeURIComponent(inventoryId)}` : ""
  }`;

  if (step === "install") {
    return (
      <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 3, alignItems: "center" }}>
        <HandymanIcon sx={{ fontSize: 72, color: "primary.main", mt: 4 }} />
        <Typography variant="h6" fontWeight={700}>Installation needed?</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ textAlign: "center", maxWidth: 360 }}>
          If this unit needs to be installed on site, continue to the installation
          step (photos + customer signature). Otherwise the delivery finishes here.
        </Typography>
        {error && <Alert severity="error" sx={{ width: "100%", maxWidth: 360 }}>{error}</Alert>}
        <Stack spacing={1.5} sx={{ width: "100%", maxWidth: 360, mt: 1 }}>
          <Button
            variant="contained"
            startIcon={<HandymanIcon />}
            onClick={() => router.replace(installHref)}
            disabled={working}
            fullWidth
            sx={FIELD_BUTTON_SX}
          >
            Yes — install now
          </Button>
          <Button
            variant="outlined"
            startIcon={<CheckCircleOutlineIcon />}
            onClick={doSkipInstall}
            disabled={working}
            fullWidth
            sx={FIELD_BUTTON_SX}
          >
            {working ? <CircularProgress size={20} /> : "No — installation not needed"}
          </Button>
        </Stack>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2.5 }}>
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
