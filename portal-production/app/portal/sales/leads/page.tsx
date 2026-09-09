"use client";

// Sales → Leads (interior-design orgs): every homeowner enquiry from EZiD /
// Network Singapore (auto-captured from email) or keyed manually. Designers
// are assigned inline, statuses follow the funnel (unqualified → engaging →
// dead | converted), and converting creates the lead's PROJECT — the
// quotation is then raised inside the project (Lead → Project → Quotation).

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

import DeleteIcon from "@mui/icons-material/DeleteOutline";
import DescriptionIcon from "@mui/icons-material/DescriptionOutlined";
import EditIcon from "@mui/icons-material/EditOutlined";
import WhatsAppIcon from "@mui/icons-material/WhatsApp";
import moment from "moment";
import { toast } from "react-toastify";
import MainCard from "@/components/MainCard";
import PageTable from "@/components/PageTable";
import { kebabColumn } from "@/components/RowKebab";
import DeleteItemDialogNoConfirm from "@/components/DeleteItemDialogNoConfirm";
import type { FilterField } from "@/components/FilterDrawer";
import { useOrganization } from "@hooks/useOrganization";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";
import { useIdQuoteApi } from "@/app/portal/sales/quotations/id/_lib/api";

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
  projectId: string | null;
  deadProofUrl: string | null;
  receivedAt: string;
  notes: string | null;
};

type LeadAttachment = {
  id: string;
  url: string;
  key: string;
  filename: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  kind: string | null;
  createdAt: string;
};

// unqualified → engaging → dead (proof required) | converted (auto-quotation)
const STATUS_OPTIONS: Array<{ value: string; label: string; color: "default" | "primary" | "info" | "success" | "warning" | "error" }> = [
  { value: "unqualified", label: "Unqualified", color: "primary" },
  { value: "engaging", label: "Engaging", color: "info" },
  { value: "dead", label: "Dead", color: "error" },
  { value: "converted", label: "Converted", color: "success" },
];
const statusOf = (v: string) => STATUS_OPTIONS.find((s) => s.value === v) || STATUS_OPTIONS[0];

// ezid | network are ingestion-only; manual | fb | ig are human-entered.
const SOURCE_OPTIONS = [
  { value: "ezid", label: "EZiD" },
  { value: "network", label: "Network" },
  { value: "manual", label: "Manual" },
  { value: "fb", label: "Facebook" },
  { value: "ig", label: "Instagram" },
];
const MANUAL_SOURCES = ["manual", "fb", "ig"];
const isManualSource = (s: string) => MANUAL_SOURCES.includes(s);

// Attachment upload — mirrors the server-side allow-list + size caps
// (leads.service.ts). Oversize files are blocked client-side BEFORE upload:
// main.ts caps the Express JSON body at 15mb, so a too-large base64 payload
// would otherwise fail with a bare 413.
const ATTACH_ACCEPT = "image/png,image/jpeg,image/webp,application/pdf,video/mp4,video/quicktime";
const ATTACH_MAX_IMAGE = 10 * 1048576; // images + PDF
// 10MB, NOT the server's 100MB video branch: base64 inflates ~33% and main.ts
// caps the Express JSON body at 15mb, so anything over ~11MB of real bytes 413s
// at the body parser before the server's validation runs. The server keeps its
// 100MB video ceiling, ready for a presigned/multipart transport later; until
// then this is the largest video the base64 JSON path can actually carry.
const ATTACH_MAX_VIDEO = 10 * 1048576; // video (transport-limited, see above)
const attachTooBig = (f: File) => (f.type.startsWith("video/") ? f.size > ATTACH_MAX_VIDEO : f.size > ATTACH_MAX_IMAGE);
const fmtBytes = (n: number | null) => (n == null ? "" : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const readAsDataURL = (f: File) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(new Error("Could not read file"));
    r.readAsDataURL(f);
  });

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
  const [manual, setManual] = useState({ name: "", phone: "", email: "", propertyType: "", budget: "", keyCollection: "", remarks: "" });
  const [attachments, setAttachments] = useState<LeadAttachment[]>([]);
  const [attBusy, setAttBusy] = useState(false);
  const [editFor, setEditFor] = useState<Lead | null>(null);
  const [edit, setEdit] = useState<any>(null);

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

  // Attachments load with the detail drawer (GET /leads/:id returns them).
  useEffect(() => {
    if (!detail) {
      setAttachments([]);
      return;
    }
    api
      .request<any>(`/leads/${detail.id}`)
      .then((r) => setAttachments(r?.attachments || []))
      .catch(() => setAttachments([]));
  }, [detail, api]);

  // Upload one-by-one (a 100MB video over base64 is not instant; sequential
  // keeps each request small and lets the busy state track progress).
  const uploadAttachments = async (files: FileList) => {
    if (!detail || !files.length) return;
    setAttBusy(true);
    try {
      let latest: LeadAttachment[] = attachments;
      for (const f of Array.from(files)) {
        // Block oversize before upload (the server enforces the same caps).
        if (attachTooBig(f)) {
          toast.error(`${f.name} is ${(f.size / 1048576).toFixed(1)}MB — ${f.type.startsWith("video/") ? "video files over 10MB are not supported yet" : "max 10MB for images and PDF"}`);
          continue;
        }
        const dataUrl = await readAsDataURL(f);
        latest = await api.request<any>(`/leads/${detail.id}/attachments`, { method: "POST", body: JSON.stringify({ file: dataUrl, filename: f.name }) });
      }
      setAttachments(latest || []);
      toast.success("Attachment uploaded");
    } catch (e: any) {
      toast.error(e.message || "Upload failed");
    } finally {
      setAttBusy(false);
    }
  };

  const deleteAttachment = async (id: string) => {
    if (!detail) return;
    setAttBusy(true);
    try {
      const list = await api.request<any>(`/leads/${detail.id}/attachments/${id}`, { method: "DELETE" });
      setAttachments(list || []);
    } catch (e: any) {
      toast.error(e.message || "Delete failed");
    } finally {
      setAttBusy(false);
    }
  };

  const openEdit = (l: Lead) => {
    setEdit({
      ref: l.ref || "", name: l.name || "", email: l.email || "", phone: l.phone || "", location: l.location || "",
      propertyType: l.propertyType || "", propertyRooms: l.propertyRooms || "", propertyStatus: l.propertyStatus || "",
      keyCollection: l.keyCollection || "", moveIn: l.moveIn || "", budget: l.budget || "", areas: l.areas || "",
      designStyle: l.designStyle || "", remarks: l.remarks || "", approachNotes: l.approachNotes || "", notes: l.notes || "",
      source: l.source,
    });
    setEditFor(l);
  };

  const saveEdit = async () => {
    if (!editFor || !edit?.name?.trim()) return;
    setBusy(true);
    try {
      const payload: any = { ...edit, name: edit.name.trim() };
      // Source is only editable on a manual-ish lead; never send it for an
      // email-ingested lead (the server rejects it too).
      if (!isManualSource(editFor.source)) delete payload.source;
      // Empty strings → null so a cleared field actually clears.
      Object.keys(payload).forEach((k) => {
        if (k !== "name" && payload[k] === "") payload[k] = null;
      });
      await api.request(`/leads/${editFor.id}`, { method: "PATCH", body: JSON.stringify(payload) });
      toast.success("Lead updated");
      setEditFor(null);
      if (detail?.id === editFor.id) setDetail({ ...detail, ...payload });
      load();
    } catch (e: any) {
      toast.error(e.message || "Update failed");
    } finally {
      setBusy(false);
    }
  };

  // Lead → Project → Quotation (CIEL 09-01): converting a lead creates its
  // PROJECT (tagged source=lead, designer from the assignment); the quotation
  // is raised from the project page and signs onto that same project.
  const convertLeadToProject = async (lead: Lead) => {
    setBusy(true);
    try {
      const r = await api.request<{ projectId: string; name: string; created: boolean }>(`/id-projects`, { method: "POST", body: JSON.stringify({ leadId: lead.id, source: "lead" }) });
      toast.success(r.created ? `Project "${r.name}" created — raise the quotation from the project page` : `Lead already has project "${r.name}"`);
      router.push(`/portal/projects/${r.projectId}`);
    } catch (e: any) {
      toast.error(e.message || "Could not create the project");
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
            <Box onClick={(e) => e.stopPropagation()}>
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
            </Box>
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
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => {
                const next = e.target.value;
                if (next === "dead") setDeadFor(l); // proof of no reply is mandatory
                else if (next === "converted") convertLeadToProject(l); // creates + links the project (quotation comes next, from the project)
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
      kebabColumn((l: Lead) => [
        ...(l.phone
          ? [{
              label: "WhatsApp",
              onClick: () => window.open(`https://wa.me/${l.phone!.startsWith("65") ? l.phone : `65${l.phone}`}`, "_blank", "noopener,noreferrer"),
            }]
          : []),
        { label: "Details", onClick: () => setDetail(l) },
        ...(l.projectId
          ? [{ label: "Open project", onClick: () => router.push(`/portal/projects/${l.projectId}`) }]
          : l.quotationId
          ? [{ label: "Open quotation", onClick: () => router.push(`/portal/sales/quotations/id/${l.quotationId}`) }]
          : [{ label: "Create project", disabled: busy, onClick: () => convertLeadToProject(l) }]),
        { label: "Edit", onClick: () => openEdit(l) },
        { label: "Delete", destructive: true, onClick: () => setToDelete(l) },
      ]),
    ],
    [designers, busy, router],
  );

  const filterConfig: FilterField[] = useMemo(
    () => [
      { type: "select", key: "status", label: "Status", options: [{ value: "", label: "All" }, ...STATUS_OPTIONS.map((s) => ({ value: s.value, label: s.label }))] },
      { type: "select", key: "source", label: "Source", options: [{ value: "", label: "All" }, ...SOURCE_OPTIONS] },
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
        onRowClick={(l: Lead) => setDetail(l)}
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
          setManual({ name: "", phone: "", email: "", propertyType: "", budget: "", keyCollection: "", remarks: "" });
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
              <Button size="small" variant="outlined" startIcon={<EditIcon />} onClick={() => openEdit(detail)} sx={{ textTransform: "none" }}>
                Edit
              </Button>
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
              {!detail.projectId && !detail.quotationId && (
                <Button size="small" variant="contained" disabled={busy} onClick={() => convertLeadToProject(detail)} sx={{ textTransform: "none" }}>
                  Create project
                </Button>
              )}
            </Stack>

            {/* Attachments — floor plans, photos, videos, other docs. */}
            <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1.5 }}>
              <Stack direction="row" alignItems="center" sx={{ mb: attachments.length ? 1 : 0.5 }}>
                <Typography variant="caption" sx={{ color: "text.secondary", flex: 1 }}>
                  Attachments
                </Typography>
                <Button size="small" component="label" variant="outlined" disabled={attBusy} sx={{ textTransform: "none" }}>
                  {attBusy ? "Uploading…" : "Upload"}
                  <input
                    hidden
                    type="file"
                    multiple
                    accept={ATTACH_ACCEPT}
                    onChange={(e) => {
                      if (e.target.files?.length) uploadAttachments(e.target.files);
                      e.target.value = "";
                    }}
                  />
                </Button>
              </Stack>
              {attachments.length === 0 ? (
                <Typography variant="body2" sx={{ color: "text.disabled" }}>
                  None yet. Accepts images, PDF and video (MP4/MOV).
                </Typography>
              ) : (
                <Stack spacing={1}>
                  {attachments.map((a) => (
                    <Box key={a.id} sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                      {a.mimeType?.startsWith("image/") ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={a.url} alt={a.filename || ""} style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 4, cursor: "pointer", flexShrink: 0 }} onClick={() => window.open(a.url, "_blank")} />
                      ) : a.mimeType?.startsWith("video/") ? (
                        <video src={a.url} controls style={{ width: 120, borderRadius: 4, flexShrink: 0 }} />
                      ) : (
                        <DescriptionIcon sx={{ color: "text.secondary", flexShrink: 0 }} />
                      )}
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="body2" noWrap sx={{ cursor: "pointer", "&:hover": { textDecoration: "underline" } }} onClick={() => window.open(a.url, "_blank")}>
                          {a.filename || a.kind || "file"}
                        </Typography>
                        <Typography variant="caption" sx={{ color: "text.secondary" }}>
                          {[a.kind, fmtBytes(a.sizeBytes)].filter(Boolean).join(" · ")}
                        </Typography>
                      </Box>
                      <IconButton size="small" disabled={attBusy} onClick={() => deleteAttachment(a.id)} sx={{ "&:hover": { color: "error.main" } }}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Box>
                  ))}
                </Stack>
              )}
            </Paper>
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
            <Grid item xs={6}>
              <TextField label="Est. key collection" type="date" size="small" fullWidth InputLabelProps={{ shrink: true }} value={manual.keyCollection} onChange={(e) => setManual({ ...manual, keyCollection: e.target.value })} />
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
                await api.request(`/leads`, { method: "POST", body: JSON.stringify({ ...manual, phone: manual.phone.replace(/\D/g, "") || null, keyCollection: manual.keyCollection || null, source: "manual" }) });
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

      {/* edit lead — every whitelisted human-set field; available in any status */}
      <Dialog open={!!editFor} onClose={() => setEditFor(null)} fullWidth maxWidth="sm" PaperProps={{ sx: { borderRadius: 2 } }}>
        <DialogTitle>Edit lead</DialogTitle>
        <DialogContent dividers>
          {edit && editFor && (
            <Grid container spacing={1.5}>
              <Grid item xs={12} sm={6}>
                <TextField label="Name" size="small" fullWidth value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  select
                  label="Source"
                  size="small"
                  fullWidth
                  value={edit.source}
                  disabled={!isManualSource(editFor.source)}
                  helperText={!isManualSource(editFor.source) ? "Set by email ingestion — not editable" : undefined}
                  onChange={(e) => setEdit({ ...edit, source: e.target.value })}
                >
                  {(isManualSource(editFor.source) ? SOURCE_OPTIONS.filter((o) => MANUAL_SOURCES.includes(o.value)) : SOURCE_OPTIONS.filter((o) => o.value === editFor.source)).map((o) => (
                    <MenuItem key={o.value} value={o.value}>
                      {o.label}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField label="Ref" size="small" fullWidth value={edit.ref} onChange={(e) => setEdit({ ...edit, ref: e.target.value })} />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField label="Phone" size="small" fullWidth value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField label="Email" size="small" fullWidth value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField label="Location" size="small" fullWidth value={edit.location} onChange={(e) => setEdit({ ...edit, location: e.target.value })} />
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField label="Property type" size="small" fullWidth value={edit.propertyType} onChange={(e) => setEdit({ ...edit, propertyType: e.target.value })} />
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField label="Rooms" size="small" fullWidth value={edit.propertyRooms} onChange={(e) => setEdit({ ...edit, propertyRooms: e.target.value })} />
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField label="Property status" size="small" fullWidth value={edit.propertyStatus} onChange={(e) => setEdit({ ...edit, propertyStatus: e.target.value })} />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField label="Est. key collection" type="date" size="small" fullWidth InputLabelProps={{ shrink: true }} value={edit.keyCollection} onChange={(e) => setEdit({ ...edit, keyCollection: e.target.value })} />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField label="Move-in" size="small" fullWidth value={edit.moveIn} onChange={(e) => setEdit({ ...edit, moveIn: e.target.value })} />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField label="Budget" size="small" fullWidth value={edit.budget} onChange={(e) => setEdit({ ...edit, budget: e.target.value })} />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField label="Design style" size="small" fullWidth value={edit.designStyle} onChange={(e) => setEdit({ ...edit, designStyle: e.target.value })} />
              </Grid>
              <Grid item xs={12}>
                <TextField label="Areas to renovate" size="small" fullWidth value={edit.areas} onChange={(e) => setEdit({ ...edit, areas: e.target.value })} />
              </Grid>
              <Grid item xs={12}>
                <TextField label="Homeowner remarks" size="small" fullWidth multiline minRows={2} value={edit.remarks} onChange={(e) => setEdit({ ...edit, remarks: e.target.value })} />
              </Grid>
              <Grid item xs={12}>
                <TextField label="How to approach (concierge)" size="small" fullWidth multiline minRows={2} value={edit.approachNotes} onChange={(e) => setEdit({ ...edit, approachNotes: e.target.value })} />
              </Grid>
              <Grid item xs={12}>
                <TextField label="Internal notes" size="small" fullWidth multiline minRows={2} value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} />
              </Grid>
            </Grid>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditFor(null)}>Cancel</Button>
          <Button variant="contained" disabled={busy || !edit?.name?.trim()} onClick={saveEdit}>
            Save
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
