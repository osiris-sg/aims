"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import {
  Alert,
  Box,
  Button,
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
  TablePagination,
  Typography,
} from "@mui/material";
import LocalShippingIcon from "@mui/icons-material/LocalShipping";
import EventIcon from "@mui/icons-material/Event";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import { request } from "@/helpers/request";
import ScheduleDeliveryDialog from "./_components/ScheduleDeliveryDialog";
import ScheduleReturnDialog from "./_components/ScheduleReturnDialog";

/**
 * Office Deliveries queue (phase-1 layer 4; per-item linking 2026-08).
 * Standalone physical-delivery runs surfaced so the office can link each
 * run's ITEMS to Delivery Orders (or create DOs from them). Shows ALL runs
 * (newest first); the "Linked DO" column tells you which are linked, partly
 * linked ("k of n linked"), or unlinked ("—").
 *
 * Read path: GET /deliveries?page=&limit= (Layer-2 backend).
 * Row click → /portal/deliveries/[id] (proof + per-item link actions).
 */

type RunStatus = "scheduled" | "in_progress" | "delivered" | "completed" | "cancelled";

interface DeliveryRow {
  id: string;
  deliveryNumber: number;
  direction?: "OUTBOUND" | "RETURN";
  isDraft?: boolean;
  status: RunStatus;
  riderName: string | null;
  siteAddress: string | null;
  startedAt: string;
  completedAt: string | null;
  scheduledFor: string | null;
  items: Array<{
    id: string;
    deliveryStatus: string;
    documentId: string | null;
    document: { id: string; name: string | null } | null;
  }>;
  project: { id: string; name: string } | null;
  customer: { id: string; name: string } | null;
}

const STATUS_CHIP: Record<RunStatus, { label: string; color: "warning" | "info" | "success" | "default" | "primary" }> = {
  scheduled: { label: "Scheduled", color: "primary" },
  in_progress: { label: "In progress", color: "warning" },
  delivered: { label: "Delivered", color: "info" },
  completed: { label: "Completed", color: "success" },
  cancelled: { label: "Cancelled", color: "default" },
};

const fmtDateTime = (d: string | null) =>
  d ? new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

// Which row actions apply. CANCEL is the soft unwind the backend allows for a
// scheduled run, or an in_progress run that has delivered and linked nothing
// (the backend re-checks and blocks otherwise; we surface that reason). DELETE
// is the hard remove the backend scopes to draft/scheduled only (a draft is
// scheduled + isDraft). A completed, delivered, or cancelled run matches
// neither, so it offers no actions at all. These flags only decide what to
// OFFER; the backend re-validates against live state on every call.
const rowActions = (r: DeliveryRow) => {
  const items = r.items ?? [];
  const delivered = items.some((i) => i.deliveryStatus === "not_installed" || i.deliveryStatus === "completed");
  const linked = items.some((i) => !!i.documentId);
  const canCancel = !r.isDraft && (r.status === "scheduled" || (r.status === "in_progress" && !delivered && !linked));
  const canDelete = r.status === "scheduled";
  return { canCancel, canDelete };
};

export default function DeliveriesQueuePage() {
  const router = useRouter();
  const { getToken } = useAuth();
  const [rows, setRows] = useState<DeliveryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0); // 0-based for MUI; backend is 1-based
  const [limit, setLimit] = useState(20);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [menu, setMenu] = useState<{ anchor: HTMLElement; row: DeliveryRow } | null>(null);
  const [confirm, setConfirm] = useState<{ action: "cancel" | "delete"; row: DeliveryRow } | null>(null);
  const [acting, setActing] = useState(false);
  const [actionMsg, setActionMsg] = useState<{ text: string; severity: "success" | "error" } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      // Office view opts IN to drafts; every rider-facing read leaves them out.
      const qs = `?page=${page + 1}&limit=${limit}&includeDrafts=true`;
      const res = await request({ path: `/deliveries${qs}`, method: "GET" }, {}, token);
      if (res.success === false) throw new Error(res.message ?? "Failed to load deliveries");
      const data = res.data ?? res;
      setRows(data.docs ?? []);
      setTotal(data.total ?? 0);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load deliveries");
    } finally {
      setLoading(false);
    }
  }, [getToken, page, limit]);

  useEffect(() => {
    void load();
  }, [load]);

  // Open a linked DO in the document editor. The list summary doesn't carry the
  // template id, so resolve it via GET /documents/:id first (same pattern the
  // run-detail "Create DO" flow uses), then route into the DELIVERY_ORDER editor.
  const openDocument = useCallback(
    async (docId: string) => {
      try {
        const token = await getToken();
        if (!token) return;
        const res = await request({ path: `/documents/${docId}`, method: "GET" }, {}, token);
        const templateId = (res?.data ?? res)?.documentTemplateId;
        if (templateId) router.push(`/portal/documents/DELIVERY_ORDER/${templateId}/${docId}`);
      } catch {
        /* non-fatal: leave the user on the list */
      }
    },
    [getToken, router],
  );

  // Run the confirmed action. The backend re-validates against live state, so a
  // refused action (a run that moved on since the list loaded) surfaces its
  // reason here rather than failing silently.
  const runAction = async () => {
    if (!confirm) return;
    const { action, row } = confirm;
    setActing(true);
    setActionMsg(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const res =
        action === "cancel"
          ? await request({ path: `/deliveries/${row.id}/cancel`, method: "POST" }, {}, token)
          : await request({ path: `/deliveries/${row.id}`, method: "DELETE" }, {}, token);
      if (res?.success === false) throw new Error(res?.message ?? "Action failed");
      const note = (res?.data ?? res)?.note as string | undefined;
      setActionMsg({
        text:
          action === "cancel"
            ? `Delivery #${row.deliveryNumber} cancelled.${note ? ` ${note}` : ""}`
            : `Delivery #${row.deliveryNumber} deleted.`,
        severity: "success",
      });
      setConfirm(null);
      await load();
    } catch (e: any) {
      const m = e?.message;
      setActionMsg({ text: (Array.isArray(m) ? m.join(". ") : m) || "The action could not be completed.", severity: "error" });
      setConfirm(null);
    } finally {
      setActing(false);
    }
  };

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 0.5 }}>
        <LocalShippingIcon color="primary" />
        <Typography variant="h5" fontWeight={700}>
          Deliveries
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Button variant="outlined" startIcon={<EventIcon />} onClick={() => setReturnOpen(true)}>
          Schedule a return
        </Button>
        <Button variant="contained" startIcon={<EventIcon />} onClick={() => setScheduleOpen(true)}>
          Schedule a delivery
        </Button>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Standalone delivery runs recorded in the field. When a run is completed it
        auto-creates a Delivery Order and a <b>draft</b> invoice — price and confirm
        the invoice here. You can still link a run&apos;s items to an existing DO, or
        create one from a subset, using the actions on each run.
      </Typography>

      {!loading && (
        <Stack direction="row" justifyContent="flex-end" alignItems="center" sx={{ mb: 1.5 }}>
          <Typography variant="caption" color="text.secondary">
            {total} deliver{total === 1 ? "y" : "ies"}
          </Typography>
        </Stack>
      )}

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {actionMsg && (
        <Alert severity={actionMsg.severity} sx={{ mb: 2 }} onClose={() => setActionMsg(null)}>
          {actionMsg.text}
        </Alert>
      )}

      {loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
          <CircularProgress />
        </Box>
      ) : rows.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 6, textAlign: "center" }}>
          <Typography variant="body1" color="text.secondary">
            No deliveries recorded yet.
          </Typography>
        </Paper>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>#</TableCell>
                {/* Type + linked document, immediately after the number, so the
                    run reads at a glance without scanning to the far right. The
                    direction chip is NOT redundant with the document chip: a
                    return only gets its RDO at completion, so an in-flight
                    return would otherwise show a bare dash exactly like an
                    unlinked delivery. */}
                <TableCell>Type / Linked DO</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Rider</TableCell>
                <TableCell>Project / Customer / Site</TableCell>
                <TableCell align="center">Items</TableCell>
                <TableCell>Scheduled</TableCell>
                <TableCell>Started</TableCell>
                <TableCell>Completed</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((r) => {
                // A draft is not a live schedule: no rider can see or claim it,
                // and it has no DO yet, so it must not read as "Scheduled".
                const chip = r.isDraft
                  ? { label: "Draft", color: "default" as const }
                  : STATUS_CHIP[r.status] ?? { label: r.status, color: "default" as const };
                return (
                  <TableRow
                    key={r.id}
                    hover
                    sx={{ cursor: "pointer" }}
                    onClick={() => router.push(`/portal/deliveries/${r.id}`)}
                  >
                    <TableCell sx={{ fontFamily: "monospace", fontWeight: 600 }}>#{r.deliveryNumber}</TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        variant="outlined"
                        color={r.direction === "RETURN" ? "secondary" : "default"}
                        label={r.direction === "RETURN" ? "Return" : "Delivery"}
                        sx={{ mb: 0.5 }}
                      />
                      <Box />
                      {(() => {
                        const items = r.items ?? [];
                        const linked = items.filter((i) => i.documentId);
                        if (linked.length === 0) {
                          return <Typography variant="body2" color="text.secondary">—</Typography>;
                        }
                        if (linked.length < items.length) {
                          return (
                            <Chip size="small" variant="outlined" color="warning" label={`${linked.length} of ${items.length} linked`} />
                          );
                        }
                        const distinct = Array.from(new Map(linked.filter((i) => i.document).map((i) => [i.document!.id, i.document!])).values());
                        // Single DO → a clickable chip that opens the document; multiple
                        // distinct DOs → a plain count (open individual ones from the run).
                        if (distinct.length === 1) {
                          const d = distinct[0];
                          return (
                            <Chip
                              size="small"
                              variant="outlined"
                              color="success"
                              clickable
                              label={d.name ?? "linked"}
                              onClick={(e) => {
                                e.stopPropagation();
                                void openDocument(d.id);
                              }}
                            />
                          );
                        }
                        return (
                          <Chip size="small" variant="outlined" color="success" label={`${distinct.length} DOs`} />
                        );
                      })()}
                    </TableCell>
                    <TableCell>
                      <Chip size="small" label={chip.label} color={chip.color} />
                    </TableCell>
                    <TableCell>{r.riderName ?? "—"}</TableCell>
                    <TableCell>
                      <Typography variant="body2" noWrap>
                        {r.project?.name ?? r.customer?.name ?? r.siteAddress ?? "—"}
                      </Typography>
                      {r.project && r.customer && (
                        <Typography variant="caption" color="text.secondary" noWrap display="block">
                          {r.customer.name}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell align="center">{r.items?.length ?? 0}</TableCell>
                    <TableCell>{fmtDateTime(r.scheduledFor)}</TableCell>
                    <TableCell>{fmtDateTime(r.startedAt)}</TableCell>
                    <TableCell>{fmtDateTime(r.completedAt)}</TableCell>
                    <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                      {(() => {
                        const { canCancel, canDelete } = rowActions(r);
                        if (!canCancel && !canDelete) {
                          // A committed run (delivered / completed / cancelled) offers
                          // neither action.
                          return <Typography variant="body2" color="text.secondary">—</Typography>;
                        }
                        return (
                          <IconButton
                            size="small"
                            aria-label="Run actions"
                            onClick={(e) => {
                              e.stopPropagation();
                              setMenu({ anchor: e.currentTarget, row: r });
                            }}
                          >
                            <MoreVertIcon fontSize="small" />
                          </IconButton>
                        );
                      })()}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <TablePagination
            component="div"
            count={total}
            page={page}
            onPageChange={(_, p) => setPage(p)}
            rowsPerPage={limit}
            onRowsPerPageChange={(e) => {
              setLimit(parseInt(e.target.value, 10));
              setPage(0);
            }}
            rowsPerPageOptions={[10, 20, 50]}
          />
        </TableContainer>
      )}

      <Menu anchorEl={menu?.anchor ?? null} open={!!menu} onClose={() => setMenu(null)}>
        {menu && rowActions(menu.row).canCancel && (
          <MenuItem
            onClick={() => {
              const row = menu.row;
              setMenu(null);
              setConfirm({ action: "cancel", row });
            }}
          >
            Cancel delivery
          </MenuItem>
        )}
        {menu && rowActions(menu.row).canDelete && (
          <MenuItem
            sx={{ color: "error.main" }}
            onClick={() => {
              const row = menu.row;
              setMenu(null);
              setConfirm({ action: "delete", row });
            }}
          >
            Delete{menu.row.isDraft ? " draft" : ""}
          </MenuItem>
        )}
      </Menu>

      <Dialog open={!!confirm} onClose={() => !acting && setConfirm(null)}>
        {confirm && (
          <>
            <DialogTitle>
              {confirm.action === "cancel"
                ? `Cancel delivery #${confirm.row.deliveryNumber}?`
                : `Delete ${confirm.row.isDraft ? "draft" : "delivery"} #${confirm.row.deliveryNumber}?`}
            </DialogTitle>
            <DialogContent>
              <DialogContentText>
                {confirm.action === "cancel"
                  ? "The run is marked cancelled and any reserved units are returned to stock. This cannot be undone."
                  : "This permanently removes the run and its unconfirmed draft Delivery Order. It cannot be undone. A run that has delivered or linked anything cannot be deleted; cancel it instead."}
              </DialogContentText>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setConfirm(null)} disabled={acting}>
                Keep it
              </Button>
              <Button onClick={runAction} color="error" variant="contained" disabled={acting}>
                {acting ? "Working…" : confirm.action === "cancel" ? "Cancel delivery" : "Delete"}
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>

      <ScheduleDeliveryDialog
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        onCreated={() => {
          setPage(0);
          void load();
        }}
      />

      <ScheduleReturnDialog
        open={returnOpen}
        onClose={() => setReturnOpen(false)}
        onCreated={() => {
          setPage(0);
          void load();
        }}
      />
    </Box>
  );
}
