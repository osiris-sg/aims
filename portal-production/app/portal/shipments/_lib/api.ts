/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Typed client for the Shipments module (contracts → shipments → steps →
// trade files). JSON calls go through the shared request helper (Clerk token +
// X-Active-Org-Id + {success,data} envelope); the upload uses axios directly
// so it can report progress, with the same two headers injected.

import axios from "axios";
import { useAuth } from "@clerk/nextjs";
import { useMemo } from "react";
import { request } from "@/helpers/request";

export type RecordStatus = "OPEN" | "COMPLETED" | "CANCELLED";
export type StepStatus = "NOT_STARTED" | "IN_PROGRESS" | "DONE" | "SKIPPED";
/** Prisma Decimals arrive as strings. */
export type Num = number | string | null;

export type Progress = { done: number; total: number };
/** First non-ongoing step not done; null = every step done. */
export type CurrentStep = { code: string; title: string; position: number; displayNo?: string | null; label: string } | null;

export type ContractLine = {
  id: string;
  grade: string | null;
  product: string | null;
  sizeSpec: string | null;
  quantityMt: Num;
  tolerancePct: Num;
  supplierPremium: Num;
  clientPremium: Num;
  /** Price parts the invoices fall back to when Invoice #1 has none. */
  qmjp?: Num;
  billetPremium?: Num;
  upcharge?: Num;
  sortOrder: number;
  notes: string | null;
};
export type ContractLineInput = {
  id?: string;
  grade?: string | null;
  product?: string | null;
  sizeSpec?: string | null;
  quantityMt?: number | null;
  tolerancePct?: number | null;
  supplierPremium?: number | null;
  clientPremium?: number | null;
  qmjp?: number | null;
  billetPremium?: number | null;
  upcharge?: number | null;
  notes?: string | null;
};
/** A bank account invoices can print; `entity` = the ADH company that owns it (DBS / Wise / CFSB = ADH_SG, SMBC JPY = ADH_JP). */
export type BankAccount = { id: string; label: string; block: string; entity?: IssuingEntity };
export type IssuingEntity = "ADH_JP" | "ADH_SG";
/** The entity of a bank account (tagged, else guessed from its name: SMBC / 三井住友 → ADH_JP). */
export const bankEntity = (b: { label: string; entity?: IssuingEntity }): IssuingEntity => b.entity ?? (/smbc|三井住友|sumitomo/i.test(b.label) ? "ADH_JP" : "ADH_SG");
export type DeliveryProfile = { id: string; customerName: string; siteName: string; address: string; notes: string };
/** Org texts for in-app documents (TradeSetting.docDefaults) — every key optional. */
export type DocDefaults = Record<string, any> & {
  banks?: BankAccount[];
  defaultBankId?: string;
  sealImage?: string;
  deliveryProfiles?: DeliveryProfile[];
  sizeInch?: Record<string, string>;
};
/** Org Settings → Shipping & documents: the store-only email intake (GET /email-intake). */
export type IntakeEmail = {
  id: string;
  receivedAt: string;
  date: string | null;
  from: string;
  subject: string | null;
  messageId: string;
  status: string;
  reason: string | null;
  hasEml: boolean;
  emlSource: "raw" | "reconstructed" | null;
  attachments: Array<{ index: number; name: string; contentType: string; size: number }>;
  attachmentNames: string[];
};
export type EmailIntake = { address: string | null; addressNote: string | null; enabled: boolean; mode: string | null; emails: IntakeEmail[] };

/** Shipments → Inbox: a triaged intake email (GET /email-inbox). */
export type InboxTab = "SUGGESTED" | "UNMATCHED" | "PROCESSED" | "UNSURE";
export type IntakeAction = {
  kind: "file" | "field" | "subtask";
  status: "planned" | "done" | "skipped" | "undone";
  reason?: string;
  filename?: string;
  docType?: string;
  ownerKind?: "order" | "shipment" | "supplierOrder";
  field?: string;
  value?: string;
  label?: string;
};
export type InboxRow = {
  /** Known sender / subject rule that decided it (Wan Hai A/N, Mitsui Soko NO.取りリスト, 輸入許可書, Vedanta declaration). */
  knownRule?: string | null;
  supplierOrderSuggestions?: Array<{ grade: string | null; contractNo: string; customer: string | null; destination: string | null; qtyMt: number | null; qpBasis: string | null; pricePerMt: number | null; piNo: string | null }>;
  /** What "Apply PI table" did (round H: on the orders). */
  supplierOrderResults?: Array<{ contractNo: string; piNo: string | null; orderId?: string | null; orderLabel?: string | null; supplierOrderId?: string | null; action: string; reason?: string }>;
  /** Subject words that disagree with the match ("grade 6005 ≠ 6063") — "check". */
  check?: string[];
  id: string;
  date: string;
  receivedAt: string;
  direction: "IN" | "OUT" | null;
  counterparty: string | null;
  verdict: string | null;
  inboxState: InboxTab | "PURGED";
  subject: string | null;
  from: string;
  attachments: Array<{ index: number; name: string; docType: string | null }>;
  orderId: string | null;
  shipmentId: string | null;
  matched: string | null;
  matchedOrder: string | null;
  matchedBy: string | null;
  keys: Record<string, string | null> | null;
  planned: IntakeAction[];
  done: IntakeAction[];
  canUndo: boolean;
  purgeAfter: string | null;
  error: string | null;
};

export type TradeSettings = {
  defaultConsignee: string | null;
  defaultNotifyParty: string | null;
  docDefaults: DocDefaults;
  customerProfiles: Record<string, CustomerProfile>;
  supplierProfiles?: Record<string, SupplierProfile>;
  estimatorRates: EstimatorRates;
  alertRules?: Partial<AlertRules>;
  updatedAt: string | null;
};
export type AlertRules = { taxFundingDaysBefore: number; anDaysBefore: number; detFreeDays: number; demFreeDays: number; freeTimeWarnDaysBefore: number; stuckDays: number; digestEnabled: boolean; digestHourJst: number };
export const DEFAULT_ALERT_RULES: AlertRules = { taxFundingDaysBefore: 14, anDaysBefore: 2, detFreeDays: 4, demFreeDays: 10, freeTimeWarnDaysBefore: 1, stuckDays: 7, digestEnabled: true, digestHourJst: 8 };
export type StepTemplate = {
  id: string;
  scope: "CONTRACT" | "SHIPMENT";
  code: string;
  title: string;
  displayNo?: string | null;
  sortOrder: number;
  requiredDocTypes: string[];
  optionalDocTypes?: string[];
  requiredFields?: string[];
  isOngoing: boolean;
  isActive: boolean;
};
export type DepositDueUnit = "BUSINESS" | "CALENDAR";
// ── AI extraction (PI → contract, B/L draft → shipment + checks) ────────────
export type ContractDraft = {
  contractNo: string | null;
  piNumber: string | null;
  piDate: string | null;
  supplierId: string | null;
  supplierName: string | null;
  customerId: string | null;
  destinationPort: string | null;
  destinationCountry: string | null;
  incoterm: string | null;
  shipmentMonth: string | null;
  currency: string | null;
  piAmount: number | null;
  depositPercent: number | null;
  depositAmount: number | null;
  depositDueNote: string | null;
  /** The PI's payment terms as a day count ("within 3 business days"), null when they aren't one. */
  depositDueDays?: number | null;
  depositDueUnit?: DepositDueUnit | null;
  lines: Array<{ grade: string | null; sizeSpec: string | null; product: string | null; quantityMt: number | null; tolerancePct: number | null; supplierPremium: number | null }>;
};
export type ShipmentDraft = {
  contractNo: string | null;
  blNumber: string | null;
  shippingLine: string | null;
  vessel: string | null;
  voyageNo: string | null;
  etd: string | null;
  portOfLoading: string | null;
  portOfDischarge: string | null;
  netWeightMt: number | null;
  grossWeightMt: number | null;
  totalBundles: number | null;
  totalPieces: number | null;
  containerCount: number | null;
  hsCode: string | null;
  countryOfOrigin: string | null;
  commodity: string | null;
  grade: string | null;
  sizeSpec: string | null;
  containers: Array<{ containerNo: string | null; sealNo: string | null; packages: number | null; grossKg: number | null }>;
  consigneeText: string | null;
  notifyPartyText: string | null;
  freightTerms: string | null;
};
export type CheckItem = { item: string; expected: string; found: string | null; status: "ok" | "mismatch" | "missing" };
export type BlCheck = { key: string; label: string; status: "ok" | "issue" | "missing" | "info"; detail: string; items?: CheckItem[] };
export type Extraction = {
  id: string;
  fileId: string;
  kind: "PI" | "BL_DRAFT" | "AN";
  status: "PENDING" | "DONE" | "FAILED";
  result:
    | ({ raw: Record<string, unknown> } & (
        | { draft: ContractDraft; existingContractId: string | null }
        | { draft: ShipmentDraft; contractId: string | null; contractLineId: string | null; existingShipmentId: string | null }
      ))
    | null;
  checks: BlCheck[] | null;
  issueCount: number | null;
  error: string | null;
  model: string | null;
  durationMs: number | null;
  costUsd: number | null;
  file: { id: string; fileName: string; mimeType: string; docType: string };
};
export type PiExtraction = Extraction & { result: { raw: Record<string, unknown>; draft: ContractDraft; existingContractId: string | null } | null };
export type BlExtraction = Extraction & {
  result: { raw: Record<string, unknown>; draft: ShipmentDraft; contractId: string | null; contractLineId: string | null; existingShipmentId: string | null } | null;
};
/** Arrival notice read (AI): the arriving vessel, containers, weights, charges collect. */
export type ArrivalNoticeDraft = {
  blNumber: string | null;
  vessel: string | null;
  voyageNo: string | null;
  /** Transhipped: the vessel arriving in Japan (= 積載船 on the import permit). */
  tsVessel?: string | null;
  tsVoyageNo?: string | null;
  eta: string | null;
  cyTerminal: string | null;
  portOfLoading: string | null;
  portOfDischarge: string | null;
  grossWeightMt: number | null;
  netWeightMt: number | null;
  totalBundles: number | null;
  totalPieces: number | null;
  containerCount: number | null;
  cbm?: number | null;
  telexRelease?: boolean | null;
  containers: Array<{ containerNo: string | null; sealNo: string | null; size: string | null }>;
  charges: Array<{ code: string | null; unit?: number | null; rate?: number | null; amount: number | null; currency: string | null; collect: boolean | null }>;
  chargesCollect: Array<{ currency: string; amount: number }>;
};
export type AnExtraction = Omit<Extraction, "result"> & {
  /** `fill`: values for the shipment's blank fields only; `blMismatch`: the notice is for another B/L. */
  result: { raw: Record<string, unknown>; draft: ArrivalNoticeDraft; fill: Partial<Record<string, string | number>>; blMismatch: boolean; via?: "text" | "ai" } | null;
};
/** 輸入許可書 read (step 10): the permit's figures, the checks against the shipment and the costs it can fill. */
export type PermitData = {
  declarationNo: string | null;
  declarationDate: string | null;
  blNumber: string | null;
  packages: number | null;
  grossWeightKg: number | null;
  containerCount: number | null;
  vessel: string | null;
  invoiceNo: string | null;
  invoiceTerms: string | null;
  invoiceCurrency: string | null;
  invoiceAmount: number | null;
  addOnJpy: number | null;
  fxRate: number | null;
  customsValue: number | null;
  national: number | null;
  local: number | null;
  total: number | null;
};
export type PermitCheck = { field: string; label: string; status: "ok" | "mismatch" | "missing"; expected: string | null; found: string | null };
export type PermitExtraction = Omit<Extraction, "result"> & {
  result: {
    permit: PermitData;
    totalFrom: "text" | "ai" | "fileName" | null;
    checks: PermitCheck[];
    /** The permit's own CIF × rate + add-on reproduces its total (null = not enough to check). */
    formulaOk: boolean | null;
    sgjpInvoiceNo: string | null;
    fill: Partial<Record<string, number>>;
    via: "text" | "ai";
  } | null;
};
/** Bulk upload with AI sorting: the detected type of one dropped file (primary = the file the required row shows). */
export type FileClassification = {
  fileName: string;
  docType: string;
  variant: string | null;
  primary: boolean;
  confidence: number;
  source: "name" | "sheet" | "ai" | "name+ai" | "none";
  reason: string;
};
/** The shipment's latest B/L draft check (re-run against the shipment as it is now). */
export type BlCheckSummary = {
  extractionId: string;
  fileId: string;
  fileName: string | null;
  extractedAt: string;
  model: string | null;
  checks: BlCheck[];
  issueCount: number;
  acknowledgedByName: string | null;
  acknowledgedAt: string | null;
  containers: ShipmentDraft["containers"];
};

export type Party = { id: string; name: string; supplierCode?: string | null; customerCode?: string | null; currency?: string | null };

export type TradeStep = {
  id: string;
  code: string;
  title: string;
  /** The org's step number ("9"); null = use the position. */
  displayNo?: string | null;
  sortOrder: number;
  requiredDocTypes: string[];
  /** Offered under the step's collapsed "Optional" heading; never required. */
  optionalDocTypes?: string[];
  /** Record fields the step needs too (shipment step 2: blNumber, contractLineId). */
  requiredFields?: string[];
  isOngoing: boolean;
  status: StepStatus;
  /** Reopened by hand: won't auto-complete again until one of its documents / fields changes ("Mark done" does it). */
  holdOpen?: boolean;
  updatedById: string | null;
  updatedByName: string | null;
  completedAt: string | null;
  updatedAt: string;
  /** Per required doc type: linked files, live linked documents (in-app invoices), met or not. */
  requirements?: Array<{ docType: string; files: number; documents: number; satisfied: boolean }>;
  fieldRequirements?: Array<{ field: string; label: string; satisfied: boolean }>;
  /** Doesn't apply to this customer ("N/A (customer profile)"): collapsed, never blocks. */
  notApplicable?: boolean;
  skipReason?: string | null;
  /** "Sent" evidence (by hand or from an outgoing email); never blocks the step. */
  subtasks?: Subtask[] | null;
  /** Paying / receiving steps (1, 6, 8, 12; 2 / 11 receipts): amount, date, account, proof. {} = cleared. */
  payment?: StepPayment | Record<string, never> | null;
};

/** A step's payment (round H — the Payments module is retired). */
export type StepPayment = { amount: number; currency: string; paidAt: string; account: PaymentAccount; proofFileId: string | null };
/** Steps that carry a payment, with the proof's doc type and the default currency. */
export const STEP_PAYMENT: Record<string, { direction: "IN" | "OUT"; proofDocType: string; label: string; currency: "USD" | "JPY" }> = {
  PI_PAYMENT: { direction: "OUT", proofDocType: "DEPOSIT_PROOF", label: "Deposit paid", currency: "USD" },
  CI_PAYMENT: { direction: "OUT", proofDocType: "CI_PAYMENT_PROOF", label: "CI paid", currency: "USD" },
  TAX_FUNDS: { direction: "OUT", proofDocType: "PAYMENT_PROOF", label: "Import tax funded", currency: "JPY" },
  LOGISTICS_PAYMENT: { direction: "OUT", proofDocType: "PAYMENT_PROOF", label: "Transport & storage paid", currency: "JPY" },
  INVOICE_1: { direction: "IN", proofDocType: "PAYMENT_PROOF", label: "Invoice #1 received", currency: "USD" },
  INVOICE_2: { direction: "IN", proofDocType: "PAYMENT_PROOF", label: "Invoice received", currency: "USD" },
};
export const paymentOf = (st: Pick<TradeStep, "payment">): StepPayment | null => (st.payment && Number.isFinite(Number((st.payment as StepPayment).amount)) ? (st.payment as StepPayment) : null);

export type Subtask = { key: string; label: string; done: boolean; na?: boolean; at?: string | null; by?: string | null; source?: string | null; emailLogId?: string | null };

// ── Orders (Contract → Order "#19" → Shipment "#19-1") ──────────────────────
export type BillingMode = "TWO_STAGE" | "SINGLE";
export type CustomerProfile = {
  customerId: string;
  key?: string;
  label?: string;
  billingMode: BillingMode;
  sendImportPermit: boolean;
  port?: string;
  truckCapacityT: number;
  customsRatePerMt?: number;
  emailDomains?: string[];
  docVariants: { CUSTOMER_PL?: string; CUSTOMER_COA?: string; INVOICE?: string };
  deliveryProfile?: { siteName: string; address: string; notes: string } | null;
  invoiceRemarks?: string;
  /** 弊社指定口座 preselected on this customer's invoices (any entity's account). */
  defaultBankId?: string;
  /** Default bank not confirmed yet — shown as "check". */
  defaultBankCheck?: boolean;
  /** 宛先 on the Japanese PL / COA (blank = the legal name). */
  docAddressee?: string;
};
export type EstimatorRates = {
  taxMultiplier: number;
  customsPerMt: number;
  blFee: number;
  truckRates: Record<string, number>;
  storagePerContainer: number;
  storagePerMt: number;
  washingPerContainer: number;
  detentionPerContainer: number;
};
export type ShipmentCosts = {
  trucks?: number | null;
  customsRatePerMt?: number | null;
  truckCapacityT?: number | null;
  thc?: number | null;
  docFee?: number | null;
  equipmentFee?: number | null;
  storage?: number | null;
  storageContainers?: number | null;
  other?: number | null;
  cifUsd?: number | null;
  fxRate?: number | null;
  /** 加算運賃 (JPY); null = the A/N's EQMC. */
  customsAddOnJpy?: number | null;
  importTaxFunded?: number | null;
  importTaxActual?: number | null;
  actual?: Partial<Record<"customs" | "blFee" | "trucking" | "storage" | "washingContainers" | "detentionContainers" | "washing" | "detention" | "other", number | null>>;
};
export type Estimate = {
  qtyMt: number | null;
  grossMt: number | null;
  truckCapacityT: number;
  trucks: number | null;
  trucksSuggested: number | null;
  customsRatePerMt: number;
  customs: number | null;
  blFee: number;
  anCharges: number;
  customsTotal: number | null;
  truckRate: number;
  trucking: number | null;
  storage: number;
  other: number;
  total: number | null;
  importTax: {
    cifUsd: number | null;
    fxRate: number | null;
    cifJpy: number | null;
    addOnJpy: number;
    addOnSource: "typed" | "EQMC" | null;
    customsValue: number | null;
    taxBase: number | null;
    national: number | null;
    local: number | null;
    estimate: number | null;
    funded: number | null;
    actual: number | null;
    variance: number | null;
  };
};
export type ActualRow = { key: string; label: string; estimate: number | null; actual: number | null; variance: number | null };
export type ActualsTable = { rows: ActualRow[]; estimate: number; actual: number; variance: number };

export type OrderShipmentRow = {
  id: string;
  seqNo: number | null;
  ref: string;
  blNumber: string | null;
  vessel: string | null;
  voyageNo?: string | null;
  etd?: string | null;
  eta: string | null;
  netWeightMt?: Num;
  grossWeightMt?: Num;
  ciAmount?: Num;
  status: RecordStatus;
  progress: Progress;
  currentStep: CurrentStep;
};
export type OrderListItem = {
  id: string;
  year: number;
  orderNo: number;
  label: string;
  contractId: string | null;
  contractNo: string | null;
  customerId: string;
  supplierId: string;
  customerName: string | null;
  customer: Party | null;
  supplier: Party | null;
  shipMonth: string | null;
  deliveryMonth: string | null;
  monthsLabel: string;
  product: string | null;
  grade: string | null;
  size: string | null;
  qtyMt: Num;
  productLabel: string;
  clientPremium: Num;
  supplierPremium: Num;
  upcharge: Num;
  piNo: string | null;
  status: RecordStatus;
  shipmentCount: number;
  shipments: OrderShipmentRow[];
  progress: Progress;
  currentStep: CurrentStep;
};
export type Order = OrderListItem & {
  tolPct: Num;
  piDate: string | null;
  piAmount: Num;
  depositPct: Num;
  depositAmount: Num;
  depositDueDays: number | null;
  depositDueUnit: DepositDueUnit | null;
  depositDueDate: string | null;
  depositPaidAt: string | null;
  currency: string;
  incoterm: string | null;
  destinationPort: string | null;
  consignee: string | null;
  notifyParty: string | null;
  notes: string | null;
  updatedAt: string;
  contract: { id: string; contractNo: string; status: RecordStatus; qpBasis?: string | null; premiumSchedule?: PremiumRow[] | null; lines: ContractLine[] } | null;
  profile: CustomerProfile;
  /** The supplier's profile (no PI → step 1 N/A). */
  supplierProfile?: SupplierProfile | null;
  customerPoNo: string | null;
  /** Fields flagged "check" (imported from the task list / assumed): clientPremium, contractId, customerId. */
  checkFields?: string[];
  customerPoDate: string | null;
  steps: TradeStep[];
  fileLinks: RecordFileLink[];
  docLinks: RecordDocLink[];
};
export type OrderInput = Partial<{
  checkFields: string[];
  year: number;
  orderNo: number;
  contractId: string | null;
  customerId: string;
  supplierId: string;
  shipMonth: string | null;
  deliveryMonth: string | null;
  product: string | null;
  grade: string | null;
  size: string | null;
  qtyMt: number | null;
  tolPct: number | null;
  supplierPremium: number | null;
  clientPremium: number | null;
  upcharge: number | null;
  piNo: string | null;
  piDate: string | null;
  piAmount: number | null;
  depositPct: number | null;
  depositAmount: number | null;
  depositDueDays: number | null;
  depositDueUnit: DepositDueUnit | null;
  depositPaidAt: string | null;
  currency: string;
  incoterm: string | null;
  destinationPort: string | null;
  consignee: string | null;
  notifyParty: string | null;
  notes: string | null;
  customerPoNo: string | null;
  customerPoDate: string | null;
  piFileId: string;
  contractFileId: string;
  status: "CANCELLED";
}>;
export type OrderFilters = { bucket?: "pending" | "completed"; customerId?: string; contractId?: string; q?: string; page?: number; pageSize?: number };
/** Orders list month headers ("Sep 2026 — 4 orders, 600 MT"), counted over the whole filtered list. */
export type OrderMonth = { month: string | null; orders: number; qtyMt: number | null; label: string };
/** "+ New monthly order": one order per row. */
export type MonthlyOrderRow = { customerId: string; contractId: string; grade?: string | null; size?: string | null; qtyMt: number; clientPremium?: number | null; deliveryMonth?: string | null };
export type MonthlyOrderResult = { month: string; created: Array<{ id: string; label: string; customerName: string; grade: string | null; qtyMt: number | null }> };

// ── Supplier orders (Vedanta's PI; steps 0 / 1) ──────────────────────────
export type SupplierProfile = { supplierId: string; key?: string; label?: string; hasPI: boolean; shippingDocs?: string[] | null; emailDomains?: string[] };
export type SupplierOrderListItem = {
  id: string;
  year: number;
  soNo: number;
  label: string;
  supplierId: string;
  supplier: Party | null;
  contractId: string | null;
  contractNo: string | null;
  declarationMonth: string | null;
  product: string | null;
  grade: string | null;
  size: string | null;
  qtyMt: Num;
  qpBasis: string | null;
  provisionalPricePerMt: Num;
  supplierPremium: Num;
  currency: string;
  piNo: string | null;
  piDate: string | null;
  piAmount: Num;
  depositPct: Num;
  depositAmount: Num;
  depositPaidAt: string | null;
  status: RecordStatus;
  notes: string | null;
  customerOrders: Array<{ id: string; year: number; orderNo: number; label: string; status: RecordStatus; qtyMt: Num; customerName: string | null }>;
  progress: Progress;
  currentStep: CurrentStep;
};
export type SupplierOrder = Omit<SupplierOrderListItem, "customerOrders"> & {
  contract: { id: string; contractNo: string; status: RecordStatus; qpBasis: string | null; premiumSchedule: PremiumRow[] | null } | null;
  steps: TradeStep[];
  fileLinks: RecordFileLink[];
  supplierProfile: SupplierProfile;
  customerOrders: Array<{
    id: string;
    year: number;
    orderNo: number;
    label: string;
    status: RecordStatus;
    qtyMt: Num;
    grade: string | null;
    shipMonth: string | null;
    deliveryMonth: string | null;
    clientPremium: Num;
    customerName: string | null;
    shipments: Array<{ id: string; ref: string; blNumber: string | null; ciAmount: Num; ciNumber: string | null; status: RecordStatus; ciPayment: { status: string; title: string; displayNo: string | null; notApplicable: boolean } | null }>;
  }>;
  updatedAt: string;
};
/** The supplier side as embedded in an order (steps 0 / 1 with requirements, files). */
export type OrderSupplierSide = {
  id: string;
  year: number;
  soNo: number;
  label: string;
  piNo: string | null;
  piDate: string | null;
  piAmount: Num;
  depositPct: Num;
  depositAmount: Num;
  depositPaidAt: string | null;
  qpBasis: string | null;
  declarationMonth: string | null;
  status: RecordStatus;
  steps: TradeStep[];
  fileLinks: RecordFileLink[];
  supplierProfile: SupplierProfile;
  /** Other customer orders bought under the same supplier order. */
  sharedWith: string[];
};
export type SupplierOrderInput = Partial<{
  year: number;
  contractId: string | null;
  supplierId: string;
  declarationMonth: string | null;
  product: string | null;
  grade: string | null;
  size: string | null;
  qtyMt: number | null;
  qpBasis: string | null;
  provisionalPricePerMt: number | null;
  supplierPremium: number | null;
  currency: string;
  piNo: string | null;
  piDate: string | null;
  piAmount: number | null;
  depositPct: number | null;
  depositAmount: number | null;
  depositPaidAt: string | null;
  notes: string | null;
  customerOrderIds: string[];
  piFileId: string;
  status: "CANCELLED";
}>;
export type SupplierOrderFilters = { bucket?: "pending" | "completed"; supplierId?: string; contractId?: string; declarationMonth?: string; q?: string; page?: number; pageSize?: number };
export type DeclarationRow = { customerId: string; contractId: string; grade?: string | null; size?: string | null; qtyMt: number; clientPremium?: number | null; supplierPremium?: number | null; orderNo?: number; deliveryMonth?: string | null; piNo?: string | null };
/** Vedanta's PI table → the order each row fills (read-only plan). */
export type PiTablePlan = { rows: Array<{ row: NonNullable<InboxRow["supplierOrderSuggestions"]>[number]; month: string | null; orderId: string | null; orderLabel: string | null; fields: Record<string, string | number>; reason?: string }> };
export type DeclarationResult = { created: Array<{ supplierOrderId: string; orderId: string; orderLabel: string | null; customerName: string | null }> };
/** grade: the row applies to that grade only (a contract with two grades, e.g. Kato 6005 / 6063); blank = every grade. */
export type PremiumRow = { from: string; to: string | null; grade?: string | null; supplierPremium: number | null; clientPremium: number | null; upcharge: number | null };
// ── Alerts, dashboard, stock ───────────────────────────────────────────────
export type TradeAlert = { id: string; kind: string; key: string; dueAt: string; title: string; detail: string | null; shipmentId: string | null; orderId: string | null; supplierOrderId: string | null; linkUrl: string | null; status: "SCHEDULED" | "DUE" | "DONE" | "DISMISSED"; notifiedAt: string | null };
export type CellState = "done" | "in_progress" | "na" | "overdue" | "not_started" | "none";
export type Pipeline = { rows: Array<{ no: string; title: string }>; months: Array<{ month: string | null; orders: Array<{ id: string; label: string; customerName: string | null; status: RecordStatus; cells: Record<string, CellState> }> }> };
export type Money = {
  cashByMonth: Record<string, { in: Record<string, number>; out: Record<string, number> }>;
  orders: Array<{ id: string; label: string; customerName: string | null; deliveryMonth: string | null; status: RecordStatus; qtyMt: number | null; margin: number | null; profit: number | null; profitStatus: "MANUAL" | "FORMULA_PENDING" }>;
  byMonth: Record<string, { margin: number; profit: number; profitPending: boolean; orders: number }>;
  openCredits: Array<{ id: string; sourceNumber: string | null; amount: number; currency: string; customerName: string | null; createdAt: string }>;
};
export type StockLine = { shipmentId: string; ref: string; blNumber: string | null; customerName: string | null; warehouse: string; bundlesIn: number | null; bundlesDelivered: number; bundlesInStock: number | null; netMtIn: number | null; netMtInStock: number | null; storageStartDate: string | null; periods: number; storageFeeEstimate: number | null };
export type Stock = { ratePerMtPerPeriod: number; warehouses: Array<{ warehouse: string; bundlesInStock: number; netMtInStock: number; storageFeeEstimate: number; items: StockLine[] }> };

// ── Credits (negative Invoice #2 = credit note) and estimated costs ────────
export type TradeCredit = { id: string; customerId: string; sourceDocId: string; sourceNumber: string | null; amount: number; currency: string; status: "OPEN" | "USED" | "VOID"; usedByDocId: string | null; usedByNumber: string | null; usedAt: string | null; createdAt: string };
export type CostVariance = { invoiceId: string; number: string | null; costsBasis: string; estimatedUsd: number; actualJpy: number | null; fxRate: number | null; actualUsd: number | null; varianceUsd: number | null; complete: boolean };

// ── Payments (cash in / out) ───────────────────────────────────────────────
export type PaymentAccount = "DBS" | "WISE" | "CFSB" | "SMBC_JPY" | "OTHER";
export type AllocationTarget = "PI" | "CI" | "INVOICE" | "VENDOR_INVOICE" | "IMPORT_TAX";
export type PaymentAllocation = { id?: string; targetType: AllocationTarget; targetId: string | null; targetLabel?: string | null; amount: number; orderId?: string | null; shipmentId?: string | null; supplierOrderId?: string | null };
export type TradePayment = {
  id: string;
  direction: "IN" | "OUT";
  paidAt: string;
  amount: number;
  currency: string;
  account: PaymentAccount;
  counterpartyType: string | null;
  counterpartyId: string | null;
  counterpartyName: string | null;
  reference: string | null;
  notes: string | null;
  proofFileId: string | null;
  createdByName: string | null;
  createdAt: string;
  allocations: PaymentAllocation[];
  allocated: number;
  unallocated: number;
};
export type PaymentInput = {
  direction: "IN" | "OUT";
  paidAt: string;
  amount: number;
  currency: string;
  account: PaymentAccount;
  counterpartyType?: string | null;
  counterpartyName?: string | null;
  reference?: string | null;
  notes?: string | null;
  proofFileId?: string | null;
  allocations: PaymentAllocation[];
};
export type PaymentTarget = { targetType: AllocationTarget; targetId: string; label: string; currency: string; expected: number | null; paid: number; orderId: string | null; shipmentId: string | null };
export type PaymentFilters = { direction?: "IN" | "OUT"; account?: string; from?: string; to?: string; unallocated?: "true"; orderId?: string; q?: string; page?: number; pageSize?: number };
export type OrderCash = {
  orderId: string;
  cashOut: Array<{ paymentId: string; direction: "OUT"; paidAt: string; account: string; currency: string; reference: string | null; targetType: string; label: string; amount: number }>;
  cashIn: Array<{ paymentId: string; direction: "IN"; paidAt: string; account: string; currency: string; reference: string | null; targetType: string; label: string; amount: number }>;
  totals: { out: Record<string, number>; in: Record<string, number> };
  invoices: Array<{ id: string; docType: string; number: string | null; label: string; total: number; paid: number; outstanding: number; dueDate: string | null; overdue: boolean; daysOverdue: number }>;
};
export const ACCOUNT_LABEL: Record<PaymentAccount, string> = { DBS: "DBS (SG)", WISE: "Wise (SG)", CFSB: "CFSB (SG)", SMBC_JPY: "SMBC JPY (JP)", OTHER: "Other" };
export const TARGET_LABEL: Record<AllocationTarget, string> = { PI: "PI deposit", CI: "CI", INVOICE: "Customer invoice", VENDOR_INVOICE: "Vendor invoice", IMPORT_TAX: "Import tax" };

/** Expected vs found prices for a PI / CI / invoice (read-only check). */
export type PriceCheck = {
  side: "supplier" | "client";
  basisMonth: string | null;
  lines: Array<{ key: string; label: string; expected: number | null; found: number | null; diff: number | null; mark: "ok" | "diff" | "unknown" }>;
  ok: boolean;
  notes: string[];
  source: string;
};
export type Reconciliation = {
  orderId: string;
  label: string;
  /** Invoice #2 / single invoices issued on estimated costs (their variance shows on step 13). */
  estimatedInvoices?: Array<{ id: string; number: string | null; docType: string }>;
  a: number | null;
  b: number | null;
  c: number;
  d: number | null;
  profit: number | null;
  profitFormula: number | null;
  profitStatus: "MANUAL" | "FORMULA_PENDING";
  costs: { importTaxUsd: number | null; mitsuiUsd: number | null; otherUsd: number };
  importTax: { estimateJpy: number | null; actualJpy: number | null; varianceJpy: number | null; fxRate: number | null };
  docs: {
    invoice1: { number: string | null; goods: number; tax: number; total: number } | null;
    sgjpTotal: number | null;
    invoice2: { numbers: string[]; lines: Array<{ description: string; amount: number }>; total: number; tax: number; taxable: number; nonTaxable: number } | null;
    single: { number: string | null; total: number; tax: number } | null;
  };
  inputs: Record<string, number | string | null>;
};

/** Summary of an in-app Sales Document (invoice). */
export type DocSummary = {
  id: string;
  number: string | null;
  type: string;
  templateId: string;
  status: string;
  total: number | null;
  currency: string | null;
  date: string | null;
  customerName: string | null;
};

/** An in-app document linked to a contract/shipment as a trade doc type. */
export type RecordDocLink = {
  id: string;
  documentId: string;
  docType: string;
  stepId: string | null;
  contractId: string | null;
  shipmentId: string | null;
  createdAt: string;
  document: DocSummary | null;
  /** The finalized PDF of the in-app 請求書 behind this document (already in the files list). */
  inAppFileId?: string | null;
  /** deleted / voided / draft: shown, but doesn't count; only confirmed counts. */
  state: "deleted" | "voided" | "draft" | "confirmed";
  deleted: boolean;
  voided: boolean;
  satisfies: boolean;
};

export type GenColumn = { key: string; label: string; visible: boolean; kind?: "text" | "mt" | "number" };
export type GenRow = Record<string, string | number | null>;
export type GenRef = { key: string; label: string; value: string; visible: boolean };
export type GenHeader = {
  title: string;
  number?: string | null;
  letterhead: { name: string; address?: string | null; phone?: string | null; registrationNo?: string | null };
  /** 計量検収票 body: a page of Vedanta's container PL ("attach", Kato's layout) or the typed table. */
  bodyMode?: "attach" | "table";
  attachFileId?: string | null;
  attachPage?: number | null;
  attachCrop?: { top?: number; bottom?: number; auto?: boolean } | null;
  to: { name: string; address?: string | null };
  date: string;
  refs: GenRef[];
  /** "jp" = ADH's 計量検収票 / 納品書兼分析試験成績報告書 layout and its fields below. */
  layout?: "jp";
  formLabel?: string;
  toSuffix?: string;
  issuer?: { name: string; address: string; contact: string };
  invoiceNo?: string;
  plDate?: string;
  portOfDischarge?: string;
  goodsDescription?: string;
  origin?: string;
  hsCode?: string;
  applicant?: string;
  productLine?: string;
  sizeLine?: string;
  bundles?: number | null;
  piecesPerBundle?: number | null;
  weightUnit?: string;
  analysisDate?: string;
  vendor?: string;
  spec?: string | null;
  pieces?: number | null;
  remarks?: string | null;
};
/** GET /trade-generated/by-document/:documentId — the in-app 請求書 behind a Sales invoice. */
export type GeneratedForDocument = {
  id: string;
  docType: string;
  number: string | null;
  /** Document ID ("454003255-1-CPL"); the number printed on the PDF is `number`. */
  docRef?: string | null;
  status: "DRAFT" | "FINAL";
  documentId: string;
  finalFileId: string | null;
  contracts: Array<{ id: string; contractNo: string }>;
  shipments: Array<{ id: string; blNumber: string | null; contractNo: string | null }>;
};
export type GeneratedDoc = {
  id: string;
  /** Shipment documents; Invoice #1 belongs to a contract instead. */
  shipmentId: string | null;
  contractId: string | null;
  docType: "CUSTOMER_PL" | "CUSTOMER_COA" | "INVOICE_1" | "INVOICE_2" | "SGJP_IV_PL" | "SHIPPING_INSTRUCTIONS" | string;
  number: string | null;
  /** Document ID ("454003255-1-CPL"); the number printed on the PDF is `number`. */
  docRef?: string | null;
  status: "DRAFT" | "FINAL";
  /** Shape depends on the template (Customer PL / COA: GenHeader; others: their own forms). */
  header: any;
  columns: GenColumn[];
  rows: GenRow[];
  sourceFileId: string | null;
  finalFileId: string | null;
  /** Invoices: the Sales Document created on Finalize. */
  documentId: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  shipment?: { id: string; blNumber: string | null; status: RecordStatus; contractId: string | null; orderId?: string | null; seqNo?: number | null; order?: { orderNo: number } | null } | null;
  contract?: { id: string; contractNo: string; status: RecordStatus } | null;
  /** Order-level documents (Invoice #1). */
  orderId?: string | null;
  order?: { id: string; orderNo: number; year: number; status: RecordStatus } | null;
  /** Invoice #2 / single invoice: every shipment it bills ("#9-1, #9-2"). */
  coversShipmentIds?: string[];
  covers?: Array<{ id: string; blNumber: string | null; ref: string }>;
  /** Customer template variant (CUSTOMER_PL_KATO …) and whether its format is confirmed — shown in the editor only. */
  templateKey?: string | null;
  /** ADH_JP | ADH_SG — who issues it; a customer invoice can't be ADH_SG. */
  issuingEntity?: IssuingEntity | null;
  templateLabel?: string | null;
  formatConfirmed?: boolean;
  /** Only on create: what the import noticed (e.g. hidden empty columns). */
  importNotes?: string[];
};
/** A file a document can be made from; the server ranks them (best first) and says what each holds. */
export type GenSource = { id: string; fileName: string; createdAt: string; uploadedByName: string | null; kind?: string; label?: string; best?: boolean; docRef?: string | null };

export type HubLink = { contractId: string | null; shipmentId: string | null; orderId?: string | null; contractNo: string | null; blNumber: string | null; ref?: string | null; linkId?: string };
export type HubRow = {
  key: string;
  kind: "file" | "invoice" | "generated";
  id: string;
  category: string;
  docType: string;
  docTypeLabel: string;
  name: string;
  /** Document ID ("454003255-1-CPL"); null for linked Sales invoices. */
  docRef: string | null;
  source: "UPLOADED" | "IN_APP";
  /** ADH_JP | ADH_SG — the ADH company that issued it (null for supplier documents). */
  issuingEntity?: IssuingEntity | null;
  status: string | null;
  links: HubLink[];
  customerIds: string[];
  customerName: string | null;
  /** Addressee when it is not the customer (SI → warehouse, SG→JP → ADH Japan). */
  recipient: string | null;
  createdBy: string | null;
  date: string;
  fileId?: string | null;
  mimeType?: string | null;
  hasThumb?: boolean;
  document?: { id: string; type: string; templateId: string } | null;
  shipmentId?: string | null;
};
export type HubFilters = { category?: string; docType?: string; contractId?: string; shipmentId?: string; customerId?: string; source?: string; entity?: string; from?: string; to?: string; q?: string; page?: number; pageSize?: number };

/** A file link as embedded in a contract/shipment detail. */
export type RecordFileLink = {
  id: string;
  stepId: string | null;
  createdAt: string;
  file: { id: string; docType: string; fileName: string; mimeType: string; sizeBytes: number; uploadedByName: string | null; notes: string | null; createdAt: string; hasThumb?: boolean; docRef?: string | null };
};

export type ContractListItem = {
  id: string;
  contractNo: string;
  piNumber: string | null;
  lines: ContractLine[];
  /** "6063 · 300 MT", comma-joined per line. */
  linesSummary: string | null;
  totalQuantityMt: number | null;
  shipmentMonth: string | null;
  deliveryMonth: string | null;
  currency: string;
  status: RecordStatus;
  supplier: Party | null;
  customer: Party | null;
  shipmentCount: number;
  progress: Progress;
  currentStep: CurrentStep;
  createdAt: string;
};

export type Contract = ContractListItem & {
  supplierId: string;
  customerId: string;
  piDate: string | null;
  destinationPort: string | null;
  destinationCountry: string | null;
  incoterm: string | null;
  consignee: string | null;
  notifyParty: string | null;
  piAmount: Num;
  depositPercent: Num;
  depositAmount: Num;
  depositDueNote: string | null;
  depositDueDays: number | null;
  depositDueUnit: DepositDueUnit | null;
  /** PI date + the term (YYYY-MM-DD); null without a PI date or term. */
  depositDueDate: string | null;
  depositPaidAt: string | null;
  notes: string | null;
  updatedAt: string;
  shipments: Array<{
    id: string;
    blNumber: string | null;
    vessel: string | null;
    voyageNo?: string | null;
    etd: string | null;
    eta: string | null;
    netWeightMt?: Num;
    status: RecordStatus;
    contractLineId: string | null;
    createdAt?: string;
    progress: Progress;
    currentStep: CurrentStep;
  }>;
  steps: TradeStep[];
  fileLinks: RecordFileLink[];
  docLinks: RecordDocLink[];
  /** Orders under this contract (since orders, the contract is the yearly LTC master). */
  orders?: Array<{ id: string; year: number; orderNo: number; status: RecordStatus; shipMonth: string | null; deliveryMonth: string | null; grade: string | null; qtyMt: Num; clientPremium: Num; customer: Party | null }>;
  // ── Contract master (2026-10) ───────────────────────────────────────────
  periodStart?: string | null;
  periodEnd?: string | null;
  grade?: string | null;
  sizeSpec?: string | null;
  annualQtyMt?: Num;
  tolerancePct?: Num;
  balanceTerms?: string | null;
  qpBasis?: string | null;
  qmjpRule?: string | null;
  premiumSchedule?: PremiumRow[] | null;
  /** Fields ADH still has to confirm ("check"). */
  checkFields?: string[];
  supplierOrders?: Array<{ id: string; label: string; piNo: string | null; piAmount: Num; declarationMonth: string | null; grade: string | null; qtyMt: Num; status: RecordStatus }>;
  usage?: { orderedMt: number; annualQtyMt: number | null; remainingMt: number | null };
  /** Client − supplier premium this month (null when the schedule has no row). */
  marginNow?: number | null;
};

export type ShipmentListItem = {
  id: string;
  contractId: string | null;
  orderId?: string | null;
  seqNo?: number | null;
  /** "#19-1" (order-era shipments). */
  ref?: string;
  orderLabel?: string;
  order?: { id: string; year: number; orderNo: number; grade: string | null; product: string | null; size: string | null; qtyMt: Num } | null;
  blNumber: string | null;
  vessel: string | null;
  voyageNo: string | null;
  etd: string | null;
  eta: string | null;
  actualArrivalDate: string | null;
  netWeightMt?: Num;
  status: RecordStatus;
  createdAt: string;
  contract: { id: string; contractNo: string } | null;
  contractLine: ContractLine | null;
  customer: { id: string; name: string } | null;
  contractNo: string | null;
  customerName: string | null;
  /** "6063 · 152MM · 30 MT" */
  productLine: string | null;
  progress: Progress;
  currentStep: CurrentStep;
  /** Shipments list (round H). */
  carrier?: string | null;
  tab?: ShipmentTab;
  freeTime?: { from: "discharge" | "eta"; det: { ends: string; daysLeft: number }; dem: { ends: string; daysLeft: number } } | null;
};
export type ShipmentTab = "in_transit" | "arrived" | "delivered" | "completed";

export type Shipment = {
  id: string;
  contractId: string | null;
  /** Port / storage (alerts and stock). */
  dischargeDate?: string | null;
  detFreeDays?: number | null;
  demFreeDays?: number | null;
  warehouse?: string | null;
  storageStartDate?: string | null;
  /** "8/6 → 8/16 → 8/17" — the ETA history. */
  etaTrail?: string;
  /** The carrier (from the shipping line / B/L) and its tracking page. */
  carrier?: { code: string; name: string; url: string; prefilled: boolean } | null;
  orderId?: string | null;
  seqNo?: number | null;
  ref?: string;
  orderLabel?: string;
  order?: (Partial<OrderListItem> & { id: string; orderNo: number; year: number; customer?: Party | null }) | null;
  profile?: CustomerProfile;
  costs?: ShipmentCosts | null;
  estimate?: Estimate;
  actuals?: ActualsTable;
  contractLineId: string | null;
  customerId: string;
  blNumber: string | null;
  vessel: string | null;
  voyageNo: string | null;
  shippingLine: string | null;
  etd: string | null;
  /** "Latest ETA". */
  eta: string | null;
  actualArrivalDate: string | null;
  deliveryMonth: string | null;
  containerCount: number | null;
  telexReleaseCode: string | null;
  portOfLoading: string | null;
  portOfDischarge: string | null;
  netWeightMt: Num;
  grossWeightMt: Num;
  totalBundles: number | null;
  totalPieces: number | null;
  hsCode: string | null;
  countryOfOrigin: string | null;
  commodity: string | null;
  sizeSpec: string | null;
  ciNumber: string | null;
  ciAmount: Num;
  currency: string;
  notes: string | null;
  status: RecordStatus;
  createdAt: string;
  updatedAt: string;
  contract: {
    id: string;
    contractNo: string;
    piNumber: string | null;
    status: RecordStatus;
    deliveryMonth: string | null;
    lines: ContractLine[];
    supplier: Party | null;
    customer: Party | null;
  } | null;
  contractLine: ContractLine | null;
  productLine: string | null;
  customer: Party | null;
  steps: TradeStep[];
  fileLinks: RecordFileLink[];
  docLinks: RecordDocLink[];
  progress: Progress;
  currentStep: CurrentStep;
  blCheck: BlCheckSummary | null;
};

export type TradeFileLink = {
  id: string;
  contractId: string | null;
  shipmentId: string | null;
  orderId?: string | null;
  stepId: string | null;
  createdAt: string;
  contract: { contractNo: string } | null;
  shipment: { blNumber: string | null; seqNo?: number | null; order?: { orderNo: number } | null } | null;
  order?: { orderNo: number; year: number } | null;
};

export type TradeFile = {
  id: string;
  docType: string;
  docTypeLabel: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedById: string;
  uploadedByName: string | null;
  notes: string | null;
  createdAt: string;
  hasThumb?: boolean;
  /** Document ID ("454003255-1-PL-2"). */
  docRef?: string | null;
  links: TradeFileLink[];
};

export type DocType = { id: string; code: string; label: string; category: string; sortOrder: number; isActive: boolean };

export type Paged<T> = { items: T[]; total: number; page: number; pageSize: number; totalPages: number };

export type ContractInput = {
  periodStart?: string | null;
  periodEnd?: string | null;
  grade?: string | null;
  sizeSpec?: string | null;
  annualQtyMt?: number | null;
  tolerancePct?: number | null;
  balanceTerms?: string | null;
  qpBasis?: string | null;
  qmjpRule?: string | null;
  premiumSchedule?: PremiumRow[];
  checkFields?: string[];
  contractNo?: string;
  piNumber?: string | null;
  piDate?: string | null;
  supplierId?: string;
  customerId?: string;
  destinationPort?: string | null;
  destinationCountry?: string | null;
  incoterm?: string | null;
  shipmentMonth?: string | null;
  deliveryMonth?: string | null;
  currency?: string;
  consignee?: string | null;
  notifyParty?: string | null;
  /** A stored PI file to link to the new contract (Fill from PI). */
  piFileId?: string;
  piAmount?: number | null;
  depositPercent?: number | null;
  depositAmount?: number | null;
  depositDueNote?: string | null;
  depositDueDays?: number | null;
  depositDueUnit?: DepositDueUnit | null;
  depositPaidAt?: string | null;
  notes?: string | null;
  lines?: ContractLineInput[];
  status?: "CANCELLED";
};

export type ShipmentInput = {
  contractId?: string;
  orderId?: string;
  /** Estimator inputs + step 12 actuals (merged server-side). */
  costs?: ShipmentCosts;
  /** A stored B/L draft file to link to the new shipment (Fill from B/L draft). */
  blDraftFileId?: string;
  contractLineId?: string | null;
  blNumber?: string | null;
  vessel?: string | null;
  voyageNo?: string | null;
  shippingLine?: string | null;
  etd?: string | null;
  eta?: string | null;
  actualArrivalDate?: string | null;
  deliveryMonth?: string | null;
  containerCount?: number | null;
  telexReleaseCode?: string | null;
  portOfLoading?: string | null;
  portOfDischarge?: string | null;
  netWeightMt?: number | null;
  grossWeightMt?: number | null;
  totalBundles?: number | null;
  totalPieces?: number | null;
  hsCode?: string | null;
  countryOfOrigin?: string | null;
  commodity?: string | null;
  sizeSpec?: string | null;
  ciNumber?: string | null;
  ciAmount?: number | null;
  currency?: string;
  notes?: string | null;
  status?: "CANCELLED";
};

export type LinkTargets = { contractIds?: string[]; shipmentIds?: string[]; orderIds?: string[]; supplierOrderIds?: string[]; stepId?: string };

export type ContractFilters = { status?: string; supplierId?: string; customerId?: string; q?: string; page?: number; pageSize?: number };
export type ShipmentFilters = { status?: string; bucket?: "pending" | "completed"; tab?: ShipmentTab; contractId?: string; orderId?: string; customerId?: string; currentStep?: string; uninvoiced?: "true"; q?: string; page?: number; pageSize?: number };
export type FileFilters = { docType?: string; contractId?: string; shipmentId?: string; orderId?: string; supplierOrderId?: string; customerId?: string; q?: string; from?: string; to?: string; page?: number; pageSize?: number };

/** Mirrors the backend allow-list (shipments.rules.ts) for a quick client-side check. */
export const TRADE_FILE_MAX_BYTES = 25 * 1024 * 1024;
export const TRADE_FILE_EXTENSIONS = ["pdf", "png", "jpg", "jpeg", "webp", "xlsx", "xls", "csv", "docx", "doc", "msg", "eml"];

const qs = (params: Record<string, unknown>) => {
  const p = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  });
  const s = p.toString();
  return s ? `?${s}` : "";
};

/** Backend messages may be a string or a class-validator array. */
export const errorText = (m: unknown, fallback = "Something went wrong"): string => {
  if (Array.isArray(m)) return m.join(". ");
  if (typeof m === "string" && m) return m;
  if (m && typeof m === "object" && "message" in m) return errorText((m as { message: unknown }).message, fallback);
  return fallback;
};

export function useShipmentsApi() {
  const { getToken } = useAuth();

  return useMemo(() => {
    const call = async <T>(path: string, method: "GET" | "POST" | "PATCH" | "DELETE" = "GET", body: unknown = {}): Promise<T> => {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const res = await request({ path, method }, body, token);
      if (!res || res.success === false) throw new Error(errorText(res?.message, "Request failed"));
      return (res.data ?? res) as T;
    };

    /** GET /trade-generated/:id/pdf as a blob + its file name (Clerk token + admin org header). */
    const generatedPdf = async (id: string): Promise<{ blob: Blob; name: string }> => {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
      const activeOrgId = typeof window !== "undefined" ? window.sessionStorage.getItem("aims-admin-active-org") : null;
      if (activeOrgId) headers["X-Active-Org-Id"] = activeOrgId;
      try {
        const res = await axios.get(`${process.env.NEXT_PUBLIC_BACKEND_API_URL}/trade-generated/${id}/pdf`, { headers, responseType: "blob", timeout: 120000 });
        const cd = String(res.headers["content-disposition"] ?? "");
        const name = decodeURIComponent(/filename\*=UTF-8''([^;]+)/i.exec(cd)?.[1] ?? "document.pdf");
        return { blob: new Blob([res.data as Blob], { type: "application/pdf" }), name };
      } catch (e: any) {
        throw new Error(e?.response?.status === 404 ? "Document not found" : e?.message || "Could not download the PDF");
      }
    };

    // Multipart POST with the Clerk token + admin org header (like uploadFile).
    const postExtract = async <T>(kind: "pi" | "bl-draft" | "an" | "import-permit", input: { file?: File; fileId?: string; shipmentId?: string; contractId?: string }): Promise<T> => {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const form = new FormData();
      if (input.file) form.append("file", input.file);
      for (const k of ["fileId", "shipmentId", "contractId"] as const) if (input[k]) form.append(k, input[k]!);
      const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
      const activeOrgId = typeof window !== "undefined" ? window.sessionStorage.getItem("aims-admin-active-org") : null;
      if (activeOrgId) headers["X-Active-Org-Id"] = activeOrgId;
      try {
        const res = await axios.post(`${process.env.NEXT_PUBLIC_BACKEND_API_URL}/trade-extract/${kind}`, form, { headers, timeout: 180000 });
        return (res.data?.data ?? res.data) as T;
      } catch (e: any) {
        if (e?.response?.status === 413) throw new Error("File is larger than 25 MB");
        throw new Error(errorText(e?.response?.data?.message ?? e?.message, "Could not read the document"));
      }
    };

    return {
      // ── Contracts ────────────────────────────────────────────────────────
      listContracts: (f: ContractFilters = {}) => call<Paged<ContractListItem>>(`/contracts${qs(f)}`),
      getContract: (id: string) => call<Contract>(`/contracts/${id}`),
      createContract: (body: ContractInput) => call<Contract>(`/contracts`, "POST", body),
      updateContract: (id: string, body: ContractInput) => call<Contract>(`/contracts/${id}`, "PATCH", body),
      deleteContract: (id: string) => call<{ id: string; deleted: boolean }>(`/contracts/${id}`, "DELETE"),
      /** PI date + term → due date (business days skip Japanese bank holidays). */
      depositDue: (piDate: string, days: number, unit: DepositDueUnit) => call<{ dueDate: string | null }>(`/contracts/deposit-due${qs({ piDate, days, unit })}`),
      completeContract: (id: string) => call<Contract>(`/contracts/${id}/complete`, "POST"),
      reopenContract: (id: string) => call<Contract>(`/contracts/${id}/reopen`, "POST"),

      // ── Orders ───────────────────────────────────────────────────────────
      listOrders: (f: OrderFilters = {}) => call<Paged<OrderListItem> & { counts?: { pending: number; completed: number }; months?: OrderMonth[] }>(`/trade-orders${qs(f)}`),
      createMonthlyOrders: (body: { month: string; rows: MonthlyOrderRow[] }) => call<MonthlyOrderResult>(`/trade-orders/monthly`, "POST", body),
      getOrder: (id: string) => call<Order>(`/trade-orders/${id}`),
      nextOrderNo: (year?: number) => call<{ year: number; orderNo: number }>(`/trade-orders/next-no${qs({ year })}`),
      createOrder: (body: OrderInput) => call<Order>(`/trade-orders`, "POST", body),
      listSupplierOrders: (f: SupplierOrderFilters = {}) => call<Paged<SupplierOrderListItem> & { counts?: { pending: number; completed: number } }>(`/supplier-orders${qs(f)}`),
      getSupplierOrder: (id: string) => call<SupplierOrder>(`/supplier-orders/${id}`),
      createSupplierOrder: (body: SupplierOrderInput) => call<SupplierOrder>(`/supplier-orders`, "POST", body),
      updateSupplierOrder: (id: string, body: SupplierOrderInput) => call<SupplierOrder>(`/supplier-orders/${id}`, "PATCH", body),
      deleteSupplierOrder: (id: string) => call<{ id: string; deleted: boolean }>(`/supplier-orders/${id}`, "DELETE"),
      linkSupplierOrder: (id: string, orderIds: string[]) => call<SupplierOrder>(`/supplier-orders/${id}/link`, "POST", { orderIds }),
      unlinkSupplierOrder: (id: string, orderId: string) => call<SupplierOrder>(`/supplier-orders/${id}/link/${orderId}`, "DELETE"),
      completeSupplierOrder: (id: string) => call<SupplierOrder>(`/supplier-orders/${id}/complete`, "POST"),
      reopenSupplierOrder: (id: string) => call<SupplierOrder>(`/supplier-orders/${id}/reopen`, "POST"),
      declare: (body: { month: string; qpBasis?: string | null; rows: DeclarationRow[] }) => call<DeclarationResult>(`/supplier-orders/declaration`, "POST", body),
      priceCheck: (kind: "order" | "supplier-order" | "shipment" | "generated", id: string) => call<PriceCheck>(`/trade-price-check/${kind}/${id}`),
      credits: (f: { customerId?: string; status?: string; forDocId?: string } = {}) => call<TradeCredit[]>(`/trade-generated/credits${qs(f)}`),
      alerts: (f: { status?: string; shipmentId?: string; orderId?: string } = {}) => call<TradeAlert[]>(`/trade-alerts${qs(f)}`),
      myTasks: () => call<TradeAlert[]>(`/trade-alerts/my-tasks`),
      refreshAlerts: () => call<{ planned: number; created: number; updated: number; notified: number }>(`/trade-alerts/refresh`, "POST"),
      alertDone: (id: string) => call<TradeAlert>(`/trade-alerts/${id}/done`, "POST"),
      alertDismiss: (id: string) => call<TradeAlert>(`/trade-alerts/${id}/dismiss`, "POST"),
      pipeline: () => call<Pipeline>(`/trade-dashboard/pipeline`),
      money: () => call<Money>(`/trade-dashboard/money`),
      stock: () => call<Stock>(`/trade-dashboard/stock`),
      applyCredit: (id: string, creditId: string) => call<GeneratedDoc>(`/trade-generated/${id}/apply-credit`, "POST", { creditId }),
      costVariance: (id: string) => call<CostVariance>(`/trade-generated/${id}/cost-variance`),
      issueAdjustment: (id: string) => call<GeneratedDoc>(`/trade-generated/${id}/adjustment`, "POST"),
      setDelivered: (id: string, rowIndex: number, delivered: boolean) => call<GeneratedDoc>(`/trade-generated/${id}/delivered`, "POST", { rowIndex, delivered }),
      listPayments: (f: PaymentFilters = {}) => call<Paged<TradePayment>>(`/trade-payments${qs(f)}`),
      paymentTargets: (direction?: "IN" | "OUT", q?: string) => call<PaymentTarget[]>(`/trade-payments/targets${qs({ direction, q })}`),
      orderCash: (orderId: string) => call<OrderCash>(`/trade-payments/order/${orderId}`),
      createPayment: (body: PaymentInput) => call<TradePayment>(`/trade-payments`, "POST", body),
      updatePayment: (id: string, body: Partial<PaymentInput>) => call<TradePayment>(`/trade-payments/${id}`, "PATCH", body),
      deletePayment: (id: string) => call<{ id: string; deleted: boolean }>(`/trade-payments/${id}`, "DELETE"),
      updateOrder: (id: string, body: OrderInput) => call<Order>(`/trade-orders/${id}`, "PATCH", body),
      deleteOrder: (id: string) => call<{ id: string; deleted: boolean }>(`/trade-orders/${id}`, "DELETE"),
      completeOrder: (id: string) => call<Order>(`/trade-orders/${id}/complete`, "POST"),
      reopenOrder: (id: string) => call<Order>(`/trade-orders/${id}/reopen`, "POST"),
      /** "Add shipment": the next B/L under the order (#19-2), B/L pending. */
      addOrderShipment: (id: string, body: ShipmentInput = {}) => call<Shipment>(`/trade-orders/${id}/shipments`, "POST", body),
      reconciliation: (id: string) => call<Reconciliation>(`/trade-orders/${id}/reconciliation`),
      updateReconciliation: (id: string, body: Record<string, number | string | null>) => call<Reconciliation>(`/trade-orders/${id}/reconciliation`, "PATCH", body),

      // ── Shipments ────────────────────────────────────────────────────────
      listShipments: (f: ShipmentFilters = {}) => call<Paged<ShipmentListItem> & { counts?: { pending: number; completed: number }; tabs?: Record<ShipmentTab, number> }>(`/shipments${qs(f)}`),
      getShipment: (id: string) => call<Shipment>(`/shipments/${id}`),
      createShipment: (body: ShipmentInput) => call<Shipment>(`/shipments`, "POST", body),
      updateShipment: (id: string, body: ShipmentInput) => call<Shipment>(`/shipments/${id}`, "PATCH", body),
      deleteShipment: (id: string) => call<{ id: string; deleted: boolean }>(`/shipments/${id}`, "DELETE"),
      completeShipment: (id: string) => call<Shipment>(`/shipments/${id}/complete`, "POST"),
      /** reopenedContract: the contract no. when its COMPLETED contract was reopened with it. */
      reopenShipment: (id: string) => call<Shipment & { reopenedContract?: string | null }>(`/shipments/${id}/reopen`, "POST"),

      // ── Steps ────────────────────────────────────────────────────────────
      startStep: (id: string) => call<TradeStep>(`/trade-steps/${id}/start`, "POST"),
      completeStep: (id: string) => call<TradeStep>(`/trade-steps/${id}/complete`, "POST"),
      setStepPayment: (id: string, payment: Omit<StepPayment, "currency"> & { currency?: string } | null) => call<TradeStep>(`/trade-steps/${id}/payment`, "POST", { payment }),
      reopenStep: (id: string) => call<TradeStep>(`/trade-steps/${id}/reopen`, "POST"),
      setSubtask: (id: string, key: string, done: boolean) => call<TradeStep>(`/trade-steps/${id}/subtasks/${encodeURIComponent(key)}`, "POST", { done }),

      // ── Files ────────────────────────────────────────────────────────────
      listFiles: (f: FileFilters = {}) => call<Paged<TradeFile>>(`/trade-files${qs(f)}`),
      /** The stored file's bytes (the in-app viewer renders PDFs / images from them). */
      fileContent: async (id: string): Promise<Blob> => {
        const token = await getToken();
        if (!token) throw new Error("Not signed in");
        const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
        const activeOrgId = typeof window !== "undefined" ? window.sessionStorage.getItem("aims-admin-active-org") : null;
        if (activeOrgId) headers["X-Active-Org-Id"] = activeOrgId;
        try {
          const res = await axios.get(`${process.env.NEXT_PUBLIC_BACKEND_API_URL}/trade-files/${id}/content`, { headers, responseType: "blob", timeout: 120000 });
          return res.data as Blob;
        } catch (e: any) {
          throw new Error(errorText(e?.response?.status === 404 ? "File not found" : e?.message, "Could not open the file"));
        }
      },
      fileUrl: (id: string) => call<{ url: string; fileName: string; mimeType: string; expiresIn: number }>(`/trade-files/${id}/url`),
      /** Signed URL of the file's thumbnail; url null = none (Office / Outlook files, or not rendered). */
      fileThumb: (id: string) => call<{ url: string | null; expiresIn: number }>(`/trade-files/${id}/thumb`),
      addLinks: (id: string, t: LinkTargets) => call<TradeFile>(`/trade-files/${id}/links`, "POST", t),
      removeLink: (id: string, linkId: string) => call<TradeFile>(`/trade-files/${id}/links/${linkId}`, "DELETE"),
      deleteFile: (id: string) => call<{ id: string; deleted: boolean }>(`/trade-files/${id}`, "DELETE"),
      uploadFile: async (
        input: { file: File; docType: string; notes?: string; replacesFileId?: string } & LinkTargets,
        onProgress?: (pct: number) => void,
      ): Promise<TradeFile & { completedSteps?: string[] }> => {
        const token = await getToken();
        if (!token) throw new Error("Not signed in");
        const form = new FormData();
        form.append("file", input.file);
        form.append("docType", input.docType);
        if (input.contractIds?.length) form.append("contractIds", JSON.stringify(input.contractIds));
        if (input.shipmentIds?.length) form.append("shipmentIds", JSON.stringify(input.shipmentIds));
        if (input.orderIds?.length) form.append("orderIds", JSON.stringify(input.orderIds));
        if (input.supplierOrderIds?.length) form.append("supplierOrderIds", JSON.stringify(input.supplierOrderIds));
        if (input.stepId) form.append("stepId", input.stepId);
        if (input.notes?.trim()) form.append("notes", input.notes.trim());
        // Replace: the new file keeps the replaced one's document ID.
        if (input.replacesFileId) form.append("replacesFileId", input.replacesFileId);
        const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
        const activeOrgId = typeof window !== "undefined" ? window.sessionStorage.getItem("aims-admin-active-org") : null;
        if (activeOrgId) headers["X-Active-Org-Id"] = activeOrgId;
        try {
          const res = await axios.post(`${process.env.NEXT_PUBLIC_BACKEND_API_URL}/trade-files`, form, {
            headers,
            timeout: 120000,
            onUploadProgress: (e) => onProgress?.(e.total ? Math.round((e.loaded / e.total) * 100) : 0),
          });
          return (res.data?.data ?? res.data) as TradeFile & { completedSteps?: string[] };
        } catch (e: any) {
          const status = e?.response?.status;
          if (status === 413) throw new Error("File is larger than 25 MB");
          throw new Error(errorText(e?.response?.data?.message ?? e?.message, "Upload failed"));
        }
      },

      // ── AI extraction ────────────────────────────────────────────────────
      /** Read a PI (new PDF or an uploaded PI file) into a contract draft. ~10 s. */
      extractPi: (input: { file?: File; fileId?: string }) => postExtract<PiExtraction>("pi", input),
      /** Read a B/L draft into a shipment draft (+ checks when shipmentId is given). ~15 s. */
      extractBlDraft: (input: { file?: File; fileId?: string; shipmentId?: string; contractId?: string }) => postExtract<BlExtraction>("bl-draft", input),
      extractAn: (input: { file?: File; fileId?: string; shipmentId?: string }) => postExtract<AnExtraction>("an", input),
      extractImportPermit: (input: { file?: File; fileId?: string; shipmentId?: string }) => postExtract<PermitExtraction>("import-permit", input),
      /** Bulk upload with AI sorting: which of the step's types is this file? Nothing is stored. */
      classifyFile: async (file: File, docTypes: string[], shipmentId?: string): Promise<FileClassification> => {
        const token = await getToken();
        if (!token) throw new Error("Not signed in");
        const form = new FormData();
        form.append("file", file);
        form.append("docTypes", JSON.stringify(docTypes));
        // A non-Vedanta supplier's documents are sorted by content, not file name.
        if (shipmentId) form.append("shipmentId", shipmentId);
        const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
        const activeOrgId = typeof window !== "undefined" ? window.sessionStorage.getItem("aims-admin-active-org") : null;
        if (activeOrgId) headers["X-Active-Org-Id"] = activeOrgId;
        try {
          const res = await axios.post(`${process.env.NEXT_PUBLIC_BACKEND_API_URL}/trade-extract/classify`, form, { headers, timeout: 120000 });
          return (res.data?.data ?? res.data) as FileClassification;
        } catch (e: any) {
          if (e?.response?.status === 413) throw new Error("File is larger than 25 MB");
          throw new Error(errorText(e?.response?.data?.message ?? e?.message, "Could not read the file"));
        }
      },
      getExtraction: (id: string) => call<Extraction>(`/trade-extract/${id}`),
      acknowledgeExtraction: (id: string) => call<Extraction>(`/trade-extract/${id}/acknowledge`, "POST"),
      /** Cancelled Fill from PI / B/L draft: remove the unsaved source PDF (server refuses once it is attached). */
      discardSource: (fileId: string) => call<{ id: string; deleted: boolean }>(`/trade-extract/source/${fileId}`, "DELETE"),

      // ── In-app documents (invoices) ──────────────────────────────────────
      linkDocument: (body: { documentId: string; docType: string; stepId?: string } & LinkTargets) => call<RecordDocLink[]>(`/trade-documents/links`, "POST", body),
      unlinkDocument: (linkId: string) => call<{ id: string; deleted: boolean }>(`/trade-documents/links/${linkId}`, "DELETE"),
      searchInvoices: (q: string) => call<DocSummary[]>(`/trade-documents/invoices${qs({ q })}`),

      // ── In-app generated documents (Customer PL / COA) ────────────────────
      generatedFor: (shipmentId: string) => call<GeneratedDoc[]>(`/trade-generated${qs({ shipmentId })}`),
      generatedForContract: (contractId: string) => call<GeneratedDoc[]>(`/trade-generated${qs({ contractId })}`),
      generatedForOrder: (orderId: string) => call<GeneratedDoc[]>(`/trade-generated${qs({ orderId })}`),
      /** A blank document of any template, prefilled from its shipment (or order for Invoice #1); Invoice #2 / single invoice may cover several shipments. */
      createBlankGenerated: (body: { docType: string; shipmentId?: string; contractId?: string; orderId?: string; coversShipmentIds?: string[] }) => call<GeneratedDoc>(`/trade-generated/blank`, "POST", body),
      /** Invoice #2 / single invoice: the estimator's cost lines (JPY + USD at the FX) — only fills lines the user hasn't typed. */
      costSuggestion: (id: string, fxRate?: number | null) =>
        call<{ fxRate: number | null; shipments: number; taxableJpy: number; nonTaxableJpy: number; taxableUsd: number | null; nonTaxableUsd: number | null }>(`/trade-generated/${id}/cost-suggestion${qs({ fxRate: fxRate ?? undefined })}`),
      /** Download PDF: the stored PDF when final, else a render of the draft (no watermark). Saves it to the user's downloads. */
      downloadGeneratedPdf: async (id: string) => {
        const { blob, name } = await generatedPdf(id);
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
        return name;
      },
      /** "Download shipment folder (.zip)": the shipment's files, named after ADH's folder convention. */
      downloadShipmentZip: async (shipmentId: string) => {
        const token = await getToken();
        if (!token) throw new Error("Not signed in");
        const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
        const activeOrgId = typeof window !== "undefined" ? window.sessionStorage.getItem("aims-admin-active-org") : null;
        if (activeOrgId) headers["X-Active-Org-Id"] = activeOrgId;
        const res = await axios.get(`${process.env.NEXT_PUBLIC_BACKEND_API_URL}/trade-files/shipment/${shipmentId}/zip`, { headers, responseType: "blob", timeout: 180000 });
        const cd = String(res.headers["content-disposition"] ?? "");
        const name = decodeURIComponent(/filename\*=UTF-8''([^;]+)/i.exec(cd)?.[1] ?? "shipment.zip");
        const url = URL.createObjectURL(new Blob([res.data as Blob], { type: "application/zip" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
        return name;
      },
      /** The PDF as a blob (same rules as Download PDF), for showing in the page. */
      generatedPdf,
      /** The in-app 請求書 behind a Sales invoice, with the contracts / shipments it bills. */
      generatedByDocument: (documentId: string) => call<GeneratedForDocument>(`/trade-generated/by-document/${documentId}`),
      generatedSources: (shipmentId: string, docType: string) => call<GenSource[]>(`/trade-generated/sources${qs({ shipmentId, docType })}`),
      createGenerated: (body: { shipmentId: string; docType: string; sourceFileId: string }) => call<GeneratedDoc>(`/trade-generated`, "POST", body),
      getGenerated: (id: string) => call<GeneratedDoc>(`/trade-generated/${id}`),
      updateGenerated: (id: string, body: { header?: GenHeader; columns?: GenColumn[]; rows?: GenRow[]; issuingEntity?: IssuingEntity }) => call<GeneratedDoc>(`/trade-generated/${id}`, "PATCH", body),
      /** 請求書 due date for an issue date (the org's business days, Japanese bank holidays skipped). */
      invoiceDueDate: (issueDate: string, docType?: string) => call<{ issueDate: string; dueDate: string; businessDays: number }>(`/trade-generated/due-date${qs({ issueDate, docType })}`),
      previewGenerated: (body: { docType: string; header: any; columns: any[]; rows: any[]; draft?: boolean }) => call<{ html: string }>(`/trade-generated/preview`, "POST", body),
      finalizeGenerated: (id: string) => call<GeneratedDoc>(`/trade-generated/${id}/finalize`, "POST"),
      revertGenerated: (id: string) => call<GeneratedDoc>(`/trade-generated/${id}/revert`, "POST"),
      deleteGenerated: (id: string) => call<{ id: string; deleted: boolean }>(`/trade-generated/${id}`, "DELETE"),

      // ── Documents hub ────────────────────────────────────────────────────
      hub: (f: HubFilters = {}) => call<Paged<HubRow> & { categoryCounts: Record<string, number>; allCount: number }>(`/trade-hub${qs(f)}`),

      // ── Config + parties ─────────────────────────────────────────────────
      docTypes: () => call<DocType[]>(`/trade-config/doc-types`),
      stepTemplates: (scope?: "CONTRACT" | "SHIPMENT" | "ORDER") => call<StepTemplate[]>(`/trade-config/step-templates${qs({ scope })}`),
      settings: () => call<TradeSettings>(`/trade-config/settings`),
      emailIntake: () => call<EmailIntake>(`/email-intake`),
      // ── Email inbox (triage → process) ─────────────────────────────────
      inbox: (tab: InboxTab) => call<{ items: InboxRow[]; counts: Record<InboxTab, number> }>(`/email-inbox${qs({ tab })}`),
      inboxAccept: (id: string) => call<InboxRow>(`/email-inbox/${id}/accept`, "POST"),
      inboxAssign: (id: string, body: { orderId?: string | null; shipmentId?: string | null }) => call<InboxRow>(`/email-inbox/${id}/assign`, "POST", body),
      inboxUndo: (id: string) => call<InboxRow>(`/email-inbox/${id}/undo`, "POST"),
      inboxDismiss: (id: string) => call<{ id: string; purged: boolean }>(`/email-inbox/${id}/dismiss`, "POST"),
      inboxRetriage: (id: string) => call<InboxRow>(`/email-inbox/${id}/retriage`, "POST"),
      inboxPiTable: (id: string) => call<PiTablePlan>(`/email-inbox/${id}/pi-table-plan`),
      inboxApplyPiTable: (id: string) => call<{ results: NonNullable<InboxRow["supplierOrderResults"]>; row: InboxRow }>(`/email-inbox/${id}/pi-table`, "POST"),
      /** Short-lived link to a stored email's .eml, or attachment n. */
      emailIntakeFile: (id: string, attachment?: number) => call<{ url: string }>(`/email-intake/${id}/file${qs({ attachment })}`),
      updateSettings: (body: {
        defaultConsignee?: string | null;
        defaultNotifyParty?: string | null;
        docDefaults?: Record<string, unknown>;
        customerProfiles?: Record<string, Partial<CustomerProfile> | null>;
        supplierProfiles?: Record<string, Partial<SupplierProfile> | null>;
        estimatorRates?: Partial<EstimatorRates>;
        alertRules?: Partial<AlertRules>;
      }) => call<TradeSettings>(`/trade-config/settings`, "PATCH", body),
      suppliers: async () => {
        const r = await call<{ docs?: Party[] }>(`/suppliers`, "POST", { page: 1, limit: 500, search: "" });
        return r.docs ?? [];
      },
      customers: async () => {
        const r = await call<{ docs?: Party[] }>(`/customers`, "POST", { page: 1, limit: 500, search: "", filters: {} });
        return r.docs ?? [];
      },
    };
  }, [getToken]);
}

export type ShipmentsApi = ReturnType<typeof useShipmentsApi>;

/** A record a file / invoice is linked to (the pickers' options). */
export type TargetKind = "contract" | "shipment" | "order" | "supplierOrder";
/** Split picked records into the API's id lists. */
export const linkTargetsOf = (targets: Array<{ kind: TargetKind; id: string }>): LinkTargets => ({
  contractIds: targets.filter((t) => t.kind === "contract").map((t) => t.id),
  shipmentIds: targets.filter((t) => t.kind === "shipment").map((t) => t.id),
  orderIds: targets.filter((t) => t.kind === "order").map((t) => t.id),
  supplierOrderIds: targets.filter((t) => t.kind === "supplierOrder").map((t) => t.id),
});
export const targetGroup = (k: TargetKind) => (k === "order" ? "Orders" : k === "supplierOrder" ? "Supplier orders" : k === "contract" ? "Contracts" : "Shipments");

/** Files-tab count: every file, plus linked documents that aren't already listed as their in-app PDF. */
export function recordFileCount(r: { fileLinks: RecordFileLink[]; docLinks?: RecordDocLink[] }): number {
  const fileIds = new Set(r.fileLinks.map((l) => l.file.id));
  return r.fileLinks.length + (r.docLinks ?? []).filter((l) => !l.inAppFileId || !fileIds.has(l.inAppFileId)).length;
}
