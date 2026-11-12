"use client";

// Manual order flow, DO first (2026-11-13): the order's DOs, with or without a
// job. A DO is completed on its own (Complete DO: sign here / upload the signed
// DO / sign link); a job is optional (calendar, a technician) and is completed
// on its job page as before. Row click opens the DO; actions sit in the row's
// menu, anchored to the click position.

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { Box, Button, CircularProgress, IconButton, Menu, MenuItem, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import moment from "moment";
import { toast } from "react-toastify";
import { request } from "@/helpers/request";
import StatusPill from "../_components/StatusPill";

export interface OrderDo {
  id: string;
  name: string | null;
  status: string;
  templateId: string | null;
  tag?: string | null;
  date?: string | null;
  completed: boolean;
  awaitingSignature: boolean;
  invoiceId: string | null;
  hasProducts: boolean;
  /** Product rows without a unit yet: Complete DO picks one unit each. */
  products?: { assetId: string; name: string }[];
  jobs: { id: string; deliveryNumber: number; status: string; isDraft: boolean; scheduledFor?: string | null; verificationState?: string | null }[];
}

const doState = (d: OrderDo): { label: string; color: "default" | "info" | "warning" | "success" } =>
  d.completed ? { label: d.invoiceId ? "Completed · invoiced" : "Completed", color: "success" } : d.awaitingSignature ? { label: "Awaiting signature", color: "warning" } : d.jobs.some((j) => !j.isDraft) ? { label: "Scheduled", color: "info" } : { label: "Draft", color: "default" };

export default function OrderDosSection({
  orderId,
  dos,
  cancelled,
  onReload,
  onCompleteDo,
  onSignLink,
  onServiceReport,
}: {
  orderId: string;
  dos: OrderDo[];
  cancelled: boolean;
  onReload: () => Promise<void> | void;
  onCompleteDo: (d: OrderDo) => void;
  onSignLink: (d: OrderDo) => void;
  onServiceReport: (d: OrderDo) => void;
}) {
  const router = useRouter();
  const { getToken } = useAuth();
  const [menu, setMenu] = useState<{ pos: { left: number; top: number }; d: OrderDo } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const post = async (path: string, what: string) => {
    setBusy(what);
    try {
      const token = await getToken();
      const res: any = await request({ path, method: "POST" }, {}, token ?? undefined);
      if (res?.success === false) throw new Error(res?.message || `Could not ${what}`);
      return res?.data ?? res;
    } catch (e: any) {
      toast.error(e?.message || `Could not ${what}`);
      return null;
    } finally {
      setBusy(null);
    }
  };

  const addDo = async () => {
    const r = await post(`/deliveries/order/${orderId}/dos`, "add the DO");
    if (r) {
      // Prefilled with what is still to deliver; empty when everything quoted is already on a DO.
      if (r.note) toast.info(`${r.doName || "A draft DO"} added. ${r.note}`);
      else toast.success(`${r.doName || "A draft DO"} added with what is still to deliver`);
      await onReload();
    }
  };
  const addJob = async (d: OrderDo) => {
    setMenu(null);
    const r = await post(`/deliveries/order-dos/${d.id}/job`, "add the job");
    if (r?.id) router.push(`/portal/deliveries/${r.id}?open=schedule`);
  };

  return (
    <Box sx={{ mb: 3 }} data-tour="wct-order-dos">
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          Delivery orders
        </Typography>
        <Box sx={{ flex: 1 }} />
        {!cancelled && (
          <Button size="small" variant="outlined" startIcon={busy === "add the DO" ? <CircularProgress size={14} /> : <AddIcon />} disabled={!!busy} onClick={() => void addDo()} data-tour="wct-order-add-do">
            Add DO
          </Button>
        )}
      </Stack>
      {dos.length ? (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>DO</TableCell>
              <TableCell>Date</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Jobs</TableCell>
              <TableCell sx={{ width: 48 }} />
            </TableRow>
          </TableHead>
          <TableBody>
            {dos.map((d) => {
              const st = doState(d);
              return (
                <TableRow key={d.id} hover sx={{ cursor: "pointer" }} onClick={() => d.templateId && router.push(`/portal/documents/DELIVERY_ORDER/${d.templateId}/${d.id}`)}>
                  <TableCell sx={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{d.name || "DO"}</TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>{d.date ? moment(d.date).format("DD/MM/YYYY") : ""}</TableCell>
                  <TableCell>
                    <StatusPill label={st.label} color={st.color} />
                  </TableCell>
                  <TableCell>{d.jobs.length ? d.jobs.map((j) => `#${j.deliveryNumber}`).join(", ") : "No job"}</TableCell>
                  <TableCell>
                    <IconButton
                      size="small"
                      aria-label="DO actions"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenu({ pos: { left: e.clientX, top: e.clientY }, d });
                      }}
                    >
                      <MoreVertIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      ) : (
        <Typography variant="body2" color="text.secondary">
          No DO yet. Use Add DO.
        </Typography>
      )}

      {/* The DO's menu: View DO, Complete DO, Add job, Customer sign link, Add service report. */}
      <Menu open={!!menu} onClose={() => setMenu(null)} anchorReference="anchorPosition" anchorPosition={menu?.pos}>
        {menu && menu.d.templateId && (
          <MenuItem onClick={() => { const d = menu.d; setMenu(null); router.push(`/portal/documents/DELIVERY_ORDER/${d.templateId}/${d.id}`); }}>View DO</MenuItem>
        )}
        {menu && !menu.d.completed && !cancelled && (
          <MenuItem onClick={() => { const d = menu.d; setMenu(null); onCompleteDo(d); }} data-tour="wct-order-complete-do">
            Complete DO
          </MenuItem>
        )}
        {menu && !menu.d.completed && !cancelled && <MenuItem onClick={() => void addJob(menu.d)}>Add job</MenuItem>}
        {menu && !menu.d.completed && !cancelled && (
          <MenuItem onClick={() => { const d = menu.d; setMenu(null); onSignLink(d); }}>Customer sign link</MenuItem>
        )}
        {menu && !cancelled && (
          <MenuItem onClick={() => { const d = menu.d; setMenu(null); onServiceReport(d); }}>Add service report</MenuItem>
        )}
      </Menu>
    </Box>
  );
}
