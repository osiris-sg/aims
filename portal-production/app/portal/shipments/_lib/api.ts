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
  notes?: string | null;
};
export type BankAccount = { id: string; label: string; block: string };
export type DeliveryProfile = { id: string; customerName: string; siteName: string; address: string; notes: string };
/** Org texts for in-app documents (TradeSetting.docDefaults) — every key optional. */
export type DocDefaults = Record<string, any> & {
  banks?: BankAccount[];
  defaultBankId?: string;
  sealImage?: string;
  deliveryProfiles?: DeliveryProfile[];
  sizeInch?: Record<string, string>;
};
export type TradeSettings = { defaultConsignee: string | null; defaultNotifyParty: string | null; docDefaults: DocDefaults; updatedAt: string | null };
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
  kind: "PI" | "BL_DRAFT";
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
  shipment?: { id: string; blNumber: string | null; status: RecordStatus; contractId: string } | null;
  contract?: { id: string; contractNo: string; status: RecordStatus } | null;
  /** Only on create: what the import noticed (e.g. hidden empty columns). */
  importNotes?: string[];
};
export type GenSource = { id: string; fileName: string; createdAt: string; uploadedByName: string | null };

export type HubLink = { contractId: string | null; shipmentId: string | null; contractNo: string | null; blNumber: string | null; linkId?: string };
export type HubRow = {
  key: string;
  kind: "file" | "invoice" | "generated";
  id: string;
  category: string;
  docType: string;
  docTypeLabel: string;
  name: string;
  source: "UPLOADED" | "IN_APP";
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
export type HubFilters = { category?: string; docType?: string; contractId?: string; shipmentId?: string; customerId?: string; source?: string; from?: string; to?: string; q?: string; page?: number; pageSize?: number };

/** A file link as embedded in a contract/shipment detail. */
export type RecordFileLink = {
  id: string;
  stepId: string | null;
  createdAt: string;
  file: { id: string; docType: string; fileName: string; mimeType: string; sizeBytes: number; uploadedByName: string | null; notes: string | null; createdAt: string; hasThumb?: boolean };
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
};

export type ShipmentListItem = {
  id: string;
  contractId: string;
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
};

export type Shipment = {
  id: string;
  contractId: string;
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
  stepId: string | null;
  createdAt: string;
  contract: { contractNo: string } | null;
  shipment: { blNumber: string | null } | null;
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
  links: TradeFileLink[];
};

export type DocType = { id: string; code: string; label: string; category: string; sortOrder: number; isActive: boolean };

export type Paged<T> = { items: T[]; total: number; page: number; pageSize: number; totalPages: number };

export type ContractInput = {
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

export type LinkTargets = { contractIds?: string[]; shipmentIds?: string[]; stepId?: string };

export type ContractFilters = { status?: string; supplierId?: string; customerId?: string; q?: string; page?: number; pageSize?: number };
export type ShipmentFilters = { status?: string; contractId?: string; customerId?: string; currentStep?: string; q?: string; page?: number; pageSize?: number };
export type FileFilters = { docType?: string; contractId?: string; shipmentId?: string; customerId?: string; q?: string; from?: string; to?: string; page?: number; pageSize?: number };

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
    const postExtract = async <T>(kind: "pi" | "bl-draft", input: { file?: File; fileId?: string; shipmentId?: string; contractId?: string }): Promise<T> => {
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

      // ── Shipments ────────────────────────────────────────────────────────
      listShipments: (f: ShipmentFilters = {}) => call<Paged<ShipmentListItem>>(`/shipments${qs(f)}`),
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
      reopenStep: (id: string) => call<TradeStep>(`/trade-steps/${id}/reopen`, "POST"),

      // ── Files ────────────────────────────────────────────────────────────
      listFiles: (f: FileFilters = {}) => call<Paged<TradeFile>>(`/trade-files${qs(f)}`),
      fileUrl: (id: string) => call<{ url: string; fileName: string; mimeType: string; expiresIn: number }>(`/trade-files/${id}/url`),
      /** Signed URL of the file's thumbnail; url null = none (Office / Outlook files, or not rendered). */
      fileThumb: (id: string) => call<{ url: string | null; expiresIn: number }>(`/trade-files/${id}/thumb`),
      addLinks: (id: string, t: LinkTargets) => call<TradeFile>(`/trade-files/${id}/links`, "POST", t),
      removeLink: (id: string, linkId: string) => call<TradeFile>(`/trade-files/${id}/links/${linkId}`, "DELETE"),
      deleteFile: (id: string) => call<{ id: string; deleted: boolean }>(`/trade-files/${id}`, "DELETE"),
      uploadFile: async (
        input: { file: File; docType: string; notes?: string } & LinkTargets,
        onProgress?: (pct: number) => void,
      ): Promise<TradeFile & { completedSteps?: string[] }> => {
        const token = await getToken();
        if (!token) throw new Error("Not signed in");
        const form = new FormData();
        form.append("file", input.file);
        form.append("docType", input.docType);
        if (input.contractIds?.length) form.append("contractIds", JSON.stringify(input.contractIds));
        if (input.shipmentIds?.length) form.append("shipmentIds", JSON.stringify(input.shipmentIds));
        if (input.stepId) form.append("stepId", input.stepId);
        if (input.notes?.trim()) form.append("notes", input.notes.trim());
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
      /** A blank document of any template, prefilled from its shipment (or contract for Invoice #1). */
      createBlankGenerated: (body: { docType: string; shipmentId?: string; contractId?: string }) => call<GeneratedDoc>(`/trade-generated/blank`, "POST", body),
      /** Download PDF: the stored PDF when final, else a DRAFT-watermarked render. Saves it to the user's downloads. */
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
      /** The PDF as a blob (same rules as Download PDF), for showing in the page. */
      generatedPdf,
      /** The in-app 請求書 behind a Sales invoice, with the contracts / shipments it bills. */
      generatedByDocument: (documentId: string) => call<GeneratedForDocument>(`/trade-generated/by-document/${documentId}`),
      generatedSources: (shipmentId: string, docType: string) => call<GenSource[]>(`/trade-generated/sources${qs({ shipmentId, docType })}`),
      createGenerated: (body: { shipmentId: string; docType: string; sourceFileId: string }) => call<GeneratedDoc>(`/trade-generated`, "POST", body),
      getGenerated: (id: string) => call<GeneratedDoc>(`/trade-generated/${id}`),
      updateGenerated: (id: string, body: { header?: GenHeader; columns?: GenColumn[]; rows?: GenRow[] }) => call<GeneratedDoc>(`/trade-generated/${id}`, "PATCH", body),
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
      stepTemplates: (scope?: "CONTRACT" | "SHIPMENT") => call<StepTemplate[]>(`/trade-config/step-templates${qs({ scope })}`),
      settings: () => call<TradeSettings>(`/trade-config/settings`),
      updateSettings: (body: { defaultConsignee?: string | null; defaultNotifyParty?: string | null; docDefaults?: Record<string, unknown> }) => call<TradeSettings>(`/trade-config/settings`, "PATCH", body),
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

/** Files-tab count: every file, plus linked documents that aren't already listed as their in-app PDF. */
export function recordFileCount(r: { fileLinks: RecordFileLink[]; docLinks?: RecordDocLink[] }): number {
  const fileIds = new Set(r.fileLinks.map((l) => l.file.id));
  return r.fileLinks.length + (r.docLinks ?? []).filter((l) => !l.inAppFileId || !fileIds.has(l.inAppFileId)).length;
}
