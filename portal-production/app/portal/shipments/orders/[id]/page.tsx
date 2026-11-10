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

import { hiddenStep } from "../../_lib/process";
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
import { blLabel, depositTermLabel, fmtDay, fmtDmy, fmtMoney, fmtMt, fmtYen, shortParty, stepLabel, shortCustomer } from "../../_lib/format";
import RecordHeader from "../../_components/RecordHeader";
import AimeeButton from "../../_components/aimee/AimeeButton";
import { setAimeeContext } from "../../_components/aimee/bridge";
import OverallProcess from "../../_components/OverallProcess";
import ShipmentOverview from "../../_components/ShipmentOverview";
import StepCards, { type StepContext } from "../../_components/StepCards";
import ShipmentFormDialog from "../../_components/ShipmentFormDialog";
import FilesTable from "../../_components/FilesTable";
import LinkedDocuments from "../../_components/LinkedDocuments";
import { ConfirmDialog, CurrentStepCell, Field, ProgressCell, RecordStatusChip } from "../../_components/bits";
import ExtractApplyDialog, { type ApplyRow } from "../../_components/ExtractApplyDialog";
import OrderFormDialog from "../../_components/OrderFormDialog";
import { useReopenOrder } from "../../_components/OrderReopen";
import EstimatorPanel, { ESTIMATOR_STEPS } from "../../_components/EstimatorPanel";
import ReconciliationPanel from "../../_components/ReconciliationPanel";
import PriceCheckPanel from "../../_components/PriceCheckPanel";
import StepPaymentForm from "../../_components/StepPaymentForm";
import IssuesPanel from "../../_components/IssuesPanel";
import RecordEmailsPanel from "../../_components/RecordEmailsPanel";
import CustomerPackingPanel from "../../_components/CustomerPackingPanel";
import { useTranslations } from "next-intl";
import { useStepName } from "@/i18n/hooks";

/** A message lookup passed to the helpers below (shipments.orderPage). */
type Tr = (key: string, values?: Record<string, string | number>) => string;

const TABS = ["journey", "details", "files"] as const;
/** Order steps from here on (11 Invoice #2, 13 reconciliation) show after the shipments. */
const LATE_FROM = 100;
const byOrder = (a: TradeStep, b: TradeStep) => a.sortOrder - b.sortOrder;
const firstOpen = (steps: TradeStep[]) => [...steps].sort(byOrder).find((s) => !s.isOngoing && !s.notApplicable && s.status !== "DONE") ?? null;

export default function OrderPage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations("shipments.orderPage");
  const stepName = useStepName();
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

  const fieldName = (k: string) => (FIELD_NAMES.includes(k) ? t(`fieldNames.${k}`) : k);
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
  // Round BF: the cancelled banner's [Reopen] (same confirm as the list row).
  const reopenBanner = useReopenOrder();
  const tr = useTranslations("orders.reopen");
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
  const shipSteps = useMemo(() => [...(s?.steps ?? [])].filter((x) => !hiddenStep(x)).sort(byOrder), [s?.steps]);
  const current = firstOpen(earlySteps) ?? firstOpen(shipSteps) ?? firstOpen(lateSteps);
  // Round P: ?step=<stepId> (from an inbox "Linked to" chip) opens that step card.
  const wantedStep = params?.get("step") ?? null;
  // Round AF: ?file=<name> (from a result box / "Filed automatically") highlights that file inside the opened step.
  const wantedFile = params?.get("file") ?? null;
  const [openId, setOpenId] = useState<string | null>(wantedStep);
  const [userPicked, setUserPicked] = useState(!!wantedStep);
  const shown = userPicked ? openId : (current?.id ?? null);
  const onOpen = (stepId: string | null) => {
    setUserPicked(true);
    setOpenId(stepId);
  };
  // Round BL: tell AIMEE what is in view — the shipment (or the order), the open step card.
  useEffect(() => {
    if (!o) return;
    const st = [...earlySteps, ...shipSteps, ...lateSteps].find((x) => x.id === shown) ?? null;
    const onShipment = !!st && shipSteps.some((x) => x.id === st.id) && !!s;
    setAimeeContext("page", {
      path: pathname,
      ref: onShipment || (!st && s) ? (s?.ref ?? null) : `#${o.orderNo}`,
      orderId: o.id,
      shipmentId: s?.id ?? null,
      step: st ? { id: st.id, code: st.code, no: st.displayNo ?? null, title: stepName(st.code, st.title) } : null,
      file: wantedFile ? { name: wantedFile } : null,
      view: "Order",
    });
  }, [o, s, shown, earlySteps, shipSteps, lateSteps, pathname, wantedFile, stepName]);
  useEffect(() => () => setAimeeContext("page", null), []);
  // Round AF: a ?step= deep link (a filed document line, the order chip) WINS over the default open step — before, this
  // reset fired on mount and the page fell back to the current step, so the link only scrolled without opening the card.
  useEffect(() => {
    setUserPicked(!!wantedStep);
    if (wantedStep) setOpenId(wantedStep);
  }, [id, shipmentId, wantedStep]);

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
      toast.success(t("orderCompleted", { label: o.label }));
      router.push("/portal/shipments?tab=completed");
    } else if (was.shipment === "OPEN" && s?.status === "COMPLETED") toast.success(t("shipmentCompleted", { ref: s.ref || blLabel(s.blNumber) }));
  }, [o, s, id, shipmentId, router, t]);

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
        for (const x of newlyDone) toast.success(t("stepComplete", { step: stepLabel({ ...x, title: stepName(x.code, x.title) }) }));
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
  }, [o, s, orderSteps, earlySteps, lateSteps, shipSteps, id, shipmentId, t, stepName]);

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
        <Alert severity="error">{(q.error as Error)?.message || t("notFound")}</Alert>
      </Box>
    );
  }

  const here = `/portal/shipments/orders/${o.id}${shipmentId ? `?shipment=${shipmentId}` : ""}`;
  const hereTab = (tb: string) => `${here}${here.includes("?") ? "&" : "?"}tab=${tb}`;
  const orderOwner = { kind: "order" as const, id: o.id, label: t("orderLabel", { label: o.label }) };
  const shipOwner = s ? { kind: "shipment" as const, id: s.id, label: t("shipmentLabel", { ref: s.ref || blLabel(s.blNumber) }) } : null;
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
    context: orderContext(o, t),
    customerId: o.customerId,
    onFileUploaded: (d: string, f: TradeFile[]) => void readOrderUpload(d, f),
    orderShipmentIds: shipments.filter((x) => x.status !== "CANCELLED").map((x) => x.id),
    fieldsTitle: t("contractPremiums"),
    fieldsSummary: o.contract ? t("contractSummary", { no: o.contract.contractNo, supplier: String(o.supplierPremium ?? "—"), client: String(o.clientPremium ?? "—") }) : null,
    fieldsForm: () => (
      <Button variant="outlined" startIcon={<EditIcon />} onClick={() => setEditOpen(true)}>
        {t("linkContract")}
      </Button>
    ),
    stepExtra: (st: TradeStep) =>
      st.code === "XERO_HANDOFF" ? (
        <ReconciliationPanel orderId={o.id} canEdit={o.status === "OPEN"} />
      ) : st.code === "PI_PAYMENT" ? (
        <Stack spacing={1.5}>
          <PriceCheckPanel kind="order" id={o.id} title={t("piPriceCheck")} />
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
    const tid = toast.info(t("readingPi", { file: f.fileName }), { autoClose: false });
    try {
      const x: any = await api.extractPi({ fileId: f.id, orderId: o!.id });
      if (x.status !== "DONE" || !x.result) throw new Error(x.error || t("aiReadFailed"));
      const filled: string[] = x.result.filled ?? [];
      toast.success(filled.length ? t("piReadFilled", { fields: filled.map(fieldName).join(", ") }) : t("piReadNone"));
    } catch (e: any) {
      toast.error(t("piReadError", { error: e?.message || t("unknownError") }));
    } finally {
      toast.dismiss(tid);
      void qc.invalidateQueries({ queryKey: SHIPMENT_KEYS.orders });
    }
  };

  const readUploaded = async (docType: string, files: TradeFile[]) => {
    const f = files[0];
    if (s && f && docType === "CI") {
      // Step 3b: Vedanta's CI → the shipment's blank CI no. / amount; the CI price check (step 6) compares its prices.
      const tid = toast.info(t("readingCi", { file: f.fileName }), { autoClose: false });
      try {
        const x: any = await api.extractCi({ fileId: f.id, shipmentId: s.id });
        if (x.status !== "DONE" || !x.result) throw new Error(x.error || t("aiReadFailed"));
        const filled: string[] = x.result.filled ?? [];
        toast.success(filled.length ? t("ciReadFilled", { fields: filled.map(fieldName).join(", ") }) : t("ciReadNone"));
        // Round BJ: a newer CI version than the stored amount — proposed under the CI amount, never written.
        const p = x.result.ciProposal;
        if (p && p.from !== null) toast.warning(t("ciRevised", { from: fmtMoney(p.from, s.currency), to: fmtMoney(p.to, s.currency) }), { autoClose: 12000 });
      } catch (e: any) {
        toast.error(t("ciReadError", { error: e?.message || t("unknownError") }));
      } finally {
        toast.dismiss(tid);
        void qc.invalidateQueries({ queryKey: SHIPMENT_KEYS.orders });
        void qc.invalidateQueries({ queryKey: SHIPMENT_KEYS.shipments });
      }
      return;
    }
    // Round BJ: the carrier's final / scanned B/L is read like a draft (#18-1's OBL on step 3a was never read).
    const isBl = docType === "BL_DRAFT" || ((docType === "BL" || docType === "BL_SCAN") && /pdf|image/i.test(f?.mimeType ?? ""));
    if (!s || !f || (!isBl && docType !== "ARRIVAL_NOTICE" && docType !== "IMPORT_PERMIT")) return;
    const what = isBl ? t("docBlDraft") : docType === "IMPORT_PERMIT" ? t("docImportPermit") : t("docArrivalNotice");
    const tid = toast.info(t("readingDoc", { what, file: f.fileName }), { autoClose: false });
    try {
      if (isBl) {
        const x = await api.extractBlDraft({ fileId: f.id, shipmentId: s.id });
        if (x.status !== "DONE" || !x.result) throw new Error(x.error || t("aiReadFailed"));
        setOffer({ title: t("applyBlTitle"), intro: t("applyBlIntro", { file: f.fileName }), warning: null, rows: blRows(s, x, t) });
      } else if (docType === "IMPORT_PERMIT") {
        const x = await api.extractImportPermit({ fileId: f.id, shipmentId: s.id });
        if (x.status !== "DONE" || !x.result) throw new Error(x.error || t("readFailed"));
        const r = x.result;
        const issues = r.checks.filter((c) => c.status === "mismatch");
        setOffer({
          title: t("permitTitle"),
          intro: t("permitIntro", { file: f.fileName, via: r.via === "text" ? t("viaText") : t("viaAi"), total: fmtYen(r.permit.total), from: r.totalFrom === "fileName" ? t("fromFileName") : "" }),
          warning: [
            ...issues.map((c) => t("permitMismatch", { label: c.label, found: String(c.found ?? ""), expected: String(c.expected ?? "") })),
            ...(r.formulaOk === false ? [t("permitFormula")] : []),
          ].join(" ") || null,
          rows: costRows(s, r.fill, PERMIT_LABELS, t),
          extra: <PermitFacts permit={r.permit} checks={r.checks} />,
        });
      } else {
        const x = await api.extractAn({ fileId: f.id, shipmentId: s.id });
        if (x.status !== "DONE" || !x.result) throw new Error(x.error || t("aiReadFailed"));
        setOffer({
          title: t("anTitle"),
          intro: t("anIntro", { file: f.fileName }),
          warning: x.result.blMismatch ? t("anMismatch", { found: String(x.result.draft.blNumber ?? ""), bl: String(s.blNumber ?? "") }) : null,
          rows: anRows(s, x, t),
          extra: <AnFacts draft={x.result.draft} />,
        });
      }
    } catch (e: any) {
      toast.error(t("docReadError", { what, error: e?.message || t("unknownError") }));
    } finally {
      toast.dismiss(tid);
    }
  };

  const doShip = async (act: "complete" | "cancel" | "reopen" | "delete") => {
    manual.current = true;
    const r: any = await shipAction.mutateAsync({ id: s!.id, act });
    if (act === "delete") {
      toast.success(t("shipmentDeleted"));
      setParam("shipment", null);
    } else toast.success(act === "reopen" && r?.reopenedContract ? t("shipmentReopenedOrder", { order: r.reopenedContract }) : act === "complete" ? t("shipmentDoneToast") : act === "cancel" ? t("shipmentCancelledToast") : t("shipmentReopenedToast"));
  };

  const unconfirmed = (o.checkFields ?? []).includes("status");
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
        blockers={openShipments.map((x) => (x.blNumber ? t("blockerShipment", { ref: x.ref }) : t("blockerShipmentNoBl", { ref: x.ref })))}
        onComplete={() => complete.mutateAsync(o.id)}
        onCancel={() => cancel.mutateAsync(o.id)}
        onReopen={() => reopen.mutateAsync(o.id)}
        extraMenu={
          canMarkTest
            ? [
                {
                  label: o.isTest ? t("unmarkTest") : t("markTest"),
                  hint: o.isTest ? t("unmarkTestHint") : t("markTestHint"),
                  onClick: () =>
                    void api
                      .setOrderTest(o.id, !o.isTest)
                      .then(async () => {
                        await qc.invalidateQueries();
                        toast.success(o.isTest ? t("unmarkedTest") : t("markedTest"));
                      })
                      .catch((e: any) => toast.error(e?.message || t("couldNotChange"))),
                },
              ]
            : undefined
        }
        onActed={() => (manual.current = true)}
        actions={<AimeeButton />}
        badge={
          // Round AB (owner): "status" in checkFields = ADH has not confirmed the order yet (the INALM sample) — no reminders until "Mark confirmed".
          unconfirmed ? (
            <Tooltip title={t("unconfirmedTip")}>
              <Chip size="small" color="warning" variant="outlined" label={t("unconfirmed")} sx={{ height: 20 }} data-tour="order-unconfirmed" />
            </Tooltip>
          ) : null
        }
        subtitle={
          // Round R: line 2 = "Vedanta → SUS · Contract 454003422 · Sep 26 → Nov 26 · Invoice #1 + #2" — nothing else.
          <Typography variant="body2" color="text.secondary" data-tour="order-header-line2">
            {headerLine2({ supplierShort: shortParty(o.supplier?.name), customerShort: shortCustomer(o.customer?.name), contractNo: o.contract?.contractNo ?? null, monthsLabel: o.monthsLabel ?? null, single })}
          </Typography>
        }
      />

      {o.status === "CANCELLED" && (
        <Alert
          severity="warning"
          sx={{ mb: 2 }}
          data-tour="order-cancelled-banner"
          action={
            <Button color="inherit" size="small" variant="outlined" onClick={() => reopenBanner.ask({ id: o.id, label: o.label })} data-tour="order-banner-reopen">
              {tr("confirm")}
            </Button>
          }
        >
          <b>
            {o.cancelled?.at
              ? o.cancelled.byName
                ? tr("banner", { by: o.cancelled.byName, date: fmtDay(o.cancelled.at) })
                : tr("bannerNoName", { date: fmtDay(o.cancelled.at) })
              : tr("bannerPlain")}
          </b>{" "}
          · {tr("bannerHint")}
        </Alert>
      )}
      {reopenBanner.dialog}
      {o.tolerance?.status === "over" && (
        <Alert severity="warning" sx={{ mb: 2 }} data-tour="order-tolerance">
          {o.tolerance.message}
        </Alert>
      )}
      {o.isTest && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {t("testOrderBanner")}
        </Alert>
      )}

      <Tabs value={tab} onChange={(_, v) => setParam("tab", TABS[v])} sx={{ mb: 2, borderBottom: 1, borderColor: "divider" }} variant="scrollable" allowScrollButtonsMobile>
        <Tab label={t("tabJourney")} />
        <Tab label={t("tabDetails")} />
        <Tab label={`${t("tabFiles")}${fileCount ? ` (${fileCount})` : ""}`} />
      </Tabs>

      {tab === 0 && (
        <Stack spacing={3}>
          <OverallProcess orderId={o.id} />
          <Box data-tour="order-steps">
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              <Typography variant="overline" color="text.secondary">
                {t("orderSteps")}
              </Typography>
              {o.supplierProfile?.hasPI === false && <Chip size="small" variant="outlined" label={t("noPi")} />}
            </Stack>
            <StepCards {...orderCards} steps={earlySteps} highlightFile={wantedFile} />
          </Box>

          <Box>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
              <Typography variant="overline" color="text.secondary" sx={{ flex: 1 }}>
                {t("shipments", { n: shipments.length })}
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
                      toast.success(t("shipmentAdded", { ref: n.ref ?? "" }));
                      showShipment(n.id);
                    } catch (e: any) {
                      toast.error(e?.message || t("couldNotAdd"));
                    }
                  }}
                >
                  {t("addShipment")}
                </Button>
              )}
            </Stack>
            {!shipments.length ? (
              <Paper variant="outlined" sx={{ p: 3, textAlign: "center", borderStyle: "dashed" }}>
                <Typography variant="body2">{t("noShipment")}</Typography>
              </Paper>
            ) : (
              <Grid container spacing={1.5} sx={{ mb: 2 }} data-tour="order-shipment-cards">
                {shipments.map((x) => (
                  <Grid item xs={12} sm={6} md={4} key={x.id} sx={{ position: "relative" }}>
                    {x.id === shipmentId && (
                      <IconButton size="small" aria-label={t("shipmentActions")} onClick={(e) => setShipMenu({ left: e.clientX, top: e.clientY })} sx={{ position: "absolute", top: 16, right: 8, zIndex: 1 }} data-tour="shipment-card-menu">
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
                        <Typography variant="body2">{x.blNumber ? `B/L ${x.blNumber}` : t("blPending")}</Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                          {[x.vessel, x.voyageNo].filter(Boolean).join(" / ") || t("vesselNone")} · ETA {fmtDay(x.eta)}
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
                {/* Round BA: how this customer wants it packed (nothing when there's no packing info). */}
                <Box sx={{ mb: 1.5, "&:empty": { display: "none" } }}>
                  <CustomerPackingPanel customerId={o.customerId} />
                </Box>
                <StepCards
                  highlightFile={wantedFile}
                  // Step 11 moved to the order (round H): the shipment's old row stays in the data, not on screen.
                  steps={s.steps.filter((x) => !hiddenStep(x))}
                  owner={shipOwner!}
                  fileLinks={s.fileLinks}
                  docLinks={s.docLinks ?? []}
                  generatedDocs={genShipment.data ?? []}
                  recordOpen={s.status === "OPEN"}
                  returnTo={here}
                  openId={shown}
                  onOpen={onOpen}
                  context={shipmentContext(o, s, t)}
                  customerId={o.customerId}
                  onFileUploaded={(d, f) => void readUploaded(d, f)}
                  blCheck={s.blCheck}
                  fieldsTitle={t("blDetails")}
                  fieldsSummary={blSummary(s, t)}
                  fieldsForm={() => <ShipmentFormDialog key={formKey} inline open shipment={s} onClose={() => undefined} onSaved={() => toast.success(t("blSaved"))} />}
                  // Round BI: step 7's import-tax-estimate file sits in the import tax card.
                  extraSlots={(st) => (st.code === "CUSTOMS_TAX_ESTIMATE" ? ["TAX_ESTIMATE"] : [])}
                  stepExtra={(st, slot) => {
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
                      <EstimatorPanel shipment={s} mode={ESTIMATOR_STEPS[st.code]} canEdit={s.status === "OPEN"} taxSlot={st.code === "CUSTOMS_TAX_ESTIMATE" && st.requiredDocTypes.includes("TAX_ESTIMATE") ? slot("TAX_ESTIMATE") : null} />
                    ) : st.code === "CI_PAYMENT" ? (
                      <PriceCheckPanel kind="shipment" id={s.id} title={t("ciPriceCheck")} />
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
                {t("closingSteps")}
              </Typography>
              <StepCards {...orderCards} steps={lateSteps} highlightFile={wantedFile} />
            </Box>
          )}
        </Stack>
      )}

      {tab === 1 && (
        <Stack spacing={3}>
          <OrderOverview order={o} onEdit={() => setEditOpen(true)} />
          <CustomerPackingPanel customerId={o.customerId} />
          <IssuesPanel orderId={o.id} />
          {s && (
            <Box>
              <Typography variant="overline" color="text.secondary">
                {t("shipmentHeading", { ref: s.ref, bl: s.blNumber || t("pending") })}
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
              {t("orderLabel", { label: o.label })}
            </Typography>
            <LinkedDocuments links={o.docLinks ?? []} returnTo={hereTab("files")} canEdit={o.status === "OPEN"} />
            <FilesTable filter={{ orderId: o.id }} currentId={o.id} uploadTargets={[orderOwner]} canUpload={o.status === "OPEN"} />
            <Box sx={{ mt: 2 }}>
              <RecordEmailsPanel orderId={o.id} title={t("emailsOrder")} />
            </Box>
          </Box>
          {s && shipOwner && (
            <Box>
              <Typography variant="overline" color="text.secondary">
                {t("shipmentHeading", { ref: s.ref, bl: s.blNumber || t("pending") })}
              </Typography>
              <LinkedDocuments links={s.docLinks ?? []} returnTo={hereTab("files")} canEdit={s.status === "OPEN"} />
              <FilesTable filter={{ shipmentId: s.id }} currentId={s.id} uploadTargets={[shipOwner]} canUpload={s.status === "OPEN"} />
              <Box sx={{ mt: 2 }}>
                <RecordEmailsPanel shipmentId={s.id} title={t("emailsShipment", { ref: s.ref })} />
              </Box>
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
              const tid = toast.info(t("preparingZip"), { autoClose: false });
              try {
                const name = await api.downloadShipmentZip(s.id);
                toast.success(t("downloaded", { name }));
              } catch (e: any) {
                toast.error(e?.message || t("couldNotDownload"));
              } finally {
                toast.dismiss(tid);
              }
            }}
          >
            {t("downloadZip")}
          </MenuItem>
        )}
        {s?.status === "OPEN" && (
          <MenuItem
            onClick={() => {
              setShipMenu(null);
              setShipConfirm("complete");
            }}
          >
            {t("completeShipment")}
          </MenuItem>
        )}
        {s?.status === "OPEN" && (
          <MenuItem
            onClick={() => {
              setShipMenu(null);
              setShipConfirm("cancel");
            }}
          >
            {t("cancelShipment")}
          </MenuItem>
        )}
        {s && s.status !== "OPEN" && (
          <MenuItem
            onClick={() => {
              setShipMenu(null);
              setShipConfirm("reopen");
            }}
          >
            {t("reopenShipment")}
          </MenuItem>
        )}
        <MenuItem
          sx={{ color: "error.main" }}
          onClick={() => {
            setShipMenu(null);
            setShipConfirm("delete");
          }}
        >
          {t("deleteShipment")}
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
          toast.success(t("updatedFromDoc"));
        }}
      />
      <ConfirmDialog
        open={!!shipConfirm}
        title={shipConfirm && s ? t(shipConfirm === "delete" ? "confirmDelete" : shipConfirm === "complete" ? "confirmComplete" : shipConfirm === "cancel" ? "confirmCancel" : "confirmReopen", { ref: s.ref || "", bl: s.blNumber || t("pending") }) : ""}
        body={shipConfirm === "delete" ? t("deleteBody") : undefined}
        confirmLabel={shipConfirm === "delete" ? t("delete") : t("confirm")}
        destructive={shipConfirm === "delete" || shipConfirm === "cancel"}
        onClose={() => setShipConfirm(null)}
        onConfirm={() => doShip(shipConfirm!)}
      />
      <OrderFormDialog open={editOpen} order={o} onClose={() => setEditOpen(false)} />
    </Box>
  );
}

const NO_ROWS: ApplyRow[] = [];
const FIELD_NAMES = ["piNo", "piDate", "piAmount", "depositAmount", "ciNumber", "ciAmount"];

/** "#19 · SUS · 6063 · 300 MT". */
function orderTitle(o: Order): string {
  return [o.label, shortCustomer(o.customer?.name), o.grade || o.product, o.qtyMt != null ? `${fmtMt(o.qtyMt)} MT` : null].filter(Boolean).join(" · ");
}
/** "Vedanta" / "SIAE" / "Inalum" — the supplier's short name (round R header line 2). */

/** What each order step / document is about. */
/** Round BP: "Deposit payable USD 35,900.00 by 6 Nov" (the PI's Amount Payable and "Instrument to be received by"). */
function depositPayable(o: Order, t: Tr): string | null {
  if (o.depositAmount == null) return null;
  const by = o.depositDueDate ? t("depositBy", { date: fmtDay(o.depositDueDate) }) : "";
  return t("depositPayable", { amount: fmtMoney(o.depositAmount as any, o.currency), by });
}

function orderContext(o: Order, t: Tr): StepContext {
  const money = (v: unknown) => fmtMoney(v as any, o.currency);
  return {
    stepLine: (st) =>
      st.code === "CHECK_CONTRACT"
        ? o.contract
          ? t("contractLine", { no: o.contract.contractNo, supplier: String(o.supplierPremium ?? "—"), client: `${o.clientPremium ?? "—"}${o.upcharge ? ` + ${o.upcharge}` : ""}` })
          : t("noContract")
        : st.code === "PI_PAYMENT"
          ? [o.piNo && `PI ${o.piNo}`, o.piDate && t("dated", { date: fmtDmy(o.piDate) }), o.piAmount != null && money(o.piAmount), depositPayable(o, t)].filter(Boolean).join(" · ") || null
          // Round R: no customer / product / "every shipment of #26" lines — they repeat the page header.
          : null,
    docLine: (d) => {
      if (d === "DEPOSIT_PROOF") {
        const pct = o.depositPct != null ? `${Number(o.depositPct)}%` : "";
        const due = o.depositDueDate ? t("depositDue", { date: fmtDmy(o.depositDueDate) }) : depositTermLabel(o.depositDueDays, o.depositDueUnit) ? t("depositTerm", { term: depositTermLabel(o.depositDueDays, o.depositDueUnit) ?? "" }) : "";
        return o.depositAmount != null ? t("depositLine", { pct, amount: money(o.depositAmount), due }) : null;
      }
      // Round BP: "PI 9331004393 · USD 359,000.00 · Deposit payable USD 35,900.00 by 6 Nov".
      if (d === "PI") return o.piNo ? [`PI ${o.piNo}`, o.piAmount != null && money(o.piAmount), depositPayable(o, t)].filter(Boolean).join(" · ") : null;
      return null;
    },
  };
}

/** Facts for the shipment's steps. */
function shipmentContext(o: Order, s: Shipment, t: Tr): StepContext {
  return {
    // Round R: no step / slot lines that repeat the shipment card (ref, B/L, customer, vessel, tonnage).
    stepLine: (st) => (st.code === "BL_DRAFT_APPROVAL" ? `${t("orderLabel", { label: o.label })} · ${o.productLabel}` : null),
    docLine: (d) => {
      if (d === "CI_PAYMENT_PROOF") return s.ciAmount != null ? `CI ${s.ciNumber ?? ""} · ${fmtMoney(s.ciAmount, s.currency)}`.replace("CI  ·", "CI ·") : null;
      // File OR field (prod click-through): the code from Vedanta's email, the SI's delivery dates, the in-app estimate.
      if (d === "TELEX_RELEASE") return s.telexReleaseCode ? t("telexCode", { code: s.telexReleaseCode }) : t("telexUpload");
      if (d === "DELIVERY_SCHEDULE") return t("deliverySchedule");
      if (d === "TAX_ESTIMATE") return ((s.costs as any)?.cifUsd && (s.costs as any)?.fxRate) || (s.costs as any)?.importTaxFunded ? t("taxEstimateOk") : t("taxEstimateFill");
      return null;
    },
  };
}

function blSummary(s: Shipment, t: Tr): string | null {
  if (!s.blNumber) return null;
  return [`B/L ${s.blNumber}`, s.productLine, s.vessel && [s.vessel, s.voyageNo].filter(Boolean).join(" / "), s.netWeightMt != null && t("mtNet", { mt: fmtMt(s.netWeightMt) })].filter(Boolean).join(" · ");
}

function OrderOverview({ order: o, onEdit }: { order: Order; onEdit: () => void }) {
  const t = useTranslations("shipments.orderPage");
  const money = (v: unknown) => fmtMoney(v as any, o.currency);
  const p = o.profile;
  const check = new Set(o.checkFields ?? []);
  const confirm = useTradeMutation((a, oid: string) => a.updateOrder(oid, { checkFields: [] }));
  const CHECK_KEYS = ["customerId", "contractId", "clientPremium", "supplierPremium", "currentStep", "status"];
  const checkLabel = (k: string) => (CHECK_KEYS.includes(k) ? t(`check.${k}`) : k);
  const ck = (k: string | string[], value: React.ReactNode) =>
    (Array.isArray(k) ? k : [k]).some((x) => check.has(x)) ? (
      <>
        {value} <Chip size="small" color="warning" variant="outlined" label={t("checkChip")} sx={{ height: 18, ml: 0.5 }} />
      </>
    ) : (
      value
    );
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
        <Typography variant="subtitle2" sx={{ flex: 1 }}>
          {t("orderLabel", { label: o.label })}
        </Typography>
        {check.size > 0 && (
          <Tooltip title={t("checkTip", { fields: [...check].map(checkLabel).join(", ") })}>
            <Button size="small" color="warning" disabled={confirm.isPending} onClick={() => confirm.mutate(o.id)} data-tour="order-check-confirm">
              {t("checkButton", { fields: [...check].map(checkLabel).join(", ") })}
            </Button>
          </Tooltip>
        )}
        <Button variant="outlined" startIcon={<EditIcon />} onClick={onEdit}>
          {t("edit")}
        </Button>
      </Stack>
      <Grid container spacing={2}>
        <Grid item xs={6} md={3}>
          <Field label={t("ov.customer")} value={ck("customerId", o.customer?.name)} />
        </Grid>
        <Grid item xs={6} md={3}>
          <Field label={t("ov.supplier")} value={o.supplier?.name} />
        </Grid>
        <Grid item xs={6} md={3}>
          <Field label={t("ov.contract")} value={ck("contractId", o.contract?.contractNo ?? "—")} />
        </Grid>
        <Grid item xs={6} md={3}>
          <Field label={t("ov.shipDelivery")} value={o.monthsLabel || "—"} />
        </Grid>
        <Grid item xs={6} md={3}>
          <Field label={t("ov.product")} value={o.productLabel || "—"} />
        </Grid>
        <Grid item xs={6} md={3}>
          <Field label={t("ov.tolerance")} value={o.tolPct != null ? `±${Number(o.tolPct)}%` : "—"} />
        </Grid>
        <Grid item xs={12} md={6}>
          <Field
            label={t("ov.customerProfile")}
            value={`${p.billingMode === "SINGLE" ? t("ov.singleInvoice") : t("ov.twoInvoices")} · ${p.sendImportPermit ? t("ov.permitSent") : t("ov.permitNotSent")}${p.port ? ` · ${p.port}` : ""} · ${t("ov.trucks", { t: p.truckCapacityT })}`}
          />
        </Grid>
      </Grid>
      <Grid container spacing={2} sx={{ mt: 0.5 }}>
        <Grid item xs={12} md={6} data-tour="order-vedanta-side">
          <Typography variant="overline" color="text.secondary">
            {/* Round AC (owner): the supplier's own name — "MIND ID side" on #9, "Vedanta side" on Vedanta orders. */}
            {t("ov.supplierSide", { party: shortParty(o.supplier?.name) ?? t("ov.supplier") })}
          </Typography>
          <Grid container spacing={1.5}>
            <Grid item xs={6}>
              <Field label={t("ov.piNoDate")} value={[o.piNo, o.piDate && fmtDmy(o.piDate)].filter(Boolean).join(" · ") || "—"} />
            </Grid>
            <Grid item xs={6}>
              <Field label={t("ov.piAmount")} value={o.piAmount != null ? money(o.piAmount) : "—"} />
            </Grid>
            <Grid item xs={6}>
              <Field
                label={t("ov.deposit")}
                value={
                  o.depositAmount != null
                    ? `${o.depositPct ?? ""}% = ${money(o.depositAmount)}${o.depositPaidAt ? ` · ${t("ov.paid", { date: fmtDmy(o.depositPaidAt) })}` : o.depositDueDate ? ` · ${t("ov.due", { date: fmtDmy(o.depositDueDate) })}` : ""}`
                    : "—"
                }
              />
            </Grid>
            <Grid item xs={6}>
              <Field label={t("ov.supplierPremium")} value={ck("supplierPremium", o.supplierPremium ?? "—")} />
            </Grid>
          </Grid>
        </Grid>
        <Grid item xs={12} md={6} data-tour="order-customer-side">
          <Typography variant="overline" color="text.secondary">
            {t("ov.customerSide")}
          </Typography>
          <Grid container spacing={1.5}>
            <Grid item xs={6}>
              <Field label={t("ov.customerPo")} value={[o.customerPoNo, o.customerPoDate && fmtDmy(o.customerPoDate)].filter(Boolean).join(" · ") || "—"} />
            </Grid>
            <Grid item xs={6}>
              <Field label={t("ov.clientPremium")} value={ck("clientPremium", `${o.clientPremium ?? "—"}${o.upcharge ? ` + ${o.upcharge}` : ""}`)} />
            </Grid>
          </Grid>
        </Grid>
      </Grid>
    </Paper>
  );
}

/** B/L draft fields offered by "Apply the B/L draft" (labels: shipments.orderPage.fields.*). */
const BL_FIELDS: Array<keyof Shipment & string> = ["blNumber", "shippingLine", "vessel", "voyageNo", "etd", "portOfLoading", "portOfDischarge", "netWeightMt", "grossWeightMt", "totalBundles", "totalPieces", "containerCount", "hsCode", "countryOfOrigin", "commodity", "sizeSpec"];
const AN_LABELS = ["vessel", "voyageNo", "eta", "grossWeightMt", "netWeightMt", "totalBundles", "totalPieces", "containerCount", "portOfLoading", "portOfDischarge"];
const shownVal = (v: unknown) => (v === null || v === undefined || v === "" ? null : /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? String(v).slice(0, 10) : String(v));
const same = (a: unknown, b: unknown) => {
  const x = shownVal(a);
  const y = shownVal(b);
  if (x === null || y === null) return x === y;
  return Number.isFinite(Number(x)) && Number.isFinite(Number(y)) ? Number(x) === Number(y) : x.trim().toUpperCase() === y.trim().toUpperCase();
};
function blRows(s: Shipment, x: BlExtraction, t: Tr): ApplyRow[] {
  const d = x.result!.draft as Record<string, unknown>;
  return BL_FIELDS.filter((k) => shownVal(d[k]) !== null && !same(d[k], s[k])).map((k) => ({ key: k, label: t(`fields.${k}`), current: shownVal(s[k]), next: shownVal(d[k])!, value: d[k] }));
}
/** Cost fields an A/N or import permit fills → their label key (shipments.orderPage.costs.*). */
const COST_LABELS: Record<string, string> = { "costs.thc": "thc", "costs.docFee": "docFee", "costs.equipmentFee": "equipmentFee" };
const PERMIT_LABELS: Record<string, string> = { "costs.importTaxActual": "importTaxActual", "costs.fxRate": "fxRate", "costs.cifUsd": "cifUsd", "costs.customsAddOnJpy": "customsAddOnJpy" };
const costOf = (s: Shipment, key: string) => (key.startsWith("costs.") ? (s.costs as any)?.[key.slice(6)] : (s as any)[key]);
function anRows(s: Shipment, x: AnExtraction, t: Tr): ApplyRow[] {
  return Object.entries(x.result!.fill ?? {}).map(([k, v]) => ({ key: k, label: AN_LABELS.includes(k) ? t(`fields.${k}`) : COST_LABELS[k] ? t(`costs.${COST_LABELS[k]}`) : k, current: shownVal(costOf(s, k)), next: shownVal(v) ?? "", value: v }));
}
function costRows(s: Shipment, fill: Record<string, unknown>, labels: Record<string, string>, t: Tr): ApplyRow[] {
  return Object.entries(fill).map(([k, v]) => ({ key: k, label: labels[k] ? t(`costs.${labels[k]}`) : k, current: shownVal(costOf(s, k)), next: shownVal(v) ?? "", value: v }));
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
  const t = useTranslations("shipments.orderPage.facts");
  const rows: Array<[string, string]> = [];
  if (draft.tsVessel) rows.push([t("tsVessel"), [draft.tsVessel, draft.tsVoyageNo].filter(Boolean).join(" / ")]);
  if (draft.cyTerminal) rows.push([t("cyTerminal"), draft.cyTerminal]);
  if (draft.cbm) rows.push([t("measurement"), `${draft.cbm} CBM`]);
  if (draft.telexRelease) rows.push(["B/L", t("telexRelease")]);
  for (const c of draft.charges) rows.push([c.code ?? t("charge"), `${c.currency ?? ""} ${c.amount?.toLocaleString("en-US") ?? "—"}${c.unit && c.rate ? ` (${c.unit} × ${c.rate.toLocaleString("en-US")})` : ""}`]);
  if (!rows.length) return null;
  return <FactList rows={rows} />;
}
function PermitFacts({ permit, checks }: { permit: PermitExtraction["result"] extends infer R ? (R extends { permit: infer P } ? P : never) : never; checks: PermitCheck[] }) {
  const t = useTranslations("shipments.orderPage.facts");
  const rows: Array<[string, string]> = [
    ["申告番号 / 申告年月日", `${permit.declarationNo ?? "—"} · ${permit.declarationDate ?? "—"}`],
    ["積載船", permit.vessel ?? "—"],
    ["貨物個数 / 重量", `${permit.packages ?? "—"} · ${permit.grossWeightKg?.toLocaleString("en-US") ?? "—"} kg`],
    ["申告価格", fmtYen(permit.customsValue)],
    ["消費税 / 地方消費税", `${fmtYen(permit.national)} / ${fmtYen(permit.local)}`],
    ...checks.map((c): [string, string] => [c.label, `${c.found ?? "—"} ${c.status === "ok" ? "✓" : c.status === "mismatch" ? t("mismatchShipment", { expected: String(c.expected ?? "") }) : t("nothingToCompare")}`]),
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
