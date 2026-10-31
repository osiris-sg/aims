/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Round AM — shared parts of the Clients pages: the Customers · Suppliers switch, the contracts list with
// premiums / terms / the contract PDFs already in AIMS, the contacts from known email senders, small label helpers.

import React, { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Box, Chip, Link, Paper, Stack, Tab, Table, TableBody, TableCell, TableHead, TableRow, Tabs, Typography } from "@mui/material";
import PictureAsPdfIcon from "@mui/icons-material/PictureAsPdf";
import { CLIENTS_LABELS, CLIENTS_ROUTE, navLangOf } from "@/helpers/shipmentsNav";
import { useShipmentsApi, type ClientContact, type ClientContract } from "../../_lib/api";
import { fmtDay } from "../../_lib/format";
import { toast } from "../../_lib/toast";

export function useLang(): "en" | "ja" {
  const [lang, setLang] = useState<"en" | "ja">("en");
  useEffect(() => setLang(navLangOf(typeof navigator !== "undefined" ? navigator.language : null)), []);
  return lang;
}

export const T = {
  en: { openOrders: "Open orders", thisMonth: "This month (t)", last3: "Last 3 months (t)", lastDelivery: "Last delivery", invoice: "Invoice profile", contracts: "Contracts", piStatus: "PI status", orders: "Orders", details: "Details", formats: "Document formats", docsTheySend: "Documents they send" },
  ja: { openOrders: "未完了の注文", thisMonth: "今月 (t)", last3: "過去3か月 (t)", lastDelivery: "最終納入", invoice: "請求方式", contracts: "契約", piStatus: "PI状況", orders: "注文", details: "詳細", formats: "書類フォーマット", docsTheySend: "受領書類" },
} as const;

export const billingLabel = (m: string, lang: "en" | "ja") => (m === "SINGLE" ? (lang === "ja" ? "一括請求（1回）" : "Single invoice") : lang === "ja" ? "2段階（#1 + #2）" : "Two-stage (#1 + #2)");
export const t3 = (n: number | string | null | undefined) => (n === null || n === undefined || n === "" ? "—" : Number(n).toLocaleString("en-US", { maximumFractionDigits: 3 }));
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const ym = (m: string | null | undefined) => (m && /^\d{4}-\d{2}$/.test(m) ? `${MON[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}` : m ?? "");

/** Customers · Suppliers switch at the top of the Clients pages. */
export function ClientsHeader({ active, title, children }: { active: "customers" | "suppliers" | "shipping-lines"; title?: React.ReactNode; children?: React.ReactNode }) {
  const router = useRouter();
  const lang = useLang();
  const L = CLIENTS_LABELS[lang];
  return (
    <Box sx={{ mb: 2 }}>
      <Stack direction="row" alignItems="center" spacing={2} flexWrap="wrap" useFlexGap>
        <Typography variant="h5" sx={{ fontWeight: 800 }}>
          {title ?? L.top}
        </Typography>
        <Tabs value={active} onChange={(_, v) => router.push(`${CLIENTS_ROUTE}/${v}`)} sx={{ minHeight: 40, "& .MuiTab-root": { minHeight: 40, textTransform: "none" } }}>
          <Tab value="customers" label={L.customers} data-tour="clients-tab-customers" />
          <Tab value="suppliers" label={L.suppliers} data-tour="clients-tab-suppliers" />
          <Tab value="shipping-lines" label={L.shippingLines} data-tour="clients-tab-shipping-lines" />
        </Tabs>
        <Box sx={{ flex: 1 }} />
        {children}
      </Stack>
    </Box>
  );
}

/** A profile page's tabs, kept in the URL (?tab=). */
export function useTab<T extends string>(tabs: readonly T[], fallback: T): [T, (t: T) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const [tab, setTabState] = useState<T>(fallback);
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab") as T | null;
    if (t && tabs.includes(t)) setTabState(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const setTab = (t: T) => {
    setTabState(t);
    const p = new URLSearchParams(window.location.search);
    p.set("tab", t);
    if (t !== "orders") p.delete("view");
    router.replace(`${pathname}?${p.toString()}`, { scroll: false });
  };
  return [tab, setTab];
}

/** Contracts with their lines, premium schedule, terms and the contract files already in AIMS. */
export function ContractsPanel({ contracts, party }: { contracts: ClientContract[]; party: "customer" | "supplier" }) {
  const api = useShipmentsApi();
  const router = useRouter();
  const openFile = async (id: string) => {
    try {
      const f = await api.fileUrl(id);
      window.open(f.url, "_blank", "noopener");
    } catch (e: any) {
      toast.error(e?.message || "Could not open the file");
    }
  };
  if (!contracts.length) return <Typography color="text.secondary">No contracts in AIMS yet.</Typography>;
  return (
    <Stack spacing={2}>
      {contracts.map((c) => (
        <Paper key={c.id} variant="outlined" sx={{ p: 2 }} data-tour="client-contract">
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
            <Link component="button" variant="h6" underline="hover" sx={{ fontWeight: 800 }} onClick={() => router.push(`/portal/shipments/contracts/${c.id}`)}>
              {c.contractNo}
            </Link>
            <Chip size="small" label={c.status} color={c.status === "OPEN" ? "primary" : "default"} variant="outlined" />
            <Typography variant="body2" color="text.secondary">
              {party === "customer" ? c.supplier.name : c.customer.name} · {[c.grade, c.sizeSpec].filter(Boolean).join(" ")} · {fmtDay(c.periodStart)} – {fmtDay(c.periodEnd)}
              {c.annualQtyMt !== null && c.annualQtyMt !== undefined ? ` · ${t3(c.annualQtyMt)} t` : ""} · {c.orders} order{c.orders === 1 ? "" : "s"}
            </Typography>
            {c.checkFields?.length ? <Chip size="small" color="warning" variant="outlined" label={`check: ${c.checkFields.join(", ")}`} /> : null}
          </Stack>
          <Table size="small" sx={{ mb: 1, "& td, & th": { fontSize: 12.5 } }}>
            <TableHead>
              <TableRow>
                <TableCell>From</TableCell>
                <TableCell>To</TableCell>
                <TableCell>Grade</TableCell>
                <TableCell align="right">Supplier premium</TableCell>
                <TableCell align="right">Client premium</TableCell>
                <TableCell align="right">Upcharge</TableCell>
                <TableCell align="right">Margin</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(c.premiumSchedule?.length ? c.premiumSchedule : c.lines.map((l) => ({ from: "", to: null, grade: l.grade, supplierPremium: l.supplierPremium as any, clientPremium: l.clientPremium as any, upcharge: l.upcharge as any }))).map((p, i) => {
                const sp = p.supplierPremium === null || p.supplierPremium === undefined ? null : Number(p.supplierPremium);
                const cp = p.clientPremium === null || p.clientPremium === undefined ? null : Number(p.clientPremium);
                return (
                  <TableRow key={i}>
                    <TableCell>{ym(p.from) || "—"}</TableCell>
                    <TableCell>{p.to ? ym(p.to) : "open"}</TableCell>
                    <TableCell>{p.grade ?? c.grade ?? "—"}</TableCell>
                    <TableCell align="right">{sp ?? "—"}</TableCell>
                    <TableCell align="right">{cp ?? "—"}</TableCell>
                    <TableCell align="right">{p.upcharge ?? "—"}</TableCell>
                    <TableCell align="right">{sp !== null && cp !== null ? cp - sp : "—"}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <Stack spacing={0.5} sx={{ fontSize: 13 }}>
            {c.qpBasis && (
              <Typography variant="body2">
                <b>QP / LME basis:</b> {c.qpBasis}
              </Typography>
            )}
            {c.depositPercent !== null && c.depositPercent !== undefined && (
              <Typography variant="body2">
                <b>Deposit:</b> {Number(c.depositPercent)}%
              </Typography>
            )}
            {c.balanceTerms && (
              <Typography variant="body2">
                <b>Payment terms:</b> {c.balanceTerms}
              </Typography>
            )}
            {c.incoterm && (
              <Typography variant="body2">
                <b>Incoterm:</b> {c.incoterm}
              </Typography>
            )}
          </Stack>
          {c.files.length > 0 && (
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
              {c.files.map((f) => (
                <Chip key={f.id} icon={<PictureAsPdfIcon />} label={f.fileName} variant="outlined" onClick={() => void openFile(f.id)} title={f.docRef ?? undefined} sx={{ maxWidth: 360 }} />
              ))}
            </Stack>
          )}
        </Paper>
      ))}
    </Stack>
  );
}

export function ContactsList({ contacts, records }: { contacts: ClientContact[]; records?: Array<{ name: string; email: string | null; phone: string | null; designation: string | null }> }) {
  if (!contacts.length && !records?.length) return <Typography color="text.secondary">No contacts yet — senders appear here once their emails reach the intake.</Typography>;
  return (
    <Table size="small" sx={{ "& td, & th": { fontSize: 12.5 } }}>
      <TableHead>
        <TableRow>
          <TableCell>Contact</TableCell>
          <TableCell>Source</TableCell>
          <TableCell align="right">Emails</TableCell>
          <TableCell>Last email</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {(records ?? []).map((r, i) => (
          <TableRow key={`r${i}`}>
            <TableCell>
              {r.name}
              {r.designation ? ` · ${r.designation}` : ""}
              <Typography variant="caption" display="block" color="text.secondary">
                {[r.email, r.phone].filter(Boolean).join(" · ")}
              </Typography>
            </TableCell>
            <TableCell>Customer record</TableCell>
            <TableCell align="right">—</TableCell>
            <TableCell>—</TableCell>
          </TableRow>
        ))}
        {contacts.map((c) => (
          <TableRow key={c.email}>
            <TableCell>{c.email}</TableCell>
            <TableCell>Email intake</TableCell>
            <TableCell align="right">{c.messages}</TableCell>
            <TableCell>{fmtDay(c.lastAt)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <Stack direction="row" spacing={1} sx={{ py: 0.4 }}>
      <Typography variant="body2" color="text.secondary" sx={{ minWidth: 170 }}>
        {k}
      </Typography>
      <Typography variant="body2" component="div" sx={{ whiteSpace: "pre-line", flex: 1 }}>
        {v ?? "—"}
      </Typography>
    </Stack>
  );
}
