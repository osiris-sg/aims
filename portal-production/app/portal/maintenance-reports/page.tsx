"use client";

import React, { useCallback, useEffect, useState } from "react";
import { reportNoText } from "@/helpers/serviceReportOrder";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  Menu,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import AddIcon from "@mui/icons-material/Add";
import DownloadIcon from "@mui/icons-material/Download";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import { request } from "@/helpers/request";
import { MAX_BULK_REPORTS } from "@/helpers/serviceReportFiles";
import { downloadServiceReportsZip } from "@/helpers/downloadServiceReportsZip";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";
import NewServiceReportDialog from "./_components/NewServiceReportDialog";
import UploadServiceReportDialog from "./_components/UploadServiceReportDialog";
import { readServiceReportFlow, type ServiceReportPrefill } from "@/helpers/serviceReportFlow";

interface ServiceData {
  customerName?: string | null;
  serviceDate?: string | null;
  jobLocation?: string | null;
  /** WCT: created with the delivery run, not yet written by the technician. */
  scheduled?: boolean;
  /** Filed from the office as an existing file (Upload Service Report). */
  uploaded?: boolean;
  /** Sent to the customer (signature link / email): never deleted. */
  customerSentAt?: string | null;
  emailSentAt?: string | null;
}

interface MsrRow {
  id: string;
  status?: string;
  reportNumber: number | null;
  createdAt: string;
  paymentRequired: boolean;
  invoiceDocumentId: string | null;
  serviceData: ServiceData | null;
  asset: { name: string; skuKey: string } | null;
  inventory: { sku: string; serialNumber: string | null } | null;
}

type StatusKind = "pending-sign" | "completed" | "pending-invoice" | "invoice-created" | "scheduled";

const statusFor = (row: MsrRow): StatusKind => {
  // WCT: scheduled with the run, written by the technician after the sign-off.
  if (row.status === "draft" && row.serviceData?.scheduled) return "scheduled";
  // Submitted unsigned (field app Skip): waiting for the customer's signature.
  if (row.status === "draft") return "pending-sign";
  if (!row.paymentRequired) return "completed";
  if (row.invoiceDocumentId) return "invoice-created";
  return "pending-invoice";
};

const statusChipProps = (kind: StatusKind): { label: string; color: "success" | "warning" | "info"; variant: "filled" | "outlined" } => {
  if (kind === "scheduled") return { label: "Scheduled", color: "info", variant: "outlined" };
  if (kind === "pending-sign") return { label: "Pending sign", color: "warning", variant: "outlined" };
  if (kind === "pending-invoice") return { label: "Pending Invoice", color: "warning", variant: "filled" };
  if (kind === "invoice-created") return { label: "Invoice Created", color: "success", variant: "outlined" };
  return { label: "Completed", color: "success", variant: "filled" };
};

interface ListResponse {
  docs: MsrRow[];
  total: number;
  page: number;
  limit: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

const LIMIT = 20;

export default function MaintenanceReportsListPage() {
  const router = useRouter();
  const { getToken } = useAuth();
  const { isWctOrdersEnabled, isManualOrderFlowEnabled, isSoftDeleteDraftsEnabled } = useOrganizationFeatures();
  // Row ⋮ menu (WCT group, enableSoftDeleteDrafts, 2026-11-19): Open, and Delete for a report not sent to the customer
  // (DELETE /maintenance-reports/:id: hidden, its number kept as a gap).
  const [rowMenu, setRowMenu] = useState<{ pos: { left: number; top: number }; row: MsrRow } | null>(null);
  const [toDelete, setToDelete] = useState<MsrRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  // WCT manual flow (2026-11-13): the order page's "Add service report" lands here with the customer + DO prefilled.
  const [flowPrefill, setFlowPrefill] = useState<ServiceReportPrefill | undefined>(undefined);
  useEffect(() => {
    if (!isManualOrderFlowEnabled || typeof window === "undefined") return;
    const flow = readServiceReportFlow(window.location.search);
    if (!flow) return;
    setFlowPrefill({ customer: flow.customer, doId: flow.doId });
    if (flow.mode === "new") setNewOpen(true);
    else setUploadOpen(true);
    router.replace("/portal/maintenance-reports");
  }, [isManualOrderFlowEnabled, router]);

  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Ticked SIGNED reports, kept across pages and searches (id -> createdAt, so
  // the zip follows the list's newest-first order whatever the ticking order).
  const [picked, setPicked] = useState<Map<string, string>>(new Map());
  const [downloading, setDownloading] = useState(false);

  // Debounce typing — flush 300 ms after the last keystroke. Resets page to 1
  // so the user isn't stuck on (now-empty) page 4 of a filtered result.
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const qs = new URLSearchParams({
        page: String(page),
        limit: String(LIMIT),
        ...(debouncedSearch ? { search: debouncedSearch } : {}),
      });
      const res = await request(
        { path: `/maintenance-reports?${qs.toString()}`, method: "GET" },
        {},
        token,
      );
      const payload = res?.data ?? res;
      setData(payload as ListResponse);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load service reports");
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, page, getToken]);

  useEffect(() => {
    load();
  }, [load]);

  const docs = data?.docs ?? [];
  const total = data?.total ?? 0;
  const hasNext = !!data?.hasNextPage;
  const hasPrev = !!data?.hasPreviousPage;
  const startIdx = total === 0 ? 0 : (page - 1) * LIMIT + 1;
  const endIdx = (page - 1) * LIMIT + docs.length;

  const signedOnPage = docs.filter((r) => r.status === "completed");
  const allOnPage = signedOnPage.length > 0 && signedOnPage.every((r) => picked.has(r.id));
  const someOnPage = !allOnPage && signedOnPage.some((r) => picked.has(r.id));
  const togglePick = (row: MsrRow) =>
    setPicked((m) => {
      const next = new Map(m);
      if (next.has(row.id)) next.delete(row.id);
      else next.set(row.id, row.createdAt);
      return next;
    });
  const togglePage = () =>
    setPicked((m) => {
      const next = new Map(m);
      for (const r of signedOnPage) {
        if (allOnPage) next.delete(r.id);
        else next.set(r.id, r.createdAt);
      }
      return next;
    });
  const tooMany = picked.size > MAX_BULK_REPORTS;

  const downloadSelected = async () => {
    setDownloading(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const ids = [...picked.entries()].sort((a, b) => b[1].localeCompare(a[1])).map(([id]) => id);
      await downloadServiceReportsZip(ids, token);
      setPicked(new Map());
    } catch (e: any) {
      setError(e?.message ?? "Could not download the reports");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={2}>
        <Box>
          <Typography variant="h5" fontWeight={700}>Service Reports</Typography>
          <Typography variant="body2" color="text.secondary">
            Maintenance &amp; Inspection Service Reports submitted from the field
          </Typography>
        </Box>
        {/* Disabled "New Report" button — reports originate from the field app's
            NFC scan flow. The span wrapper is required because MUI disabled
            buttons don't fire pointer events, which would suppress the Tooltip. */}
        <Stack direction="row" spacing={1} alignItems="center">
          {/* A report that already exists as a file (PDF / scan). */}
          <Button
            variant="outlined"
            startIcon={<CloudUploadIcon />}
            onClick={() => setUploadOpen(true)}
            sx={{ minHeight: 40 }}
            data-tour="service-report-upload"
          >
            Upload Service Report
          </Button>
          {/* Manual order flow (2026-11-13): the office writes the WCT report in the portal. */}
          {isManualOrderFlowEnabled ? (
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setNewOpen(true)} sx={{ minHeight: 40 }} data-tour="service-report-new">
              New Report
            </Button>
          ) : (
            <Tooltip title="Use the SiteJobs app to create reports">
              <span>
                <Button
                  variant="contained"
                  startIcon={<AddIcon />}
                  disabled
                  sx={{ minHeight: 40 }}
                >
                  New Report
                </Button>
              </span>
            </Tooltip>
          )}
        </Stack>
      </Stack>

      <NewServiceReportDialog open={newOpen} onClose={() => { setNewOpen(false); setFlowPrefill(undefined); }} prefill={flowPrefill} />
      <UploadServiceReportDialog
        open={uploadOpen}
        onClose={() => { setUploadOpen(false); setFlowPrefill(undefined); }}
        wctOrders={isWctOrdersEnabled}
        manualFlow={!!isManualOrderFlowEnabled}
        prefill={flowPrefill}
        onUploaded={(r) => {
          setUploadOpen(false);
          setFlowPrefill(undefined);
          router.push(`/portal/maintenance-reports/${r.id}`);
        }}
      />

      <TextField
        placeholder="Search by report number, customer, location, model or serial"
        size="small"
        value={searchInput}
        onChange={(e) => setSearchInput(e.target.value)}
        InputProps={{
          startAdornment: <SearchIcon fontSize="small" sx={{ mr: 1, color: "text.secondary" }} />,
        }}
        fullWidth
      />

      {picked.size > 0 && (
        <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap">
          <Typography variant="body2" fontWeight={600}>
            {picked.size} selected
          </Typography>
          {tooMany && (
            <Typography variant="caption" color="error">
              At most {MAX_BULK_REPORTS} at a time
            </Typography>
          )}
          <Box sx={{ flex: 1 }} />
          <Button size="small" onClick={() => setPicked(new Map())} disabled={downloading}>
            Clear
          </Button>
          <Button
            variant="contained"
            size="small"
            startIcon={downloading ? <CircularProgress size={16} color="inherit" /> : <DownloadIcon />}
            onClick={downloadSelected}
            disabled={downloading || tooMany}
          >
            {downloading ? `Preparing ${picked.size} ${picked.size === 1 ? "report" : "reports"}…` : `Download selected (${picked.size})`}
          </Button>
        </Stack>
      )}

      {error && <Alert severity="error">{error}</Alert>}

      <TableContainer component={Paper} variant="outlined">
        <Table>
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox">
                <Checkbox
                  size="small"
                  checked={allOnPage}
                  indeterminate={someOnPage}
                  disabled={!signedOnPage.length || loading}
                  onChange={togglePage}
                  inputProps={{ "aria-label": "Select the signed reports on this page" }}
                />
              </TableCell>
              <TableCell sx={{ fontWeight: 600, width: 100 }}>Report #</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Customer</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Model</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Unit</TableCell>
              <TableCell sx={{ fontWeight: 600, width: 140 }}>Service Date</TableCell>
              <TableCell sx={{ fontWeight: 600, width: 160 }}>Created</TableCell>
              <TableCell sx={{ fontWeight: 600, width: 160 }}>Status</TableCell>
              {isSoftDeleteDraftsEnabled && <TableCell sx={{ width: 48 }} />}
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={isSoftDeleteDraftsEnabled ? 9 : 8} align="center" sx={{ py: 6 }}>
                  <CircularProgress size={28} />
                </TableCell>
              </TableRow>
            ) : docs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={isSoftDeleteDraftsEnabled ? 9 : 8} align="center" sx={{ py: 6, color: "text.secondary" }}>
                  {debouncedSearch ? "No reports match this search." : "No service reports yet."}
                </TableCell>
              </TableRow>
            ) : (
              docs.map((row) => (
                <TableRow
                  key={row.id}
                  hover
                  onClick={() => router.push(`/portal/maintenance-reports/${row.id}`)}
                  sx={{ cursor: "pointer" }}
                >
                  <TableCell padding="checkbox" onClick={(e) => e.stopPropagation()}>
                    {row.status === "completed" ? (
                      <Checkbox
                        size="small"
                        checked={picked.has(row.id)}
                        onChange={() => togglePick(row)}
                        inputProps={{ "aria-label": `Select report ${row.reportNumber ?? ""}` }}
                      />
                    ) : (
                      <Tooltip title="Not signed yet">
                        <span>
                          <Checkbox size="small" disabled />
                        </span>
                      </Tooltip>
                    )}
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" fontWeight={600}>
                      {(row.serviceData as any)?.srNumber ?? row.reportNumber ?? "—"}
                    </Typography>
                  </TableCell>
                  <TableCell>{row.serviceData?.customerName ?? "—"}</TableCell>
                  <TableCell>{row.asset?.name ?? "—"}</TableCell>
                  <TableCell>{row.inventory?.sku ?? "—"}</TableCell>
                  <TableCell>{row.serviceData?.serviceDate ?? "—"}</TableCell>
                  <TableCell>{new Date(row.createdAt).toLocaleString("en-GB")}</TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.5} alignItems="center">
                      {(() => {
                        const chip = statusChipProps(statusFor(row));
                        return <Chip size="small" label={chip.label} color={chip.color} variant={chip.variant} />;
                      })()}
                      {row.serviceData?.uploaded && <Chip size="small" label="Uploaded" variant="outlined" />}
                    </Stack>
                  </TableCell>
                  {isSoftDeleteDraftsEnabled && (
                    <TableCell padding="checkbox" onClick={(e) => e.stopPropagation()}>
                      <IconButton size="small" aria-label={`Actions for report ${row.reportNumber ?? ""}`} onClick={(e) => setRowMenu({ pos: { left: e.clientX, top: e.clientY }, row })}>
                        <MoreVertIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Typography variant="caption" color="text.secondary">
          {total === 0 ? "0 results" : `${startIdx}–${endIdx} of ${total}`}
        </Typography>
        <Stack direction="row" spacing={1} alignItems="center">
          <Button
            variant="outlined"
            size="small"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={!hasPrev || loading}
          >
            Previous
          </Button>
          <Typography variant="body2" sx={{ mx: 1 }}>Page {page}</Typography>
          <Button
            variant="outlined"
            size="small"
            onClick={() => setPage((p) => p + 1)}
            disabled={!hasNext || loading}
          >
            Next
          </Button>
        </Stack>
      </Stack>
      <Menu anchorReference="anchorPosition" anchorPosition={rowMenu?.pos} open={!!rowMenu} onClose={() => setRowMenu(null)}>
        <MenuItem
          onClick={() => {
            const r = rowMenu!.row;
            setRowMenu(null);
            router.push(`/portal/maintenance-reports/${r.id}`);
          }}
        >
          Open
        </MenuItem>
        {rowMenu && !rowMenu.row.serviceData?.customerSentAt && !rowMenu.row.serviceData?.emailSentAt && (
          <MenuItem
            sx={{ color: "error.main" }}
            onClick={() => {
              const r = rowMenu!.row;
              setRowMenu(null);
              setDeleteError(null);
              setToDelete(r);
            }}
          >
            Delete
          </MenuItem>
        )}
      </Menu>
      <Dialog open={!!toDelete} onClose={() => !deleting && setToDelete(null)}>
        <DialogTitle>Delete service report</DialogTitle>
        <DialogContent>
          <DialogContentText>Delete report {reportNoText(toDelete) ?? "draft"}? Its number stays as a gap.</DialogContentText>
          {deleteError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {deleteError}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setToDelete(null)} disabled={deleting}>
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            disableElevation
            disabled={deleting}
            onClick={async () => {
              if (!toDelete) return;
              setDeleting(true);
              setDeleteError(null);
              try {
                const token = await getToken();
                const res: any = await request({ path: `/maintenance-reports/${toDelete.id}`, method: "DELETE", ownError: true }, {}, token ?? undefined);
                if (res?.success === false) throw new Error(res?.message || "Could not delete the report");
                setToDelete(null);
                void load();
              } catch (e: any) {
                setDeleteError(e?.message || "Could not delete the report");
              } finally {
                setDeleting(false);
              }
            }}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
