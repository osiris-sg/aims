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
  DialogTitle,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import MainCard from "@/components/MainCard";
import { request } from "@/helpers/request";
import { photoSrc } from "@/components/maintenance/ReportPhotos";
import { siteclockEvidenceCaption } from "@/helpers/jobPhotos";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";
import { VERIFICATION_COLOR, VerificationState, completionModeLabel, rejectProblem, verificationLabel } from "@/helpers/wctFinishModes";
import { fmtJobWhen } from "@/helpers/wctOrders";

// WCT finish modes (enableWctFinishModes, 2026-11-01): jobs finished with a
// photo of the stamped DO or "paper copy later", waiting for the office. A row
// opens the job (its page has the photos and the same Verify / Reject); the
// kebab verifies or rejects from here.
interface QueueRow {
  id: string;
  deliveryNumber: number;
  completedAt: string | null;
  siteAddress: string | null;
  rider: string | null;
  customer: { id: string; name: string } | null;
  order: { id: string; orderNumber: string } | null;
  deliveryOrder: { id: string; name: string | null; templateId: string } | null;
  completionMode: string | null;
  completionNote: string | null;
  photos: string[];
  /** Which of the photos came from SiteClock (job photos). */
  siteclockPhotos?: Array<{ key: string; workerName: string | null }>;
  verificationState: VerificationState;
  verificationNote: string | null;
}

export default function VerificationQueuePage() {
  const router = useRouter();
  const { getToken } = useAuth();
  const { isWctFinishModesEnabled, isLoading } = useOrganizationFeatures();
  const [tab, setTab] = useState<"pending" | "rejected">("pending");
  const [rows, setRows] = useState<QueueRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ pos: { left: number; top: number }; row: QueueRow } | null>(null);
  const [rejecting, setRejecting] = useState<QueueRow | null>(null);
  const [reason, setReason] = useState("");
  const [working, setWorking] = useState(false);

  const load = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) return;
      const res = await request({ path: `/deliveries/verification?state=${tab}`, method: "GET" }, {}, token);
      if (res?.success === false) throw new Error(res?.message || "Failed to load");
      setRows(Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : []);
      setError(null);
    } catch (e: any) {
      setError(e?.message || "Failed to load");
      setRows([]);
    }
  }, [getToken, tab]);

  useEffect(() => {
    if (isWctFinishModesEnabled) void load();
  }, [load, isWctFinishModesEnabled]);

  const act = async (row: QueueRow, kind: "verify" | "reject", body: any = {}) => {
    setWorking(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const res = await request({ path: `/deliveries/${row.id}/${kind}`, method: "POST" }, body, token);
      if (res?.success === false) throw new Error(res?.message || "Could not save");
      await load();
      return true;
    } catch (e: any) {
      setError(e?.message || "Could not save");
      return false;
    } finally {
      setWorking(false);
    }
  };

  if (isLoading) return null;
  if (!isWctFinishModesEnabled) {
    return (
      <MainCard>
        <Alert severity="info">Job verification is not enabled for this organisation.</Alert>
      </MainCard>
    );
  }

  return (
    <MainCard>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
        <IconButton size="small" onClick={() => router.push("/portal/deliveries")} aria-label="Back to deliveries">
          <ArrowBackIcon fontSize="small" />
        </IconButton>
        <Typography variant="h5" fontWeight={700}>
          Awaiting verification
        </Typography>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Jobs finished with a photo of the stamped DO, or marked completed with the paper copy to follow. Verify them once the stamped DO or the paper copy is right; reject with a reason to send them back.
      </Typography>
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2, borderBottom: 1, borderColor: "divider" }}>
        <Tab value="pending" label="To verify" sx={{ textTransform: "none" }} />
        <Tab value="rejected" label="Rejected" sx={{ textTransform: "none" }} />
      </Tabs>
      {error && (
        <Alert severity="warning" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {rows === null ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
          <CircularProgress />
        </Box>
      ) : rows.length === 0 ? (
        <Alert severity="success">{tab === "pending" ? "Nothing waiting for verification." : "No rejected jobs."}</Alert>
      ) : (
        <TableContainer sx={{ border: 1, borderColor: "divider", borderRadius: 1 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Job</TableCell>
                <TableCell>Order</TableCell>
                <TableCell>Customer</TableCell>
                <TableCell>Completed</TableCell>
                <TableCell>Sign-off</TableCell>
                <TableCell>Evidence</TableCell>
                <TableCell>State</TableCell>
                <TableCell padding="checkbox" />
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id} hover sx={{ cursor: "pointer" }} onClick={() => router.push(`/portal/deliveries/${r.id}`)}>
                  <TableCell sx={{ fontWeight: 600 }}>#{r.deliveryNumber}</TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>{r.order?.orderNumber || "—"}</TableCell>
                  <TableCell>{r.customer?.name || "—"}</TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>{fmtJobWhen(r.completedAt)}</TableCell>
                  <TableCell>
                    {completionModeLabel(r.completionMode)}
                    {r.rider && (
                      <Typography variant="caption" color="text.secondary" component="div">
                        by {r.rider}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.75} alignItems="center">
                      {r.photos.slice(0, 3).map((k) => (
                        <Box key={k} component="img" src={photoSrc(k)} alt="Stamped DO" title={siteclockEvidenceCaption(k, r.siteclockPhotos) ?? undefined} sx={{ width: 44, height: 44, objectFit: "cover", borderRadius: 0.5, border: 1, borderColor: "divider" }} />
                      ))}
                      {r.completionNote && (
                        <Typography variant="body2" color="text.secondary" noWrap sx={{ maxWidth: 220 }} title={r.completionNote}>
                          {r.completionNote}
                        </Typography>
                      )}
                      {!r.photos.length && !r.completionNote && "—"}
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Chip size="small" color={VERIFICATION_COLOR[r.verificationState]} label={verificationLabel(r.verificationState)} />
                    {r.verificationState === "rejected" && r.verificationNote && (
                      <Typography variant="caption" color="error" component="div" sx={{ maxWidth: 220 }}>
                        {r.verificationNote}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell padding="checkbox" onClick={(e) => e.stopPropagation()}>
                    <IconButton
                      size="small"
                      aria-label="More actions"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenu({ pos: { left: e.clientX, top: e.clientY }, row: r });
                      }}
                    >
                      <MoreVertIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Menu anchorReference="anchorPosition" anchorPosition={menu?.pos} open={!!menu} onClose={() => setMenu(null)}>
        <MenuItem
          disabled={working}
          onClick={() => {
            const r = menu!.row;
            setMenu(null);
            void act(r, "verify");
          }}
        >
          Verify
        </MenuItem>
        <MenuItem
          disabled={working || menu?.row.verificationState !== "pending"}
          sx={{ color: "error.main" }}
          onClick={() => {
            const r = menu!.row;
            setMenu(null);
            setReason("");
            setRejecting(r);
          }}
        >
          Reject…
        </MenuItem>
        <MenuItem
          disabled={!menu?.row.deliveryOrder}
          onClick={() => {
            const d = menu!.row.deliveryOrder!;
            setMenu(null);
            router.push(`/portal/documents/DELIVERY_ORDER/${d.templateId}/${d.id}`);
          }}
        >
          View DO
        </MenuItem>
      </Menu>

      <Dialog open={!!rejecting} onClose={() => setRejecting(null)} fullWidth maxWidth="xs">
        <DialogTitle>Reject job #{rejecting?.deliveryNumber}</DialogTitle>
        <DialogContent>
          <TextField autoFocus fullWidth multiline minRows={2} label="Reason (the worker sees this)" value={reason} onChange={(e) => setReason(e.target.value)} sx={{ mt: 1 }} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRejecting(null)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            disableElevation
            disabled={working}
            onClick={async () => {
              const p = rejectProblem(reason);
              if (p) return setError(p);
              if (rejecting && (await act(rejecting, "reject", { reason: reason.trim() }))) setRejecting(null);
            }}
          >
            Reject
          </Button>
        </DialogActions>
      </Dialog>
    </MainCard>
  );
}
