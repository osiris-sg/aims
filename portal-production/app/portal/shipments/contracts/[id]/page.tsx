/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// The deal page: a contract and its shipments as one journey. Journey tab =
// one timeline — the contract's steps (1. PI payment, 2. Invoice #1) on top,
// then the selected shipment's steps (2. B/L draft … 14.) below; one card is
// open at a time (the current step by default). A new contract arrives with
// shipment #1 (B/L pending, entered on its step 2); "Add shipment" adds
// another, and a switcher appears once there are several. When the server
// completes a step (every required document in), the page says so and opens
// the next card. ?shipment= selects a shipment, ?tab= the tab.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { Alert, Box, Button, CircularProgress, IconButton, Menu, MenuItem, Paper, Stack, Tab, Tabs, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import { toast } from "../../_lib/toast";
import { useContract, useContractGeneratedDocs, useGeneratedDocs, useShipment, useTradeMutation } from "../../_lib/hooks";
import { recordFileCount, type Contract, type Shipment, type TradeStep } from "../../_lib/api";
import { blLabel, depositTermLabel, fmtDmy, fmtMoney, fmtMt, stepLabel } from "../../_lib/format";
import RecordHeader from "../../_components/RecordHeader";
import ContractOverview from "../../_components/ContractOverview";
import ShipmentOverview from "../../_components/ShipmentOverview";
import StepCards, { type StepContext } from "../../_components/StepCards";
import ShipmentFormDialog from "../../_components/ShipmentFormDialog";
import FilesTable from "../../_components/FilesTable";
import LinkedDocuments from "../../_components/LinkedDocuments";
import { ConfirmDialog, CurrentStepCell, ProgressCell, RecordStatusChip } from "../../_components/bits";

const TABS = ["journey", "details", "files"] as const;
const byOrder = (a: TradeStep, b: TradeStep) => a.sortOrder - b.sortOrder;
const firstOpen = (steps: TradeStep[]) => [...steps].sort(byOrder).find((s) => !s.isOngoing && s.status !== "DONE") ?? null;

export default function DealPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tab = Math.max(0, TABS.indexOf((params?.get("tab") ?? "journey") as (typeof TABS)[number]));
  const q = useContract(id);
  const c = q.data;
  const shipments = c?.shipments ?? [];
  const wanted = params?.get("shipment");
  const shipmentId = (wanted && shipments.some((s) => s.id === wanted) ? wanted : shipments[0]?.id) ?? undefined;
  const sq = useShipment(shipmentId);
  const s = sq.data && sq.data.id === shipmentId ? sq.data : undefined;
  const genContract = useContractGeneratedDocs(id);
  const genShipment = useGeneratedDocs(shipmentId);

  const setParam = (k: string, v: string | null) => {
    const p = new URLSearchParams(params?.toString() ?? "");
    if (v) p.set(k, v);
    else p.delete(k);
    router.replace(`${pathname}?${p.toString()}`);
  };

  const complete = useTradeMutation((api, cid: string) => api.completeContract(cid));
  const reopen = useTradeMutation((api, cid: string) => api.reopenContract(cid));
  const cancel = useTradeMutation((api, cid: string) => api.updateContract(cid, { status: "CANCELLED" }));
  const addShipment = useTradeMutation((api, cid: string) => api.createShipment({ contractId: cid }));
  const shipAction = useTradeMutation(
    (api, v: { id: string; act: "complete" | "cancel" | "reopen" | "delete" }): Promise<unknown> =>
      v.act === "complete" ? api.completeShipment(v.id) : v.act === "cancel" ? api.updateShipment(v.id, { status: "CANCELLED" }) : v.act === "reopen" ? api.reopenShipment(v.id) : api.deleteShipment(v.id),
  );
  const [shipMenu, setShipMenu] = useState<{ left: number; top: number } | null>(null);
  const [shipConfirm, setShipConfirm] = useState<"complete" | "cancel" | "reopen" | "delete" | null>(null);

  // ── one open card across the whole journey ───────────────────────────────
  const contractSteps = useMemo(() => [...(c?.steps ?? [])].sort(byOrder), [c?.steps]);
  const shipSteps = useMemo(() => [...(s?.steps ?? [])].sort(byOrder), [s?.steps]);
  const current = firstOpen(contractSteps) ?? firstOpen(shipSteps);
  const [openId, setOpenId] = useState<string | null>(null);
  const [userPicked, setUserPicked] = useState(false);
  const shown = userPicked ? openId : (current?.id ?? null);
  const onOpen = (stepId: string | null) => {
    setUserPicked(true);
    setOpenId(stepId);
  };
  // A new shipment / deal: back to following the current step.
  useEffect(() => setUserPicked(false), [id, shipmentId]);

  // Steps the server completed since the last refresh: say so, open the next card.
  const prev = useRef<Map<string, string> | null>(null);
  const prevKey = useRef<string>("");
  useEffect(() => {
    const all = [...contractSteps, ...shipSteps];
    if (!c || (shipmentId && !s)) return;
    const key = `${id}:${shipmentId ?? ""}`;
    const before = prevKey.current === key ? prev.current : null;
    if (before) {
      const newlyDone = all.filter((x) => x.status === "DONE" && before.has(x.id) && before.get(x.id) !== "DONE");
      if (newlyDone.length) {
        for (const x of newlyDone) toast.success(`Step ${stepLabel(x)} complete`);
        setUserPicked(false);
        const next = firstOpen(contractSteps) ?? firstOpen(shipSteps);
        if (next) setTimeout(() => document.getElementById(`step-${next.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 150);
      }
    }
    prev.current = new Map(all.map((x) => [x.id, x.status]));
    prevKey.current = key;
  }, [c, s, contractSteps, shipSteps, id, shipmentId]);

  if (q.isLoading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }
  if (q.isError || !c) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{(q.error as Error)?.message || "Contract not found"}</Alert>
      </Box>
    );
  }

  const here = `/portal/shipments/contracts/${c.id}${shipmentId ? `?shipment=${shipmentId}` : ""}`;
  const hereTab = (t: string) => `${here}${here.includes("?") ? "&" : "?"}tab=${t}`;
  const contractOwner = { kind: "contract" as const, id: c.id, label: `Contract ${c.contractNo}` };
  const shipIndex = shipments.findIndex((x) => x.id === shipmentId);
  const shipOwner = s ? { kind: "shipment" as const, id: s.id, label: `Shipment ${blLabel(s.blNumber)}` } : null;
  const openShipments = shipments.filter((x) => x.status === "OPEN");
  const contractCtx = contractContext(c);
  const shipCtx = s ? shipmentContext(c, s) : {};
  const fileCount = recordFileCount(c) + (s ? recordFileCount(s) : 0);

  const doShip = async (act: "complete" | "cancel" | "reopen" | "delete") => {
    const r: any = await shipAction.mutateAsync({ id: s!.id, act });
    if (act === "delete") {
      toast.success("Shipment deleted");
      setParam("shipment", null);
    } else toast.success(act === "reopen" && r?.reopenedContract ? `Shipment reopened — contract ${r.reopenedContract} was reopened too` : `Shipment ${act === "complete" ? "completed" : act === "cancel" ? "cancelled" : "reopened"}`);
  };

  return (
    <Box sx={{ p: { xs: 1.5, md: 3 }, maxWidth: 1100, mx: "auto" }}>
      <RecordHeader
        kind="contract"
        title={c.contractNo}
        status={c.status}
        backHref="/portal/shipments"
        progress={c.progress}
        // The deal's current step: the contract's while it has one open, else the selected shipment's.
        currentStep={c.currentStep ?? s?.currentStep ?? null}
        steps={c.steps}
        blockers={openShipments.map((x) => `shipment ${x.blNumber || `#${shipments.indexOf(x) + 1} (B/L pending)`}`)}
        onComplete={() => complete.mutateAsync(c.id)}
        onCancel={() => cancel.mutateAsync(c.id)}
        onReopen={() => reopen.mutateAsync(c.id)}
        subtitle={
          <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
            <Typography variant="body2" color="text.secondary">
              {c.supplier?.name ?? "—"} → <b>{c.customer?.name ?? "—"}</b>
            </Typography>
            {c.piNumber && (
              <Typography variant="body2" color="text.secondary">
                PI <b>{c.piNumber}</b>
              </Typography>
            )}
            {c.linesSummary && (
              <Typography variant="body2" color="text.secondary">
                {c.linesSummary}
              </Typography>
            )}
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
              Contract
            </Typography>
            <StepCards
              steps={c.steps}
              owner={contractOwner}
              fileLinks={c.fileLinks}
              docLinks={c.docLinks ?? []}
              generatedDocs={genContract.data ?? []}
              recordOpen={c.status === "OPEN"}
              returnTo={here}
              openId={shown}
              onOpen={onOpen}
              context={contractCtx}
            />
          </Box>

          <Box>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
              <Typography variant="overline" color="text.secondary" sx={{ flex: 1 }}>
                {shipments.length > 1 ? `Shipments (${shipments.length})` : "Shipment"}
              </Typography>
              {c.status !== "CANCELLED" && (
                <Button
                  startIcon={<AddIcon />}
                  variant="outlined"
                  disabled={addShipment.isPending}
                  onClick={async () => {
                    try {
                      const n = await addShipment.mutateAsync(c.id);
                      toast.success(`Shipment #${shipments.length + 1} added`);
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

            {shipments.length > 1 && (
              <Tabs value={Math.max(0, shipIndex)} onChange={(_, v) => setParam("shipment", shipments[v].id)} variant="scrollable" allowScrollButtonsMobile sx={{ mb: 1.5, borderBottom: 1, borderColor: "divider" }}>
                {shipments.map((x, i) => (
                  <Tab
                    key={x.id}
                    sx={{ alignItems: "flex-start", textTransform: "none" }}
                    label={
                      <Box sx={{ textAlign: "left" }}>
                        <Typography variant="body2" sx={{ fontWeight: 700 }}>
                          #{i + 1} · {blLabel(x.blNumber)}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {x.status !== "OPEN" ? (x.status === "COMPLETED" ? "Completed" : "Cancelled") : x.currentStep ? x.currentStep.label : "All steps done"}
                        </Typography>
                      </Box>
                    }
                  />
                ))}
              </Tabs>
            )}

            {!shipments.length ? (
              <Paper variant="outlined" sx={{ p: 3, textAlign: "center", borderStyle: "dashed" }}>
                <Typography variant="body2">No shipment on this contract yet — add one.</Typography>
              </Paper>
            ) : !s ? (
              <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
                <CircularProgress size={24} />
              </Box>
            ) : (
              <>
                <Paper variant="outlined" sx={{ px: 2, py: 1.25, mb: 1.5 }}>
                  <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
                    <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
                      {shipments.length > 1 ? `#${shipIndex + 1} · ` : ""}B/L {s.blNumber || "pending"}
                    </Typography>
                    <RecordStatusChip status={s.status} />
                    <ProgressCell progress={s.progress} width={90} />
                    <Box sx={{ display: { xs: "none", md: "block" } }}>
                      <CurrentStepCell step={s.currentStep} progress={s.progress} maxWidth={300} />
                    </Box>
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
                  context={shipCtx}
                  blCheck={s.blCheck}
                  fieldsTitle="B/L details"
                  fieldsSummary={blSummary(s)}
                  fieldsForm={() => <ShipmentFormDialog inline open shipment={s} onClose={() => undefined} onSaved={() => toast.success("B/L details saved")} />}
                />
              </>
            )}
          </Box>
        </Stack>
      )}

      {tab === 1 && (
        <Stack spacing={3}>
          <ContractOverview contract={c} />
          {s && (
            <Box>
              <Typography variant="overline" color="text.secondary">
                {shipments.length > 1 ? `Shipment #${shipIndex + 1}` : "Shipment"} · B/L {s.blNumber || "pending"}
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
              Contract {c.contractNo}
            </Typography>
            <LinkedDocuments links={c.docLinks ?? []} returnTo={hereTab("files")} canEdit={c.status === "OPEN"} />
            <FilesTable filter={{ contractId: c.id }} currentId={c.id} uploadTargets={[contractOwner]} canUpload={c.status === "OPEN"} />
          </Box>
          {s && shipOwner && (
            <Box>
              <Typography variant="overline" color="text.secondary">
                Shipment B/L {s.blNumber || "pending"}
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
      <ConfirmDialog
        open={!!shipConfirm}
        title={shipConfirm && s ? `${shipConfirm === "delete" ? "Delete" : shipConfirm === "complete" ? "Complete" : shipConfirm === "cancel" ? "Cancel" : "Reopen"} shipment B/L ${s.blNumber || "pending"}?` : ""}
        body={shipConfirm === "delete" ? "Its steps and document links are removed. The files themselves stay in the Documents library. This can't be undone." : undefined}
        confirmLabel={shipConfirm === "delete" ? "Delete" : "Confirm"}
        destructive={shipConfirm === "delete" || shipConfirm === "cancel"}
        onClose={() => setShipConfirm(null)}
        onConfirm={() => doShip(shipConfirm!)}
      />
    </Box>
  );
}

/** What each contract step / document is about, from the contract itself. */
function contractContext(c: Contract): StepContext {
  const money = (v: unknown) => fmtMoney(v as any, c.currency);
  return {
    stepLine: (st) =>
      st.code === "PI_PAYMENT"
        ? [c.piNumber && `PI ${c.piNumber}`, c.piDate && `dated ${fmtDmy(c.piDate)}`, c.piAmount != null && money(c.piAmount)].filter(Boolean).join(" · ") || null
        : st.code === "INVOICE_1"
          ? `To ${c.customer?.name ?? "the customer"} · ${c.linesSummary ?? ""}`.replace(/ · $/, "")
          : null,
    docLine: (d) => {
      if (d === "DEPOSIT_PROOF") {
        const pct = c.depositPercent != null ? `${Number(c.depositPercent)}%` : "";
        const due = c.depositDueDate ? `, due ${fmtDmy(c.depositDueDate)}` : depositTermLabel(c.depositDueDays, c.depositDueUnit) ? ` (${depositTermLabel(c.depositDueDays, c.depositDueUnit)} after the PI date)` : "";
        return c.depositAmount != null ? `Deposit ${pct} = ${money(c.depositAmount)}${due}` : null;
      }
      if (d === "PI") return c.piNumber ? `PI ${c.piNumber}${c.piAmount != null ? ` · ${money(c.piAmount)}` : ""}` : null;
      if (d === "INVOICE_1") return `${c.customer?.name ?? "Customer"} · contract ${c.contractNo}`;
      return null;
    },
  };
}

/** Facts for the shipment's steps: B/L, customer, vessel, CI amount… */
function shipmentContext(c: Contract, s: Shipment): StepContext {
  const bl = `B/L ${s.blNumber || "pending"}`;
  return {
    stepLine: (st) => (st.code === "BL_DRAFT_APPROVAL" ? `Contract ${c.contractNo} · ${s.productLine ?? "product line not picked yet"}` : [bl, s.customer?.name, s.vessel && [s.vessel, s.voyageNo].filter(Boolean).join(" / ")].filter(Boolean).join(" · ")),
    docLine: (d) => {
      if (d === "CI_PAYMENT_PROOF") return s.ciAmount != null ? `CI ${s.ciNumber ?? ""} · ${fmtMoney(s.ciAmount, s.currency)}`.replace("CI  ·", "CI ·") : null;
      if (d === "INVOICE_2" || d === "CUSTOMER_PL" || d === "CUSTOMER_COA") return `${s.customer?.name ?? "Customer"} · ${bl}${s.netWeightMt != null ? ` · ${fmtMt(s.netWeightMt)} MT` : ""}`;
      if (d === "TELEX_RELEASE" && s.telexReleaseCode) return `Release code ${s.telexReleaseCode}`;
      return null;
    },
  };
}

/** "B/L 198GX04822 · 6063 · 203MM · 300 MT · WAN HAI 316 / E042 · 120.140 MT net" once step 2's fields are in. */
function blSummary(s: Shipment): string | null {
  if (!s.blNumber) return null;
  return [`B/L ${s.blNumber}`, s.productLine, s.vessel && [s.vessel, s.voyageNo].filter(Boolean).join(" / "), s.netWeightMt != null && `${fmtMt(s.netWeightMt)} MT net`].filter(Boolean).join(" · ");
}
