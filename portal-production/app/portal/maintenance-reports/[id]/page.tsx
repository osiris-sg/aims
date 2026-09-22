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
import ReceiptIcon from "@mui/icons-material/Receipt";
import EmailIcon from "@mui/icons-material/Email";
import { request } from "@/helpers/request";
import {
  ESS_CATEGORIES,
  ESS_POWER_ON_TESTS,
  ESS_HEADER_FIXED,
  ESS_SUMMARY_FIXED,
  GENERIC_CHECKLIST,
  essDefectSummary,
  essRecommendations,
  TEMPLATE_LABELS,
  essItemKey,
  isOverridden,
  templateFor,
  type EssMeasure,
  type EssServiceData,
} from "@/lib/msr-templates";

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
          {isEss && ess && (
            <>
              <Grid item xs={12}><Divider /></Grid>
              <Grid item xs={12} sm={6}>
                <FieldLabel label="Equipment ID" value={ess.header?.equipmentId} />
                <FieldLabel label="Site" value={ess.header?.site} />
                <FieldLabel label="Inspection Date" value={ess.header?.inspectionDate} />
              </Grid>
              <Grid item xs={12} sm={6}>
                <FieldLabel label="Inspection Type" value={ess.header?.inspectionType} />
                <FieldLabel
                  label="Rated Power"
                  value={ess.header?.ratedPowerKw != null ? `${ess.header.ratedPowerKw} kW` : null}
                />
                <FieldLabel
                  label="Rated Capacity"
                  value={ess.header?.ratedCapacityKwh != null ? `${ess.header.ratedCapacityKwh} kWh` : null}
                />
              </Grid>
              {/* Fixed text from the reference — printed, never captured. */}
              {ESS_HEADER_FIXED.map((f) => (
                <Grid item xs={12} key={f.label}>
                  <FieldLabel label={f.label} value={f.value} />
                </Grid>
              ))}
            </>
          )}
        </Grid>
      </Paper>

      {isEss ? renderEssSections(ess) : (
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

/**
 * The ESS detailed record, defects, power-on tests and recommendations.
 *
 * Renders from the STORED payload against the SHARED catalogue: labels come
 * from the catalogue, verdicts from the row. An item the row has no answer for
 * shows "—" rather than defaulting to Pass — a missing verdict is missing
 * information, not a pass.
 */
function renderEssSections(ess: EssServiceData | null) {
  if (!ess) {
    return (
      <Paper variant="outlined" sx={{ p: 3 }} className="msr-section">
        <Alert severity="warning">
          This report is marked ESS_V1 but carries no inspection data.
        </Alert>
      </Paper>
    );
  }

  const measureRow = (m: EssMeasure) => {
    const r = ess.measures?.[m.key];
    const overridden = isOverridden(r);
    const shown =
      m.kind === "boolean"
        ? r?.value
          ? "Yes"
          : "No"
        : r?.value === null || r?.value === undefined || r?.value === ""
          ? "—"
          : `${r.value}${m.unit ? ` ${m.unit}` : ""}`;
    return (
      <Stack
        key={m.key}
        direction="row"
        spacing={1.5}
        alignItems="center"
        sx={{
          py: 0.75,
          px: 1.25,
          mt: 0.75,
          borderRadius: 1,
          bgcolor: overridden ? "warning.light" : "action.hover",
        }}
      >
        <Typography variant="body2" sx={{ flex: 1 }}>
          {m.label}
          {m.threshold != null && (
            <Typography component="span" variant="caption" color="text.secondary">
              {" "}(pass ≤ {m.threshold} {m.unit})
            </Typography>
          )}
        </Typography>
        <Typography variant="body2" fontWeight={700}>{shown}</Typography>
        {r?.verdict && (
          <Chip
            size="small"
            label={r.verdict}
            color={r.verdict === "FAIL" ? "error" : "success"}
            variant="filled"
          />
        )}
        {overridden && (
          <Chip size="small" color="warning" label={`overridden — auto ${r?.suggested}`} />
        )}
      </Stack>
    );
  };

  return (
    <>
      <Paper variant="outlined" sx={{ p: 3 }} className="msr-section">
        <Typography variant="h6" fontWeight={700} sx={{ mb: 1.5 }}>Summary</Typography>
        <Grid container spacing={2}>
          <Grid item xs={12} sm={6}>
            <FieldLabel label="Pre-inspection status" value={ess.summary?.preStatus} />
          </Grid>
          <Grid item xs={12} sm={6}>
            <FieldLabel label="Overall conclusion" value={ess.summary?.conclusion} />
          </Grid>
          {ESS_SUMMARY_FIXED.map((f) => (
            <Grid item xs={12} key={f.label}>
              <FieldLabel label={f.label} value={f.value} />
            </Grid>
          ))}
          <Grid item xs={12}>
            <FieldLabel label="Remarks" value={ess.summary?.remarks} />
          </Grid>
        </Grid>
      </Paper>

      <Paper variant="outlined" sx={{ p: 3 }} className="msr-section">
        <Typography variant="h6" fontWeight={700} sx={{ mb: 1.5 }}>Detailed record</Typography>
        <Stack spacing={2.5}>
          {ESS_CATEGORIES.map((cat) => (
            <Box key={cat.id} className="msr-category">
              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.5 }}>
                {cat.id}. {cat.title}
              </Typography>
              {cat.items.map((item) => {
                const r = ess.items?.[essItemKey(cat.id, item.id)];
                return (
                  <Stack
                    key={item.id}
                    direction="row"
                    spacing={1.5}
                    alignItems="flex-start"
                    sx={{ py: 0.5, borderBottom: "1px dashed", borderColor: "divider" }}
                  >
                    <Typography variant="body2" sx={{ flex: 1 }}>
                      {cat.id}.{item.id} {item.label}
                      {r?.remark || item.hint ? (
                        <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                          {r?.remark || item.hint}
                        </Typography>
                      ) : null}
                      {/* Readings sit on their own row, as the reference does. */}
                      {(cat.measures ?? []).filter((m) => m.itemId === item.id).map(measureRow)}
                    </Typography>
                    {r?.verdict ? (
                      <Chip
                        size="small"
                        label={r.verdict}
                        color={r.verdict === "FAIL" ? "error" : "success"}
                      />
                    ) : (
                      <Typography variant="body2" color="text.disabled">—</Typography>
                    )}
                  </Stack>
                );
              })}
              {(cat.measures ?? []).filter((m) => m.itemId == null).map(measureRow)}
            </Box>
          ))}
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: 3 }} className="msr-section msr-defects">
        <Typography variant="h6" fontWeight={700} sx={{ mb: 1.5 }}>Defect tracking</Typography>
        {(ess.defects ?? []).length === 0 ? (
          <Typography variant="body2" color="text.secondary">No defects recorded.</Typography>
        ) : (
          <Stack spacing={1}>
            {ess.defects.map((d, i) => (
              <Box key={i} sx={{ p: 1.25, border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                  <Chip
                    size="small"
                    label={d.riskLevel}
                    color={d.riskLevel === "Major" ? "error" : "warning"}
                  />
                  <Chip size="small" label={d.status} variant="outlined" />
                </Stack>
                <Typography variant="body2" fontWeight={600}>{d.description || "—"}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {d.correctiveAction || "—"}
                </Typography>
              </Box>
            ))}
          </Stack>
        )}
        <Typography variant="body2" fontWeight={600} sx={{ mt: 1.5 }}>
          {essDefectSummary(ess.defectTotals?.major ?? 0, ess.defectTotals?.minor ?? 0)}
        </Typography>
      </Paper>

      <Paper variant="outlined" sx={{ p: 3 }} className="msr-section msr-poweron">
        <Typography variant="h6" fontWeight={700} sx={{ mb: 1.5 }}>Power-on tests</Typography>
        {ESS_POWER_ON_TESTS.map((t) => {
          const r = ess.powerOn?.[String(t.id)];
          return (
            <Stack
              key={t.id}
              direction="row"
              spacing={1.5}
              alignItems="flex-start"
              sx={{ py: 0.5, borderBottom: "1px dashed", borderColor: "divider" }}
            >
              <Typography variant="body2" sx={{ flex: 1 }}>
                {t.id}. {t.label}
                {r?.remark || t.hint ? (
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                    {r?.remark || t.hint}
                  </Typography>
                ) : null}
              </Typography>
              {r?.verdict ? (
                <Chip size="small" label={r.verdict} color={r.verdict === "NG" ? "error" : "success"} />
              ) : (
                <Typography variant="body2" color="text.disabled">—</Typography>
              )}
            </Stack>
          );
        })}
      </Paper>

      <Paper variant="outlined" sx={{ p: 3 }} className="msr-section">
        <Typography variant="h6" fontWeight={700} sx={{ mb: 1.5 }}>Recommendations</Typography>
        <Box component="ol" sx={{ pl: 2.5, m: 0 }}>
          {essRecommendations(ess.nextMaintenanceDate).map((r: string, i: number) => (
            <Typography component="li" variant="body2" key={i} sx={{ mb: 0.5 }}>{r}</Typography>
          ))}
        </Box>
        <Divider sx={{ my: 2 }} />
        <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
          Final conclusion
        </Typography>
        <Typography
          variant="body2"
          sx={{ mt: 0.5, whiteSpace: "pre-wrap", p: 1.5, bgcolor: "action.hover", borderRadius: 1, minHeight: 60 }}
        >
          {ess.finalConclusion || "—"}
        </Typography>
      </Paper>
    </>
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
