/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// The deal page: a contract and its shipments as one journey. Journey tab =
// one timeline — the contract's steps (1. PI payment, 2. Invoice #1) on top,
// then the selected shipment's steps (2. B/L draft … 14.) below; one card is
// open at a time (the current step by default). A new contract arrives with
// shipment #1 (B/L pending, entered on its step 2); "Add shipment" adds
// another, and a switcher appears once there are several. When the server
// completes a step (every required document in), the page says so and opens
// the next card. When the last step of a shipment is done the server completes
// it; when every shipment of the deal is complete the deal completes too and
// the page returns to the Shipments list. Manual Complete / Reopen stay in the
// ⋮ menus. ?shipment= selects a shipment, ?tab= the tab.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { Alert, Box, Button, CircularProgress, IconButton, Menu, MenuItem, Paper, Stack, Tab, Tabs, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import { toast } from "../../_lib/toast";
import { useContract, useContractGeneratedDocs, useGeneratedDocs, useShipment, useTradeMutation } from "../../_lib/hooks";
import { recordFileCount, useShipmentsApi, type AnExtraction, type BlExtraction, type Contract, type Shipment, type TradeFile, type TradeStep } from "../../_lib/api";
import { blLabel, depositTermLabel, fmtDmy, fmtMoney, fmtMt, stepLabel } from "../../_lib/format";
import RecordHeader from "../../_components/RecordHeader";
import ContractOverview from "../../_components/ContractOverview";
import ShipmentOverview from "../../_components/ShipmentOverview";
import StepCards, { type StepContext } from "../../_components/StepCards";
import ShipmentFormDialog from "../../_components/ShipmentFormDialog";
import FilesTable from "../../_components/FilesTable";
import LinkedDocuments from "../../_components/LinkedDocuments";
import { ConfirmDialog, CurrentStepCell, ProgressCell, RecordStatusChip } from "../../_components/bits";
import ExtractApplyDialog, { type ApplyRow } from "../../_components/ExtractApplyDialog";

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
  const api = useShipmentsApi();
  const applyShip = useTradeMutation((api, v: { id: string; patch: Record<string, unknown> }) => api.updateShipment(v.id, v.patch));
  // A B/L draft / arrival notice dropped on its row: read with AI, then offered here.
  const [offer, setOffer] = useState<{ title: string; intro: string; warning: string | null; rows: ApplyRow[]; extra?: React.ReactNode } | null>(null);
  // The inline B/L form keeps its own state: remount it once applied values are back from the server.
  const [formKey, setFormKey] = useState(0);
  const remountAfter = useRef<string | null>(null);
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

  // The deal / shipment completed by the server (last step done), not from a ⋮
  // menu: say so; a completed deal goes back to the Shipments list.
  const manual = useRef(false);
  const lastStatus = useRef<{ key: string; contract?: string; shipment?: string }>({ key: "" });
  useEffect(() => {
    if (!c || (shipmentId && !s)) return;
    const key = `${id}:${shipmentId ?? ""}`;
    const was = lastStatus.current;
    lastStatus.current = { key, contract: c.status, shipment: s?.status };
    if (was.key !== key || (was.contract === c.status && was.shipment === s?.status)) return;
    // A status change the user asked for from a ⋮ menu: nothing to announce.
    if (manual.current) {
      manual.current = false;
      return;
    }
    if (was.contract === "OPEN" && c.status === "COMPLETED") {
      toast.success(`Deal ${c.contractNo} completed — all shipments are done`);
      router.push("/portal/shipments?tab=completed");
    } else if (was.shipment === "OPEN" && s?.status === "COMPLETED") {
      toast.success(`Shipment ${blLabel(s.blNumber)} completed — all its steps are done`);
    }
  }, [c, s, id, shipmentId, router]);

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

  /** A B/L draft / arrival notice uploaded on its step row: read it and offer its values. */
  const readUploaded = async (docType: string, files: TradeFile[]) => {
    const f = files[0];
    if (!s || !f || (docType !== "BL_DRAFT" && docType !== "ARRIVAL_NOTICE")) return;
    const what = docType === "BL_DRAFT" ? "B/L draft" : "arrival notice";
    const t = toast.info(`Reading the ${what} (${f.fileName})…`, { autoClose: false });
    try {
      if (docType === "BL_DRAFT") {
        const x = await api.extractBlDraft({ fileId: f.id, shipmentId: s.id });
        if (x.status !== "DONE" || !x.result) throw new Error(x.error || "the AI read failed");
        setOffer({
          title: "Apply the B/L draft to the B/L details?",
          intro: `Read from ${f.fileName}. The B/L check against the contract is shown on step 2.`,
          warning: null,
          rows: blRows(s, x),
        });
      } else {
        const x = await api.extractAn({ fileId: f.id, shipmentId: s.id });
        if (x.status !== "DONE" || !x.result) throw new Error(x.error || "the AI read failed");
        setOffer({
          title: "Fill the shipment from the arrival notice?",
          intro: `Read from ${f.fileName}. Only blank shipment fields are offered.`,
          warning: x.result.blMismatch ? `This notice is for B/L ${x.result.draft.blNumber}, not ${s.blNumber}. Check it is the right file.` : null,
          rows: anRows(s, x),
          extra: anFacts(x),
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
    } else toast.success(act === "reopen" && r?.reopenedContract ? `Shipment reopened — contract ${r.reopenedContract} was reopened too` : `Shipment ${act === "complete" ? "completed" : act === "cancel" ? "cancelled" : "reopened"}`);
  };

  return (
    <Box sx={{ p: { xs: 1.5, md: 3 }, maxWidth: 1100, mx: "auto" }}>
      <RecordHeader
        kind="contract"
        title={dealTitle(c)}
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
        onActed={() => (manual.current = true)}
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
              Deal setup
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
              {c.status === "OPEN" && (
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
                  onFileUploaded={(d, f) => void readUploaded(d, f)}
                  blCheck={s.blCheck}
                  fieldsTitle="B/L details"
                  fieldsSummary={blSummary(s)}
                  fieldsForm={() => <ShipmentFormDialog key={formKey} inline open shipment={s} onClose={() => undefined} onSaved={() => toast.success("B/L details saved")} />}
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

const NO_ROWS: ApplyRow[] = [];

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
const shown = (v: unknown) => (v === null || v === undefined || v === "" ? null : /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? String(v).slice(0, 10) : String(v));
const same = (a: unknown, b: unknown) => {
  const x = shown(a);
  const y = shown(b);
  if (x === null || y === null) return x === y;
  return Number.isFinite(Number(x)) && Number.isFinite(Number(y)) ? Number(x) === Number(y) : x.trim().toUpperCase() === y.trim().toUpperCase();
};

/** B/L draft values that differ from the shipment (the contract line too, when the shipment has none). */
function blRows(s: Shipment, x: BlExtraction): ApplyRow[] {
  const d = x.result!.draft as Record<string, unknown>;
  const rows: ApplyRow[] = BL_FIELDS.filter(([k]) => shown(d[k]) !== null && !same(d[k], s[k])).map(([k, label]) => ({ key: k, label, current: shown(s[k]), next: shown(d[k])!, value: d[k] }));
  const lineId = x.result!.contractLineId;
  if (lineId && !s.contractLineId) {
    const l = s.contract?.lines?.find((y) => y.id === lineId);
    rows.push({ key: "contractLineId", label: "Product line", current: null, next: l ? [l.grade, l.product].filter(Boolean).join(" ") || "line" : "matched line", value: lineId });
  }
  return rows;
}

/** Arrival-notice values for the shipment's blank fields (the server decides which are blank). */
function anRows(s: Shipment, x: AnExtraction): ApplyRow[] {
  return Object.entries(x.result!.fill ?? {}).map(([k, v]) => ({ key: k, label: AN_LABELS[k] ?? k, current: shown((s as any)[k]), next: shown(v) ?? "", value: v }));
}

/** What the notice says that has no shipment field: CY terminal, containers + seals, charges collect. */
function anFacts(x: AnExtraction): React.ReactNode {
  const d = x.result!.draft;
  const lines = [
    d.cyTerminal && `CY terminal: ${d.cyTerminal}`,
    d.containers.length ? `Containers: ${d.containers.map((c) => [c.containerNo, c.sealNo && `seal ${c.sealNo}`].filter(Boolean).join(" ")).join(", ")}` : null,
    d.chargesCollect.length ? `Charges collect: ${d.chargesCollect.map((c) => `${c.currency} ${c.amount.toLocaleString("en-US")}`).join(" + ")}` : null,
  ].filter(Boolean) as string[];
  if (!lines.length) return null;
  return (
    <Box>
      <Typography variant="overline" color="text.secondary">
        Also on the notice
      </Typography>
      {lines.map((l) => (
        <Typography key={l} variant="body2">
          {l}
        </Typography>
      ))}
    </Box>
  );
}

/** "SUS Co., Ltd." → "SUS": the customer's name without the company-form suffixes. */
const shortName = (name?: string | null) =>
  (name ?? "")
    .replace(/株式会社|合同会社|有限会社/g, "")
    .replace(/[,.]?\s*\b(co|ltd|limited|inc|corp|corporation|company|pte|pvt|llc|gmbh|kk)\b\.?/gi, "")
    .replace(/[\s,.]+$/, "")
    .trim() || null;

/** "454003255 · SUS · 6005 · 120 MT": contract no., customer (short name), grade(s), total quantity. */
function dealTitle(c: Contract): string {
  const grades = Array.from(new Set((c.lines ?? []).map((l) => l.grade).filter(Boolean)));
  const qty = c.totalQuantityMt != null ? `${Number(c.totalQuantityMt).toLocaleString("en-US", { maximumFractionDigits: 3 })} MT` : null;
  return [c.contractNo, shortName(c.customer?.name), grades.join("/") || null, qty].filter(Boolean).join(" · ");
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
