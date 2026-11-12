"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import { request } from "@/helpers/request";
import { uploadFile } from "@/helpers/fileUploader";
import { todayIso } from "@/helpers/orgToday";
import CustomerPicker from "@/components/CustomerPicker";
import { useOrganization } from "@hooks/useOrganization";
import { REPORT_FILE_ACCEPT } from "./PhotosFileControls";

type OrderOption = { id: string; orderNumber?: string | null; customerId?: string | null; customer?: { id: string; name: string } | null };

const ALLOWED = REPORT_FILE_ACCEPT.split(",");

/**
 * "Upload Service Report" (2026-11-12): file a report that already exists as a
 * PDF or an image. No AI reading: the office fills the few fields itself.
 * The report gets the org's next number, is stored completed and is never
 * emailed. Order (WCT orders only) links it through the order's attachments.
 */
export default function UploadServiceReportDialog({
  open,
  onClose,
  onUploaded,
  wctOrders,
}: {
  open: boolean;
  onClose: () => void;
  onUploaded: (report: { id: string; reportNumber: number | null }) => void;
  wctOrders: boolean;
}) {
  const { getToken } = useAuth();
  const { organization } = useOrganization();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [location, setLocation] = useState("");
  const [serviceDate, setServiceDate] = useState(todayIso());
  const [order, setOrder] = useState<OrderOption | null>(null);
  const [orders, setOrders] = useState<OrderOption[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setFile(null);
    setCustomerId(null);
    setLocation("");
    setServiceDate(todayIso());
    setOrder(null);
    setError(null);
  }, [open]);

  // Orders load once, the first time the dialog opens in a WCT-orders org.
  useEffect(() => {
    if (!open || !wctOrders || orders) return;
    let cancelled = false;
    (async () => {
      const token = await getToken();
      if (!token) return;
      const res: any = await request({ path: "/orders", method: "GET" }, {}, token);
      const list = res?.data ?? res;
      if (!cancelled) setOrders(Array.isArray(list) ? list : []);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, wctOrders, orders, getToken]);

  const orderOptions = useMemo(
    () => (orders ?? []).filter((o) => !customerId || (o.customer?.id ?? o.customerId) === customerId),
    [orders, customerId],
  );

  const choose = (f: File | undefined) => {
    if (!f) return;
    if (!ALLOWED.includes(f.type)) {
      setError("Pick a PDF or an image (JPG, PNG, WEBP, GIF).");
      return;
    }
    setError(null);
    setFile(f);
  };

  const submit = async () => {
    if (!file || !organization?.id) return;
    setSaving(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const up = await uploadFile({ file, folder: `maintenance-reports/${organization.id}/uploads`, token });
      const res: any = await request(
        { path: "/maintenance-reports/upload", method: "POST" },
        {
          fileKey: up.fileKey,
          fileName: up.fileName,
          mimeType: up.mimeType,
          ...(customerId ? { customerId } : {}),
          ...(location.trim() ? { location: location.trim() } : {}),
          ...(serviceDate ? { serviceDate } : {}),
          ...(order ? { orderId: order.id } : {}),
        },
        token,
      );
      if (res?.success === false) throw new Error(res.message || "Could not upload the report");
      const created = res?.data ?? res;
      onUploaded({ id: created.id, reportNumber: created.reportNumber ?? null });
    } catch (e: any) {
      setError(e?.message ?? "Could not upload the report");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Upload Service Report</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <input ref={input} type="file" hidden accept={REPORT_FILE_ACCEPT} onChange={(e) => choose(e.target.files?.[0])} />
          <Box
            onClick={() => input.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              choose(e.dataTransfer.files?.[0]);
            }}
            sx={{
              border: "1px dashed",
              borderColor: file ? "primary.main" : "divider",
              borderRadius: 1,
              p: 2.5,
              textAlign: "center",
              cursor: "pointer",
              "&:hover": { bgcolor: "action.hover" },
            }}
          >
            <CloudUploadIcon color={file ? "primary" : "action"} />
            <Typography variant="body2" sx={{ mt: 0.5 }}>
              {file ? file.name : "Choose the report file (PDF or image), or drop it here"}
            </Typography>
          </Box>
          <CustomerPicker value={customerId} onChange={(c) => { setCustomerId(c?.id ?? null); setOrder(null); }} label="Customer (optional)" />
          <TextField size="small" label="Location (optional)" value={location} onChange={(e) => setLocation(e.target.value)} fullWidth />
          <TextField
            size="small"
            type="date"
            label="Service date"
            value={serviceDate}
            onChange={(e) => setServiceDate(e.target.value)}
            InputLabelProps={{ shrink: true }}
            fullWidth
          />
          {wctOrders && (
            <Autocomplete
              size="small"
              options={orderOptions}
              loading={!orders}
              value={order}
              onChange={(_, v) => setOrder(v)}
              getOptionLabel={(o) => [o.orderNumber || o.id.slice(0, 8), o.customer?.name].filter(Boolean).join(" · ")}
              isOptionEqualToValue={(a, b) => a.id === b.id}
              renderInput={(params) => <TextField {...params} label="Order (optional)" />}
            />
          )}
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={() => void submit()}
          disabled={!file || saving}
          startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <CloudUploadIcon />}
        >
          {saving ? "Uploading…" : "Upload"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
