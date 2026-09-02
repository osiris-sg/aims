"use client";

// Interior-design project page — their "Costing Summary" sheet, live.
// Header (client / site / designer / stage) · KPI tiles · tabs:
//   Costing  — subcontractor & supplier ledger (+ upload invoice → AI extract)
//   Payments — progressive schedule (10/40/45/5), VOs, refunds, collections
//   Contract & P&L — signed quotation, contract roll-up, profit, commission
//   Documents — everything linked to the project

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Grid,
  IconButton,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/EditOutlined";
import DeleteIcon from "@mui/icons-material/DeleteOutline";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import DescriptionIcon from "@mui/icons-material/DescriptionOutlined";
import RefreshIcon from "@mui/icons-material/Refresh";
import CheckIcon from "@mui/icons-material/Check";
import { toast } from "react-toastify";
import StatusChip from "@/components/StatusChip";
import DeleteItemDialogNoConfirm from "@/components/DeleteItemDialogNoConfirm";
import CostDialog from "./CostDialog";
import ScheduleTab from "./ScheduleTab";
import { STAGE_LABEL, fmtDate, money, pct, useIdProjectApi, type Cost, type Milestone, type Summary } from "./api";
import VoDialog from "./VoDialog";
import { useOrganization } from "@hooks/useOrganization";
import { useIdQuoteApi } from "@/app/portal/sales/quotations/id/_lib/api";
import { defaultQuote } from "@/app/portal/sales/quotations/id/_lib/defaults";

const KPI = ({ label, value, hint, color }: { label: string; value: string; hint?: string; color?: string }) => (
  <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, minWidth: 0 }}>
    <Typography variant="overline" sx={{ color: "text.secondary", lineHeight: 1.4, display: "block", whiteSpace: "nowrap" }}>
      {label}
    </Typography>
    <Typography variant="h6" sx={{ fontWeight: 800, fontVariantNumeric: "tabular-nums", color: color || "text.primary", lineHeight: 1.2 }}>
      {value}
    </Typography>
    {hint && (
      <Typography variant="caption" sx={{ color: "text.secondary" }}>
        {hint}
      </Typography>
    )}
  </Paper>
);

/** Designer = one of the org's users (drives WhatsApp routing + commissions). */
function DesignerSelect({ value, onPick }: { value: string | null; onPick: (u: { id: string; name: string } | null) => void }) {
  const api = useIdProjectApi();
  const [options, setOptions] = useState<Array<{ id: string; name: string; email?: string }>>([]);
  useEffect(() => {
    api
      .listOrgUsers()
      .then((users: any[]) => setOptions(users))
      .catch(() => {});
  }, [api]);
  return (
    <Autocomplete
      size="small"
      options={options}
      getOptionLabel={(o) => o.name}
      value={options.find((o) => o.name === value) || (value ? ({ id: "", name: value } as any) : null)}
      isOptionEqualToValue={(a, b) => a.id === b.id || a.name === b.name}
      onChange={(_, v) => onPick(v ? { id: v.id, name: v.name } : null)}
      renderOption={(props, o) => (
        <li {...props} key={o.id || o.name}>
          <Box>
            <Typography variant="body2">{o.name}</Typography>
            {o.email && (
              <Typography variant="caption" sx={{ color: "text.secondary" }}>
                {o.email}
              </Typography>
            )}
          </Box>
        </li>
      )}
      renderInput={(params) => <TextField {...params} label="Designer" placeholder="Pick a user" />}
      sx={{ minWidth: 220 }}
    />
  );
}

const Cell = ({ children, right, sx }: { children?: React.ReactNode; right?: boolean; sx?: any }) => (
  <TableCell sx={{ py: 0.75, whiteSpace: "nowrap", textAlign: right ? "right" : "left", fontVariantNumeric: "tabular-nums", ...sx }}>{children}</TableCell>
);

export default function IdProjectPage({ id }: { id: string }) {
  const router = useRouter();
  const api = useIdProjectApi();
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState(0);
  const [costDialog, setCostDialog] = useState<{ open: boolean; editing: Cost | null }>({ open: false, editing: null });
  const [costToDelete, setCostToDelete] = useState<Cost | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingMs, setEditingMs] = useState<Record<string, Partial<Milestone>>>({});
  const [voDoc, setVoDoc] = useState<string | null>(null);
  const { organization } = useOrganization();
  const quoteApi = useIdQuoteApi();

  const load = useCallback(async () => {
    try {
      setData(await api.summary(id));
      setError(null);
    } catch (e: any) {
      setError(e.message || "Failed to load project");
    }
  }, [api, id]);
  useEffect(() => {
    load();
  }, [load]);

  const saveField = async (patch: any) => {
    try {
      await api.updateFields(id, patch);
      load();
    } catch (e: any) {
      toast.error(e.message || "Update failed");
    }
  };

  const saveMilestone = async (m: Milestone) => {
    const patch = editingMs[m.id];
    if (!patch) return;
    setBusy(true);
    try {
      await api.updateMilestone(m.id, patch);
      setEditingMs((s) => {
        const n = { ...s };
        delete n[m.id];
        return n;
      });
      load();
    } catch (e: any) {
      toast.error(e.message || "Update failed");
    } finally {
      setBusy(false);
    }
  };

  // Lead → Project → Quotation: the quotation is raised FROM the project,
  // pre-filled with the client, linked via projectId (signing locks onto this
  // project) and tagged with the source lead.
  const createQuotationHere = async () => {
    if (!organization?.id || !data) return;
    setBusy(true);
    try {
      const qd = defaultQuote();
      qd.header.clientName = data.project.client.name || data.project.name || "";
      qd.header.address = data.project.client.address || data.project.address || "";
      qd.header.contact = data.project.client.contact || "";
      qd.header.designer = data.project.designer || "";
      const doc = await quoteApi.createQuotation(organization.id, qd, { projectId: id, leadId: data.project.leadId });
      router.push(`/portal/sales/quotations/id/${doc.id}`);
    } catch (e: any) {
      toast.error(e.message || "Could not create the quotation");
      setBusy(false);
    }
  };

  const newVo = async () => {
    setBusy(true);
    try {
      const d = await api.createVo(id);
      await load();
      setVoDoc(d.id);
    } catch (e: any) {
      toast.error(e.message || "Could not create the VO");
    } finally {
      setBusy(false);
    }
  };

  const t = data?.totals;
  const costRows = useMemo(() => data?.costs || [], [data]);

  if (error) return <Alert severity="error" sx={{ m: 3 }}>{error}</Alert>;
  if (!data || !t)
    return (
      <Box sx={{ display: "flex", justifyContent: "center", pt: 10 }}>
        <CircularProgress />
      </Box>
    );

  const p = data.project;
  const q = data.quotation;

  return (
    <Box sx={{ width: "100%", minWidth: 0, px: { xs: 1.5, md: 2 }, py: { xs: 1.5, md: 2 } }}>
      {/* ── header ─────────────────────────────────────────────────────── */}
      <Stack direction="row" spacing={1} alignItems="flex-start" sx={{ mb: 2 }}>
        <IconButton size="small" onClick={() => router.push("/portal/projects")} sx={{ mt: 0.5 }}>
          <ArrowBackIcon />
        </IconButton>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography variant="h5" sx={{ fontWeight: 800 }}>
              {p.client.name || p.name}
            </Typography>
            {q && (
              <Chip size="small" variant="outlined" icon={<DescriptionIcon />} label={`Contract ${q.number || ""}`} onClick={() => router.push(`/portal/sales/quotations/id/${q.id}`)} />
            )}
            {q?.signedAt && <Chip size="small" color="success" variant="outlined" label={`Signed ${fmtDate(q.signedAt)}`} />}
            <StatusChip status={p.status} />
          </Stack>
          <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.5 }}>
            {p.client.address || "No site address"}
            {p.client.contact ? ` · ${p.client.contact}` : ""}
            {p.client.nric ? ` · NRIC ${p.client.nric}` : ""}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center">
          <TextField
            select
            size="small"
            label="Stage"
            value={p.stage || ""}
            onChange={(e) => saveField({ stage: e.target.value })}
            sx={{ minWidth: 180 }}
          >
            {data.stages.map((s) => (
              <MenuItem key={s} value={s}>
                {STAGE_LABEL[s] || s}
              </MenuItem>
            ))}
          </TextField>
          <DesignerSelect value={p.designer} onPick={(u) => saveField(u ? { designer: u.name, designerUserId: u.id } : { designer: null, designerUserId: null })} />
          {!q && (
            <Tooltip title="Raise this project's main quotation — pre-filled with the client, and signing locks onto this project">
              <Button variant="contained" size="small" startIcon={<DescriptionIcon />} onClick={createQuotationHere} disabled={busy} sx={{ textTransform: "none", whiteSpace: "nowrap" }}>
                Create quotation
              </Button>
            </Tooltip>
          )}
          {q?.status === "confirmed" && (
            <Tooltip title="One main quotation per project — changes after signing go on a Variation Order">
              <Button variant="outlined" size="small" startIcon={<AddIcon />} onClick={newVo} disabled={busy} sx={{ textTransform: "none", whiteSpace: "nowrap" }}>
                New VO
              </Button>
            </Tooltip>
          )}
        </Stack>
      </Stack>

      {/* ── KPIs ───────────────────────────────────────────────────────── */}
      <Grid container spacing={1.5} sx={{ mb: 2 }}>
        <Grid item xs={6} md={2}>
          <KPI label="Contract" value={money(t.contractTotal)} hint={t.voTotal ? `incl. VOs ${money(t.voTotal)}` : "signed quotation"} />
        </Grid>
        <Grid item xs={6} md={2}>
          <KPI label="Collected" value={money(t.collected)} hint={t.refunded ? `after refunds ${money(t.refunded)}` : undefined} color="success.main" />
        </Grid>
        <Grid item xs={6} md={2}>
          <KPI label="Balance due" value={money(t.balanceDue)} color={t.balanceDue > 0 ? "warning.main" : "text.primary"} />
        </Grid>
        <Grid item xs={6} md={2}>
          <KPI label="Total costing" value={money(t.totalCost)} hint={t.pendingCost ? `+ ${money(t.pendingCost)} pending` : undefined} />
        </Grid>
        <Grid item xs={6} md={2}>
          <KPI label="Profit (collected)" value={money(t.profit)} hint={`margin ${pct(t.marginOnCollected)}`} color={t.profit < 0 ? "error.main" : "text.primary"} />
        </Grid>
        <Grid item xs={6} md={2}>
          <KPI label="Projected margin" value={pct(t.projectedMargin)} hint={`profit ${money(t.projectedProfit)} at handover`} color={t.projectedMargin != null && t.projectedMargin < 15 ? "warning.main" : "text.primary"} />
        </Grid>
      </Grid>

      {/* Fixed-width shell: switching tabs must never change the page width. */}
      <Paper variant="outlined" sx={{ borderRadius: 2, width: "100%", minWidth: 0, overflow: "hidden" }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" scrollButtons="auto" sx={{ px: 1, borderBottom: 1, borderColor: "divider" }}>
          <Tab label={`Costing (${costRows.length})`} />
          <Tab label="Payments" />
          <Tab label="Contract & P&L" />
          <Tab label="Schedule" />
          <Tab label={`Documents (${data.documents.length + (q ? 1 : 0)})`} />
        </Tabs>

        {/* ── Costing ───────────────────────────────────────────────── */}
        {tab === 0 && (
          <Box sx={{ p: 2, width: "100%", minWidth: 0 }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                Subcontractor & supplier costs
              </Typography>
              <Box sx={{ flex: 1 }} />
              <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={() => setCostDialog({ open: true, editing: null })} sx={{ textTransform: "none" }}>
                Add cost / upload invoice
              </Button>
            </Stack>
            <Box sx={{ overflowX: "auto", width: "100%" }}>
              <Table size="small" sx={{ minWidth: 860 }}>
                <TableHead>
                  <TableRow>
                    <Cell>Date</Cell>
                    <Cell>Subcontractor / description</Cell>
                    <Cell>Invoice no.</Cell>
                    <Cell>Section</Cell>
                    <Cell>Status</Cell>
                    <Cell right>Amount (S$)</Cell>
                    <Cell />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {costRows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} sx={{ color: "text.secondary", py: 4, textAlign: "center" }}>
                        No costs yet. Add one, or upload a supplier invoice and let it be read automatically.
                      </TableCell>
                    </TableRow>
                  )}
                  {costRows.map((c) => {
                    const sec = data.sections.find((s) => s.id === c.sectionId);
                    return (
                      <TableRow key={c.id} hover sx={{ opacity: c.status === "rejected" ? 0.5 : 1 }}>
                        <Cell>{fmtDate(c.date)}</Cell>
                        <TableCell sx={{ py: 0.75, minWidth: 260 }}>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>
                            {c.supplierName || "—"}
                          </Typography>
                          <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }}>
                            {c.description}
                          </Typography>
                        </TableCell>
                        <Cell>
                          <Stack direction="row" spacing={0.5} alignItems="center">
                            <span>{c.invoiceNo || "—"}</span>
                            {c.attachmentUrl && (
                              <Tooltip title="View invoice">
                                <IconButton size="small" href={c.attachmentUrl} target="_blank" rel="noreferrer">
                                  <AttachFileIcon sx={{ fontSize: 16 }} />
                                </IconButton>
                              </Tooltip>
                            )}
                          </Stack>
                        </Cell>
                        <Cell>{sec ? <Chip size="small" variant="outlined" label={`${sec.letter || ""} ${sec.title}`.trim()} /> : <Typography variant="caption" sx={{ color: "text.disabled" }}>—</Typography>}</Cell>
                        <Cell>
                          {c.status === "pending" ? (
                            <Button size="small" startIcon={<CheckIcon />} onClick={() => api.updateCost(c.id, { status: "approved" }).then(load)} sx={{ textTransform: "none" }}>
                              Approve
                            </Button>
                          ) : (
                            <Chip size="small" label={c.status} color={c.status === "approved" ? "success" : "default"} variant="outlined" />
                          )}
                        </Cell>
                        <Cell right sx={{ fontWeight: 600 }}>{money(c.amount)}</Cell>
                        <Cell right>
                          <IconButton size="small" onClick={() => setCostDialog({ open: true, editing: c })}>
                            <EditIcon fontSize="small" />
                          </IconButton>
                          <IconButton size="small" onClick={() => setCostToDelete(c)} sx={{ "&:hover": { color: "error.main" } }}>
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Cell>
                      </TableRow>
                    );
                  })}
                  <TableRow>
                    <TableCell colSpan={5} sx={{ textAlign: "right", fontWeight: 700 }}>
                      Total Costing (S$)
                    </TableCell>
                    <Cell right sx={{ fontWeight: 800 }}>{money(t.totalCost)}</Cell>
                    <TableCell />
                  </TableRow>
                </TableBody>
              </Table>
            </Box>

            {data.tally.length > 0 && (
              <Box sx={{ mt: 3 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                  Actual cost vs quotation provision
                </Typography>
                <Box sx={{ overflowX: "auto", width: "100%" }}>
                  <Table size="small" sx={{ minWidth: 640 }}>
                    <TableHead>
                      <TableRow>
                        <Cell>Section</Cell>
                        <Cell right>Quoted to client</Cell>
                        <Cell right>Provisioned cost</Cell>
                        <Cell right>Actual cost</Cell>
                        <Cell right>Variance</Cell>
                        <Cell>Used</Cell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {data.tally.map((r) => {
                        const variance = r.actualCost - r.provisionedCost;
                        const used = r.provisionedCost > 0 ? Math.min(100, (r.actualCost / r.provisionedCost) * 100) : 0;
                        return (
                          <TableRow key={r.sectionId}>
                            <Cell>{r.letter} · {r.title}</Cell>
                            <Cell right>{money(r.quoted)}</Cell>
                            <Cell right>{r.provisionedCost ? money(r.provisionedCost) : "—"}</Cell>
                            <Cell right sx={{ fontWeight: 600 }}>{money(r.actualCost)}</Cell>
                            <Cell right sx={{ color: r.provisionedCost && variance > 0 ? "error.main" : "success.main" }}>{r.provisionedCost ? (variance > 0 ? "+" : "") + money(variance) : "—"}</Cell>
                            <TableCell sx={{ width: 160 }}>
                              {r.provisionedCost > 0 && <LinearProgress variant="determinate" value={used} color={r.actualCost > r.provisionedCost ? "error" : "primary"} sx={{ height: 6, borderRadius: 3 }} />}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      {data.unallocatedCost > 0 && (
                        <TableRow>
                          <Cell sx={{ color: "text.secondary" }}>Not allocated to a section</Cell>
                          <Cell right>—</Cell>
                          <Cell right>—</Cell>
                          <Cell right>{money(data.unallocatedCost)}</Cell>
                          <Cell right>—</Cell>
                          <TableCell />
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </Box>
              </Box>
            )}
          </Box>
        )}

        {/* ── Payments ─────────────────────────────────────────────── */}
        {tab === 1 && (
          <Box sx={{ p: 2, width: "100%", minWidth: 0 }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                Progressive payments
              </Typography>
              <Box sx={{ flex: 1 }} />
              <Tooltip title="Contract sum changed (e.g. a VO was signed)? This re-derives each % milestone amount from the new total — paid amounts are kept">
                <Button size="small" startIcon={<RefreshIcon />} onClick={() => api.recalcMilestones(id).then(load)} sx={{ textTransform: "none" }}>
                  Recalculate
                </Button>
              </Tooltip>
              <Tooltip title="Raise a Variation Order document (their VO sheet: additions + removals) — confirming it adds the net to the contract sum">
                <Button size="small" startIcon={<AddIcon />} onClick={newVo} disabled={busy} sx={{ textTransform: "none" }}>
                  New VO
                </Button>
              </Tooltip>
              <Tooltip title="Money returned to the client (overcharge/excess) — subtracts from Total Amount Collected">
                <Button size="small" startIcon={<AddIcon />} onClick={() => api.addMilestone(id, { kind: "refund", label: "Refund excess" }).then(load)} sx={{ textTransform: "none" }}>
                  Add refund
                </Button>
              </Tooltip>
            </Stack>
            {q && t.initialContractSum <= 0 && (
              <Alert severity="warning" sx={{ mb: 1.5 }} action={<Button color="inherit" size="small" onClick={() => router.push(`/portal/sales/quotations/id/${q.id}`)}>Open quotation</Button>}>
                Contract sum is S$ 0.00 — quotation {q.number} has no priced lines, so the milestone amounts are zero. Add lines to the quotation (or link the right one) and press Recalculate.
              </Alert>
            )}
            {data.milestones.length === 0 && (
              <Alert severity="info" sx={{ mb: 1.5 }} action={<Button color="inherit" size="small" onClick={() => api.recalcMilestones(id).then(load)}>Create schedule</Button>}>
                No payment schedule yet — create the standard 10% / 40% / 45% / 5% schedule from the contract sum.
              </Alert>
            )}
            {/* Deposit: engagement fee OR 10% — never both */}
            {data.milestones.some((m) => m.dueTrigger === "confirmation") && (
              <Paper variant="outlined" sx={{ p: 1.5, mb: 1.5, borderRadius: 1.5, bgcolor: "action.hover" }}>
                <Stack direction={{ xs: "column", md: "row" }} spacing={1.5} alignItems={{ md: "center" }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    First payment on confirmation:
                  </Typography>
                  <Stack direction="row" spacing={1}>
                    <Chip
                      label={`S$ ${money(data.engagementFee)} engagement fee`}
                      color={data.depositMode === "engagement" ? "primary" : "default"}
                      variant={data.depositMode === "engagement" ? "filled" : "outlined"}
                      onClick={() => api.setDepositMode(id, { mode: "engagement", engagementFee: data.engagementFee }).then(load).catch((e) => toast.error(e.message))}
                    />
                    <Chip
                      label="10% of contract sum"
                      color={data.depositMode === "percent" ? "primary" : "default"}
                      variant={data.depositMode === "percent" ? "filled" : "outlined"}
                      onClick={() => api.setDepositMode(id, { mode: "percent", pct: 10 }).then(load).catch((e) => toast.error(e.message))}
                    />
                  </Stack>
                  {data.depositMode === "engagement" && (
                    <TextField
                      size="small"
                      label="Engagement fee (S$)"
                      defaultValue={data.engagementFee}
                      onBlur={(e) => Number(e.target.value) !== data.engagementFee && api.setDepositMode(id, { mode: "engagement", engagementFee: Number(e.target.value) || 0 }).then(load).catch((err) => toast.error(err.message))}
                      inputProps={{ inputMode: "decimal", style: { width: 90 } }}
                    />
                  )}
                  <Typography variant="caption" sx={{ color: "text.secondary" }}>
                    Either/or — the balance is collected 40% on commencement, 45% at carpentry, 5% on handover.
                  </Typography>
                </Stack>
              </Paper>
            )}
            {data.vos.length > 0 && (
              <Paper variant="outlined" sx={{ p: 1.5, mb: 1.5, borderRadius: 1.5 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
                  Variation orders
                </Typography>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <Cell>VO</Cell>
                      <Cell>Status</Cell>
                      <Cell right>Additions</Cell>
                      <Cell right>Removals</Cell>
                      <Cell right>Net (S$)</Cell>
                      <Cell />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {data.vos.map((v) => (
                      <TableRow key={v.id} hover>
                        <Cell sx={{ fontWeight: 600 }}>{v.name || "VO"}</Cell>
                        <Cell>
                          <StatusChip status={v.status} />
                        </Cell>
                        <Cell right>{money(v.additions)}</Cell>
                        <Cell right>({money(v.removals)})</Cell>
                        <Cell right sx={{ fontWeight: 700 }}>{money(v.net)}</Cell>
                        <Cell right>
                          <Button size="small" onClick={() => setVoDoc(v.id)} sx={{ textTransform: "none" }}>
                            {v.status === "confirmed" ? "View" : "Edit"}
                          </Button>
                        </Cell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Paper>
            )}
            <Box sx={{ overflowX: "auto", width: "100%" }}>
              <Table size="small" sx={{ minWidth: 1000 }}>
                <TableHead>
                  <TableRow>
                    <Cell>Milestone</Cell>
                    <Cell right>%</Cell>
                    <Cell right>Amount (S$)</Cell>
                    <Cell>Invoice</Cell>
                    <Cell right>Paid (S$)</Cell>
                    <Cell>Date paid</Cell>
                    <Cell>Method</Cell>
                    <Cell>Status</Cell>
                    <Cell />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.milestones.map((m) => {
                    const e = editingMs[m.id] || {};
                    const paid = e.paidAmount ?? m.paidAmount;
                    const outstanding = m.kind === "refund" ? 0 : m.amount - paid;
                    const status = m.kind === "refund" ? "refund" : paid >= m.amount && m.amount > 0 ? "paid" : paid > 0 ? "partial" : "due";
                    const dirty = Object.keys(e).length > 0;
                    return (
                      <TableRow key={m.id} hover sx={{ bgcolor: m.kind === "refund" ? "action.hover" : undefined }}>
                        <TableCell sx={{ py: 0.5, minWidth: 240 }}>
                          <TextField size="small" variant="standard" fullWidth value={e.label ?? m.label} onChange={(ev) => setEditingMs((s) => ({ ...s, [m.id]: { ...e, label: ev.target.value } }))} InputProps={{ disableUnderline: true, sx: { fontSize: 13.5, fontWeight: m.kind === "milestone" ? 600 : 400 } }} />
                          {m.kind !== "milestone" && <Chip size="small" label={m.kind === "vo" ? "Variation order" : "Refund to client"} sx={{ height: 18, "& .MuiChip-label": { fontSize: 10 } }} />}
                        </TableCell>
                        <Cell right>{m.pct != null ? `${m.pct}%` : "—"}</Cell>
                        <TableCell sx={{ py: 0.5, textAlign: "right" }}>
                          <TextField size="small" value={e.amount ?? m.amount} disabled={!!m.invoice} onChange={(ev) => setEditingMs((s) => ({ ...s, [m.id]: { ...e, amount: Number(ev.target.value) || 0 } }))} inputProps={{ inputMode: "decimal", style: { textAlign: "right", width: 96, padding: "4px 8px" } }} />
                        </TableCell>
                        <TableCell sx={{ py: 0.5 }}>
                          {m.kind === "refund" ? (
                            <Typography variant="caption" sx={{ color: "text.disabled" }}>—</Typography>
                          ) : m.invoice ? (
                            <Tooltip title="Open invoice">
                              <Chip size="small" variant="outlined" icon={<DescriptionIcon />} label={`${m.invoice.number || "Invoice"} · ${m.invoice.status}`} onClick={() => router.push(m.invoice!.path)} />
                            </Tooltip>
                          ) : (
                            <Button
                              size="small"
                              variant="outlined"
                              disabled={busy || !(m.amount > 0)}
                              onClick={async () => {
                                setBusy(true);
                                try {
                                  const r = await api.createMilestoneInvoice(m.id);
                                  toast.success(r.created ? `Invoice ${r.number || ""} created` : "Invoice already exists");
                                  load();
                                } catch (err: any) {
                                  toast.error(err.message || "Could not create invoice");
                                } finally {
                                  setBusy(false);
                                }
                              }}
                              sx={{ textTransform: "none", whiteSpace: "nowrap" }}
                            >
                              Generate invoice
                            </Button>
                          )}
                        </TableCell>
                        <TableCell sx={{ py: 0.5, textAlign: "right" }}>
                          <TextField size="small" value={paid} onChange={(ev) => setEditingMs((s) => ({ ...s, [m.id]: { ...e, paidAmount: Number(ev.target.value) || 0 } }))} inputProps={{ inputMode: "decimal", style: { textAlign: "right", width: 96, padding: "4px 8px" } }} />
                        </TableCell>
                        <TableCell sx={{ py: 0.5 }}>
                          <TextField size="small" type="date" value={(e.paidAt ?? m.paidAt ?? "").toString().slice(0, 10)} onChange={(ev) => setEditingMs((s) => ({ ...s, [m.id]: { ...e, paidAt: ev.target.value || null } }))} inputProps={{ style: { padding: "4px 8px" } }} />
                        </TableCell>
                        <TableCell sx={{ py: 0.5 }}>
                          <TextField select size="small" value={e.paymentMethod ?? m.paymentMethod ?? ""} onChange={(ev) => setEditingMs((s) => ({ ...s, [m.id]: { ...e, paymentMethod: ev.target.value } }))} sx={{ minWidth: 130 }} inputProps={{ style: { padding: "4px 8px" } }}>
                            <MenuItem value="">—</MenuItem>
                            <MenuItem value="BANK TRANSFER">Bank transfer</MenuItem>
                            <MenuItem value="PAYNOW">PayNow</MenuItem>
                            <MenuItem value="CHEQUE">Cheque</MenuItem>
                            <MenuItem value="CASH">Cash</MenuItem>
                          </TextField>
                        </TableCell>
                        <Cell>
                          <Chip size="small" variant="outlined" label={status === "paid" ? "Paid" : status === "partial" ? `Partial · ${money(outstanding)} left` : status === "refund" ? "Refund" : "Due"} color={status === "paid" ? "success" : status === "partial" ? "warning" : status === "due" ? "default" : "info"} />
                        </Cell>
                        <Cell right>
                          {dirty && (
                            <Button size="small" variant="contained" disabled={busy} onClick={() => saveMilestone(m)} sx={{ textTransform: "none", mr: 0.5 }}>
                              Save
                            </Button>
                          )}
                          {m.kind !== "milestone" && (
                            <IconButton size="small" onClick={() => api.removeMilestone(m.id).then(load)} sx={{ "&:hover": { color: "error.main" } }}>
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          )}
                        </Cell>
                      </TableRow>
                    );
                  })}
                  <TableRow>
                    <TableCell colSpan={2} sx={{ fontWeight: 700 }}>
                      Total Amount Collected (S$)
                    </TableCell>
                    <Cell right sx={{ fontWeight: 700 }}>{money(t.contractTotal)}</Cell>
                    <TableCell />
                    <Cell right sx={{ fontWeight: 800, color: "success.main" }}>{money(t.collected)}</Cell>
                    <TableCell colSpan={2} sx={{ textAlign: "right", color: "text.secondary" }}>
                      Balance amount due
                    </TableCell>
                    <Cell sx={{ fontWeight: 700, color: t.balanceDue > 0 ? "warning.main" : "text.primary" }}>{money(t.balanceDue)}</Cell>
                    <TableCell />
                  </TableRow>
                </TableBody>
              </Table>
            </Box>
            <Typography variant="caption" sx={{ color: "text.disabled", display: "block", mt: 1 }}>
              "Generate invoice" raises the formal progress-claim invoice for that milestone (one line, contract reference, due on receipt) as a draft in the invoice editor — confirm and send it from there. Record the collection here when the money lands (receipts will post here automatically next).
            </Typography>
          </Box>
        )}

        {/* ── Contract & P&L ───────────────────────────────────────── */}
        {tab === 2 && (
          <Box sx={{ p: 2, width: "100%", minWidth: 0 }}>
            <Grid container spacing={3}>
              <Grid item xs={12} md={6}>
                <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
                  Contract
                </Typography>
                <Table size="small">
                  <TableBody>
                    <TableRow>
                      <Cell>
                        Initial contract sum {q ? <Button size="small" onClick={() => router.push(`/portal/sales/quotations/id/${q.id}`)} sx={{ textTransform: "none", ml: 0.5 }}>{q.number}</Button> : ""}
                      </Cell>
                      <Cell right>{money(t.initialContractSum)}</Cell>
                    </TableRow>
                    {data.milestones.filter((m) => m.kind === "vo").map((m) => (
                      <TableRow key={m.id}>
                        <Cell>{m.label}</Cell>
                        <Cell right>{money(m.amount)}</Cell>
                      </TableRow>
                    ))}
                    <TableRow>
                      <Cell sx={{ fontWeight: 700 }}>Total contract amount</Cell>
                      <Cell right sx={{ fontWeight: 800 }}>{money(t.contractTotal)}</Cell>
                    </TableRow>
                    <TableRow>
                      <Cell sx={{ color: "text.secondary" }}>Balance amount due</Cell>
                      <Cell right sx={{ color: t.balanceDue > 0 ? "warning.main" : "text.secondary" }}>{money(t.balanceDue)}</Cell>
                    </TableRow>
                  </TableBody>
                </Table>
                {!q && (
                  <Alert severity="info" sx={{ mt: 2 }}>
                    No quotation is linked to this project yet.
                  </Alert>
                )}
              </Grid>
              <Grid item xs={12} md={6}>
                <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
                  Profit & loss
                </Typography>
                <Table size="small">
                  <TableBody>
                    <TableRow>
                      <Cell>Final amount collected</Cell>
                      <Cell right>{money(t.collected)}</Cell>
                    </TableRow>
                    <TableRow>
                      <Cell>Total costing</Cell>
                      <Cell right>({money(t.totalCost)})</Cell>
                    </TableRow>
                    <TableRow>
                      <Cell sx={{ fontWeight: 700 }}>Total profit</Cell>
                      <Cell right sx={{ fontWeight: 800, color: t.profit < 0 ? "error.main" : "text.primary" }}>{money(t.profit)}</Cell>
                    </TableRow>
                    <TableRow>
                      <Cell>Profit margin (on collected)</Cell>
                      <Cell right>{pct(t.marginOnCollected)}</Cell>
                    </TableRow>
                    <TableRow>
                      <Cell>
                        <Stack direction="row" spacing={1} alignItems="center">
                          <span>Sales commission</span>
                          <TextField size="small" defaultValue={p.commissionPct} onBlur={(e) => Number(e.target.value) !== p.commissionPct && saveField({ commissionPct: Number(e.target.value) || 0 })} inputProps={{ inputMode: "decimal", style: { width: 44, textAlign: "right", padding: "2px 6px" } }} InputProps={{ endAdornment: <span style={{ fontSize: 12 }}>%</span> }} />
                        </Stack>
                      </Cell>
                      <Cell right>{money(t.commission)}</Cell>
                    </TableRow>
                    <TableRow>
                      <Cell sx={{ color: "text.secondary" }}>Advanced to designer</Cell>
                      <Cell right sx={{ color: "text.secondary" }}>({money(t.advanced)})</Cell>
                    </TableRow>
                    <TableRow>
                      <Cell sx={{ fontWeight: 700 }}>Commission balance payable{p.designer ? ` · ${p.designer}` : ""}</Cell>
                      <Cell right sx={{ fontWeight: 800 }}>{money(t.commissionBalance)}</Cell>
                    </TableRow>
                  </TableBody>
                </Table>
                <Divider sx={{ my: 1.5 }} />
                <Typography variant="caption" sx={{ color: "text.secondary" }}>
                  Projected at handover: profit {money(t.projectedProfit)} · margin {pct(t.projectedMargin)} (contract − approved & pending costs). Designer advances arrive with the commissions module.
                </Typography>
              </Grid>
            </Grid>
          </Box>
        )}

        {/* ── Schedule ─────────────────────────────────────────────── */}
        {tab === 3 && (
          <Box sx={{ p: 2, width: "100%", minWidth: 0 }}>
            <ScheduleTab projectId={id} />
          </Box>
        )}

        {/* ── Documents ────────────────────────────────────────────── */}
        {tab === 4 && (
          <Box sx={{ p: 2, width: "100%", minWidth: 0 }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <Cell>Document</Cell>
                  <Cell>Type</Cell>
                  <Cell>Status</Cell>
                  <Cell>Created</Cell>
                  <Cell />
                </TableRow>
              </TableHead>
              <TableBody>
                {q && (
                  <TableRow hover>
                    <Cell sx={{ fontWeight: 600 }}>{q.number}</Cell>
                    <Cell>Quotation</Cell>
                    <Cell>
                      <StatusChip status={q.status} />
                    </Cell>
                    <Cell>{q.signedAt ? `signed ${fmtDate(q.signedAt)}` : "—"}</Cell>
                    <Cell right>
                      <Button size="small" onClick={() => router.push(`/portal/sales/quotations/id/${q.id}`)} sx={{ textTransform: "none" }}>
                        Open
                      </Button>
                    </Cell>
                  </TableRow>
                )}
                {data.documents.map((d) => (
                  <TableRow key={d.id} hover>
                    <Cell sx={{ fontWeight: 600 }}>{d.name}</Cell>
                    <Cell>{d.type}</Cell>
                    <Cell>
                      <StatusChip status={d.status} />
                    </Cell>
                    <Cell>{fmtDate(d.createdAt)}</Cell>
                    <Cell right>
                      <Button size="small" onClick={() => router.push(`/portal/documents/${d.type}/${d.documentTemplateId}/${d.id}`)} sx={{ textTransform: "none" }}>
                        Open
                      </Button>
                    </Cell>
                  </TableRow>
                ))}
                {!q && data.documents.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} sx={{ color: "text.secondary", textAlign: "center", py: 4 }}>
                      Nothing linked yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Box>
        )}
      </Paper>

      {voDoc && data && <VoDialog docId={voDoc} summary={data} onClose={() => setVoDoc(null)} onChanged={load} />}

      <CostDialog open={costDialog.open} projectId={id} sections={data.sections} editing={costDialog.editing} onClose={() => setCostDialog({ open: false, editing: null })} onSaved={load} />
      <DeleteItemDialogNoConfirm
        open={!!costToDelete}
        onCancel={() => setCostToDelete(null)}
        loading={busy}
        onConfirm={async () => {
          if (!costToDelete) return;
          setBusy(true);
          try {
            await api.removeCost(costToDelete.id);
            setCostToDelete(null);
            load();
          } catch (e: any) {
            toast.error(e.message || "Delete failed");
          } finally {
            setBusy(false);
          }
        }}
      />
    </Box>
  );
}
