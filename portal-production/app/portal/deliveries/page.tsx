"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  FormControlLabel,
  Paper,
  Stack,
  Switch,
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
import { request } from "@/helpers/request";

/**
 * Office Deliveries queue (phase-1 layer 4; per-item linking 2026-08).
 * Standalone physical-delivery runs surfaced so the office can link each
 * run's ITEMS to Delivery Orders (or create DOs from them). "Unlinked" is
 * per-item: a run stays in the queue while ANY item has no DO — partially
 * linked runs show "k of n linked". Defaults to the unlinked queue; toggle
 * to see every run.
 *
 * Read path: GET /deliveries?unlinked=true&page=&limit= (Layer-2 backend).
 * Row click → /portal/deliveries/[id] (proof + per-item link actions).
 */

type RunStatus = "in_progress" | "delivered" | "completed" | "cancelled";

interface DeliveryRow {
  id: string;
  deliveryNumber: number;
  status: RunStatus;
  riderName: string | null;
  siteAddress: string | null;
  startedAt: string;
  completedAt: string | null;
  items: Array<{
    id: string;
    deliveryStatus: string;
    documentId: string | null;
    document: { id: string; name: string | null } | null;
  }>;
  project: { id: string; name: string } | null;
  customer: { id: string; name: string } | null;
}

const STATUS_CHIP: Record<RunStatus, { label: string; color: "warning" | "info" | "success" | "default" }> = {
  in_progress: { label: "In progress", color: "warning" },
  delivered: { label: "Delivered", color: "info" },
  completed: { label: "Completed", color: "success" },
  cancelled: { label: "Cancelled", color: "default" },
};

const fmtDateTime = (d: string | null) =>
  d ? new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

export default function DeliveriesQueuePage() {
  const router = useRouter();
  const { getToken } = useAuth();
  const [rows, setRows] = useState<DeliveryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0); // 0-based for MUI; backend is 1-based
  const [limit, setLimit] = useState(20);
  const [unlinkedOnly, setUnlinkedOnly] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const qs = `?page=${page + 1}&limit=${limit}${unlinkedOnly ? "&unlinked=true" : ""}`;
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
  }, [getToken, page, limit, unlinkedOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 0.5 }}>
        <LocalShippingIcon color="primary" />
        <Typography variant="h5" fontWeight={700}>
          Deliveries
        </Typography>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Standalone delivery runs recorded in the field. Link each run to a Delivery
        Order — linking stamps the DO&apos;s items and deducts stock (it does not
        create an invoice).
      </Typography>

      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
        <FormControlLabel
          control={
            <Switch
              checked={unlinkedOnly}
              onChange={(e) => {
                setPage(0);
                setUnlinkedOnly(e.target.checked);
              }}
              size="small"
            />
          }
          label="Unlinked only"
        />
        {!loading && (
          <Typography variant="caption" color="text.secondary">
            {total} deliver{total === 1 ? "y" : "ies"}
          </Typography>
        )}
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
          <CircularProgress />
        </Box>
      ) : rows.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 6, textAlign: "center" }}>
          <Typography variant="body1" color="text.secondary">
            {unlinkedOnly ? "No unlinked deliveries — the queue is clear." : "No deliveries recorded yet."}
          </Typography>
        </Paper>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>#</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Rider</TableCell>
                <TableCell>Project / Customer / Site</TableCell>
                <TableCell align="center">Items</TableCell>
                <TableCell>Started</TableCell>
                <TableCell>Completed</TableCell>
                <TableCell>Linked DO</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((r) => {
                const chip = STATUS_CHIP[r.status] ?? { label: r.status, color: "default" as const };
                return (
                  <TableRow
                    key={r.id}
                    hover
                    sx={{ cursor: "pointer" }}
                    onClick={() => router.push(`/portal/deliveries/${r.id}`)}
                  >
                    <TableCell sx={{ fontFamily: "monospace", fontWeight: 600 }}>#{r.deliveryNumber}</TableCell>
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
                    <TableCell>{fmtDateTime(r.startedAt)}</TableCell>
                    <TableCell>{fmtDateTime(r.completedAt)}</TableCell>
                    <TableCell>
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
                        return (
                          <Chip
                            size="small"
                            variant="outlined"
                            color="success"
                            label={distinct.length === 1 ? distinct[0].name ?? "linked" : `${distinct.length} DOs`}
                          />
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
    </Box>
  );
}
