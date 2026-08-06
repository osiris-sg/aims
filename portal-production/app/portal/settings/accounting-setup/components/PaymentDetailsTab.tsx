"use client";

// Payment Details (guru 2026-08-06): what the public "Click to pay" page
// shows customers — bank-transfer account details and an optional PayNow QR
// image. Stored in AccountingSetting.paymentDetails.

import React, { useEffect, useState } from "react";
import { Alert, Box, Button, CircularProgress, Paper, Stack, TextField, Typography } from "@mui/material";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import { useAuth } from "@clerk/nextjs";
import { toast } from "react-toastify";
import { uploadFile } from "@/helpers/fileUploader";

const RESOURCE_BASE =
  process.env.NEXT_PUBLIC_RESOURCE_URL ?? "https://aims-osiris.s3.ap-southeast-1.amazonaws.com/";

export default function PaymentDetailsTab({
  settings,
  loading,
  onSave,
}: {
  settings: any;
  loading: boolean;
  onSave: (updates: any) => Promise<void> | void;
}) {
  const { getToken } = useAuth();
  const [bank, setBank] = useState<any>({});
  const [paynowQrKey, setPaynowQrKey] = useState<string>("");
  const [uploading, setUploading] = useState(false);
  const fileRef = React.useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const pd = settings?.paymentDetails || {};
    setBank(pd.bank || {});
    setPaynowQrKey(pd.paynowQrKey || "");
  }, [settings]);

  const field = (key: string, label: string, placeholder = "") => (
    <TextField
      size="small"
      fullWidth
      label={label}
      placeholder={placeholder}
      value={bank[key] || ""}
      onChange={(e) => setBank((b: any) => ({ ...b, [key]: e.target.value }))}
    />
  );

  const uploadQr = async (file: File) => {
    setUploading(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");
      const up: any = await uploadFile({ file, folder: "payment-details", token });
      setPaynowQrKey(up?.fileKey || up?.key || "");
      toast.success("QR uploaded — remember to Save");
    } catch (e: any) {
      toast.error(e?.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const save = () =>
    onSave({ paymentDetails: { bank, ...(paynowQrKey ? { paynowQrKey } : {}) } });

  return (
    <Box>
      <Alert severity="info" sx={{ mb: 2 }}>
        These details appear on the public <b>Click to pay</b> page linked from invoice emails. Leave a section empty to
        hide it from customers.
      </Alert>

      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, mb: 2 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>Bank transfer details</Typography>
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2 }}>
          {field("accountName", "Account name", "e.g. OSIRIS TECHNOLOGY PTE. LTD.")}
          {field("accountNumber", "Account number", "e.g. 885215591474")}
          {field("bankName", "Bank name", "e.g. DBS Bank Ltd")}
          {field("branchCode", "Branch code", "e.g. 001")}
          {field("bankCode", "Bank code", "e.g. 7171")}
          {field("currencyCode", "Currency code", "e.g. SGD")}
        </Box>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, mb: 2 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>PayNow QR</Typography>
        <Typography variant="caption" sx={{ color: "text.secondary", display: "block", mb: 1.5 }}>
          Upload the company PayNow QR image — customers scan it straight from the payment page.
        </Typography>
        <input
          hidden
          ref={fileRef}
          type="file"
          accept="image/*"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void uploadQr(f);
            e.target.value = "";
          }}
        />
        <Stack direction="row" gap={2} alignItems="center">
          <Button
            variant="outlined"
            startIcon={uploading ? <CircularProgress size={14} /> : <CloudUploadIcon />}
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
          >
            {paynowQrKey ? "Replace QR image" : "Upload QR image"}
          </Button>
          {paynowQrKey && (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`${RESOURCE_BASE}${paynowQrKey}`} alt="PayNow QR" style={{ maxHeight: 120, borderRadius: 8 }} />
              <Button size="small" color="error" startIcon={<DeleteOutlineIcon />} onClick={() => setPaynowQrKey("")}>
                Remove
              </Button>
            </>
          )}
        </Stack>
      </Paper>

      <Button variant="contained" onClick={save} disabled={loading}>
        Save payment details
      </Button>
    </Box>
  );
}
