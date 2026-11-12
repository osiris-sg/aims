"use client";

// Editing a service report (manual order flow, 2026-11-13; same permission as
// creating one). Uploaded report: Replace file (the number stays, the old file
// stays in the history) and Edit details (customer + DO required, service date,
// location). Report written on the form: Edit reopens the WCT form (a signed
// report loses its signature and is signed again; the signed copy stays in the
// history). Delete only while it has not been sent to the customer; the number
// stays a gap. Every change is in the Activity Log and the report's history.

import React, { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { useOrganization } from "@hooks/useOrganization";
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Stack, TextField, Typography } from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import moment from "moment";
import { toast } from "react-toastify";
import { request } from "@/helpers/request";
import { uploadFile } from "@/helpers/fileUploader";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";
import CustomerDoPicker from "./CustomerDoPicker";

const ACCEPT = "application/pdf,image/*";

export default function ReportEditActions({ report, isUploaded }: { report: { id: string; status: string; reportNumber: number | null; signature?: string | null; serviceData?: any }; isUploaded: boolean }) {
  const router = useRouter();
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const { isManualOrderFlowEnabled } = useOrganizationFeatures();
  const sd: any = report.serviceData ?? {};
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [details, setDetails] = useState(false);
  const [askEdit, setAskEdit] = useState(false);
  const [askDelete, setAskDelete] = useState(false);
  const [customer, setCustomer] = useState<{ id: string; name: string } | null>(sd.customerId ? { id: sd.customerId, name: sd.customerName ?? "" } : null);
  const [doId, setDoId] = useState<string | null>(sd.doDocumentId ?? null);
  const [serviceDate, setServiceDate] = useState<string>(String(sd.serviceDate ?? "").slice(0, 10));
  const [location, setLocation] = useState<string>(sd.jobLocation ?? "");
  const [error, setError] = useState<string | null>(null);
  if (!isManualOrderFlowEnabled) return null;

  const sent = !!(sd.customerSentAt || sd.emailSentAt);
  const signed = !!(report.signature || sd.clientSignatureKey);
  const call = async (what: string, path: string, method: "PUT" | "PATCH" | "POST" | "DELETE", body: any = {}) => {
    setBusy(what);
    setError(null);
    try {
      const token = await getToken();
      const res: any = await request({ path, method }, body, token ?? undefined);
      if (res?.success === false) throw new Error(res?.message || "Could not save");
      return res?.data ?? res ?? true;
    } catch (e: any) {
      setError(e?.message || "Could not save");
      toast.error(e?.message || "Could not save");
      return null;
    } finally {
      setBusy(null);
    }
  };

  const replaceFile = async (f?: File) => {
    if (!f || !organization?.id) return;
    try {
      setBusy("file");
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const up = await uploadFile({ file: f, folder: `maintenance-reports/${organization.id}/uploads`, token });
      const ok = await call("file", `/maintenance-reports/${report.id}/file`, "PUT", { fileKey: up.fileKey, fileName: up.fileName, mimeType: up.mimeType });
      if (ok) {
        toast.success("File replaced");
        window.location.reload();
      }
    } catch (e: any) {
      toast.error(e?.message || "Upload failed");
      setBusy(null);
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const saveDetails = async () => {
    if (!customer || !doId) return;
    const ok = await call("details", `/maintenance-reports/${report.id}/details`, "PATCH", { customerId: customer.id, doDocumentId: doId, serviceDate, location });
    if (ok) {
      setDetails(false);
      toast.success("Details saved");
      window.location.reload();
    }
  };

  const reopen = async () => {
    const ok = await call("edit", `/maintenance-reports/${report.id}/reopen`, "POST");
    if (ok) router.push(`/portal/maintenance-reports/${report.id}/form`);
  };

  const remove = async () => {
    const ok = await call("delete", `/maintenance-reports/${report.id}`, "DELETE");
    if (ok) {
      toast.success(`Service report${report.reportNumber != null ? ` #${report.reportNumber}` : ""} deleted`);
      router.push("/portal/maintenance-reports");
    }
  };

  return (
    <>
      {isUploaded ? (
        <>
          <input ref={fileRef} type="file" hidden accept={ACCEPT} onChange={(e) => void replaceFile(e.target.files?.[0])} />
          <Button variant="outlined" startIcon={busy === "file" ? <CircularProgress size={16} /> : <SwapHorizIcon />} disabled={!!busy} onClick={() => fileRef.current?.click()} data-tour="service-report-replace-file">
            Replace file
          </Button>
          <Button variant="outlined" startIcon={<EditIcon />} disabled={!!busy} onClick={() => setDetails(true)} data-tour="service-report-edit-details">
            Edit details
          </Button>
        </>
      ) : report.status === "completed" ? (
        <Button variant="outlined" startIcon={<EditIcon />} disabled={!!busy} onClick={() => (signed ? setAskEdit(true) : void reopen())} data-tour="service-report-edit">
          Edit
        </Button>
      ) : (
        <Button variant="outlined" startIcon={<EditIcon />} onClick={() => router.push(`/portal/maintenance-reports/${report.id}/form`)}>
          Continue on the form
        </Button>
      )}
      {!sent && (
        <Button variant="outlined" color="error" startIcon={<DeleteOutlineIcon />} disabled={!!busy} onClick={() => setAskDelete(true)} data-tour="service-report-delete">
          Delete report
        </Button>
      )}

      <Dialog open={details} onClose={busy ? undefined : () => setDetails(false)} fullWidth maxWidth="sm">
        <DialogTitle>Edit details</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <CustomerDoPicker customer={customer} doId={doId} onCustomer={setCustomer} onDo={(d) => setDoId(d?.id ?? null)} disabled={!!busy} />
            <TextField size="small" type="date" label="Service date" value={serviceDate} onChange={(e) => setServiceDate(e.target.value)} InputLabelProps={{ shrink: true }} fullWidth />
            <TextField size="small" label="Location" value={location} onChange={(e) => setLocation(e.target.value)} fullWidth />
            {error && <Alert severity="error">{error}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDetails(false)} disabled={!!busy}>
            Cancel
          </Button>
          <Button variant="contained" disableElevation onClick={() => void saveDetails()} disabled={!customer || !doId || !!busy}>
            Save
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={askEdit} onClose={() => setAskEdit(false)} fullWidth maxWidth="xs">
        <DialogTitle>Edit a signed report?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Editing clears the customer&apos;s signature: the report must be signed again when you complete it. The signed copy is kept in the report&apos;s history. The report number stays.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAskEdit(false)}>Cancel</Button>
          <Button variant="contained" color="warning" disableElevation onClick={() => { setAskEdit(false); void reopen(); }}>
            Edit and clear the signature
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={askDelete} onClose={busy ? undefined : () => setAskDelete(false)} fullWidth maxWidth="xs">
        <DialogTitle>Delete service report{report.reportNumber != null ? ` #${report.reportNumber}` : ""}?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            It has not been sent to the customer. It is removed from the lists, its order and its job. The number is not reused: it stays as a gap.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAskDelete(false)} disabled={!!busy}>
            Keep it
          </Button>
          <Button variant="contained" color="error" disableElevation onClick={() => void remove()} disabled={!!busy}>
            Delete report
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

/** The report's history (serviceData.history): what changed, old -> new. */
export function ReportHistory({ history }: { history?: any[] }) {
  const lines = Array.isArray(history) ? [...history].reverse() : [];
  if (!lines.length) return null;
  const show = (v: any) => (v == null || v === "" ? "(empty)" : String(v));
  return (
    <Box sx={{ mt: 3 }} data-tour="service-report-history">
      <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
        History
      </Typography>
      <Stack spacing={1}>
        {lines.map((h, i) => (
          <Box key={i} sx={{ borderLeft: 2, borderColor: "divider", pl: 1.5 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {h.action}
              <Typography component="span" variant="caption" color="text.secondary">
                {" "}
                · {h.at ? moment(h.at).format("DD/MM/YYYY HH:mm") : ""}
                {h.by ? ` · ${h.by}` : ""}
              </Typography>
            </Typography>
            {(h.changes ?? []).map((c: any, j: number) => (
              <Typography key={j} variant="caption" component="div" color="text.secondary">
                {c.field}: {show(c.from)} → {show(c.to)}
              </Typography>
            ))}
            {h.signedCopy && (
              <Typography variant="caption" component="div" color="text.secondary">
                Signed copy kept: signed by {h.signedCopy.signedByName || "the customer"}
                {h.signedCopy.signedAt ? ` on ${moment(h.signedCopy.signedAt).format("DD/MM/YYYY")}` : ""}
              </Typography>
            )}
            {h.oldFile?.fileName && (
              <Typography variant="caption" component="div" color="text.secondary">
                Previous file kept: {h.oldFile.fileName}
              </Typography>
            )}
          </Box>
        ))}
      </Stack>
    </Box>
  );
}
