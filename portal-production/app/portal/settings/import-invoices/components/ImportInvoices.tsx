"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  Box,
  Typography,
  Card,
  CardContent,
  Button,
  Chip,
  Paper,
  TextField,
  IconButton,
  Alert,
  LinearProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Autocomplete,
  Tabs,
  Tab,
  Tooltip,
  Divider,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Grid,
  Collapse,
} from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import WarningIcon from "@mui/icons-material/Warning";
import ErrorIcon from "@mui/icons-material/Error";
import SkipNextIcon from "@mui/icons-material/SkipNext";
import NavigateNextIcon from "@mui/icons-material/NavigateNext";
import NavigateBeforeIcon from "@mui/icons-material/NavigateBefore";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import DoneAllIcon from "@mui/icons-material/DoneAll";
import AddIcon from "@mui/icons-material/Add";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import EditIcon from "@mui/icons-material/Edit";
import { useImportData, Invoice, LineItem, Asset, Customer, Project, Category, SiteOffice } from "../hooks/useImportData";
import { useOrganization } from "@hooks/useOrganization";
import { toast } from "react-toastify";

// ─── Editable line item form state ───
interface EditableLineItem {
  description: string;
  quantity: number | null;
  unit_price: number | null;
  gross: number | null;
  is_reference_line: boolean;
  // Editable asset fields (inline form)
  selectedAssetId: string;
  selectedAssetName: string;
  selectedSku: string; // Asset skuKey (e.g. "MBR-10")
  serialNumbers: string[]; // Inventory serials (e.g. ["AF40-0007", "AF40-0010"])
  assetCategory: string;
  assetCategoryId: string;
  assetUom: string;
  assetPrice: string;
  assetDescription: string;
  confidence: string | null;
  match_reason: string;
  location: string | null;
  isNewAsset: boolean;
  isService: boolean; // true for SVC-* items — no serial numbers, no inventory creation
  hasSerialNumber: boolean; // false = asset only, no inventory item created
}

// ─── Editable invoice form state ───
interface InvoiceFormState {
  customerId: string;
  customerName: string;
  projectId: string;
  projectName: string;
  projectLocation: string;
  siteOfficeId: string;
  siteOfficeName: string;
  siteOfficeAddress: string;
  isNewSiteOffice: boolean;
  startDate: string;
  endDate: string;
  lineItems: EditableLineItem[];
}

const confidenceIcon = (c: string | null) => {
  if (c === "high") return <CheckCircleIcon fontSize="small" color="success" />;
  if (c === "medium") return <WarningIcon fontSize="small" color="warning" />;
  if (c === "low") return <WarningIcon fontSize="small" color="info" />;
  return <ErrorIcon fontSize="small" color="error" />;
};

function buildFormState(invoice: Invoice, customers: Customer[], projects: Project[], assets: Asset[]): InvoiceFormState {
  const matchedCustomer = customers.find(
    (c) => c.name.toLowerCase() === invoice.customer.toLowerCase()
  );

  // Try to match project by location
  const matchedProject = invoice.project_location
    ? projects.find((p) => p.name.toLowerCase().includes(invoice.project_location!.toLowerCase()))
    : undefined;

  const inv = invoice as any;

  return {
    customerId: matchedCustomer?.id || "",
    customerName: invoice.customer,
    projectId: matchedProject?.id || "",
    projectName: matchedProject?.name || inv.project_name || "",
    projectLocation: inv.project_name || invoice.project_location || "",
    siteOfficeId: "",
    siteOfficeName: inv.site_office_name || "",
    siteOfficeAddress: inv.site_office_address || "",
    isNewSiteOffice: !!(inv.site_office_name && !matchedProject),
    startDate: inv.do_date || (invoice.date ? invoice.date.split("T")[0] : ""),
    endDate: "",
    lineItems: invoice.line_items
      .filter((li) => !li.is_reference_line)
      .map((li) => {
        // Try to find existing asset by SKU
        const matchedAsset = li.asset_match?.sku
          ? assets.find((a) => a.skuKey === li.asset_match!.sku)
          : null;

        return {
          description: li.description,
          quantity: li.quantity,
          unit_price: li.unit_price,
          gross: li.gross,
          is_reference_line: false,
          selectedAssetId: matchedAsset?.id || "",
          selectedAssetName: matchedAsset?.name || li.asset_match?.name || "",
          selectedSku: matchedAsset?.skuKey || li.asset_match?.sku || "",
          serialNumbers: (li as any).serial_numbers || ((li as any).serial_number ? [(li as any).serial_number] : []),
          assetCategory: matchedAsset?.category?.name || li.asset_match?.category || "",
          assetCategoryId: matchedAsset?.categoryId || "",
          assetUom: matchedAsset?.uom || "PCS",
          assetPrice: matchedAsset?.price?.toString() || li.unit_price?.toString() || "",
          assetDescription: "",
          confidence: li.confidence,
          match_reason: li.match_reason,
          location: li.location,
          isNewAsset: !matchedAsset && !!li.asset_match?.name,
          isService: li.asset_match?.sku?.startsWith('SVC-') || li.asset_match?.category === 'Service' || false,
          hasSerialNumber: !!((li as any).serial_numbers?.length || (li as any).serial_number),
        };
      }),
  };
}

export default function ImportInvoices() {
  const { organization } = useOrganization();
  const {
    invoices,
    stats,
    assets,
    customers,
    projects,
    categories,
    loading,
    statusFilter,
    setStatusFilter,
    page,
    setPage,
    totalInvoices,
    totalPages,
    search,
    setSearch,
    confirmInvoice,
    skipInvoice,
    bulkConfirm,
    runImport,
    createAsset,
    refreshInvoices,
    refreshAssets,
    refreshProjects,
    fetchSiteOffices,
    createSiteOffice,
    createProject,
    importSingleInvoice,
  } = useImportData();

  const [currentIndex, setCurrentIndex] = useState(0);
  const [formState, setFormState] = useState<InvoiceFormState | null>(null);
  const [showRefLines, setShowRefLines] = useState(false);
  const [siteOffices, setSiteOffices] = useState<{ id: string; name: string; address?: string }[]>([]);
  const [createProjectDialogOpen, setCreateProjectDialogOpen] = useState(false);
  const [newProject, setNewProject] = useState({ name: "", customerId: "", siteOfficeId: "", startDate: "", endDate: "" });
  const [newProjectSiteOffices, setNewProjectSiteOffices] = useState<{ id: string; name: string; address?: string }[]>([]);

  // Only allow Biofuel org
  if (organization && organization.name !== "Biofuel Industries Pte Ltd") {
    return (
      <Box sx={{ p: 4 }}>
        <Alert severity="error">This page is only available for Biofuel Industries.</Alert>
      </Box>
    );
  }

  const currentInvoice = invoices[currentIndex];

  // Build form state when invoice changes — only for pending invoices
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (!currentInvoice) {
      setFormState(null);
      return;
    }
    // Only build editable form for pending invoices
    if (currentInvoice.review_status !== "pending") {
      setFormState(null);
      setSiteOffices([]);
      return;
    }
    if (customers.length > 0) {
      const state = buildFormState(currentInvoice, customers, projects, assets);
      setFormState(state);
      setSiteOffices([]);
      if (state.customerId) {
        fetchSiteOffices(state.customerId).then(setSiteOffices);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, currentInvoice?.invoice_number]);

  const referenceLines = currentInvoice?.line_items.filter((li) => li.is_reference_line) || [];

  // ─── Handlers ───

  const updateLineItem = (idx: number, field: keyof EditableLineItem, value: any) => {
    if (!formState) return;
    const updated = [...formState.lineItems];
    updated[idx] = { ...updated[idx], [field]: value };
    setFormState({ ...formState, lineItems: updated });
  };

  const handleAssetSelect = (idx: number, asset: Asset | null) => {
    if (!formState) return;
    const updated = [...formState.lineItems];
    updated[idx] = {
      ...updated[idx],
      selectedAssetId: asset?.id || "",
      selectedAssetName: asset?.name || "",
      selectedSku: asset?.skuKey || updated[idx].selectedSku || "",
      assetCategory: asset?.category?.name || updated[idx].assetCategory || "",
      assetCategoryId: asset?.categoryId || "",
      assetUom: asset?.uom || updated[idx].assetUom || "PCS",
      assetPrice: asset?.price?.toString() || updated[idx].assetPrice || "",
      confidence: asset ? "high" : updated[idx].confidence,
      isNewAsset: false,
    };
    setFormState({ ...formState, lineItems: updated });
  };

  const handleConfirm = async () => {
    if (!currentInvoice || !formState) return;

    try {
      // 1. Auto-create site office if new
      let siteOfficeId = formState.siteOfficeId;
      if (formState.isNewSiteOffice && formState.siteOfficeName && formState.customerId) {
        const created = await createSiteOffice({
          name: formState.siteOfficeName,
          address: formState.siteOfficeAddress || undefined,
          customerId: formState.customerId,
        });
        if (created) {
          siteOfficeId = created.id;
          toast.info(`Created site office: ${created.name}`);
        }
      }

      // 2. Auto-create project if it doesn't exist
      let projectId = formState.projectId;
      if (!projectId && formState.projectLocation && formState.customerId) {
        const created = await createProject({
          name: formState.projectLocation,
          customerId: formState.customerId,
          siteOfficeId: siteOfficeId || undefined,
          startDate: formState.startDate || undefined,
          endDate: formState.endDate || undefined,
        });
        if (created) {
          projectId = created.id;
          toast.info(`Created project: ${created.name}`);
        }
      }

      // 3. Auto-create any new assets that don't exist in DB (skip services)
      const updatedItems = [...formState.lineItems];
      for (let i = 0; i < updatedItems.length; i++) {
        const li = updatedItems[i];
        // Clear serial numbers if checkbox unchecked
        if (!li.hasSerialNumber) {
          updatedItems[i] = { ...updatedItems[i], serialNumbers: [] };
        }
        if (li.isService) continue; // Services don't need assets
        if (!li.selectedAssetId && li.selectedAssetName && li.selectedSku) {
          const created = await createAsset({
            name: li.selectedAssetName,
            skuKey: li.selectedSku,
            categoryName: li.assetCategory || "General",
            uom: li.assetUom || "PCS",
            isTracked: false,
          });
          if (created) {
            updatedItems[i] = { ...li, selectedAssetId: created.id, isNewAsset: false };
            toast.info(`Created asset: ${created.name} (${created.skuKey})`);
          }
        }
      }

      // 4. Create the invoice document in AIMS
      const importResult = await importSingleInvoice({
        invoiceNumber: currentInvoice.invoice_number,
        date: currentInvoice.date,
        customer: formState.customerName,
        status: currentInvoice.status,
        source: currentInvoice.source,
        gross: currentInvoice.gross,
        balance: currentInvoice.balance,
        lineItems: updatedItems,
        projectLocation: formState.projectLocation,
        projectId: projectId || undefined,
        siteOfficeId: siteOfficeId || undefined,
        startDate: formState.startDate || undefined,
        endDate: formState.endDate || undefined,
      });

      if (importResult?.success === false && importResult?.message === 'Invoice already exists') {
        // Already imported — just mark as confirmed, don't show error
      } else if (importResult) {
        toast.success(`Imported ${currentInvoice.invoice_number}`);
      }

      // 5. Mark as confirmed in the tracking file
      await confirmInvoice(
        currentInvoice.invoice_number,
        updatedItems as any,
        formState.projectLocation
      );

      // After refresh, the confirmed invoice disappears from pending list,
      // so currentIndex will naturally point to the next invoice.
      // Only adjust if we're at the end of the list.
      await refreshInvoices();
      if (currentIndex >= invoices.length - 1 && currentIndex > 0) {
        setCurrentIndex(currentIndex - 1);
      }
    } catch (err) {
      toast.error(`Error confirming: ${err}`);
    }
  };

  const handleSkip = async () => {
    if (!currentInvoice) return;
    const success = await skipInvoice(currentInvoice.invoice_number, "Skipped by user");
    if (success) {
      toast.info(`Skipped ${currentInvoice.invoice_number}`);
      await refreshInvoices();
      if (currentIndex >= invoices.length - 1 && currentIndex > 0) {
        setCurrentIndex(currentIndex - 1);
      }
    }
  };


  const isPending = currentInvoice?.review_status === "pending";

  return (
    <Box sx={{ p: 4, width: "100%" }}>
      {/* Header */}
      <Typography variant="h4" sx={{ fontWeight: 700, mb: 1 }}>
        Xero Invoice Import
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Review and confirm invoices before importing into AIMS
      </Typography>

      {/* Stats Cards */}
      {stats && (
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 2, mb: 3 }}>
          <StatCard label="Total" value={stats.total} color="#1976d2" />
          <StatCard label="Pending" value={stats.pending} color="#ed6c02" />
          <StatCard label="Confirmed" value={stats.confirmed} color="#2e7d32" />
          <StatCard label="Skipped" value={stats.skipped} color="#757575" />
          <StatCard label="Match Rate" value={stats.summary.match_rate} color="#9c27b0" />
        </Box>
      )}

      {/* Filters & Actions */}
      <Box sx={{ display: "flex", gap: 2, mb: 3, alignItems: "center", flexWrap: "wrap" }}>
        <Tabs
          value={statusFilter}
          onChange={(_, v) => { setStatusFilter(v); setCurrentIndex(0); setPage(1); }}
          sx={{ "& .MuiTab-root": { textTransform: "none" } }}
        >
          <Tab label="Pending" value="pending" />
          <Tab label="Confirmed" value="confirmed" />
          <Tab label="Skipped" value="skipped" />
          <Tab label="All" value="" />
        </Tabs>
        <Box sx={{ flex: 1 }} />
      </Box>

      {loading && <LinearProgress sx={{ mb: 2 }} />}

      {/* Invoice Navigator */}
      {invoices.length > 0 && (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
          <IconButton
            onClick={() => {
              if (currentIndex > 0) {
                setCurrentIndex(currentIndex - 1);
              } else if (page > 1) {
                setPage(page - 1);
                setCurrentIndex(19);
              }
            }}
            disabled={currentIndex === 0 && page === 1}
          >
            <NavigateBeforeIcon />
          </IconButton>
          <Typography variant="body2" sx={{ minWidth: 180, textAlign: "center" }}>
            {(page - 1) * 20 + currentIndex + 1} of {totalInvoices}
          </Typography>
          <IconButton
            onClick={() => {
              if (currentIndex < invoices.length - 1) {
                setCurrentIndex(currentIndex + 1);
              } else if (page < totalPages) {
                setPage(page + 1);
                setCurrentIndex(0);
              }
            }}
            disabled={currentIndex >= invoices.length - 1 && page >= totalPages}
          >
            <NavigateNextIcon />
          </IconButton>

          <Box sx={{ ml: 2 }} />

          {/* Search by invoice number or customer */}
          <TextField
            size="small"
            sx={{ width: 300 }}
            label="Search invoice or customer"
            placeholder="e.g. BI202509041"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
              setCurrentIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setSearch("");
                setPage(1);
                setCurrentIndex(0);
              }
            }}
          />
          {search && (
            <Button size="small" onClick={() => { setSearch(""); setPage(1); setCurrentIndex(0); }}>
              Clear
            </Button>
          )}
        </Box>
      )}

      {/* Current Invoice — Read-only view for confirmed/skipped */}
      {currentInvoice && !formState ? (
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", mb: 2 }}>
              <Box>
                <Typography variant="h5" sx={{ fontWeight: 700 }}>{currentInvoice.invoice_number}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {new Date(currentInvoice.date).toLocaleDateString("en-SG", { year: "numeric", month: "long", day: "numeric" })}
                </Typography>
              </Box>
              <Box sx={{ display: "flex", gap: 1 }}>
                <Chip label={currentInvoice.status} size="small" color={currentInvoice.status === "Paid" ? "success" : "primary"} />
                <Chip label={currentInvoice.review_status} size="small" color={currentInvoice.review_status === "confirmed" ? "success" : "default"} />
              </Box>
            </Box>

            <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 2, mb: 2 }}>
              <Box><Typography variant="caption" color="text.secondary">Customer</Typography><Typography variant="body2" sx={{ fontWeight: 500 }}>{currentInvoice.customer}</Typography></Box>
              <Box><Typography variant="caption" color="text.secondary">Gross</Typography><Typography variant="body2" sx={{ fontWeight: 500 }}>${currentInvoice.gross?.toLocaleString("en-SG", { minimumFractionDigits: 2 })}</Typography></Box>
              <Box><Typography variant="caption" color="text.secondary">Balance</Typography><Typography variant="body2" sx={{ fontWeight: 500 }}>${currentInvoice.balance?.toLocaleString("en-SG", { minimumFractionDigits: 2 })}</Typography></Box>
              <Box><Typography variant="caption" color="text.secondary">Project</Typography><Typography variant="body2" sx={{ fontWeight: 500 }}>{(currentInvoice as any).project_name || currentInvoice.project_location || "—"}</Typography></Box>
            </Box>

            <Divider sx={{ mb: 2 }} />

            {/* Line items - simple list */}
            {(currentInvoice.line_items as any[])?.filter((li: any) => !li.is_reference_line).map((li: any, idx: number) => (
              <Box key={idx} sx={{ p: 1.5, mb: 1, borderLeft: "3px solid #2e7d32", bgcolor: "rgba(46,125,50,0.03)", borderRadius: 1 }}>
                <Typography variant="body2" sx={{ fontSize: 13, mb: 0.5 }}>{li.description?.split("\n")[0]?.slice(0, 150)}</Typography>
                <Typography variant="caption" color="text.secondary">
                  Qty: {li.quantity} | ${li.unit_price?.toLocaleString("en-SG", { minimumFractionDigits: 2 })} | Gross: ${li.gross?.toLocaleString("en-SG", { minimumFractionDigits: 2 })}
                  {li.asset_match?.name ? ` | Asset: ${li.asset_match.name} (${li.asset_match.sku})` : ""}
                  {li.serial_numbers?.length ? ` | S/N: ${li.serial_numbers.join(", ")}` : li.serialNumbers?.length ? ` | S/N: ${li.serialNumbers.join(", ")}` : ""}
                </Typography>
              </Box>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {/* Current Invoice — Editable form for pending */}
      {currentInvoice && formState ? (
        <Card sx={{ mb: 3 }}>
          <CardContent>
            {/* ─── Invoice Header ─── */}
            <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", mb: 3 }}>
              <Box>
                <Typography variant="h5" sx={{ fontWeight: 700 }}>
                  {currentInvoice.invoice_number}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {new Date(currentInvoice.date).toLocaleDateString("en-SG", { year: "numeric", month: "long", day: "numeric" })}
                </Typography>
              </Box>
              <Box sx={{ display: "flex", gap: 1 }}>
                <Chip label={currentInvoice.status} size="small"
                  color={currentInvoice.status === "Paid" ? "success" : currentInvoice.status === "Approved" ? "primary" : "default"} />
                <Chip label={currentInvoice.source === "Receivable Credit Note" ? "Credit Note" : "Invoice"}
                  size="small" variant="outlined"
                  color={currentInvoice.source === "Receivable Credit Note" ? "error" : "default"} />
                <Chip label={currentInvoice.review_status} size="small"
                  color={currentInvoice.review_status === "confirmed" ? "success" : currentInvoice.review_status === "skipped" ? "default" : "warning"} />
              </Box>
            </Box>

            {/* ─── Invoice Details Form ─── */}
            <Paper variant="outlined" sx={{ p: 2.5, mb: 3, bgcolor: "#fafbfc" }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 2 }}>Invoice Details</Typography>
              <Grid container spacing={2}>
                {/* Customer */}
                <Grid item xs={12} md={4}>
                  <Autocomplete
                    size="small"
                    value={customers.find((c) => c.id === formState.customerId) || null}
                    onChange={(_, val) => {
                      setFormState({
                        ...formState,
                        customerId: val?.id || "",
                        customerName: val?.name || formState.customerName,
                        siteOfficeId: "",
                      });
                      if (val?.id) {
                        fetchSiteOffices(val.id).then(setSiteOffices);
                      } else {
                        setSiteOffices([]);
                      }
                    }}
                    options={customers}
                    getOptionLabel={(c) => `${c.name} (${c.customerCode})`}
                    renderInput={(params) => (
                      <TextField {...params} label="Customer" required
                        helperText={!formState.customerId ? `Xero: "${currentInvoice.customer}"` : undefined}
                        error={!formState.customerId}
                      />
                    )}
                    disabled={!isPending}
                  />
                </Grid>

                {/* Gross */}
                <Grid item xs={6} md={2}>
                  <TextField size="small" label="Gross" value={`$${currentInvoice.gross?.toLocaleString("en-SG", { minimumFractionDigits: 2 }) || "0.00"}`}
                    InputProps={{ readOnly: true }} fullWidth />
                </Grid>

                {/* Balance */}
                <Grid item xs={6} md={2}>
                  <TextField size="small" label="Balance" value={`$${currentInvoice.balance?.toLocaleString("en-SG", { minimumFractionDigits: 2 }) || "0.00"}`}
                    InputProps={{ readOnly: true }} fullWidth />
                </Grid>

                {/* Project */}
                <Grid item xs={12} md={4}>
                  <Autocomplete
                    size="small"
                    freeSolo
                    fullWidth
                    value={formState.projectLocation}
                    onChange={(_, val) => {
                      if (typeof val === "string") {
                        setFormState({ ...formState, projectLocation: val });
                      } else {
                        setFormState({ ...formState, projectId: val?.id || "", projectName: val?.name || "", projectLocation: val?.name || "" });
                      }
                    }}
                    onInputChange={(_, val) => {
                      setFormState({ ...formState, projectLocation: val });
                    }}
                    options={projects}
                    getOptionLabel={(opt) => typeof opt === "string" ? opt : opt.name}
                    renderInput={(params) => (
                      <TextField {...params} label="Project / Location" placeholder="Type or select" />
                    )}
                    disabled={!isPending}
                  />
                </Grid>

                {/* Site Office - select existing or fill in new */}
                <Grid item xs={12} md={4}>
                  <Autocomplete
                    size="small"
                    value={siteOffices.find((s) => s.id === formState.siteOfficeId) || null}
                    onChange={(_, val) => setFormState({
                      ...formState,
                      siteOfficeId: val?.id || "",
                      siteOfficeName: val?.name || "",
                      siteOfficeAddress: val?.address || "",
                      isNewSiteOffice: false,
                    })}
                    options={siteOffices}
                    getOptionLabel={(s) => `${s.name}${s.address ? ` — ${s.address}` : ""}`}
                    renderInput={(params) => <TextField {...params} label="Select Existing Site Office (or fill in below)" />}
                    disabled={!isPending || !formState.customerId}
                    noOptionsText={formState.customerId ? "No site offices — fill in below to create" : "Select a customer first"}
                  />
                </Grid>

                {/* Site Office Name */}
                <Grid item xs={6} md={4}>
                  <TextField
                    size="small"
                    fullWidth
                    label="Site Office Name"
                    value={formState.siteOfficeName}
                    onChange={(e) => setFormState({ ...formState, siteOfficeName: e.target.value, siteOfficeId: "", isNewSiteOffice: true })}
                    disabled={!isPending || !formState.customerId || !!formState.siteOfficeId}
                    placeholder="e.g. Main Site"
                  />
                </Grid>

                {/* Site Office Address */}
                <Grid item xs={6} md={4}>
                  <TextField
                    size="small"
                    fullWidth
                    label="Site Office Address"
                    value={formState.siteOfficeAddress}
                    onChange={(e) => setFormState({ ...formState, siteOfficeAddress: e.target.value, siteOfficeId: "", isNewSiteOffice: true })}
                    disabled={!isPending || !formState.customerId || !!formState.siteOfficeId}
                    placeholder="e.g. 30 Lim Chu Kang Lane 5"
                  />
                </Grid>

                {/* Start Date */}
                <Grid item xs={6} md={4}>
                  <TextField
                    size="small"
                    fullWidth
                    label="Start Date"
                    type="date"
                    value={formState.startDate}
                    onChange={(e) => setFormState({ ...formState, startDate: e.target.value })}
                    InputLabelProps={{ shrink: true }}
                    disabled={!isPending}
                  />
                </Grid>

                {/* End Date */}
                <Grid item xs={6} md={4}>
                  <TextField
                    size="small"
                    fullWidth
                    label="End Date"
                    type="date"
                    value={formState.endDate}
                    onChange={(e) => setFormState({ ...formState, endDate: e.target.value })}
                    InputLabelProps={{ shrink: true }}
                    disabled={!isPending}
                  />
                </Grid>
              </Grid>
            </Paper>

            <Divider sx={{ mb: 3 }} />

            {/* ─── Line Items ─── */}
            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 2 }}>
              Line Items ({formState.lineItems.length})
            </Typography>

            {formState.lineItems.map((li, idx) => (
              <Paper
                key={idx}
                variant="outlined"
                sx={{
                  p: 2,
                  mb: 2,
                  borderLeft: `4px solid ${
                    li.confidence === "high" && li.selectedAssetId ? "#2e7d32" :
                    li.confidence === "medium" ? "#ed6c02" :
                    li.confidence === "low" ? "#0288d1" : "#d32f2f"
                  }`,
                }}
              >
                {/* ── Xero Description (read-only context) ── */}
                <Box sx={{ display: "flex", gap: 2, mb: 2, alignItems: "flex-start" }}>
                  <Typography variant="caption" sx={{ fontWeight: 700, color: "text.secondary", minWidth: 28, pt: 0.5 }}>
                    #{idx + 1}
                  </Typography>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Tooltip title={li.description} placement="bottom-start">
                      <Typography variant="body2" sx={{ fontSize: 13, mb: 0.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {li.description.split("\n")[0]}
                      </Typography>
                    </Tooltip>
                    <Box sx={{ display: "flex", gap: 3, alignItems: "center" }}>
                      <Typography variant="caption" color="text.secondary">
                        Qty:{" "}
                        {isPending ? (
                          <input
                            type="number"
                            value={li.quantity ?? 0}
                            onChange={(e) => {
                              const newQty = parseInt(e.target.value) || 0;
                              updateLineItem(idx, "quantity", newQty);
                              // Trim serial numbers array if qty decreased
                              if (newQty < li.serialNumbers.length) {
                                updateLineItem(idx, "serialNumbers", li.serialNumbers.slice(0, newQty));
                              }
                            }}
                            min={0}
                            style={{ width: 50, fontWeight: 700, border: "1px solid #ccc", borderRadius: 4, padding: "1px 4px", fontSize: 12 }}
                          />
                        ) : (
                          <strong>{li.quantity ?? "—"}</strong>
                        )}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Unit: <strong>${li.unit_price?.toLocaleString("en-SG", { minimumFractionDigits: 2 }) ?? "—"}</strong>
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Gross: <strong>${li.gross?.toLocaleString("en-SG", { minimumFractionDigits: 2 }) ?? "—"}</strong>
                      </Typography>
                      <Tooltip title={li.match_reason || ""}>
                        <Box sx={{ display: "flex", alignItems: "center", gap: 0.3 }}>
                          {confidenceIcon(li.confidence)}
                          <Typography variant="caption" color="text.secondary">{li.confidence || "none"}</Typography>
                        </Box>
                      </Tooltip>
                      {li.isNewAsset && !li.selectedAssetId && (
                        <Chip label="New Asset" size="small" color="warning" sx={{ height: 20, fontSize: 11 }} />
                      )}
                      {li.selectedAssetId && (
                        <Chip label="Exists in DB" size="small" color="success" sx={{ height: 20, fontSize: 11 }} />
                      )}
                    </Box>
                  </Box>
                </Box>

                {/* ── Asset/Service Form Fields (inline, pre-filled by AI) ── */}
                <Box sx={{ ml: 4 }}>
                  {/* Toggle between Service and Product */}
                  <Box sx={{ mb: 1, display: "flex", alignItems: "center", gap: 1 }}>
                    <Chip
                      label={li.isService ? "Service" : "Product"}
                      size="small"
                      color={li.isService ? "secondary" : "primary"}
                      onClick={() => isPending && updateLineItem(idx, "isService", !li.isService)}
                      sx={{ height: 22, cursor: isPending ? "pointer" : "default" }}
                    />
                    {isPending && (
                      <Typography variant="caption" color="text.secondary">
                        Click to switch to {li.isService ? "product (with inventory)" : "service (no inventory)"}
                      </Typography>
                    )}
                  </Box>

                  {li.isService ? (
                    /* ── Service Item: just show name, no asset/serial/inventory ── */
                    <Box sx={{ display: "flex", gap: 1.5, alignItems: "center" }}>
                      <Typography variant="body2" color="text.secondary">
                        {li.selectedAssetName || "Service Item"} ({li.selectedSku || "—"}) — No inventory tracking
                      </Typography>
                    </Box>
                  ) : (
                  /* ── Asset Item: full form with serial numbers ── */
                  <Grid container spacing={1.5}>
                    {/* Existing Asset Dropdown */}
                    <Grid item xs={12}>
                      <Autocomplete
                        size="small"
                        value={assets.find((a) => a.id === li.selectedAssetId) || null}
                        onChange={(_, val) => handleAssetSelect(idx, val)}
                        options={assets}
                        getOptionLabel={(a) => `${a.name} (${a.skuKey})`}
                        renderOption={(props, option) => (
                          <li {...props} key={option.id}>
                            <Box>
                              <Typography variant="body2">{option.name}</Typography>
                              <Typography variant="caption" color="text.secondary">
                                SKU: {option.skuKey} | {option.category?.name || "—"} | {option.uom}
                              </Typography>
                            </Box>
                          </li>
                        )}
                        renderInput={(params) => (
                          <TextField
                            {...params}
                            label="Select Existing Asset (or fill in below to create new)"
                            placeholder="Search by name or SKU..."
                          />
                        )}
                        disabled={!isPending}
                      />
                    </Grid>

                    {/* Name + SKU + Serial */}
                    <Grid item xs={12} md={4}>
                      <TextField
                        size="small"
                        fullWidth
                        label="Asset Name"
                        value={li.selectedAssetName}
                        onChange={(e) => updateLineItem(idx, "selectedAssetName", e.target.value)}
                        disabled={!isPending || !!li.selectedAssetId}
                        required
                      />
                    </Grid>
                    <Grid item xs={6} md={2.5}>
                      <TextField
                        size="small"
                        fullWidth
                        label="SKU Key"
                        value={li.selectedSku}
                        onChange={(e) => updateLineItem(idx, "selectedSku", e.target.value.toUpperCase())}
                        disabled={!isPending || !!li.selectedAssetId}
                        required
                        error={!li.selectedSku && !li.selectedAssetId}
                        placeholder="e.g. MBR-10"
                      />
                    </Grid>
                    <Grid item xs={6} md={2.5}>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 0.5 }}>
                        <input
                          type="checkbox"
                          checked={li.hasSerialNumber}
                          onChange={(e) => updateLineItem(idx, "hasSerialNumber", e.target.checked)}
                          disabled={!isPending}
                          style={{ cursor: isPending ? "pointer" : "default" }}
                        />
                        <Typography variant="caption" color="text.secondary">Has Serial No.</Typography>
                      </Box>
                      {li.hasSerialNumber && (
                        (li.quantity && li.quantity > 1 ? Array.from({ length: li.quantity }, (_, i) => i) : [0]).map((i) => (
                          <TextField
                            key={i}
                            size="small"
                            fullWidth
                            label={li.quantity && li.quantity > 1 ? `Serial No. ${i + 1}/${li.quantity}` : "Serial No."}
                            value={li.serialNumbers[i] || ""}
                            onChange={(e) => {
                              const updated = [...li.serialNumbers];
                              updated[i] = e.target.value.toUpperCase();
                              updateLineItem(idx, "serialNumbers", updated);
                            }}
                            disabled={!isPending}
                            placeholder={li.selectedSku ? `e.g. ${li.selectedSku}-${String(i + 1).padStart(3, "0")}` : "e.g. MG20250079"}
                            required
                            error={!li.serialNumbers[i]}
                            sx={{ mb: li.quantity && li.quantity > 1 && i < li.quantity - 1 ? 0.5 : 0 }}
                          />
                        ))
                      )}
                    </Grid>

                    {/* Category + UOM */}
                    <Grid item xs={6} md={1.5}>
                      <Autocomplete
                        size="small"
                        freeSolo
                        value={li.assetCategory}
                        onInputChange={(_, val) => updateLineItem(idx, "assetCategory", val)}
                        onChange={(_, val) => {
                          if (typeof val === "string") {
                            updateLineItem(idx, "assetCategory", val);
                          } else if (val) {
                            updateLineItem(idx, "assetCategory", val.name);
                            updateLineItem(idx, "assetCategoryId", val.id);
                          }
                        }}
                        options={categories}
                        getOptionLabel={(c) => typeof c === "string" ? c : c.name}
                        renderInput={(params) => <TextField {...params} label="Category" size="small" />}
                        disabled={!isPending || !!li.selectedAssetId}
                      />
                    </Grid>
                    <Grid item xs={6} md={1.5}>
                      <FormControl size="small" fullWidth disabled={!isPending || !!li.selectedAssetId}>
                        <InputLabel>UOM</InputLabel>
                        <Select
                          value={li.assetUom}
                          label="UOM"
                          onChange={(e) => updateLineItem(idx, "assetUom", e.target.value)}
                        >
                          {["PCS","EA","UNIT","SET","PAIR","BOX","KG","L","M","SQM","LOT","MTH","DAY","HR","TRIP","LOAD"].map((u) => (
                            <MenuItem key={u} value={u}>{u}</MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Grid>

                    {/* Create Asset Now button — creates asset immediately so other line items can use it */}
                    {isPending && !li.selectedAssetId && li.selectedAssetName && li.selectedSku && (
                      <Grid item xs={12}>
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={<AddIcon />}
                          onClick={async () => {
                            const created = await createAsset({
                              name: li.selectedAssetName,
                              skuKey: li.selectedSku,
                              categoryName: li.assetCategory || "General",
                              uom: li.assetUom || "PCS",
                              isTracked: false,
                            });
                            if (created && formState) {
                              // Update ALL line items that have the same SKU to use this asset
                              const updated = [...formState.lineItems];
                              for (let j = 0; j < updated.length; j++) {
                                if (updated[j].selectedSku === li.selectedSku && !updated[j].selectedAssetId) {
                                  updated[j] = { ...updated[j], selectedAssetId: created.id, selectedAssetName: created.name, isNewAsset: false };
                                }
                              }
                              setFormState({ ...formState, lineItems: updated });
                              toast.success(`Created asset: ${created.name} (${created.skuKey})`);
                            }
                          }}
                        >
                          Create Asset Now
                        </Button>
                      </Grid>
                    )}
                  </Grid>
                  )}
                </Box>
              </Paper>
            ))}

            {/* ─── Reference Lines (collapsed) ─── */}
            {referenceLines.length > 0 && (
              <Box sx={{ mt: 2 }}>
                <Button
                  size="small"
                  color="inherit"
                  onClick={() => setShowRefLines(!showRefLines)}
                  startIcon={showRefLines ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                  sx={{ textTransform: "none", color: "text.secondary" }}
                >
                  Reference Lines ({referenceLines.length}) — auto-skipped
                </Button>
                <Collapse in={showRefLines}>
                  <Box sx={{ bgcolor: "#fafafa", p: 1.5, borderRadius: 1, mt: 1, maxHeight: 200, overflow: "auto" }}>
                    {referenceLines.map((li, idx) => (
                      <Typography key={idx} variant="caption" display="block" color="text.secondary" sx={{ fontSize: 11, lineHeight: 1.6 }}>
                        {li.description.split("\n")[0].slice(0, 150)}
                      </Typography>
                    ))}
                  </Box>
                </Collapse>
              </Box>
            )}

            {/* ─── Action Buttons ─── */}
            {isPending && (
              <Box sx={{ display: "flex", gap: 2, justifyContent: "flex-end", mt: 3, pt: 2, borderTop: "1px solid #eee" }}>
                <Button variant="outlined" color="inherit" startIcon={<SkipNextIcon />} onClick={handleSkip}>
                  Skip
                </Button>
                <Button variant="contained" color="success" startIcon={<CheckCircleIcon />} onClick={handleConfirm}>
                  Confirm Invoice
                </Button>
              </Box>
            )}
          </CardContent>
        </Card>
      ) : (
        !loading && (
          <Alert severity="info" sx={{ mt: 2 }}>
            No invoices found for the selected filter.
          </Alert>
        )
      )}


      {/* ─── Create Project Dialog ─── */}
      <Dialog open={createProjectDialogOpen} onClose={() => setCreateProjectDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Create New Project</DialogTitle>
        <DialogContent>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2, mt: 1 }}>
            <TextField
              label="Project Name"
              value={newProject.name}
              onChange={(e) => setNewProject({ ...newProject, name: e.target.value })}
              required
              fullWidth
            />
            <Autocomplete
              value={customers.find((c) => c.id === newProject.customerId) || null}
              onChange={(_, val) => {
                setNewProject({ ...newProject, customerId: val?.id || "", siteOfficeId: "" });
                if (val?.id) {
                  fetchSiteOffices(val.id).then(setNewProjectSiteOffices);
                } else {
                  setNewProjectSiteOffices([]);
                }
              }}
              options={customers}
              getOptionLabel={(c) => `${c.name} (${c.customerCode})`}
              renderInput={(params) => <TextField {...params} label="Customer" required />}
            />
            <Autocomplete
              value={newProjectSiteOffices.find((s) => s.id === newProject.siteOfficeId) || null}
              onChange={(_, val) => setNewProject({ ...newProject, siteOfficeId: val?.id || "" })}
              options={newProjectSiteOffices}
              getOptionLabel={(s) => `${s.name}${s.address ? ` — ${s.address}` : ""}`}
              renderInput={(params) => <TextField {...params} label="Site Office (optional)" />}
              disabled={!newProject.customerId}
              noOptionsText={newProject.customerId ? "No site offices for this customer" : "Select a customer first"}
            />
            <Box sx={{ display: "flex", gap: 2 }}>
              <TextField
                label="Start Date"
                type="date"
                value={newProject.startDate}
                onChange={(e) => setNewProject({ ...newProject, startDate: e.target.value })}
                InputLabelProps={{ shrink: true }}
                fullWidth
              />
              <TextField
                label="End Date"
                type="date"
                value={newProject.endDate}
                onChange={(e) => setNewProject({ ...newProject, endDate: e.target.value })}
                InputLabelProps={{ shrink: true }}
                fullWidth
              />
            </Box>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateProjectDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={!newProject.name || !newProject.customerId}
            onClick={async () => {
              const created = await createProject({
                name: newProject.name,
                customerId: newProject.customerId,
                siteOfficeId: newProject.siteOfficeId || undefined,
                startDate: newProject.startDate || undefined,
                endDate: newProject.endDate || undefined,
              });
              if (created) {
                toast.success(`Created project: ${created.name}`);
                if (formState) {
                  setFormState({
                    ...formState,
                    projectId: created.id,
                    projectName: created.name,
                    projectLocation: created.name,
                  });
                }
                setCreateProjectDialogOpen(false);
              }
            }}
          >
            Create Project
          </Button>
        </DialogActions>
      </Dialog>

    </Box>
  );
}

function StatCard({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <Card sx={{ border: `2px solid ${color}15`, bgcolor: `${color}08` }}>
      <CardContent sx={{ py: 1.5, px: 2, "&:last-child": { pb: 1.5 } }}>
        <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>
          {label}
        </Typography>
        <Typography variant="h5" sx={{ fontWeight: 700, color }}>
          {value}
        </Typography>
      </CardContent>
    </Card>
  );
}
