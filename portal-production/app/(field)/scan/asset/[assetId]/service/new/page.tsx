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
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { request } from "@/helpers/request";
import { uploadImage } from "@/helpers/imageUploader";
import { useOrganization } from "@/app/portal/hooks/useOrganization";

/**
 * Maintenance & Inspection Service Report — 5-page revamped flow.
 *
 *   1. Header (customer + auto-filled asset details + dates)
 *   2. Checklist (30 fixed items, optional checkboxes in two columns)
 *   3. Remarks + Time In (captured on mount) / Time Out (set at submit)
 *   4. Field technician signature
 *   5. Client signature + submit
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

// Two-column layout of the printed form. Indexes are 1-based and stable —
// they're what we persist in serviceData.checklist. Items 26–30 are
// intentionally blank placeholders so the rendered grid matches the paper
// form's reserved rows.
const CHECKLIST_ITEMS: { id: number; label: string }[] = [
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

const STEP_TITLES = ["Header", "Checklist", "Remarks & Time", "Service signature", "Client signature", "Payment"];
const TOTAL_STEPS = 6;
type Step = 1 | 2 | 3 | 4 | 5 | 6;

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

  const [step, setStep] = useState<Step>(1);
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

  const canAdvanceFromHeader = useMemo(() => !!customer && !!serviceDate, [customer, serviceDate]);

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

      const serviceData = {
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
    if (step === 1) {
      if (!canAdvanceFromHeader) {
        setError("Pick a company and service date to continue");
        return;
      }
      setStep(2);
    } else if (step === 2) {
      setStep(3);
    } else if (step === 3) {
      setStep(4);
    } else if (step === 4) {
      if (!captureTechSig()) return;
      setStep(5);
    } else if (step === 5) {
      if (!captureClientSig()) return;
      setStep(6);
    }
  };

  const onBack = () => {
    setError(null);
    if (step === 1) {
      router.back();
    } else {
      setStep((s) => (s - 1) as Step);
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
    (step === 1 && !canAdvanceFromHeader) ||
    (step === 4 && !techSigDrawn && !techSigDataUrl) ||
    (step === 5 && !clientSigDrawn && !clientSigDataUrl);

  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2.5, pb: 6 }}>
      <Box>
        <Typography variant="h6" fontWeight={700}>Maintenance &amp; Inspection Service Report</Typography>
        <Typography variant="caption" color="text.secondary">
          Step {step} of {TOTAL_STEPS} — {STEP_TITLES[step - 1]}
        </Typography>
        <LinearProgress variant="determinate" value={progressPct} sx={{ mt: 1, borderRadius: 1, height: 6 }} />
      </Box>

      <Divider />

      {step === 1 && renderHeaderStep()}
      {step === 2 && renderChecklistStep()}
      {step === 3 && renderRemarksStep()}
      {step === 4 && renderTechSigStep()}
      {step === 5 && renderClientSigStep()}
      {step === 6 && renderPaymentStep()}

      {error && <Alert severity="error">{error}</Alert>}

      {/* Step 6 supplies its own action buttons (the two payment choices),
          so the standard Back/Next row hides on that step. */}
      {step !== 6 && (
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
      {step === 6 && (
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
