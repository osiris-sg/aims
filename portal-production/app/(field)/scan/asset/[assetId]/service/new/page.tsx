"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useAuth, useUser } from "@clerk/nextjs";
import SignatureCanvas from "react-signature-canvas";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Divider,
  FormControlLabel,
  Grid,
  LinearProgress,
  MenuItem,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import { request } from "@/helpers/request";
import { uploadImage } from "@/helpers/imageUploader";
import { useOrganization } from "@/app/portal/hooks/useOrganization";
import {
  ESS_CATEGORIES,
  ESS_CONCLUSIONS,
  ESS_DEFECT_STATUSES,
  ESS_INSPECTION_TYPES,
  ESS_POWER_ON_TESTS,
  ESS_PRE_STATUSES,
  ESS_RISK_LEVELS,
  ESS_SUMMARY_FIXED,
  ESS_SUMMARY_REMARKS_DEFAULT,
  ESS_FINAL_CONCLUSION_DEFAULT,
  ESS_HEADER_FIXED,
  essDefectSummary,
  essRecommendations,
  GENERIC_CHECKLIST,
  TEMPLATE_LABELS,
  TEMPLATE_VERSIONS,
  essItemKey,
  isOverridden,
  resolveTemplateId,
  suggestVerdict,
  type EssDefectRow,
  type EssItemResult,
  type EssMeasure,
  type EssMeasureResult,
  type EssPowerOnResult,
  type EssServiceData,
  type EssVerdict,
} from "@/lib/msr-templates";

/**
 * Maintenance & Inspection Service Report — the field capture flow.
 *
 * TWO TEMPLATES, ONE WIZARD. The asset decides which form the technician
 * fills in (`resolveTemplateId` — ESS for any asset NAMED "LION…"), and the
 * chosen id is stamped into serviceData so every later renderer reads the
 * form FROM THE ROW instead of re-deriving it from the asset.
 *
 *   GENERIC_V1 — unchanged 6-step flow:
 *     1. Header   2. Checklist (30 items)   3. Remarks + times
 *     4. Technician signature   5. Client signature   6. Payment
 *
 *   ESS_V1 — air-cooled energy-storage inspection, 5 extra steps between
 *   the header and the remarks:
 *     1. Header (+ equipment id, site, inspection type, rated power/capacity)
 *     2. Summary (pre-inspection status, overall conclusion, remarks)
 *     3. Detailed record (8 categories, each sub-item Pass/Fail + remark,
 *        plus the measured readings)
 *     4. Defects (description / risk / corrective action / status + totals)
 *     5. Power-on tests (4 items, OK/NG + remark)
 *     6. Recommendations + next maintenance date + final conclusion
 *     7–10. Remarks, signatures, payment — identical to GENERIC.
 *
 * SIGNATURES ARE UNCHANGED IN BOTH. Two pads: technician and customer. The
 * ESS reference asks for an inspector AND a reviewer signature; here the
 * field technician is both, so the SAME technician signature and name print
 * in both slots downstream. There is deliberately no third pad.
 *
 * On submit:
 *   - both signatures are uploaded to S3 (folder `maintenance-reports`)
 *   - one POST /maintenance-reports finalizes the row (kind=SERVICE, with
 *     serviceData + client signature key + signedByName), assigning the
 *     next per-org reportNumber server-side.
 */

const FIELD_BUTTON_SX = {
  py: 1.5,
  px: 4,
  fontSize: "1rem",
  minHeight: 48,
} as const;

interface CustomerOption {
  id: string;
  name: string;
  email: string | null;
  customerCode: string | null;
}

interface ScanContext {
  asset: { id: string; name: string; skuKey: string };
  inventory: { id: string; sku: string; serialNumber: string | null } | null;
}

// The 30-item list, the ESS catalogue and the resolution rule all live in
// ONE place now (see the drift warning in that file). Aliased so the existing
// GENERIC render code below reads unchanged.
const CHECKLIST_ITEMS = GENERIC_CHECKLIST;

// Steps are dispatched BY NAME, not by index. GENERIC keeps exactly the six it
// always had, in the same order; ESS inserts five of its own between Header and
// Remarks. Nothing downstream hard-codes a step number, so neither list can
// shift the other.
const GENERIC_STEPS = [
  "Header",
  "Checklist",
  "Remarks & Time",
  "Service signature",
  "Client signature",
  "Payment",
] as const;

const ESS_STEPS = [
  "Header",
  "Summary",
  "Detailed record",
  "Defects",
  "Power-on tests",
  "Recommendations",
  "Remarks & Time",
  "Service signature",
  "Client signature",
  "Payment",
] as const;

type StepName = (typeof ESS_STEPS)[number] | (typeof GENERIC_STEPS)[number];

const formatDateInput = (d: Date) => d.toISOString().slice(0, 10);
const formatTime = (d: Date) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export default function NewServiceReportPage() {
  const params = useParams();
  const router = useRouter();
  const search = useSearchParams();
  const { getToken } = useAuth();
  const { user } = useUser();
  const { organization } = useOrganization();

  const assetId = params?.assetId as string;
  const inventoryId = search?.get("inventoryId") ?? null;

  const [step, setStep] = useState<number>(1);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Captured once on first mount — closest proxy we have to "tech tapped the
  // MSR card on the action chooser." Page-to-page navigation inside this
  // component does not reset it.
  const [timeIn] = useState<Date>(() => new Date());

  // Scan context — gives us the asset name (Model) and inventory serial.
  const [ctx, setCtx] = useState<ScanContext | null>(null);
  const [ctxLoading, setCtxLoading] = useState(true);

  // Page 1 state
  const [customer, setCustomer] = useState<CustomerOption | null>(null);
  const [customerOptions, setCustomerOptions] = useState<CustomerOption[]>([]);
  const [customerInput, setCustomerInput] = useState("");
  const [customerLoading, setCustomerLoading] = useState(false);
  const [clientEmail, setClientEmail] = useState("");
  const [jobLocation, setJobLocation] = useState("");
  const [serviceDate, setServiceDate] = useState<string>(formatDateInput(new Date()));
  const [nextServiceDate, setNextServiceDate] = useState<string>("");

  // Page 2 state — set of checked item ids
  const [checked, setChecked] = useState<Set<number>>(new Set());

  // Page 3 state
  const [remarks, setRemarks] = useState("");

  // ── ESS_V1 state ───────────────────────────────────────────────────────────
  // Inert for GENERIC reports: none of it is read unless the resolved template
  // is ESS, and none of it is serialised into serviceData either.
  const [essEquipmentId, setEssEquipmentId] = useState("");
  const [essSite, setEssSite] = useState("");
  const [essInspectionDate, setEssInspectionDate] = useState<string>(formatDateInput(new Date()));
  const [essInspectionType, setEssInspectionType] = useState<string>(ESS_INSPECTION_TYPES[0]);
  const [essRatedPowerKw, setEssRatedPowerKw] = useState("");
  const [essRatedCapacityKwh, setEssRatedCapacityKwh] = useState("");
  const [essPreStatus, setEssPreStatus] = useState<string>(ESS_PRE_STATUSES[0]);
  const [essConclusion, setEssConclusion] = useState<string>(ESS_CONCLUSIONS[0]);
  const [essSummaryRemarks, setEssSummaryRemarks] = useState(ESS_SUMMARY_REMARKS_DEFAULT);
  const [essItems, setEssItems] = useState<Record<string, EssItemResult>>({});
  const [essMeasures, setEssMeasures] = useState<Record<string, EssMeasureResult>>({});
  const [essDefects, setEssDefects] = useState<EssDefectRow[]>([]);
  const [essPowerOn, setEssPowerOn] = useState<Record<string, EssPowerOnResult>>({});
  const [essNextMaintenanceDate, setEssNextMaintenanceDate] = useState("");
  const [essFinalConclusion, setEssFinalConclusion] = useState(ESS_FINAL_CONCLUSION_DEFAULT);

  // Page 4 + 5 signatures — captured as dataURL when the tech taps Next/Submit.
  // We hold the dataURL across step changes so the canvas can unmount safely;
  // re-mounting a step shows a "signed" preview with a Re-sign affordance.
  const techSigRef = useRef<SignatureCanvas>(null);
  const clientSigRef = useRef<SignatureCanvas>(null);
  const [techSigDataUrl, setTechSigDataUrl] = useState<string | null>(null);
  const [clientSigDataUrl, setClientSigDataUrl] = useState<string | null>(null);
  const [clientSignerName, setClientSignerName] = useState("");

  // Stroke-presence flags driven by SignatureCanvas's onEnd callback. Refs
  // alone aren't enough to gate the Next button: assigning a ref doesn't
  // trigger a re-render, and drawing on the canvas fires no React state
  // change either — so a disabled check that reads `techSigRef.current`
  // computes stale and never recomputes after the user signs.
  const [techSigDrawn, setTechSigDrawn] = useState(false);
  const [clientSigDrawn, setClientSigDrawn] = useState(false);

  // Re-mount key for each signature canvas — bumping it lets the user wipe
  // a previously-captured signature and start fresh from the same step.
  const [techCanvasKey, setTechCanvasKey] = useState(0);
  const [clientCanvasKey, setClientCanvasKey] = useState(0);

  // Fetch asset/inventory details so we can auto-fill Model + Serial.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const invQuery = inventoryId ? `?inventoryId=${encodeURIComponent(inventoryId)}` : "";
        const res = await request(
          { path: `/maintenance-reports/scan-context/${assetId}${invQuery}`, method: "GET" },
          {},
          token,
        );
        if (cancelled) return;
        const data = res?.data ?? res;
        if (data?.asset) {
          setCtx({ asset: data.asset, inventory: data.inventory ?? null });
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Failed to load asset details");
      } finally {
        if (!cancelled) setCtxLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [assetId, inventoryId, getToken]);

  // Debounced customer search — only when on step 1 to avoid burning requests
  // while the tech is later in the flow. Skips lookup if the input matches
  // the currently-selected customer's label (i.e. MUI's post-pick "reset").
  useEffect(() => {
    if (step !== 1) return;
    if (customer && customerInput === customer.name) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setCustomerLoading(true);
      try {
        const token = await getToken();
        if (!token) return;
        const res = await request(
          { path: "/customers", method: "POST" },
          { page: 1, limit: 20, search: customerInput.trim() || undefined },
          token,
        );
        if (cancelled) return;
        const docs = (res?.docs ?? res?.data?.docs ?? []) as any[];
        const opts: CustomerOption[] = docs.map((d) => ({
          id: d.id,
          name: d.name,
          email: d.email ?? null,
          customerCode: d.customerCode ?? null,
        }));
        setCustomerOptions(opts);
      } catch {
        // Non-fatal — let the tech keep typing; errors surface on submit.
      } finally {
        if (!cancelled) setCustomerLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [customerInput, customer, step, getToken]);

  const model = ctx?.asset?.name ?? "";
  const serial = ctx?.inventory?.serialNumber ?? ctx?.inventory?.sku ?? "";

  // TEMPLATE RESOLUTION — once, here, from the asset name. Everything else in
  // this file reads `templateId`; nothing re-derives it. Until the scan context
  // has loaded the asset name is "" and this is GENERIC, which is why the whole
  // form is gated behind `ctxLoading` below.
  const templateId = useMemo(() => resolveTemplateId(model), [model]);
  const isEss = templateId === "ESS_V1";
  const STEPS = isEss ? ESS_STEPS : GENERIC_STEPS;
  const TOTAL_STEPS = STEPS.length;
  const stepName: StepName = STEPS[Math.min(step, TOTAL_STEPS) - 1];

  const canAdvanceFromHeader = useMemo(() => !!customer && !!serviceDate, [customer, serviceDate]);

  // ── ESS handlers ───────────────────────────────────────────────────────────
  const setEssItem = (key: string, patch: Partial<EssItemResult>) =>
    setEssItems((prev) => {
      const cur = prev[key];
      return {
        ...prev,
        [key]: {
          verdict: patch.verdict ?? cur?.verdict ?? "PASS",
          remark: patch.remark ?? cur?.remark ?? null,
        },
      };
    });

  /**
   * Record a reading and re-derive its suggested verdict.
   *
   * The suggestion is recomputed on EVERY keystroke, but the technician's
   * chosen verdict is only auto-set while they have not overridden it
   * (`touched` false). Once they disagree with the machine, editing the value
   * must not quietly drag their verdict back — that would erase the override
   * the remark is explaining.
   */
  const setMeasureValue = (measure: EssMeasure, raw: string | boolean) => {
    setEssMeasures((prev) => {
      const current = prev[measure.key];
      const value =
        measure.kind === "boolean"
          ? Boolean(raw)
          : measure.kind === "choice"
            ? (raw as string) || null
            : raw === "" || raw === null
              ? null
              : Number(raw);
      const suggested = suggestVerdict(measure, value);
      const touched = Boolean(current?.suggested && current?.verdict && current.suggested !== current.verdict);
      return {
        ...prev,
        [measure.key]: {
          value,
          unit: measure.unit,
          threshold: measure.threshold ?? null,
          suggested,
          verdict: touched ? (current?.verdict ?? suggested) : suggested,
          remark: current?.remark ?? null,
        },
      };
    });
  };

  const setMeasureVerdict = (measure: EssMeasure, verdict: EssVerdict) =>
    setEssMeasures((prev) => {
      const cur = prev[measure.key];
      return {
        ...prev,
        [measure.key]: {
          value: cur?.value ?? null,
          unit: measure.unit,
          threshold: measure.threshold ?? null,
          suggested: cur?.suggested ?? null,
          verdict,
          remark: cur?.remark ?? null,
        },
      };
    });

  const setMeasureRemark = (measure: EssMeasure, remark: string) =>
    setEssMeasures((prev) => {
      const cur = prev[measure.key];
      return {
        ...prev,
        [measure.key]: {
          value: cur?.value ?? null,
          unit: measure.unit,
          threshold: measure.threshold ?? null,
          suggested: cur?.suggested ?? null,
          verdict: cur?.verdict ?? null,
          remark,
        },
      };
    });

  const setPowerOn = (id: number, patch: Partial<EssPowerOnResult>) =>
    setEssPowerOn((prev) => {
      const cur = prev[String(id)];
      return {
        ...prev,
        [String(id)]: {
          verdict: patch.verdict ?? cur?.verdict ?? "OK",
          remark: patch.remark ?? cur?.remark ?? null,
        },
      };
    });

  const updateDefect = (idx: number, patch: Partial<EssDefectRow>) =>
    setEssDefects((prev) => prev.map((d, i) => (i === idx ? { ...d, ...patch } : d)));

  // Totals are DERIVED from the rows, never typed. A hand-entered total that
  // disagrees with the table is the classic way these reports go wrong.
  const defectTotals = useMemo(
    () => ({
      major: essDefects.filter((d) => d.riskLevel === "Major").length,
      minor: essDefects.filter((d) => d.riskLevel === "Minor").length,
    }),
    [essDefects],
  );

  // Every sub-item must carry a verdict. Unlike the GENERIC checkboxes (where
  // unticked legitimately means "not done"), a blank Pass/Fail is not an
  // answer — it is an unasked question, and the whole point of this form is
  // that each of the 35 items was looked at.
  const unansweredItems = useMemo(
    () =>
      ESS_CATEGORIES.flatMap((c) => c.items.map((i) => essItemKey(c.id, i.id))).filter(
        (k) => !essItems[k]?.verdict,
      ),
    [essItems],
  );

  // A verdict that contradicts the computed one must say why.
  const overridesMissingRemark = useMemo(
    () =>
      ESS_CATEGORIES.flatMap((c) => c.measures ?? []).filter((m) => {
        const r = essMeasures[m.key];
        return isOverridden(r) && !(r?.remark ?? "").trim();
      }),
    [essMeasures],
  );

  const toggleChecked = (id: number) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const captureTechSig = () => {
    if (!techSigRef.current || techSigRef.current.isEmpty()) {
      setError("Service signature is required");
      return false;
    }
    setTechSigDataUrl(techSigRef.current.getTrimmedCanvas().toDataURL("image/png"));
    setError(null);
    return true;
  };

  const captureClientSig = () => {
    if (!clientSigRef.current || clientSigRef.current.isEmpty()) {
      setError("Client signature is required");
      return false;
    }
    setClientSigDataUrl(clientSigRef.current.getTrimmedCanvas().toDataURL("image/png"));
    setError(null);
    return true;
  };

  const dataUrlToBlob = async (dataUrl: string): Promise<Blob> => {
    const res = await fetch(dataUrl);
    return await res.blob();
  };

  const submit = async (paymentRequired: boolean) => {
    if (!customer) {
      setError("Pick a company first");
      setStep(1);
      return;
    }
    if (!techSigDataUrl) {
      setError("Service signature is required");
      setStep(4);
      return;
    }
    if (!clientSigDataUrl) {
      setError("Client signature is required");
      setStep(5);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");

      // Upload both signatures to S3 — same folder as photos so the office
      // portal renders them via the existing NEXT_PUBLIC_RESOURCE_URL prefix.
      const [techBlob, clientBlob] = await Promise.all([
        dataUrlToBlob(techSigDataUrl),
        dataUrlToBlob(clientSigDataUrl),
      ]);
      const [techKey, clientKey] = await Promise.all([
        uploadImage({ blob: techBlob, folderName: "maintenance-reports", token }),
        uploadImage({ blob: clientBlob, folderName: "maintenance-reports", token }),
      ]);
      if (!techKey || !clientKey) {
        throw new Error("Signature upload failed");
      }

      const timeOut = new Date();

      const technicianName =
        user?.fullName ??
        user?.firstName ??
        user?.username ??
        user?.primaryEmailAddress?.emailAddress ??
        undefined;

      // The ESS payload. Built only for ESS reports — a GENERIC serviceData is
      // byte-for-byte what it has always been, plus the two template keys.
      const essPayload: EssServiceData | null = isEss
        ? {
            header: {
              equipmentId: essEquipmentId.trim() || serial || null,
              site: essSite.trim() || jobLocation.trim() || null,
              inspectionDate: essInspectionDate || null,
              inspectionType: essInspectionType || null,
              ratedPowerKw: essRatedPowerKw === "" ? null : Number(essRatedPowerKw),
              ratedCapacityKwh: essRatedCapacityKwh === "" ? null : Number(essRatedCapacityKwh),
            },
            summary: {
              preStatus: essPreStatus || null,
              conclusion: essConclusion || null,
              remarks: essSummaryRemarks.trim() || null,
            },
            items: essItems,
            measures: essMeasures,
            defects: essDefects,
            defectTotals,
            powerOn: essPowerOn,
            nextMaintenanceDate: essNextMaintenanceDate || null,
            finalConclusion: essFinalConclusion.trim() || null,
          }
        : null;

      const serviceData = {
        // STAMPED AT CAPTURE, read by every renderer. Without this an ESS row
        // is indistinguishable from a GENERIC one and would render as the
        // 30-item checklist.
        templateId,
        templateVersion: TEMPLATE_VERSIONS[templateId],
        ...(essPayload ? { ess: essPayload } : {}),
        customerId: customer.id,
        customerName: customer.name,
        clientEmail: clientEmail.trim() || customer.email || null,
        jobLocation: jobLocation.trim() || null,
        model,
        serial,
        serviceDate,
        nextServiceDate: nextServiceDate || null,
        timeIn: timeIn.toISOString(),
        timeOut: timeOut.toISOString(),
        checklist: Array.from(checked).sort((a, b) => a - b),
        remarks: remarks.trim() || null,
        techSignatureKey: techKey,
        clientSignatureKey: clientKey,
        clientSignerName: clientSignerName.trim() || null,
      };

      const res = await request(
        { path: "/maintenance-reports", method: "POST" },
        {
          assetId,
          ...(inventoryId ? { inventoryId } : {}),
          kind: "SERVICE",
          description: remarks.trim() || "Maintenance service report",
          signature: clientKey,
          paymentRequired,
          ...(clientSignerName.trim() ? { signedByName: clientSignerName.trim() } : {}),
          ...(technicianName ? { technicianName } : {}),
          serviceData,
        },
        token,
      );
      if (res?.success === false) {
        throw new Error(res?.message ?? "Failed to submit report");
      }

      // Keep inventoryId on the /done URL so "Back to this asset" restores
      // the full scan context in the action chooser.
      const invDoneQuery = inventoryId ? `?inventoryId=${encodeURIComponent(inventoryId)}` : "";
      router.replace(`/scan/asset/${assetId}/done${invDoneQuery}`);
    } catch (e: any) {
      setError(e?.message ?? "Failed to submit report");
    } finally {
      setSubmitting(false);
    }
  };

  const renderHeaderStep = () => (
    <Stack spacing={2}>
      <Autocomplete<CustomerOption, false, false, false>
        options={customerOptions}
        value={customer}
        inputValue={customerInput}
        onChange={(_, picked) => {
          setCustomer(picked);
          if (picked) {
            setCustomerInput(picked.name);
            setClientEmail(picked.email ?? "");
          }
        }}
        onInputChange={(_, v, reason) => {
          if (reason === "input") {
            setCustomerInput(v);
            // Typing after a pick should clear the selection so the search
            // results reflect the new query.
            if (customer && v !== customer.name) setCustomer(null);
          }
        }}
        getOptionLabel={(o) => o.name}
        isOptionEqualToValue={(a, b) => a.id === b.id}
        loading={customerLoading}
        noOptionsText={customerInput.trim() ? "No matching company" : "Start typing to search"}
        renderOption={(props, option) => (
          <li {...props} key={option.id}>
            <Box>
              <Typography variant="body2" fontWeight={600}>{option.name}</Typography>
              {(option.customerCode || option.email) && (
                <Typography variant="caption" color="text.secondary">
                  {[option.customerCode, option.email].filter(Boolean).join(" · ")}
                </Typography>
              )}
            </Box>
          </li>
        )}
        renderInput={(params) => (
          <TextField
            {...params}
            label="Company Name"
            placeholder="Search company"
            required
            InputProps={{
              ...params.InputProps,
              endAdornment: (
                <>
                  {customerLoading && <CircularProgress size={18} />}
                  {params.InputProps.endAdornment}
                </>
              ),
            }}
          />
        )}
      />

      <TextField
        label="Client Email"
        value={clientEmail}
        onChange={(e) => setClientEmail(e.target.value)}
        placeholder="email@company.com"
        fullWidth
        helperText={customer?.email ? "Pre-filled from customer record — editable" : " "}
      />

      <TextField
        label="Job Location"
        value={jobLocation}
        onChange={(e) => setJobLocation(e.target.value)}
        placeholder="Site address or area"
        fullWidth
      />

      <TextField label="Model" value={model} fullWidth InputProps={{ readOnly: true }} disabled />
      <TextField label="Serial No" value={serial} fullWidth InputProps={{ readOnly: true }} disabled />

      <TextField
        label="Service Date"
        type="date"
        value={serviceDate}
        onChange={(e) => setServiceDate(e.target.value)}
        InputLabelProps={{ shrink: true }}
        fullWidth
      />
      <TextField
        label="Next Service Date"
        type="date"
        value={nextServiceDate}
        onChange={(e) => setNextServiceDate(e.target.value)}
        InputLabelProps={{ shrink: true }}
        fullWidth
        helperText="Optional"
      />

      {isEss && renderEssHeaderExtras()}
    </Stack>
  );

  // ── ESS render steps ───────────────────────────────────────────────────────

  const renderVerdictToggle = (
    value: string | null | undefined,
    options: readonly string[],
    onPick: (v: string) => void,
  ) => (
    <ToggleButtonGroup
      exclusive
      size="small"
      value={value ?? null}
      onChange={(_, v) => v && onPick(v)}
      sx={{ flexShrink: 0 }}
    >
      {options.map((o) => (
        <ToggleButton
          key={o}
          value={o}
          sx={{
            px: 1.75,
            py: 0.5,
            fontWeight: 700,
            "&.Mui-selected": {
              bgcolor: o === "FAIL" || o === "NG" ? "error.main" : "success.main",
              color: "#fff",
              "&:hover": { bgcolor: o === "FAIL" || o === "NG" ? "error.dark" : "success.dark" },
            },
          }}
        >
          {o}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );

  const renderEssHeaderExtras = () => (
    <>
      <Divider textAlign="left" sx={{ pt: 1 }}>
        <Typography variant="caption" color="text.secondary">Energy storage inspection</Typography>
      </Divider>
      {ESS_HEADER_FIXED.map((f) => (
        <Box key={f.label}>
          <Typography variant="caption" color="text.secondary">{f.label}</Typography>
          <Typography variant="body2">{f.value}</Typography>
        </Box>
      ))}
      <TextField
        label="Equipment ID"
        value={essEquipmentId}
        onChange={(e) => setEssEquipmentId(e.target.value)}
        fullWidth
        helperText={serial ? `Scanned unit: ${serial}` : " "}
      />
      <TextField label="Site" value={essSite} onChange={(e) => setEssSite(e.target.value)} fullWidth />
      <TextField
        label="Inspection Date"
        type="date"
        value={essInspectionDate}
        onChange={(e) => setEssInspectionDate(e.target.value)}
        InputLabelProps={{ shrink: true }}
        fullWidth
      />
      <TextField
        select
        label="Inspection Type"
        value={essInspectionType}
        onChange={(e) => setEssInspectionType(e.target.value)}
        fullWidth
      >
        {ESS_INSPECTION_TYPES.map((t) => (
          <MenuItem key={t} value={t}>{t}</MenuItem>
        ))}
      </TextField>
      <Stack direction="row" spacing={2}>
        <TextField
          label="Rated Power"
          type="number"
          value={essRatedPowerKw}
          onChange={(e) => setEssRatedPowerKw(e.target.value)}
          InputProps={{ endAdornment: <Typography variant="caption">kW</Typography> }}
          fullWidth
        />
        <TextField
          label="Rated Capacity"
          type="number"
          value={essRatedCapacityKwh}
          onChange={(e) => setEssRatedCapacityKwh(e.target.value)}
          InputProps={{ endAdornment: <Typography variant="caption">kWh</Typography> }}
          fullWidth
        />
      </Stack>
    </>
  );

  const renderEssSummaryStep = () => (
    <Stack spacing={2}>
      {ESS_SUMMARY_FIXED.map((f) => (
        <Box key={f.label}>
          <Typography variant="caption" color="text.secondary">{f.label}</Typography>
          <Typography variant="body2">{f.value}</Typography>
        </Box>
      ))}
      <Divider />
      <TextField
        select
        label="Pre-inspection status"
        value={essPreStatus}
        onChange={(e) => setEssPreStatus(e.target.value)}
        fullWidth
      >
        {ESS_PRE_STATUSES.map((t) => (
          <MenuItem key={t} value={t}>{t}</MenuItem>
        ))}
      </TextField>
      <TextField
        select
        label="Overall conclusion"
        value={essConclusion}
        onChange={(e) => setEssConclusion(e.target.value)}
        fullWidth
      >
        {ESS_CONCLUSIONS.map((t) => (
          <MenuItem key={t} value={t}>{t}</MenuItem>
        ))}
      </TextField>
      <TextField
        label="Summary remarks"
        multiline
        minRows={3}
        value={essSummaryRemarks}
        onChange={(e) => setEssSummaryRemarks(e.target.value)}
        fullWidth
      />
    </Stack>
  );

  const renderMeasure = (m: EssMeasure) => {
    const r = essMeasures[m.key];
    const overridden = isOverridden(r);
    return (
      <Box
        key={m.key}
        sx={{
          p: 1.5,
          mt: 1,
          border: "1px solid",
          borderColor: overridden ? "warning.main" : "divider",
          borderRadius: 1,
          bgcolor: "action.hover",
        }}
      >
        {m.kind === "boolean" ? (
          <FormControlLabel
            control={
              <Checkbox
                checked={Boolean(r?.value)}
                onChange={(e) => setMeasureValue(m, e.target.checked)}
              />
            }
            label={<Typography variant="body2">{m.label}</Typography>}
          />
        ) : m.kind === "choice" ? (
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Typography variant="body2" sx={{ flex: 1 }}>{m.label}</Typography>
            <ToggleButtonGroup
              exclusive
              size="small"
              value={typeof r?.value === "string" ? r.value : null}
              onChange={(_, v) => v && setMeasureValue(m, v)}
            >
              {(m.options ?? []).map((o) => (
                <ToggleButton key={o} value={o} sx={{ px: 1.5, py: 0.5 }}>{o}</ToggleButton>
              ))}
            </ToggleButtonGroup>
          </Stack>
        ) : (
          <Stack direction="row" spacing={1.5} alignItems="center">
            <TextField
              label={m.label}
              type="number"
              size="small"
              value={r?.value === null || r?.value === undefined ? "" : String(r.value)}
              onChange={(e) => setMeasureValue(m, e.target.value)}
              InputProps={{
                endAdornment: m.unit ? <Typography variant="caption">{m.unit}</Typography> : undefined,
              }}
              fullWidth
            />
            {m.threshold != null && (
              <Box sx={{ minWidth: 92, textAlign: "right" }}>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                  Pass ≤ {m.threshold} {m.unit}
                </Typography>
                <Typography
                  variant="caption"
                  fontWeight={700}
                  color={
                    r?.suggested === "FAIL" ? "error.main" : r?.suggested === "PASS" ? "success.main" : "text.disabled"
                  }
                >
                  {r?.suggested ? `Suggests ${r.suggested}` : "No reading"}
                </Typography>
              </Box>
            )}
          </Stack>
        )}

        {m.threshold != null && (
          <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mt: 1.5 }}>
            <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
              Verdict
            </Typography>
            {renderVerdictToggle(r?.verdict, ["PASS", "FAIL"], (v) => setMeasureVerdict(m, v as EssVerdict))}
          </Stack>
        )}

        {overridden && (
          <Box sx={{ mt: 1.5 }}>
            <Alert severity="warning" sx={{ py: 0, mb: 1 }}>
              You set {r?.verdict} but the reading suggests {r?.suggested}. A reason is required.
            </Alert>
            <TextField
              label="Reason for override"
              size="small"
              value={r?.remark ?? ""}
              onChange={(e) => setMeasureRemark(m, e.target.value)}
              fullWidth
              required
            />
          </Box>
        )}
      </Box>
    );
  };

  const renderEssDetailStep = () => (
    <Stack spacing={2.5}>
      <Typography variant="body2" color="text.secondary">
        Mark every sub-item Pass or Fail. {unansweredItems.length > 0
          ? `${unansweredItems.length} still unanswered.`
          : "All items answered."}
      </Typography>
      {ESS_CATEGORIES.map((cat) => (
        <Box key={cat.id}>
          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.5 }}>
            {cat.id}. {cat.title}
          </Typography>
          <Stack spacing={1}>
            {cat.items.map((item) => {
              const key = essItemKey(cat.id, item.id);
              const r = essItems[key];
              return (
                <Box
                  key={key}
                  sx={{ p: 1.25, border: "1px solid", borderColor: "divider", borderRadius: 1 }}
                >
                  <Stack direction="row" spacing={1.5} alignItems="flex-start">
                    <Typography variant="body2" sx={{ flex: 1 }}>
                      {cat.id}.{item.id} {item.label}
                    </Typography>
                    {renderVerdictToggle(r?.verdict, ["PASS", "FAIL"], (v) =>
                      setEssItem(key, { verdict: v as EssVerdict }),
                    )}
                  </Stack>
                  <TextField
                    placeholder={item.hint ? item.hint : "Remark (optional)"}
                    size="small"
                    variant="standard"
                    value={r?.remark ?? ""}
                    onChange={(e) => setEssItem(key, { remark: e.target.value })}
                    fullWidth
                    sx={{ mt: 0.5 }}
                    helperText={item.hint ? item.hint : undefined}
                  />
                  {/* Readings sit ON their row, the way the reference lays
                      them out — not in a block at the end of the category. */}
                  {(cat.measures ?? []).filter((m) => m.itemId === item.id).map(renderMeasure)}
                </Box>
              );
            })}
          </Stack>
          {/* Measures with no itemId (none today) would otherwise vanish. */}
          {(cat.measures ?? []).filter((m) => m.itemId == null).map(renderMeasure)}
        </Box>
      ))}
    </Stack>
  );

  const renderEssDefectsStep = () => (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        Record every defect found. Totals are counted from the rows below.
      </Typography>
      {essDefects.length === 0 && <Alert severity="success">No defects recorded.</Alert>}
      {essDefects.map((d, i) => (
        <Box key={i} sx={{ p: 1.5, border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
          <Stack spacing={1.25}>
            <TextField
              label="Description"
              size="small"
              value={d.description}
              onChange={(e) => updateDefect(i, { description: e.target.value })}
              fullWidth
              multiline
            />
            <Stack direction="row" spacing={1.25}>
              <TextField
                select
                label="Risk level"
                size="small"
                value={d.riskLevel}
                onChange={(e) => updateDefect(i, { riskLevel: e.target.value })}
                fullWidth
              >
                {ESS_RISK_LEVELS.map((r) => (
                  <MenuItem key={r} value={r}>{r}</MenuItem>
                ))}
              </TextField>
              <TextField
                select
                label="Status"
                size="small"
                value={d.status}
                onChange={(e) => updateDefect(i, { status: e.target.value })}
                fullWidth
              >
                {ESS_DEFECT_STATUSES.map((r) => (
                  <MenuItem key={r} value={r}>{r}</MenuItem>
                ))}
              </TextField>
            </Stack>
            <TextField
              label="Corrective action"
              size="small"
              value={d.correctiveAction}
              onChange={(e) => updateDefect(i, { correctiveAction: e.target.value })}
              fullWidth
              multiline
            />
            <Button
              size="small"
              color="error"
              onClick={() => setEssDefects((prev) => prev.filter((_, j) => j !== i))}
            >
              Remove
            </Button>
          </Stack>
        </Box>
      ))}
      <Button
        variant="outlined"
        onClick={() =>
          setEssDefects((prev) => [
            ...prev,
            { description: "", riskLevel: "Minor", correctiveAction: "", status: "Open" },
          ])
        }
        sx={FIELD_BUTTON_SX}
      >
        Add defect
      </Button>
      <Typography variant="body2" fontWeight={600}>
        {essDefectSummary(defectTotals.major, defectTotals.minor)}
      </Typography>
    </Stack>
  );

  const renderEssPowerOnStep = () => (
    <Stack spacing={1.5}>
      <Typography variant="body2" color="text.secondary">
        Mark each test OK or NG.
      </Typography>
      {ESS_POWER_ON_TESTS.map((t) => {
        const r = essPowerOn[String(t.id)];
        return (
          <Box key={t.id} sx={{ p: 1.25, border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
            <Stack direction="row" spacing={1.5} alignItems="flex-start">
              <Typography variant="body2" sx={{ flex: 1 }}>
                {t.id}. {t.label}
              </Typography>
              {renderVerdictToggle(r?.verdict, ["OK", "NG"], (v) =>
                setPowerOn(t.id, { verdict: v as "OK" | "NG" }),
              )}
            </Stack>
            <TextField
              placeholder="Remark (optional)"
              size="small"
              variant="standard"
              value={r?.remark ?? ""}
              onChange={(e) => setPowerOn(t.id, { remark: e.target.value })}
              fullWidth
              sx={{ mt: 0.5 }}
            />
          </Box>
        );
      })}
    </Stack>
  );

  const renderEssRecommendationsStep = () => (
    <Stack spacing={2}>
      <Box>
        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.5 }}>
          Recommendations
        </Typography>
        <Box component="ol" sx={{ pl: 2.5, m: 0 }}>
          {essRecommendations(essNextMaintenanceDate).map((r, i) => (
            <Typography component="li" variant="body2" key={i} sx={{ mb: 0.5 }}>
              {r}
            </Typography>
          ))}
        </Box>
      </Box>
      <TextField
        label="Next maintenance date"
        type="date"
        value={essNextMaintenanceDate}
        onChange={(e) => setEssNextMaintenanceDate(e.target.value)}
        InputLabelProps={{ shrink: true }}
        fullWidth
      />
      <TextField
        label="Final conclusion"
        multiline
        minRows={4}
        value={essFinalConclusion}
        onChange={(e) => setEssFinalConclusion(e.target.value)}
        placeholder="Overall statement on the condition of the system."
        fullWidth
      />
    </Stack>
  );

  const renderChecklistStep = () => (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Tap each item that was checked / serviced.
      </Typography>
      <Grid container spacing={0.5}>
        {CHECKLIST_ITEMS.map((item) => {
          const blank = !item.label;
          return (
            <Grid item xs={6} key={item.id}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={checked.has(item.id)}
                    onChange={() => !blank && toggleChecked(item.id)}
                    disabled={blank}
                    size="medium"
                  />
                }
                label={
                  <Typography variant="body2" sx={{ color: blank ? "text.disabled" : "text.primary" }}>
                    {item.id}. {item.label || " "}
                  </Typography>
                }
                sx={{ width: "100%", ml: 0, my: 0.25 }}
              />
            </Grid>
          );
        })}
      </Grid>
    </Box>
  );

  const renderRemarksStep = () => (
    <Stack spacing={2}>
      <Box>
        <Typography variant="caption" color="text.secondary">Time In</Typography>
        <Typography variant="body1" fontWeight={600}>{formatTime(timeIn)}</Typography>
      </Box>
      <Box>
        <Typography variant="caption" color="text.secondary">Time Out</Typography>
        <Typography variant="body2" color="text.secondary" fontStyle="italic">
          Will be recorded on submission
        </Typography>
      </Box>
      <TextField
        label="Remarks"
        multiline
        minRows={4}
        value={remarks}
        onChange={(e) => setRemarks(e.target.value)}
        placeholder="Notes about the service performed, parts replaced, follow-up items, etc."
        fullWidth
      />
    </Stack>
  );

  const renderSignatureCanvas = (
    which: "tech" | "client",
    refObj: React.RefObject<SignatureCanvas>,
    canvasKey: number,
    bumpKey: () => void,
    capturedDataUrl: string | null,
    setCaptured: (v: string | null) => void,
    onDrawnChange?: (drawn: boolean) => void,
  ) => (
    <Box>
      {capturedDataUrl ? (
        <Box>
          <Box
            component="img"
            src={capturedDataUrl}
            alt={`${which} signature`}
            sx={{
              width: "100%",
              maxHeight: 200,
              objectFit: "contain",
              border: "1px solid",
              borderColor: "divider",
              borderRadius: 1,
              bgcolor: "background.paper",
            }}
          />
          <Button
            variant="text"
            size="small"
            onClick={() => {
              setCaptured(null);
              bumpKey();
              onDrawnChange?.(false);
            }}
            sx={{ mt: 1 }}
          >
            Re-sign
          </Button>
        </Box>
      ) : (
        <>
          <Box
            sx={{
              border: "1px dashed",
              borderColor: "divider",
              borderRadius: 1,
              bgcolor: "background.paper",
              touchAction: "none",
            }}
          >
            <SignatureCanvas
              key={canvasKey}
              ref={refObj}
              penColor="black"
              onEnd={() => onDrawnChange?.(true)}
              canvasProps={{ width: 360, height: 200, style: { width: "100%", height: 200 } }}
            />
          </Box>
          <Button
            variant="text"
            size="small"
            onClick={() => {
              refObj.current?.clear();
              onDrawnChange?.(false);
            }}
            sx={{ mt: 1 }}
          >
            Clear
          </Button>
        </>
      )}
    </Box>
  );

  const renderTechSigStep = () => (
    <Stack spacing={1.5}>
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        SERVICE BY {organization?.name?.toUpperCase() ?? ""}
      </Typography>
      {renderSignatureCanvas(
        "tech",
        techSigRef,
        techCanvasKey,
        () => setTechCanvasKey((k) => k + 1),
        techSigDataUrl,
        setTechSigDataUrl,
        setTechSigDrawn,
      )}
    </Stack>
  );

  const renderClientSigStep = () => (
    <Stack spacing={1.5}>
      <Typography variant="body2" sx={{ lineHeight: 1.5 }}>
        I / WE, the undersigned, certify that the above services are satisfied &amp; have
        examined the said machines are in good and proper condition.
      </Typography>
      <TextField
        label="Client name"
        value={clientSignerName}
        onChange={(e) => setClientSignerName(e.target.value)}
        fullWidth
      />
      {renderSignatureCanvas(
        "client",
        clientSigRef,
        clientCanvasKey,
        () => setClientCanvasKey((k) => k + 1),
        clientSigDataUrl,
        setClientSigDataUrl,
        setClientSigDrawn,
      )}
      <Typography variant="caption" color="text.secondary">
        Name / Signature / Company&apos;s stamp
      </Typography>
    </Stack>
  );

  // Step 6 — payment choice. The two buttons ARE the submit; there's no
  // single "Submit" anywhere on this step. Tapping either kicks off the
  // upload + POST path with the chosen flag.
  const renderPaymentStep = () => (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        If payment is required (e.g. faulty equipment), an invoice will be created on the
        dashboard. Otherwise, a copy of this report will be emailed to the customer.
      </Typography>
      <Button
        variant="outlined"
        onClick={() => submit(false)}
        disabled={submitting}
        fullWidth
        sx={{ ...FIELD_BUTTON_SX, py: 2.5, fontSize: "1.05rem" }}
      >
        {submitting ? <CircularProgress size={20} /> : "No Payment Required"}
      </Button>
      <Button
        variant="contained"
        color="warning"
        onClick={() => submit(true)}
        disabled={submitting}
        fullWidth
        sx={{ ...FIELD_BUTTON_SX, py: 2.5, fontSize: "1.05rem" }}
      >
        {submitting ? <CircularProgress size={20} color="inherit" /> : "Payment Required"}
      </Button>
    </Stack>
  );

  const onNext = () => {
    setError(null);
    // Gates hang off the step's NAME, so GENERIC's checks are exactly the ones
    // it always had and ESS's extra gates can never fire on a GENERIC report.
    if (stepName === "Header" && !canAdvanceFromHeader) {
      setError("Pick a company and service date to continue");
      return;
    }
    if (stepName === "Detailed record" && unansweredItems.length > 0) {
      setError(`Mark every item Pass or Fail — ${unansweredItems.length} still unanswered`);
      return;
    }
    if (stepName === "Detailed record" && overridesMissingRemark.length > 0) {
      setError(
        `Give a reason for the overridden reading: ${overridesMissingRemark.map((m) => m.label).join(", ")}`,
      );
      return;
    }
    if (stepName === "Service signature" && !captureTechSig()) return;
    if (stepName === "Client signature" && !captureClientSig()) return;
    setStep((v) => Math.min(v + 1, TOTAL_STEPS));
  };

  const onBack = () => {
    setError(null);
    if (step === 1) {
      router.back();
    } else {
      setStep((v) => v - 1);
    }
  };

  if (ctxLoading) {
    return (
      <Box sx={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", p: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  const progressPct = (step / TOTAL_STEPS) * 100;
  const nextDisabled =
    submitting ||
    (stepName === "Header" && !canAdvanceFromHeader) ||
    (stepName === "Service signature" && !techSigDrawn && !techSigDataUrl) ||
    (stepName === "Client signature" && !clientSigDrawn && !clientSigDataUrl);

  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2.5, pb: 6 }}>
      <Box>
        <Typography variant="h6" fontWeight={700}>{TEMPLATE_LABELS[templateId]}</Typography>
        <Typography variant="caption" color="text.secondary">
          Step {step} of {TOTAL_STEPS} — {stepName}
        </Typography>
        <LinearProgress variant="determinate" value={progressPct} sx={{ mt: 1, borderRadius: 1, height: 6 }} />
      </Box>

      <Divider />

      {stepName === "Header" && renderHeaderStep()}
      {stepName === "Checklist" && renderChecklistStep()}
      {stepName === "Summary" && renderEssSummaryStep()}
      {stepName === "Detailed record" && renderEssDetailStep()}
      {stepName === "Defects" && renderEssDefectsStep()}
      {stepName === "Power-on tests" && renderEssPowerOnStep()}
      {stepName === "Recommendations" && renderEssRecommendationsStep()}
      {stepName === "Remarks & Time" && renderRemarksStep()}
      {stepName === "Service signature" && renderTechSigStep()}
      {stepName === "Client signature" && renderClientSigStep()}
      {stepName === "Payment" && renderPaymentStep()}

      {error && <Alert severity="error">{error}</Alert>}

      {/* The Payment step supplies its own action buttons (the two payment
          choices), so the standard Back/Next row hides there. */}
      {stepName !== "Payment" && (
        <Stack direction="row" spacing={2} sx={{ mt: 1 }}>
          <Button variant="outlined" onClick={onBack} disabled={submitting} fullWidth sx={FIELD_BUTTON_SX}>
            Back
          </Button>
          <Button
            variant="contained"
            onClick={onNext}
            disabled={nextDisabled}
            fullWidth
            sx={FIELD_BUTTON_SX}
          >
            Next
          </Button>
        </Stack>
      )}
      {stepName === "Payment" && (
        <Button
          variant="text"
          onClick={onBack}
          disabled={submitting}
          fullWidth
        >
          Back
        </Button>
      )}
    </Box>
  );
}
