"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
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
  DialogTitle,
  Divider,
  FormControlLabel,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import LocalShippingIcon from "@mui/icons-material/LocalShipping";
import LinkIcon from "@mui/icons-material/Link";
import NoteAddIcon from "@mui/icons-material/NoteAdd";
import PlaceIcon from "@mui/icons-material/Place";
import { request } from "@/helpers/request";
import { useOrganization } from "@hooks/useOrganization";

/**
 * Delivery run detail (office). Items + the field PROOF (photos, signature,
 * GPS from the run's MSR rows) and, while any item is unlinked, the two
 * actions: Link SELECTED items to an existing DO, or Create a DO from the
 * SELECTED items. Per-item linking (2026-08): one run's items may fulfil
 * different DOs — select a subset, link it, repeat for the rest.
 *
 * Linking stamps the DO's item states and deducts stock. It does NOT create
 * an invoice — the UI copy is explicit about that (backburnered by design).
 */

const RESOURCE_URL = process.env.NEXT_PUBLIC_RESOURCE_URL ?? "https://aims-osiris.s3.ap-southeast-1.amazonaws.com/";
const imgSrc = (keyOrData: string) => (keyOrData.startsWith("data:") ? keyOrData : `${RESOURCE_URL}${keyOrData}`);

type RunStatus = "in_progress" | "delivered" | "completed" | "cancelled";

interface RunDetail {
  id: string;
  deliveryNumber: number;
  status: RunStatus;
  riderName: string | null;
  siteAddress: string | null;
  notes: string | null;
  startedAt: string;
  completedAt: string | null;
  projectId: string | null;
  customerId: string | null;
  // findById includes both (null until assigned).
  project: { id: string; name: string } | null;
  customer: { id: string; name: string } | null;
  // Derived by the backend: the single distinct DO across linked items, else null.
  document: { id: string; name: string | null; type: string; status: string } | null;
  items: Array<{
    id: string;
    quantity: number;
    description: string | null;
    deliveryStatus: string;
    documentId: string | null;
    document: { id: string; name: string | null; type: string; status: string } | null;
    inventory: { id: string; sku: string; serialNumber: string | null; status: string } | null;
    asset: { id: string; name: string; skuKey: string } | null;
  }>;
  reports: Array<{
    id: string;
    kind: string;
    status: string;
    description: string;
    photos: string[];
    signature: string | null;
    signedByName: string | null;
    signedAt: string | null;
    latitude: number | null;
    longitude: number | null;
    technicianName: string | null;
    createdAt: string;
  }>;
}

interface DocRow {
  id: string;
  name: string | null;
  documentType?: string;
  type?: string;
  status?: string;
  projectId?: string | null;
  createdAt: string;
}

const STATUS_CHIP: Record<RunStatus, { label: string; color: "warning" | "info" | "success" | "default" }> = {
  in_progress: { label: "In progress", color: "warning" },
  delivered: { label: "Delivered", color: "info" },
  completed: { label: "Completed", color: "success" },
  cancelled: { label: "Cancelled", color: "default" },
};

const ITEM_CHIP: Record<string, { label: string; color: "default" | "warning" | "info" | "success" }> = {
  not_delivered: { label: "Not delivered", color: "default" },
  delivering: { label: "Delivering", color: "warning" },
  not_installed: { label: "Delivered", color: "info" },
  completed: { label: "Completed", color: "success" },
};

const KIND_LABEL: Record<string, string> = {
  DO_START: "Delivery Started",
  DO_ACK: "Delivery Acknowledged",
  DO_INSTALL: "Installation Completed",
};

const fmtDateTime = (d: string | null) =>
  d ? new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

// Terminal / return-cycle DOs can't absorb a run (mirrors the backend's
// eligible-status list for linking).
const LINKABLE_DO_STATUSES = new Set(["draft", "unconfirmed", "confirmed", "pending_delivery", "delivered_not_installed"]);

export default function DeliveryDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const deliveryId = params?.id as string;

  const [run, setRun] = useState<RunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  // Per-item link selection — pre-checked with every unlinked item so the
  // default one-click flow still links the whole run.
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Link-picker dialog state
  const [pickerOpen, setPickerOpen] = useState(false);
  const [docs, setDocs] = useState<DocRow[] | null>(null);
  const [docsError, setDocsError] = useState<string | null>(null);
  const [showAllDos, setShowAllDos] = useState(false);

  const load = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const res = await request({ path: `/deliveries/${deliveryId}`, method: "GET" }, {}, token);
      if (res.success === false) throw new Error(res.message ?? "Delivery not found");
      const data: RunDetail = res.data ?? res;
      setRun(data);
      // Re-seed the selection with whatever is still unlinked after a refresh.
      setSelected(new Set(data.items.filter((i) => !i.documentId).map((i) => i.id)));
    } catch (e: any) {
      setError(e?.message ?? "Failed to load delivery");
    } finally {
      setLoading(false);
    }
  }, [deliveryId, getToken]);

  useEffect(() => {
    void load();
  }, [load]);

  // Fetch the org's documents once when the picker opens; filter to eligible
  // DELIVERY_ORDERs client-side (same fetch the portal's list pages use).
  const openPicker = async () => {
    setPickerOpen(true);
    setDocsError(null);
    if (docs) return;
    try {
      const token = await getToken();
      if (!token || !organization?.id) throw new Error("Not signed in");
      const res = await request({ path: "/documents", method: "POST" }, { organizationId: organization.id }, token);
      if (res.success === false || !res.data) throw new Error(res.message ?? "Failed to load documents");
      setDocs(res.data as DocRow[]);
    } catch (e: any) {
      setDocsError(e?.message ?? "Failed to load delivery orders");
    }
  };

  const eligibleDos = useMemo(() => {
    if (!docs) return [];
    const all = docs
      .filter((d) => (d.documentType ?? d.type) === "DELIVERY_ORDER")
      .filter((d) => LINKABLE_DO_STATUSES.has((d.status ?? "draft").toLowerCase()))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    // Sensible default scope: the run's own project first; toggle widens.
    if (!showAllDos && run?.projectId) {
      const scoped = all.filter((d) => d.projectId === run.projectId);
      if (scoped.length > 0) return scoped;
    }
    return all;
  }, [docs, showAllDos, run?.projectId]);

  const doLink = async (documentId: string) => {
    setActing(true);
    setActionError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const res = await request(
        { path: `/deliveries/${deliveryId}/link`, method: "POST" },
        { documentId, itemIds: Array.from(selected) },
        token,
      );
      if (res.success === false) throw new Error(res.message ?? "Link failed");
      setPickerOpen(false);
      await load(); // refresh — shows the now-linked items + reseeds selection
    } catch (e: any) {
      setActionError(e?.message ?? "Link failed");
      setPickerOpen(false);
    } finally {
      setActing(false);
    }
  };

  const doCreateDo = async () => {
    setActing(true);
    setActionError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const res = await request(
        { path: `/deliveries/${deliveryId}/create-do`, method: "POST" },
        { itemIds: Array.from(selected) },
        token,
      );
      if (res.success === false) throw new Error(res.message ?? "Create DO failed");
      const linked = res.data ?? res;
      const doId = linked?.createdDocumentId ?? linked?.document?.id;
      if (doId) {
        // Route the office user into the created DO so pricing can be added.
        // The editor route needs the template id — resolve it via GET
        // /documents/:id (the link response's document summary doesn't carry it).
        const docRes = await request({ path: `/documents/${doId}`, method: "GET" }, {}, token);
        const templateId = (docRes.data ?? docRes)?.documentTemplateId;
        if (templateId) {
          router.push(`/portal/documents/DELIVERY_ORDER/${templateId}/${doId}`);
          return;
        }
      }
      await load();
    } catch (e: any) {
      setActionError(e?.message ?? "Create DO failed");
    } finally {
      setActing(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 10 }}>
        <CircularProgress />
      </Box>
    );
  }
  if (error || !run) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{error ?? "Delivery not found"}</Alert>
        <Button startIcon={<ArrowBackIcon />} sx={{ mt: 2 }} onClick={() => router.push("/portal/deliveries")}>
          Back to deliveries
        </Button>
      </Box>
    );
  }

  const chip = STATUS_CHIP[run.status] ?? { label: run.status, color: "default" as const };
  // Per-item link state. distinctDocs powers the header when the run spans DOs.
  const unlinkedItems = run.items.filter((i) => !i.documentId);
  const linkedCount = run.items.length - unlinkedItems.length;
  const distinctDocs = Array.from(new Map(run.items.filter((i) => i.document).map((i) => [i.document!.id, i.document!])).values());
  const hasUnlinked = unlinkedItems.length > 0 && run.status !== "cancelled";
  const toggleItem = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Box sx={{ p: 3, maxWidth: 1100 }}>
      <Button startIcon={<ArrowBackIcon />} size="small" sx={{ mb: 1.5 }} onClick={() => router.push("/portal/deliveries")}>
        Deliveries
      </Button>

      <Stack direction="row" alignItems="center" spacing={1.5} flexWrap="wrap" sx={{ mb: 0.5 }}>
        <LocalShippingIcon color="primary" />
        <Typography variant="h5" fontWeight={700}>Delivery #{run.deliveryNumber}</Typography>
        <Chip size="small" label={chip.label} color={chip.color} />
        {linkedCount === 0 ? (
          <Chip size="small" variant="outlined" label="No DO yet" />
        ) : unlinkedItems.length > 0 ? (
          <Chip size="small" variant="outlined" color="warning" label={`${linkedCount} of ${run.items.length} linked`} />
        ) : distinctDocs.length === 1 ? (
          <Chip size="small" variant="outlined" color="success" label={`Linked: ${distinctDocs[0].name ?? distinctDocs[0].id}`} />
        ) : (
          <Chip size="small" variant="outlined" color="success" label={`Linked: ${distinctDocs.length} DOs`} />
        )}
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Rider: {run.riderName ?? "—"} · Started {fmtDateTime(run.startedAt)}
        {run.completedAt ? ` · Completed ${fmtDateTime(run.completedAt)}` : ""}
        {/* Project/customer omit-when-absent, same pattern as Site: — a
            pre-assign run just shows a shorter line, no empty labels. */}
        {run.project ? ` · Project: ${run.project.name}` : ""}
        {run.customer ? ` · Customer: ${run.customer.name}` : ""}
        {run.siteAddress ? ` · Site: ${run.siteAddress}` : ""}
      </Typography>

      {actionError && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setActionError(null)}>{actionError}</Alert>}

      {/* Actions — shown while ANY item is unlinked. Selection-scoped: link
          the checked subset, repeat for the rest (items may span DOs). */}
      {hasUnlinked && (
        <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.5 }}>
            Link items to a Delivery Order
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            Tick the items below, then link them to a DO (or create one from them).
            Items can go to different DOs — repeat for the rest. &ldquo;Create DO&rdquo;
            makes a <b>draft</b> for review; stock is deducted only when the DO is
            <b> confirmed</b> (linking to an already-confirmed DO deducts immediately).
            It does <b>not</b> create an invoice — invoicing stays a separate, manual step.
          </Typography>
          <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap">
            <Button variant="contained" startIcon={<LinkIcon />} onClick={openPicker} disabled={acting || selected.size === 0}>
              Link selected to existing DO
            </Button>
            <Button variant="outlined" startIcon={<NoteAddIcon />} onClick={doCreateDo} disabled={acting || selected.size === 0}>
              {acting ? "Working…" : "Create DO from selected"}
            </Button>
            <Typography variant="caption" color="text.secondary">
              {selected.size} of {unlinkedItems.length} unlinked item{unlinkedItems.length === 1 ? "" : "s"} selected
            </Typography>
          </Stack>
        </Paper>
      )}

      {/* Items */}
      <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
        Items ({run.items.length})
      </Typography>
      <TableContainer component={Paper} variant="outlined" sx={{ mb: 3 }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              {hasUnlinked && (
                <TableCell padding="checkbox">
                  <Checkbox
                    size="small"
                    checked={selected.size === unlinkedItems.length && unlinkedItems.length > 0}
                    indeterminate={selected.size > 0 && selected.size < unlinkedItems.length}
                    onChange={(e) =>
                      setSelected(e.target.checked ? new Set(unlinkedItems.map((i) => i.id)) : new Set())
                    }
                  />
                </TableCell>
              )}
              <TableCell>Unit</TableCell>
              <TableCell>Asset</TableCell>
              <TableCell>Description</TableCell>
              <TableCell align="center">Qty</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Linked DO</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {run.items.map((it) => {
              const ic = ITEM_CHIP[it.deliveryStatus] ?? { label: it.deliveryStatus, color: "default" as const };
              return (
                <TableRow key={it.id}>
                  {hasUnlinked && (
                    <TableCell padding="checkbox">
                      {!it.documentId && (
                        <Checkbox size="small" checked={selected.has(it.id)} onChange={() => toggleItem(it.id)} />
                      )}
                    </TableCell>
                  )}
                  <TableCell sx={{ fontFamily: "monospace" }}>{it.inventory?.sku ?? "—"}</TableCell>
                  <TableCell>
                    {it.asset?.name ?? (
                      // Free-typed line (no asset AND no unit) — awaiting resolution
                      // to a real catalog asset/unit (Phase 2 adds the action).
                      !it.inventory ? (
                        <Chip size="small" color="warning" variant="outlined" label="Needs resolution" />
                      ) : (
                        "—"
                      )
                    )}
                  </TableCell>
                  <TableCell>{it.description ?? "—"}</TableCell>
                  <TableCell align="center">{it.quantity}</TableCell>
                  <TableCell><Chip size="small" label={ic.label} color={ic.color} /></TableCell>
                  <TableCell>
                    {it.document ? (
                      <Chip size="small" variant="outlined" color="success" label={it.document.name ?? it.document.id} />
                    ) : (
                      <Typography variant="body2" color="text.secondary">—</Typography>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Proof — the office's evidence the delivery happened */}
      <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
        Proof of delivery
      </Typography>
      {run.reports.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 3, mb: 3 }}>
          <Typography variant="body2" color="text.secondary">No field reports recorded yet.</Typography>
        </Paper>
      ) : (
        <Stack spacing={2} sx={{ mb: 3 }}>
          {run.reports.map((r) => (
            <Paper key={r.id} variant="outlined" sx={{ p: 2 }}>
              <Stack direction="row" alignItems="center" spacing={1.5} flexWrap="wrap" sx={{ mb: 1 }}>
                <Typography variant="subtitle2" fontWeight={700}>
                  {KIND_LABEL[r.kind] ?? r.kind}
                </Typography>
                <Chip size="small" variant="outlined" label={r.status === "completed" ? "Signed" : "Unsigned"} color={r.status === "completed" ? "success" : "default"} />
                <Typography variant="caption" color="text.secondary">
                  {fmtDateTime(r.createdAt)}{r.technicianName ? ` · ${r.technicianName}` : ""}
                </Typography>
                {r.latitude != null && r.longitude != null && (
                  <Button
                    size="small"
                    startIcon={<PlaceIcon />}
                    href={`https://www.google.com/maps?q=${r.latitude},${r.longitude}`}
                    target="_blank"
                    sx={{ textTransform: "none" }}
                  >
                    {r.latitude.toFixed(5)}, {r.longitude.toFixed(5)}
                  </Button>
                )}
              </Stack>
              {r.description && (
                <Typography variant="body2" sx={{ mb: 1 }}>{r.description}</Typography>
              )}
              {r.photos.length > 0 && (
                <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: "wrap", gap: 1 }}>
                  {r.photos.map((k) => (
                    <Box
                      key={k}
                      component="a"
                      href={imgSrc(k)}
                      target="_blank"
                      sx={{ display: "block" }}
                    >
                      <Box component="img" src={imgSrc(k)} alt="Delivery photo" sx={{ width: 120, height: 120, objectFit: "cover", borderRadius: 1, border: "1px solid", borderColor: "divider" }} />
                    </Box>
                  ))}
                </Stack>
              )}
              {r.signature && (
                <Box sx={{ mt: 1 }}>
                  <Typography variant="caption" color="text.secondary" display="block">
                    Signed by {r.signedByName ?? "—"}{r.signedAt ? ` · ${fmtDateTime(r.signedAt)}` : ""}
                  </Typography>
                  <Box
                    component="img"
                    src={imgSrc(r.signature)}
                    alt="Signature"
                    sx={{ maxWidth: 260, maxHeight: 110, mt: 0.5, border: "1px solid", borderColor: "divider", borderRadius: 1, bgcolor: "#fff", p: 0.5 }}
                  />
                </Box>
              )}
            </Paper>
          ))}
        </Stack>
      )}

      {/* Link picker */}
      <Dialog open={pickerOpen} onClose={() => !acting && setPickerOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>
          Link {selected.size} item{selected.size === 1 ? "" : "s"} of Delivery #{run.deliveryNumber} to a Delivery Order
        </DialogTitle>
        <DialogContent dividers>
          {docsError && <Alert severity="error" sx={{ mb: 1 }}>{docsError}</Alert>}
          {run.projectId && (
            <FormControlLabel
              control={<Checkbox size="small" checked={showAllDos} onChange={(e) => setShowAllDos(e.target.checked)} />}
              label="Show DOs from all projects"
              sx={{ mb: 1 }}
            />
          )}
          {!docs && !docsError ? (
            <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}><CircularProgress size={28} /></Box>
          ) : eligibleDos.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
              No eligible delivery orders found{!showAllDos && run.projectId ? " for this project — try showing all projects" : ""}.
            </Typography>
          ) : (
            <List dense>
              {eligibleDos.map((d) => (
                <ListItemButton key={d.id} onClick={() => doLink(d.id)} disabled={acting}>
                  <ListItemText
                    primary={d.name ?? d.id}
                    secondary={`${(d.status ?? "").replace(/_/g, " ")} · ${fmtDateTime(d.createdAt)}`}
                  />
                </ListItemButton>
              ))}
            </List>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPickerOpen(false)} disabled={acting}>Cancel</Button>
        </DialogActions>
      </Dialog>

      {run.notes && (
        <>
          <Divider sx={{ my: 2 }} />
          <Typography variant="caption" color="text.secondary">Rider notes</Typography>
          <Typography variant="body2">{run.notes}</Typography>
        </>
      )}
    </Box>
  );
}
