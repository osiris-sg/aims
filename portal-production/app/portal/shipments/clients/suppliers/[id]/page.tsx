/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Round AM — Clients › a supplier: Orders (pre-filtered, List | Monthly), Contracts (premiums, LME basis, the PDFs),
// Details (company, contacts from known email senders, the document set they send with a shipment, PI / payment terms,
// LME basis).

import React from "react";
import { useParams } from "next/navigation";
import { Alert, Box, Chip, CircularProgress, Grid2, Paper, Stack, Tab, Tabs, Typography } from "@mui/material";
import { useClientSupplier } from "../../../_lib/hooks";
import OrdersListView from "../../../_components/OrdersListView";
import { useOrdersView } from "../../../_components/OrdersViewToggle";
import IssuesPanel from "../../../_components/IssuesPanel";
import { ClientsHeader, ContactsList, ContractsPanel, KV, T, useLang, useTab } from "../../_components/ClientsBits";

const TABS = ["orders", "contracts", "details", "issues"] as const;

export default function ClientSupplierPage() {
  const { id } = useParams<{ id: string }>();
  const lang = useLang();
  const L = T[lang];
  const q = useClientSupplier(id);
  const [tab, setTab] = useTab(TABS, "orders");
  const [view, setView] = useOrdersView();
  const d = q.data;
  const pt = d?.terms.paymentTerms;
  return (
    <Box sx={{ p: { xs: 1.5, md: 3 }, width: "100%", maxWidth: "100vw", minWidth: 0, boxSizing: "border-box" }} data-tour="client-supplier-profile">
      <ClientsHeader active="suppliers" />
      {q.isError && <Alert severity="error">{(q.error as Error)?.message || "Could not load the supplier"}</Alert>}
      {q.isLoading || !d ? (
        <CircularProgress />
      ) : (
        <>
          <Stack direction="row" spacing={1.5} alignItems="baseline" flexWrap="wrap" useFlexGap sx={{ mb: 1.5 }}>
            <Typography variant="h5" sx={{ fontWeight: 800 }}>{d.short}</Typography>
            <Typography variant="body1" color="text.secondary">{d.supplier.name}</Typography>
            <Chip size="small" variant="outlined" label={d.terms.hasPI ? "PI + deposit" : "No PI"} />
            <Chip size="small" variant="outlined" label={d.terms.pricingMode === "FIXED" ? "Fixed price" : "LME + premium"} />
            <Typography variant="body2">{L.openOrders}: <b>{d.stats.openOrders}</b></Typography>
          </Stack>
          <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2, minHeight: 40, "& .MuiTab-root": { minHeight: 40, textTransform: "none" } }}>
            <Tab value="orders" label={L.orders} />
            <Tab value="contracts" label={`${L.contracts} (${d.contracts.length})`} />
            <Tab value="details" label={L.details} />
            <Tab value="issues" label={lang === "ja" ? "課題" : "Issues"} data-tour="client-tab-issues" />
          </Tabs>
          {tab === "orders" && <OrdersListView fixedSupplierId={d.supplier.id} view={view} onViewChange={setView} />}
          {tab === "contracts" && <ContractsPanel contracts={d.contracts} party="supplier" />}
          {tab === "details" && (
            <Grid2 container spacing={2}>
              <Grid2 size={{ xs: 12, md: 6 }}>
                <Paper variant="outlined" sx={{ p: 2, mb: 2 }} data-tour="client-supplier-docs">
                  <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 1 }}>{L.docsTheySend}</Typography>
                  <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                    {d.documentSet.required.map((x) => (
                      <Chip key={x.code} size="small" color="primary" variant="outlined" label={x.label} />
                    ))}
                  </Stack>
                  {d.documentSet.optional.length > 0 && (
                    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
                      {d.documentSet.optional.map((x) => (
                        <Chip key={x.code} size="small" variant="outlined" label={`${x.label} (optional)`} />
                      ))}
                    </Stack>
                  )}
                  <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
                    From the {d.documentSet.source} (step 3b). Edit in Org Settings → Customers → Suppliers.
                  </Typography>
                </Paper>
                <Paper variant="outlined" sx={{ p: 2 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 1 }}>{lang === "ja" ? "PI・支払条件・LME" : "PI, payment terms, LME basis"}</Typography>
                  <KV k="PI" v={d.terms.hasPI ? `Yes — deposit ${d.terms.depositPercents.length ? d.terms.depositPercents.map((p) => `${p}%`).join(" / ") : "per contract"} on step 1` : "No PI (step 1 N/A; step 6 pays the full amount)"} />
                  {pt && <KV k="Payment terms" v={`${pt.advancePct}% advance${pt.note ? ` · ${pt.note}` : ""}`} />}
                  <KV k="Pricing" v={d.terms.pricingMode === "FIXED" ? `Fixed price${d.terms.priceUnit ? ` (${d.terms.priceUnit})` : ""}` : "LME + premium (QMJP)"} />
                  {d.terms.lmeBasis.map((x) => (
                    <KV key={x.contractNo} k={`LME basis · ${x.contractNo}`} v={x.text} />
                  ))}
                  {d.terms.balanceTerms.map((x) => (
                    <KV key={`b${x.contractNo}`} k={`Balance · ${x.contractNo}`} v={x.text} />
                  ))}
                  {(d.terms.country || d.terms.loadingPort) && <KV k="Origin · loading port" v={[d.terms.country, d.terms.loadingPort].filter(Boolean).join(" · ")} />}
                </Paper>
              </Grid2>
              <Grid2 size={{ xs: 12, md: 6 }}>
                <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 1 }}>{lang === "ja" ? "会社情報" : "Company"}</Typography>
                  <KV k="Name" v={d.supplier.name} />
                  <KV k="Address" v={d.supplier.address} />
                  <KV k="Code · currency" v={`${d.supplier.supplierCode ?? "—"} · ${d.supplier.currency}`} />
                </Paper>
                <Paper variant="outlined" sx={{ p: 2 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 1 }}>{lang === "ja" ? "連絡先" : "Contacts"}</Typography>
                  <ContactsList contacts={d.contacts} />
                </Paper>
              </Grid2>
            </Grid2>
          )}
          {tab === "issues" && <IssuesPanel supplierId={d.supplier.id} title={lang === "ja" ? "課題" : "Issues"} />}
        </>
      )}
    </Box>
  );
}
