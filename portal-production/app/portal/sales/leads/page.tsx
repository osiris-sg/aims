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
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";

import DeleteIcon from "@mui/icons-material/DeleteOutline";
import DescriptionIcon from "@mui/icons-material/DescriptionOutlined";
import EditIcon from "@mui/icons-material/EditOutlined";
import AddIcon from "@mui/icons-material/Add";
import CloseIcon from "@mui/icons-material/Close";
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
import { useUserPermissions } from "@/app/portal/hooks/useUserPermissions";
import { useIdQuoteApi } from "@/app/portal/sales/quotations/id/_lib/api";

type Lead = {
  id: string;
  source: string;
  ref: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  whatsappPhone: string | null;
  phones?: string[] | null;
  phoneVerified: boolean;
  location: string | null;
  propertyType: string | null;
  propertyRooms: string | null;
  propertyStatus: string | null;
  keyCollection: string | null;
  keyCollectionDate: string | null;
  appointmentAt: string | null;
  appointmentNote: string | null;
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
  { value: "referral", label: "Referral" },
  { value: "fb", label: "Facebook" },
  { value: "ig", label: "Instagram" },
];
// Sources a user can pick when keying/editing a lead by hand (email sources
// stay ingestion-only).
const MANUAL_SOURCE_OPTIONS = SOURCE_OPTIONS.filter((s) => ["manual", "referral", "fb", "ig"].includes(s.value));
const MANUAL_SOURCES = ["manual", "referral", "fb", "ig"];
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

// Manager-only lead insights (guru 2026-09-16): where the leads come from and
// how each channel performs. Designers never receive `insights` from the API,
// so the panel simply doesn't render for them.
// Country codes for the phone fields (guru 2026-09-21). Storage convention:
// +65 numbers are kept as bare 8-digit locals (everything downstream adds 65),
// any other code is stored WITH its prefix so wa.me links dial correctly.
const PHONE_CCS = [
  { code: "65", label: "🇸🇬 +65" },
  { code: "60", label: "🇲🇾 +60" },
  { code: "62", label: "🇮🇩 +62" },
  { code: "63", label: "🇵🇭 +63" },
  { code: "66", label: "🇹🇭 +66" },
  { code: "86", label: "🇨🇳 +86" },
  { code: "91", label: "🇮🇳 +91" },
];
const splitCc = (v: string): { cc: string; local: string } => {
  const d = String(v || "").replace(/\D/g, "");
  if (d.startsWith("65") && d.length > 8) return { cc: "65", local: d.slice(2) };
  const hit = PHONE_CCS.find((c) => c.code !== "65" && d.startsWith(c.code) && d.length > 8);
  return hit ? { cc: hit.code, local: d.slice(hit.code.length) } : { cc: "65", local: d };
};
const joinCc = (cc: string, local: string) => {
  const d = local.replace(/\D/g, "");
  return d ? (cc === "65" ? d : cc + d) : "";
};

function PhoneInput({ label, value, onChange, onRemove }: { label: string; value: string; onChange: (v: string) => void; onRemove?: () => void }) {
  const { cc, local } = splitCc(value);
  return (
    <TextField
      label={label}
      size="small"
      fullWidth
      value={local}
      onChange={(e) => onChange(joinCc(cc, e.target.value))}
      InputProps={{
        startAdornment: (
          <TextField
            select
            variant="standard"
            value={cc}
            onChange={(e) => onChange(joinCc(e.target.value, local))}
            InputProps={{ disableUnderline: true }}
            sx={{ mr: 0.75, minWidth: 74, "& .MuiSelect-select": { fontSize: 13, py: 0.25 } }}
          >
            {PHONE_CCS.map((c) => (
              <MenuItem key={c.code} value={c.code}>{c.label}</MenuItem>
            ))}
          </TextField>
        ),
        endAdornment: onRemove ? (
          <IconButton size="small" onClick={onRemove} aria-label="Remove number">
            <CloseIcon fontSize="inherit" />
          </IconButton>
        ) : undefined,
      }}
    />
  );
}

// Key collection is a date OR a state (guru/Junrong 2026-09-24): TBC while
// the client doesn't know, "Keys collected" once they have them.
const KEY_MODES = [
  { value: "date", label: "Pick a date" },
  { value: "TBC", label: "TBC" },
  { value: "Keys collected", label: "Keys collected" },
];
const keyModeOf = (v: string) => (v === "TBC" || v === "Keys collected" ? v : "date");
const PROPERTY_STATUS_OPTIONS = ["New flat", "Resale"];

/** wa.me-ready number: locals get 65, anything already carrying a code passes through. */
const waNumber = (n: string) => (n.startsWith("65") || n.length > 8 ? n : `65${n}`);

/** Every distinct number on a lead, WA-preferred first (leads can hold any count). */
const leadNumbers = (l: { phone?: string | null; whatsappPhone?: string | null; phones?: string[] | null }): string[] =>
  Array.from(new Set([l.whatsappPhone, l.phone, ...(l.phones || [])].map((v) => String(v || "").replace(/\D/g, "")).filter(Boolean)));

const SRC_LABEL: Record<string, string> = { ezid: "EZiD", network: "Network SG", whatsapp: "WhatsApp", manual: "Manual", referral: "Referral", fb: "Facebook", ig: "Instagram" };
const SRC_COLOR: Record<string, string> = { ezid: "primary.main", network: "warning.main", whatsapp: "success.main", manual: "text.disabled", referral: "error.main", fb: "info.main", ig: "secondary.main" };

function LeadInsights({ stats }: { stats: any }) {
  const ins = stats.insights;
  const maxMonth = Math.max(1, ...ins.monthly.map((m: any) => m.total));
  const delta = ins.thisMonth - ins.lastMonth;
  const kpis: Array<[string, React.ReactNode, string?]> = [
    ["Total leads", stats.total],
    ["This month", <>{ins.thisMonth}{ins.lastMonth > 0 || ins.thisMonth > 0 ? <Typography component="span" variant="caption" sx={{ ml: 0.5, color: delta >= 0 ? "success.main" : "error.main" }}>{delta >= 0 ? "+" : ""}{delta} vs last</Typography> : null}</>],
    ["Conversion", stats.convertedPct != null ? `${stats.convertedPct.toFixed(0)}%` : "—", "signed / all leads"],
    ["Dead", stats.deadPct != null ? `${stats.deadPct.toFixed(0)}%` : "—"],
    ["Avg first contact", ins.avgFirstContactHours != null ? (ins.avgFirstContactHours < 48 ? `${ins.avgFirstContactHours.toFixed(1)}h` : `${(ins.avgFirstContactHours / 24).toFixed(1)}d`) : "—", ins.contactedCount ? `across ${ins.contactedCount} contacted` : "no contact stamps yet"],
  ];
  return (
    <Grid container spacing={1.5} sx={{ mb: 2 }} data-tour="leads-insights">
      {kpis.map(([label, value, hint]) => (
        <Grid item xs={6} sm={4} md={2.4} key={label as string}>
          <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 2, height: "100%" }}>
            <Typography variant="overline" sx={{ color: "text.secondary", lineHeight: 1.4 }}>{label}</Typography>
            <Typography variant="h6" sx={{ fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{value}</Typography>
            {hint && <Typography variant="caption" sx={{ color: "text.secondary" }}>{hint}</Typography>}
          </Paper>
        </Grid>
      ))}
      <Grid item xs={12} md={7}>
        <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, height: "100%" }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Where leads come from</Typography>
          <Stack spacing={1}>
            {ins.bySource.map((s: any) => (
              <Box key={s.source}>
                {/* Phone: stats caption wraps under the bar instead of squeezing it out */}
                <Stack direction="row" alignItems="center" spacing={1} sx={{ flexWrap: { xs: "wrap", md: "nowrap" }, rowGap: 0.25 }}>
                  <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: SRC_COLOR[s.source] || "text.disabled", flexShrink: 0 }} />
                  <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 92 }}>{SRC_LABEL[s.source] || s.source}</Typography>
                  <Box sx={{ flex: 1, minWidth: { xs: 80, md: 0 } }}>
                    <LinearProgress variant="determinate" value={s.share} sx={{ height: 8, borderRadius: 4, "& .MuiLinearProgress-bar": { bgcolor: SRC_COLOR[s.source] || "text.disabled" }, bgcolor: "action.hover" }} />
                  </Box>
                  <Typography variant="caption" sx={{ fontVariantNumeric: "tabular-nums", minWidth: { xs: 0, md: 148 }, textAlign: "right", color: "text.secondary" }}>
                    {s.total} · {s.share.toFixed(0)}% share · {s.converted} signed ({s.convertedPct.toFixed(0)}%){s.dead ? ` · ${s.dead} dead` : ""}
                  </Typography>
                </Stack>
              </Box>
            ))}
          </Stack>
        </Paper>
      </Grid>
      <Grid item xs={12} md={5}>
        <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, height: "100%" }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Last 6 months</Typography>
          <Stack direction="row" spacing={1} alignItems="flex-end" sx={{ height: 110 }}>
            {ins.monthly.map((m: any) => (
              <Tooltip key={m.month} title={`${m.total} lead${m.total === 1 ? "" : "s"}${Object.entries(m.bySource).map(([s, n]) => ` · ${SRC_LABEL[s] || s} ${n}`).join("")}`}>
                <Stack sx={{ flex: 1, height: "100%", cursor: "default" }} justifyContent="flex-end" alignItems="stretch">
                  <Typography variant="caption" sx={{ textAlign: "center", color: "text.secondary", fontVariantNumeric: "tabular-nums" }}>{m.total || ""}</Typography>
                  <Stack sx={{ height: `${(m.total / maxMonth) * 78}%`, minHeight: m.total ? 4 : 0, borderRadius: 0.75, overflow: "hidden" }}>
                    {Object.entries(m.bySource).map(([s, n]: any) => (
                      <Box key={s} sx={{ flex: n, bgcolor: SRC_COLOR[s] || "text.disabled" }} />
                    ))}
                  </Stack>
                  <Typography variant="caption" sx={{ textAlign: "center", color: "text.secondary", pt: 0.25 }}>
                    {new Date(m.month + "-01T00:00:00").toLocaleDateString("en-SG", { month: "short" })}
                  </Typography>
                </Stack>
              </Tooltip>
            ))}
          </Stack>
        </Paper>
      </Grid>
    </Grid>
  );
}

export default function LeadsPage() {
  const router = useRouter();
  const api = useIdQuoteApi();
  const theme = useTheme();
  // Phone: content-heavy dialogs go full-screen below sm
  const fullScreenDialog = useMediaQuery(theme.breakpoints.down("sm"));
  const { organization } = useOrganization();
  const { isIdQuotationEnabled, isLoading: flagsLoading } = useOrganizationFeatures();
  // A user whose ONLY role is Designer works the funnel read-mostly: status
  // changes on their own leads, no assigning/editing/deleting (backend
  // enforces the same in leads.service update/remove).
  const { userRoles } = useUserPermissions();
  const designerOnly = userRoles.length > 0 && userRoles.every((r: any) => r?.name === "Designer");
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
  // Duplicate warning before creating (guru/Mike 2026-09-25): matches by name
  // or any phone number; the user decides to proceed or abort.
  const [dupWarn, setDupWarn] = useState<any[] | null>(null);
  // Set-appointment dialog (guru/Mike 2026-09-25): lands on the dashboard calendar.
  const [apptFor, setApptFor] = useState<Lead | null>(null);
  const [appt, setAppt] = useState({ at: "", note: "" });
  const [manual, setManual] = useState<{ name: string; phones: string[]; email: string; propertyType: string; propertyStatus: string; budget: string; keyCollection: string; remarks: string; source: string }>({ name: "", phones: [""], email: "", propertyType: "", propertyStatus: "", budget: "", keyCollection: "", remarks: "", source: "manual" });
  const [attachments, setAttachments] = useState<LeadAttachment[]>([]);
  const [attBusy, setAttBusy] = useState(false);
  const [editFor, setEditFor] = useState<Lead | null>(null);
  const [edit, setEdit] = useState<any>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = `page=${page}&limit=${limit}&search=${encodeURIComponent(search)}&status=${filters.status || ""}&source=${filters.source || ""}&assignedToUserId=${filters.assignedToUserId || ""}`;
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
  // Junior Managers may only assign within their own team — trim the picker
  // to the team the server reports (it rejects out-of-team assigns anyway).
  const teamUserIds: string[] | null = stats?.viewer?.teamUserIds || null;
  const assignableDesigners = useMemo(
    () => (teamUserIds ? designers.filter((d) => teamUserIds.includes(d.id)) : designers),
    [designers, teamUserIds]
  );

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
      ref: l.ref || "", name: l.name || "", email: l.email || "", phones: (leadNumbers(l).length ? leadNumbers(l) : [""]) as string[], location: l.location || "",
      propertyType: l.propertyType || "", propertyRooms: l.propertyRooms || "", propertyStatus: l.propertyStatus || "",
      keyCollection: l.keyCollection || "", moveIn: l.moveIn || "", budget: l.budget || "", areas: l.areas || "",
      designStyle: l.designStyle || "", remarks: l.remarks || "", approachNotes: l.approachNotes || "", notes: l.notes || "",
      source: l.source,
    });
    setEditFor(l);
  };

  const submitManualLead = async () => {
    const phones = Array.from(new Set(manual.phones.map((v) => v.replace(/\D/g, "")).filter(Boolean)));
    await api.request(`/leads`, {
      method: "POST",
      body: JSON.stringify({ ...manual, phones, phone: phones[0] || null, whatsappPhone: phones[1] || null, keyCollection: manual.keyCollection || null, source: manual.source || "manual" }),
    });
    setManualOpen(false);
    setDupWarn(null);
    load();
  };

  const saveEdit = async () => {
    if (!editFor || !edit?.name?.trim()) return;
    setBusy(true);
    try {
      const payload: any = { ...edit, name: edit.name.trim() };
      // Normalize the number list and keep the legacy phone/whatsappPhone
      // mirrors (first/second) in step for older code paths.
      const phones = Array.from(new Set((edit.phones as string[]).map((v) => v.replace(/\D/g, "")).filter(Boolean)));
      payload.phones = phones;
      payload.phone = phones[0] || null;
      payload.whatsappPhone = phones[1] || null;
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
      // A referral lead converts into a REFERRAL project (commission rules may
      // differ, e.g. SK's 60%); every other source stays "lead".
      const r = await api.request<{ projectId: string; name: string; created: boolean }>(`/id-projects`, { method: "POST", body: JSON.stringify({ leadId: lead.id, source: lead.source === "referral" ? "referral" : "lead" }) });
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
                {[...leadNumbers(l), l.email].filter(Boolean).join(" · ") || "no contact"}
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
              {designerOnly ? (
                // Designers can't re-assign — the name is read-only for them.
                <Typography variant="body2" sx={{ color: l.assignedToName ? "text.primary" : "text.disabled" }}>{l.assignedToName || "—"}</Typography>
              ) : (
                <Autocomplete
                  size="small"
                  options={assignableDesigners}
                  getOptionLabel={(o: any) => `${o.name}${o.isLeader && !o.isDesigner ? " · team leader" : ""}`}
                  value={designers.find((d) => d.id === l.assignedToUserId) || (l.assignedToName ? ({ id: "", name: l.assignedToName } as any) : null)}
                  isOptionEqualToValue={(a: any, b: any) => a?.id === b?.id}
                  onChange={(_, v: any) => patch(l.id, { assignedToUserId: v?.id || null, assignedToName: v?.name || null, status: v && l.status === "unqualified" ? "engaging" : undefined })}
                  renderInput={(p) => <TextField {...p} placeholder="Assign" variant="standard" InputProps={{ ...p.InputProps, disableUnderline: true, sx: { fontSize: 13 } }} />}
                  sx={{ minWidth: 140 }}
                />
              )}
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
        // One entry per distinct number — a lead can hold any count and the
        // client can be WhatsApped on any of them (guru 2026-09-21).
        ...leadNumbers(l).map((n, i, arr) => ({
          label: arr.length > 1 ? `WhatsApp ${n}` : "WhatsApp",
          onClick: () => {
            window.open(`https://wa.me/${waNumber(n)}`, "_blank", "noopener,noreferrer");
          },
        })),
        { label: "Details", onClick: () => setDetail(l) },
        ...(l.projectId
          ? [{ label: "Open project", onClick: () => router.push(`/portal/projects/${l.projectId}`) }]
          : l.quotationId
          ? [{ label: "Open quotation", onClick: () => router.push(`/portal/sales/quotations/id/${l.quotationId}`) }]
          : [{ label: "Create project", disabled: busy, onClick: () => convertLeadToProject(l) }]),
        // Designers work the funnel only: no editing the captured details, no
        // deleting — status (and its dead-proof/convert flows) is theirs.
        ...(designerOnly
          ? []
          : [
              { label: "Edit", onClick: () => openEdit(l) },
              { label: "Delete", destructive: true, onClick: () => setToDelete(l) },
            ]),
      ]),
    ],
    [designers, assignableDesigners, busy, router, designerOnly],
  );

  const filterConfig: FilterField[] = useMemo(
    () => [
      { type: "select", key: "status", label: "Status", options: [{ value: "", label: "All" }, ...STATUS_OPTIONS.map((s) => ({ value: s.value, label: s.label }))] },
      { type: "select", key: "source", label: "Source", options: [{ value: "", label: "All" }, ...SOURCE_OPTIONS] },
      { type: "select", key: "assignedToUserId", label: "Designer", options: [{ value: "", label: "All" }, ...designers.map((d) => ({ value: d.id, label: d.name }))] },
    ],
    [designers],
  );

  if (!flagsLoading && !isIdQuotationEnabled) return <Alert severity="info" sx={{ m: 3 }}>Leads are available for interior-design organisations.</Alert>;

  return (
    <MainCard>
      {stats?.insights && stats.total > 0 && <LeadInsights stats={stats} />}
      {stats && stats.total > 0 && (
        // Every chip is a FILTER: click a status or designer to filter the
        // table to it (click again — or "N leads" — to clear).
        <Stack direction="row" spacing={1} sx={{ mb: 1.5, flexWrap: "wrap", rowGap: 1 }}>
          <Chip
            size="small"
            variant={!filters.status && !filters.assignedToUserId ? "filled" : "outlined"}
            label={`${stats.total} leads`}
            onClick={() => { setFilters({}); setPage(1); }}
          />
          {([
            ["unqualified", "primary", `${stats.byStatus?.unqualified || 0} unqualified`],
            ["engaging", "info", `${stats.byStatus?.engaging || 0} engaging`],
            ["converted", "success", `${stats.byStatus?.converted || 0} converted${stats.convertedPct != null ? ` (${stats.convertedPct.toFixed(0)}%)` : ""}`],
            ["dead", "error", `${stats.byStatus?.dead || 0} dead`],
          ] as const).map(([value, color, label]) => (
            <Chip
              key={value}
              size="small"
              color={color as any}
              variant={filters.status === value ? "filled" : "outlined"}
              label={label}
              onClick={() => { setFilters({ ...filters, status: filters.status === value ? "" : value }); setPage(1); }}
            />
          ))}
          {(stats.perDesigner || []).slice(0, 4).map((d: any) => (
            <Tooltip key={d.userId || d.name} title={`${d.taken} taken · ${d.signed} signed · ${d.dead} dead${d.userId ? " — click to filter" : ""}`}>
              <Chip
                size="small"
                variant={d.userId && filters.assignedToUserId === d.userId ? "filled" : "outlined"}
                color={d.userId && filters.assignedToUserId === d.userId ? "primary" : "default"}
                label={`${d.name}: ${d.signed}/${d.taken}`}
                onClick={d.userId ? () => { setFilters({ ...filters, assignedToUserId: filters.assignedToUserId === d.userId ? "" : d.userId }); setPage(1); } : undefined}
              />
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
          setManual({ name: "", phones: [""], email: "", propertyType: "", propertyStatus: "", budget: "", keyCollection: "", remarks: "", source: "manual" });
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
                  ["Other numbers", leadNumbers(detail).slice(1).join(" · ") || null],
                  ["Email", detail.email],
                  ["Location", detail.location],
                  ["Property", [detail.propertyType, detail.propertyRooms, detail.propertyStatus].filter(Boolean).join(" · ")],
                  ["Budget", detail.budget],
                  ["Key collection", detail.keyCollection],
                  ["Key collection date", detail.keyCollectionDate ? new Date(detail.keyCollectionDate).toLocaleDateString("en-SG", { day: "2-digit", month: "short", year: "numeric" }) : null],
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
              {leadNumbers(detail).map((n, i, arr) => (
                <Button
                  key={n}
                  size="small"
                  variant="contained"
                  color="success"
                  startIcon={<WhatsAppIcon />}
                  href={`https://wa.me/${waNumber(n)}`}
                  target="_blank"
                  rel="noreferrer"
                  sx={{ textTransform: "none" }}
                >
                  {arr.length > 1 ? `WhatsApp ${n}` : "WhatsApp"}
                </Button>
              ))}
              {!detail.projectId && !detail.quotationId && (
                <Button size="small" variant="contained" disabled={busy} onClick={() => convertLeadToProject(detail)} sx={{ textTransform: "none" }}>
                  Create project
                </Button>
              )}
              <Button
                size="small"
                variant="outlined"
                sx={{ textTransform: "none" }}
                onClick={() => {
                  setAppt({
                    at: detail.appointmentAt ? moment(detail.appointmentAt).format("YYYY-MM-DDTHH:mm") : "",
                    note: detail.appointmentNote || "",
                  });
                  setApptFor(detail);
                }}
                data-tour="lead-set-appointment"
              >
                {detail.appointmentAt ? `Appt: ${moment(detail.appointmentAt).format("DD MMM HH:mm")}` : "Set appointment"}
              </Button>
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
      <Dialog open={manualOpen} onClose={() => setManualOpen(false)} fullWidth maxWidth="sm" fullScreen={fullScreenDialog} PaperProps={{ sx: { borderRadius: { sm: 2 } } }}>
        <DialogTitle>New lead</DialogTitle>
        <DialogContent dividers>
          <Grid container spacing={1.5}>
            <Grid item xs={12}>
              <TextField label="Name" size="small" fullWidth value={manual.name} onChange={(e) => setManual({ ...manual, name: e.target.value })} />
            </Grid>
            {manual.phones.map((ph, i) => (
              <Grid item xs={12} sm={6} key={i}>
                <PhoneInput
                  label={i === 0 ? "Phone" : `Phone ${i + 1}`}
                  value={ph}
                  onChange={(v) => setManual({ ...manual, phones: manual.phones.map((x, j) => (j === i ? v : x)) })}
                  onRemove={i > 0 ? () => setManual({ ...manual, phones: manual.phones.filter((_, j) => j !== i) }) : undefined}
                />
              </Grid>
            ))}
            <Grid item xs={12} sm={6} sx={{ display: "flex", alignItems: "center" }}>
              <Button size="small" startIcon={<AddIcon />} onClick={() => setManual({ ...manual, phones: [...manual.phones, ""] })} sx={{ textTransform: "none" }}>
                Add number
              </Button>
              <Typography variant="caption" sx={{ color: "text.secondary", ml: 1 }}>
                the client can be WhatsApped on any of them
              </Typography>
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField label="Email" size="small" fullWidth value={manual.email} onChange={(e) => setManual({ ...manual, email: e.target.value })} />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField label="Property type" size="small" fullWidth value={manual.propertyType} onChange={(e) => setManual({ ...manual, propertyType: e.target.value })} />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField label="Budget" size="small" fullWidth value={manual.budget} onChange={(e) => setManual({ ...manual, budget: e.target.value })} />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField label="New / resale" select size="small" fullWidth value={manual.propertyStatus} onChange={(e) => setManual({ ...manual, propertyStatus: e.target.value })}>
                <MenuItem value="">—</MenuItem>
                {PROPERTY_STATUS_OPTIONS.map((o) => (
                  <MenuItem key={o} value={o}>{o}</MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Key collection"
                select
                size="small"
                fullWidth
                value={keyModeOf(manual.keyCollection)}
                onChange={(e) => setManual({ ...manual, keyCollection: e.target.value === "date" ? "" : e.target.value })}
              >
                {KEY_MODES.map((o) => (
                  <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
                ))}
              </TextField>
            </Grid>
            {keyModeOf(manual.keyCollection) === "date" && (
              <Grid item xs={12} sm={6}>
                <TextField label="Est. key collection date" type="date" size="small" fullWidth InputLabelProps={{ shrink: true }} value={manual.keyCollection} onChange={(e) => setManual({ ...manual, keyCollection: e.target.value })} />
              </Grid>
            )}
            <Grid item xs={12} sm={6}>
              <TextField label="Source" select size="small" fullWidth value={manual.source} onChange={(e) => setManual({ ...manual, source: e.target.value })}>
                {MANUAL_SOURCE_OPTIONS.map((o) => (
                  <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
                ))}
              </TextField>
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
                const phones = Array.from(new Set(manual.phones.map((v) => v.replace(/\D/g, "")).filter(Boolean)));
                // Warn first when the name or any number already exists.
                const chk = await api.request<any>(`/leads/check-duplicate?name=${encodeURIComponent(manual.name.trim())}&phones=${encodeURIComponent(phones.join(","))}`).catch(() => null);
                if (chk?.duplicates?.length) {
                  setDupWarn(chk.duplicates);
                  return;
                }
                await submitManualLead();
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

      {/* Set appointment — shows on the dashboard master calendar. */}
      <Dialog open={!!apptFor} onClose={() => setApptFor(null)} maxWidth="xs" fullWidth PaperProps={{ sx: { borderRadius: 2 } }}>
        <DialogTitle>Appointment — {apptFor?.name}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            <TextField label="Date & time" type="datetime-local" size="small" fullWidth InputLabelProps={{ shrink: true }} value={appt.at} onChange={(e) => setAppt({ ...appt, at: e.target.value })} />
            <TextField label="Note" size="small" fullWidth placeholder="e.g. showroom meeting, bring floor plan" value={appt.note} onChange={(e) => setAppt({ ...appt, note: e.target.value })} />
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              Shows on the Dashboard calendar for management and the assigned designer.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          {apptFor?.appointmentAt && (
            <Button
              color="error"
              disabled={busy}
              onClick={async () => {
                await patch(apptFor!.id, { appointmentAt: null, appointmentNote: null });
                setDetail((d) => (d && d.id === apptFor!.id ? { ...d, appointmentAt: null, appointmentNote: null } : d));
                setApptFor(null);
              }}
            >
              Clear
            </Button>
          )}
          <Box sx={{ flex: 1 }} />
          <Button onClick={() => setApptFor(null)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={busy || !appt.at}
            onClick={async () => {
              const iso = new Date(appt.at).toISOString();
              await patch(apptFor!.id, { appointmentAt: iso, appointmentNote: appt.note || null });
              setDetail((d) => (d && d.id === apptFor!.id ? { ...d, appointmentAt: iso, appointmentNote: appt.note || null } : d));
              setApptFor(null);
              toast.success("Appointment saved — it's on the dashboard calendar");
            }}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>

      {/* Duplicate warning: same name or number already in the pipeline. */}
      <Dialog open={!!dupWarn} onClose={() => setDupWarn(null)} maxWidth="xs" fullWidth PaperProps={{ sx: { borderRadius: 2 } }}>
        <DialogTitle>Possible duplicate lead</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ color: "text.secondary", mb: 1.5 }}>
            A lead with the same {dupWarn?.some((d: any) => d.numbers?.some((n: string) => manual.phones.some((p) => p.replace(/\D/g, "") === n))) ? "contact number" : "name"} already exists:
          </Typography>
          <Stack spacing={1}>
            {(dupWarn || []).map((d: any) => (
              <Paper key={d.id} variant="outlined" sx={{ p: 1.25, borderRadius: 1.5 }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>{d.name}</Typography>
                <Typography variant="caption" sx={{ color: "text.secondary" }}>
                  {[d.numbers?.join(" · "), String(d.source || "").toUpperCase(), d.status, d.assignedToName ? `assigned to ${d.assignedToName}` : null].filter(Boolean).join(" · ")}
                </Typography>
              </Paper>
            ))}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDupWarn(null)}>Cancel</Button>
          <Button
            color="warning"
            variant="contained"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await submitManualLead();
              } catch (e: any) {
                toast.error(e.message || "Create failed");
              } finally {
                setBusy(false);
              }
            }}
          >
            Create anyway
          </Button>
        </DialogActions>
      </Dialog>

      {/* edit lead — every whitelisted human-set field; available in any status */}
      <Dialog open={!!editFor} onClose={() => setEditFor(null)} fullWidth maxWidth="sm" fullScreen={fullScreenDialog} PaperProps={{ sx: { borderRadius: { sm: 2 } } }}>
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
              {/* Ref = the lead provider's reference (e.g. NSG-2026-2160) used
                  for replacement claims — meaningless for manual leads, so it
                  only shows when the lead came from a provider or has one. */}
              {(editFor.ref || !isManualSource(editFor.source)) && (
                <Grid item xs={12} sm={6}>
                  <TextField label="Provider ref" size="small" fullWidth value={edit.ref} onChange={(e) => setEdit({ ...edit, ref: e.target.value })} helperText="Lead provider's reference no. (EZiD / Network) — used for replacement claims" />
                </Grid>
              )}
              {(edit.phones as string[]).map((ph: string, i: number) => (
                <Grid item xs={12} sm={6} key={i}>
                  <PhoneInput
                    label={i === 0 ? "Phone" : `Phone ${i + 1}`}
                    value={ph}
                    onChange={(v) => setEdit({ ...edit, phones: edit.phones.map((x: string, j: number) => (j === i ? v : x)) })}
                    onRemove={i > 0 ? () => setEdit({ ...edit, phones: edit.phones.filter((_: string, j: number) => j !== i) }) : undefined}
                  />
                </Grid>
              ))}
              <Grid item xs={12} sm={6} sx={{ display: "flex", alignItems: "center" }}>
                <Button size="small" startIcon={<AddIcon />} onClick={() => setEdit({ ...edit, phones: [...edit.phones, ""] })} sx={{ textTransform: "none" }}>
                  Add number
                </Button>
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
                <TextField label="New / resale" select size="small" fullWidth value={edit.propertyStatus} onChange={(e) => setEdit({ ...edit, propertyStatus: e.target.value })}>
                  <MenuItem value="">—</MenuItem>
                  {[...PROPERTY_STATUS_OPTIONS, ...(edit.propertyStatus && !PROPERTY_STATUS_OPTIONS.includes(edit.propertyStatus) ? [edit.propertyStatus] : [])].map((o) => (
                    <MenuItem key={o} value={o}>{o}</MenuItem>
                  ))}
                </TextField>
              </Grid>
              <Grid item xs={12} sm={6}>
                <Stack direction="row" spacing={1}>
                  <TextField
                    label="Key collection"
                    select
                    size="small"
                    sx={{ minWidth: 150 }}
                    value={keyModeOf(edit.keyCollection)}
                    onChange={(e) => setEdit({ ...edit, keyCollection: e.target.value === "date" ? "" : e.target.value })}
                  >
                    {KEY_MODES.map((o) => (
                      <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
                    ))}
                  </TextField>
                  {keyModeOf(edit.keyCollection) === "date" && (
                    <TextField label="Date" type="date" size="small" fullWidth InputLabelProps={{ shrink: true }} value={edit.keyCollection} onChange={(e) => setEdit({ ...edit, keyCollection: e.target.value })} />
                  )}
                </Stack>
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
