"use client";

// React Query hooks for the Shipments module. Contracts, shipments, steps and
// files are interlinked (progress, file ticks, link chips), so every mutation
// invalidates every Shipments root (records, files, generated docs, hub).

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useOrganization } from "@hooks/useOrganization";
import { useShipmentsApi, type ContractFilters, type FileFilters, type HubFilters, type OrderFilters, type ShipmentFilters } from "./api";

export const SHIPMENT_KEYS = {
  orders: ["trade-orders"] as const,
  contracts: ["trade-contracts"] as const,
  shipments: ["trade-shipments"] as const,
  files: ["trade-files"] as const,
  config: ["trade-config"] as const,
  parties: ["trade-parties"] as const,
  generated: ["trade-generated"] as const,
  hub: ["trade-hub"] as const,
};

const useOrgId = () => {
  const { organization } = useOrganization();
  return organization?.id as string | undefined;
};

export const useContracts = (f: ContractFilters, enabled = true) => {
  const api = useShipmentsApi();
  const orgId = useOrgId();
  return useQuery({
    queryKey: [...SHIPMENT_KEYS.contracts, orgId, "list", f],
    enabled: !!orgId && enabled,
    placeholderData: keepPreviousData,
    queryFn: () => api.listContracts(f),
  });
};

export const useContract = (id?: string) => {
  const api = useShipmentsApi();
  const orgId = useOrgId();
  return useQuery({
    queryKey: [...SHIPMENT_KEYS.contracts, orgId, "detail", id],
    enabled: !!orgId && !!id,
    queryFn: () => api.getContract(id!),
  });
};

export const useOrders = (f: OrderFilters, enabled = true) => {
  const api = useShipmentsApi();
  const orgId = useOrgId();
  return useQuery({
    queryKey: [...SHIPMENT_KEYS.orders, orgId, "list", f],
    enabled: !!orgId && enabled,
    placeholderData: keepPreviousData,
    queryFn: () => api.listOrders(f),
  });
};

export const useOrder = (id?: string) => {
  const api = useShipmentsApi();
  const orgId = useOrgId();
  return useQuery({
    queryKey: [...SHIPMENT_KEYS.orders, orgId, "detail", id],
    enabled: !!orgId && !!id,
    queryFn: () => api.getOrder(id!),
  });
};

/** Step 13: the order's reconciliation (documents + typed payments / actuals → profit). */
export const useReconciliation = (orderId?: string, enabled = true) => {
  const api = useShipmentsApi();
  const orgId = useOrgId();
  return useQuery({
    queryKey: [...SHIPMENT_KEYS.orders, orgId, "reconciliation", orderId],
    enabled: !!orgId && !!orderId && enabled,
    queryFn: () => api.reconciliation(orderId!),
  });
};

/** In-app documents of an order (Invoice #1). */
export const useOrderGeneratedDocs = (orderId?: string) => {
  const api = useShipmentsApi();
  const orgId = useOrgId();
  return useQuery({
    queryKey: [...SHIPMENT_KEYS.generated, orgId, "order", orderId],
    enabled: !!orgId && !!orderId,
    queryFn: () => api.generatedForOrder(orderId!),
  });
};

export const useShipments = (f: ShipmentFilters, enabled = true) => {
  const api = useShipmentsApi();
  const orgId = useOrgId();
  return useQuery({
    queryKey: [...SHIPMENT_KEYS.shipments, orgId, "list", f],
    enabled: !!orgId && enabled,
    placeholderData: keepPreviousData,
    queryFn: () => api.listShipments(f),
  });
};

export const useShipment = (id?: string) => {
  const api = useShipmentsApi();
  const orgId = useOrgId();
  return useQuery({
    queryKey: [...SHIPMENT_KEYS.shipments, orgId, "detail", id],
    enabled: !!orgId && !!id,
    queryFn: () => api.getShipment(id!),
  });
};

export const useTradeFiles = (f: FileFilters, enabled = true) => {
  const api = useShipmentsApi();
  const orgId = useOrgId();
  return useQuery({
    queryKey: [...SHIPMENT_KEYS.files, orgId, "list", f],
    enabled: !!orgId && enabled,
    placeholderData: keepPreviousData,
    queryFn: () => api.listFiles(f),
  });
};

/** In-app documents of a contract (Invoice #1 lives on the contract). */
export const useContractGeneratedDocs = (contractId?: string) => {
  const api = useShipmentsApi();
  const orgId = useOrgId();
  return useQuery({
    queryKey: [...SHIPMENT_KEYS.generated, orgId, "contract", contractId],
    enabled: !!orgId && !!contractId,
    queryFn: () => api.generatedForContract(contractId!),
  });
};

export const useGeneratedDocs = (shipmentId?: string) => {
  const api = useShipmentsApi();
  const orgId = useOrgId();
  return useQuery({
    queryKey: [...SHIPMENT_KEYS.generated, orgId, "shipment", shipmentId],
    enabled: !!orgId && !!shipmentId,
    queryFn: () => api.generatedFor(shipmentId!),
  });
};

export const useGeneratedDoc = (id?: string) => {
  const api = useShipmentsApi();
  const orgId = useOrgId();
  return useQuery({
    queryKey: [...SHIPMENT_KEYS.generated, orgId, "detail", id],
    enabled: !!orgId && !!id,
    queryFn: () => api.getGenerated(id!),
  });
};

/** The in-app 請求書 behind a Sales invoice (null when the invoice wasn't made in-app). */
export const useGeneratedForDocument = (documentId?: string) => {
  const api = useShipmentsApi();
  const orgId = useOrgId();
  return useQuery({
    queryKey: [...SHIPMENT_KEYS.generated, orgId, "by-document", documentId],
    enabled: !!orgId && !!documentId,
    retry: false,
    queryFn: () => api.generatedByDocument(documentId!),
  });
};

export const useHub = (f: HubFilters) => {
  const api = useShipmentsApi();
  const orgId = useOrgId();
  return useQuery({
    queryKey: [...SHIPMENT_KEYS.hub, orgId, f],
    enabled: !!orgId,
    placeholderData: keepPreviousData,
    queryFn: () => api.hub(f),
  });
};

export const useDocTypes = () => {
  const api = useShipmentsApi();
  const orgId = useOrgId();
  return useQuery({
    queryKey: [...SHIPMENT_KEYS.config, orgId, "doc-types"],
    enabled: !!orgId,
    staleTime: 5 * 60_000,
    queryFn: () => api.docTypes(),
  });
};

export const useStepTemplates = (scope: "CONTRACT" | "SHIPMENT" | "ORDER") => {
  const api = useShipmentsApi();
  const orgId = useOrgId();
  return useQuery({
    queryKey: [...SHIPMENT_KEYS.config, orgId, "step-templates", scope],
    enabled: !!orgId,
    staleTime: 5 * 60_000,
    queryFn: () => api.stepTemplates(scope),
  });
};

/** Org trade defaults (B/L instruction texts). */
export const useTradeSettings = (enabled = true) => {
  const api = useShipmentsApi();
  const orgId = useOrgId();
  return useQuery({
    queryKey: [...SHIPMENT_KEYS.config, orgId, "settings"],
    enabled: !!orgId && enabled,
    queryFn: () => api.settings(),
  });
};

/** code → label, for chips and step requirements. */
export const useDocTypeLabels = () => {
  const { data } = useDocTypes();
  const map = new Map<string, string>();
  (data ?? []).forEach((d) => map.set(d.code, d.label));
  return (code: string) => map.get(code) ?? code;
};

export const useSuppliers = (enabled = true) => {
  const api = useShipmentsApi();
  const orgId = useOrgId();
  return useQuery({
    queryKey: [...SHIPMENT_KEYS.parties, orgId, "suppliers"],
    enabled: !!orgId && enabled,
    staleTime: 5 * 60_000,
    queryFn: () => api.suppliers(),
  });
};

export const useCustomers = (enabled = true) => {
  const api = useShipmentsApi();
  const orgId = useOrgId();
  return useQuery({
    queryKey: [...SHIPMENT_KEYS.parties, orgId, "customers"],
    enabled: !!orgId && enabled,
    staleTime: 5 * 60_000,
    queryFn: () => api.customers(),
  });
};

/**
 * Wraps an api call in a mutation that refreshes every Shipments query on
 * success. Errors are left to the caller (they carry the backend's message).
 */
/** Longest a mutation waits for the lists / records it changed to refetch. */
export const REFRESH_WAIT_MS = 4000;

export function useTradeMutation<TVars, TResult>(fn: (api: ReturnType<typeof useShipmentsApi>, vars: TVars) => Promise<TResult>) {
  const api = useShipmentsApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: TVars) => fn(api, vars),
    onSuccess: async () => {
      const refresh = Promise.all([
        qc.invalidateQueries({ queryKey: SHIPMENT_KEYS.orders }),
        qc.invalidateQueries({ queryKey: SHIPMENT_KEYS.contracts }),
        qc.invalidateQueries({ queryKey: SHIPMENT_KEYS.shipments }),
        qc.invalidateQueries({ queryKey: SHIPMENT_KEYS.files }),
        qc.invalidateQueries({ queryKey: SHIPMENT_KEYS.generated }),
        qc.invalidateQueries({ queryKey: SHIPMENT_KEYS.hub }),
        qc.invalidateQueries({ queryKey: SHIPMENT_KEYS.config }),
      ]).catch(() => undefined);
      // Wait for fresh data, but never hold a dialog on "Uploading…" / "Working…" because
      // one refetch is slow or paused: the rest arrives in the background.
      await Promise.race([refresh, new Promise((r) => setTimeout(r, REFRESH_WAIT_MS))]);
    },
  });
}
