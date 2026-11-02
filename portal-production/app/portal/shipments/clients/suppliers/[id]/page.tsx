/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Round AM — Clients › a supplier: Orders (pre-filtered, List | Monthly), Contracts (premiums, LME basis, the PDFs),
// Details (company, contacts from known email senders, the document set they send with a shipment, PI / payment terms,
// LME basis).

import React from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Alert, Box, Chip, CircularProgress, Grid2, Paper, Stack, Tab, Tabs, Typography } from "@mui/material";
import { useClientSupplier } from "../../../_lib/hooks";
import OrdersListView from "../../../_components/OrdersListView";
import { useOrdersView } from "../../../_components/OrdersViewToggle";
import CompanyDetails from "../../_components/CompanyDetails";
import { ProductsPanel } from "../../_components/ProductsPanel";
import { PackingPanel } from "../../_components/PackingPanel";
import IssuesPanel from "../../../_components/IssuesPanel";
import { ClientsHeader, ContactsList, ContractsPanel, KV, useLang, useTab } from "../../_components/ClientsBits";

const TABS = ["orders", "contracts", "products", "packing", "details", "issues"] as const;

export default function ClientSupplierPage() {
  const { id } = useParams<{ id: string }>();
  const lang = useLang();
  const tb = useTranslations("clients.bits");
  const t = useTranslations("clients.profile");
  const tc = useTranslations("catalog");
  const q = useClientSupplier(id);
  const [tab, setTab] = useTab(TABS, "orders");
  const [view, setView] = useOrdersView();
  const d = q.data;
  const pt = d?.terms.paymentTerms;
  return (
    <Box sx={{ p: { xs: 1.5, md: 3 }, width: "100%", maxWidth: "100vw", minWidth: 0, boxSizing: "border-box" }} data-tour="client-supplier-profile">
      <ClientsHeader active="suppliers" />
      {q.isError && <Alert severity="error">{(q.error as Error)?.message || t("supplierError")}</Alert>}
      {q.isLoading || !d ? (
        <CircularProgress />
      ) : (
        <>
          <Stack direction="row" spacing={1.5} alignItems="baseline" flexWrap="wrap" useFlexGap sx={{ mb: 1.5 }}>
            <Typography variant="h5" sx={{ fontWeight: 800 }}>{d.short}</Typography>
            <Typography variant="body1" color="text.secondary">{d.supplier.name}</Typography>
            <Chip size="small" variant="outlined" label={d.terms.hasPI ? t("piDeposit") : t("noPi")} />
            <Chip size="small" variant="outlined" label={d.terms.pricingMode === "FIXED" ? t("fixedPrice") : t("lmePremium")} />
            <Typography variant="body2">{tb("openOrders")}: <b>{d.stats.openOrders}</b></Typography>
          </Stack>
          <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2, minHeight: 40, "& .MuiTab-root": { minHeight: 40, textTransform: "none" } }}>
            <Tab value="orders" label={tb("orders")} />
            <Tab value="contracts" label={`${tb("contracts")} (${d.contracts.length})`} />
            <Tab value="products" label={`${tc("tabs.products")} (${d.catalog?.products.length ?? 0})`} data-tour="client-tab-products" />
            <Tab value="packing" label={tc("tabs.packing")} data-tour="client-tab-packing" />
            <Tab value="details" label={tb("details")} />
            <Tab value="issues" label={t("issues")} data-tour="client-tab-issues" />
          </Tabs>
          {tab === "orders" && <OrdersListView fixedSupplierId={d.supplier.id} view={view} onViewChange={setView} />}
          {tab === "contracts" && <ContractsPanel contracts={d.contracts} party="supplier" partyId={d.supplier.id} />}
          {tab === "products" && <ProductsPanel kind="suppliers" id={d.supplier.id} catalog={d.catalog} />}
          {tab === "packing" && <PackingPanel kind="suppliers" id={d.supplier.id} catalog={d.catalog} />}
          {tab === "details" && (
            <Stack spacing={2}>
            <CompanyDetails kind="supplier" rec={{ id: d.supplier.id, name: d.supplier.name, address: d.supplier.address, email: d.supplier.email, phone: d.supplier.phone, gstRegNo: d.supplier.gstRegNo, currency: d.supplier.currency, jpName: d.company?.legalNameJa ?? null }} company={d.company} logistics={d.logistics} contacts={d.contactList ?? []} lang={lang}>
              <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1.5, mb: 0.5 }}>{t("whoEmails")}</Typography>
              <ContactsList contacts={d.contacts} />
            </CompanyDetails>
            <Grid2 container spacing={2}>
              <Grid2 size={{ xs: 12, md: 6 }}>
                <Paper variant="outlined" sx={{ p: 2, mb: 2 }} data-tour="client-supplier-docs">
                  <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 1 }}>{tb("docsTheySend")}</Typography>
                  <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                    {d.documentSet.required.map((x) => (
                      <Chip key={x.code} size="small" color="primary" variant="outlined" label={x.label} />
                    ))}
                  </Stack>
                  {d.documentSet.optional.length > 0 && (
                    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
                      {d.documentSet.optional.map((x) => (
                        <Chip key={x.code} size="small" variant="outlined" label={t("optional", { label: x.label })} />
                      ))}
                    </Stack>
                  )}
                  <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
                    {t("docsFrom", { source: d.documentSet.source })}
                  </Typography>
                </Paper>
                <Paper variant="outlined" sx={{ p: 2 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 1 }}>{t("piTerms")}</Typography>
                  <KV k="PI" v={d.terms.hasPI ? t("piYes", { pcts: d.terms.depositPercents.length ? d.terms.depositPercents.map((p) => `${p}%`).join(" / ") : t("perContract") }) : t("piNo")} />
                  {pt && <KV k={t("paymentTerms")} v={`${t("advance", { pct: pt.advancePct })}${pt.note ? ` · ${pt.note}` : ""}`} />}
                  <KV k={t("pricing")} v={d.terms.pricingMode === "FIXED" ? `${t("fixedPrice")}${d.terms.priceUnit ? ` (${d.terms.priceUnit})` : ""}` : t("lmeQmjp")} />
                  {d.terms.lmeBasis.map((x) => (
                    <KV key={x.contractNo} k={t("lmeBasis", { no: x.contractNo })} v={x.text} />
                  ))}
                  {d.terms.balanceTerms.map((x) => (
                    <KV key={`b${x.contractNo}`} k={t("balance", { no: x.contractNo })} v={x.text} />
                  ))}
                  {(d.terms.country || d.terms.loadingPort) && <KV k={t("origin")} v={[d.terms.country, d.terms.loadingPort].filter(Boolean).join(" · ")} />}
                </Paper>
              </Grid2>
            </Grid2>
            </Stack>
          )}
          {tab === "issues" && <IssuesPanel supplierId={d.supplier.id} title={t("issues")} />}
        </>
      )}
    </Box>
  );
}
