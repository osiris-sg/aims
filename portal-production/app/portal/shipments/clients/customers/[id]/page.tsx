/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Round AM — Clients › a customer: Orders (the Orders list / Monthly view pre-filtered to this customer), Contracts
// (premiums, terms, the contract PDFs in AIMS), Details (company, contacts from known email senders, ports, delivery
// sites), Process (round AY: which steps apply), Document formats (what AIMS makes in steps 4 / 7 / 9 / 11, in which format, samples, preview).

import React from "react";
import { useParams } from "next/navigation";
import { Alert, Box, Chip, CircularProgress, Grid2, Paper, Stack, Tab, Tabs, Typography } from "@mui/material";
import { useClientCustomer } from "../../../_lib/hooks";
import OrdersListView from "../../../_components/OrdersListView";
import { useOrdersView } from "../../../_components/OrdersViewToggle";
import IssuesPanel from "../../../_components/IssuesPanel";
import { fmtDay } from "../../../_lib/format";
import { billingLabel, ClientsHeader, ContactsList, ContractsPanel, KV, T, t3, useLang, useTab, ym } from "../../_components/ClientsBits";
import DocumentFormatsPanel from "../../_components/DocumentFormatsPanel";
import ProcessPanel from "../../_components/ProcessPanel";

const TABS = ["orders", "contracts", "details", "process", "formats", "issues"] as const;

export default function ClientCustomerPage() {
  const { id } = useParams<{ id: string }>();
  const lang = useLang();
  const L = T[lang];
  const q = useClientCustomer(id);
  const [tab, setTab] = useTab(TABS, "orders");
  const [view, setView] = useOrdersView();
  const d = q.data;
  return (
    <Box sx={{ p: { xs: 1.5, md: 3 }, width: "100%", maxWidth: "100vw", minWidth: 0, boxSizing: "border-box" }} data-tour="client-profile">
      <ClientsHeader active="customers" />
      {q.isError && <Alert severity="error">{(q.error as Error)?.message || "Could not load the customer"}</Alert>}
      {q.isLoading || !d ? (
        <CircularProgress />
      ) : (
        <>
          <Stack direction="row" spacing={1.5} alignItems="baseline" flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
            <Typography variant="h5" sx={{ fontWeight: 800 }}>{d.short}</Typography>
            <Typography variant="body1" color="text.secondary">{[d.customer.name, d.customer.jpName].filter(Boolean).join(" · ")}</Typography>
            <Chip size="small" variant="outlined" label={billingLabel(d.profile.billingMode, lang)} />
            {d.profile.port && <Chip size="small" variant="outlined" label={d.profile.port} />}
          </Stack>
          <Stack direction="row" spacing={3} flexWrap="wrap" useFlexGap sx={{ mb: 1.5 }}>
            <Typography variant="body2">{L.openOrders}: <b>{d.stats.openOrders}</b></Typography>
            <Typography variant="body2">{L.thisMonth}: <b>{t3(d.stats.tonsThisMonth)}</b></Typography>
            <Typography variant="body2" title={`${ym(d.stats.last3From)} – ${ym(d.stats.last3To)}`}>{L.last3}: <b>{t3(d.stats.tonsLast3Months)}</b></Typography>
            <Typography variant="body2">{L.lastDelivery}: <b>{d.stats.lastDelivery ? `${d.stats.lastDelivery.date ? fmtDay(d.stats.lastDelivery.date) : ym(d.stats.lastDelivery.month)} · ${d.stats.lastDelivery.ref}` : "—"}</b></Typography>
          </Stack>
          <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2, minHeight: 40, "& .MuiTab-root": { minHeight: 40, textTransform: "none" } }}>
            <Tab value="orders" label={L.orders} data-tour="client-tab-orders" />
            <Tab value="contracts" label={`${L.contracts} (${d.contracts.length})`} data-tour="client-tab-contracts" />
            <Tab value="details" label={L.details} data-tour="client-tab-details" />
            <Tab value="process" label={lang === "ja" ? "プロセス" : "Process"} data-tour="client-tab-process" />
            <Tab value="formats" label={L.formats} data-tour="client-tab-formats" />
            <Tab value="issues" label={lang === "ja" ? "課題" : "Issues"} data-tour="client-tab-issues" />
          </Tabs>
          {tab === "orders" && <OrdersListView fixedCustomerId={d.customer.id} view={view} onViewChange={setView} />}
          {tab === "contracts" && <ContractsPanel contracts={d.contracts} party="customer" />}
          {tab === "details" && (
            <Grid2 container spacing={2}>
              <Grid2 size={{ xs: 12, md: 6 }}>
                <Paper variant="outlined" sx={{ p: 2 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 1 }}>{lang === "ja" ? "会社情報" : "Company"}</Typography>
                  <KV k="Name" v={d.customer.name} />
                  <KV k="日本語名" v={d.customer.jpName} />
                  <KV k="住所" v={d.customer.jpAddress ?? d.customer.address} />
                  <KV k="担当 (on documents)" v={d.customer.jpContact} />
                  <KV k="Code · currency" v={`${d.customer.customerCode ?? "—"} · ${d.customer.currency}`} />
                  <KV k="宛先 (PL / COA)" v={d.profile.docAddressee ?? d.customer.jpName ?? d.customer.name} />
                  <KV k={lang === "ja" ? "請求方式" : "Billing"} v={billingLabel(d.profile.billingMode, lang)} />
                  <KV k={lang === "ja" ? "輸入許可書の送付" : "Import permit sent"} v={d.profile.sendImportPermit ? "Yes" : "No"} />
                  <KV k={lang === "ja" ? "トラック" : "Truck size"} v={`${d.profile.truckCapacityT} t`} />
                  <KV k={lang === "ja" ? "メールドメイン" : "Email domains"} v={(d.profile.emailDomains ?? []).join(", ") || "—"} />
                  <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
                    {lang === "ja" ? "編集: 組織設定 → 顧客 / マスターファイル" : "Edit in Org Settings → Customers (profile) and Master Files (record)."}
                  </Typography>
                </Paper>
              </Grid2>
              <Grid2 size={{ xs: 12, md: 6 }}>
                <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 1 }}>{lang === "ja" ? "港・納入先" : "Ports & delivery sites"}</Typography>
                  <KV k={lang === "ja" ? "港" : "Ports"} v={d.ports.join(", ") || "—"} />
                  {d.deliverySites.map((s, i) => (
                    <Box key={i} sx={{ mt: 1 }}>
                      <KV k={`${lang === "ja" ? "納入先" : "Site"}${s.label ? ` (${s.label})` : ""}`} v={<>{s.siteName}{s.warehouseCheck ? <Chip size="small" color="warning" variant="outlined" label="倉庫 TBC" sx={{ ml: 1 }} /> : null}</>} />
                      <KV k={lang === "ja" ? "住所" : "Address"} v={s.address} />
                      {s.notes ? <KV k="備考" v={s.notes} /> : null}
                      <Typography variant="caption" color="text.secondary">from {s.source}</Typography>
                    </Box>
                  ))}
                  {!d.deliverySites.length && <Typography variant="body2" color="text.secondary">No delivery site yet (Org Settings → Customers).</Typography>}
                </Paper>
                <Paper variant="outlined" sx={{ p: 2 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 1 }}>{lang === "ja" ? "連絡先" : "Contacts"}</Typography>
                  <ContactsList contacts={d.contacts} records={d.customer.contacts} />
                </Paper>
              </Grid2>
            </Grid2>
          )}
          {tab === "process" && <ProcessPanel customerId={d.customer.id} steps={d.process?.steps ?? []} skipSteps={d.process?.skipSteps ?? []} lang={lang} />}
          {tab === "formats" && <DocumentFormatsPanel customerId={d.customer.id} formats={d.formats} lang={lang} />}
          {tab === "issues" && <IssuesPanel customerId={d.customer.id} title={lang === "ja" ? "課題" : "Issues"} />}
        </>
      )}
    </Box>
  );
}
