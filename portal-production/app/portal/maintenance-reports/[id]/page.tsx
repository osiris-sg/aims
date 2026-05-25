"use client";

import React, { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Grid,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import PrintIcon from "@mui/icons-material/Print";
import CheckBoxIcon from "@mui/icons-material/CheckBox";
import CheckBoxOutlineBlankIcon from "@mui/icons-material/CheckBoxOutlineBlank";
import { request } from "@/helpers/request";

// Mirror of the printed-form checklist used when the field tech submitted the
// report. Persisted reports only store the checked index array, so we render
// labels client-side. If the form labels evolve, historical reports will
// keep showing the v1 labels — intentional, the indices are stable.
const CHECKLIST_LABELS: { id: number; label: string }[] = [
  { id: 1, label: "Control panel" },
  { id: 2, label: "PLC" },
  { id: 3, label: "HMI" },
  { id: 4, label: "Power voltage" },
  { id: 5, label: "Frequency" },
  { id: 6, label: "Backwash pump" },
  { id: 7, label: "Submersible pump" },
  { id: 8, label: "Aerator" },
  { id: 9, label: "Suction pump" },
  { id: 10, label: "Air scouring pump" },
  { id: 11, label: "Turbula pump" },
  { id: 12, label: "3 way valve" },
  { id: 13, label: "1 way valve" },
  { id: 14, label: "Backwash valve" },
  { id: 15, label: "Discharge valve" },
  { id: 16, label: "X-flow valve" },
  { id: 17, label: "Product valve" },
  { id: 18, label: "Pump relief valve" },
  { id: 19, label: "Holding tank level sensor" },
  { id: 20, label: "MBR tank level sensor" },
  { id: 21, label: "Product tank level sensor" },
  { id: 22, label: "Filtration pressure" },
  { id: 23, label: "Backwash pressure" },
  { id: 24, label: "Electric wire" },
  { id: 25, label: "Flow rate" },
  { id: 26, label: "" },
  { id: 27, label: "" },
  { id: 28, label: "" },
  { id: 29, label: "" },
  { id: 30, label: "" },
];

const RESOURCE_URL =
  process.env.NEXT_PUBLIC_RESOURCE_URL ?? "https://aims-osiris.s3.ap-southeast-1.amazonaws.com/";

interface ServiceData {
  customerName?: string | null;
  clientEmail?: string | null;
  jobLocation?: string | null;
  model?: string | null;
  serial?: string | null;
  serviceDate?: string | null;
  nextServiceDate?: string | null;
  timeIn?: string | null;
  timeOut?: string | null;
  checklist?: number[];
  remarks?: string | null;
  techSignatureKey?: string | null;
  clientSignatureKey?: string | null;
  clientSignerName?: string | null;
}

interface MsrDetail {
  id: string;
  reportNumber: number | null;
  technicianName: string | null;
  createdAt: string;
  status: string;
  serviceData: ServiceData | null;
  signedByName: string | null;
  asset: { id: string; name: string; skuKey: string } | null;
  inventory: { id: string; sku: string; serialNumber: string | null } | null;
}

const formatDateTime = (iso?: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
};

const formatTimeOnly = (iso?: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

export default function MaintenanceReportDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { getToken } = useAuth();
  const id = params?.id as string;

  const [report, setReport] = useState<MsrDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        if (!token) throw new Error("Not signed in");
        const res = await request(
          { path: `/maintenance-reports/${id}`, method: "GET" },
          {},
          token,
        );
        if (cancelled) return;
        const payload = (res?.data ?? res) as MsrDetail;
        setReport(payload);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Failed to load report");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, getToken]);

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", height: "50vh" }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error || !report) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{error ?? "Report not found"}</Alert>
        <Button sx={{ mt: 2 }} startIcon={<ArrowBackIcon />} onClick={() => router.push("/portal/maintenance-reports")}>
          Back to list
        </Button>
      </Box>
    );
  }

  const sd = report.serviceData ?? {};
  const checkedSet = new Set(sd.checklist ?? []);
  const techSigUrl = sd.techSignatureKey ? `${RESOURCE_URL}${sd.techSignatureKey}` : null;
  const clientSigUrl = sd.clientSignatureKey ? `${RESOURCE_URL}${sd.clientSignatureKey}` : null;

  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2 }}>
      {/* Toolbar — hidden in print so the printed page has no nav chrome. */}
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        sx={{ "@media print": { display: "none" } }}
        className="msr-toolbar"
      >
        <Button startIcon={<ArrowBackIcon />} onClick={() => router.push("/portal/maintenance-reports")}>
          Back to list
        </Button>
        <Button variant="contained" startIcon={<PrintIcon />} onClick={() => window.print()}>
          Print
        </Button>
      </Stack>

      <Paper variant="outlined" sx={{ p: 3 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 2 }}>
          <Box>
            <Typography variant="h5" fontWeight={700}>Maintenance &amp; Inspection Service Report</Typography>
            <Typography variant="body2" color="text.secondary">
              Created {formatDateTime(report.createdAt)}
            </Typography>
          </Box>
          <Box sx={{ textAlign: "right" }}>
            <Typography variant="caption" color="text.secondary">Report #</Typography>
            <Typography variant="h4" fontWeight={700} sx={{ lineHeight: 1.1 }}>
              {report.reportNumber ?? "—"}
            </Typography>
            <Chip
              size="small"
              label={report.status}
              color={report.status === "completed" ? "success" : "default"}
              sx={{ mt: 0.5, textTransform: "capitalize" }}
            />
          </Box>
        </Stack>

        <Divider sx={{ mb: 2 }} />

        {/* Header grid — paper-form-style two-column data block. */}
        <Grid container spacing={2}>
          <Grid item xs={12} sm={6}>
            <FieldLabel label="Company Name" value={sd.customerName} />
            <FieldLabel label="Client Email" value={sd.clientEmail} />
            <FieldLabel label="Job Location" value={sd.jobLocation} />
            <FieldLabel label="Technician" value={report.technicianName} />
          </Grid>
          <Grid item xs={12} sm={6}>
            <FieldLabel label="Model" value={sd.model ?? report.asset?.name} />
            <FieldLabel label="Serial No" value={sd.serial ?? report.inventory?.serialNumber ?? report.inventory?.sku} />
            <FieldLabel label="Service Date" value={sd.serviceDate} />
            <FieldLabel label="Next Service Date" value={sd.nextServiceDate} />
          </Grid>
        </Grid>
      </Paper>

      <Paper variant="outlined" sx={{ p: 3 }}>
        <Typography variant="h6" fontWeight={700} sx={{ mb: 1.5 }}>Checklist</Typography>
        <Grid container spacing={0.5}>
          {CHECKLIST_LABELS.map((item) => {
            const isChecked = checkedSet.has(item.id);
            const isBlank = !item.label;
            return (
              <Grid item xs={12} sm={6} key={item.id}>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ py: 0.5 }}>
                  {isChecked ? (
                    <CheckBoxIcon fontSize="small" color="primary" />
                  ) : (
                    <CheckBoxOutlineBlankIcon fontSize="small" sx={{ color: "action.disabled" }} />
                  )}
                  <Typography
                    variant="body2"
                    sx={{
                      color: isBlank ? "text.disabled" : isChecked ? "text.primary" : "text.secondary",
                      fontWeight: isChecked ? 600 : 400,
                    }}
                  >
                    {item.id}. {item.label || " "}
                  </Typography>
                </Stack>
              </Grid>
            );
          })}
        </Grid>
      </Paper>

      <Paper variant="outlined" sx={{ p: 3 }}>
        <Typography variant="h6" fontWeight={700} sx={{ mb: 1.5 }}>Remarks &amp; Times</Typography>
        <Grid container spacing={2}>
          <Grid item xs={6} sm={3}>
            <FieldLabel label="Time In" value={formatTimeOnly(sd.timeIn)} />
          </Grid>
          <Grid item xs={6} sm={3}>
            <FieldLabel label="Time Out" value={formatTimeOnly(sd.timeOut)} />
          </Grid>
          <Grid item xs={12}>
            <Typography variant="caption" color="text.secondary">Remarks</Typography>
            <Typography
              variant="body2"
              sx={{
                mt: 0.5,
                whiteSpace: "pre-wrap",
                p: 1.5,
                bgcolor: "action.hover",
                borderRadius: 1,
                minHeight: 60,
              }}
            >
              {sd.remarks || "—"}
            </Typography>
          </Grid>
        </Grid>
      </Paper>

      <Paper variant="outlined" sx={{ p: 3 }}>
        <Typography variant="h6" fontWeight={700} sx={{ mb: 1.5 }}>Signatures</Typography>
        <Grid container spacing={3}>
          <Grid item xs={12} sm={6}>
            <Typography variant="caption" color="text.secondary">Service By (Technician)</Typography>
            <SignatureBlock url={techSigUrl} name={report.technicianName ?? "—"} />
          </Grid>
          <Grid item xs={12} sm={6}>
            <Typography variant="caption" color="text.secondary">Client</Typography>
            <SignatureBlock url={clientSigUrl} name={sd.clientSignerName ?? report.signedByName ?? "—"} />
          </Grid>
        </Grid>
      </Paper>

      {/* Global print rules — strip the portal sidebar/navbar layout and keep
          only the report content. The toolbar above uses its own media query;
          this targets chrome that lives outside this component. */}
      <style jsx global>{`
        @media print {
          aside, nav, header { display: none !important; }
          .MuiDrawer-root { display: none !important; }
          body { background: white !important; }
        }
      `}</style>
    </Box>
  );
}

function FieldLabel({ label, value }: { label: string; value?: string | null }) {
  return (
    <Box sx={{ mb: 1.5 }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
        {label}
      </Typography>
      <Typography variant="body2" fontWeight={500}>
        {value ?? "—"}
      </Typography>
    </Box>
  );
}

function SignatureBlock({ url, name }: { url: string | null; name: string }) {
  return (
    <Box
      sx={{
        mt: 0.5,
        p: 1.5,
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 1,
        bgcolor: "background.paper",
        minHeight: 140,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
      }}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={`Signature of ${name}`}
          style={{ maxWidth: "100%", maxHeight: 100, objectFit: "contain" }}
        />
      ) : (
        <Box sx={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Typography variant="caption" color="text.disabled">No signature on file</Typography>
        </Box>
      )}
      <Typography variant="body2" fontWeight={500} sx={{ mt: 1, pt: 1, borderTop: "1px dashed", borderColor: "divider" }}>
        {name}
      </Typography>
    </Box>
  );
}
