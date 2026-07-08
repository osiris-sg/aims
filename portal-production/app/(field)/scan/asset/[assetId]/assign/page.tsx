"use client";

import React, { useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
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
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import AssignmentTurnedInIcon from "@mui/icons-material/AssignmentTurnedIn";
import { toast } from "react-toastify";
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

interface AssignContext {
  asset: { id: string; name: string; skuKey: string };
  inventory: { id: string; sku: string; status: string } | null;
  activeAssignment: {
    project: { id: string; name: string };
    projectDeployment: { type: string } | null;
  } | null;
}

const FIELD_BUTTON_SX = {
  py: 1.5,
  fontSize: "1rem",
  minHeight: 48,
} as const;

/**
 * Walk-around "Assign to Project" for an already-bound unit. Same pickers and
 * the same POST /projects/:id/field-deploy call as the bind page's optional
 * assignment block — but as a standalone action reachable from the scan
 * chooser, so a tech can (re)assign a unit without re-binding its tag or
 * needing a delivery order. The backend flips Inventory.status by deployment
 * type (RENTAL→rental, SALE→sold) inside the same transaction.
 */
export default function AssignToProjectPage() {
  const params = useParams();
  const router = useRouter();
  const search = useSearchParams();
  const { getToken } = useAuth();
  const assetId = params?.assetId as string;
  const inventoryId = search?.get("inventoryId") ?? null;

  const [ctx, setCtx] = useState<AssignContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Customer → project pickers, mirroring the bind page (there both are
  // optional; here a project pick is the whole point, so Assign stays
  // disabled until one is chosen).
  const [customerOptions, setCustomerOptions] = useState<CustomerOption[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerOption | null>(null);
  const [customerInput, setCustomerInput] = useState("");
  const [customerSearching, setCustomerSearching] = useState(false);
  const [projectOptions, setProjectOptions] = useState<ProjectOption[]>([]);
  const [selectedProject, setSelectedProject] = useState<ProjectOption | null>(null);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [deploymentType, setDeploymentType] = useState<"RENTAL" | "SALE">("RENTAL");
  const prevCustomerRef = useRef<string | null>(null);

  // Inline "+ Create Project" dialog — same minimal flow as the bind page.
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [createProjectName, setCreateProjectName] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);

  // Confirm-move dialog: shown when the unit is already on a DIFFERENT
  // project (the backend would soft-close that assignment on assign).
  const [confirmMoveOpen, setConfirmMoveOpen] = useState(false);
  const [assigning, setAssigning] = useState(false);

  // Load scan context for the unit header + its current project.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        if (!token) {
          setError("Not signed in");
          return;
        }
        const inventoryQuery = inventoryId ? `?inventoryId=${encodeURIComponent(inventoryId)}` : "";
        const res = await request(
          { path: `/maintenance-reports/scan-context/${assetId}${inventoryQuery}`, method: "GET" },
          {},
          token,
        );
        if (cancelled) return;
        if (res.success === false) setError(res.message ?? "Asset not found");
        else setCtx(res.data ?? res);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Failed to load asset");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [assetId, getToken, inventoryId]);

  // Debounced customer search (300 ms tail) — same shape as the bind page.
  // Empty query returns the first 20 customers so the picker is usable
  // before the tech types.
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

  // Load the selected customer's projects; reset the project pick only when
  // the customer genuinely changes (guard against unstable getToken identity).
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
        setProjectOptions(
          Array.isArray(docs) ? docs.map((p: any) => ({ id: p.id, name: p.name })) : [],
        );
      } catch {
        // Non-fatal — optional list; assign will surface real errors.
      } finally {
        if (!cancelled) setProjectsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedCustomer, getToken]);

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

  const currentProject = ctx?.activeAssignment?.project ?? null;

  // Tapping Assign: if the unit is on a DIFFERENT project, confirm the move
  // first (the backend soft-closes the old assignment); same-project and
  // unassigned cases go straight through.
  const onAssignTap = () => {
    if (!selectedProject) return;
    if (currentProject && currentProject.id !== selectedProject.id) {
      setConfirmMoveOpen(true);
      return;
    }
    void doAssign();
  };

  const doAssign = async () => {
    if (!selectedProject || !ctx?.inventory) return;
    setConfirmMoveOpen(false);
    setAssigning(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const res = await request(
        { path: `/projects/${selectedProject.id}/field-deploy`, method: "POST" },
        { inventoryId: ctx.inventory.id, assetId, type: deploymentType },
        token,
      );
      if (res?.success === false) throw new Error(res?.message ?? "Assignment failed");
      const status = (res?.data ?? res)?.status;
      const projName = selectedProject.name;
      if (status === "already_on_project") {
        toast.info(`Already on ${projName} — nothing changed`);
      } else if (status === "moved") {
        toast.success(`Moved to ${projName} as ${deploymentType}`);
      } else {
        toast.success(`Assigned to ${projName} as ${deploymentType}`);
      }
      router.replace("/scan");
    } catch (e: any) {
      setError(e?.message ?? "Failed to assign to project");
      setAssigning(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error && !ctx) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{error}</Alert>
        <Button sx={{ mt: 2 }} onClick={() => router.push("/scan")}>Back to scan</Button>
      </Box>
    );
  }

  // Assignment needs a specific physical unit — an asset-level scan (no
  // inventoryId resolved) can't be deployed.
  if (!ctx?.inventory) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="warning">
          No specific unit resolved from this scan — scan the unit&apos;s tag to assign it to a project.
        </Alert>
        <Button sx={{ mt: 2 }} onClick={() => router.push("/scan")}>Back to scan</Button>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2.5 }}>
      <Stack direction="row" spacing={2} alignItems="center">
        <AssignmentTurnedInIcon color="primary" sx={{ fontSize: 40 }} />
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="h6" fontWeight={700}>Assign to Project</Typography>
          <Stack direction="row" spacing={1} sx={{ mt: 0.5, alignItems: "center", flexWrap: "wrap" }}>
            <Chip size="small" label={`Unit ${ctx.inventory.sku}`} />
            <Typography variant="caption" color="text.secondary">{ctx.asset.name}</Typography>
          </Stack>
        </Box>
      </Stack>

      {currentProject ? (
        <Alert severity="info" sx={{ py: 0.5 }}>
          Currently on: <strong>{currentProject.name}</strong>
          {ctx.activeAssignment?.projectDeployment?.type
            ? ` (${ctx.activeAssignment.projectDeployment.type})`
            : ""}
        </Alert>
      ) : (
        <Typography variant="body2" color="text.secondary">
          Not assigned to any project yet.
        </Typography>
      )}

      <Autocomplete<CustomerOption, false, false, false>
        options={customerOptions}
        value={selectedCustomer}
        onChange={(_, picked) => setSelectedCustomer(picked)}
        onInputChange={(_, v, reason) => {
          // Ignore MUI's post-selection "reset" so the formatted label
          // doesn't pollute the search query (same guard as the bind page).
          if (reason === "input") setCustomerInput(v);
        }}
        getOptionLabel={(o) => (o.customerCode ? `${o.name} · ${o.customerCode}` : o.name)}
        isOptionEqualToValue={(a, b) => a.id === b.id}
        loading={customerSearching}
        // Server-side search drives the option list — disable the client-side
        // filter so backend partial matches aren't re-filtered away.
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
            label="Customer"
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
                label="Project"
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

      {selectedProject && (
        <ToggleButtonGroup
          value={deploymentType}
          exclusive
          fullWidth
          size="small"
          color="primary"
          onChange={(_, next) => {
            // exclusive group returns null when re-clicking the active button;
            // keep the current value so one option is always selected.
            if (next) setDeploymentType(next);
          }}
        >
          <ToggleButton value="RENTAL">Rental</ToggleButton>
          <ToggleButton value="SALE">Sale</ToggleButton>
        </ToggleButtonGroup>
      )}

      {error && <Alert severity="error">{error}</Alert>}

      <Button
        variant="contained"
        color="primary"
        fullWidth
        disabled={assigning || !selectedProject}
        onClick={onAssignTap}
        sx={FIELD_BUTTON_SX}
      >
        {assigning ? "Assigning..." : "Assign"}
      </Button>

      <Button
        variant="text"
        sx={{ color: "text.secondary", alignSelf: "center" }}
        onClick={() => router.back()}
      >
        Cancel
      </Button>

      {/* Confirm-move: the unit is on another project; assigning here
          soft-closes that assignment (history preserved, office sees the move). */}
      <Dialog open={confirmMoveOpen} onClose={() => (assigning ? null : setConfirmMoveOpen(false))} fullWidth maxWidth="xs">
        <DialogTitle>Move unit?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            Unit <strong>{ctx.inventory.sku}</strong> is currently on{" "}
            <strong>{currentProject?.name}</strong>. Move it to{" "}
            <strong>{selectedProject?.name}</strong> as {deploymentType}?
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmMoveOpen(false)} disabled={assigning}>Cancel</Button>
          <Button variant="contained" onClick={() => void doAssign()} disabled={assigning}>
            {assigning ? "Moving..." : "Move"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Create Project dialog — same minimal inline flow as the bind page:
          name only, linked to the selected customer, status defaults to pending. */}
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
          <Button onClick={() => setCreateProjectOpen(false)} disabled={creatingProject}>Cancel</Button>
          <Button variant="contained" onClick={handleCreateProject} disabled={creatingProject || !createProjectName.trim()}>
            {creatingProject ? "Creating..." : "Create"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
