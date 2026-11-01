/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Clients › Suppliers (round AM; round AY part 3: a proper table). Every trade supplier (one with a profile, a
// contract or an order): name EN / JA, country, main contact, e-mail, phone, open orders, last delivery, PI status —
// sortable, searchable, rows selectable for a CSV export. "+ Add supplier" opens the form in a drawer.

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Box, Button, Chip, Stack } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import { useTranslations } from "next-intl";
import { useClientSuppliers } from "../../_lib/hooks";
import type { ClientSupplierRow } from "../../_lib/api";
import { ClientsHeader, useLang } from "../_components/ClientsBits";
import ClientsTable, { type ClientsColumn } from "../_components/ClientsTable";
import CompanyDrawer from "../_components/CompanyDrawer";
import { ContactCell, lastDeliveryKey, lastDeliveryText, NameCell } from "../_components/ClientColumns";
import { useUserPermissions } from "@/app/portal/hooks/useUserPermissions";

export default function ClientsSuppliersPage() {
  const router = useRouter();
  const lang = useLang();
  const tb = useTranslations("clients.bits");
  const t = useTranslations("clients.list");
  const list = useClientSuppliers();
  const { hasPermission, userRoles } = useUserPermissions();
  const canAdd = hasPermission("suppliers", "create") || userRoles.length === 0;
  const [add, setAdd] = useState(false);
  const href = (s: ClientSupplierRow) => `/portal/shipments/clients/suppliers/${s.id}`;
  const columns: ClientsColumn<ClientSupplierRow>[] = [
    { id: "name", label: t("supplier"), minWidth: 200, value: (s) => `${s.short} ${s.name} ${s.jpName ?? ""}`, render: (s) => <NameCell short={s.short} name={s.name} ja={s.jpName} /> },
    { id: "country", label: t("country"), value: (s) => s.country ?? "" },
    { id: "contact", label: t("mainContact"), minWidth: 160, value: (s) => [s.mainContact?.name, s.mainContact?.email].filter(Boolean).join(" "), render: (s) => <ContactCell c={s.mainContact} /> },
    { id: "email", label: t("email"), value: (s) => s.email ?? "" },
    { id: "phone", label: t("phone"), value: (s) => s.phone ?? "" },
    { id: "open", label: tb("openOrders"), align: "right", value: (s) => s.openOrders },
    { id: "last", label: tb("lastDelivery"), value: (s) => lastDeliveryKey(s.lastDelivery ?? s.stats?.lastDelivery), render: (s) => lastDeliveryText(s.lastDelivery ?? s.stats?.lastDelivery) || "—" },
    {
      id: "pi",
      label: tb("piStatus"),
      value: (s) => (s.pi ? s.pi.waiting + s.pi.received + s.pi.depositPaid : -1),
      render: (s) =>
        s.pi ? (
          <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
            {s.pi.waiting ? <Chip size="small" variant="outlined" label={t("piWaiting", { n: s.pi.waiting })} /> : null}
            {s.pi.received ? <Chip size="small" variant="outlined" color="info" label={t("piIn", { n: s.pi.received })} /> : null}
            {s.pi.depositPaid ? <Chip size="small" variant="outlined" color="success" label={t("depositPaid", { n: s.pi.depositPaid })} /> : null}
          </Stack>
        ) : (
          <Chip size="small" variant="outlined" label={t("noPi")} />
        ),
    },
  ];
  return (
    <Box sx={{ p: { xs: 1.5, md: 3 } }} data-tour="clients-suppliers">
      <ClientsHeader active="suppliers" />
      {list.isError && <Alert severity="error">{(list.error as Error)?.message || t("suppliersError")}</Alert>}
      <ClientsTable
        rows={list.data ?? []}
        columns={columns}
        rowKey={(s) => s.id}
        onOpen={(s) => router.push(href(s))}
        loading={list.isLoading}
        csvName="suppliers"
        lang={lang}
        dataTour="clients-suppliers-table"
        menu={(s) => [
          { label: t("open"), onClick: () => router.push(href(s)) },
          { label: t("editDetails"), onClick: () => router.push(`${href(s)}?tab=details&edit=1`) },
        ]}
        actions={canAdd ? <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={() => setAdd(true)} data-tour="clients-add-supplier">{t("addSupplier")}</Button> : null}
      />
      <CompanyDrawer kind="supplier" open={add} initial={null} onClose={() => setAdd(false)} onSaved={(id) => id && router.push(`/portal/shipments/clients/suppliers/${id}?tab=details`)} lang={lang} />
    </Box>
  );
}
