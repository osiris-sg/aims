/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Round AM — Clients › a customer: Orders (the Orders list / Monthly view pre-filtered to this customer), Contracts
// (premiums, terms, the contract PDFs in AIMS), Details (company, contacts from known email senders, ports, delivery
// sites), Process (round AY: which steps apply), Document formats (what AIMS makes in steps 4 / 7 / 9 / 11, in which format, samples, preview).

import React from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Alert, Box, Chip, CircularProgress, Grid2, Paper, Stack, Tab, Tabs, Typography } from "@mui/material";
import { useClientCustomer } from "../../../_lib/hooks";
import OrdersListView from "../../../_components/OrdersListView";
import { useOrdersView } from "../../../_components/OrdersViewToggle";
import IssuesPanel from "../../../_components/IssuesPanel";
import { fmtDay } from "../../../_lib/format";
import { ClientsHeader, ContactsList, ContractsPanel, KV, t3, useBillingLabel, useLang, useTab, ym } from "../../_components/ClientsBits";
import DocumentFormatsPanel from "../../_components/DocumentFormatsPanel";
import ProcessPanel from "../../_components/ProcessPanel";
import CompanyDetails from "../../_components/CompanyDetails";
import { ProductsPanel } from "../../_components/ProductsPanel";
import { PackingPanel } from "../../_components/PackingPanel";

const TABS = ["orders", "contracts", "products", "packing", "details", "process", "formats", "issues"] as const;

export default function ClientCustomerPage() {
  const { id } = useParams<{ id: string }>();
  const lang = useLang();
  const tb = useTranslations("clients.bits");
  const t = useTranslations("clients.profile");
  const tc = useTranslations("catalog");
  const billingLabel = useBillingLabel();
  const q = useClientCustomer(id);
  const [tab, setTab] = useTab(TABS, "orders");
  const [view, setView] = useOrdersView();
  const d = q.data;
  return (
    <Box sx={{ p: { xs: 1.5, md: 3 }, width: "100%", maxWidth: "100vw", minWidth: 0, boxSizing: "border-box" }} data-tour="client-profile">
      <ClientsHeader active="customers" />
      {q.isError && <Alert severity="error">{(q.error as Error)?.message || t("customerError")}</Alert>}
      {q.isLoading || !d ? (
        <CircularProgress />
      ) : (
        <>
          <Stack direction="row" spacing={1.5} alignItems="baseline" flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
            <Typography variant="h5" sx={{ fontWeight: 800 }}>{d.short}</Typography>
            <Typography variant="body1" color="text.secondary">{[d.customer.name, d.customer.jpName].filter(Boolean).join(" · ")}</Typography>
            <Chip size="small" variant="outlined" label={billingLabel(d.profile.billingMode)} />
            {d.profile.port && <Chip size="small" variant="outlined" label={d.profile.port} />}
          </Stack>
          <Stack direction="row" spacing={3} flexWrap="wrap" useFlexGap sx={{ mb: 1.5 }}>
            <Typography variant="body2">{tb("openOrders")}: <b>{d.stats.openOrders}</b></Typography>
            <Typography variant="body2">{tb("thisMonth")}: <b>{t3(d.stats.tonsThisMonth)}</b></Typography>
            <Typography variant="body2" title={`${ym(d.stats.last3From)} – ${ym(d.stats.last3To)}`}>{tb("last3")}: <b>{t3(d.stats.tonsLast3Months)}</b></Typography>
            <Typography variant="body2">{tb("lastDelivery")}: <b>{d.stats.lastDelivery ? `${d.stats.lastDelivery.date ? fmtDay(d.stats.lastDelivery.date) : ym(d.stats.lastDelivery.month)} · ${d.stats.lastDelivery.ref}` : "—"}</b></Typography>
          </Stack>
          <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2, minHeight: 40, "& .MuiTab-root": { minHeight: 40, textTransform: "none" } }}>
            <Tab value="orders" label={tb("orders")} data-tour="client-tab-orders" />
            <Tab value="contracts" label={`${tb("contracts")} (${d.contracts.length})`} data-tour="client-tab-contracts" />
            <Tab value="products" label={`${tc("tabs.products")} (${d.catalog?.products.length ?? 0})`} data-tour="client-tab-products" />
            <Tab value="packing" label={tc("tabs.packing")} data-tour="client-tab-packing" />
            <Tab value="details" label={tb("details")} data-tour="client-tab-details" />
            <Tab value="process" label={t("process")} data-tour="client-tab-process" />
            <Tab value="formats" label={tb("formats")} data-tour="client-tab-formats" />
            <Tab value="issues" label={t("issues")} data-tour="client-tab-issues" />
          </Tabs>
          {tab === "orders" && <OrdersListView fixedCustomerId={d.customer.id} view={view} onViewChange={setView} />}
          {tab === "contracts" && <ContractsPanel contracts={d.contracts} party="customer" partyId={d.customer.id} />}
          {tab === "products" && <ProductsPanel kind="customers" id={d.customer.id} catalog={d.catalog} />}
          {tab === "packing" && <PackingPanel kind="customers" id={d.customer.id} catalog={d.catalog} />}
          {tab === "details" && (
            <Stack spacing={2}>
            <CompanyDetails
              kind="customer"
              rec={d.customer}
              company={d.company}
              logistics={d.logistics}
              contacts={d.contactList ?? []}
              lang={lang}
            >
              {d.customer.contacts.length > 0 && <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1.5, mb: 0.5 }}>{t("onRecord")}</Typography>}
              {d.customer.contacts.length > 0 && <ContactsList contacts={[]} records={d.customer.contacts} />}
              <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1.5, mb: 0.5 }}>{t("whoEmails")}</Typography>
              <ContactsList contacts={d.contacts} />
            </CompanyDetails>
            <Grid2 container spacing={2}>
              <Grid2 size={{ xs: 12, md: 6 }}>
                <Paper variant="outlined" sx={{ p: 2 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 1 }}>{t("tradeProfile")}</Typography>
                  <KV k={t("jpContact")} v={d.customer.jpContact} />
                  <KV k={t("codeCurrency")} v={`${d.customer.customerCode ?? "—"} · ${d.customer.currency}`} />
                  <KV k={t("addressee")} v={d.profile.docAddressee ?? d.customer.jpName ?? d.customer.name} />
                  <KV k={t("billing")} v={billingLabel(d.profile.billingMode)} />
                  <KV k={t("importPermit")} v={d.profile.sendImportPermit ? t("yes") : t("no")} />
                  <KV k={t("truck")} v={`${d.profile.truckCapacityT} t`} />
                  <KV k={t("emailDomains")} v={(d.profile.emailDomains ?? []).join(", ") || "—"} />
                  <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
                    {t("editHint")}
                  </Typography>
                </Paper>
              </Grid2>
              <Grid2 size={{ xs: 12, md: 6 }}>
                <Paper variant="outlined" sx={{ p: 2 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 1 }}>{t("portsSites")}</Typography>
                  <KV k={t("ports")} v={d.ports.join(", ") || "—"} />
                  {d.deliverySites.map((s, i) => (
                    <Box key={i} sx={{ mt: 1 }}>
                      <KV k={`${t("site")}${s.label ? ` (${s.label})` : ""}`} v={<>{s.siteName}{s.warehouseName ? <Typography component="span" variant="body2" color="text.secondary">{` · ${tc("warehouse", { name: s.warehouseName })}`}</Typography> : null}{s.warehouseCheck ? <Chip size="small" color="warning" variant="outlined" label={t("whTbc")} sx={{ ml: 1 }} /> : null}</>} />
                      <KV k={t("address")} v={s.address} />
                      {s.notes ? <KV k={t("notes")} v={s.notes} /> : null}
                      <Typography variant="caption" color="text.secondary">{t("fromSource", { source: s.source })}</Typography>
                    </Box>
                  ))}
                  {!d.deliverySites.length && <Typography variant="body2" color="text.secondary">{t("noSite")}</Typography>}
                </Paper>
              </Grid2>
            </Grid2>
            </Stack>
          )}
          {tab === "process" && <ProcessPanel customerId={d.customer.id} steps={d.process?.steps ?? []} skipSteps={d.process?.skipSteps ?? []} lang={lang} due={d.process?.due} />}
          {tab === "formats" && <DocumentFormatsPanel customerId={d.customer.id} formats={d.formats} lang={lang} />}
          {tab === "issues" && <IssuesPanel customerId={d.customer.id} title={t("issues")} />}
        </>
      )}
    </Box>
  );
}
