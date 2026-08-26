"use client";

import React, { useEffect, useRef, useState } from "react";
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
  IconButton,
  InputAdornment,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import SearchIcon from "@mui/icons-material/Search";
import ClearIcon from "@mui/icons-material/Clear";
import { useAuth } from "@clerk/nextjs";
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
interface POOption {
  id: string;
  name: string | null;
  poNumber: string | null;
  status: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

// Public base for the shareable link. Mirrors the delivery share link, which
// builds off NEXT_PUBLIC_APP_URL and falls back to the prod host.
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://www.ai-ms.io";

export default function AddCustomerInfoDialog({ open, onClose, onCreated }: Props) {
  const { getToken } = useAuth();

  const [customerOptions, setCustomerOptions] = useState<CustomerOption[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerOption | null>(null);
  const [customerInput, setCustomerInput] = useState("");
  const [customerSearching, setCustomerSearching] = useState(false);
  const [projectOptions, setProjectOptions] = useState<ProjectOption[]>([]);
  const [selectedProject, setSelectedProject] = useState<ProjectOption | null>(null);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const prevCustomerRef = useRef<string | null>(null);

  // Optional pre-selected PO for the project. Left blank => the customer must
  // upload one on the public form.
  const [poOptions, setPoOptions] = useState<POOption[]>([]);
  const [selectedPo, setSelectedPo] = useState<POOption | null>(null);
  const [poLoading, setPoLoading] = useState(false);
  const [poPickerOpen, setPoPickerOpen] = useState(false);
  const [poSearch, setPoSearch] = useState("");

  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Once minted, we show the shareable link instead of the picker.
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);

  // Reset everything when the dialog closes.
  useEffect(() => {
    if (open) return;
    setSelectedCustomer(null);
    setCustomerInput("");
    setCustomerOptions([]);
    setSelectedProject(null);
    setProjectOptions([]);
    setPoOptions([]);
    setSelectedPo(null);
    setPoPickerOpen(false);
    setPoSearch("");
    setError(null);
    setGeneratedUrl(null);
    prevCustomerRef.current = null;
  }, [open]);

  // Load the project's PO documents for the picker whenever the project changes.
  useEffect(() => {
    setSelectedPo(null);
    setPoOptions([]);
    if (!selectedProject) return;
    let cancelled = false;
    (async () => {
      setPoLoading(true);
      try {
        const token = await getToken();
        if (!token) return;
        const res = await request(
          { path: `/customer-info/pos?projectId=${encodeURIComponent(selectedProject.id)}`, method: "GET" },
          {},
          token,
        );
        if (cancelled) return;
        const list = res?.data ?? res;
        setPoOptions(Array.isArray(list) ? list : []);
      } catch {
        /* non-fatal: leave blank so the customer uploads one */
      } finally {
        if (!cancelled) setPoLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedProject, getToken]);

  // Debounced customer search (existing customers only, no inline create).
  useEffect(() => {
    if (!open) return;
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
          Array.isArray(docs) ? docs.map((c: any) => ({ id: c.id, name: c.name, customerCode: c.customerCode ?? null })) : [],
        );
      } catch {
        /* non-fatal: keep last options */
      } finally {
        if (!cancelled) setCustomerSearching(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [customerInput, open, getToken]);

  // Dependent project list for the chosen customer. Changing customer resets it.
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
        /* non-fatal */
      } finally {
        if (!cancelled) setProjectsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedCustomer, getToken]);

  const handleGenerate = async () => {
    if (!selectedCustomer || !selectedProject) return;
    setGenerating(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const res = await request(
        { path: "/customer-info", method: "POST" },
        {
          customerId: selectedCustomer.id,
          projectId: selectedProject.id,
          ...(selectedPo ? { poDocumentId: selectedPo.id } : {}),
        },
        token,
      );
      const data = res?.data ?? res;
      if (res?.success === false || !data?.token) throw new Error(res?.message ?? "Failed to generate link");
      setGeneratedUrl(`${APP_URL}/guest/customer-info/${data.token}`);
      onCreated();
    } catch (e: any) {
      setError(e?.message ?? "Failed to generate link");
    } finally {
      setGenerating(false);
    }
  };

  const copyUrl = async () => {
    if (!generatedUrl) return;
    try {
      await navigator.clipboard.writeText(generatedUrl);
      toast.success("Link copied");
    } catch {
      toast.info("Copy failed. Select the link and copy it manually.");
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Add Customer Info</DialogTitle>
      <DialogContent>
        {generatedUrl ? (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, mt: 0.5 }}>
            <Typography variant="body2" color="text.secondary">
              Share this link with the customer. They fill in their DO and Invoice contacts and submit. The link works
              for 30 days.
            </Typography>
            <Stack direction="row" spacing={1} alignItems="center">
              <TextField value={generatedUrl} fullWidth size="small" InputProps={{ readOnly: true }} />
              <IconButton onClick={copyUrl} color="primary" aria-label="Copy link">
                <ContentCopyIcon />
              </IconButton>
            </Stack>
          </Box>
        ) : (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2, mt: 0.5 }}>
            <Typography variant="body2" color="text.secondary">
              Pick the customer and project, then generate a link to collect their contact people.
            </Typography>
            <Autocomplete<CustomerOption, false, false, false>
              options={customerOptions}
              value={selectedCustomer}
              onChange={(_, v) => setSelectedCustomer(v)}
              onInputChange={(_, v, reason) => {
                if (reason === "input") setCustomerInput(v);
              }}
              getOptionLabel={(o) => (o.customerCode ? `${o.name} (${o.customerCode})` : o.name)}
              isOptionEqualToValue={(a, b) => a.id === b.id}
              loading={customerSearching}
              filterOptions={(x) => x}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Customer"
                  placeholder="Search customer"
                  required
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
            <Autocomplete<ProjectOption, false, false, false>
              options={projectOptions}
              value={selectedProject}
              onChange={(_, v) => setSelectedProject(v)}
              getOptionLabel={(o) => o.name}
              isOptionEqualToValue={(a, b) => a.id === b.id}
              loading={projectsLoading}
              disabled={!selectedCustomer}
              noOptionsText={selectedCustomer ? "No projects for this customer" : "Pick a customer first"}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Project"
                  placeholder={selectedCustomer ? "Search project" : "Pick a customer first"}
                  required
                  error={!!selectedCustomer && !selectedProject}
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
            {/* Optional PO picker (mirrors the DO editor's Customer Code popup):
                read-only box + search icon opening a table of the project's POs. */}
            <Box>
              <TextField
                label="Purchase Order (optional)"
                value={selectedPo ? selectedPo.poNumber || selectedPo.name || "PO" : ""}
                placeholder={selectedProject ? "Select a PO, or leave blank" : "Pick a project first"}
                fullWidth
                size="small"
                disabled={!selectedProject}
                InputProps={{
                  readOnly: true,
                  endAdornment: (
                    <InputAdornment position="end">
                      {selectedPo && (
                        <IconButton size="small" onClick={() => setSelectedPo(null)} aria-label="Clear PO">
                          <ClearIcon fontSize="small" />
                        </IconButton>
                      )}
                      <IconButton
                        size="small"
                        disabled={!selectedProject}
                        onClick={() => setPoPickerOpen(true)}
                        aria-label="Select PO"
                      >
                        <SearchIcon fontSize="small" />
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
              />
              <Typography variant="caption" color="text.secondary">
                {selectedPo
                  ? "The customer will not be asked to upload a PO."
                  : "Leave blank and the customer must upload their PO on the form."}
              </Typography>
            </Box>
            {error && <Alert severity="error">{error}</Alert>}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        {generatedUrl ? (
          <Button variant="contained" onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button onClick={onClose} disabled={generating}>
              Cancel
            </Button>
            <Button variant="contained" onClick={handleGenerate} disabled={generating || !selectedCustomer || !selectedProject}>
              {generating ? <CircularProgress size={18} color="inherit" /> : "Generate link"}
            </Button>
          </>
        )}
      </DialogActions>

      {/* PO picker popup — the project's PO documents, client-side filtered. */}
      <Dialog open={poPickerOpen} onClose={() => setPoPickerOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Select Purchase Order</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            size="small"
            placeholder="Search PO number"
            value={poSearch}
            onChange={(e) => setPoSearch(e.target.value)}
            sx={{ mb: 1.5, mt: 0.5 }}
          />
          {poLoading ? (
            <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
              <CircularProgress size={24} />
            </Box>
          ) : poOptions.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No purchase orders on this project yet. Close this and leave the field blank; the customer
              will upload their PO on the form.
            </Typography>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>PO Number</TableCell>
                  <TableCell>Document</TableCell>
                  <TableCell>Status</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {poOptions
                  .filter((po) => {
                    const t = poSearch.trim().toLowerCase();
                    if (!t) return true;
                    return [po.poNumber, po.name].some((v) => String(v ?? "").toLowerCase().includes(t));
                  })
                  .map((po) => (
                    <TableRow
                      key={po.id}
                      hover
                      sx={{ cursor: "pointer" }}
                      onClick={() => {
                        setSelectedPo(po);
                        setPoPickerOpen(false);
                      }}
                    >
                      <TableCell>{po.poNumber || po.name || "-"}</TableCell>
                      <TableCell>{po.name || "-"}</TableCell>
                      <TableCell>{po.status}</TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPoPickerOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  );
}
