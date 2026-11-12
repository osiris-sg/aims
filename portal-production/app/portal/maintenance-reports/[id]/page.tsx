"use client";

import React, { useEffect, useRef, useState } from "react";
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
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  Typography,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import PrintIcon from "@mui/icons-material/Print";
import PictureAsPdfIcon from "@mui/icons-material/PictureAsPdf";
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
import ReportPhotos from "@/components/maintenance/ReportPhotos";
import CustomerSignLinkButton from "../_components/CustomerSignLinkButton";
import WctReportView from "../_components/WctReportView";
import PhotosFileControls, { type PhotosFile } from "../_components/PhotosFileControls";
import ReportFileView, { type ReportFileHandle } from "@/components/maintenance/ReportFileView";
import { fetchServiceReportFile, reportFileStem, saveBlob } from "@/helpers/serviceReportFileBlob";
import { msrStatusChip } from "@/helpers/msrStatus";

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
  /** WCT: created with the delivery run, not yet written by the technician. */
  scheduled?: boolean;
  // Stamped by the API when the report PDF was actually emailed to the customer.
  emailSentAt?: string;
  emailSentTo?: string;
  /** Filed from the office as an existing file (Upload Service Report). */
  uploaded?: boolean;
  uploadedFile?: { key: string; fileName: string; mimeType: string } | null;
  /** Optional photos attachment: one PDF or image. */
  photosFile?: PhotosFile;
}

interface MsrDetail {
  id: string;
  reportNumber: number | null;
  /** Optional proof photos (S3 keys), shown at the end. */
  photos?: string[] | null;
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
  /** Owning org's letterhead for the printed header; absent parts print nothing. */
  organization?: {
    logo: string | null;
    name?: string | null;
    address?: string | null;
    phoneNumber?: string | null;
    email?: string | null;
    website?: string | null;
    registrationNumber?: string | null;
  } | null;
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
  // "Service report" | "Photos" (tabs only when a photos file is attached).
  const [tab, setTab] = useState<"report" | "photos">("report");
  const [downloading, setDownloading] = useState(false);
  const photosView = useRef<ReportFileHandle>(null);

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
  const isUploaded = !!(sd.uploaded && sd.uploadedFile);
  const photosFile = sd.photosFile ?? null;
  const onPhotos = !!photosFile && tab === "photos";
  const fileStem = reportFileStem(report.reportNumber, report.id);
  const setPhotosFile = (next: PhotosFile) => {
    setReport((r) => (r ? { ...r, serviceData: { ...(r.serviceData ?? {}), photosFile: next } } : r));
    if (!next) setTab("report");
  };
  const photosControls = (
    <PhotosFileControls reportId={report.id} photosFile={photosFile} onChange={setPhotosFile} onError={setError} />
  );
  // Generic / ESS: the page itself is the report (Print = the browser's print);
  // Download PDF is the server's PDF of it.
  const downloadGenerated = async () => {
    setDownloading(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      saveBlob(await fetchServiceReportFile(report.id, "report", token), `${fileStem}.pdf`);
    } catch (e: any) {
      setError(e?.message ?? "Could not download the PDF");
    } finally {
      setDownloading(false);
    }
  };
  const tabs = photosFile ? (
    <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ borderBottom: 1, borderColor: "divider", "@media print": { display: "none" } }}>
      <Tab value="report" label="Service report" />
      <Tab value="photos" label="Photos" data-tour="service-report-photos-tab" />
    </Tabs>
  ) : null;
  const photosTab = (opts: { hideActions?: boolean } = {}) => (
    <ReportFileView
      ref={photosView}
      key={photosFile?.key}
      reportId={report.id}
      kind="photos"
      mimeType={photosFile?.mimeType}
      downloadName={`${fileStem}-photos`}
      hideActions={opts.hideActions}
      extraActions={photosControls}
    />
  );
  // A row with no stamped id is GENERIC_V1 — that is the entire back-compat
  // story for reports captured before templates existed.
  const templateId = templateFor(sd.templateId);
  const isEss = templateId === "ESS_V1";
  // The WCT paper is the server's own document; the page shows it as served.
  const isWct = templateId === "WCT_V1";
  const ess = sd.ess ?? null;
  const checkedSet = new Set(sd.checklist ?? []);
  const techSigUrl = sd.techSignatureKey ? `${RESOURCE_URL}${sd.techSignatureKey}` : null;
  const clientSigUrl = sd.clientSignatureKey ? `${RESOURCE_URL}${sd.clientSignatureKey}` : null;
  const org = report.organization ?? null;
  const orgLogo = org?.logo;
  const logoUrl = orgLogo ? (/^(https?:|data:)/i.test(orgLogo) ? orgLogo : `${RESOURCE_URL}${orgLogo}`) : null;

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
          {/* Only a report that was ACTUALLY sent says so (the API stamps
              serviceData.emailSentAt on a successful send). A finished report
              with no customer email says why nothing went out; a draft or
              scheduled report says nothing here. */}
          {!isUploaded && !report.paymentRequired && (report.serviceData as any)?.emailSentAt && (
            <Chip
              icon={<EmailIcon />}
              label={`Report emailed to customer${(report.serviceData as any)?.emailSentTo ? ` · ${(report.serviceData as any).emailSentTo}` : ""}`}
              color="success"
              variant="outlined"
            />
          )}
          {!isUploaded && !report.paymentRequired && report.status === "completed" && !(report.serviceData as any)?.emailSentAt && (
            <Chip
              icon={<EmailIcon />}
              label={(report.serviceData as any)?.clientEmail ? "Email not sent yet" : "Not emailed — no customer email on the report"}
              variant="outlined"
            />
          )}
          {/* Unsigned: let the customer sign remotely (one-use link). The WCT
              paper carries no customer signature, so it never offers one. */}
          {report.status !== "completed" && !isWct && !isUploaded && (
            <CustomerSignLinkButton reportId={report.id} hasTechSignature={!!(report.serviceData as any)?.techSignatureKey} />
          )}
          {/* Generic / ESS: the actions live here and follow the open tab. */}
          {!isWct && !isUploaded && (
            <>
              {photosControls}
              <Button
                variant="outlined"
                startIcon={downloading ? <CircularProgress size={16} color="inherit" /> : <PictureAsPdfIcon />}
                onClick={() => (onPhotos ? photosView.current?.download() : void downloadGenerated())}
                disabled={downloading}
                data-tour="service-report-download-pdf"
              >
                Download PDF
              </Button>
              <Button
                variant="contained"
                startIcon={<PrintIcon />}
                onClick={() => (onPhotos ? photosView.current?.print() : window.print())}
                data-tour="service-report-print"
              >
                Print
              </Button>
            </>
          )}
        </Stack>
      </Stack>

      {isWct && (
        <>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1}>
              <Box>
                <Typography variant="h6" fontWeight={700}>
                  Service Report #{report.reportNumber != null ? String(report.reportNumber).padStart(6, "0") : "—"}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {sd.customerName ?? "—"} · {sd.jobLocation ?? "—"} · {sd.serviceDate ?? "—"} · by {report.technicianName ?? "—"} · created {formatDateTime(report.createdAt)}
                </Typography>
              </Box>
              <Chip
                size="small"
                label={report.status === "draft" && sd.scheduled ? "Scheduled — awaiting the technician" : msrStatusChip(report).label}
                color={msrStatusChip(report).color}
                variant={msrStatusChip(report).variant}
              />
            </Stack>
          </Paper>
          {tabs}
          {onPhotos ? photosTab() : <WctReportView reportId={report.id} reportNumber={report.reportNumber} extraActions={photosControls} />}
        </>
      )}

      {isUploaded && (
        <>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1}>
              <Box>
                <Typography variant="h6" fontWeight={700}>
                  Service Report #{report.reportNumber ?? "—"}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {sd.customerName ?? "—"} · {sd.jobLocation ?? "—"} · {sd.serviceDate ?? "—"} · uploaded {formatDateTime(report.createdAt)}
                </Typography>
              </Box>
              <Stack direction="row" spacing={0.5}>
                <Chip size="small" label={msrStatusChip(report).label} color={msrStatusChip(report).color} variant={msrStatusChip(report).variant} />
                <Chip size="small" label="Uploaded" variant="outlined" />
              </Stack>
            </Stack>
          </Paper>
          {tabs}
          {onPhotos ? (
            photosTab()
          ) : (
            <ReportFileView
              key={sd.uploadedFile?.key}
              reportId={report.id}
              kind="report"
              mimeType={sd.uploadedFile?.mimeType}
              downloadName={fileStem}
              extraActions={photosControls}
            />
          )}
        </>
      )}

      {!isWct && !isUploaded && tabs}
      {!isWct && !isUploaded && onPhotos && photosTab({ hideActions: true })}

      {!isWct && !isUploaded && !onPhotos && (<>
      <Paper variant="outlined" sx={{ p: 3 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 2 }}>
          <Box>
            {/* COMPANY LETTERHEAD (guru 2026-11-05) — logo + contact details,
                the same block a delivery order carries. This page is what the
                Print button sends to the browser, so the printed report has to
                say who issued it and how to reach them. Every part is optional
                and an absent one renders nothing. */}
            <Stack direction="row" spacing={1.5} alignItems="flex-start" sx={{ mb: 1.5 }}>
              {/* White backing keeps a dark logo legible in dark mode. */}
              {logoUrl && (
                <Box
                  component="img"
                  src={logoUrl}
                  alt=""
                  sx={{ display: "block", maxHeight: 52, maxWidth: 150, objectFit: "contain", bgcolor: "#fff", p: 0.5, borderRadius: 0.5, flex: "none" }}
                />
              )}
              <Box>
                {org?.name && (
                  <Typography sx={{ fontWeight: 700, fontSize: "0.95rem", letterSpacing: "0.3px" }}>
                    {org.name.toUpperCase()}
                  </Typography>
                )}
                {org?.address && (
                  <Typography variant="body2" color="text.secondary" sx={{ fontSize: "0.75rem", lineHeight: 1.45 }}>
                    {org.address}
                  </Typography>
                )}
                {(org?.phoneNumber || org?.email) && (
                  <Typography variant="body2" color="text.secondary" sx={{ fontSize: "0.75rem", lineHeight: 1.45 }}>
                    {[org?.phoneNumber ? `Tel: ${org.phoneNumber}` : null, org?.email ? `Email: ${org.email}` : null]
                      .filter(Boolean)
                      .join("  ·  ")}
                  </Typography>
                )}
                {org?.website && (
                  <Typography variant="body2" color="text.secondary" sx={{ fontSize: "0.75rem", lineHeight: 1.45 }}>
                    {org.website}
                  </Typography>
                )}
                {org?.registrationNumber && (
                  <Typography variant="body2" color="text.secondary" sx={{ fontSize: "0.7rem" }}>
                    UEN: {org.registrationNumber}
                  </Typography>
                )}
              </Box>
            </Stack>
            <Divider sx={{ mb: 1.5 }} />
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
              label={msrStatusChip(report).label}
              color={msrStatusChip(report).color}
              variant={msrStatusChip(report).variant}
              sx={{ mt: 0.5 }}
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
              color="text.primary"
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

      {/* Optional photos, at the very end (nothing renders without any). On
          screen a grid that opens full size; printed as rows that never split. */}
      <Box className="msr-photos-screen">
        <ReportPhotos photos={report.photos} />
      </Box>
      <Box className="msr-photos-print">
        <ReportPhotos photos={report.photos} variant="print" />
      </Box>
      </>)}

      {/* Global print rules — strip the portal sidebar/navbar layout and keep
          only the report content. The toolbar above uses its own media query;
          this targets chrome that lives outside this component. */}
      <style jsx global>{`
        .msr-photos-print { display: none; }
        @media print {
          .msr-photos-screen { display: none !important; }
          .msr-photos-print { display: block !important; }
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
