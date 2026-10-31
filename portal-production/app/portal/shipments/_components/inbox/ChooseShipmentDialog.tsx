"use client";

// Round AF (owner) — "Answer" is a STEP-BY-STEP flow: one question per screen, a Back button, nothing applied until
// the last Confirm.
//   Step 1  the card's own question, two big buttons Yes / No
//           new-deal card: Yes → the Create-order form (prefilled from the thread) · No → step 2
//           "which shipment" / "is it a shipment" cards: "Is this email about a shipment?" Yes → step 3 · No → step 2
//   Step 2  "What is it then?" — It's about an existing shipment → step 3 · Not about a shipment → Confirm · Ask me later → snoozed a day, done
//   Step 3  "Which shipment?" — search (#n-s, B/L, cast / bundle no.) + the list (Likely first, then every open
//           shipment), checkboxes; "Not one shipment: general issue" on top. Round AR: several shipments the email
//           names exactly come ticked; a general issue AIMS read comes ticked.
//   Files   (round AR) each attachment gets its own shipments (AIMS's exact match by B/L / CI / cast / bundle no.
//           first) and its document slot, or "Don't file"; Next only when every file is placed.
//   Issue   (round AR) title, EN + JA summary, supplier / customer, effective from — drafted by AIMS from the email.
//   Confirm every target, every file → where, the issue — Back / Confirm
// Keyboard: Enter = the step's primary action, Esc = close. Same component on the Dashboard cards and in See all emails.
// Round AV (Sayaka): step 3 adds and edits shipments without leaving the email — "+ New shipment…" on top (pick the
// order, then the form), "+ New shipment (#27-1)" on an order without one, a pencil on every shipment row; both open
// ShipmentDrawer (prefilled from the email where exact). A saved new shipment comes back ticked; an edit keeps the
// selection. "All shipments" is grouped by order (newest ETA first), completed orders behind "Show completed".

import React, { useEffect, useMemo, useState } from "react";
import { Alert, Autocomplete, Box, Button, Checkbox, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Divider, FormControlLabel, IconButton, InputAdornment, List, ListItemButton, ListItemIcon, ListItemText, MenuItem, Stack, Switch, TextField, Tooltip, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import CloseIcon from "@mui/icons-material/Close";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import SearchIcon from "@mui/icons-material/Search";
import { useQuery } from "@tanstack/react-query";
import { useShipmentsApi, type AnswerFile, type AnswerIssue, type AnswerTarget, type InboxAnswer, type InboxLang, type InboxThread, type Placement, type ShipmentListItem } from "../../_lib/api";
import { useCustomers, useOrders, useShipments, useSuppliers } from "../../_lib/hooks";
import type { OrderListItem, Shipment } from "../../_lib/api";
import { ShipmentDrawer, type DrawerMode } from "./ShipmentDrawer";
import { nextShipmentRef, orderGroups, orderHaystack, orderLine as orderLineOf, shipmentLine as shipmentLineOf } from "../../_lib/shipment-picker";
import { fmtDay, shortCustomer } from "../../_lib/format";
import { answerFor, docPlainName, L, likelyOptions, optionKey } from "../../_lib/inbox-cards";

type Step = "q1" | "what" | "which" | "files" | "issue" | "confirm";
type Outcome = { kind: "shipments" } | { kind: "not_shipment" };
type Opt = { key: string; orderId: string | null; shipmentId: string | null; ref: string; label: string };
type FileState = { targets: string[]; docType: string | null; skip: boolean; /** Round AS: kept waiting for its casts. */ wait: boolean };
type IssueForm = { title: string; summaryEn: string; summaryJa: string; owner: string; effectiveFrom: string; coaBanner: boolean; linkPicked: boolean };

/** The document slots a person may put a file in (the intake's triage types — the planner files by them). */
const SLOTS = ["COA", "COA_XLS", "PL", "PL_XLS", "PL_CONTAINER", "CI", "PI", "BL_SCAN", "BL_DRAFT", "COO", "INSURANCE", "TELEX", "ARRIVAL_NOTICE", "IMPORT_PERMIT", "BUNDLE_LIST", "DELIVERY_NOTE", "DELIVERY_SCHEDULE", "VENDOR_INVOICE", "PAYMENT_PROOF", "CONTRACT", "SI"];
const SLOT_LABEL: Record<string, string> = { COA_XLS: "COA (Excel)", PL_XLS: "Packing list (Excel)", PL_CONTAINER: "Container packing list", BL_SCAN: "Bill of lading (B/L)", TELEX: "Telex release", SI: "Shipping instructions" };
const slotLabel = (code: string) => SLOT_LABEL[code] ?? docPlainName({ docType: code, docLabel: null } as any);
const CAST_RE = /^\d{3}[A-Z]\d{4}(\d{2})?$/i;
const fileKey = (f: Pick<Placement, "emailId" | "index">) => `${f.emailId}:${f.index}`;
const tKey = (t: { orderId?: string | null; shipmentId?: string | null }) => `${t.orderId ?? ""}:${t.shipmentId ?? ""}`;

/** One line of the All-shipments list (round AV: the rule is in _lib/shipment-picker.ts). */
export const shipmentLine = (s: Parameters<typeof shipmentLineOf>[0]) => shipmentLineOf(s, { day: fmtDay, customer: shortCustomer });
const orderLine = (o: Parameters<typeof orderLineOf>[0]) => orderLineOf(o, { customer: shortCustomer });

/** The search text of a shipment row: ref, customer, grade, B/L, vessel. */
const haystack = (s: ShipmentListItem) => [s.ref, s.customerName, s.customer?.name, s.order?.grade, s.contractLine?.grade, s.productLine, s.blNumber, s.vessel].filter(Boolean).join(" ").toLowerCase();

/** The "yes" / "no" of step 1 for this card. */
export function stepOneQuestion(kind: InboxThread["question"] extends infer Q ? (Q extends { kind: infer K } ? K : never) : never, title: string, lang: InboxLang): string {
  return kind === "NEW_DEAL" ? title : L[lang].isShipmentQ;
}

export function ChooseShipmentDialog({ open, t, lang, busy, onClose, onAnswer, onCreateOrder }: { open: boolean; t: InboxThread; lang: InboxLang; busy?: boolean; onClose: () => void; onAnswer: (t: InboxThread, a: InboxAnswer) => void; onCreateOrder: (t: InboxThread) => void }) {
  const q = t.question;
  const labels = L[lang];
  const api = useShipmentsApi();
  const [step, setStep] = useState<Step>("q1");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [search, setSearch] = useState("");
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [issueOn, setIssueOn] = useState(false);
  const [files, setFiles] = useState<Record<string, FileState>>({});
  const [issue, setIssue] = useState<IssueForm | null>(null);
  // Round AV: the add / edit drawer, shipments made here (until the lists refetch), completed orders shown.
  const [drawer, setDrawer] = useState<DrawerMode | null>(null);
  const [made, setMade] = useState<Map<string, Opt>>(new Map());
  const [showCompleted, setShowCompleted] = useState(false);
  const ids = useMemo(() => (t.answerIds?.length ? t.answerIds : t.messages.filter((m) => m.inboxState !== "PROCESSED").map((m) => m.id)), [t]);
  const inList = open && (step === "which" || step === "files" || step === "issue" || step === "confirm");
  const ships = useShipments({ status: "OPEN", pageSize: 200 }, inList);
  const done = useShipments({ status: "COMPLETED", pageSize: 200 }, inList);
  const orders = useOrders({ bucket: "all", pageSize: 200 }, open && step === "which");
  const suppliers = useSuppliers(open && step === "issue");
  const customers = useCustomers(open && step === "issue");

  const likely = useMemo(() => likelyOptions(q), [q]);
  useEffect(() => {
    if (!open) return;
    setStep("q1");
    setOutcome(null);
    setSearch("");
    // Round AR: several shipments named exactly → all ticked; a general issue AIMS read → ticked.
    setTicked(new Set(q?.multi ? likely.filter((o) => o.suggested).map(optionKey) : []));
    setIssueOn(!!q?.issue);
    setFiles({});
    setIssue(null);
    setDrawer(null);
    setMade(new Map());
    setShowCompleted(false);
  }, [open, t.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const likelyKeys = useMemo(() => new Set(likely.map(optionKey)), [likely]);
  const allShips = useMemo(() => [...(ships.data?.items ?? []), ...(done.data?.items ?? [])].filter((s) => s.status !== "CANCELLED" && !!s.orderId), [ships.data, done.data]);
  const needle = search.trim().toLowerCase();
  const castKey = CAST_RE.test(search.trim()) ? search.trim().toUpperCase() : null;
  const castHits = useQuery({ queryKey: ["trade-cast-search", castKey], enabled: open && step === "which" && !!castKey, queryFn: () => api.castSearch(castKey!), staleTime: 60_000 });
  const castShips = useMemo(() => (castHits.data ?? []).map((h) => allShips.find((s) => s.id === h.shipmentId)).filter((s): s is ShipmentListItem => !!s), [castHits.data, allShips]);
  const likelyShown = needle && !castKey ? likely.filter((o) => `${o.ref} ${o.summary} ${o.why}`.toLowerCase().includes(needle)) : likely;
  const toggle = (key: string) =>
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  /** Every shipment the person can point at (picked / likely / open / completed), by key. */
  const optsByKey = useMemo(() => {
    const m = new Map<string, Opt>();
    for (const o of likely) m.set(optionKey(o), { key: optionKey(o), orderId: o.orderId, shipmentId: o.shipmentId, ref: o.ref, label: o.summary || o.ref });
    for (const s of allShips) {
      const k = optionKey({ orderId: s.orderId!, shipmentId: s.id });
      if (!m.has(k)) m.set(k, { key: k, orderId: s.orderId!, shipmentId: s.id, ref: s.ref || s.blNumber || "Shipment", label: shipmentLine(s) });
    }
    for (const [k, o] of made) if (!m.has(k)) m.set(k, o);
    return m;
  }, [likely, allShips, made]);
  const orderById = useMemo(() => new Map((orders.data?.items ?? []).map((o) => [o.id, o])), [orders.data]);
  const shipById = useMemo(() => new Map(allShips.map((s) => [s.id, s])), [allShips]);
  const groups = useMemo(() => orderGroups(orders.data?.items ?? [], { showCompleted }), [orders.data, showCompleted]);
  /** A new shipment saved in the drawer: ticked, and listed until the lists catch up. */
  const onDrawerSaved = (s: Shipment) => {
    if (drawer?.kind === "new" && s.orderId) {
      const k = optionKey({ orderId: s.orderId, shipmentId: s.id });
      setMade((prev) => new Map(prev).set(k, { key: k, orderId: s.orderId!, shipmentId: s.id, ref: s.ref ?? "Shipment", label: shipmentLine(s as any) }));
      setTicked((prev) => new Set(prev).add(k));
    }
  };
  const picked = useMemo(() => [...ticked].map((k) => optsByKey.get(k)).filter((o): o is Opt => !!o), [ticked, optsByKey]);
  const emails = t.answerIds?.length || t.emails || 1;

  // ── files (round AR) ──
  const pickedTargets: AnswerTarget[] = useMemo(() => picked.map((p) => ({ orderId: p.orderId, shipmentId: p.shipmentId })), [picked]);
  const placements = useQuery({
    queryKey: ["inbox-placements", ids, pickedTargets.map(tKey).sort()],
    enabled: open && step === "files",
    queryFn: () => api.inboxPlacements(ids, pickedTargets),
    staleTime: 60_000,
  });
  const fileRows = placements.data?.files ?? [];
  useEffect(() => {
    if (!placements.data) return;
    setFiles((prev) => {
      const next: Record<string, FileState> = {};
      for (const f of placements.data.files) {
        const k = fileKey(f);
        if (prev[k]) next[k] = prev[k];
        else next[k] = { targets: f.inline ? [] : f.defaults.map((d) => optionKey({ orderId: d.orderId ?? "", shipmentId: d.shipmentId })), docType: f.docType, skip: f.inline, wait: !f.inline && f.keys.length > 0 && !f.defaults.length && !f.holders.length };
      }
      return next;
    });
  }, [placements.data]);
  // Shipments a placement points at but the lists don't have yet (e.g. a cancelled-list edge) still get a label.
  const optOf = (key: string, f?: Placement): Opt | null => {
    const o = optsByKey.get(key);
    if (o) return o;
    const d = f ? [...f.defaults, ...f.holders].find((x) => optionKey({ orderId: x.orderId ?? "", shipmentId: x.shipmentId }) === key) : null;
    return d ? { key, orderId: d.orderId, shipmentId: d.shipmentId, ref: d.ref ?? "Shipment", label: d.ref ?? "Shipment" } : null;
  };
  const unplaced = fileRows.filter((f) => { const s = files[fileKey(f)]; return !s || (!s.skip && (!s.targets.length || !s.docType)); }).length;

  // ── issue (round AR) ──
  const ownerOptions = useMemo(() => [...(suppliers.data ?? []).map((p) => ({ id: `s:${p.id}`, label: `${p.name} · ${labels.supplier}` })), ...(customers.data ?? []).map((p) => ({ id: `c:${p.id}`, label: `${p.name} · ${labels.customer}` }))], [suppliers.data, customers.data, labels]);
  const draft = useQuery({ queryKey: ["inbox-issue-draft", ids], enabled: open && step === "issue" && issueOn, queryFn: () => api.inboxIssueDraft(ids), staleTime: 10 * 60_000, retry: false });
  useEffect(() => {
    if (step !== "issue" || issue) return;
    const p = q?.issue;
    if (p) setIssue({ title: p.title, summaryEn: p.summaryEn ?? "", summaryJa: p.summaryJa ?? "", owner: "", effectiveFrom: p.effectiveFrom ?? "", coaBanner: true, linkPicked: false });
  }, [step, q, issue]);
  useEffect(() => {
    const d = draft.data;
    if (!d) return;
    const owner = d.supplierId ? `s:${d.supplierId}` : d.customerId ? `c:${d.customerId}` : "";
    setIssue((cur) =>
      cur
        ? { ...cur, owner: cur.owner || owner, summaryJa: cur.summaryJa || d.summaryJa || "", summaryEn: cur.summaryEn || d.summaryEn || "", effectiveFrom: cur.effectiveFrom || d.effectiveFrom || "", coaBanner: cur.coaBanner || d.docTypes.includes("CUSTOMER_COA") }
        : { title: d.title ?? "", summaryEn: d.summaryEn ?? "", summaryJa: d.summaryJa ?? "", owner, effectiveFrom: d.effectiveFrom ?? "", coaBanner: d.docTypes.includes("CUSTOMER_COA"), linkPicked: false },
    );
  }, [draft.data]);
  const issueReady = !!issue && !!issue.title.trim() && (!!issue.owner || (issue.linkPicked && picked.length > 0));

  if (!q) return null;
  const isDeal = q.kind === "NEW_DEAL";
  const hasFiles = (t.files ?? 0) > 0;

  // ── the steps' actions ──
  const wf = q.waitingFile ?? null;
  const yes = () => {
    if (wf) {
      setOutcome({ kind: "shipments" });
      setStep("confirm");
      return;
    }
    if (isDeal) {
      onClose();
      onCreateOrder(t);
      return;
    }
    setStep("which");
  };
  const no = () => {
    if (wf) {
      setOutcome({ kind: "not_shipment" });
      setStep("confirm");
      return;
    }
    setStep("what");
  };
  const notShipment = () => {
    setOutcome({ kind: "not_shipment" });
    setStep("confirm");
  };
  const later = () => {
    onClose();
    onAnswer(t, { kind: "later" });
  };
  const afterWhich = (): Step => (hasFiles ? "files" : issueOn ? "issue" : "confirm");
  const next = () => {
    if (!picked.length && !issueOn) return;
    setOutcome({ kind: "shipments" });
    setStep(afterWhich());
  };
  const nextFromFiles = () => {
    if (unplaced) return;
    setStep(issueOn ? "issue" : "confirm");
  };
  const nextFromIssue = () => {
    if (!issueReady) return;
    setStep("confirm");
  };
  const buildAnswer = (): InboxAnswer | null => {
    if (!outcome) return null;
    if (outcome.kind === "not_shipment") return answerFor({ kind: "not_shipment" }, q.kind);
    // Round AS: attach the waiting file to the proposed shipment (the server files that one attachment).
    if (wf && q.options[0]) return { kind: "record", orderId: q.options[0].orderId, shipmentId: q.options[0].shipmentId, targets: [{ orderId: q.options[0].orderId, shipmentId: q.options[0].shipmentId }] };
    const targets = pickedTargets.filter((p) => p.orderId).map((p) => ({ orderId: p.orderId!, shipmentId: p.shipmentId }));
    const filesOut: AnswerFile[] | undefined = fileRows.length
      ? fileRows.map((f) => {
          const s = files[fileKey(f)];
          const tg = s && !s.skip ? s.targets.map((k) => optOf(k, f)).filter((o): o is Opt => !!o).map((o) => ({ orderId: o.orderId, shipmentId: o.shipmentId })) : [];
          return { emailId: f.emailId, index: f.index, targets: tg, docType: s?.docType ?? f.docType ?? null, ...(s?.skip && s.wait && f.keys.length ? { wait: true } : {}) };
        })
      : undefined;
    const issueOut: AnswerIssue | null =
      issueOn && issue
        ? {
            title: issue.title.trim(),
            summaryEn: issue.summaryEn.trim() || null,
            summaryJa: issue.summaryJa.trim() || null,
            effectiveFrom: issue.effectiveFrom.trim() || null,
            supplierId: issue.owner.startsWith("s:") ? issue.owner.slice(2) : null,
            customerId: issue.owner.startsWith("c:") ? issue.owner.slice(2) : null,
            docTypes: issue.coaBanner ? ["CUSTOMER_COA"] : [],
            shipmentIds: issue.linkPicked ? picked.map((p) => p.shipmentId).filter((x): x is string => !!x) : [],
          }
        : null;
    if (issueOut) return { kind: "general", issue: issueOut, ...(filesOut ? { files: filesOut } : {}), ...(targets.length ? { targets } : {}) };
    if (!targets.length && !(filesOut ?? []).some((f) => f.targets.length)) return null;
    return { kind: "record", orderId: targets[0]?.orderId ?? null, shipmentId: targets[0]?.shipmentId ?? null, targets, ...(filesOut ? { files: filesOut } : {}) };
  };
  const confirm = () => {
    const a = buildAnswer();
    if (!a) return;
    onClose();
    onAnswer(t, a);
  };
  const back = () =>
    setStep(
      wf ? "q1"
      : step === "confirm" ? (outcome?.kind === "shipments" ? (issueOn ? "issue" : hasFiles ? "files" : "which") : "what")
      : step === "issue" ? (hasFiles ? "files" : "which")
      : step === "files" ? "which"
      : step === "which" ? (isDeal ? "what" : "q1")
      : "q1",
    );
  const primary = step === "q1" ? yes : step === "which" ? next : step === "files" ? nextFromFiles : step === "issue" ? nextFromIssue : step === "confirm" ? confirm : null;
  const onKeyDown = (e: React.KeyboardEvent) => {
    // The drawer is rendered inside this dialog (React events bubble through its portal): its Enter is its own.
    if (drawer) return;
    if (e.key !== "Enter" || !primary || busy) return;
    if ((e.target as HTMLElement)?.tagName === "TEXTAREA") return;
    if (step === "which" && !picked.length && !issueOn) return;
    e.preventDefault();
    primary();
  };

  const big = (label: string, onClick: () => void, tour: string, variant: "contained" | "outlined" = "outlined") => (
    <Button key={tour} size="large" variant={variant} disabled={busy} onClick={onClick} sx={{ textTransform: "none", py: 1.5, fontSize: 16, justifyContent: "flex-start" }} data-tour={tour}>
      {label}
    </Button>
  );
  const row = (key: string, primaryText: string, secondary?: string | null, tour?: string, editId?: string | null, extra?: React.ReactNode) => (
    <ListItemButton key={key} dense onClick={() => toggle(key)} selected={ticked.has(key)} sx={{ py: 0.25, px: 1 }} data-tour={tour}>
      <ListItemIcon sx={{ minWidth: 36 }}>
        <Checkbox edge="start" size="small" checked={ticked.has(key)} tabIndex={-1} disableRipple />
      </ListItemIcon>
      <ListItemText primary={primaryText} secondary={secondary || undefined} primaryTypographyProps={{ variant: "body2", fontWeight: 600, sx: { wordBreak: "break-word" } }} secondaryTypographyProps={{ variant: "caption", sx: { wordBreak: "break-word" } }} />
      {extra}
      {editId && (
        <Tooltip title={lang === "ja" ? "出荷を編集" : "Edit the shipment"}>
          <IconButton
            size="small"
            edge="end"
            aria-label={lang === "ja" ? "出荷を編集" : "Edit the shipment"}
            onClick={(e) => {
              e.stopPropagation();
              setDrawer({ kind: "edit", shipmentId: editId });
            }}
            data-tour="choose-shipment-edit"
          >
            <EditOutlinedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      )}
    </ListItemButton>
  );
  /** "+ New shipment (#27-1)" on an order row / group. */
  const newFor = (o: OrderListItem) =>
    o.status === "OPEN" ? (
      <Button
        size="small"
        startIcon={<AddIcon fontSize="small" />}
        onClick={(e) => {
          e.stopPropagation();
          setDrawer({ kind: "new", orderId: o.id });
        }}
        sx={{ textTransform: "none", flexShrink: 0, whiteSpace: "nowrap" }}
        data-tour="choose-shipment-new-for-order"
      >
        {lang === "ja" ? `新しい出荷（${nextShipmentRef(o)}）` : `New shipment (${nextShipmentRef(o)})`}
      </Button>
    ) : null;
  const liveShips = (o: OrderListItem) => (o.shipments ?? []).filter((x) => x.status !== "CANCELLED");
  const refsOf = (keys: string[], f?: Placement) => keys.map((k) => optOf(k, f)?.ref).filter(Boolean).join(lang === "ja" ? "、" : ", ");
  const pickedRefs = picked.map((p) => p.ref).join(lang === "ja" ? "、" : ", ");
  const title =
    wf && step === "confirm" ? (outcome?.kind === "shipments" ? labels.waitingAttach(wf.name, q.options[0]?.ref ?? "") : labels.waitingKeep(q.options[0]?.ref ?? ""))
    : step === "q1" ? (isDeal ? q.title : q.multi || q.issue || wf ? q.title : labels.isShipmentQ)
    : step === "what" ? labels.whatThen
    : step === "which" ? labels.whichShipment
    : step === "files" ? labels.whereFiles
    : step === "issue" ? labels.issueStep
    : outcome?.kind === "shipments" ? (picked.length && !issueOn ? labels.confirmLink(emails, pickedRefs) : labels.confirmTitle)
    : isDeal ? labels.confirmNotDeal(emails) : labels.confirmNot(emails);
  return (
    <Dialog open={open} onClose={onClose} maxWidth={step === "files" || step === "issue" ? "md" : "sm"} fullWidth transitionDuration={{ enter: 225, exit: 0 }} disableRestoreFocus onKeyDown={onKeyDown} data-tour="answer-flow" data-step={step}>
      <DialogTitle sx={{ pr: 7 }}>
        <Typography variant="h6" component="div" sx={{ fontWeight: 700, wordBreak: "break-word" }} data-tour="answer-step-title">
          {title}
        </Typography>
        {(step === "q1" || step === "files") && !isDeal && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25, wordBreak: "break-word" }}>
            {t.subject || ""}
          </Typography>
        )}
        <IconButton aria-label="Close" onClick={onClose} sx={{ position: "absolute", right: 8, top: 8 }} data-tour="answer-flow-close">
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      {step === "q1" && (
        <DialogContent dividers>
          <Stack spacing={1.25} data-tour="answer-step-q1">
            {big(labels.yes, yes, "answer-yes", "contained")}
            {big(labels.no, no, "answer-no")}
          </Stack>
        </DialogContent>
      )}
      {step === "what" && (
        <DialogContent dividers>
          <Stack spacing={1.25} data-tour="answer-step-what">
            {big(labels.existingShipment, () => setStep("which"), "answer-existing")}
            {!isDeal &&
              big(labels.generalIssue, () => {
                setIssueOn(true);
                setOutcome({ kind: "shipments" });
                setStep(hasFiles ? "files" : "issue");
              }, "answer-general")}
            {big(isDeal ? labels.notDeal : labels.notShipment, notShipment, "answer-not-shipment")}
            {big(labels.askMeLater, later, "answer-later")}
          </Stack>
        </DialogContent>
      )}
      {step === "which" && (
        <>
          <Box sx={{ px: 3, pb: 1.5 }}>
            <TextField
              size="small"
              fullWidth
              autoFocus
              placeholder={labels.searchShipmentsCast}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
              inputProps={{ "data-tour": "choose-shipment-search" }}
            />
          </Box>
          <DialogContent dividers sx={{ p: 0 }}>
            <Box sx={{ px: 2, pt: 1 }}>
              <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={() => setDrawer({ kind: "new" })} sx={{ textTransform: "none" }} data-tour="answer-new-shipment">
                {lang === "ja" ? "新しい出荷…" : "New shipment…"}
              </Button>
            </Box>
            {!isDeal && (
              <Box sx={{ px: 2, pt: 1 }}>
                <ListItemButton dense onClick={() => setIssueOn((v) => !v)} selected={issueOn} sx={{ py: 0.25, px: 1, borderRadius: 1 }} data-tour="answer-general-toggle">
                  <ListItemIcon sx={{ minWidth: 36 }}>
                    <Checkbox edge="start" size="small" checked={issueOn} tabIndex={-1} disableRipple />
                  </ListItemIcon>
                  <ListItemText primary={labels.generalIssue} secondary={q.issue ? labels.generalProposed(q.issue.title) : labels.generalIssueHint} primaryTypographyProps={{ variant: "body2", fontWeight: 600 }} secondaryTypographyProps={{ variant: "caption", sx: { wordBreak: "break-word" } }} />
                </ListItemButton>
                <Divider sx={{ my: 1 }} />
              </Box>
            )}
            {castKey && (
              <Box sx={{ px: 2, pt: 1 }} data-tour="choose-shipment-cast">
                <Typography variant="overline" color="text.secondary">
                  {labels.castHits(castKey)}
                </Typography>
                {castHits.isLoading ? (
                  <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>{labels.castSearching}</Typography>
                ) : castShips.length === 0 ? (
                  <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>{labels.castNone(castKey)}</Typography>
                ) : (
                  <List dense disablePadding>
                    {castShips.map((s) => row(optionKey({ orderId: s.orderId!, shipmentId: s.id }), shipmentLine(s), s.status === "COMPLETED" ? (lang === "ja" ? "完了" : "Completed") : null, "choose-shipment-row"))}
                  </List>
                )}
                <Divider sx={{ my: 1 }} />
              </Box>
            )}
            {likelyShown.length > 0 && (
              <Box sx={{ px: 2, pt: 1 }}>
                <Typography variant="overline" color="text.secondary">
                  {labels.likely}
                </Typography>
                <List dense disablePadding data-tour="choose-shipment-likely">
                  {likelyShown.map((o) => {
                    const ord = !o.shipmentId ? orderById.get(o.orderId) : null;
                    const empty = !!ord && liveShips(ord).length === 0;
                    const primaryText = empty ? `${orderLine(ord!)} · ${lang === "ja" ? "出荷なし" : "no shipment yet"}` : o.summary || o.ref;
                    return row(optionKey(o), primaryText, [primaryText.includes(o.ref) ? null : o.ref, o.why].filter(Boolean).join(" · "), "choose-shipment-option", o.shipmentId, ord ? newFor(ord) : null);
                  })}
                </List>
              </Box>
            )}
            {likelyShown.length > 0 && <Divider sx={{ my: 1 }} />}
            {!castKey && (
              <Box sx={{ px: 2, pb: 1 }}>
                <Stack direction="row" alignItems="center" spacing={1}>
                  <Typography variant="overline" color="text.secondary" sx={{ flex: 1 }}>
                    {labels.allShipments}
                  </Typography>
                  <FormControlLabel
                    control={<Switch size="small" checked={showCompleted} onChange={(e) => setShowCompleted(e.target.checked)} />}
                    label={<Typography variant="caption">{lang === "ja" ? "完了も表示" : "Show completed"}</Typography>}
                    sx={{ mr: 0 }}
                    data-tour="choose-shipment-show-completed"
                  />
                </Stack>
                {ships.isLoading || orders.isLoading ? (
                  <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
                    {labels.loadingShipments}
                  </Typography>
                ) : (
                  (() => {
                    const shown = groups
                      .map((o) => {
                        const rows = liveShips(o)
                          .map((x) => shipById.get(x.id))
                          .filter((x): x is ShipmentListItem => !!x && !likelyKeys.has(optionKey({ orderId: o.id, shipmentId: x.id })));
                        if (!needle) return { o, rows };
                        const orderHit = orderHaystack(o).includes(needle);
                        const hits = orderHit ? rows : rows.filter((x) => haystack(x).includes(needle));
                        return orderHit || hits.length ? { o, rows: hits } : null;
                      })
                      .filter((g): g is { o: OrderListItem; rows: ShipmentListItem[] } => !!g);
                    if (!shown.length) {
                      return (
                        <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
                          {labels.noShipments}
                        </Typography>
                      );
                    }
                    return (
                      <Box data-tour="choose-shipment-all">
                        {shown.map(({ o, rows }) => (
                          <Box key={o.id} sx={{ mb: 0.75 }} data-tour="choose-shipment-group">
                            <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 1, pt: 0.5 }}>
                              <Typography variant="body2" sx={{ fontWeight: 800, flex: 1, minWidth: 0, wordBreak: "break-word" }}>
                                {orderLine(o)}
                                {o.status === "COMPLETED" ? <Chip size="small" label={lang === "ja" ? "完了" : "Completed"} sx={{ ml: 1, height: 20 }} /> : null}
                              </Typography>
                              {newFor(o)}
                            </Stack>
                            {rows.length ? (
                              <List dense disablePadding sx={{ pl: 1.5 }}>
                                {rows.map((x) => row(optionKey({ orderId: o.id, shipmentId: x.id }), shipmentLine(x), x.status === "COMPLETED" ? (lang === "ja" ? "完了" : "Completed") : null, "choose-shipment-row", x.id))}
                              </List>
                            ) : (
                              <Typography variant="caption" color="text.secondary" component="div" sx={{ pl: 2.5, pb: 0.5 }}>
                                {liveShips(o).length ? (lang === "ja" ? "上の候補にあります" : "listed above") : lang === "ja" ? "出荷なし" : "no shipment yet"}
                              </Typography>
                            )}
                          </Box>
                        ))}
                      </Box>
                    );
                  })()
                )}
              </Box>
            )}
          </DialogContent>
        </>
      )}
      {step === "files" && (
        <DialogContent dividers data-tour="answer-step-files">
          {placements.isLoading ? (
            <Stack direction="row" spacing={1} alignItems="center" sx={{ py: 2 }}>
              <CircularProgress size={18} />
              <Typography variant="body2" color="text.secondary">{labels.loadingFiles}</Typography>
            </Stack>
          ) : placements.error ? (
            <Alert severity="error">{(placements.error as Error)?.message || "Could not read the files"}</Alert>
          ) : fileRows.length === 0 ? (
            <Typography variant="body2" color="text.secondary">{labels.noFiles}</Typography>
          ) : (
            <Stack spacing={1.5} divider={<Divider flexItem />}>
              {fileRows.map((f) => {
                const k = fileKey(f);
                const s = files[k] ?? { targets: [], docType: f.docType, skip: f.inline, wait: false };
                const set = (patch: Partial<FileState>) => setFiles((prev) => ({ ...prev, [k]: { ...s, ...patch } }));
                const options = [...new Set([...picked.map((p) => p.key), ...f.defaults.map((d) => optionKey({ orderId: d.orderId ?? "", shipmentId: d.shipmentId })), ...f.holders.map((d) => optionKey({ orderId: d.orderId ?? "", shipmentId: d.shipmentId })), ...optsByKey.keys()])];
                const hint = f.inline
                  ? labels.inlineImage
                  : f.defaults.length
                    ? labels.aimsPick(f.defaults.map((d) => d.ref).filter(Boolean).join(", "), f.defaults[0].why)
                    : f.holders.length > 1
                      ? labels.onSeveral(f.holders.map((h) => h.ref).filter(Boolean).join(", "))
                      : labels.noMatch;
                const warn = !f.inline && !f.defaults.length;
                return (
                  <Box key={k} data-tour="answer-file-row">
                    <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "center" }} justifyContent="space-between">
                      <Typography variant="body2" sx={{ fontWeight: 600, wordBreak: "break-word" }}>{f.name}</Typography>
                      <FormControlLabel control={<Checkbox size="small" checked={s.skip} onChange={(e) => set({ skip: e.target.checked })} />} label={<Typography variant="body2">{labels.dontFile}</Typography>} sx={{ mr: 0, flexShrink: 0 }} />
                    </Stack>
                    <Typography variant="caption" color={warn ? "warning.main" : "text.secondary"} sx={{ display: "block", mb: 0.75, wordBreak: "break-word" }}>
                      {hint}
                      {f.outsidePick && !s.skip ? ` · ${labels.outsidePick}` : ""}
                    </Typography>
                    {s.skip && !f.inline && f.keys.length > 0 && (
                      <FormControlLabel control={<Checkbox size="small" checked={s.wait} onChange={(e) => set({ wait: e.target.checked })} />} label={<Typography variant="body2">{labels.keepWaiting(f.keys.filter((x) => x.length === 8).join(", ") || f.keys.join(", "))}</Typography>} data-tour="answer-file-wait" />
                    )}
                    {!s.skip && (
                      <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                        <Autocomplete
                          multiple
                          size="small"
                          sx={{ flex: 2, minWidth: 0 }}
                          options={options}
                          value={s.targets}
                          onChange={(_e, v) => set({ targets: v })}
                          getOptionLabel={(key) => optOf(key, f)?.label ?? key}
                          renderTags={(value, getTagProps) => value.map((key, i) => <Chip {...getTagProps({ index: i })} key={key} size="small" label={optOf(key, f)?.ref ?? key} />)}
                          renderInput={(p) => <TextField {...p} label={labels.fileTargets} error={!s.targets.length} />}
                          data-tour="answer-file-targets"
                        />
                        <TextField select size="small" label={labels.fileSlot} value={s.docType ?? ""} onChange={(e) => set({ docType: e.target.value || null })} sx={{ flex: 1, minWidth: 180 }} error={!s.docType}>
                          {SLOTS.map((c) => (
                            <MenuItem key={c} value={c}>{slotLabel(c)}</MenuItem>
                          ))}
                        </TextField>
                      </Stack>
                    )}
                  </Box>
                );
              })}
            </Stack>
          )}
        </DialogContent>
      )}
      {step === "issue" && (
        <DialogContent dividers data-tour="answer-step-issue">
          {!issue && draft.isLoading ? (
            <Stack direction="row" spacing={1} alignItems="center" sx={{ py: 2 }}>
              <CircularProgress size={18} />
              <Typography variant="body2" color="text.secondary">{labels.issueDrafting}</Typography>
            </Stack>
          ) : (
            <Stack spacing={1.5} sx={{ pt: 0.5 }}>
              {draft.isLoading && <Typography variant="caption" color="text.secondary">{labels.issueDrafting}</Typography>}
              <TextField size="small" label={labels.issueTitle} value={issue?.title ?? ""} onChange={(e) => setIssue((c) => ({ ...(c ?? emptyIssue()), title: e.target.value }))} required autoFocus inputProps={{ "data-tour": "issue-title" }} />
              <TextField size="small" label={labels.issueSummaryEn} value={issue?.summaryEn ?? ""} onChange={(e) => setIssue((c) => ({ ...(c ?? emptyIssue()), summaryEn: e.target.value }))} multiline minRows={2} maxRows={6} />
              <TextField size="small" label={labels.issueSummaryJa} value={issue?.summaryJa ?? ""} onChange={(e) => setIssue((c) => ({ ...(c ?? emptyIssue()), summaryJa: e.target.value }))} multiline minRows={2} maxRows={6} />
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                <TextField select size="small" label={labels.issueOwner} value={issue?.owner ?? ""} onChange={(e) => setIssue((c) => ({ ...(c ?? emptyIssue()), owner: e.target.value }))} sx={{ flex: 2 }} error={!issue?.owner && !(issue?.linkPicked && picked.length)} helperText={!issue?.owner && !(issue?.linkPicked && picked.length) ? labels.issueNeedOwner : undefined}>
                  {ownerOptions.map((o) => (
                    <MenuItem key={o.id} value={o.id}>{o.label}</MenuItem>
                  ))}
                </TextField>
                <TextField size="small" label={labels.issueEffective} value={issue?.effectiveFrom ?? ""} onChange={(e) => setIssue((c) => ({ ...(c ?? emptyIssue()), effectiveFrom: e.target.value }))} sx={{ flex: 1 }} />
              </Stack>
              <FormControlLabel control={<Checkbox size="small" checked={!!issue?.coaBanner} onChange={(e) => setIssue((c) => ({ ...(c ?? emptyIssue()), coaBanner: e.target.checked }))} />} label={<Typography variant="body2">{labels.issueCoaBanner}</Typography>} />
              {picked.length > 0 && <FormControlLabel control={<Checkbox size="small" checked={!!issue?.linkPicked} onChange={(e) => setIssue((c) => ({ ...(c ?? emptyIssue()), linkPicked: e.target.checked }))} />} label={<Typography variant="body2">{`${labels.issueLinkPicked} (${pickedRefs})`}</Typography>} />}
            </Stack>
          )}
        </DialogContent>
      )}
      {step === "confirm" && wf && (
        <DialogContent dividers>
          <Typography variant="body2" color="text.secondary" data-tour="answer-step-confirm">
            {outcome?.kind === "shipments" ? `${q.options[0]?.summary ?? ""} — ${q.options[0]?.why ?? ""}. ${labels.waitingAttachNote}` : q.found}
          </Typography>
        </DialogContent>
      )}
      {step === "confirm" && !wf && (
        <DialogContent dividers>
          {outcome?.kind === "shipments" ? (
            <Stack spacing={1.5} data-tour="answer-step-confirm">
              {picked.length > 0 && (
                <Box>
                  <Typography variant="overline" color="text.secondary">{labels.confirmLinkTo}</Typography>
                  <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
                    {picked.map((p) => <Chip key={p.key} size="small" label={p.label} />)}
                  </Stack>
                </Box>
              )}
              {fileRows.length > 0 && (
                <Box>
                  <Typography variant="overline" color="text.secondary">{labels.confirmFiles}</Typography>
                  <Stack spacing={0.5}>
                    {fileRows.map((f) => {
                      const s = files[fileKey(f)];
                      return (
                        <Typography key={fileKey(f)} variant="body2" sx={{ wordBreak: "break-word" }}>
                          <b>{f.name}</b> → {!s || s.skip ? (s?.wait && f.keys.length ? labels.keptWaiting : labels.notFiled) : `${refsOf(s.targets, f)} · ${slotLabel(s.docType ?? "")}`}
                        </Typography>
                      );
                    })}
                  </Stack>
                </Box>
              )}
              {issueOn && issue && (
                <Box>
                  <Typography variant="overline" color="text.secondary">{labels.confirmIssue}</Typography>
                  <Typography variant="body2" sx={{ fontWeight: 600, wordBreak: "break-word" }}>{issue.title}</Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                    {[ownerOptions.find((o) => o.id === issue.owner)?.label, issue.effectiveFrom || null, issue.coaBanner ? labels.issueCoaBanner : null, issue.linkPicked && picked.length ? pickedRefs : null].filter(Boolean).join(" · ")}
                  </Typography>
                </Box>
              )}
              <Typography variant="caption" color="text.secondary">{labels.confirmNote}</Typography>
            </Stack>
          ) : (
            <Typography variant="body2" color="text.secondary" data-tour="answer-step-confirm">
              {lang === "ja" ? "確定するとメールは非表示になります（設定 → メールフィルター → 非表示 から戻せます）。" : "On Confirm the emails are hidden (Settings → Email filter → Hidden brings them back)."}
            </Typography>
          )}
        </DialogContent>
      )}
      <DialogActions sx={{ flexWrap: "wrap", gap: 1, px: 2 }}>
        {step !== "q1" && (
          <Button onClick={back} color="inherit" startIcon={<ArrowBackIcon />} sx={{ textTransform: "none", mr: "auto" }} data-tour="answer-back">
            {labels.back}
          </Button>
        )}
        {step === "which" && (
          <Typography variant="caption" color="text.secondary" sx={{ minWidth: 0 }}>
            {picked.length ? labels.picked(picked.length) : ""}
          </Typography>
        )}
        {step === "files" && unplaced > 0 && !placements.isLoading && (
          <Typography variant="caption" color="warning.main" sx={{ minWidth: 0 }}>
            {labels.unplaced(unplaced)}
          </Typography>
        )}
        <Button onClick={onClose} color="inherit" sx={{ textTransform: "none" }} data-tour="choose-shipment-cancel">
          {labels.cancel}
        </Button>
        {step === "which" && (
          <Button variant="contained" disabled={(!picked.length && !issueOn) || busy} onClick={next} sx={{ textTransform: "none" }} data-tour="answer-next">
            {labels.next}
          </Button>
        )}
        {step === "files" && (
          <Button variant="contained" disabled={!!unplaced || placements.isLoading || busy} onClick={nextFromFiles} sx={{ textTransform: "none" }} data-tour="answer-files-next">
            {labels.next}
          </Button>
        )}
        {step === "issue" && (
          <Button variant="contained" disabled={!issueReady || busy} onClick={nextFromIssue} sx={{ textTransform: "none" }} data-tour="answer-issue-next">
            {labels.next}
          </Button>
        )}
        {step === "confirm" && (
          <Button variant="contained" disabled={busy || !buildAnswer()} onClick={confirm} sx={{ textTransform: "none" }} data-tour="choose-shipment-confirm">
            {labels.confirm}
          </Button>
        )}
      </DialogActions>
      <ShipmentDrawer open={!!drawer} mode={drawer} emailIds={ids} lang={lang} onClose={() => setDrawer(null)} onSaved={onDrawerSaved} />
    </Dialog>
  );
}

const emptyIssue = (): IssueForm => ({ title: "", summaryEn: "", summaryJa: "", owner: "", effectiveFrom: "", coaBanner: true, linkPicked: false });
