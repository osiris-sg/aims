"use client";

// Manual order flow (2026-11-13): "+ New Report" in the office. Pick the
// customer and one of their DOs, then the WCT service report form opens (the
// same form the field app fills); the report gets its number on completion.
import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { Alert, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Stack } from "@mui/material";
import { request } from "@/helpers/request";
import CustomerDoPicker from "./CustomerDoPicker";

export default function NewServiceReportDialog({
  open,
  onClose,
  prefill,
}: {
  open: boolean;
  onClose: () => void;
  prefill?: { customer: { id: string; name: string } | null; doId?: string | null };
}) {
  const router = useRouter();
  const { getToken } = useAuth();
  const [customer, setCustomer] = useState<{ id: string; name: string } | null>(null);
  const [doId, setDoId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setCustomer(prefill?.customer ?? null);
    setDoId(prefill?.doId ?? null);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const start = async () => {
    if (!customer || !doId) return;
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      const res: any = await request({ path: "/maintenance-reports/office", method: "POST" }, { customerId: customer.id, doDocumentId: doId }, token ?? undefined);
      if (res?.success === false) throw new Error(res?.message || "Could not start the report");
      const r = res?.data ?? res;
      router.push(`/portal/maintenance-reports/${r.id}/form`);
    } catch (e: any) {
      setError(e?.message || "Could not start the report");
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>New service report</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <CustomerDoPicker customer={customer} doId={doId} onCustomer={setCustomer} onDo={(d) => setDoId(d?.id ?? null)} disabled={busy} />
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="contained" disableElevation onClick={() => void start()} disabled={!customer || !doId || busy} startIcon={busy ? <CircularProgress size={16} color="inherit" /> : undefined}>
          Open the report form
        </Button>
      </DialogActions>
    </Dialog>
  );
}
