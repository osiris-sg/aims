"use client";

// GST switch with company move (WCT group, 2026-11-24; API api-server-production/src/gst-switch/). On a saved invoice
// of WCT (S) / BC Air: "GST invoice" / "Non-GST invoice". Picking the other one moves the invoice's whole order to the
// sister company after a confirm pop-up that lists every document and the credit notes that will be issued.

import React, { useEffect, useState } from "react";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import { toast } from "react-toastify";
import { request } from "@/helpers/request";
import { crossOrgHref, safeOpenInOrg } from "@/helpers/crossOrg";
import { ACTIVE_ORG_KEY } from "@/helpers/multiOrg";
import { gstMoveRows, gstSwitchLabel, type GstPreview } from "@/helpers/gstSwitch";

export default function GstSwitchToggle({ documentId, disabled, beforeSwitch }: { documentId: string; disabled?: boolean; beforeSwitch?: () => Promise<boolean> }) {
  const { getToken } = useAuth();
  const [state, setState] = useState<{ on: boolean; companyGst: boolean; invoiceGst: boolean; partner: { id: string; name: string } | null; previousNumber: string | null } | null>(null);
  const [want, setWant] = useState<boolean | null>(null);
  const [preview, setPreview] = useState<GstPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [moving, setMoving] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res: any = await request({ path: `/gst-switch/${documentId}`, method: "GET", ownError: true }, {}, (await getToken()) ?? undefined);
        if (live) setState(res?.data ?? res);
      } catch {
        if (live) setState(null);
      }
    })();
    return () => {
      live = false;
    };
  }, [documentId, getToken]);

  if (!state?.on) return null;

  const pick = async (gst: boolean) => {
    if (gst === state.companyGst || loading) return;
    if (beforeSwitch && !(await beforeSwitch())) return;
    setWant(gst);
    setLoading(true);
    setPreview(null);
    try {
      const res: any = await request({ path: `/gst-switch/${documentId}/preview?gst=${gst}`, method: "GET", ownError: true }, {}, (await getToken()) ?? undefined);
      if (res?.success === false) throw new Error(res?.message || "Could not check the move");
      setPreview(res?.data ?? res);
    } catch (e: any) {
      toast.error(e?.message || "Could not check the move");
      setWant(null);
    } finally {
      setLoading(false);
    }
  };

  const move = async () => {
    if (want === null) return;
    setMoving(true);
    try {
      const res: any = await request({ path: `/gst-switch/${documentId}/move`, method: "POST", ownError: true }, { gst: want }, (await getToken()) ?? undefined);
      if (res?.success === false) throw new Error(res?.message || "Could not move");
      const out = res?.data ?? res;
      toast.success(`Moved to ${out?.to?.name ?? "the other company"}`);
      if (out?.moved && out?.to?.id && out?.invoiceId && out?.templateId) {
        // Straight to the invoice in the other company: set the tab's company, then one page load (no hop page).
        const target = safeOpenInOrg(out.to.id, `/portal/documents/INVOICE/${out.templateId}/${out.invoiceId}`);
        try {
          if (target) window.sessionStorage.setItem(ACTIVE_ORG_KEY, target.org);
        } catch {
          /* no sessionStorage: fall back to the hop page */
        }
        window.location.assign(target ? target.to : crossOrgHref(out.to.id, `/portal/documents/INVOICE/${out.templateId}/${out.invoiceId}`));
      } else {
        window.location.reload();
      }
    } catch (e: any) {
      toast.error(e?.message || "Could not move");
      setMoving(false);
    }
  };

  const close = () => {
    if (moving) return;
    setWant(null);
    setPreview(null);
  };
  const rows = preview ? gstMoveRows(preview) : [];

  return (
    <>
      <Box sx={{ display: "inline-flex", alignItems: "center", gap: 1 }} data-tour="editor-gst-switch">
        <ToggleButtonGroup size="small" exclusive value={state.companyGst ? "gst" : "non"} disabled={disabled || loading || moving}>
          <ToggleButton value="gst" onClick={() => void pick(true)} sx={{ py: 0.25, textTransform: "none" }}>
            {gstSwitchLabel(true)}
          </ToggleButton>
          <ToggleButton value="non" onClick={() => void pick(false)} sx={{ py: 0.25, textTransform: "none" }}>
            {gstSwitchLabel(false)}
          </ToggleButton>
        </ToggleButtonGroup>
        {loading && <CircularProgress size={14} />}
        {state.previousNumber && <Chip size="small" variant="outlined" label={`Previously ${state.previousNumber}`} />}
      </Box>
      <Dialog open={!!preview} onClose={close} fullWidth maxWidth="sm">
        <DialogTitle>{want ? gstSwitchLabel(true) : gstSwitchLabel(false)}</DialogTitle>
        <DialogContent>
          {preview?.blocked ? (
            <Alert severity="error">{preview.blocked}</Alert>
          ) : (
            <>
              <Typography sx={{ fontWeight: 600, mb: 1 }}>{preview?.headline}</Typography>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Document</TableCell>
                    <TableCell>Number</TableCell>
                    <TableCell>What happens</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.key}>
                      <TableCell>{r.kind}</TableCell>
                      <TableCell sx={{ fontVariantNumeric: "tabular-nums" }}>{r.name}</TableCell>
                      <TableCell>{r.action}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {!!preview?.creditNotes?.length && (
                <Box sx={{ mt: 2 }}>
                  <Typography sx={{ fontWeight: 600, mb: 0.5 }}>Credit notes to issue</Typography>
                  {preview.creditNotes.map((c) => (
                    <Typography key={c.invoiceId} variant="body2" sx={{ fontVariantNumeric: "tabular-nums" }}>
                      {c.already ? `${c.invoice}: already credited` : `${c.invoice}: credit note for ${Number(c.amount).toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}, then a new draft invoice in ${preview.to?.name}`}
                    </Typography>
                  ))}
                </Box>
              )}
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={close} disabled={moving}>
            {preview?.blocked ? "Close" : "Cancel"}
          </Button>
          {!preview?.blocked && (
            <Button variant="contained" disableElevation color="warning" onClick={() => void move()} disabled={moving} startIcon={moving ? <CircularProgress size={14} color="inherit" /> : undefined}>
              {`Move to ${preview?.to?.name ?? "the other company"}`}
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </>
  );
}
