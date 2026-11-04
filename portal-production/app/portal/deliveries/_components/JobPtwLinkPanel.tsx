"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

// WCT jobs calendar add (2026-11-04, enableWctOrders + enableJobsCalendar), on the job page:
//  - PTW: status (Not needed / Required / Submitted / Approved) + a short remark, on any job. Saved at once; the
//    SiteClock job's notes follow.
//  - "Link to…": a job with no order (made from the calendar) goes under the order of a quotation, an order, an
//    invoice or a DO. A quotation with no order gets one, with this job as its first job.

import React, { useEffect, useState } from "react";
import { Alert, Autocomplete, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Paper, Stack, TextField, Typography } from "@mui/material";
import LinkIcon from "@mui/icons-material/Link";
import { toast } from "react-toastify";
import { LINK_KINDS, PTW_OPTIONS, ptwColor, type LinkKind, type PtwStatus } from "@/helpers/calendarAdd";
import { useCalendarApi } from "@/components/Dashboard/jobs-calendar/calendarAddApi";

type Option = { id: string; label: string };

export default function JobPtwLinkPanel({
  run,
  onChanged,
}: {
  run: { id: string; status: string; order?: { id: string; orderNumber: string } | null; ptwStatus?: string | null; ptwRemark?: string | null };
  onChanged: () => void;
}) {
  const api = useCalendarApi();
  const [ptw, setPtw] = useState<PtwStatus>(((run.ptwStatus as PtwStatus) || "NOT_NEEDED") as PtwStatus);
  const [remark, setRemark] = useState(run.ptwRemark ?? "");
  const [saving, setSaving] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);

  useEffect(() => {
    setPtw(((run.ptwStatus as PtwStatus) || "NOT_NEEDED") as PtwStatus);
    setRemark(run.ptwRemark ?? "");
  }, [run.ptwStatus, run.ptwRemark]);

  const dirty = ptw !== ((run.ptwStatus as PtwStatus) || "NOT_NEEDED") || (ptw !== "NOT_NEEDED" && remark.trim() !== (run.ptwRemark ?? ""));
  const savePtw = async () => {
    setSaving(true);
    const res = await api("PATCH", `/deliveries/${run.id}/ptw`, { ptwStatus: ptw, ptwRemark: ptw === "NOT_NEEDED" ? "" : remark });
    setSaving(false);
    if (!res.ok) return toast.error(res.message || "Couldn't save the PTW");
    toast.success("PTW saved");
    onChanged();
  };

  const untagged = !run.order && run.status !== "cancelled";
  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
      <Stack direction={{ xs: "column", md: "row" }} spacing={2} alignItems={{ md: "center" }}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems={{ sm: "center" }} sx={{ flex: 1 }}>
          <TextField select label="PTW" size="small" value={ptw} onChange={(e) => setPtw(e.target.value as PtwStatus)} sx={{ minWidth: 160 }} data-tour="job-ptw">
            {PTW_OPTIONS.map((o) => (
              <MenuItem key={o.value} value={o.value}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: o.value === "NOT_NEEDED" ? "transparent" : ptwColor(o.value), border: o.value === "NOT_NEEDED" ? 1 : 0, borderColor: "divider" }} />
                  <span>{o.label}</span>
                </Stack>
              </MenuItem>
            ))}
          </TextField>
          {ptw !== "NOT_NEEDED" && <TextField label="PTW remark" size="small" value={remark} onChange={(e) => setRemark(e.target.value)} inputProps={{ maxLength: 300 }} sx={{ flex: 1, minWidth: 200 }} />}
          {dirty && (
            <Button size="small" variant="contained" onClick={() => void savePtw()} disabled={saving}>
              {saving ? "Saving…" : "Save PTW"}
            </Button>
          )}
        </Stack>
        {untagged && (
          <Stack direction="row" spacing={1} alignItems="center">
            <Chip size="small" label="Untagged" variant="outlined" color="warning" />
            <Button size="small" variant="outlined" startIcon={<LinkIcon />} onClick={() => setLinkOpen(true)} data-tour="job-link-to">
              Link to…
            </Button>
          </Stack>
        )}
      </Stack>
      <LinkDialog open={linkOpen} jobId={run.id} onClose={() => setLinkOpen(false)} onLinked={() => { setLinkOpen(false); onChanged(); }} />
    </Paper>
  );
}

function LinkDialog({ open, jobId, onClose, onLinked }: { open: boolean; jobId: string; onClose: () => void; onLinked: () => void }) {
  const api = useCalendarApi();
  const [kind, setKind] = useState<LinkKind>("quotation");
  const [input, setInput] = useState("");
  const [options, setOptions] = useState<Option[]>([]);
  const [picked, setPicked] = useState<Option | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmCustomer, setConfirmCustomer] = useState("");

  useEffect(() => {
    if (!open) return;
    setPicked(null);
    setError("");
    setConfirmCustomer("");
  }, [open, kind]);

  useEffect(() => {
    if (!open) return;
    let live = true;
    const t = setTimeout(async () => {
      setLoading(true);
      const k = LINK_KINDS.find((x) => x.value === kind)!;
      let next: Option[] = [];
      if (k.documentTypes) {
        const res = await api<any>("POST", "/documents/paginated", { documentTypes: k.documentTypes, search: input.trim(), limit: 20, page: 1 });
        next = (res.data?.docs ?? []).map((d: any) => ({ id: d.id, label: [d.name, d.associated_customer && d.associated_customer !== "N/A" ? d.associated_customer : null].filter(Boolean).join(" · ") }));
      } else {
        const res = await api<any[]>("GET", "/orders");
        const term = input.trim().toLowerCase();
        next = (Array.isArray(res.data) ? res.data : [])
          .map((o: any) => ({ id: o.id, label: [o.orderNumber, o.customer?.name, o.sourceQuotation?.name].filter(Boolean).join(" · ") }))
          .filter((o) => !term || o.label.toLowerCase().includes(term))
          .slice(0, 30);
      }
      if (live) {
        setOptions(next);
        setLoading(false);
      }
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [open, kind, input, api]);

  const link = async (confirm = false) => {
    if (!picked) return setError("Pick what to link the job to");
    setBusy(true);
    setError("");
    const res = await api<any>("POST", `/deliveries/${jobId}/link-order`, { kind, id: picked.id, ...(confirm ? { confirmCustomer: true } : {}) });
    setBusy(false);
    if (res.status === 409 && !confirm) return setConfirmCustomer(res.message || "The job and the order are for different customers. Link anyway?");
    if (!res.ok) return setError(res.message || "Couldn't link the job");
    const d = res.data || {};
    toast.success(`Linked to ${d.orderNumber}${d.createdOrder ? " (new order)" : ""}${d.linesAdded ? `, ${d.linesAdded} line(s) and its DO added` : ""}`);
    onLinked();
  };

  return (
    <Dialog open={open} onClose={() => !busy && onClose()} fullWidth maxWidth="sm">
      <DialogTitle>Link job to…</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          The job moves under that order, so it is billed with the order. A quotation with no order yet gets one, with this job as its first job.
        </Typography>
        <Stack spacing={2}>
          <TextField select label="Link to" size="small" value={kind} onChange={(e) => setKind(e.target.value as LinkKind)}>
            {LINK_KINDS.map((k) => (
              <MenuItem key={k.value} value={k.value}>
                {k.label}
              </MenuItem>
            ))}
          </TextField>
          <Autocomplete
            size="small"
            options={options}
            value={picked}
            onChange={(_e, v) => {
              setPicked(v);
              setConfirmCustomer("");
            }}
            onInputChange={(_e, v, reason) => {
              if (reason === "input") setInput(v);
            }}
            filterOptions={(x) => x}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            getOptionLabel={(o) => o.label}
            loading={loading}
            noOptionsText={input ? "Nothing matches" : "Type to search"}
            renderInput={(params) => (
              <TextField
                {...params}
                label={LINK_KINDS.find((k) => k.value === kind)!.label}
                placeholder="Search by number or customer"
                InputProps={{ ...params.InputProps, endAdornment: <>{loading ? <CircularProgress size={14} /> : null}{params.InputProps.endAdornment}</> }}
              />
            )}
          />
          {confirmCustomer && <Alert severity="warning">{confirmCustomer}</Alert>}
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        {confirmCustomer ? (
          <Button variant="contained" color="warning" onClick={() => void link(true)} disabled={busy}>
            Link anyway
          </Button>
        ) : (
          <Button variant="contained" onClick={() => void link()} disabled={busy || !picked}>
            {busy ? "Linking…" : "Link"}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
