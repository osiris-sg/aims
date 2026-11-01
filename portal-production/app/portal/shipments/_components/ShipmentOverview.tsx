"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Button, Grid2, Paper, Stack, Typography } from "@mui/material";
import EditIcon from "@mui/icons-material/EditOutlined";
import type { Shipment } from "../_lib/api";
import { fmtDateTime, fmtDay, fmtMoney, fmtMonth, fmtMt } from "../_lib/format";
import { useTranslations } from "next-intl";
import { Field } from "./bits";
import ShipmentFormDialog from "./ShipmentFormDialog";
import BlCheckPanel from "./BlCheckPanel";
import PortStoragePanel from "./PortStoragePanel";

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <Paper variant="outlined" sx={{ p: 2 }}>
    <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
      {title}
    </Typography>
    <Grid2 container spacing={2}>
      {children}
    </Grid2>
  </Paper>
);
const Cell = ({ children }: { children: React.ReactNode }) => <Grid2 size={{ xs: 6, md: 3 }}>{children}</Grid2>;

export default function ShipmentOverview({ shipment: s }: { shipment: Shipment }) {
  const t = useTranslations("shipments.shipmentOverview");
  const [editOpen, setEditOpen] = useState(false);
  return (
    <Stack spacing={2}>
      <Stack direction="row" justifyContent="flex-end">
        <Button variant="outlined" startIcon={<EditIcon />} onClick={() => setEditOpen(true)}>
          {t("edit")}
        </Button>
      </Stack>
      {s.blCheck && <BlCheckPanel check={s.blCheck} shipmentId={s.id} canEdit={s.status === "OPEN"} />}
      <PortStoragePanel shipment={s} />
      <Section title={t("contract")}>
        <Cell>
          <Field label={t("contractNo")} value={s.contract ? <Link href={`/portal/shipments/contracts/${s.contract.id}`}>{s.contract.contractNo}</Link> : null} />
        </Cell>
        <Cell>
          <Field label={t("piNo")} value={s.contract?.piNumber} />
        </Cell>
        <Cell>
          <Field label={t("supplier")} value={s.contract?.supplier?.name} />
        </Cell>
        <Cell>
          <Field label={t("customer")} value={s.customer?.name} />
        </Cell>
        <Grid2 size={{ xs: 12, md: 6 }}>
          <Field label={t("productLine")} value={s.productLine} />
        </Grid2>
        <Cell>
          <Field label={t("deliveryMonth")} value={fmtMonth(s.deliveryMonth)} />
        </Cell>
      </Section>
      <Section title={t("vessel")}>
        <Cell>
          <Field label={t("blNo")} value={s.blNumber} />
        </Cell>
        <Cell>
          <Field label={t("vessel")} value={s.vessel} />
        </Cell>
        <Cell>
          <Field label={t("voyageNo")} value={s.voyageNo} />
        </Cell>
        <Cell>
          <Field label={t("shippingLine")} value={s.shippingLine} />
        </Cell>
        <Cell>
          <Field label={t("etd")} value={fmtDay(s.etd)} />
        </Cell>
        <Cell>
          <Field label={t("latestEta")} value={fmtDay(s.eta)} />
        </Cell>
        <Cell>
          <Field label={t("actualArrival")} value={s.actualArrivalDate ? fmtDay(s.actualArrivalDate) : null} />
        </Cell>
        <Cell>
          <Field label={t("telexReleaseCode")} value={s.telexReleaseCode} />
        </Cell>
        <Cell>
          <Field label={t("portOfLoading")} value={s.portOfLoading} />
        </Cell>
        <Cell>
          <Field label={t("portOfDischarge")} value={s.portOfDischarge} />
        </Cell>
      </Section>
      <Section title={t("cargo")}>
        <Cell>
          <Field label={t("netWeight")} value={fmtMt(s.netWeightMt)} />
        </Cell>
        <Cell>
          <Field label={t("grossWeight")} value={fmtMt(s.grossWeightMt)} />
        </Cell>
        <Cell>
          <Field label={t("bundles")} value={s.totalBundles?.toLocaleString("en-US")} />
        </Cell>
        <Cell>
          <Field label={t("pieces")} value={s.totalPieces?.toLocaleString("en-US")} />
        </Cell>
        <Cell>
          <Field label={t("containers")} value={s.containerCount?.toLocaleString("en-US")} />
        </Cell>
        <Cell>
          <Field label={t("hsCode")} value={s.hsCode} />
        </Cell>
        <Cell>
          <Field label={t("countryOfOrigin")} value={s.countryOfOrigin} />
        </Cell>
        <Cell>
          <Field label={t("commodity")} value={s.commodity} />
        </Cell>
        <Cell>
          <Field label={t("sizeSpec")} value={s.sizeSpec} />
        </Cell>
      </Section>
      <Section title={t("commercialInvoice")}>
        <Cell>
          <Field label={t("ciNo")} value={s.ciNumber} />
        </Cell>
        <Cell>
          <Field label={t("ciAmount")} value={fmtMoney(s.ciAmount, s.currency)} />
        </Cell>
        <Cell>
          <Field label={t("currency")} value={s.currency} />
        </Cell>
        <Cell>
          <Field label={t("lastUpdated")} value={fmtDateTime(s.updatedAt)} />
        </Cell>
        <Grid2 size={12}>
          <Field label={t("notes")} value={s.notes} />
        </Grid2>
      </Section>
      <ShipmentFormDialog open={editOpen} onClose={() => setEditOpen(false)} shipment={s} />
    </Stack>
  );
}
