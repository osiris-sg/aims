"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { request } from "@/helpers/request";
import MainCard from "@/components/MainCard";
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  MenuItem,
  Stack,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import StopCircleIcon from "@mui/icons-material/StopCircle";
import AddIcon from "@mui/icons-material/Add";
import VisibilityIcon from "@mui/icons-material/Visibility";
import CloseIcon from "@mui/icons-material/Close";
import RouteIcon from "@mui/icons-material/Route";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { useTheme } from "@mui/material/styles";
import useMediaQuery from "@mui/material/useMediaQuery";
import dynamic from "next/dynamic";
import { ROUTES } from "@/routes";
import Table from "@/components/Table";
import { toast } from "react-toastify";
import CleanDocumentPreview from "@/containers/DocumentTemplates/components/CleanDocumentPreview";
// Shared dialog — also consumed by the DO editor header's "Show Route" button
// in TabbedDocumentCreator. Extracted from a previously-inline definition.
import DeliveryRouteDialog from "@/components/DeliveryRouteDialog";

// Leaflet hits `window` at import time; load the map client-side only.
const DeliveryRouteMap = dynamic(() => import("@/components/DeliveryRouteMap"), {
  ssr: false,
  loading: () => (
    <Box sx={{ p: 6, display: "flex", justifyContent: "center" }}>
      <CircularProgress />
    </Box>
  ),
});

type DeploymentStatus = "ACTIVE" | "OFF_HIRED" | "COMPLETED" | "CANCELLED";
type DeploymentType = "RENTAL" | "SALE" | "SERVICE";

interface SubAssetRow {
  id: string;
  name: string;
  skuKey: string;
  isTracked: boolean;
  inventoryCount: number;
}

interface DocumentItemRow {
  id: string;
  itemId: string;
  itemType: "INVENTORY" | "ASSET";
  sku: string | null;
  description: string | null;
  quantity: number;
  unitPrice: number | null;
  uom: string | null;
  lineNumber: number | null;
  isService: boolean;
  // Children of this item's parent asset (e.g. TSS under a SIDS unit).
  // Empty when the asset has no sub-assets.
  subAssets?: SubAssetRow[];
}

interface DeploymentDocument {
  id: string;
  name: string;
  type: string;
  status: string;
  createdAt: string;
  documentItems: DocumentItemRow[];
}

interface Deployment {
  id: string;
  deploymentNumber: number | null;
  name: string;
  type: DeploymentType;
  status: DeploymentStatus;
  description: string | null;
  monthlyRate: number | null;
  currency: string | null;
  deployedDate: string | null;
  offHiredDate: string | null;
  notes: string | null;
  isServiceOnly: boolean;
  sourceDocument: { id: string; name: string; type: string } | null;
  assignments: any[];
  documents: DeploymentDocument[];
  invoices: {
    id: string;
    name: string;
    type: string;
    status: string;
    createdAt: string;
    date: string | null;
    amount: number;
    paid: number;
    documentItems: DocumentItemRow[];
  }[];
  totalBilled: number;
  totalPaid: number;
  outstanding: number;
  invoiceCount: number;
  lastInvoiceDate: string | null;
  lastInvoiceName: string | null;
}

interface QuotationRow {
  id: string;
  name: string | null;
  type: string;
  status: string;
  createdAt: string;
  projectDeploymentId: string | null;
  documentTemplateId: string | null;
  amount: number;
}

interface ProjectDetail {
  id: string;
  projectNumber: string | null;
  name: string;
  description: string | null;
  status: string;
  startDate: string | null;
  endDate: string | null;
  customerPoNumber: string | null;
  customer: { id: string; name: string; code: string | null } | null;
  siteOffice: { id: string; name: string; address: string | null } | null;
  deployments: Deployment[];
  quotations: QuotationRow[];
  standaloneDocs: any[];
  allInvoices: any[];
  totals: {
    billed: number;
    paid: number;
    outstanding: number;
    deploymentCount: number;
    activeDeployments: number;
    invoiceCount: number;
    quotationCount: number;
  };
}

type FieldReportKind = "SERVICE" | "DO_START" | "DO_ACK" | "DO_INSTALL";

interface FieldReport {
  id: string;
  kind: FieldReportKind;
  description: string;
  status: "draft" | "completed";
  createdAt: string;
  technicianUserId: string;
  technicianName: string | null;
  signedByName: string | null;
  signedAt: string | null;
  photos: string[];
  signature: string | null;
  documentId: string | null;
  latitude: number | null;
  longitude: number | null;
  locationLabel: string | null;
  asset: { id: string; name: string; skuKey: string; image: string | null } | null;
}

const RESOURCE_URL =
  process.env.NEXT_PUBLIC_RESOURCE_URL ?? "https://aims-osiris.s3.ap-southeast-1.amazonaws.com/";

// Photo keys may already be data URLs or full URLs — render those as-is and
// only prefix the S3 base for bare keys.
const resolveImageSrc = (keyOrUrl: string) => {
  if (!keyOrUrl) return "";
  if (keyOrUrl.startsWith("data:") || keyOrUrl.startsWith("http://") || keyOrUrl.startsWith("https://")) {
    return keyOrUrl;
  }
  return `${RESOURCE_URL}${keyOrUrl}`;
};

const FIELD_REPORT_KIND_LABEL: Record<FieldReportKind, string> = {
  SERVICE: "Service",
  DO_START: "Delivery Started",
  DO_ACK: "Delivery Acknowledged",
  DO_INSTALL: "Installation Acknowledged",
};

const FIELD_REPORT_KIND_COLOR: Record<FieldReportKind, "default" | "primary" | "info" | "success" | "warning"> = {
  SERVICE: "primary",
  DO_START: "info",
  DO_ACK: "success",
  DO_INSTALL: "warning",
};

const formatCoordsForDisplay = (lat: number, lng: number) => {
  const la = `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? "N" : "S"}`;
  const ln = `${Math.abs(lng).toFixed(4)}° ${lng >= 0 ? "E" : "W"}`;
  return `${la}, ${ln}`;
};

const fmtMoney = (n: number, ccy = "SGD") =>
  `${ccy} ${(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString() : "—");

// Boil verbose Biofuel-style rental descriptions
//   "Rental of one unit ... Brand: BIOFUEL Model: LION375 Year: 2025 S/No.: MG20250090"
// down to "LION375 · MG20250090" for the deployment item table. Full text is
// always preserved for the tooltip so nothing is lost.
function formatItemDescription(raw: string | null | undefined): { display: string; full: string } {
  const full = (raw ?? "").trim();
  if (!full) return { display: "—", full: "" };
  const modelMatch = full.match(/Model:\s*([^\s,;]+(?:\s+\d+)?)/i);
  const serialMatch = full.match(/(?:S\/No|Serial(?:\s*No)?)\.?:?\s*([^\s,;]+)/i);
  if (modelMatch && serialMatch) {
    return { display: `${modelMatch[1]} · ${serialMatch[1]}`, full };
  }
  if (full.length > 60) return { display: full.slice(0, 60).trim() + "…", full };
  return { display: full, full };
}

// Apply the project-level item search to a deployment, returning a copy with
// non-matching documentItems filtered out. Returns null when no items match
// (so the deployment is dropped from the visible list entirely). When the
// search string is empty the original deployment is passed through unchanged.
function filterDeploymentByItemSearch(d: Deployment, search: string): Deployment | null {
  const q = search.trim().toLowerCase();
  if (!q) return d;
  const itemMatches = (it: DocumentItemRow) => {
    const desc = (it.description ?? "").toLowerCase();
    const sku = (it.sku ?? "").toLowerCase();
    return desc.includes(q) || sku.includes(q);
  };
  const filteredDocs = d.documents
    .map((doc) => ({ ...doc, documentItems: doc.documentItems.filter(itemMatches) }))
    .filter((doc) => doc.documentItems.length > 0);
  const filteredInvs = d.invoices
    .map((inv) => ({ ...inv, documentItems: inv.documentItems.filter(itemMatches) }))
    .filter((inv) => inv.documentItems.length > 0);
  if (filteredDocs.length === 0 && filteredInvs.length === 0) return null;
  return { ...d, documents: filteredDocs, invoices: filteredInvs };
}

const monthsBetween = (start: string | null, end: string | null) => {
  if (!start) return 0;
  const s = new Date(start);
  const e = end ? new Date(end) : new Date();
  return Math.max(0, (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth()));
};

function statusChip(status: DeploymentStatus) {
  const map: Record<DeploymentStatus, { label: string; color: any }> = {
    ACTIVE: { label: "Active", color: "success" },
    OFF_HIRED: { label: "Off-hired", color: "default" },
    COMPLETED: { label: "Completed", color: "info" },
    CANCELLED: { label: "Cancelled", color: "error" },
  };
  const cfg = map[status] ?? { label: status, color: "default" };
  return <Chip size="small" label={cfg.label} color={cfg.color} />;
}

export default function ProjectDetailsPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const { organization } = useOrganization();
  const { getToken } = useAuth();
  const organizationId = organization?.id;

  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState(0);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [addOpen, setAddOpen] = useState(false);
  const [attachOpenFor, setAttachOpenFor] = useState<string | null>(null);
  const [previewDocId, setPreviewDocId] = useState<string | null>(null);
  const [fieldReports, setFieldReports] = useState<FieldReport[] | null>(null);
  const [fieldReportsLoading, setFieldReportsLoading] = useState(false);
  const [photoDialogSrc, setPhotoDialogSrc] = useState<string | null>(null);
  // Open delivery-route dialog, keyed by the DO_START report id. null = closed.
  const [routeDialogReportId, setRouteDialogReportId] = useState<string | null>(null);
  const [itemSearch, setItemSearch] = useState("");
  // QUOTATION template id for the "Create Quotation" button. undefined =
  // not yet fetched; null = fetched but the org has none; string = ready.
  const [quotationTemplateId, setQuotationTemplateId] = useState<string | null | undefined>(undefined);
  const [creatingQuotation, setCreatingQuotation] = useState(false);

  const fetchProject = useCallback(async () => {
    if (!params?.id) return;
    setLoading(true);
    try {
      const token = await getToken();
      if (!token) return;
      const res = await request({ path: `/projects/${params.id}`, method: "GET" }, {}, token);
      if (res.success) setProject(res.data);
      else toast.error("Failed to load project");
    } catch (err) {
      console.error(err);
      toast.error("Error loading project");
    } finally {
      setLoading(false);
    }
  }, [params.id, getToken]);

  useEffect(() => {
    fetchProject();
  }, [fetchProject]);

  // Lazy-load field reports the first time the user opens that tab. Refetches
  // when the project id changes (i.e. navigating to a different project).
  // Field Reports moved from tab 4 → tab 5 when the Quotations tab was added.
  useEffect(() => {
    if (tab !== 5 || fieldReports !== null) return;
    if (!params?.id) return;
    let cancelled = false;
    (async () => {
      setFieldReportsLoading(true);
      try {
        const token = await getToken();
        if (!token) return;
        const res = await request(
          { path: `/maintenance-reports/project/${params.id}`, method: "GET" },
          {},
          token,
        );
        if (cancelled) return;
        if (res.success) setFieldReports(res.data?.reports ?? []);
        else toast.error(res.message ?? "Failed to load field reports");
      } catch (err) {
        console.error(err);
        if (!cancelled) toast.error("Failed to load field reports");
      } finally {
        if (!cancelled) setFieldReportsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, params?.id, getToken, fieldReports]);

  // Reset cached reports whenever the project id changes so a fresh fetch fires.
  useEffect(() => {
    setFieldReports(null);
  }, [params?.id]);

  // Lazy-load the QUOTATION template id when the user first opens the Quotations
  // tab — needed for the "Create Quotation" button and to construct the link
  // for any quotations that don't already carry their own documentTemplateId.
  useEffect(() => {
    if (tab !== 4 || quotationTemplateId !== undefined) return;
    if (!organizationId) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const res = await request(
          { path: "/documentTemplates", method: "POST" },
          { page: 1, limit: 100, search: "", organizationId },
          token,
        );
        if (cancelled) return;
        const docs: any[] = res?.data?.docs ?? [];
        const quotation = docs.find((d) => (d.type || "").toUpperCase() === "QUOTATION");
        setQuotationTemplateId(quotation?.id ?? null);
      } catch (err) {
        console.error("Failed to load quotation template:", err);
        if (!cancelled) setQuotationTemplateId(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, quotationTemplateId, organizationId, getToken]);

  // Active on Site: only ACTIVE deployments AND not service-only.
  // Off-hired/completed/cancelled live in the Past Deployments tab; service-only
  // deployments are surfaced under Sales & Services regardless of status.
  const active = useMemo(
    () =>
      (project?.deployments ?? [])
        .filter((d) => d.status === "ACTIVE" && !d.isServiceOnly)
        .map((d) => filterDeploymentByItemSearch(d, itemSearch))
        .filter((d): d is Deployment => d !== null),
    [project, itemSearch],
  );
  const past = useMemo(
    () =>
      (project?.deployments ?? [])
        .filter((d) => d.status !== "ACTIVE")
        .map((d) => filterDeploymentByItemSearch(d, itemSearch))
        .filter((d): d is Deployment => d !== null),
    [project, itemSearch],
  );
  const serviceOnlyDeployments = useMemo(
    () =>
      (project?.deployments ?? [])
        .filter((d) => d.isServiceOnly)
        .map((d) => filterDeploymentByItemSearch(d, itemSearch))
        .filter((d): d is Deployment => d !== null),
    [project, itemSearch],
  );
  // When the user is actively searching, force-expand every visible deployment
  // so the matching items are immediately readable without an extra click.
  const isSearching = itemSearch.trim().length > 0;
  const isDeploymentExpanded = (id: string) => isSearching || !!expanded[id];

  const handleCreateQuotation = async () => {
    if (!project || !organizationId) return;
    if (!quotationTemplateId) {
      toast.error(
        quotationTemplateId === null
          ? "No QUOTATION template configured for this organization"
          : "Quotation template still loading — try again",
      );
      return;
    }
    setCreatingQuotation(true);
    try {
      const token = await getToken();
      if (!token) return;
      const res = await request(
        { path: "/documents/basic", method: "POST" },
        {
          documentTemplateId: quotationTemplateId,
          type: "QUOTATION",
          config: {},
          projectId: project.id,
        },
        token,
      );
      if (res?.success && res.data?.id) {
        router.push(`/portal/documents/QUOTATION/${quotationTemplateId}/${res.data.id}`);
      } else {
        toast.error(res?.message ?? "Failed to create quotation");
      }
    } catch (err) {
      console.error(err);
      toast.error("Error creating quotation");
    } finally {
      setCreatingQuotation(false);
    }
  };

  const offHire = async (deploymentId: string) => {
    if (!organizationId) return;
    if (!confirm("Mark this deployment as off-hired?")) return;
    try {
      const token = await getToken();
      if (!token) return;
      const res: any = await request(
        { path: `/projects/deployments/${deploymentId}/off-hire`, method: "POST" },
        { offHiredDate: new Date().toISOString() },
        token,
      );
      toast.success("Deployment off-hired");
      const paused = res?.deactivatedRecurringTemplates;
      if (Array.isArray(paused) && paused.length > 0) {
        toast.info(
          `Paused ${paused.length} recurring invoice${paused.length > 1 ? "s" : ""}: ${paused
            .map((t: any) => t.name)
            .join(", ")}`,
        );
      }
      fetchProject();
    } catch (err) {
      console.error(err);
      toast.error("Failed to off-hire");
    }
  };

  if (loading) {
    return (
      <MainCard>
        <Box sx={{ p: 6, display: "flex", justifyContent: "center" }}>
          <CircularProgress />
        </Box>
      </MainCard>
    );
  }
  if (!project) {
    return (
      <MainCard>
        <Box sx={{ p: 6, textAlign: "center" }}>
          <Typography color="text.secondary">Project not found</Typography>
        </Box>
      </MainCard>
    );
  }

  return (
    <MainCard>
      <Box sx={{ p: 3 }}>
        {/* Breadcrumb */}
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          <Box component="span" sx={{ cursor: "pointer" }} onClick={() => router.push(ROUTES.PROJECTS)}>
            Projects
          </Box>
          {" / "}
          {project.projectNumber ? `${project.projectNumber} — ` : ""}{project.name}
        </Typography>

        {/* Header */}
        <Stack direction={{ xs: "column", md: "row" }} spacing={3} alignItems={{ md: "flex-start" }} sx={{ mb: 3 }}>
          <Box sx={{ flex: 1 }}>
            <Stack direction="row" alignItems="center" gap={1.5} sx={{ mb: 0.5 }}>
              <Typography variant="h2">{project.name}</Typography>
              <Chip size="small" label={project.status} />
            </Stack>
            <Stack direction="row" gap={3} flexWrap="wrap" sx={{ color: "text.secondary" }}>
              {project.customer && (
                <Typography variant="body2">
                  <strong>Customer:</strong> {project.customer.name}
                </Typography>
              )}
              {project.siteOffice && (
                <Typography variant="body2">
                  <strong>Site:</strong> {project.siteOffice.name}
                  {project.siteOffice.address ? ` — ${project.siteOffice.address}` : ""}
                </Typography>
              )}
              {project.customerPoNumber && (
                <Typography variant="body2">
                  <strong>PO:</strong> {project.customerPoNumber}
                </Typography>
              )}
              <Typography variant="body2">
                <strong>Period:</strong> {fmtDate(project.startDate)} → {fmtDate(project.endDate)}
              </Typography>
            </Stack>
            {project.description && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                {project.description}
              </Typography>
            )}
          </Box>

          {/* Money summary */}
          <Stack direction="row" gap={2} sx={{ flexShrink: 0 }}>
            <SummaryStat label="Total Billed" value={fmtMoney(project.totals.billed)} />
            <SummaryStat label="Paid" value={fmtMoney(project.totals.paid)} accent="success.main" />
            <SummaryStat label="Outstanding" value={fmtMoney(project.totals.outstanding)} accent="warning.main" />
          </Stack>
        </Stack>

        <Stack direction="row" gap={3} sx={{ mb: 1, color: "text.secondary" }}>
          <Typography variant="caption">
            {project.totals.activeDeployments} active · {project.totals.deploymentCount} total deployments
          </Typography>
          <Typography variant="caption">{project.totals.invoiceCount} invoices</Typography>
        </Stack>

        <Divider sx={{ my: 2 }} />

        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
          <Tabs value={tab} onChange={(_, v) => setTab(v)}>
            <Tab label={`Active on Site (${active.length})`} />
            <Tab label={`Past Deployments (${past.length})`} />
            <Tab label={`Sales & Services (${project.standaloneDocs.length + serviceOnlyDeployments.length})`} />
            <Tab label={`All Invoices (${project.allInvoices.length})`} />
            <Tab label={`Quotations (${project.quotations?.length ?? 0})`} />
            <Tab label={fieldReports === null ? "Field Reports" : `Field Reports (${fieldReports.length})`} />
          </Tabs>
          {tab === 0 && (
            <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={() => setAddOpen(true)}>
              New Deployment
            </Button>
          )}
        </Stack>

        {/* Item search — applies to the deployment tabs (0, 1, 2). Hidden on
            table-based tabs where the underlying Table already has its own
            search affordances. */}
        {(tab === 0 || tab === 1 || tab === 2) && (
          <TextField
            value={itemSearch}
            onChange={(e) => setItemSearch(e.target.value)}
            placeholder="Search items by name, SKU, or serial..."
            size="small"
            fullWidth
            sx={{ mb: 1.5 }}
          />
        )}

        {/* Tab 0: Active on site (ACTIVE && !isServiceOnly) */}
        {tab === 0 && (
          <Box>
            {active.length === 0 && (
              <Box sx={{ p: 6, textAlign: "center", color: "text.secondary" }}>
                <Typography variant="body2">No active deployments.</Typography>
                <Button variant="contained" sx={{ mt: 2 }} startIcon={<AddIcon />} onClick={() => setAddOpen(true)}>
                  New Deployment
                </Button>
              </Box>
            )}

            <Stack gap={1.5}>
              {active.map((d) => (
                <DeploymentCard
                  key={d.id}
                  deployment={d}
                  expanded={isDeploymentExpanded(d.id)}
                  onToggle={() => setExpanded((s) => ({ ...s, [d.id]: !s[d.id] }))}
                  onOffHire={() => offHire(d.id)}
                  onAttachDoc={() => setAttachOpenFor(d.id)}
                  onPreview={(id) => setPreviewDocId(id)}
                />
              ))}
            </Stack>
          </Box>
        )}

        {/* Tab 1: Past Deployments (status !== ACTIVE) */}
        {tab === 1 && (
          <Box>
            {past.length === 0 ? (
              <Box sx={{ p: 6, textAlign: "center", color: "text.secondary" }}>
                <Typography variant="body2">No past deployments.</Typography>
              </Box>
            ) : (
              <Stack gap={1.5}>
                {past.map((d) => (
                  <DeploymentCard
                    key={d.id}
                    deployment={d}
                    expanded={isDeploymentExpanded(d.id)}
                    onToggle={() => setExpanded((s) => ({ ...s, [d.id]: !s[d.id] }))}
                    onAttachDoc={() => setAttachOpenFor(d.id)}
                    onPreview={(id) => setPreviewDocId(id)}
                  />
                ))}
              </Stack>
            )}
          </Box>
        )}

        {/* Tab 2: Sales & Services — standaloneDocs + service-only deployments */}
        {tab === 2 && (
          <Box>
            {serviceOnlyDeployments.length > 0 && (
              <>
                <Typography variant="overline" color="text.secondary" sx={{ display: "block", mb: 1 }}>
                  Service-only Deployments ({serviceOnlyDeployments.length})
                </Typography>
                <Stack gap={1.5} sx={{ mb: 3 }}>
                  {serviceOnlyDeployments.map((d) => (
                    <DeploymentCard
                      key={d.id}
                      deployment={d}
                      expanded={isDeploymentExpanded(d.id)}
                      onToggle={() => setExpanded((s) => ({ ...s, [d.id]: !s[d.id] }))}
                      onAttachDoc={() => setAttachOpenFor(d.id)}
                    />
                  ))}
                </Stack>
              </>
            )}

            {project.standaloneDocs.length > 0 && (
              <>
                <Typography variant="overline" color="text.secondary" sx={{ display: "block", mb: 1 }}>
                  Standalone Documents ({project.standaloneDocs.length})
                </Typography>
                <Table
                  columns={[
                    { id: "name", accessorKey: "name", header: "Doc No.", cell: (i: any) => i.getValue() ?? "—" },
                    { id: "type", accessorKey: "type", header: "Type", cell: (i: any) => i.getValue() },
                    { id: "date", accessorKey: "date", header: "Date", cell: (i: any) => fmtDate(i.row.original.date ?? i.row.original.createdAt) },
                    { id: "amount", accessorKey: "amount", header: "Amount", cell: (i: any) => fmtMoney(i.getValue()) },
                    { id: "paid", accessorKey: "paid", header: "Paid", cell: (i: any) => fmtMoney(i.getValue()) },
                    { id: "status", accessorKey: "status", header: "Status", cell: (i: any) => i.getValue() },
                  ]}
                  data={project.standaloneDocs}
                  onRowSelect={() => {}}
                />
              </>
            )}

            {serviceOnlyDeployments.length === 0 && project.standaloneDocs.length === 0 && (
              <Box sx={{ p: 6, textAlign: "center", color: "text.secondary" }}>
                <Typography variant="body2">No services or standalone documents.</Typography>
              </Box>
            )}
          </Box>
        )}

        {/* Tab 3: All Invoices */}
        {tab === 3 && (
          <Table
            columns={[
              { id: "name", accessorKey: "name", header: "Doc No.", cell: (i: any) => i.getValue() ?? "—" },
              { id: "type", accessorKey: "type", header: "Type", cell: (i: any) => i.getValue() },
              {
                id: "date",
                accessorKey: "date",
                header: "Date",
                cell: (i: any) => fmtDate(i.row.original.date ?? i.row.original.createdAt),
              },
              {
                id: "amount",
                accessorKey: "amount",
                header: "Amount",
                cell: (i: any) => fmtMoney(i.getValue()),
              },
              { id: "paid", accessorKey: "paid", header: "Paid", cell: (i: any) => fmtMoney(i.getValue()) },
              { id: "status", accessorKey: "status", header: "Status", cell: (i: any) => i.getValue() },
            ]}
            data={project.allInvoices}
            onRowSelect={() => {}}
          />
        )}

        {/* Tab 4: Quotations linked to this project. Each row navigates to the
            quotation editor; "Create Quotation" spawns a new quotation pre-
            linked to this project via POST /documents/basic. */}
        {tab === 4 && (
          <Box>
            <Stack direction="row" justifyContent="flex-end" sx={{ mb: 1 }}>
              <Button
                size="small"
                variant="contained"
                startIcon={creatingQuotation ? <CircularProgress size={14} color="inherit" /> : <AddIcon />}
                onClick={handleCreateQuotation}
                disabled={creatingQuotation || quotationTemplateId === undefined}
              >
                Create Quotation
              </Button>
            </Stack>
            {(project.quotations?.length ?? 0) === 0 ? (
              <Box sx={{ p: 6, textAlign: "center", color: "text.secondary" }}>
                <Typography variant="body2">No quotations linked to this project yet.</Typography>
              </Box>
            ) : (
              <Table
                columns={[
                  { id: "name", accessorKey: "name", header: "Quotation #", cell: (i: any) => i.getValue() ?? "—" },
                  { id: "status", accessorKey: "status", header: "Status", cell: (i: any) => i.getValue() },
                  { id: "amount", accessorKey: "amount", header: "Amount", cell: (i: any) => fmtMoney(i.getValue() ?? 0) },
                  { id: "createdAt", accessorKey: "createdAt", header: "Created", cell: (i: any) => fmtDate(i.getValue()) },
                  {
                    id: "actions",
                    header: "",
                    cell: ({ row }: { row: any }) => (
                      <IconButton
                        size="small"
                        sx={{ color: "text.secondary", "&:hover": { color: "primary.main" } }}
                        onClick={() => {
                          const q = row.original;
                          const tmpl = q.documentTemplateId ?? quotationTemplateId;
                          if (!tmpl) {
                            toast.error("Cannot open quotation: missing template id");
                            return;
                          }
                          router.push(`/portal/documents/QUOTATION/${tmpl}/${q.id}`);
                        }}
                      >
                        <VisibilityIcon fontSize="small" />
                      </IconButton>
                    ),
                  },
                ]}
                data={project.quotations ?? []}
              />
            )}
          </Box>
        )}

        {/* Tab 5: Field Reports — service reports + DO starts + DO acks
            captured by techs in the NFC scan PWA. Lazy-fetched on first
            visit via the useEffect above. */}
        {tab === 5 && (
          <FieldReportsList
            reports={fieldReports}
            loading={fieldReportsLoading}
            onPhotoClick={setPhotoDialogSrc}
            onViewRoute={setRouteDialogReportId}
          />
        )}

        <NewDeploymentDialog
          open={addOpen}
          onClose={() => setAddOpen(false)}
          projectId={project.id}
          onCreated={() => {
            setAddOpen(false);
            fetchProject();
          }}
        />

        <AttachDocumentDialog
          open={!!attachOpenFor}
          deploymentId={attachOpenFor}
          candidates={(project.allInvoices ?? []).filter(
            (d: any) => (d.type === "DO" || d.type === "DELIVERY_ORDER") && !d.projectDeploymentId,
          )}
          onClose={() => setAttachOpenFor(null)}
          onAttached={() => {
            setAttachOpenFor(null);
            fetchProject();
          }}
        />

        <DocumentPreviewDialog
          documentId={previewDocId}
          open={!!previewDocId}
          onClose={() => setPreviewDocId(null)}
        />

        <PhotoViewerDialog
          src={photoDialogSrc}
          open={!!photoDialogSrc}
          onClose={() => setPhotoDialogSrc(null)}
        />

        <DeliveryRouteDialog
          reportId={routeDialogReportId}
          open={!!routeDialogReportId}
          onClose={() => setRouteDialogReportId(null)}
        />
      </Box>
    </MainCard>
  );
}

function FieldReportsList({
  reports,
  loading,
  onPhotoClick,
  onViewRoute,
}: {
  reports: FieldReport[] | null;
  loading: boolean;
  onPhotoClick: (src: string) => void;
  onViewRoute: (reportId: string) => void;
}) {
  if (loading || reports === null) {
    return (
      <Box sx={{ p: 6, display: "flex", justifyContent: "center" }}>
        <CircularProgress />
      </Box>
    );
  }
  if (reports.length === 0) {
    return (
      <Box sx={{ p: 6, textAlign: "center", color: "text.secondary" }}>
        <Typography variant="body2">No field reports for this project yet.</Typography>
        <Typography variant="caption" color="text.secondary">
          Reports captured by techs via the NFC scan app will appear here.
        </Typography>
      </Box>
    );
  }
  return (
    <Stack spacing={1.5}>
      {reports.map((r) => (
        <FieldReportCard
          key={r.id}
          report={r}
          onPhotoClick={onPhotoClick}
          onViewRoute={onViewRoute}
        />
      ))}
    </Stack>
  );
}

function FieldReportCard({
  report,
  onPhotoClick,
  onViewRoute,
}: {
  report: FieldReport;
  onPhotoClick: (src: string) => void;
  onViewRoute: (reportId: string) => void;
}) {
  const kindLabel = FIELD_REPORT_KIND_LABEL[report.kind] ?? report.kind;
  const kindColor = FIELD_REPORT_KIND_COLOR[report.kind] ?? "default";
  const sigSrc = report.signature ? resolveImageSrc(report.signature) : null;

  return (
    <Box sx={{ p: 2, border: 1, borderColor: "divider", borderRadius: 2, bgcolor: "background.paper" }}>
      <Stack direction="row" gap={1.5} alignItems="center" flexWrap="wrap" sx={{ mb: 1 }}>
        <Chip size="small" label={kindLabel} color={kindColor} />
        <Typography variant="caption" color="text.secondary">
          {fmtDate(report.createdAt)}
        </Typography>
        {report.asset && (
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {report.asset.name} <Typography component="span" variant="caption" color="text.secondary">({report.asset.skuKey})</Typography>
          </Typography>
        )}
        <Box sx={{ flexGrow: 1 }} />
        {report.kind === "DO_START" && (
          <Tooltip title="See the delivery route on a map">
            <Button
              size="small"
              variant="text"
              startIcon={<RouteIcon fontSize="small" />}
              onClick={() => onViewRoute(report.id)}
              sx={{ minWidth: 0 }}
            >
              View Route
            </Button>
          </Tooltip>
        )}
        <Chip size="small" variant="outlined" label={report.status} />
      </Stack>

      <Stack direction="row" gap={3} flexWrap="wrap" sx={{ color: "text.secondary", mb: 1 }}>
        <Typography variant="caption">
          <strong>Tech:</strong> {report.technicianName ?? report.technicianUserId ?? "—"}
        </Typography>
        {report.signedByName && (
          <Typography variant="caption">
            <strong>Signed by:</strong> {report.signedByName}
            {report.signedAt ? ` · ${fmtDate(report.signedAt)}` : ""}
          </Typography>
        )}
        {report.latitude !== null && report.longitude !== null && (
          <Typography variant="caption">
            <strong>Location:</strong>{" "}
            <a
              href={`https://www.google.com/maps?q=${report.latitude},${report.longitude}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "inherit", textDecoration: "underline" }}
            >
              {formatCoordsForDisplay(report.latitude, report.longitude)}
            </a>
            {report.locationLabel ? (
              <Typography component="span" variant="caption" sx={{ ml: 0.5, opacity: 0.7 }}>
                ({report.locationLabel})
              </Typography>
            ) : null}
          </Typography>
        )}
      </Stack>

      <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", mb: report.photos.length || sigSrc ? 1.5 : 0 }}>
        {report.description || "—"}
      </Typography>

      {report.photos.length > 0 && (
        <Box sx={{ mb: sigSrc ? 1.5 : 0 }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
            Photos ({report.photos.length})
          </Typography>
          <Stack direction="row" gap={1} flexWrap="wrap">
            {report.photos.map((p) => {
              const src = resolveImageSrc(p);
              return (
                <Box
                  key={p}
                  onClick={() => onPhotoClick(src)}
                  sx={{
                    width: 96,
                    height: 96,
                    borderRadius: 1,
                    overflow: "hidden",
                    cursor: "pointer",
                    border: 1,
                    borderColor: "divider",
                    "&:hover": { borderColor: "primary.main" },
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                </Box>
              );
            })}
          </Stack>
        </Box>
      )}

      {sigSrc && (
        <Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
            Signature
          </Typography>
          <Box
            sx={{
              display: "inline-block",
              p: 0.5,
              border: 1,
              borderColor: "divider",
              borderRadius: 1,
              bgcolor: "background.paper",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={sigSrc} alt="Signature" style={{ maxHeight: 80, display: "block" }} />
          </Box>
        </Box>
      )}
    </Box>
  );
}

/**
 * Polls /maintenance-reports/:reportId/location-track every 10 s while the
 * delivery is active (no DO_ACK yet) and renders the route on a Leaflet map.
 * Polling stops automatically when isActive flips false.
 */
function PhotoViewerDialog({
  src,
  open,
  onClose,
}: {
  src: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down("sm"));
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md" fullScreen={fullScreen}>
      <DialogTitle sx={{ display: "flex", alignItems: "center", justifyContent: "flex-end", py: 1 }}>
        <IconButton onClick={onClose} size="small" aria-label="close">
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ display: "flex", justifyContent: "center", bgcolor: "surfaceTones.low" }}>
        {src && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="" style={{ maxWidth: "100%", maxHeight: "80vh", objectFit: "contain" }} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function SummaryStat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <Box sx={{ minWidth: 120, p: 1.5, borderRadius: 2, bgcolor: "surfaceTones.low" }}>
      <Typography variant="caption" color="text.secondary" sx={{ textTransform: "uppercase", letterSpacing: 0.5 }}>
        {label}
      </Typography>
      <Typography variant="h5" sx={{ color: accent ?? "text.primary", fontVariantNumeric: "tabular-nums" }}>
        {value}
      </Typography>
    </Box>
  );
}

// One row in a deployment's DO / Invoice item table. Shared by both sections
// so the expand-children behaviour stays consistent. When the row's resolved
// parent asset has children (subAssets), a chevron toggles a per-child row
// rendered directly below, full-width and indented.
function ItemRow({
  it,
  expanded,
  onToggleExpand,
}: {
  it: DocumentItemRow;
  expanded: boolean;
  onToggleExpand: (id: string) => void;
}) {
  const { display, full } = formatItemDescription(it.description);
  const hasChildren = (it.subAssets?.length ?? 0) > 0;
  return (
    <>
      <Box
        component="tr"
        sx={{
          "& td": { p: 0.75, borderTop: 1, borderColor: "divider", fontVariantNumeric: "tabular-nums" },
          opacity: it.isService ? 0.7 : 1,
        }}
      >
        <td>
          <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
            {hasChildren ? (
              <IconButton size="small" onClick={() => onToggleExpand(it.id)} sx={{ p: 0.25 }}>
                {expanded ? <ExpandMoreIcon fontSize="inherit" /> : <ChevronRightIcon fontSize="inherit" />}
              </IconButton>
            ) : (
              <Box sx={{ width: 22 }} />
            )}
            {full ? (
              <Tooltip title={full} placement="top-start">
                <Box component="span" sx={{ cursor: "help" }}>{display}</Box>
              </Tooltip>
            ) : (
              <Box component="span">{display}</Box>
            )}
          </Box>
        </td>
        <td>{it.sku ?? "—"}</td>
        <td>{it.quantity}</td>
        <td>{it.uom ?? "—"}</td>
        <td>
          <Chip
            size="small"
            variant="outlined"
            label={it.isService ? "Service" : "Product"}
            color={it.isService ? "secondary" : "default"}
          />
        </td>
      </Box>
      {expanded && hasChildren &&
        it.subAssets!.map((child) => (
          <Box
            component="tr"
            key={child.id}
            sx={{
              "& td": { p: 0.75, borderTop: 1, borderColor: "divider" },
              bgcolor: "surfaceTones.low",
            }}
          >
            <td colSpan={5} style={{ paddingLeft: "2.5rem" }}>
              <Box sx={{ display: "inline-flex", alignItems: "center", gap: 1, color: "text.secondary", fontSize: "0.78rem" }}>
                <span>└─</span>
                <Box component="span" sx={{ fontWeight: 600, color: "text.primary" }}>{child.name}</Box>
                <Chip size="small" variant="outlined" label={child.skuKey} />
                {child.isTracked && <Chip size="small" label="tracked" />}
                <span>· {child.inventoryCount} inv</span>
              </Box>
            </td>
          </Box>
        ))}
    </>
  );
}

function DeploymentCard({
  deployment,
  expanded,
  onToggle,
  onOffHire,
  onAttachDoc,
  onPreview,
}: {
  deployment: Deployment;
  expanded: boolean;
  onToggle: () => void;
  onOffHire?: () => void;
  onAttachDoc?: () => void;
  onPreview?: (documentId: string) => void;
}) {
  const months = monthsBetween(deployment.deployedDate, deployment.offHiredDate);
  const ccy = deployment.currency ?? "SGD";
  // Track which item rows have their sub-asset list expanded. Local to the
  // card so state survives independently of the parent's deployment expand.
  const [expandedItems, setExpandedItems] = useState<Set<string>>(() => new Set());
  const toggleItem = (itemId: string) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  // Deduplicated item summary across all DO/invoice line items in this
  // deployment. A rental that spans 5 monthly invoices shows the unit once
  // here; per-invoice itemization is still available by expanding individual
  // invoices below. Dedupe key prefers itemId (a UUID) and falls back to sku
  // so service rows / legacy data without itemId don't all collapse onto each
  // other.
  const dedupedItems = useMemo<DocumentItemRow[]>(() => {
    const map = new Map<string, DocumentItemRow>();
    const all: DocumentItemRow[] = [
      ...deployment.documents.flatMap((d) => d.documentItems ?? []),
      ...deployment.invoices.flatMap((i) => i.documentItems ?? []),
    ];
    for (const it of all) {
      const key = it.itemId || it.sku || it.id;
      if (!map.has(key)) map.set(key, it);
    }
    return Array.from(map.values());
  }, [deployment.documents, deployment.invoices]);

  return (
    <Box
      sx={{
        border: 1,
        borderColor: "divider",
        borderRadius: 2,
        bgcolor: "background.paper",
      }}
    >
      <Stack direction={{ xs: "column", sm: "row" }} alignItems={{ sm: "flex-start" }} gap={2} sx={{ p: 2 }}>
        <Box sx={{ flex: 1 }}>
          <Stack direction="row" alignItems="center" gap={1} sx={{ mb: 0.5 }}>
            <Typography variant="h5">{deployment.name}</Typography>
            {statusChip(deployment.status)}
            <Chip size="small" variant="outlined" label={deployment.type} />
          </Stack>
          {deployment.description && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
              {deployment.description}
            </Typography>
          )}
          <Stack direction="row" gap={2} flexWrap="wrap" sx={{ color: "text.secondary" }}>
            {deployment.sourceDocument && (
              <Typography variant="caption">Source: {deployment.sourceDocument.name}</Typography>
            )}
            <Typography variant="caption">
              Deployed {fmtDate(deployment.deployedDate)}
              {deployment.offHiredDate ? ` → off-hired ${fmtDate(deployment.offHiredDate)}` : ""}
              {months > 0 ? ` (${months} mth)` : ""}
            </Typography>
            {deployment.monthlyRate ? (
              <Typography variant="caption">Rate: {fmtMoney(deployment.monthlyRate, ccy)} / mth</Typography>
            ) : null}
          </Stack>
        </Box>

        <Stack direction="row" gap={2} alignItems="center" sx={{ flexShrink: 0 }}>
          <Box sx={{ textAlign: "right" }}>
            <Typography variant="caption" color="text.secondary" sx={{ textTransform: "uppercase", letterSpacing: 0.5 }}>
              Billed
            </Typography>
            <Typography variant="h6" sx={{ fontVariantNumeric: "tabular-nums" }}>
              {fmtMoney(deployment.totalBilled, ccy)}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {deployment.invoiceCount} invoices · last {fmtDate(deployment.lastInvoiceDate)}
            </Typography>
          </Box>

          <Stack direction="row" gap={0.5} alignItems="center">
            {onAttachDoc && (
              <Tooltip title="Attach a delivery order to this deployment">
                <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={onAttachDoc}>
                  Add DO
                </Button>
              </Tooltip>
            )}
            <Tooltip title={expanded ? "Collapse" : "Expand"}>
              <Button size="small" variant="text" onClick={onToggle}>
                {expanded ? "Hide" : "View"} details
              </Button>
            </Tooltip>
            {onOffHire && (
              <Tooltip title="Off-hire">
                <IconButton size="small" sx={{ color: "text.secondary", "&:hover": { color: "warning.main" } }} onClick={onOffHire}>
                  <StopCircleIcon />
                </IconButton>
              </Tooltip>
            )}
            <Tooltip title="Edit">
              <IconButton size="small" sx={{ color: "text.secondary", "&:hover": { color: "info.main" } }}>
                <EditIcon />
              </IconButton>
            </Tooltip>
          </Stack>
        </Stack>
      </Stack>

      {expanded && (
        <Box sx={{ borderTop: 1, borderColor: "divider", bgcolor: "surfaceTones.low" }}>
          {/* Deployed Items — deduplicated summary across all DOs/invoices in
              this deployment. Renders FIRST so users see what was deployed
              before scrolling through monthly invoice cards. Per-invoice item
              tables remain available by expanding invoices below. */}
          {dedupedItems.length > 0 && (
            <Box sx={{ p: 2, borderBottom: 1, borderColor: "divider" }}>
              <Typography variant="overline" color="text.secondary" sx={{ display: "block", mb: 1 }}>
                Deployed Items ({dedupedItems.length})
              </Typography>
              <Box component="table" sx={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8125rem", bgcolor: "background.paper" }}>
                <Box component="thead">
                  <Box component="tr" sx={{ "& th": { p: 0.75, textAlign: "left", color: "text.secondary", fontSize: "0.6875rem", textTransform: "uppercase", letterSpacing: 0.5 } }}>
                    <th>Item</th>
                    <th>SKU</th>
                    <th>Qty</th>
                    <th>UOM</th>
                    <th>Type</th>
                  </Box>
                </Box>
                <Box component="tbody">
                  {dedupedItems.map((it) => (
                    <ItemRow
                      key={`dedup-${it.id}`}
                      it={it}
                      expanded={expandedItems.has(it.id)}
                      onToggleExpand={toggleItem}
                    />
                  ))}
                </Box>
              </Box>
            </Box>
          )}

          {/* Delivery Orders section */}
          {deployment.documents.length > 0 && (
            <Box sx={{ p: 2, borderBottom: 1, borderColor: "divider" }}>
              <Typography variant="overline" color="text.secondary" sx={{ display: "block", mb: 1 }}>
                Delivery Orders ({deployment.documents.length})
              </Typography>
              <Stack spacing={1.5}>
                {deployment.documents.map((doc) => (
                  <Box key={doc.id} sx={{ p: 1.5, border: 1, borderColor: "divider", borderRadius: 1, bgcolor: "background.paper" }}>
                    <Stack direction="row" gap={1.5} alignItems="center" sx={{ mb: doc.documentItems.length ? 1 : 0 }}>
                      <Typography variant="subtitle2">{doc.name}</Typography>
                      <Chip size="small" variant="outlined" label={doc.type} />
                      <Typography variant="caption" color="text.secondary">{fmtDate(doc.createdAt)}</Typography>
                      <Box sx={{ flexGrow: 1 }} />
                      {onPreview && (
                        <Tooltip title="View document">
                          <Button size="small" variant="text" startIcon={<VisibilityIcon fontSize="small" />} onClick={() => onPreview(doc.id)}>
                            View
                          </Button>
                        </Tooltip>
                      )}
                    </Stack>
                    {doc.documentItems.length > 0 && (
                      <Box component="table" sx={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8125rem" }}>
                        <Box component="thead">
                          <Box component="tr" sx={{ "& th": { p: 0.75, textAlign: "left", color: "text.secondary", fontSize: "0.6875rem", textTransform: "uppercase", letterSpacing: 0.5 } }}>
                            <th>Item</th>
                            <th>SKU</th>
                            <th>Qty</th>
                            <th>UOM</th>
                            <th>Type</th>
                          </Box>
                        </Box>
                        <Box component="tbody">
                          {doc.documentItems.map((it) => (
                            <ItemRow
                              key={it.id}
                              it={it}
                              expanded={expandedItems.has(it.id)}
                              onToggleExpand={toggleItem}
                            />
                          ))}
                        </Box>
                      </Box>
                    )}
                  </Box>
                ))}
              </Stack>
            </Box>
          )}

          {/* Invoices section — per-invoice cards mirroring the DO render so line
              items are visible. For Biofuel rows this is the only line-item surface
              available (DO Documents don't exist for Xero-imported invoices). */}
          {deployment.invoices.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
              No invoices linked to this deployment yet.
            </Typography>
          ) : (
            <Box sx={{ p: 2 }}>
              <Typography variant="overline" color="text.secondary" sx={{ display: "block", mb: 1 }}>
                Invoices ({deployment.invoices.length})
              </Typography>
              <Stack spacing={1.5}>
                {deployment.invoices.map((inv) => (
                  <Box key={inv.id} sx={{ p: 1.5, border: 1, borderColor: "divider", borderRadius: 1, bgcolor: "background.paper" }}>
                    <Stack direction="row" gap={1.5} alignItems="center" flexWrap="wrap" sx={{ mb: inv.documentItems.length ? 1 : 0 }}>
                      <Typography variant="subtitle2">{inv.name}</Typography>
                      <Chip size="small" variant="outlined" label={inv.type} />
                      <Typography variant="caption" color="text.secondary">{fmtDate(inv.date ?? inv.createdAt)}</Typography>
                      <Box sx={{ flexGrow: 1 }} />
                      <Typography variant="caption" sx={{ fontVariantNumeric: "tabular-nums" }}>
                        <strong>{fmtMoney(inv.amount, ccy)}</strong>
                        {" · paid "}{fmtMoney(inv.paid, ccy)}
                      </Typography>
                      <Chip size="small" label={inv.status} />
                      {onPreview && (
                        <Tooltip title="View invoice">
                          <Button size="small" variant="text" startIcon={<VisibilityIcon fontSize="small" />} onClick={() => onPreview(inv.id)}>
                            View
                          </Button>
                        </Tooltip>
                      )}
                    </Stack>
                    {inv.documentItems.length > 0 && (
                      <Box component="table" sx={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8125rem" }}>
                        <Box component="thead">
                          <Box component="tr" sx={{ "& th": { p: 0.75, textAlign: "left", color: "text.secondary", fontSize: "0.6875rem", textTransform: "uppercase", letterSpacing: 0.5 } }}>
                            <th>Item</th>
                            <th>SKU</th>
                            <th>Qty</th>
                            <th>UOM</th>
                            <th>Type</th>
                          </Box>
                        </Box>
                        <Box component="tbody">
                          {inv.documentItems.map((it) => (
                            <ItemRow
                              key={it.id}
                              it={it}
                              expanded={expandedItems.has(it.id)}
                              onToggleExpand={toggleItem}
                            />
                          ))}
                        </Box>
                      </Box>
                    )}
                  </Box>
                ))}
              </Stack>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}

function NewDeploymentDialog({
  open,
  onClose,
  projectId,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  onCreated: () => void;
}) {
  const { getToken } = useAuth();
  const [type, setType] = useState<DeploymentType>("RENTAL");
  const [description, setDescription] = useState("");
  const [monthlyRate, setMonthlyRate] = useState("");
  const [deployedDate, setDeployedDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      const token = await getToken();
      if (!token) return;
      const res = await request(
        { path: `/projects/${projectId}/deployments`, method: "POST" },
        {
          type,
          description: description.trim() || undefined,
          monthlyRate: monthlyRate ? Number(monthlyRate) : undefined,
          deployedDate,
          notes: notes.trim() || undefined,
        },
        token,
      );
      if (res.success) {
        toast.success(`Deployment created (${res.data?.name ?? "Deployment N"})`);
        onCreated();
      } else {
        toast.error(res.message ?? "Failed to create");
      }
    } catch (err) {
      console.error(err);
      toast.error("Error creating deployment");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>New Deployment</DialogTitle>
      <DialogContent>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
          Number is auto-assigned (Deployment 1, 2, 3, …).
        </Typography>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField select label="Type" value={type} onChange={(e) => setType(e.target.value as DeploymentType)} fullWidth>
            <MenuItem value="RENTAL">Rental (recurring)</MenuItem>
            <MenuItem value="SALE">Sale (one-off)</MenuItem>
            <MenuItem value="SERVICE">Service</MenuItem>
          </TextField>
          <TextField
            label="Description (optional notes)"
            placeholder="e.g. 1× AF-90, 2× APF60"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            fullWidth
          />
          <TextField
            label={type === "RENTAL" ? "Monthly Rate (SGD)" : "Price (SGD)"}
            type="number"
            value={monthlyRate}
            onChange={(e) => setMonthlyRate(e.target.value)}
            fullWidth
          />
          <TextField
            label="Deployed Date"
            type="date"
            value={deployedDate}
            onChange={(e) => setDeployedDate(e.target.value)}
            fullWidth
            InputLabelProps={{ shrink: true }}
          />
          <TextField label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} fullWidth multiline rows={2} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={submit} disabled={saving}>
          {saving ? <CircularProgress size={18} /> : "Create"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function DocumentPreviewDialog({
  documentId,
  open,
  onClose,
}: {
  documentId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down("sm"));
  const [doc, setDoc] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !documentId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      setDoc(null);
      try {
        const token = await getToken();
        if (!token) return;
        const res = await request({ path: `/documents/${documentId}`, method: "GET" }, {}, token);
        if (cancelled) return;
        if (res.success) setDoc(res.data);
        else setError(res.message ?? "Failed to load document");
      } catch (err: any) {
        if (!cancelled) setError(err?.message ?? "Failed to load document");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, documentId, getToken]);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="lg" fullScreen={fullScreen}>
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1, pr: 1 }}>
        <Box sx={{ flex: 1 }}>
          {doc?.name ?? "Document"}{doc?.type ? <Chip size="small" variant="outlined" sx={{ ml: 1 }} label={doc.type} /> : null}
        </Box>
        <IconButton onClick={onClose} size="small" aria-label="close">
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ bgcolor: "surfaceTones.low" }}>
        {loading && (
          <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
            <CircularProgress />
          </Box>
        )}
        {error && !loading && (
          <Typography color="error" sx={{ py: 6, textAlign: "center" }}>
            {error}
          </Typography>
        )}
        {doc && !loading && !error && (
          <CleanDocumentPreview
            documentType={doc.type}
            // Inject the document's own org so CleanDocumentPreview can gate the
            // Biofuel quotation header on the DOCUMENT's org (config strips
            // organizationId at save, so it isn't inside doc.config).
            data={{ ...(doc.config ?? {}), documentOrganizationId: doc.organizationId }}
            organization={organization}
            maintenanceReports={doc.maintenanceReports ?? []}
          />
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

function AttachDocumentDialog({
  open,
  deploymentId,
  candidates,
  onClose,
  onAttached,
}: {
  open: boolean;
  deploymentId: string | null;
  candidates: Array<{ id: string; name: string | null; type: string; createdAt: string }>;
  onClose: () => void;
  onAttached: () => void;
}) {
  const { getToken } = useAuth();
  const [selected, setSelected] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setSelected("");
  }, [open]);

  const submit = async () => {
    if (!deploymentId || !selected) {
      toast.error("Pick a delivery order");
      return;
    }
    setSaving(true);
    try {
      const token = await getToken();
      if (!token) return;
      const res = await request(
        { path: `/projects/deployments/${deploymentId}/attach-document`, method: "POST" },
        { documentId: selected },
        token,
      );
      if (res.success) {
        toast.success("Delivery order attached");
        onAttached();
      } else {
        toast.error(res.message ?? "Failed to attach");
      }
    } catch (err) {
      console.error(err);
      toast.error("Error attaching delivery order");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Attach Delivery Order</DialogTitle>
      <DialogContent>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
          Pick an unattached DO from this project. Already-attached DOs are not listed.
        </Typography>
        {candidates.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ p: 2, textAlign: "center" }}>
            No unattached delivery orders found for this project.
          </Typography>
        ) : (
          <TextField
            select
            label="Delivery Order"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            fullWidth
            sx={{ mt: 1 }}
          >
            {candidates.map((d) => (
              <MenuItem key={d.id} value={d.id}>
                {d.name ?? "(unnamed)"} — {d.type} — {fmtDate(d.createdAt)}
              </MenuItem>
            ))}
          </TextField>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={submit} disabled={saving || !selected || candidates.length === 0}>
          {saving ? <CircularProgress size={18} /> : "Attach"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
