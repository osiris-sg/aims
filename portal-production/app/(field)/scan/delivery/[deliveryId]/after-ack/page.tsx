"use client";

import React, { useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
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
import AddIcon from "@mui/icons-material/Add";
import AssignmentTurnedInIcon from "@mui/icons-material/AssignmentTurnedIn";
import HandymanIcon from "@mui/icons-material/Handyman";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import PrintIcon from "@mui/icons-material/Print";
import { request } from "@/helpers/request";
import { uploadImage } from "@/helpers/imageUploader";
import PhotoCaptureField, { CapturedPhoto } from "@/components/delivery/PhotoCaptureField";
import SignaturePadField, { SignaturePadHandle } from "@/components/delivery/SignaturePadField";
import { useBackgroundLocationContext } from "../../../../context/BackgroundLocationContext";
import {
  isPrinterAvailable,
  getSavedPrinter,
  savePrinter,
  listBondedDevices,
  buildDeliveryReceipt,
  formatUnitLabel,
  printBytes,
  type SavedPrinter,
} from "../../../../lib/btPrinter";
import { Tooltip, List, ListItemButton, ListItemText } from "@mui/material";

interface CustomerOption {
  id: string;
  name: string;
  customerCode: string | null;
}

interface ProjectOption {
  id: string;
  name: string;
}

const FIELD_BUTTON_SX = { py: 1.5, fontSize: "1rem", minHeight: 48 } as const;

/**
 * AFTER-ACK flow (reordered): the ack page creates a DRAFT DO_ACK (GPS +
 * photos) and routes here for the rest — signature comes LAST:
 *
 *   1. ASSIGN — customer → project, prefilled, skippable. (Rental-vs-sale is
 *      an office/DO decision — no rider toggle; assign defaults to RENTAL.)
 *      Committed immediately via /deliveries/:id/assign (fieldDeploy path);
 *      back/re-edit = re-assign ('moved'), never undo.
 *   2. INSTALL PROMPT — needed? YES reveals install photos; NO defers a
 *      skip-install to Confirm. Pure client state — freely reversible.
 *   3. SIGN + "Confirm and Print DO" — ONE customer signature. Confirm:
 *      sign(ackMSR) [item → not_installed, run recompute, water-sg — now WITH
 *      project/customer], then the install choice (skip-install, or an
 *      inline-signed DO_INSTALL create carrying the install photos), then the
 *      run folds. Printing is a future hook on the done screen.
 *
 * RESUME (server-derived): entered without ackMsrId, the draft DO_ACK is
 * found from the run's reports; an existing active assignment skips to the
 * install prompt. No ack MSR at all → bounce to the ack page.
 */
export default function AfterAckPage() {
  const params = useParams();
  const router = useRouter();
  const search = useSearchParams();
  const { getToken } = useAuth();
  const bgLocation = useBackgroundLocationContext();
  const deliveryId = params?.deliveryId as string;
  const assetId = search?.get("assetId") ?? "";
  const inventoryId = search?.get("inventoryId") ?? null;

  // Assign moved to START-delivery (2026-08): after-ack now begins at the
  // install prompt. The "assign" step below is retained only as dead code / a
  // resume fallback and is never entered in the new flow (the start-time assign
  // means an active assignment always exists by ack time).
  const [step, setStep] = useState<"assign" | "install" | "sign" | "review" | "done">("install");
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  // Client-carried flow state: {ackMsrId, installChoice, installPhotos,
  // signature (captured data-URL), recipientName} — everything else is
  // server-committed as it happens; the review step writes nothing.
  const [ackMsrId, setAckMsrId] = useState<string | null>(search?.get("ackMsrId") ?? null);
  const [resolving, setResolving] = useState(true);
  const [installChoice, setInstallChoice] = useState<"yes" | "no" | null>(null);
  const [installPhotos, setInstallPhotos] = useState<CapturedPhoto[]>([]);
  const [photosUploading, setPhotosUploading] = useState(false);
  const [signedByName, setSignedByName] = useState("");
  // Captured at "Next" (the pad can't rehydrate strokes) — going back from
  // review re-renders this image so the rider never has to re-sign.
  const [signature, setSignature] = useState<string | null>(null);
  // Review-summary context: the unit's label (from the run detail) and the
  // assignment shown on review (set by doAssign, or from scan-context when
  // resuming with an assignment already in place).
  const [unitLabel, setUnitLabel] = useState<string | null>(null);
  // The whole run's items for the RUN-LEVEL printed receipt (unit-based +
  // free-typed). Built from the run fetch below — no extra request.
  const [receiptItems, setReceiptItems] = useState<Array<{ label: string; quantity?: number }>>([]);
  const [assignedSummary, setAssignedSummary] = useState<{ customer: string | null; project: string } | null>(null);
  const sigRef = useRef<SignaturePadHandle>(null);
  // Receipt data retained from the mount fetch (no new requests) + printing UI.
  const [runMeta, setRunMeta] = useState<{ deliveryNumber: number | null; siteAddress: string | null }>({ deliveryNumber: null, siteAddress: null });
  const [ackGps, setAckGps] = useState<{ latitude: number; longitude: number } | null>(null);
  // FAN-OUT (bulk "Deliver all"): the rider runs this ONE flow for a lead unit
  // and the same proof is applied to every other unit still delivering. No
  // separate bulk screen: same capture, same install prompt, same signature.
  const applyToAll = search?.get("applyToAll") === "1";
  // The lead's ack photos, forwarded to the other units so their DO_ACK rows
  // carry the same evidence.
  const [ackPhotos, setAckPhotos] = useState<string[]>([]);
  const [printerDialogOpen, setPrinterDialogOpen] = useState(false);
  const [bondedDevices, setBondedDevices] = useState<SavedPrinter[] | null>(null);
  const [printing, setPrinting] = useState(false);
  const [printMsg, setPrintMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const uploadDoInstall = async (blob: Blob): Promise<string | null> => {
    const token = await getToken();
    if (!token) throw new Error("Not signed in");
    return uploadImage({ blob, folderName: "do-install", token });
  };

  // Customer → project pickers (same shape as the walk-around Assign page).
  const [customerOptions, setCustomerOptions] = useState<CustomerOption[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerOption | null>(null);
  const [customerInput, setCustomerInput] = useState("");
  const [customerSearching, setCustomerSearching] = useState(false);
  const [projectOptions, setProjectOptions] = useState<ProjectOption[]>([]);
  const [selectedProject, setSelectedProject] = useState<ProjectOption | null>(null);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const prevCustomerRef = useRef<string | null>(null);
  // Prefill from the run's current drop target — applied once on load.
  const prefillProjectRef = useRef<string | null>(null);

  // Inline "+ Create Project" (same minimal flow as the Assign page).
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [createProjectName, setCreateProjectName] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);

  // Inline "+ Create Customer" — same minimal flow, one step earlier in the
  // cascade: a brand-new site has no customer to hang the project off yet.
  const [createCustomerOpen, setCreateCustomerOpen] = useState(false);
  const [createCustomerName, setCreateCustomerName] = useState("");
  const [creatingCustomer, setCreatingCustomer] = useState(false);

  // Missing unit context (deep link / refresh) → back to the basket.
  useEffect(() => {
    if (!assetId || !inventoryId) router.replace(`/scan/delivery/${deliveryId}`);
  }, [assetId, inventoryId, deliveryId, router]);

  // Mount: prefill the pickers from the run, resolve the draft DO_ACK when
  // arriving without ackMsrId (RESUME), and derive the entry step — an
  // existing active assignment jumps straight to the install prompt.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const res = await request({ path: `/deliveries/${deliveryId}`, method: "GET" }, {}, token);
        if (cancelled) return;
        const run = res.data ?? res;
        if (run?.customer?.id) {
          setSelectedCustomer({ id: run.customer.id, name: run.customer.name, customerCode: null });
          prefillProjectRef.current = run.projectId ?? null;
        }
        // Unit label for the review summary (sku + asset name from the run).
        const it = (run?.items ?? []).find((i: any) => i.inventoryId === inventoryId);
        if (it) setUnitLabel(formatUnitLabel({ sku: it.inventory?.sku, assetName: it.asset?.name, description: it.description }));
        // Every run item for the run-level receipt: unit-based → "SKU — Asset",
        // free-typed (no unit/asset) → its description.
        setReceiptItems(
          (run?.items ?? []).map((i: any) => ({
            label: formatUnitLabel({ sku: i.inventory?.sku, assetName: i.asset?.name, description: i.description }),
            quantity: i.quantity,
          })),
        );
        // Receipt data — already in this payload, just retained.
        setRunMeta({ deliveryNumber: run?.deliveryNumber ?? null, siteAddress: run?.siteAddress ?? null });
        // Resolve the ack MSR (query param wins; else the unit's DO_ACK from
        // the run's reports — draft preferred, signed accepted for old-flow
        // stragglers). None at all → the unit isn't acked: back to ack.
        let msrId = search?.get("ackMsrId") ?? null;
        if (!msrId && inventoryId) {
          const reports: Array<{ id: string; kind: string; status: string; inventoryId: string | null }> =
            run?.reports ?? [];
          const acks = reports.filter((r) => r.kind === "DO_ACK" && r.inventoryId === inventoryId);
          msrId = (acks.find((r) => r.status !== "completed") ?? acks[acks.length - 1])?.id ?? null;
        }
        // GPS for the receipt: the unit's ack MSR carries the drop-off fix.
        const ackRow = (run?.reports ?? []).find((r: any) => r.id === msrId);
        if (ackRow?.latitude != null && ackRow?.longitude != null) {
          setAckGps({ latitude: ackRow.latitude, longitude: ackRow.longitude });
        }
        if (Array.isArray(ackRow?.photos)) setAckPhotos(ackRow.photos as string[]);
        if (!msrId) {
          router.replace(
            `/scan/delivery/${deliveryId}/ack?assetId=${encodeURIComponent(assetId)}${
              inventoryId ? `&inventoryId=${encodeURIComponent(inventoryId)}` : ""
            }`,
          );
          return;
        }
        setAckMsrId(msrId);

        // ── RESUME (server-derived): route to where the rider REALLY left off,
        // never assume "install". install/sign/review are unsaved client state,
        // so the item's deliveryStatus is the deepest resolvable point.
        const itemStatus = (it as { deliveryStatus?: string } | undefined)?.deliveryStatus;
        if (itemStatus === "completed") {
          // Fully done → back to the run basket. No result interstitial; the
          // run-level screen (with reprint) stays reachable from Finished
          // deliveries.
          router.replace(`/scan/delivery/${deliveryId}`);
          return;
        }
        if (itemStatus === "not_installed") {
          // Ack already SIGNED, installation pending → the install page. NEVER
          // the after-ack install PROMPT — its Confirm re-signs the (already
          // signed) ack. Reached e.g. by a Deliver-all straggler or a deep link.
          router.replace(
            `/scan/delivery/${deliveryId}/install?assetId=${encodeURIComponent(assetId)}${
              inventoryId ? `&inventoryId=${encodeURIComponent(inventoryId)}` : ""
            }`,
          );
          return;
        }
        // Otherwise the unit is `delivering` with a draft (unsigned) ack — the
        // post-ack sequence resumes at the install prompt. Feed the review
        // summary from the existing active assignment when present.
        setStep("install");
        if (assetId && inventoryId) {
          try {
            const ctx = await request(
              { path: `/maintenance-reports/scan-context/${assetId}?inventoryId=${encodeURIComponent(inventoryId)}`, method: "GET" },
              {},
              token,
            );
            const active = (ctx.data ?? ctx)?.activeAssignment;
            if (!cancelled && active) {
              // Feed the review summary on resume (no doAssign this session).
              setAssignedSummary({ customer: null, project: active.project?.name ?? "(assigned)" });
            }
          } catch {
            // Non-fatal.
          }
        }
      } catch {
        // Non-fatal — the rider just picks from scratch.
      } finally {
        if (!cancelled) setResolving(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deliveryId, getToken]);

  // Debounced customer search (300 ms tail). Empty query returns the first 20.
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      setCustomerSearching(true);
      try {
        const token = await getToken();
        if (!token) return;
        const res = await request(
          { path: "/customers", method: "POST" },
          { page: 1, limit: 20, search: customerInput.trim() || undefined },
          token,
        );
        if (cancelled) return;
        const docs = res?.data?.docs;
        setCustomerOptions(
          Array.isArray(docs)
            ? docs.map((c: any) => ({ id: c.id, name: c.name, customerCode: c.customerCode ?? null }))
            : [],
        );
      } catch {
        // Non-fatal — keep last results visible.
      } finally {
        if (!cancelled) setCustomerSearching(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [customerInput, getToken]);

  // Load the selected customer's projects; apply the run prefill once.
  useEffect(() => {
    const currentCustomerId = selectedCustomer?.id ?? null;
    if (currentCustomerId !== prevCustomerRef.current) {
      setSelectedProject(null);
      setProjectOptions([]);
      prevCustomerRef.current = currentCustomerId;
    }
    if (!selectedCustomer) return;
    let cancelled = false;
    (async () => {
      setProjectsLoading(true);
      try {
        const token = await getToken();
        if (!token) return;
        const res = await request(
          { path: "/projects", method: "POST" },
          { page: 1, limit: 50, filters: { customerId: selectedCustomer.id } },
          token,
        );
        if (cancelled) return;
        const docs = res?.data?.docs;
        const options: ProjectOption[] = Array.isArray(docs)
          ? docs.map((p: any) => ({ id: p.id, name: p.name }))
          : [];
        setProjectOptions(options);
        if (prefillProjectRef.current) {
          const match = options.find((p) => p.id === prefillProjectRef.current);
          if (match) setSelectedProject(match);
          prefillProjectRef.current = null;
        }
      } catch {
        // Non-fatal.
      } finally {
        if (!cancelled) setProjectsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedCustomer, getToken]);

  const openCreateCustomer = () => {
    // Seed the dialog with whatever the rider already typed into the picker —
    // they only reach "no match" after typing the site's name.
    setCreateCustomerName(customerInput.trim());
    setCreateCustomerOpen(true);
  };

  const handleCreateCustomer = async () => {
    const trimmed = createCustomerName.trim();
    if (!trimmed) return;
    setCreatingCustomer(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      // Narrow field-flow endpoint (customers:create-by-name — the permission
      // rider roles hold; the full /customers/create is office-gated). Same
      // service underneath; the server generates the customerCode.
      const res = await request({ path: "/customers/create-by-name", method: "POST" }, { name: trimmed }, token);
      const created = res?.data;
      if (res?.success && created?.id) {
        const option: CustomerOption = {
          id: created.id,
          name: created.name ?? trimmed,
          customerCode: created.customerCode ?? null,
        };
        setCustomerOptions((prev) => [option, ...prev]);
        setSelectedCustomer(option);
        // Controlled inputValue — keep the field showing the new pick.
        setCustomerInput(option.customerCode ? `${option.name} (${option.customerCode})` : option.name);
        setCreateCustomerOpen(false);
        setCreateCustomerName("");
      } else {
        setError(res?.message ?? "Failed to create customer");
      }
    } catch (e: any) {
      setError(e?.message ?? "Failed to create customer");
    } finally {
      setCreatingCustomer(false);
    }
  };

  const handleCreateProject = async () => {
    const trimmed = createProjectName.trim();
    if (!trimmed || !selectedCustomer) return;
    setCreatingProject(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const res = await request(
        { path: "/projects/create-by-name", method: "POST" },
        { name: trimmed, customerId: selectedCustomer.id },
        token,
      );
      if (res?.success && res.data?.id) {
        const created: ProjectOption = { id: res.data.id, name: res.data.name ?? trimmed };
        setProjectOptions((prev) => [created, ...prev]);
        setSelectedProject(created);
        setCreateProjectOpen(false);
        setCreateProjectName("");
      } else {
        setError(res?.message ?? "Failed to create project");
      }
    } catch (e: any) {
      setError(e?.message ?? "Failed to create project");
    } finally {
      setCreatingProject(false);
    }
  };

  const doAssign = async () => {
    if (!selectedProject || !inventoryId) return;
    setWorking(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const res = await request(
        { path: `/deliveries/${deliveryId}/assign`, method: "POST" },
        { projectId: selectedProject.id, inventoryId },
        token,
      );
      if (res?.success === false) throw new Error(res?.message ?? "Assignment failed");
      setAssignedSummary({ customer: selectedCustomer?.name ?? null, project: selectedProject.name });
      setStep("install");
    } catch (e: any) {
      setError(e?.message ?? "Failed to assign to project");
    } finally {
      setWorking(false);
    }
  };

  // FINAL CONFIRM — the point of no return, strictly ordered:
  //   1. sign(ackMSR) — item → not_installed, deliveredAt, run recompute,
  //      water-sg dispatch (now with project/customer attached).
  //   2. Install choice: NO → skip-install (→ completed, installSkipped);
  //      YES → inline-signed DO_INSTALL create carrying the install photos
  //      (the create path applies the 'install' transition itself).
  //   3. Run folds; background GPS tracking stops. Printing = future hook.
  // "Next" on the sign step: capture the pad into state (the pad can't
  // rehydrate strokes, so the data-URL is the survivor across review⇄sign).
  const goToReview = () => {
    setError(null);
    const padHasStrokes = !!sigRef.current && !sigRef.current.isEmpty();
    if (padHasStrokes) {
      setSignature(sigRef.current!.toDataUrl());
    } else if (!signature) {
      setError("Customer signature is required");
      return;
    }
    setStep("review");
  };

  // COMMIT (from the review step) — reads the CAPTURED signature; the pad is
  // unmounted by now. Handler chain unchanged from the pre-review flow.
  const doConfirm = async () => {
    if (!ackMsrId || !inventoryId) return;
    if (!signature) {
      setError("Customer signature is required");
      setStep("sign");
      return;
    }
    setWorking(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const name = signedByName.trim() || undefined;

      const signRes = await request(
        { path: `/maintenance-reports/${ackMsrId}/sign`, method: "POST" },
        { signature, signedByName: name },
        token,
      );
      if (signRes?.success === false) throw new Error(signRes?.message ?? "Failed to sign delivery");

      if (installChoice === "no") {
        const res = await request(
          { path: `/deliveries/${deliveryId}/items/skip-install`, method: "POST" },
          { inventoryId },
          token,
        );
        if (res?.success === false) throw new Error(res?.message ?? "Could not record the no-install choice");
      } else {
        const res = await request(
          { path: "/maintenance-reports", method: "POST" },
          {
            assetId,
            inventoryId,
            description: "Installation completed",
            kind: "DO_INSTALL",
            deliveryId,
            photos: installPhotos.map((p) => p.key),
            signature,
            ...(name ? { signedByName: name } : {}),
          },
          token,
        );
        if (res?.success === false) throw new Error(res?.message ?? "Could not record the installation");
      }

      // FAN-OUT: apply the SAME proof to every other unit still delivering.
      // Deliberately last, and deliberately after the lead is signed: signing
      // moved the lead to not_installed, and acknowledgeAll only acts on items
      // still `delivering`, so the lead is excluded and cannot get a second
      // DO_ACK. The backend already fans signature, photos, GPS and the install
      // choice across the rest, so there is nothing bulk-specific on the client.
      if (applyToAll) {
        const res = await request(
          { path: `/deliveries/${deliveryId}/ack-all`, method: "POST" },
          {
            signature,
            ...(name ? { recipientName: name } : {}),
            ...(ackPhotos.length ? { photos: ackPhotos } : {}),
            ...(ackGps ? { latitude: ackGps.latitude, longitude: ackGps.longitude } : {}),
            installNeeded: installChoice === "yes",
            ...(installPhotos.length ? { installPhotos: installPhotos.map((p) => p.key) } : {}),
          },
          token,
        );
        if (res?.success === false) {
          throw new Error(res?.message ?? "The lead unit was completed but the others could not be");
        }
      }

      // Ack is signed — the delivery leg is over; stop background tracking
      // (same semantics as the old sign page, fire-and-forget).
      void bgLocation.stop();
      setStep("done");
    } catch (e: any) {
      setError(e?.message ?? "Confirm failed");
    } finally {
      setWorking(false);
    }
  };

  // ── Bluetooth receipt printing (native shell only) ────────────────────────
  const doPrint = async (device?: SavedPrinter) => {
    const target = device ?? getSavedPrinter();
    if (!target) {
      // First print on this phone: pick from already-bonded devices
      // (pairing itself happens in Android Settings — normal for SPP).
      setPrintMsg(null);
      setPrinterDialogOpen(true);
      setBondedDevices(null);
      try {
        setBondedDevices(await listBondedDevices());
      } catch (e: any) {
        setPrintMsg({ ok: false, text: e?.message ?? "Could not list Bluetooth devices" });
      }
      return;
    }
    setPrinting(true);
    setPrintMsg(null);
    try {
      const bytes = await buildDeliveryReceipt({
        deliveryNumber: runMeta.deliveryNumber ?? "—",
        items: receiptItems.length ? receiptItems : [{ label: unitLabel ?? "Unit" }],
        customer: assignedSummary?.customer ?? selectedCustomer?.name ?? null,
        project: assignedSummary?.project ?? null,
        siteAddress: runMeta.siteAddress,
        gps: ackGps,
        dateLabel: new Date().toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }),
        installNeeded: installChoice === "yes",
        signatureDataUrl: signature,
        recipientName: signedByName,
      });
      await printBytes(bytes, target);
      setPrintMsg({ ok: true, text: `Printed on ${target.name}` });
    } catch (e: any) {
      setPrintMsg({ ok: false, text: e?.message ?? "Print failed — check the printer is on and in range" });
    } finally {
      setPrinting(false);
    }
  };

  if (resolving) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 10 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (step === "done") {
    return (
      <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2.5, alignItems: "center", textAlign: "center" }}>
        <CheckCircleIcon sx={{ fontSize: 96, color: "success.main", mt: 6 }} />
        <Typography variant="h5" fontWeight={700}>
          {applyToAll ? "All deliveries confirmed" : "Delivery confirmed"}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 360 }}>
          {applyToAll ? "Every unit still out on this run was signed with the same proof" : "Delivery signed"}
          {installChoice === "no" ? ", installation not needed" : " and installation recorded"}.
        </Typography>
        {/* Bluetooth receipt printing — native shell only (Classic SPP; Web
            Bluetooth is BLE-only and can never reach a 58mm SPP printer). */}
        {isPrinterAvailable() ? (
          <Button
            variant="outlined"
            startIcon={printing ? <CircularProgress size={18} /> : <PrintIcon />}
            onClick={() => void doPrint()}
            disabled={printing}
            fullWidth
            sx={{ ...FIELD_BUTTON_SX, maxWidth: 360 }}
          >
            {printing ? "Printing…" : "Print DO"}
          </Button>
        ) : (
          <Tooltip title="Printing needs the AIMS Field app (Bluetooth printer support)">
            <span style={{ width: "100%", maxWidth: 360 }}>
              <Button variant="outlined" startIcon={<PrintIcon />} disabled fullWidth sx={FIELD_BUTTON_SX}>
                Print DO
              </Button>
            </span>
          </Tooltip>
        )}
        {printMsg && (
          <Alert
            severity={printMsg.ok ? "success" : "error"}
            sx={{ width: "100%", maxWidth: 360 }}
            action={
              !printMsg.ok ? (
                <Button size="small" onClick={() => void doPrint()} disabled={printing}>
                  Retry
                </Button>
              ) : undefined
            }
            onClose={() => setPrintMsg(null)}
          >
            {printMsg.text}
          </Alert>
        )}

        {/* First-print device picker: bonded devices only; pairing lives in
            Android Settings. Remembered per phone in localStorage. */}
        <Dialog open={printerDialogOpen} onClose={() => !printing && setPrinterDialogOpen(false)} fullWidth maxWidth="xs">
          <DialogTitle>Choose printer</DialogTitle>
          <DialogContent>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
              Showing devices already paired in Android Settings. Pair the
              printer there first if it isn&apos;t listed.
            </Typography>
            {!bondedDevices ? (
              <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
                <CircularProgress size={26} />
              </Box>
            ) : bondedDevices.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                No paired Bluetooth devices found.
              </Typography>
            ) : (
              <List dense>
                {bondedDevices.map((d) => (
                  <ListItemButton
                    key={d.mac}
                    onClick={() => {
                      savePrinter(d);
                      setPrinterDialogOpen(false);
                      void doPrint(d);
                    }}
                  >
                    <ListItemText primary={d.name} secondary={d.mac} />
                  </ListItemButton>
                ))}
              </List>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setPrinterDialogOpen(false)}>Cancel</Button>
          </DialogActions>
        </Dialog>
        <Button
          variant="contained"
          onClick={() => router.replace(`/scan/delivery/${deliveryId}`)}
          fullWidth
          sx={{ ...FIELD_BUTTON_SX, maxWidth: 360 }}
        >
          Back to delivery
        </Button>
        <Button variant="text" onClick={() => router.replace("/scan")} sx={{ color: "text.secondary" }}>
          Scan next
        </Button>
      </Box>
    );
  }

  if (step === "sign") {
    return (
      <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2 }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Button startIcon={<ArrowBackIcon />} size="small" onClick={() => setStep("install")} disabled={working} sx={{ color: "text.secondary" }}>
            Back
          </Button>
        </Stack>
        <Typography variant="h6" fontWeight={700}>Customer signature</Typography>
        <Typography variant="body2" color="text.secondary">
          One signature confirms the delivery{installChoice === "yes" ? " and the installation" : ""}.
          You&apos;ll review everything before it&apos;s committed.
        </Typography>

        <TextField
          label="Recipient name (optional)"
          size="small"
          value={signedByName}
          onChange={(e) => setSignedByName(e.target.value)}
        />

        {signature ? (
          // Returning from review: the pad can't rehydrate strokes, so the
          // captured signature is re-rendered — no re-signing required.
          <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1, p: 1, bgcolor: "#fff" }}>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
              Captured signature
            </Typography>
            <Box component="img" src={signature} alt="Captured signature" sx={{ maxWidth: "100%", maxHeight: 140 }} />
          </Box>
        ) : (
          <SignaturePadField ref={sigRef} />
        )}

        {error && <Alert severity="error">{error}</Alert>}

        <Stack direction="row" spacing={2} sx={{ mt: 1 }}>
          <Button
            variant="outlined"
            onClick={() => {
              setSignature(null); // re-sign: drop the capture, show a fresh pad
              sigRef.current?.clear();
            }}
            fullWidth
            disabled={working}
            sx={FIELD_BUTTON_SX}
          >
            {signature ? "Re-sign" : "Clear"}
          </Button>
          <Button variant="contained" onClick={goToReview} disabled={working} fullWidth sx={FIELD_BUTTON_SX}>
            Next
          </Button>
        </Stack>
      </Box>
    );
  }

  if (step === "review") {
    const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
      <Stack direction="row" justifyContent="space-between" spacing={2} sx={{ py: 0.75, borderBottom: "1px solid", borderColor: "divider" }}>
        <Typography variant="body2" color="text.secondary" sx={{ flexShrink: 0 }}>{label}</Typography>
        <Typography variant="body2" fontWeight={600} sx={{ textAlign: "right" }}>{value}</Typography>
      </Stack>
    );
    return (
      <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2 }}>
        <Stack direction="row" spacing={1} alignItems="center">
          {/* Back preserves the captured signature — no re-signing. */}
          <Button startIcon={<ArrowBackIcon />} size="small" onClick={() => setStep("sign")} disabled={working} sx={{ color: "text.secondary" }}>
            Back
          </Button>
        </Stack>
        <Typography variant="h6" fontWeight={700}>Review &amp; confirm</Typography>
        <Typography variant="body2" color="text.secondary">
          Nothing is committed until you confirm below.
        </Typography>

        <Box>
          <Row label="Unit" value={unitLabel ?? "—"} />
          <Row label="Customer" value={assignedSummary?.customer ?? selectedCustomer?.name ?? "—"} />
          <Row label="Project" value={assignedSummary?.project ?? "Not assigned (skipped)"} />
          <Row
            label="Installation"
            value={installChoice === "yes" ? `Needed — ${installPhotos.length} photo${installPhotos.length === 1 ? "" : "s"}` : "Not needed (will be skipped)"}
          />
          <Row label="Signed by" value={signedByName.trim() || "—"} />
        </Box>

        {signature && (
          <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1, p: 1, bgcolor: "#fff" }}>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
              Customer signature
            </Typography>
            <Box component="img" src={signature} alt="Customer signature" sx={{ maxWidth: "100%", maxHeight: 140 }} />
          </Box>
        )}

        {error && <Alert severity="error">{error}</Alert>}

        <Button variant="contained" onClick={doConfirm} disabled={working} fullWidth sx={{ ...FIELD_BUTTON_SX, mt: 1 }}>
          {working ? <CircularProgress size={20} color="inherit" /> : "Confirm and Print DO"}
        </Button>
      </Box>
    );
  }

  if (step === "install") {
    return (
      <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 3, alignItems: "center" }}>
        <Stack direction="row" sx={{ width: "100%" }}>
          <Button startIcon={<ArrowBackIcon />} size="small" onClick={() => setStep("assign")} sx={{ color: "text.secondary" }}>
            Back
          </Button>
        </Stack>
        <HandymanIcon sx={{ fontSize: 72, color: "primary.main" }} />
        <Typography variant="h6" fontWeight={700}>Installation needed?</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ textAlign: "center", maxWidth: 360 }}>
          If this unit needs installing on site, capture the proof photos here —
          the customer signs once for everything at the next step.
        </Typography>
        {error && <Alert severity="error" sx={{ width: "100%", maxWidth: 360 }}>{error}</Alert>}
        <Stack spacing={1.5} sx={{ width: "100%", maxWidth: 360, mt: 1 }}>
          <Button
            variant={installChoice === "yes" ? "contained" : "outlined"}
            startIcon={<HandymanIcon />}
            onClick={() => setInstallChoice("yes")}
            fullWidth
            sx={FIELD_BUTTON_SX}
          >
            Yes — installation needed
          </Button>
          {installChoice === "yes" && (
            <>
              <PhotoCaptureField
                label="Proof of installation"
                photos={installPhotos}
                onChange={setInstallPhotos}
                upload={uploadDoInstall}
                onError={(m) => setError(m || null)}
                onUploadingChange={setPhotosUploading}
              />
              <Button
                variant="contained"
                onClick={() => setStep("sign")}
                disabled={photosUploading}
                fullWidth
                sx={FIELD_BUTTON_SX}
              >
                Continue to signature
              </Button>
            </>
          )}
          <Button
            variant={installChoice === "no" ? "contained" : "outlined"}
            startIcon={<CheckCircleOutlineIcon />}
            onClick={() => {
              setInstallChoice("no");
              setStep("sign");
            }}
            fullWidth
            sx={FIELD_BUTTON_SX}
          >
            No — installation not needed
          </Button>
        </Stack>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2.5 }}>
      {/* Back exits to the basket — the ack draft persists and re-entry
          resumes from it (re-running the ack page would mint a second draft). */}
      <Stack direction="row">
        <Button
          startIcon={<ArrowBackIcon />}
          size="small"
          onClick={() => router.replace(`/scan/delivery/${deliveryId}`)}
          sx={{ color: "text.secondary" }}
        >
          Back to delivery
        </Button>
      </Stack>
      <Stack direction="row" spacing={1.5} alignItems="center">
        <AssignmentTurnedInIcon color="primary" sx={{ fontSize: 40 }} />
        <Box>
          <Typography variant="h6" fontWeight={700}>Assign to project</Typography>
          <Typography variant="body2" color="text.secondary">
            Delivered — record which project this unit now belongs to.
          </Typography>
        </Box>
      </Stack>

      {error && <Alert severity="error">{error}</Alert>}

      <Autocomplete
        options={customerOptions}
        value={selectedCustomer}
        loading={customerSearching}
        onChange={(_, v) => setSelectedCustomer(v)}
        inputValue={customerInput}
        onInputChange={(_, v) => setCustomerInput(v)}
        getOptionLabel={(o) => (o.customerCode ? `${o.name} (${o.customerCode})` : o.name)}
        isOptionEqualToValue={(o, v) => o.id === v.id}
        renderInput={(params) => <TextField {...params} label="Customer" />}
        filterOptions={(x) => x}
        noOptionsText={
          <Button size="small" startIcon={<AddIcon />} onClick={openCreateCustomer}>
            Create customer
          </Button>
        }
      />
      {!selectedCustomer && (
        <Button
          size="small"
          startIcon={<AddIcon />}
          onClick={openCreateCustomer}
          sx={{ alignSelf: "flex-start", textTransform: "none", mt: -1.5 }}
        >
          New customer
        </Button>
      )}

      <Autocomplete
        options={projectOptions}
        value={selectedProject}
        loading={projectsLoading}
        onChange={(_, v) => setSelectedProject(v)}
        getOptionLabel={(o) => o.name}
        isOptionEqualToValue={(o, v) => o.id === v.id}
        disabled={!selectedCustomer}
        renderInput={(params) => (
          <TextField {...params} label={selectedCustomer ? "Project" : "Pick a customer first"} />
        )}
        noOptionsText={
          <Button size="small" startIcon={<AddIcon />} onClick={() => setCreateProjectOpen(true)}>
            Create project
          </Button>
        }
      />
      {selectedCustomer && (
        <Button
          size="small"
          startIcon={<AddIcon />}
          onClick={() => setCreateProjectOpen(true)}
          sx={{ alignSelf: "flex-start", textTransform: "none" }}
        >
          New project for {selectedCustomer.name}
        </Button>
      )}

      {/* RENTAL/SALE toggle removed (2026-08): rental-vs-sale is a commercial
          decision that belongs to the office/DO, not the rider. Assign defaults
          the deployment + unit to RENTAL (fieldDeploy's default); the office
          converts to a sale via a SALE ProjectDeployment on the DO. */}
      <Stack spacing={1.5} sx={{ mt: 1 }}>
        <Button
          variant="contained"
          onClick={doAssign}
          disabled={working || !selectedProject}
          fullWidth
          sx={FIELD_BUTTON_SX}
        >
          {working ? <CircularProgress size={20} /> : "Assign & continue"}
        </Button>
        <Button
          variant="text"
          onClick={() => setStep("install")}
          disabled={working}
          fullWidth
          sx={{ color: "text.secondary" }}
        >
          Skip for now
        </Button>
      </Stack>

      {/* Inline create-customer dialog */}
      <Dialog open={createCustomerOpen} onClose={() => !creatingCustomer && setCreateCustomerOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>New customer</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            label="Customer name"
            value={createCustomerName}
            onChange={(e) => setCreateCustomerName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreateCustomer()}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateCustomerOpen(false)} disabled={creatingCustomer}>Cancel</Button>
          <Button variant="contained" onClick={handleCreateCustomer} disabled={creatingCustomer || !createCustomerName.trim()}>
            {creatingCustomer ? <CircularProgress size={18} /> : "Create"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Inline create-project dialog */}
      <Dialog open={createProjectOpen} onClose={() => !creatingProject && setCreateProjectOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>New project</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            label="Project name"
            value={createProjectName}
            onChange={(e) => setCreateProjectName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreateProject()}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateProjectOpen(false)} disabled={creatingProject}>Cancel</Button>
          <Button variant="contained" onClick={handleCreateProject} disabled={creatingProject || !createProjectName.trim()}>
            {creatingProject ? <CircularProgress size={18} /> : "Create"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
