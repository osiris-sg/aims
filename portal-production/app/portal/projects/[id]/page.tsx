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
import { ROUTES } from "@/routes";
import Table from "@/components/Table";
import { toast } from "react-toastify";

type DeploymentStatus = "ACTIVE" | "OFF_HIRED" | "COMPLETED" | "CANCELLED";
type DeploymentType = "RENTAL" | "SALE" | "SERVICE";

interface Deployment {
  id: string;
  type: DeploymentType;
  status: DeploymentStatus;
  description: string | null;
  monthlyRate: number | null;
  currency: string | null;
  deployedDate: string | null;
  offHiredDate: string | null;
  notes: string | null;
  sourceDocument: { id: string; name: string; type: string } | null;
  assignments: any[];
  invoices: { id: string; name: string; type: string; status: string; createdAt: string; amount: number; paid: number }[];
  totalBilled: number;
  totalPaid: number;
  outstanding: number;
  invoiceCount: number;
  lastInvoiceDate: string | null;
  lastInvoiceName: string | null;
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
  standaloneDocs: any[];
  allInvoices: any[];
  totals: {
    billed: number;
    paid: number;
    outstanding: number;
    deploymentCount: number;
    activeDeployments: number;
    invoiceCount: number;
  };
}

const fmtMoney = (n: number, ccy = "SGD") =>
  `${ccy} ${(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString() : "—");

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

  const active = useMemo(() => (project?.deployments ?? []).filter((d) => d.status === "ACTIVE"), [project]);
  const past = useMemo(() => (project?.deployments ?? []).filter((d) => d.status !== "ACTIVE"), [project]);

  const offHire = async (deploymentId: string) => {
    if (!organizationId) return;
    if (!confirm("Mark this deployment as off-hired?")) return;
    try {
      const token = await getToken();
      if (!token) return;
      await request(
        { path: `/projects/deployments/${deploymentId}/off-hire`, method: "POST" },
        { offHiredDate: new Date().toISOString() },
        token,
      );
      toast.success("Deployment off-hired");
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
            <Tab label={`Sales & Services (${project.standaloneDocs.length})`} />
            <Tab label={`All Invoices (${project.allInvoices.length})`} />
          </Tabs>
          {tab === 0 && (
            <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={() => setAddOpen(true)}>
              New Deployment
            </Button>
          )}
        </Stack>

        {/* Tab 1: Active on site */}
        {tab === 0 && (
          <Box>
            {active.length === 0 && past.length === 0 && (
              <Box sx={{ p: 6, textAlign: "center", color: "text.secondary" }}>
                <Typography variant="body2">No deployments yet.</Typography>
                <Button variant="contained" sx={{ mt: 2 }} startIcon={<AddIcon />} onClick={() => setAddOpen(true)}>
                  Add first deployment
                </Button>
              </Box>
            )}

            <Stack gap={1.5}>
              {active.map((d) => (
                <DeploymentCard
                  key={d.id}
                  deployment={d}
                  expanded={!!expanded[d.id]}
                  onToggle={() => setExpanded((s) => ({ ...s, [d.id]: !s[d.id] }))}
                  onOffHire={() => offHire(d.id)}
                />
              ))}
            </Stack>

            {past.length > 0 && (
              <>
                <Typography variant="overline" color="text.secondary" sx={{ display: "block", mt: 4, mb: 1 }}>
                  Past deployments ({past.length})
                </Typography>
                <Stack gap={1.5}>
                  {past.map((d) => (
                    <DeploymentCard
                      key={d.id}
                      deployment={d}
                      expanded={!!expanded[d.id]}
                      onToggle={() => setExpanded((s) => ({ ...s, [d.id]: !s[d.id] }))}
                    />
                  ))}
                </Stack>
              </>
            )}
          </Box>
        )}

        {/* Tab 2: Sales & Services */}
        {tab === 1 && (
          <Table
            columns={[
              { id: "name", accessorKey: "name", header: "Doc No.", cell: (i: any) => i.getValue() ?? "—" },
              { id: "type", accessorKey: "type", header: "Type", cell: (i: any) => i.getValue() },
              {
                id: "createdAt",
                accessorKey: "createdAt",
                header: "Date",
                cell: (i: any) => fmtDate(i.getValue()),
              },
              {
                id: "amount",
                accessorKey: "amount",
                header: "Amount",
                cell: (i: any) => fmtMoney(i.getValue()),
              },
              {
                id: "paid",
                accessorKey: "paid",
                header: "Paid",
                cell: (i: any) => fmtMoney(i.getValue()),
              },
              { id: "status", accessorKey: "status", header: "Status", cell: (i: any) => i.getValue() },
            ]}
            data={project.standaloneDocs}
            onRowSelect={() => {}}
          />
        )}

        {/* Tab 3: All Invoices */}
        {tab === 2 && (
          <Table
            columns={[
              { id: "name", accessorKey: "name", header: "Doc No.", cell: (i: any) => i.getValue() ?? "—" },
              { id: "type", accessorKey: "type", header: "Type", cell: (i: any) => i.getValue() },
              {
                id: "createdAt",
                accessorKey: "createdAt",
                header: "Date",
                cell: (i: any) => fmtDate(i.getValue()),
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

        <NewDeploymentDialog
          open={addOpen}
          onClose={() => setAddOpen(false)}
          projectId={project.id}
          onCreated={() => {
            setAddOpen(false);
            fetchProject();
          }}
        />
      </Box>
    </MainCard>
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

function DeploymentCard({
  deployment,
  expanded,
  onToggle,
  onOffHire,
}: {
  deployment: Deployment;
  expanded: boolean;
  onToggle: () => void;
  onOffHire?: () => void;
}) {
  const months = monthsBetween(deployment.deployedDate, deployment.offHiredDate);
  const ccy = deployment.currency ?? "SGD";

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
            <Typography variant="h5">{deployment.description ?? "(unnamed deployment)"}</Typography>
            {statusChip(deployment.status)}
            <Chip size="small" variant="outlined" label={deployment.type} />
          </Stack>
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

          <Stack direction="row" gap={0.5}>
            <Tooltip title={expanded ? "Collapse invoices" : "View invoices"}>
              <Button size="small" variant="text" onClick={onToggle}>
                {expanded ? "Hide" : "View"} invoices
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
          {deployment.invoices.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
              No invoices linked to this deployment yet.
            </Typography>
          ) : (
            <Box component="table" sx={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8125rem" }}>
              <Box component="thead">
                <Box component="tr" sx={{ "& th": { p: 1, textAlign: "left", color: "text.secondary", fontSize: "0.6875rem", textTransform: "uppercase", letterSpacing: 0.5 } }}>
                  <th>Invoice</th>
                  <th>Date</th>
                  <th>Amount</th>
                  <th>Paid</th>
                  <th>Status</th>
                </Box>
              </Box>
              <Box component="tbody">
                {deployment.invoices.map((inv) => (
                  <Box component="tr" key={inv.id} sx={{ "& td": { p: 1, borderTop: 1, borderColor: "divider", fontVariantNumeric: "tabular-nums" } }}>
                    <td>{inv.name}</td>
                    <td>{fmtDate(inv.createdAt)}</td>
                    <td>{fmtMoney(inv.amount, ccy)}</td>
                    <td>{fmtMoney(inv.paid, ccy)}</td>
                    <td>{inv.status}</td>
                  </Box>
                ))}
              </Box>
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
    if (!description.trim()) {
      toast.error("Description required");
      return;
    }
    setSaving(true);
    try {
      const token = await getToken();
      if (!token) return;
      const res = await request(
        { path: `/projects/${projectId}/deployments`, method: "POST" },
        {
          type,
          description,
          monthlyRate: monthlyRate ? Number(monthlyRate) : undefined,
          deployedDate,
          notes,
        },
        token,
      );
      if (res.success) {
        toast.success("Deployment created");
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
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField select label="Type" value={type} onChange={(e) => setType(e.target.value as DeploymentType)} fullWidth>
            <MenuItem value="RENTAL">Rental (recurring)</MenuItem>
            <MenuItem value="SALE">Sale (one-off)</MenuItem>
            <MenuItem value="SERVICE">Service</MenuItem>
          </TextField>
          <TextField
            label="Description"
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
