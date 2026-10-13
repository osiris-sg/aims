"use client";

// Shared AR/AP side config for the legacy report set (guru 2026-10-14: the
// five AP reports mirror their AR twins with creditor wording). A report takes
// `side` and everything party-specific — contact master, code field, aged
// endpoint side, SOA endpoint — switches here.
//
// Accounting conventions baked in:
// - aged?side=payable returns outstanding BILL balances per supplier (what we
//   owe), positive = owing, same shape as the receivable side.
// - /statements/supplier-soa mirrors a supplier's statement of our account:
//   bills are DEBITS, payments CREDITS, positive balance = owed to supplier —
//   the natural layout for reconciling against the statement the supplier
//   sends us. Its payload nests under `summary` (customer SOA uses
//   `statement`), so readers normalise via `soaSummaryOf`.

import { useMemo } from "react";
import { useGetCustomers } from "@/app/portal/hooks/api";
import { useGetSuppliers } from "@/app/portal/hooks/api/useSuppliers";

export type ReportSide = "receivable" | "payable";

export const SIDE_WORDS = {
  receivable: {
    party: "Debtor",
    partyPlural: "debtors",
    contactNoun: "customer",
    agedSide: "receivable",
    soaUrl: "/statements/soa",
    soaIdKey: "customerId",
  },
  payable: {
    party: "Creditor",
    partyPlural: "creditors",
    contactNoun: "supplier",
    agedSide: "payable",
    soaUrl: "/statements/supplier-soa",
    soaIdKey: "supplierId",
  },
} as const;

export function useSideContacts(side: ReportSide) {
  // Both hooks run unconditionally (rules of hooks); only the active side's
  // list is used — react-query caches make the other call cheap.
  const { customers = [] } = useGetCustomers({ limit: 1000 });
  const { suppliers = [] } = useGetSuppliers({ limit: 1000 });
  const list: any[] = side === "payable" ? suppliers : customers;
  const codeOf = (c: any) => String((side === "payable" ? c?.supplierCode : c?.customerCode) || "");
  const sorted = useMemo(
    () => [...(list || [])].sort((a: any, b: any) => codeOf(a).localeCompare(codeOf(b))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [list],
  );
  const byId = useMemo(() => {
    const m = new Map<string, any>();
    for (const c of sorted) m.set(c.id, c);
    return m;
  }, [sorted]);
  return { sorted, byId, codeOf, words: SIDE_WORDS[side] };
}

// Customer SOA nests money under `statement` (currentBalance); supplier SOA
// under `summary` (closingBalance). One accessor for both.
export function soaSummaryOf(soa: any): { opening: number; closing: number; totalDebit: number; totalCredit: number } {
  const s = soa?.statement || soa?.summary || {};
  return {
    opening: Number(s.openingBalance) || 0,
    closing: Number(s.currentBalance ?? s.closingBalance) || 0,
    totalDebit: Number(s.totalDebit) || 0,
    totalCredit: Number(s.totalCredit) || 0,
  };
}
