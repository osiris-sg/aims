/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Clients › Customers (round AM; round AY part 3: a proper table). Every trade customer (one with a profile, an order
// or a contract): name EN / JA, country, main contact, e-mail, phone, open orders, last delivery, invoice profile —
// sortable, searchable, rows selectable for a CSV export. "+ Add customer" opens the form in a drawer; the row opens
// the customer's profile.

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Box, Button, Chip } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import { useTranslations } from "next-intl";
import { useClientCustomers } from "../../_lib/hooks";
import type { ClientCustomerRow } from "../../_lib/api";
import { ClientsHeader, useBillingLabel, useLang } from "../_components/ClientsBits";
import ClientsTable, { type ClientsColumn } from "../_components/ClientsTable";
import CompanyDrawer from "../_components/CompanyDrawer";
import { ContactCell, lastDeliveryKey, lastDeliveryText, NameCell } from "../_components/ClientColumns";
import { useUserPermissions } from "@/app/portal/hooks/useUserPermissions";

export default function ClientsCustomersPage() {
  const router = useRouter();
  const lang = useLang();
  const tb = useTranslations("clients.bits");
  const t = useTranslations("clients.list");
  const billingLabel = useBillingLabel();
  const list = useClientCustomers();
  const { hasPermission, userRoles } = useUserPermissions();
  const canAdd = hasPermission("customers", "create") || userRoles.length === 0;
  const [add, setAdd] = useState(false);
  const href = (c: ClientCustomerRow) => `/portal/shipments/clients/customers/${c.id}`;
  const columns: ClientsColumn<ClientCustomerRow>[] = [
    { id: "name", label: t("customer"), minWidth: 200, value: (c) => `${c.short} ${c.name} ${c.jpName ?? ""}`, render: (c) => <NameCell short={c.short} name={c.name} ja={c.jpName} /> },
    { id: "country", label: t("country"), value: (c) => c.country ?? "" },
    { id: "contact", label: t("mainContact"), minWidth: 160, value: (c) => [c.mainContact?.name, c.mainContact?.email].filter(Boolean).join(" "), render: (c) => <ContactCell c={c.mainContact} /> },
    { id: "email", label: t("email"), value: (c) => c.email ?? "" },
    { id: "phone", label: t("phone"), value: (c) => c.phone ?? "" },
    { id: "open", label: tb("openOrders"), align: "right", value: (c) => c.openOrders },
    { id: "last", label: tb("lastDelivery"), value: (c) => lastDeliveryKey(c.lastDelivery), render: (c) => lastDeliveryText(c.lastDelivery) || "—" },
    { id: "billing", label: tb("invoice"), value: (c) => billingLabel(c.billingMode), render: (c) => <Chip size="small" variant="outlined" color={c.billingMode === "SINGLE" ? "secondary" : "default"} label={c.hasProfile ? billingLabel(c.billingMode) : t("withDefault", { label: billingLabel(c.billingMode) })} /> },
  ];
  return (
    <Box sx={{ p: { xs: 1.5, md: 3 } }} data-tour="clients-customers">
      <ClientsHeader active="customers" />
      {list.isError && <Alert severity="error">{(list.error as Error)?.message || t("customersError")}</Alert>}
      <ClientsTable
        rows={list.data ?? []}
        columns={columns}
        rowKey={(c) => c.id}
        onOpen={(c) => router.push(href(c))}
        loading={list.isLoading}
        csvName="customers"
        lang={lang}
        dataTour="clients-customers-table"
        menu={(c) => [
          { label: t("open"), onClick: () => router.push(href(c)) },
          { label: t("editDetails"), onClick: () => router.push(`${href(c)}?tab=details&edit=1`) },
        ]}
        actions={canAdd ? <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={() => setAdd(true)} data-tour="clients-add-customer">{t("addCustomer")}</Button> : null}
      />
      <CompanyDrawer kind="customer" open={add} initial={null} onClose={() => setAdd(false)} onSaved={(id) => id && router.push(`/portal/shipments/clients/customers/${id}?tab=details`)} lang={lang} />
    </Box>
  );
}
