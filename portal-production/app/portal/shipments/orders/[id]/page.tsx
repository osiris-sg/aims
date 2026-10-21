/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// The order page (ADH's "#19") — one order process (round H): the order's
// steps 0 Check contract, 1 PI payment, 2 Invoice #1 on top, then one card per
// shipment ("#19-1 · B/L · vessel · ETA · current step") opening that
// shipment's steps (3a–10, 12, 14) — ?shipment= selects it — and last the
// order's 11 Invoice #2 / single invoice and 13 reconciliation. Steps that
// don't apply to the customer's / supplier's profile show as "N/A". Paying
// steps (1, 6, 8, 12) and the invoice receipts (2, 11) keep their payment
// (amount, date, account, proof) on the step. The estimator sits on shipment
// steps 7 / 8 / 12 and the reconciliation on step 13. One card is open at a
// time (the current step by default); when the server completes a step the
// page says so and opens the next one.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { Alert, Box, Button, ButtonBase, Chip, CircularProgress, Grid, IconButton, Menu, MenuItem, Paper, Stack, Tab, Tabs, Tooltip, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import EditIcon from "@mui/icons-material/EditOutlined";
import { toast } from "../../_lib/toast";
import { SHIPMENT_KEYS, useGeneratedDocs, useOrder, useOrderGeneratedDocs, useShipment, useTradeMutation } from "../../_lib/hooks";
import { useQueryClient } from "@tanstack/react-query";
import { defaultShipmentId, focusStepId, headerLine2 } from "../../_lib/order-focus";
import { useUserPermissions } from "@/app/portal/hooks/useUserPermissions";
import { recordFileCount, STEP_PAYMENT, useShipmentsApi, type AnExtraction, type BlExtraction, type Order, type PermitCheck, type PermitExtraction, type Shipment, type TradeFile, type TradeStep } from "../../_lib/api";
import { blLabel, depositTermLabel, fmtDay, fmtDmy, fmtMoney, fmtMt, fmtYen, stepLabel, shortCustomer } from "../../_lib/format";
import RecordHeader from "../../_components/RecordHeader";
import ShipmentOverview from "../../_components/ShipmentOverview";
import StepCards, { type StepContext } from "../../_components/StepCards";
import ShipmentFormDialog from "../../_components/ShipmentFormDialog";
import FilesTable from "../../_components/FilesTable";
import LinkedDocuments from "../../_components/LinkedDocuments";
import { ConfirmDialog, CurrentStepCell, Field, ProgressCell, RecordStatusChip } from "../../_components/bits";
import ExtractApplyDialog, { type ApplyRow } from "../../_components/ExtractApplyDialog";
import OrderFormDialog from "../../_components/OrderFormDialog";
import EstimatorPanel, { ESTIMATOR_STEPS } from "../../_components/EstimatorPanel";
import ReconciliationPanel from "../../_components/ReconciliationPanel";
import PriceCheckPanel from "../../_components/PriceCheckPanel";
import StepPaymentForm from "../../_components/StepPaymentForm";

const TABS = ["journey", "details", "files"] as const;
/** Order steps from here on (11 Invoice #2, 13 reconciliation) show after the shipments. */
const LATE_FROM = 100;
const byOrder = (a: TradeStep, b: TradeStep) => a.sortOrder - b.sortOrder;
const firstOpen = (steps: TradeStep[]) => [...steps].sort(byOrder).find((s) => !s.isOngoing && !s.notApplicable && s.status !== "DONE") ?? null;

export default function OrderPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tab = Math.max(0, TABS.indexOf((params?.get("tab") ?? "journey") as (typeof TABS)[number]));
  const q = useOrder(id);
  const o = q.data;
  const shipments = useMemo(() => o?.shipments ?? [], [o?.shipments]);
  const wanted = params?.get("shipment");
  // Round R: without ?shipment=, land on the open shipment furthest behind (the work that is due).
  const shipmentId = (wanted && shipments.some((s) => s.id === wanted) ? wanted : defaultShipmentId(shipments)) ?? undefined;
  const sq = useShipment(shipmentId);
  const s = sq.data && sq.data.id === shipmentId ? sq.data : undefined;
  const genOrder = useOrderGeneratedDocs(id);
  const genShipment = useGeneratedDocs(shipmentId);
  const api = useShipmentsApi();
  const qc = useQueryClient();

  // Round N: "Mark as test" — ADH Managers (shipments:money).
  const { hasPermission } = useUserPermissions();
  const canMarkTest = hasPermission("shipments", "money");

  const setParam = (k: string, v: string | null) => {
    const p = new URLSearchParams(params?.toString() ?? "");
    if (v) p.set(k, v);
    else p.delete(k);
    // Round N: no jump to the top on a tab / shipment change.
    router.replace(`${pathname}?${p.toString()}`, { scroll: false });
  };
  /** A shipment card click / "Add shipment": select it — the focus effect below scrolls to its open step. */
  const showShipment = (id: string) => setParam("shipment", id);

  const complete = useTradeMutation((a, oid: string) => a.completeOrder(oid));
  const reopen = useTradeMutation((a, oid: string) => a.reopenOrder(oid));
  const cancel = useTradeMutation((a, oid: string) => a.updateOrder(oid, { status: "CANCELLED" }));
  const addShipment = useTradeMutation((a, oid: string) => a.addOrderShipment(oid));
  const shipAction = useTradeMutation(
    (a, v: { id: string; act: "complete" | "cancel" | "reopen" | "delete" }): Promise<unknown> =>
      v.act === "complete" ? a.completeShipment(v.id) : v.act === "cancel" ? a.updateShipment(v.id, { status: "CANCELLED" }) : v.act === "reopen" ? a.reopenShipment(v.id) : a.deleteShipment(v.id),
  );
  const applyShip = useTradeMutation((a, v: { id: string; patch: Record<string, unknown> }) => a.updateShipment(v.id, v.patch));
  const [shipMenu, setShipMenu] = useState<{ left: number; top: number } | null>(null);
  const [shipConfirm, setShipConfirm] = useState<"complete" | "cancel" | "reopen" | "delete" | null>(null);
  const [offer, setOffer] = useState<{ title: string; intro: string; warning: string | null; rows: ApplyRow[]; extra?: React.ReactNode } | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [editOpen, setEditOpen] = useState(false);
  const remountAfter = useRef<string | null>(null);

  // ── one open card across the whole order ─────────────────────────────────
  const orderSteps = useMemo(() => [...(o?.steps ?? [])].sort(byOrder), [o?.steps]);
  // Steps 0, 1, 2 come before the shipments; 11 and 13 after them.
  const earlySteps = useMemo(() => orderSteps.filter((x) => x.sortOrder < LATE_FROM), [orderSteps]);
  const lateSteps = useMemo(() => orderSteps.filter((x) => x.sortOrder >= LATE_FROM), [orderSteps]);
  const shipSteps = useMemo(() => [...(s?.steps ?? [])].filter((x) => !(x.notApplicable && x.skipReason?.startsWith("Moved to the order"))).sort(byOrder), [s?.steps]);
  const current = firstOpen(earlySteps) ?? firstOpen(shipSteps) ?? firstOpen(lateSteps);
  // Round P: ?step=<stepId> (from an inbox "Linked to" chip) opens that step card.
  const wantedStep = params?.get("step") ?? null;
  const [openId, setOpenId] = useState<string | null>(wantedStep);
  const [userPicked, setUserPicked] = useState(!!wantedStep);
  const shown = userPicked ? openId : (current?.id ?? null);
  const onOpen = (stepId: string | null) => {
    setUserPicked(true);
    setOpenId(stepId);
  };
  useEffect(() => setUserPicked(false), [id, shipmentId]);

  // Round R: on open and on a shipment switch (not on every re-render), scroll to the step card that is open —
  // the order's early open step, else the selected shipment's open step, else the order's late step (a ?step=
  // deep link wins).
  const focusedFor = useRef("");
  useEffect(() => {
    if (!o || (shipmentId && !s)) return;
    const key = `${id}:${shipmentId ?? ""}`;
    if (focusedFor.current === key) return;
    focusedFor.current = key;
    const target = wantedStep ?? focusStepId(earlySteps, shipSteps, lateSteps);
    if (!target) return;
    const t = setTimeout(() => document.getElementById(`step-${target}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 200);
    return () => clearTimeout(t);
  }, [o, s, id, shipmentId, wantedStep, earlySteps, shipSteps, lateSteps]);

  // Completed by the server (last step done): say so; a completed order returns to the list.
  const manual = useRef(false);
  const lastStatus = useRef<{ key: string; order?: string; shipment?: string }>({ key: "" });
  useEffect(() => {
    if (!o || (shipmentId && !s)) return;
    const key = `${id}:${shipmentId ?? ""}`;
    const was = lastStatus.current;
    lastStatus.current = { key, order: o.status, shipment: s?.status };
    if (was.key !== key || (was.order === o.status && was.shipment === s?.status)) return;
    if (manual.current) {
      manual.current = false;
      return;
    }
    if (was.order === "OPEN" && o.status === "COMPLETED") {
      toast.success(`Order ${o.label} completed — all its shipments are done`);
      router.push("/portal/shipments?tab=completed");
    } else if (was.shipment === "OPEN" && s?.status === "COMPLETED") toast.success(`Shipment ${s.ref || blLabel(s.blNumber)} completed — all its steps are done`);
  }, [o, s, id, shipmentId, router]);

  useEffect(() => {
    if (remountAfter.current && s && s.updatedAt !== remountAfter.current) {
      remountAfter.current = null;
      setFormKey((k) => k + 1);
    }
  }, [s]);

  // Steps the server completed since the last refresh: say so, open the next card.
  const prev = useRef<Map<string, string> | null>(null);
  const prevKey = useRef<string>("");
  useEffect(() => {
    const all = [...orderSteps, ...shipSteps];
    if (!o || (shipmentId && !s)) return;
    const key = `${id}:${shipmentId ?? ""}`;
    const before = prevKey.current === key ? prev.current : null;
    if (before) {
      const newlyDone = all.filter((x) => x.status === "DONE" && before.has(x.id) && before.get(x.id) !== "DONE");
      if (newlyDone.length) {
        for (const x of newlyDone) toast.success(`Step ${stepLabel(x)} complete`);
        // Open the next open step of the SAME group (the shipment's, or the order's) and bring it into view —
        // not the order's first open step at the top of the page.
        const last = newlyDone[newlyDone.length - 1];
        const group = shipSteps.some((x) => x.id === last.id) ? shipSteps : orderSteps;
        const after = [...group].sort(byOrder).filter((x) => x.sortOrder > last.sortOrder);
        const next = firstOpen(after) ?? firstOpen(earlySteps) ?? firstOpen(shipSteps) ?? firstOpen(lateSteps);
        if (next) {
          setOpenId(next.id);
          setUserPicked(true);
          setTimeout(() => document.getElementById(`step-${next.id}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 150);
        } else setUserPicked(false);
      }
    }
    prev.current = new Map(all.map((x) => [x.id, x.status]));
    prevKey.current = key;
  }, [o, s, orderSteps, earlySteps, lateSteps, shipSteps, id, shipmentId]);

  if (q.isLoading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }
  if (q.isError || !o) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{(q.error as Error)?.message || "Order not found"}</Alert>
      </Box>
    );
  }

  const here = `/portal/shipments/orders/${o.id}${shipmentId ? `?shipment=${shipmentId}` : ""}`;
  const hereTab = (t: string) => `${here}${here.includes("?") ? "&" : "?"}tab=${t}`;
  const orderOwner = { kind: "order" as const, id: o.id, label: `Order ${o.label}` };
  const shipOwner = s ? { kind: "shipment" as const, id: s.id, label: `Shipment ${s.ref || blLabel(s.blNumber)}` } : null;
  const openShipments = shipments.filter((x) => x.status === "OPEN");
  const fileCount = recordFileCount(o) + (s ? recordFileCount(s) : 0);
  const single = o.profile?.billingMode === "SINGLE";
  // The order's step cards (0 / 1 / 2 above the shipments, 11 / 13 below): one owner, one set of files.
  const orderCards = {
    owner: orderOwner,
    fileLinks: o.fileLinks,
    docLinks: o.docLinks ?? [],
    generatedDocs: genOrder.data ?? [],
    recordOpen: o.status === "OPEN",
    returnTo: here,
    openId: shown,
    onOpen,
    context: orderContext(o),
    customerId: o.customerId,
    onFileUploaded: (d: string, f: TradeFile[]) => void readOrderUpload(d, f),
    orderShipmentIds: shipments.filter((x) => x.status !== "CANCELLED").map((x) => x.id),
    fieldsTitle: "Contract & premiums",
    fieldsSummary: o.contract ? `Contract ${o.contract.contractNo} · premiums: supplier ${o.supplierPremium ?? "—"}, client ${o.clientPremium ?? "—"} USD/MT` : null,
    fieldsForm: () => (
      <Button variant="outlined" startIcon={<EditIcon />} onClick={() => setEditOpen(true)}>
        Link the contract / confirm premiums
      </Button>
    ),
    stepExtra: (st: TradeStep) =>
      st.code === "XERO_HANDOFF" ? (
        <ReconciliationPanel orderId={o.id} canEdit={o.status === "OPEN"} />
      ) : st.code === "PI_PAYMENT" ? (
        <Stack spacing={1.5}>
          <PriceCheckPanel kind="order" id={o.id} title="PI price check vs contract" />
          <StepPaymentForm step={st} fileLinks={o.fileLinks} expected={o.depositAmount != null ? Number(o.depositAmount) : null} currency={o.currency} canEdit={o.status === "OPEN"} />
        </Stack>
      ) : STEP_PAYMENT[st.code] ? (
        <StepPaymentForm step={st} fileLinks={o.fileLinks} canEdit={o.status === "OPEN"} currency={o.currency} />
      ) : null,
  };

  /** Read a document filed on the order's steps: the PI (step 1) fills the order's blank PI no. / date / amount. */
  const readOrderUpload = async (docType: string, files: TradeFile[]) => {
    const f = files[0];
    if (!f || docType !== "PI") return;
    const t = toast.info(`Reading the PI (${f.fileName})…`, { autoClose: false });
    try {
      const x: any = await api.extractPi({ fileId: f.id, orderId: o!.id });
      if (x.status !== "DONE" || !x.result) throw new Error(x.error || "the AI read failed");
      const filled: string[] = x.result.filled ?? [];
      toast.success(filled.length ? `PI read — filled ${filled.map((k) => FIELD_NAMES[k] ?? k).join(", ")} (blank fields only)` : "PI read — the price check compares it; the order's PI fields were already filled");
    } catch (e: any) {
      toast.error(`Could not read the PI: ${e?.message || "unknown error"}. The file is stored — fill the PI fields by hand.`);
    } finally {
      toast.dismiss(t);
      void qc.invalidateQueries({ queryKey: SHIPMENT_KEYS.orders });
    }
  };

  const readUploaded = async (docType: string, files: TradeFile[]) => {
    const f = files[0];
    if (s && f && docType === "CI") {
      // Step 3b: Vedanta's CI → the shipment's blank CI no. / amount; the CI price check (step 6) compares its prices.
      const t = toast.info(`Reading the CI (${f.fileName})…`, { autoClose: false });
      try {
        const x: any = await api.extractCi({ fileId: f.id, shipmentId: s.id });
        if (x.status !== "DONE" || !x.result) throw new Error(x.error || "the AI read failed");
        const filled: string[] = x.result.filled ?? [];
        toast.success(filled.length ? `CI read — filled ${filled.map((k) => FIELD_NAMES[k] ?? k).join(", ")}` : "CI read — the CI price check compares it");
      } catch (e: any) {
        toast.error(`Could not read the CI: ${e?.message || "unknown error"}. The file is stored.`);
      } finally {
        toast.dismiss(t);
        void qc.invalidateQueries({ queryKey: SHIPMENT_KEYS.orders });
        void qc.invalidateQueries({ queryKey: SHIPMENT_KEYS.shipments });
      }
      return;
    }
    if (!s || !f || (docType !== "BL_DRAFT" && docType !== "ARRIVAL_NOTICE" && docType !== "IMPORT_PERMIT")) return;
    const what = docType === "BL_DRAFT" ? "B/L draft" : docType === "IMPORT_PERMIT" ? "import permit" : "arrival notice";
    const t = toast.info(`Reading the ${what} (${f.fileName})…`, { autoClose: false });
    try {
      if (docType === "BL_DRAFT") {
        const x = await api.extractBlDraft({ fileId: f.id, shipmentId: s.id });
        if (x.status !== "DONE" || !x.result) throw new Error(x.error || "the AI read failed");
        setOffer({ title: "Apply the B/L draft to the B/L details?", intro: `Read from ${f.fileName}. The B/L check against the order is shown on step 3a.`, warning: null, rows: blRows(s, x) });
      } else if (docType === "IMPORT_PERMIT") {
        const x = await api.extractImportPermit({ fileId: f.id, shipmentId: s.id });
        if (x.status !== "DONE" || !x.result) throw new Error(x.error || "the read failed");
        const r = x.result;
        const issues = r.checks.filter((c) => c.status === "mismatch");
        setOffer({
          title: "Fill the import tax from the import permit?",
          intro: `Read from ${f.fileName}${r.via === "text" ? " (text layer)" : " (AI read)"}. 納税額合計 ${fmtYen(r.permit.total)}${r.totalFrom === "fileName" ? " — from the file name" : ""}.`,
          warning: [
            ...issues.map((c) => `${c.label} on the permit is ${c.found}, the shipment has ${c.expected}.`),
            ...(r.formulaOk === false ? ["The permit's CIF × rate + add-on doesn't reproduce its total — check the figures."] : []),
          ].join(" ") || null,
          rows: costRows(s, r.fill, PERMIT_LABELS),
          extra: <PermitFacts permit={r.permit} checks={r.checks} />,
        });
      } else {
        const x = await api.extractAn({ fileId: f.id, shipmentId: s.id });
        if (x.status !== "DONE" || !x.result) throw new Error(x.error || "the AI read failed");
        setOffer({
          title: "Fill the shipment from the arrival notice?",
          intro: `Read from ${f.fileName}. Only blank shipment fields are offered.`,
          warning: x.result.blMismatch ? `This notice is for B/L ${x.result.draft.blNumber}, not ${s.blNumber}. Check it is the right file.` : null,
          rows: anRows(s, x),
          extra: <AnFacts draft={x.result.draft} />,
        });
      }
    } catch (e: any) {
      toast.error(`Could not read the ${what}: ${e?.message || "unknown error"}. The file is stored — fill the fields by hand.`);
    } finally {
      toast.dismiss(t);
    }
  };

  const doShip = async (act: "complete" | "cancel" | "reopen" | "delete") => {
    manual.current = true;
    const r: any = await shipAction.mutateAsync({ id: s!.id, act });
    if (act === "delete") {
      toast.success("Shipment deleted");
      setParam("shipment", null);
    } else toast.success(act === "reopen" && r?.reopenedContract ? `Shipment reopened — order ${r.reopenedContract} was reopened too` : `Shipment ${act === "complete" ? "completed" : act === "cancel" ? "cancelled" : "reopened"}`);
  };

  return (
    // Round N: a fixed width (100% up to 1100px) — it no longer shrinks to the content and jumps when a step opens.
    <Box sx={{ p: { xs: 1.5, md: 3 }, width: "100%", maxWidth: 1100, mx: "auto", boxSizing: "border-box" }}>
      <RecordHeader
        kind="order"
        title={orderTitle(o)}
        status={o.status}
        backHref="/portal/shipments"
        // Round N: the same whole-process count as the Orders list (x/15, x/14), not the order's own 5 steps.
        progress={o.bar ? { done: o.bar.done, total: o.bar.total } : o.progress}
        currentStep={o.currentStep ?? s?.currentStep ?? null}
        steps={o.steps.filter((x) => !x.notApplicable)}
        blockers={openShipments.map((x) => `shipment ${x.ref}${x.blNumber ? "" : " (B/L pending)"}`)}
        onComplete={() => complete.mutateAsync(o.id)}
        onCancel={() => cancel.mutateAsync(o.id)}
        onReopen={() => reopen.mutateAsync(o.id)}
        extraMenu={
          canMarkTest
            ? [
                {
                  label: o.isTest ? "Unmark test order" : "Mark as test",
                  hint: o.isTest ? "Shows in the lists, Home and reminders again" : "Hidden from lists, Home, counts and reminders — nothing is deleted",
                  onClick: () =>
                    void api
                      .setOrderTest(o.id, !o.isTest)
                      .then(async () => {
                        await qc.invalidateQueries();
                        toast.success(o.isTest ? "No longer a test order" : "Marked as test — hidden from the lists");
                      })
                      .catch((e: any) => toast.error(e?.message || "Could not change it")),
                },
              ]
            : undefined
        }
        onActed={() => (manual.current = true)}
        subtitle={
          // Round R: line 2 = "Vedanta → SUS · Contract 454003422 · Sep 26 → Nov 26 · Invoice #1 + #2" — nothing else.
          <Typography variant="body2" color="text.secondary" data-tour="order-header-line2">
            {headerLine2({ supplierShort: shortParty(o.supplier?.name), customerShort: shortCustomer(o.customer?.name), contractNo: o.contract?.contractNo ?? null, monthsLabel: o.monthsLabel ?? null, single })}
          </Typography>
        }
      />

      {o.tolerance?.status === "over" && (
        <Alert severity="warning" sx={{ mb: 2 }} data-tour="order-tolerance">
          {o.tolerance.message}
        </Alert>
      )}
      {o.isTest && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Test order — hidden from the lists, Home, counts and reminders.
        </Alert>
      )}

      <Tabs value={tab} onChange={(_, v) => setParam("tab", TABS[v])} sx={{ mb: 2, borderBottom: 1, borderColor: "divider" }} variant="scrollable" allowScrollButtonsMobile>
        <Tab label="Journey" />
        <Tab label="Details" />
        <Tab label={`Files${fileCount ? ` (${fileCount})` : ""}`} />
      </Tabs>

      {tab === 0 && (
        <Stack spacing={3}>
          <Box data-tour="order-steps">
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              <Typography variant="overline" color="text.secondary">
                Order steps
              </Typography>
              {o.supplierProfile?.hasPI === false && <Chip size="small" variant="outlined" label="No PI (supplier profile)" />}
            </Stack>
            <StepCards {...orderCards} steps={earlySteps} />
          </Box>

          <Box>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
              <Typography variant="overline" color="text.secondary" sx={{ flex: 1 }}>
                Shipments ({shipments.length})
              </Typography>
              {o.status === "OPEN" && (
                <Button
                  startIcon={<AddIcon />}
                  variant="outlined"
                  disabled={addShipment.isPending}
                  data-tour="order-add-shipment"
                  onClick={async () => {
                    try {
                      const n = await addShipment.mutateAsync(o.id);
                      toast.success(`Shipment ${n.ref ?? ""} added`);
                      showShipment(n.id);
                    } catch (e: any) {
                      toast.error(e?.message || "Could not add the shipment");
                    }
                  }}
                >
                  Add shipment
                </Button>
              )}
            </Stack>
            {!shipments.length ? (
              <Paper variant="outlined" sx={{ p: 3, textAlign: "center", borderStyle: "dashed" }}>
                <Typography variant="body2">No shipment on this order yet — add one when Vedanta books the B/L.</Typography>
              </Paper>
            ) : (
              <Grid container spacing={1.5} sx={{ mb: 2 }} data-tour="order-shipment-cards">
                {shipments.map((x) => (
                  <Grid item xs={12} sm={6} md={4} key={x.id} sx={{ position: "relative" }}>
                    {x.id === shipmentId && (
                      <IconButton size="small" aria-label="Shipment actions" onClick={(e) => setShipMenu({ left: e.clientX, top: e.clientY })} sx={{ position: "absolute", top: 16, right: 8, zIndex: 1 }} data-tour="shipment-card-menu">
                        <MoreVertIcon fontSize="small" />
                      </IconButton>
                    )}
                    <ButtonBase onClick={() => showShipment(x.id)} sx={{ width: "100%", textAlign: "left", borderRadius: 2 }}>
                      <Paper variant="outlined" sx={{ p: 1.5, pr: x.id === shipmentId ? 5 : 1.5, width: "100%", border: 2, borderColor: x.id === shipmentId ? "primary.main" : "divider" }}>
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
                            {x.ref}
                          </Typography>
                          <RecordStatusChip status={x.status} />
                        </Stack>
                        <Typography variant="body2">{x.blNumber ? `B/L ${x.blNumber}` : "B/L pending"}</Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                          {[x.vessel, x.voyageNo].filter(Boolean).join(" / ") || "Vessel —"} · ETA {fmtDay(x.eta)}
                        </Typography>
                        <Box sx={{ mt: 0.75 }}>
                          <CurrentStepCell step={x.currentStep} progress={x.progress} maxWidth={260} />
                        </Box>
                        <ProgressCell progress={x.progress} width={120} />
                      </Paper>
                    </ButtonBase>
                  </Grid>
                ))}
              </Grid>
            )}
            {shipments.length > 0 && !s ? (
              <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
                <CircularProgress size={24} />
              </Box>
            ) : s ? (
              <>
                {/* Round R: no bar repeating the selected card — its ⋮ menu sits on the card. */}
                <Box id="shipment-steps" />
                <StepCards
                  // Step 11 moved to the order (round H): the shipment's old row stays in the data, not on screen.
                  steps={s.steps.filter((x) => !(x.notApplicable && x.skipReason?.startsWith("Moved to the order")))}
                  owner={shipOwner!}
                  fileLinks={s.fileLinks}
                  docLinks={s.docLinks ?? []}
                  generatedDocs={genShipment.data ?? []}
                  recordOpen={s.status === "OPEN"}
                  returnTo={here}
                  openId={shown}
                  onOpen={onOpen}
                  context={shipmentContext(o, s)}
                  customerId={o.customerId}
                  onFileUploaded={(d, f) => void readUploaded(d, f)}
                  blCheck={s.blCheck}
                  fieldsTitle="B/L details"
                  fieldsSummary={blSummary(s)}
                  fieldsForm={() => <ShipmentFormDialog key={formKey} inline open shipment={s} onClose={() => undefined} onSaved={() => toast.success("B/L details saved")} />}
                  stepExtra={(st) => {
                    const pay = STEP_PAYMENT[st.code] ? (
                      <StepPaymentForm
                        step={st}
                        fileLinks={s.fileLinks}
                        expected={st.code === "CI_PAYMENT" ? (s.ciAmount != null ? Number(s.ciAmount) : null) : st.code === "TAX_FUNDS" ? (s.estimate?.importTax.actual ?? s.estimate?.importTax.estimate ?? null) : null}
                        currency={st.code === "CI_PAYMENT" ? s.currency : "JPY"}
                        canEdit={s.status === "OPEN"}
                      />
                    ) : null;
                    const main = ESTIMATOR_STEPS[st.code] ? (
                      <EstimatorPanel shipment={s} mode={ESTIMATOR_STEPS[st.code]} canEdit={s.status === "OPEN"} />
                    ) : st.code === "CI_PAYMENT" ? (
                      <PriceCheckPanel kind="shipment" id={s.id} title="CI price check vs contract" />
                    ) : null;
                    // Round N: step 3a warns when the shipments' net total is over the order's quantity ± tolerance.
                    const tol = st.code === "BL_DRAFT_APPROVAL" && o.tolerance?.status === "over" ? (
                      <Alert severity="warning" data-tour="order-tolerance-3a">
                        {o.tolerance.message}
                      </Alert>
                    ) : null;
                    return main || pay || tol ? (
                      <Stack spacing={1}>
                        {tol}
                        {main}
                        {pay && <Box>{pay}</Box>}
                      </Stack>
                    ) : null;
                  }}
                />
              </>
            ) : null}
          </Box>

          {lateSteps.length > 0 && (
            <Box data-tour="order-closing-steps">
              <Typography variant="overline" color="text.secondary">
                Order steps — invoice &amp; reconciliation
              </Typography>
              <StepCards {...orderCards} steps={lateSteps} />
            </Box>
          )}
        </Stack>
      )}

      {tab === 1 && (
        <Stack spacing={3}>
          <OrderOverview order={o} onEdit={() => setEditOpen(true)} />
          {s && (
            <Box>
              <Typography variant="overline" color="text.secondary">
                Shipment {s.ref} · B/L {s.blNumber || "pending"}
              </Typography>
              <ShipmentOverview shipment={s} />
            </Box>
          )}
        </Stack>
      )}

      {tab === 2 && (
        <Stack spacing={3}>
          <Box>
            <Typography variant="overline" color="text.secondary">
              Order {o.label}
            </Typography>
            <LinkedDocuments links={o.docLinks ?? []} returnTo={hereTab("files")} canEdit={o.status === "OPEN"} />
            <FilesTable filter={{ orderId: o.id }} currentId={o.id} uploadTargets={[orderOwner]} canUpload={o.status === "OPEN"} />
          </Box>
          {s && shipOwner && (
            <Box>
              <Typography variant="overline" color="text.secondary">
                Shipment {s.ref} · B/L {s.blNumber || "pending"}
              </Typography>
              <LinkedDocuments links={s.docLinks ?? []} returnTo={hereTab("files")} canEdit={s.status === "OPEN"} />
              <FilesTable filter={{ shipmentId: s.id }} currentId={s.id} uploadTargets={[shipOwner]} canUpload={s.status === "OPEN"} />
            </Box>
          )}
        </Stack>
      )}

      <Menu anchorReference="anchorPosition" anchorPosition={shipMenu ?? undefined} open={!!shipMenu} onClose={() => setShipMenu(null)}>
        {s && (
          <MenuItem
            data-tour="shipment-folder-zip"
            onClick={async () => {
              setShipMenu(null);
              const t = toast.info("Preparing the shipment folder…", { autoClose: false });
              try {
                const name = await api.downloadShipmentZip(s.id);
                toast.success(`Downloaded ${name}`);
              } catch (e: any) {
                toast.error(e?.message || "Could not download the folder");
              } finally {
                toast.dismiss(t);
              }
            }}
          >
            Download shipment folder (.zip)
          </MenuItem>
        )}
        {s?.status === "OPEN" && (
          <MenuItem
            onClick={() => {
              setShipMenu(null);
              setShipConfirm("complete");
            }}
          >
            Complete shipment
          </MenuItem>
        )}
        {s?.status === "OPEN" && (
          <MenuItem
            onClick={() => {
              setShipMenu(null);
              setShipConfirm("cancel");
            }}
          >
            Cancel shipment
          </MenuItem>
        )}
        {s && s.status !== "OPEN" && (
          <MenuItem
            onClick={() => {
              setShipMenu(null);
              setShipConfirm("reopen");
            }}
          >
            Reopen shipment
          </MenuItem>
        )}
        <MenuItem
          sx={{ color: "error.main" }}
          onClick={() => {
            setShipMenu(null);
            setShipConfirm("delete");
          }}
        >
          Delete shipment
        </MenuItem>
      </Menu>
      <ExtractApplyDialog
        open={!!offer}
        title={offer?.title ?? ""}
        intro={offer?.intro}
        warning={offer?.warning}
        rows={offer?.rows ?? NO_ROWS}
        extra={offer?.extra}
        onClose={() => setOffer(null)}
        onApply={async (patch) => {
          remountAfter.current = s?.updatedAt ?? null;
          await applyShip.mutateAsync({ id: s!.id, patch: nestCosts(patch) });
          toast.success("Shipment updated from the document");
        }}
      />
      <ConfirmDialog
        open={!!shipConfirm}
        title={shipConfirm && s ? `${shipConfirm === "delete" ? "Delete" : shipConfirm === "complete" ? "Complete" : shipConfirm === "cancel" ? "Cancel" : "Reopen"} shipment ${s.ref || ""} (B/L ${s.blNumber || "pending"})?` : ""}
        body={shipConfirm === "delete" ? "Its steps and document links are removed. The files themselves stay in the Documents library. This can't be undone." : undefined}
        confirmLabel={shipConfirm === "delete" ? "Delete" : "Confirm"}
        destructive={shipConfirm === "delete" || shipConfirm === "cancel"}
        onClose={() => setShipConfirm(null)}
        onConfirm={() => doShip(shipConfirm!)}
      />
      <OrderFormDialog open={editOpen} order={o} onClose={() => setEditOpen(false)} />
    </Box>
  );
}

const NO_ROWS: ApplyRow[] = [];
const FIELD_NAMES: Record<string, string> = { piNo: "PI no.", piDate: "PI date", piAmount: "PI amount", depositAmount: "deposit", ciNumber: "CI no.", ciAmount: "CI amount" };

/** "#19 · SUS · 6063 · 300 MT". */
function orderTitle(o: Order): string {
  return [o.label, shortCustomer(o.customer?.name), o.grade || o.product, o.qtyMt != null ? `${fmtMt(o.qtyMt)} MT` : null].filter(Boolean).join(" · ");
}
/** "Vedanta" / "SIAE" / "Inalum" — the supplier's short name (round R header line 2). */
const shortParty = (name: string | null | undefined): string | null => (/vedanta/i.test(name ?? "") ? "Vedanta" : /siae|sri indah/i.test(name ?? "") ? "SIAE" : /inalum/i.test(name ?? "") ? "Inalum" : shortCustomer(name));

/** What each order step / document is about. */
function orderContext(o: Order): StepContext {
  const money = (v: unknown) => fmtMoney(v as any, o.currency);
  return {
    stepLine: (st) =>
      st.code === "CHECK_CONTRACT"
        ? o.contract
          ? `Contract ${o.contract.contractNo} · premiums: supplier ${o.supplierPremium ?? "—"}, client ${o.clientPremium ?? "—"}${o.upcharge ? ` + ${o.upcharge}` : ""} USD/MT`
          : "No contract linked yet — link it (or upload it) and confirm the premiums"
        : st.code === "PI_PAYMENT"
          ? [o.piNo && `PI ${o.piNo}`, o.piDate && `dated ${fmtDmy(o.piDate)}`, o.piAmount != null && money(o.piAmount)].filter(Boolean).join(" · ") || null
          // Round R: no customer / product / "every shipment of #26" lines — they repeat the page header.
          : null,
    docLine: (d) => {
      if (d === "DEPOSIT_PROOF") {
        const pct = o.depositPct != null ? `${Number(o.depositPct)}%` : "";
        const due = o.depositDueDate ? `, due ${fmtDmy(o.depositDueDate)}` : depositTermLabel(o.depositDueDays, o.depositDueUnit) ? ` (${depositTermLabel(o.depositDueDays, o.depositDueUnit)} after the PI date)` : "";
        return o.depositAmount != null ? `Deposit ${pct} = ${money(o.depositAmount)}${due}` : null;
      }
      if (d === "PI") return o.piNo ? `PI ${o.piNo}${o.piAmount != null ? ` · ${money(o.piAmount)}` : ""}` : null;
      return null;
    },
  };
}

/** Facts for the shipment's steps. */
function shipmentContext(o: Order, s: Shipment): StepContext {
  return {
    // Round R: no step / slot lines that repeat the shipment card (ref, B/L, customer, vessel, tonnage).
    stepLine: (st) => (st.code === "BL_DRAFT_APPROVAL" ? `Order ${o.label} · ${o.productLabel}` : null),
    docLine: (d) => {
      if (d === "CI_PAYMENT_PROOF") return s.ciAmount != null ? `CI ${s.ciNumber ?? ""} · ${fmtMoney(s.ciAmount, s.currency)}`.replace("CI  ·", "CI ·") : null;
      // File OR field (prod click-through): the code from Vedanta's email, the SI's delivery dates, the in-app estimate.
      if (d === "TELEX_RELEASE") return s.telexReleaseCode ? `Release code ${s.telexReleaseCode} (meets this — no file needed)` : "Upload the telex release, or type the release code in the B/L details";
      if (d === "DELIVERY_SCHEDULE") return "Or: the delivery dates on the 出庫・納入依頼書 rows meet this";
      if (d === "TAX_ESTIMATE") return (s.costs as any)?.cifUsd && (s.costs as any)?.fxRate ? "The in-app estimate (CIF + rate) meets this — the broker's file is optional" : "Or: fill CIF and the rate in the estimate below";
      return null;
    },
  };
}

function blSummary(s: Shipment): string | null {
  if (!s.blNumber) return null;
  return [`B/L ${s.blNumber}`, s.productLine, s.vessel && [s.vessel, s.voyageNo].filter(Boolean).join(" / "), s.netWeightMt != null && `${fmtMt(s.netWeightMt)} MT net`].filter(Boolean).join(" · ");
}

function OrderOverview({ order: o, onEdit }: { order: Order; onEdit: () => void }) {
  const money = (v: unknown) => fmtMoney(v as any, o.currency);
  const p = o.profile;
  const check = new Set(o.checkFields ?? []);
  const confirm = useTradeMutation((a, oid: string) => a.updateOrder(oid, { checkFields: [] }));
  const CHECK_LABELS: Record<string, string> = { customerId: "customer", contractId: "contract", clientPremium: "client premium", supplierPremium: "supplier premium", currentStep: "current step" };
  const ck = (k: string | string[], value: React.ReactNode) =>
    (Array.isArray(k) ? k : [k]).some((x) => check.has(x)) ? (
      <>
        {value} <Chip size="small" color="warning" variant="outlined" label="check" sx={{ height: 18, ml: 0.5 }} />
      </>
    ) : (
      value
    );
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
        <Typography variant="subtitle2" sx={{ flex: 1 }}>
          Order {o.label}
        </Typography>
        {check.size > 0 && (
          <Tooltip title={`To confirm with ADH: ${[...check].map((k) => CHECK_LABELS[k] ?? k).join(", ")} (from the task list import). Edit the order if anything is wrong, then mark it confirmed.`}>
            <Button size="small" color="warning" disabled={confirm.isPending} onClick={() => confirm.mutate(o.id)} data-tour="order-check-confirm">
              Check: {[...check].map((k) => CHECK_LABELS[k] ?? k).join(", ")} · Mark confirmed
            </Button>
          </Tooltip>
        )}
        <Button variant="outlined" startIcon={<EditIcon />} onClick={onEdit}>
          Edit
        </Button>
      </Stack>
      <Grid container spacing={2}>
        <Grid item xs={6} md={3}>
          <Field label="Customer" value={ck("customerId", o.customer?.name)} />
        </Grid>
        <Grid item xs={6} md={3}>
          <Field label="Supplier" value={o.supplier?.name} />
        </Grid>
        <Grid item xs={6} md={3}>
          <Field label="Contract" value={ck("contractId", o.contract?.contractNo ?? "—")} />
        </Grid>
        <Grid item xs={6} md={3}>
          <Field label="Ship → delivery" value={o.monthsLabel || "—"} />
        </Grid>
        <Grid item xs={6} md={3}>
          <Field label="Product" value={o.productLabel || "—"} />
        </Grid>
        <Grid item xs={6} md={3}>
          <Field label="Tolerance" value={o.tolPct != null ? `±${Number(o.tolPct)}%` : "—"} />
        </Grid>
        <Grid item xs={12} md={6}>
          <Field
            label="Customer profile"
            value={`${p.billingMode === "SINGLE" ? "Single invoice" : "Invoice #1 + #2"} · import permit ${p.sendImportPermit ? "sent" : "not sent"}${p.port ? ` · ${p.port}` : ""} · ${p.truckCapacityT}t trucks`}
          />
        </Grid>
      </Grid>
      <Grid container spacing={2} sx={{ mt: 0.5 }}>
        <Grid item xs={12} md={6} data-tour="order-vedanta-side">
          <Typography variant="overline" color="text.secondary">
            Vedanta side
          </Typography>
          <Grid container spacing={1.5}>
            <Grid item xs={6}>
              <Field label="PI no. / date" value={[o.piNo, o.piDate && fmtDmy(o.piDate)].filter(Boolean).join(" · ") || "—"} />
            </Grid>
            <Grid item xs={6}>
              <Field label="PI amount" value={o.piAmount != null ? money(o.piAmount) : "—"} />
            </Grid>
            <Grid item xs={6}>
              <Field
                label="Deposit"
                value={
                  o.depositAmount != null
                    ? `${o.depositPct ?? ""}% = ${money(o.depositAmount)}${o.depositPaidAt ? ` · paid ${fmtDmy(o.depositPaidAt)}` : o.depositDueDate ? ` · due ${fmtDmy(o.depositDueDate)}` : ""}`
                    : "—"
                }
              />
            </Grid>
            <Grid item xs={6}>
              <Field label="Supplier premium (USD/MT)" value={ck("supplierPremium", o.supplierPremium ?? "—")} />
            </Grid>
          </Grid>
        </Grid>
        <Grid item xs={12} md={6} data-tour="order-customer-side">
          <Typography variant="overline" color="text.secondary">
            Customer side
          </Typography>
          <Grid container spacing={1.5}>
            <Grid item xs={6}>
              <Field label="Customer PO" value={[o.customerPoNo, o.customerPoDate && fmtDmy(o.customerPoDate)].filter(Boolean).join(" · ") || "—"} />
            </Grid>
            <Grid item xs={6}>
              <Field label="Client premium (USD/MT)" value={ck("clientPremium", `${o.clientPremium ?? "—"}${o.upcharge ? ` + ${o.upcharge}` : ""}`)} />
            </Grid>
          </Grid>
        </Grid>
      </Grid>
    </Paper>
  );
}

const BL_FIELDS: Array<[keyof Shipment & string, string]> = [
  ["blNumber", "B/L no."],
  ["shippingLine", "Shipping line"],
  ["vessel", "Vessel"],
  ["voyageNo", "Voyage"],
  ["etd", "ETD"],
  ["portOfLoading", "Port of loading"],
  ["portOfDischarge", "Port of discharge"],
  ["netWeightMt", "Net weight (MT)"],
  ["grossWeightMt", "Gross weight (MT)"],
  ["totalBundles", "Bundles"],
  ["totalPieces", "Pieces"],
  ["containerCount", "Containers"],
  ["hsCode", "HS code"],
  ["countryOfOrigin", "Country of origin"],
  ["commodity", "Commodity"],
  ["sizeSpec", "Size"],
];
const AN_LABELS: Record<string, string> = {
  vessel: "Vessel",
  voyageNo: "Voyage",
  eta: "ETA",
  grossWeightMt: "Gross weight (MT)",
  netWeightMt: "Net weight (MT)",
  totalBundles: "Bundles",
  totalPieces: "Pieces",
  containerCount: "Containers",
  portOfLoading: "Port of loading",
  portOfDischarge: "Port of discharge",
};
const shownVal = (v: unknown) => (v === null || v === undefined || v === "" ? null : /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? String(v).slice(0, 10) : String(v));
const same = (a: unknown, b: unknown) => {
  const x = shownVal(a);
  const y = shownVal(b);
  if (x === null || y === null) return x === y;
  return Number.isFinite(Number(x)) && Number.isFinite(Number(y)) ? Number(x) === Number(y) : x.trim().toUpperCase() === y.trim().toUpperCase();
};
function blRows(s: Shipment, x: BlExtraction): ApplyRow[] {
  const d = x.result!.draft as Record<string, unknown>;
  return BL_FIELDS.filter(([k]) => shownVal(d[k]) !== null && !same(d[k], s[k])).map(([k, label]) => ({ key: k, label, current: shownVal(s[k]), next: shownVal(d[k])!, value: d[k] }));
}
const COST_LABELS: Record<string, string> = {
  "costs.thc": "THC (estimator, step 7)",
  "costs.docFee": "Documentation fee (estimator)",
  "costs.equipmentFee": "EQMC (estimator; 加算運賃 default)",
};
const PERMIT_LABELS: Record<string, string> = {
  "costs.importTaxActual": "Actual import tax (納税額合計)",
  "costs.fxRate": "Customs rate (円/USD)",
  "costs.cifUsd": "CIF (USD, 仕入書価格)",
  "costs.customsAddOnJpy": "加算運賃 (JPY)",
};
const costOf = (s: Shipment, key: string) => (key.startsWith("costs.") ? (s.costs as any)?.[key.slice(6)] : (s as any)[key]);
function anRows(s: Shipment, x: AnExtraction): ApplyRow[] {
  return Object.entries(x.result!.fill ?? {}).map(([k, v]) => ({ key: k, label: AN_LABELS[k] ?? COST_LABELS[k] ?? k, current: shownVal(costOf(s, k)), next: shownVal(v) ?? "", value: v }));
}
function costRows(s: Shipment, fill: Record<string, unknown>, labels: Record<string, string>): ApplyRow[] {
  return Object.entries(fill).map(([k, v]) => ({ key: k, label: labels[k] ?? k, current: shownVal(costOf(s, k)), next: shownVal(v) ?? "", value: v }));
}
/** {"costs.thc": 1} → { costs: { thc: 1 } } (Shipment.costs merges a patch). */
function nestCosts(patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const costs: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (k.startsWith("costs.")) costs[k.slice(6)] = v;
    else out[k] = v;
  }
  return Object.keys(costs).length ? { ...out, costs } : out;
}

/** Read-only facts from the A/N with no shipment field: the arriving vessel, CY, charges. */
function AnFacts({ draft }: { draft: AnExtraction["result"] extends infer R ? (R extends { draft: infer D } ? D : never) : never }) {
  const rows: Array<[string, string]> = [];
  if (draft.tsVessel) rows.push(["Arriving vessel (after T/S)", [draft.tsVessel, draft.tsVoyageNo].filter(Boolean).join(" / ")]);
  if (draft.cyTerminal) rows.push(["CY terminal", draft.cyTerminal]);
  if (draft.cbm) rows.push(["Measurement", `${draft.cbm} CBM`]);
  if (draft.telexRelease) rows.push(["B/L", "Telex release"]);
  for (const c of draft.charges) rows.push([c.code ?? "Charge", `${c.currency ?? ""} ${c.amount?.toLocaleString("en-US") ?? "—"}${c.unit && c.rate ? ` (${c.unit} × ${c.rate.toLocaleString("en-US")})` : ""}`]);
  if (!rows.length) return null;
  return <FactList rows={rows} />;
}
function PermitFacts({ permit, checks }: { permit: PermitExtraction["result"] extends infer R ? (R extends { permit: infer P } ? P : never) : never; checks: PermitCheck[] }) {
  const rows: Array<[string, string]> = [
    ["申告番号 / 申告年月日", `${permit.declarationNo ?? "—"} · ${permit.declarationDate ?? "—"}`],
    ["積載船", permit.vessel ?? "—"],
    ["貨物個数 / 重量", `${permit.packages ?? "—"} · ${permit.grossWeightKg?.toLocaleString("en-US") ?? "—"} kg`],
    ["申告価格", fmtYen(permit.customsValue)],
    ["消費税 / 地方消費税", `${fmtYen(permit.national)} / ${fmtYen(permit.local)}`],
    ...checks.map((c): [string, string] => [c.label, `${c.found ?? "—"} ${c.status === "ok" ? "✓" : c.status === "mismatch" ? `✗ (shipment: ${c.expected})` : "(nothing to compare)"}`]),
  ];
  return <FactList rows={rows} />;
}
function FactList({ rows }: { rows: Array<[string, string]> }) {
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: "auto 1fr", columnGap: 2, rowGap: 0.25, mt: 1 }}>
      {rows.map(([k, v], i) => (
        <React.Fragment key={i}>
          <Typography variant="body2" color="text.secondary">
            {k}
          </Typography>
          <Typography variant="body2">{v}</Typography>
        </React.Fragment>
      ))}
    </Box>
  );
}
