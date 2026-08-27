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
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
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
    setError(null);
    setGeneratedUrl(null);
    prevCustomerRef.current = null;
  }, [open]);

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
    </Dialog>
  );
}
