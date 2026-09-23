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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import PrintIcon from "@mui/icons-material/Print";
import CheckBoxIcon from "@mui/icons-material/CheckBox";
import CheckBoxOutlineBlankIcon from "@mui/icons-material/CheckBoxOutlineBlank";
import ReceiptIcon from "@mui/icons-material/Receipt";
import EmailIcon from "@mui/icons-material/Email";
import { request } from "@/helpers/request";
import { GENERIC_CHECKLIST, TEMPLATE_LABELS, templateFor, type EssServiceData } from "@/lib/msr-templates";
// ONE implementation of the ESS layout, shared with the field app's print and
// download screens — see the docblock in that file.
import {
  FieldLabel,
  SignatureBlock,
  renderEssBody,
  renderEssConclusion,
} from "@/components/maintenance/EssReportView";

// Labels come from the SHARED catalogue (see the drift warning there). Which
// template a report renders under is read from the ROW's stamped templateId,
// never from its asset — an ESS asset's pre-template reports stay GENERIC.
const CHECKLIST_LABELS = GENERIC_CHECKLIST;

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
  templateId?: string | null;
  templateVersion?: number | null;
  ess?: EssServiceData | null;
}

interface MsrDetail {
  id: string;
  reportNumber: number | null;
  technicianName: string | null;
  createdAt: string;
  status: string;
  paymentRequired: boolean;
  invoiceDocumentId: string | null;
  serviceData: ServiceData | null;
  signedByName: string | null;
  asset: { id: string; name: string; skuKey: string } | null;
  inventory: { id: string; sku: string; serialNumber: string | null } | null;
  invoiceDocument: { id: string; documentTemplateId: string; name: string | null; status: string } | null;
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
  const [creatingInvoice, setCreatingInvoice] = useState(false);

  const createInvoice = async () => {
    if (!report) return;
    setError(null);
    setCreatingInvoice(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const res = await request(
        { path: `/maintenance-reports/${report.id}/create-invoice`, method: "POST" },
        {},
        token,
      );
      const payload = res?.data ?? res;
      const documentId: string | undefined = payload?.documentId;
      const templateId: string | undefined = payload?.templateId;
      if (!documentId || !templateId) {
        throw new Error("Invoice creation returned no document id");
      }
      router.push(`/portal/documents/INVOICE/${templateId}/${documentId}`);
    } catch (e: any) {
      setError(e?.message ?? "Failed to create invoice");
    } finally {
      setCreatingInvoice(false);
    }
  };

  const viewInvoice = () => {
    if (!report?.invoiceDocument) return;
    router.push(
      `/portal/documents/INVOICE/${report.invoiceDocument.documentTemplateId}/${report.invoiceDocument.id}`,
    );
  };

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
  // A row with no stamped id is GENERIC_V1 — that is the entire back-compat
  // story for reports captured before templates existed.
  const templateId = templateFor(sd.templateId);
  const isEss = templateId === "ESS_V1";
  const ess = sd.ess ?? null;
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
        flexWrap="wrap"
        gap={1}
        sx={{ "@media print": { display: "none" } }}
        className="msr-toolbar"
      >
        <Button startIcon={<ArrowBackIcon />} onClick={() => router.push("/portal/maintenance-reports")}>
          Back to list
        </Button>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
          {/* Invoice action — three mutually exclusive states. */}
          {report.paymentRequired && !report.invoiceDocument && (
            <Button
              variant="contained"
              color="warning"
              startIcon={<ReceiptIcon />}
              onClick={createInvoice}
              disabled={creatingInvoice}
            >
              {creatingInvoice ? "Creating..." : "Create Invoice"}
            </Button>
          )}
          {report.paymentRequired && report.invoiceDocument && (
            <Button
              variant="contained"
              startIcon={<ReceiptIcon />}
              onClick={viewInvoice}
            >
              View Invoice
            </Button>
          )}
          {!report.paymentRequired && (
            <Chip
              icon={<EmailIcon />}
              label="Report emailed to customer"
              color="success"
              variant="outlined"
            />
          )}
          <Button variant="contained" startIcon={<PrintIcon />} onClick={() => window.print()}>
            Print
          </Button>
        </Stack>
      </Stack>

      <Paper variant="outlined" sx={{ p: 3 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 2 }}>
          <Box>
            <Typography variant="h5" fontWeight={700}>{TEMPLATE_LABELS[templateId]}</Typography>
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

      {isEss && renderEssBody(ess)}

      {isEss ? null : (
      <Paper variant="outlined" sx={{ p: 3 }} className="msr-section">
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
      )}

      <Paper variant="outlined" sx={{ p: 3 }} className="msr-section">
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

      {/* Conclusion is the LAST thing before the signatures — the same slot
          the PDF puts it in, after the Remarks/Times block. Splitting body
          from conclusion is what lets the two renderers agree on order. */}
      {isEss && renderEssConclusion(ess)}

      <Paper variant="outlined" sx={{ p: 3 }} className="msr-section msr-signatures">
        <Typography variant="h6" fontWeight={700} sx={{ mb: 1.5 }}>Signatures</Typography>
        <Grid container spacing={3}>
          {/* ESS asks for an inspector AND a reviewer. The field technician is
              both, so the SAME signature and name print in both slots — there
              is no third pad and no second signer to chase. */}
          <Grid item xs={12} sm={isEss ? 4 : 6}>
            <Typography variant="caption" color="text.secondary">
              {isEss ? "Inspector (Technician)" : "Service By (Technician)"}
            </Typography>
            <SignatureBlock url={techSigUrl} name={report.technicianName ?? "—"} />
          </Grid>
          {isEss && (
            <Grid item xs={12} sm={4}>
              <Typography variant="caption" color="text.secondary">Reviewer (Technician)</Typography>
              <SignatureBlock url={techSigUrl} name={report.technicianName ?? "—"} />
            </Grid>
          )}
          <Grid item xs={12} sm={isEss ? 4 : 6}>
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
          /* An ESS report is ~6 pages. Without these it splits mid-category
             and straight through the signature row — the same rules the
             server PDF carries, kept deliberately in step with it. */
          @page { size: A4; margin: 12mm 12mm 14mm; }
          .msr-section,
          .msr-category,
          .msr-defects,
          .msr-poweron,
          .msr-signatures { break-inside: avoid; page-break-inside: avoid; }
          .msr-signatures { break-before: auto; }
        }
      `}</style>
    </Box>
  );
}
