"use client";

// Sales → Leads (interior-design orgs): every homeowner enquiry from EZiD /
// Network Singapore (auto-captured from email) or keyed manually. Designers
// are assigned inline, statuses follow the funnel (new → contacted → met →
// qualified → signed, or non-qualified / dead → replacement), and a qualified
// lead becomes a quotation in one click.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Drawer,
  Grid,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import VisibilityIcon from "@mui/icons-material/VisibilityOutlined";
import DeleteIcon from "@mui/icons-material/DeleteOutline";
import WhatsAppIcon from "@mui/icons-material/WhatsApp";
import DescriptionIcon from "@mui/icons-material/DescriptionOutlined";
import moment from "moment";
import { toast } from "react-toastify";
import MainCard from "@/components/MainCard";
import PageTable from "@/components/PageTable";
import DeleteItemDialogNoConfirm from "@/components/DeleteItemDialogNoConfirm";
import type { FilterField } from "@/components/FilterDrawer";
import { useOrganization } from "@hooks/useOrganization";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";
import { useIdQuoteApi } from "@/app/portal/sales/quotations/id/_lib/api";
import { defaultQuote } from "@/app/portal/sales/quotations/id/_lib/defaults";

type Lead = {
  id: string;
  source: string;
  ref: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  phoneVerified: boolean;
  location: string | null;
  propertyType: string | null;
  propertyRooms: string | null;
  propertyStatus: string | null;
  keyCollection: string | null;
  moveIn: string | null;
  budget: string | null;
  areas: string | null;
  designStyle: string | null;
  remarks: string | null;
  approachNotes: string | null;
  floorPlanUrl: string | null;
  attachmentUrl: string | null;
  status: string;
  assignedToUserId: string | null;
  assignedToName: string | null;
  firstContactDeadline: string | null;
  replacementDeadline: string | null;
  quotationId: string | null;
  deadProofUrl: string | null;
  receivedAt: string;
  notes: string | null;
};

// unqualified → engaging → dead (proof required) | converted (auto-quotation)
const STATUS_OPTIONS: Array<{ value: string; label: string; color: "default" | "primary" | "info" | "success" | "warning" | "error" }> = [
  { value: "unqualified", label: "Unqualified", color: "primary" },
  { value: "engaging", label: "Engaging", color: "info" },
  { value: "dead", label: "Dead", color: "error" },
  { value: "converted", label: "Converted", color: "success" },
];
const statusOf = (v: string) => STATUS_OPTIONS.find((s) => s.value === v) || STATUS_OPTIONS[0];

export default function LeadsPage() {
  const router = useRouter();
  const api = useIdQuoteApi();
  const { organization } = useOrganization();
  const { isIdQuotationEnabled, isLoading: flagsLoading } = useOrganizationFeatures();
  const [rows, setRows] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<any>(null);
  const [designers, setDesigners] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<any>({ status: "", source: "" });
  const [detail, setDetail] = useState<Lead | null>(null);
  const [toDelete, setToDelete] = useState<Lead | null>(null);
  const [busy, setBusy] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [deadFor, setDeadFor] = useState<Lead | null>(null);
  const [manual, setManual] = useState({ name: "", phone: "", email: "", propertyType: "", budget: "", remarks: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = `page=${page}&limit=${limit}&search=${encodeURIComponent(search)}&status=${filters.status || ""}&source=${filters.source || ""}`;
      const [r, s] = await Promise.all([api.request<any>(`/leads?${q}`), api.request<any>(`/leads/stats`).catch(() => null)]);
      setRows(r?.docs || []);
      setTotal(r?.total || 0);
      setStats(s);
    } catch (e: any) {
      toast.error(e.message || "Failed to load leads");
    } finally {
      setLoading(false);
    }
  }, [api, page, limit, search, filters]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    api.listOrgUsers().then(setDesigners).catch(() => {});
  }, [api]);

  const patch = async (id: string, body: any) => {
    try {
      await api.request(`/leads/${id}`, { method: "PATCH", body: JSON.stringify(body) });
      load();
    } catch (e: any) {
      toast.error(e.message || "Update failed");
    }
  };

  const createQuotationFromLead = async (lead: Lead) => {
    if (!organization?.id) return;
    setBusy(true);
    try {
      const q = defaultQuote();
      q.header.clientName = lead.name;
      q.header.contact = lead.phone || "";
      q.header.address = lead.location || "";
      q.header.remarks = [lead.propertyType, lead.propertyRooms, lead.budget].filter(Boolean).join(" · ");
      const doc = await api.createQuotation(organization.id, q);
      await api.request(`/leads/${lead.id}`, { method: "PATCH", body: JSON.stringify({ quotationId: doc.id, status: "converted" }) });
      router.push(`/portal/sales/quotations/id/${doc.id}`);
    } catch (e: any) {
      toast.error(e.message || "Could not create quotation");
      setBusy(false);
    }
  };

  const columns = useMemo(
    () => [
      {
        id: "lead",
        header: "Lead",
        cell: ({ row }: any) => {
          const l: Lead = row.original;
          return (
            <Box sx={{ minWidth: 180 }}>
              <Stack direction="row" spacing={0.75} alignItems="center">
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {l.name}
                </Typography>
                {l.phoneVerified && <Chip size="small" label="verified" color="success" variant="outlined" sx={{ height: 16, "& .MuiChip-label": { px: 0.5, fontSize: 9 } }} />}
              </Stack>
              <Typography variant="caption" sx={{ color: "text.secondary" }}>
                {[l.phone, l.email].filter(Boolean).join(" · ") || "no contact"}
              </Typography>
            </Box>
          );
        },
      },
      {
        id: "source",
        header: "Source",
        cell: ({ row }: any) => (
          <Box>
            <Chip size="small" variant="outlined" label={row.original.source.toUpperCase()} />
            {row.original.ref && (
              <Typography variant="caption" sx={{ display: "block", color: "text.disabled" }}>
                {row.original.ref}
              </Typography>
            )}
          </Box>
        ),
      },
      {
        id: "property",
        header: "Property · Budget",
        cell: ({ row }: any) => {
          const l: Lead = row.original;
          return (
            <Box sx={{ maxWidth: 220 }}>
              <Typography variant="body2">{[l.propertyType, l.propertyRooms].filter(Boolean).join(" · ") || "—"}</Typography>
              <Typography variant="caption" sx={{ color: "text.secondary" }}>
                {[l.location, l.budget].filter(Boolean).join(" · ")}
              </Typography>
            </Box>
          );
        },
      },
      {
        id: "received",
        header: "Received",
        cell: ({ row }: any) => {
          const l: Lead = row.original;
          const overdue = l.firstContactDeadline && ["unqualified"].includes(l.status) && new Date(l.firstContactDeadline).getTime() < Date.now();
          return (
            <Box>
              <Typography variant="body2">{moment(l.receivedAt).format("DD MMM")}</Typography>
              {l.firstContactDeadline && ["unqualified"].includes(l.status) && (
                <Chip size="small" color={overdue ? "error" : "warning"} variant="outlined" label={overdue ? "24h contact window missed" : `contact by ${moment(l.firstContactDeadline).format("DD MMM HH:mm")}`} sx={{ height: 18, "& .MuiChip-label": { fontSize: 9.5, px: 0.5 } }} />
              )}
            </Box>
          );
        },
      },
      {
        id: "assigned",
        header: "Designer",
        cell: ({ row }: any) => {
          const l: Lead = row.original;
          return (
            <Autocomplete
              size="small"
              options={designers}
              getOptionLabel={(o: any) => o.name}
              value={designers.find((d) => d.id === l.assignedToUserId) || (l.assignedToName ? ({ id: "", name: l.assignedToName } as any) : null)}
              isOptionEqualToValue={(a: any, b: any) => a?.id === b?.id}
              onChange={(_, v: any) => patch(l.id, { assignedToUserId: v?.id || null, assignedToName: v?.name || null, status: v && l.status === "unqualified" ? "engaging" : undefined })}
              renderInput={(p) => <TextField {...p} placeholder="Assign" variant="standard" InputProps={{ ...p.InputProps, disableUnderline: true, sx: { fontSize: 13 } }} />}
              sx={{ minWidth: 140 }}
            />
          );
        },
      },
      {
        id: "status",
        header: "Status",
        cell: ({ row }: any) => {
          const l: Lead = row.original;
          const s = statusOf(l.status);
          return (
            <TextField
              select
              size="small"
              value={l.status}
              onChange={(e) => {
                const next = e.target.value;
                if (next === "dead") setDeadFor(l); // proof of no reply is mandatory
                else if (next === "converted") createQuotationFromLead(l); // auto-creates + links the quotation
                else patch(l.id, { status: next });
              }}
              variant="standard"
              InputProps={{ disableUnderline: true }}
              sx={{ minWidth: 130 }}
            >
              {STATUS_OPTIONS.map((o) => (
                <MenuItem key={o.value} value={o.value}>
                  <Chip size="small" color={o.color} variant={o.value === l.status ? "filled" : "outlined"} label={o.label} sx={{ height: 20 }} />
                </MenuItem>
              ))}
            </TextField>
          );
        },
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }: any) => {
          const l: Lead = row.original;
          return (
            <Stack direction="row" spacing={0.25} justifyContent="flex-end">
              {l.phone && (
                <Tooltip title="WhatsApp the homeowner">
                  <IconButton size="small" href={`https://wa.me/${l.phone.startsWith("65") ? l.phone : `65${l.phone}`}`} target="_blank" rel="noreferrer" sx={{ color: "success.main" }}>
                    <WhatsAppIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
              <Tooltip title="Details">
                <IconButton size="small" onClick={() => setDetail(l)}>
                  <VisibilityIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              {l.quotationId ? (
                <Tooltip title="Open quotation">
                  <IconButton size="small" onClick={() => router.push(`/portal/sales/quotations/id/${l.quotationId}`)} sx={{ color: "primary.main" }}>
                    <DescriptionIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              ) : (
                <Tooltip title="Create quotation from this lead">
                  <span>
                    <IconButton size="small" disabled={busy} onClick={() => createQuotationFromLead(l)} sx={{ color: "text.secondary", "&:hover": { color: "primary.main" } }}>
                      <OpenInNewIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              )}
              <IconButton size="small" onClick={() => setToDelete(l)} sx={{ "&:hover": { color: "error.main" } }}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Stack>
          );
        },
      },
    ],
    [designers, busy, router],
  );

  const filterConfig: FilterField[] = useMemo(
    () => [
      { type: "select", key: "status", label: "Status", options: [{ value: "", label: "All" }, ...STATUS_OPTIONS.map((s) => ({ value: s.value, label: s.label }))] },
      { type: "select", key: "source", label: "Source", options: [{ value: "", label: "All" }, { value: "ezid", label: "EZiD" }, { value: "network", label: "Network" }, { value: "manual", label: "Manual" }] },
    ],
    [],
  );

  if (!flagsLoading && !isIdQuotationEnabled) return <Alert severity="info" sx={{ m: 3 }}>Leads are available for interior-design organisations.</Alert>;

  return (
    <MainCard>
      {stats && stats.total > 0 && (
        <Stack direction="row" spacing={1} sx={{ mb: 1.5, flexWrap: "wrap", rowGap: 1 }}>
          <Chip size="small" label={`${stats.total} leads`} />
          <Chip size="small" color="primary" variant="outlined" label={`${stats.byStatus?.unqualified || 0} unqualified`} />
          <Chip size="small" color="info" variant="outlined" label={`${stats.byStatus?.engaging || 0} engaging`} />
          <Chip size="small" color="success" variant="outlined" label={`${stats.byStatus?.converted || 0} converted${stats.convertedPct != null ? ` (${stats.convertedPct.toFixed(0)}%)` : ""}`} />
          <Chip size="small" color="error" variant="outlined" label={`${stats.byStatus?.dead || 0} dead`} />
          {(stats.perDesigner || []).slice(0, 4).map((d: any) => (
            <Tooltip key={d.name} title={`${d.taken} taken · ${d.signed} signed · ${d.dead} dead`}>
              <Chip size="small" variant="outlined" label={`${d.name}: ${d.signed}/${d.taken}`} />
            </Tooltip>
          ))}
        </Stack>
      )}
      <PageTable
        tableName="Leads"
        subTitle="EZiD and Network Singapore enquiries land here automatically from email"
        columns={columns as any}
        data={rows}
        loading={loading}
        page={page}
        limit={limit}
        search={search}
        filters={filters}
        setPage={setPage}
        setLimit={setLimit}
        setSearch={setSearch}
        setFilters={setFilters}
        filterConfig={filterConfig}
        pageCount={Math.max(1, Math.ceil(total / limit))}
        totalDocs={total}
        buttonName="New lead"
        onAddClick={() => {
          setManual({ name: "", phone: "", email: "", propertyType: "", budget: "", remarks: "" });
          setManualOpen(true);
        }}
      />

      {/* detail drawer */}
      <Drawer anchor="right" open={!!detail} onClose={() => setDetail(null)} PaperProps={{ sx: { width: { xs: "100%", sm: 460 }, p: 2.5 } }}>
        {detail && (
          <Stack spacing={1.5}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="h6" sx={{ fontWeight: 800, flex: 1 }}>
                {detail.name}
              </Typography>
              <Chip size="small" color={statusOf(detail.status).color} label={statusOf(detail.status).label} />
            </Stack>
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              {detail.source.toUpperCase()}
              {detail.ref ? ` · ${detail.ref}` : ""} · received {moment(detail.receivedAt).format("DD MMM YYYY HH:mm")}
              {detail.replacementDeadline ? ` · replacement window until ${moment(detail.replacementDeadline).format("DD MMM")}` : ""}
            </Typography>
            <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1.5 }}>
              <Grid container spacing={1}>
                {[
                  ["Phone", detail.phone ? `${detail.phone}${detail.phoneVerified ? " (verified)" : ""}` : null],
                  ["Email", detail.email],
                  ["Location", detail.location],
                  ["Property", [detail.propertyType, detail.propertyRooms, detail.propertyStatus].filter(Boolean).join(" · ")],
                  ["Budget", detail.budget],
                  ["Key collection", detail.keyCollection],
                  ["Move-in", detail.moveIn],
                  ["Areas", detail.areas],
                  ["Design style", detail.designStyle],
                ]
                  .filter(([, v]) => v)
                  .map(([k, v]) => (
                    <Grid item xs={12} key={k as string}>
                      <Typography variant="caption" sx={{ color: "text.secondary" }}>
                        {k}
                      </Typography>
                      <Typography variant="body2">{v}</Typography>
                    </Grid>
                  ))}
              </Grid>
            </Paper>
            {detail.remarks && (
              <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1.5 }}>
                <Typography variant="caption" sx={{ color: "text.secondary" }}>
                  Homeowner remarks
                </Typography>
                <Typography variant="body2" sx={{ whiteSpace: "pre-line" }}>
                  {detail.remarks}
                </Typography>
              </Paper>
            )}
            {detail.approachNotes && (
              <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1.5, bgcolor: "action.hover" }}>
                <Typography variant="caption" sx={{ color: "text.secondary" }}>
                  How to approach (concierge)
                </Typography>
                <Typography variant="body2" sx={{ whiteSpace: "pre-line" }}>
                  {detail.approachNotes}
                </Typography>
              </Paper>
            )}
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {detail.floorPlanUrl && (
                <Button size="small" variant="outlined" href={detail.floorPlanUrl} target="_blank" rel="noreferrer" sx={{ textTransform: "none" }}>
                  Floor plan
                </Button>
              )}
              {detail.deadProofUrl && (
                <Button size="small" variant="outlined" color="error" href={detail.deadProofUrl} target="_blank" rel="noreferrer" sx={{ textTransform: "none" }}>
                  No-reply proof
                </Button>
              )}
              {detail.attachmentUrl && (
                <Button size="small" variant="outlined" href={detail.attachmentUrl} target="_blank" rel="noreferrer" sx={{ textTransform: "none" }}>
                  Lead PDF
                </Button>
              )}
              {detail.phone && (
                <Button size="small" variant="contained" color="success" startIcon={<WhatsAppIcon />} href={`https://wa.me/${detail.phone.startsWith("65") ? detail.phone : `65${detail.phone}`}`} target="_blank" rel="noreferrer" sx={{ textTransform: "none" }}>
                  WhatsApp
                </Button>
              )}
              {!detail.quotationId && (
                <Button size="small" variant="contained" disabled={busy} onClick={() => createQuotationFromLead(detail)} sx={{ textTransform: "none" }}>
                  Create quotation
                </Button>
              )}
            </Stack>
          </Stack>
        )}
      </Drawer>

      {/* dead lead — mandatory no-reply proof */}
      <Dialog open={!!deadFor} onClose={() => setDeadFor(null)} fullWidth maxWidth="xs" PaperProps={{ sx: { borderRadius: 2 } }}>
        <DialogTitle>Mark lead as dead</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ color: "text.secondary", mb: 1.5 }}>
            Attach a screenshot showing the client never replied — this is the evidence for the replacement claim with {deadFor?.source === "network" ? "Network" : "EZiD"}. The lead is marked dead once the proof is uploaded.
          </Typography>
          <Button variant="outlined" component="label" fullWidth disabled={busy} sx={{ textTransform: "none" }}>
            {busy ? "Uploading…" : "Choose screenshot / PDF"}
            <input
              type="file"
              hidden
              accept="image/*,application/pdf"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f || !deadFor) return;
                setBusy(true);
                try {
                  const dataUrl: string = await new Promise((res, rej) => {
                    const r = new FileReader();
                    r.onload = () => res(String(r.result));
                    r.onerror = () => rej(new Error("Could not read file"));
                    r.readAsDataURL(f);
                  });
                  await api.request(`/leads/${deadFor.id}/dead-proof`, { method: "POST", body: JSON.stringify({ file: dataUrl, filename: f.name }) });
                  toast.success("Lead marked dead — proof attached");
                  setDeadFor(null);
                  load();
                } catch (err: any) {
                  toast.error(err.message || "Upload failed");
                } finally {
                  setBusy(false);
                }
              }}
            />
          </Button>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeadFor(null)}>Cancel</Button>
        </DialogActions>
      </Dialog>

      {/* manual lead */}
      <Dialog open={manualOpen} onClose={() => setManualOpen(false)} fullWidth maxWidth="sm" PaperProps={{ sx: { borderRadius: 2 } }}>
        <DialogTitle>New lead</DialogTitle>
        <DialogContent dividers>
          <Grid container spacing={1.5}>
            <Grid item xs={12}>
              <TextField label="Name" size="small" fullWidth value={manual.name} onChange={(e) => setManual({ ...manual, name: e.target.value })} />
            </Grid>
            <Grid item xs={6}>
              <TextField label="Phone" size="small" fullWidth value={manual.phone} onChange={(e) => setManual({ ...manual, phone: e.target.value })} />
            </Grid>
            <Grid item xs={6}>
              <TextField label="Email" size="small" fullWidth value={manual.email} onChange={(e) => setManual({ ...manual, email: e.target.value })} />
            </Grid>
            <Grid item xs={6}>
              <TextField label="Property type" size="small" fullWidth value={manual.propertyType} onChange={(e) => setManual({ ...manual, propertyType: e.target.value })} />
            </Grid>
            <Grid item xs={6}>
              <TextField label="Budget" size="small" fullWidth value={manual.budget} onChange={(e) => setManual({ ...manual, budget: e.target.value })} />
            </Grid>
            <Grid item xs={12}>
              <TextField label="Remarks" size="small" fullWidth multiline minRows={2} value={manual.remarks} onChange={(e) => setManual({ ...manual, remarks: e.target.value })} />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setManualOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={busy || !manual.name.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                await api.request(`/leads`, { method: "POST", body: JSON.stringify({ ...manual, phone: manual.phone.replace(/\D/g, "") || null, source: "manual" }) });
                setManualOpen(false);
                load();
              } catch (e: any) {
                toast.error(e.message || "Create failed");
              } finally {
                setBusy(false);
              }
            }}
          >
            Add
          </Button>
        </DialogActions>
      </Dialog>

      <DeleteItemDialogNoConfirm
        open={!!toDelete}
        onCancel={() => setToDelete(null)}
        loading={busy}
        onConfirm={async () => {
          if (!toDelete) return;
          setBusy(true);
          try {
            await api.request(`/leads/${toDelete.id}`, { method: "DELETE" });
            setToDelete(null);
            load();
          } catch (e: any) {
            toast.error(e.message || "Delete failed");
          } finally {
            setBusy(false);
          }
        }}
      />
    </MainCard>
  );
}
