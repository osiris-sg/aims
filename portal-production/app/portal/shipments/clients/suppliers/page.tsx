/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Clients › Suppliers (round AM; round AY part 3: a proper table). Every trade supplier (one with a profile, a
// contract or an order): name EN / JA, country, main contact, e-mail, phone, open orders, last delivery, PI status —
// sortable, searchable, rows selectable for a CSV export. "+ Add supplier" opens the form in a drawer.

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Box, Button, Chip, Stack } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import { useClientSuppliers } from "../../_lib/hooks";
import type { ClientSupplierRow } from "../../_lib/api";
import { ClientsHeader, T, useLang } from "../_components/ClientsBits";
import ClientsTable, { type ClientsColumn } from "../_components/ClientsTable";
import CompanyDrawer from "../_components/CompanyDrawer";
import { ContactCell, lastDeliveryKey, lastDeliveryText, NameCell } from "../_components/ClientColumns";
import { useUserPermissions } from "@/app/portal/hooks/useUserPermissions";

export default function ClientsSuppliersPage() {
  const router = useRouter();
  const lang = useLang();
  const L = T[lang];
  const ja = lang === "ja";
  const list = useClientSuppliers();
  const { hasPermission, userRoles } = useUserPermissions();
  const canAdd = hasPermission("suppliers", "create") || userRoles.length === 0;
  const [add, setAdd] = useState(false);
  const href = (s: ClientSupplierRow) => `/portal/shipments/clients/suppliers/${s.id}`;
  const columns: ClientsColumn<ClientSupplierRow>[] = [
    { id: "name", label: ja ? "仕入先" : "Supplier", minWidth: 200, value: (s) => `${s.short} ${s.name} ${s.jpName ?? ""}`, render: (s) => <NameCell short={s.short} name={s.name} ja={s.jpName} /> },
    { id: "country", label: ja ? "国" : "Country", value: (s) => s.country ?? "" },
    { id: "contact", label: ja ? "主担当" : "Main contact", minWidth: 160, value: (s) => [s.mainContact?.name, s.mainContact?.email].filter(Boolean).join(" "), render: (s) => <ContactCell c={s.mainContact} /> },
    { id: "email", label: ja ? "メール" : "E-mail", value: (s) => s.email ?? "" },
    { id: "phone", label: ja ? "電話" : "Phone", value: (s) => s.phone ?? "" },
    { id: "open", label: L.openOrders, align: "right", value: (s) => s.openOrders },
    { id: "last", label: L.lastDelivery, value: (s) => lastDeliveryKey(s.lastDelivery ?? s.stats?.lastDelivery), render: (s) => lastDeliveryText(s.lastDelivery ?? s.stats?.lastDelivery) || "—" },
    {
      id: "pi",
      label: L.piStatus,
      value: (s) => (s.pi ? s.pi.waiting + s.pi.received + s.pi.depositPaid : -1),
      render: (s) =>
        s.pi ? (
          <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
            {s.pi.waiting ? <Chip size="small" variant="outlined" label={`${ja ? "PI待ち" : "waiting"} ${s.pi.waiting}`} /> : null}
            {s.pi.received ? <Chip size="small" variant="outlined" color="info" label={`${ja ? "PI受領" : "PI in"} ${s.pi.received}`} /> : null}
            {s.pi.depositPaid ? <Chip size="small" variant="outlined" color="success" label={`${ja ? "前払済" : "deposit paid"} ${s.pi.depositPaid}`} /> : null}
          </Stack>
        ) : (
          <Chip size="small" variant="outlined" label={ja ? "PIなし" : "no PI"} />
        ),
    },
  ];
  return (
    <Box sx={{ p: { xs: 1.5, md: 3 } }} data-tour="clients-suppliers">
      <ClientsHeader active="suppliers" />
      {list.isError && <Alert severity="error">{(list.error as Error)?.message || "Could not load suppliers"}</Alert>}
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
          { label: ja ? "開く" : "Open", onClick: () => router.push(href(s)) },
          { label: ja ? "詳細を編集" : "Edit details", onClick: () => router.push(`${href(s)}?tab=details&edit=1`) },
        ]}
        actions={canAdd ? <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={() => setAdd(true)} data-tour="clients-add-supplier">{ja ? "仕入先を追加" : "Add supplier"}</Button> : null}
      />
      <CompanyDrawer kind="supplier" open={add} initial={null} onClose={() => setAdd(false)} onSaved={(id) => id && router.push(`/portal/shipments/clients/suppliers/${id}?tab=details`)} lang={lang} />
    </Box>
  );
}
