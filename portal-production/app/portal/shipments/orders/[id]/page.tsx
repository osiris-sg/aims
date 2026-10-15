/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// The order page (ADH's "#19"): the order's own steps on top (0 Check
// contract, 1 PI payment, 2 Invoice #1, 13 Xero reconciliation), then one card
// per shipment ("#19-1 · B/L · vessel · ETA · current step"). A card opens that
// shipment's step view below (steps 2–12, 14) — ?shipment= selects it. Steps
// that don't apply to the customer's profile show as "N/A (customer profile)".
// The estimator sits on shipment steps 7 / 8 / 12 and the reconciliation on
// step 13. One card is open at a time (the current step by default); when the
// server completes a step the page says so and opens the next one.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { Alert, Box, Button, ButtonBase, Chip, CircularProgress, Grid, IconButton, Menu, MenuItem, Paper, Stack, Tab, Tabs, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import EditIcon from "@mui/icons-material/EditOutlined";
import { toast } from "../../_lib/toast";
import { useGeneratedDocs, useOrder, useOrderGeneratedDocs, useShipment, useTradeMutation } from "../../_lib/hooks";
import { recordFileCount, useShipmentsApi, type AnExtraction, type BlExtraction, type Order, type Shipment, type TradeFile, type TradeStep } from "../../_lib/api";
import { blLabel, depositTermLabel, fmtDay, fmtDmy, fmtMoney, fmtMt, stepLabel } from "../../_lib/format";
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

const TABS = ["journey", "details", "files"] as const;
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
  const shipmentId = (wanted && shipments.some((s) => s.id === wanted) ? wanted : (shipments.find((s) => s.status === "OPEN") ?? shipments[0])?.id) ?? undefined;
  const sq = useShipment(shipmentId);
  const s = sq.data && sq.data.id === shipmentId ? sq.data : undefined;
  const genOrder = useOrderGeneratedDocs(id);
  const genShipment = useGeneratedDocs(shipmentId);
  const api = useShipmentsApi();

  const setParam = (k: string, v: string | null) => {
    const p = new URLSearchParams(params?.toString() ?? "");
    if (v) p.set(k, v);
    else p.delete(k);
    router.replace(`${pathname}?${p.toString()}`);
  };

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
  const shipSteps = useMemo(() => [...(s?.steps ?? [])].sort(byOrder), [s?.steps]);
  const current = firstOpen(orderSteps.filter((x) => x.code !== "XERO_HANDOFF")) ?? firstOpen(shipSteps) ?? firstOpen(orderSteps);
  const [openId, setOpenId] = useState<string | null>(null);
  const [userPicked, setUserPicked] = useState(false);
  const shown = userPicked ? openId : (current?.id ?? null);
  const onOpen = (stepId: string | null) => {
    setUserPicked(true);
    setOpenId(stepId);
  };
  useEffect(() => setUserPicked(false), [id, shipmentId]);

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
        setUserPicked(false);
        const next = firstOpen(orderSteps) ?? firstOpen(shipSteps);
        if (next) setTimeout(() => document.getElementById(`step-${next.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 150);
      }
    }
    prev.current = new Map(all.map((x) => [x.id, x.status]));
    prevKey.current = key;
  }, [o, s, orderSteps, shipSteps, id, shipmentId]);

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

  const readUploaded = async (docType: string, files: TradeFile[]) => {
    const f = files[0];
    if (!s || !f || (docType !== "BL_DRAFT" && docType !== "ARRIVAL_NOTICE")) return;
    const what = docType === "BL_DRAFT" ? "B/L draft" : "arrival notice";
    const t = toast.info(`Reading the ${what} (${f.fileName})…`, { autoClose: false });
    try {
      if (docType === "BL_DRAFT") {
        const x = await api.extractBlDraft({ fileId: f.id, shipmentId: s.id });
        if (x.status !== "DONE" || !x.result) throw new Error(x.error || "the AI read failed");
        setOffer({ title: "Apply the B/L draft to the B/L details?", intro: `Read from ${f.fileName}. The B/L check against the order is shown on step 2.`, warning: null, rows: blRows(s, x) });
      } else {
        const x = await api.extractAn({ fileId: f.id, shipmentId: s.id });
        if (x.status !== "DONE" || !x.result) throw new Error(x.error || "the AI read failed");
        setOffer({
          title: "Fill the shipment from the arrival notice?",
          intro: `Read from ${f.fileName}. Only blank shipment fields are offered.`,
          warning: x.result.blMismatch ? `This notice is for B/L ${x.result.draft.blNumber}, not ${s.blNumber}. Check it is the right file.` : null,
          rows: anRows(s, x),
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
    <Box sx={{ p: { xs: 1.5, md: 3 }, maxWidth: 1100, mx: "auto" }}>
      <RecordHeader
        kind="order"
        title={orderTitle(o)}
        status={o.status}
        backHref="/portal/shipments"
        progress={o.progress}
        currentStep={o.currentStep ?? s?.currentStep ?? null}
        steps={o.steps.filter((x) => !x.notApplicable)}
        blockers={openShipments.map((x) => `shipment ${x.ref}${x.blNumber ? "" : " (B/L pending)"}`)}
        onComplete={() => complete.mutateAsync(o.id)}
        onCancel={() => cancel.mutateAsync(o.id)}
        onReopen={() => reopen.mutateAsync(o.id)}
        onActed={() => (manual.current = true)}
        subtitle={
          <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap alignItems="center">
            <Typography variant="body2" color="text.secondary">
              {o.supplier?.name ?? "—"} → <b>{o.customer?.name ?? "—"}</b>
            </Typography>
            {o.contract && (
              <Typography variant="body2" color="text.secondary">
                Contract <b>{o.contract.contractNo}</b>
              </Typography>
            )}
            {o.piNo && (
              <Typography variant="body2" color="text.secondary">
                PI <b>{o.piNo}</b>
              </Typography>
            )}
            <Typography variant="body2" color="text.secondary">
              {o.monthsLabel}
            </Typography>
            <Chip size="small" variant="outlined" color={single ? "secondary" : "default"} label={single ? "Single invoice (customer profile)" : "Invoice #1 + #2"} data-tour="order-billing-chip" />
          </Stack>
        }
      />

      <Tabs value={tab} onChange={(_, v) => setParam("tab", TABS[v])} sx={{ mb: 2, borderBottom: 1, borderColor: "divider" }} variant="scrollable" allowScrollButtonsMobile>
        <Tab label="Journey" />
        <Tab label="Details" />
        <Tab label={`Files${fileCount ? ` (${fileCount})` : ""}`} />
      </Tabs>

      {tab === 0 && (
        <Stack spacing={3}>
          <Box>
            <Typography variant="overline" color="text.secondary">
              Order steps
            </Typography>
            <StepCards
              steps={o.steps}
              owner={orderOwner}
              fileLinks={o.fileLinks}
              docLinks={o.docLinks ?? []}
              generatedDocs={genOrder.data ?? []}
              recordOpen={o.status === "OPEN"}
              returnTo={here}
              openId={shown}
              onOpen={onOpen}
              context={orderContext(o)}
              customerId={o.customerId}
              fieldsTitle="Contract & premiums"
              fieldsSummary={o.contract ? `Contract ${o.contract.contractNo} · client premium ${o.clientPremium ?? "—"} USD/MT` : null}
              fieldsForm={() => (
                <Button variant="outlined" startIcon={<EditIcon />} onClick={() => setEditOpen(true)}>
                  Link the contract / confirm premiums
                </Button>
              )}
              stepExtra={(st) => (st.code === "XERO_HANDOFF" ? <ReconciliationPanel orderId={o.id} canEdit={o.status === "OPEN"} /> : null)}
            />
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
                      setParam("shipment", n.id);
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
                  <Grid item xs={12} sm={6} md={4} key={x.id}>
                    <ButtonBase onClick={() => setParam("shipment", x.id)} sx={{ width: "100%", textAlign: "left", borderRadius: 2 }}>
                      <Paper variant="outlined" sx={{ p: 1.5, width: "100%", border: 2, borderColor: x.id === shipmentId ? "primary.main" : "divider" }}>
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
                            {x.ref}
                          </Typography>
                          <RecordStatusChip status={x.status} />
                        </Stack>
                        <Typography variant="body2">B/L {blLabel(x.blNumber)}</Typography>
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
                <Paper variant="outlined" sx={{ px: 2, py: 1.25, mb: 1.5 }}>
                  <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
                    <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
                      {s.ref} · B/L {s.blNumber || "pending"}
                    </Typography>
                    <RecordStatusChip status={s.status} />
                    <ProgressCell progress={s.progress} width={90} />
                    <Box sx={{ flex: 1 }} />
                    {s.vessel && (
                      <Typography variant="body2" color="text.secondary">
                        {[s.vessel, s.voyageNo].filter(Boolean).join(" / ")}
                      </Typography>
                    )}
                    <IconButton size="small" aria-label="Shipment actions" onClick={(e) => setShipMenu({ left: e.clientX, top: e.clientY })}>
                      <MoreVertIcon fontSize="small" />
                    </IconButton>
                  </Stack>
                </Paper>
                <StepCards
                  steps={s.steps}
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
                  stepExtra={(st) => (ESTIMATOR_STEPS[st.code] ? <EstimatorPanel shipment={s} mode={ESTIMATOR_STEPS[st.code]} canEdit={s.status === "OPEN"} /> : null)}
                />
              </>
            ) : null}
          </Box>
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
          await applyShip.mutateAsync({ id: s!.id, patch });
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

/** "#19 · SUS · 6063 · 300 MT". */
function orderTitle(o: Order): string {
  const short = (o.customer?.name ?? "")
    .replace(/株式会社|合同会社|有限会社/g, "")
    .replace(/[,.]?\s*\b(co|ltd|limited|inc|corp|corporation|company|pte|pvt|llc)\b\.?/gi, "")
    .replace(/[\s,.]+$/, "")
    .trim();
  return [o.label, short || null, o.grade || o.product, o.qtyMt != null ? `${fmtMt(o.qtyMt)} MT` : null].filter(Boolean).join(" · ");
}

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
          : st.code === "INVOICE_1"
            ? `To ${o.customer?.name ?? "the customer"} · ${o.productLabel}`
            : null,
    docLine: (d) => {
      if (d === "DEPOSIT_PROOF") {
        const pct = o.depositPct != null ? `${Number(o.depositPct)}%` : "";
        const due = o.depositDueDate ? `, due ${fmtDmy(o.depositDueDate)}` : depositTermLabel(o.depositDueDays, o.depositDueUnit) ? ` (${depositTermLabel(o.depositDueDays, o.depositDueUnit)} after the PI date)` : "";
        return o.depositAmount != null ? `Deposit ${pct} = ${money(o.depositAmount)}${due}` : null;
      }
      if (d === "PI") return o.piNo ? `PI ${o.piNo}${o.piAmount != null ? ` · ${money(o.piAmount)}` : ""}` : null;
      if (d === "INVOICE_1") return `${o.customer?.name ?? "Customer"} · order ${o.label}`;
      return null;
    },
  };
}

/** Facts for the shipment's steps. */
function shipmentContext(o: Order, s: Shipment): StepContext {
  const bl = `B/L ${s.blNumber || "pending"}`;
  return {
    stepLine: (st) => (st.code === "BL_DRAFT_APPROVAL" ? `Order ${o.label} · ${o.productLabel}` : [s.ref, bl, o.customer?.name, s.vessel && [s.vessel, s.voyageNo].filter(Boolean).join(" / ")].filter(Boolean).join(" · ")),
    docLine: (d) => {
      if (d === "CI_PAYMENT_PROOF") return s.ciAmount != null ? `CI ${s.ciNumber ?? ""} · ${fmtMoney(s.ciAmount, s.currency)}`.replace("CI  ·", "CI ·") : null;
      if (d === "INVOICE_2" || d === "INVOICE_SINGLE" || d === "CUSTOMER_PL" || d === "CUSTOMER_COA") return `${o.customer?.name ?? "Customer"} · ${s.ref} · ${bl}${s.netWeightMt != null ? ` · ${fmtMt(s.netWeightMt)} MT` : ""}`;
      if (d === "TELEX_RELEASE" && s.telexReleaseCode) return `Release code ${s.telexReleaseCode}`;
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
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
        <Typography variant="subtitle2">Order {o.label}</Typography>
        <Button variant="outlined" startIcon={<EditIcon />} onClick={onEdit}>
          Edit
        </Button>
      </Stack>
      <Grid container spacing={2}>
        <Grid item xs={6} md={3}>
          <Field label="Customer" value={o.customer?.name} />
        </Grid>
        <Grid item xs={6} md={3}>
          <Field label="Supplier" value={o.supplier?.name} />
        </Grid>
        <Grid item xs={6} md={3}>
          <Field label="Contract" value={o.contract?.contractNo ?? "—"} />
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
        <Grid item xs={6} md={3}>
          <Field label="Premiums (USD/MT)" value={`supplier ${o.supplierPremium ?? "—"} · client ${o.clientPremium ?? "—"}${o.upcharge ? ` + ${o.upcharge}` : ""}`} />
        </Grid>
        <Grid item xs={6} md={3}>
          <Field label="PI" value={[o.piNo, o.piDate && fmtDmy(o.piDate), o.piAmount != null && money(o.piAmount)].filter(Boolean).join(" · ") || "—"} />
        </Grid>
        <Grid item xs={6} md={3}>
          <Field label="Deposit" value={o.depositAmount != null ? `${o.depositPct ?? ""}% = ${money(o.depositAmount)}` : "—"} />
        </Grid>
        <Grid item xs={12} md={9}>
          <Field
            label="Customer profile"
            value={`${p.billingMode === "SINGLE" ? "Single invoice" : "Invoice #1 + #2"} · import permit ${p.sendImportPermit ? "sent" : "not sent"}${p.port ? ` · ${p.port}` : ""} · ${p.truckCapacityT}t trucks`}
          />
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
function anRows(s: Shipment, x: AnExtraction): ApplyRow[] {
  return Object.entries(x.result!.fill ?? {}).map(([k, v]) => ({ key: k, label: AN_LABELS[k] ?? k, current: shownVal((s as any)[k]), next: shownVal(v) ?? "", value: v }));
}
