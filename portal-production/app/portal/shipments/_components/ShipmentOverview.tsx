"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Button, Grid2, Paper, Stack, Typography } from "@mui/material";
import EditIcon from "@mui/icons-material/EditOutlined";
import type { Shipment } from "../_lib/api";
import { fmtDateTime, fmtDay, fmtMoney, fmtMonth, fmtMt } from "../_lib/format";
import { Field } from "./bits";
import ShipmentFormDialog from "./ShipmentFormDialog";
import BlCheckPanel from "./BlCheckPanel";

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
  const [editOpen, setEditOpen] = useState(false);
  return (
    <Stack spacing={2}>
      <Stack direction="row" justifyContent="flex-end">
        <Button variant="outlined" startIcon={<EditIcon />} onClick={() => setEditOpen(true)}>
          Edit
        </Button>
      </Stack>
      {s.blCheck && <BlCheckPanel check={s.blCheck} shipmentId={s.id} canEdit={s.status === "OPEN"} />}
      <Section title="Contract">
        <Cell>
          <Field label="Contract no." value={s.contract ? <Link href={`/portal/shipments/contracts/${s.contract.id}`}>{s.contract.contractNo}</Link> : null} />
        </Cell>
        <Cell>
          <Field label="PI no." value={s.contract?.piNumber} />
        </Cell>
        <Cell>
          <Field label="Supplier" value={s.contract?.supplier?.name} />
        </Cell>
        <Cell>
          <Field label="Customer" value={s.customer?.name} />
        </Cell>
        <Grid2 size={{ xs: 12, md: 6 }}>
          <Field label="Product line" value={s.productLine} />
        </Grid2>
        <Cell>
          <Field label="Delivery month" value={fmtMonth(s.deliveryMonth)} />
        </Cell>
      </Section>
      <Section title="Vessel">
        <Cell>
          <Field label="B/L no." value={s.blNumber} />
        </Cell>
        <Cell>
          <Field label="Vessel" value={s.vessel} />
        </Cell>
        <Cell>
          <Field label="Voyage no." value={s.voyageNo} />
        </Cell>
        <Cell>
          <Field label="Shipping line" value={s.shippingLine} />
        </Cell>
        <Cell>
          <Field label="ETD" value={fmtDay(s.etd)} />
        </Cell>
        <Cell>
          <Field label="Latest ETA" value={fmtDay(s.eta)} />
        </Cell>
        <Cell>
          <Field label="Actual arrival" value={s.actualArrivalDate ? fmtDay(s.actualArrivalDate) : null} />
        </Cell>
        <Cell>
          <Field label="Telex release code" value={s.telexReleaseCode} />
        </Cell>
        <Cell>
          <Field label="Port of loading" value={s.portOfLoading} />
        </Cell>
        <Cell>
          <Field label="Port of discharge" value={s.portOfDischarge} />
        </Cell>
      </Section>
      <Section title="Cargo">
        <Cell>
          <Field label="Net weight (MT)" value={fmtMt(s.netWeightMt)} />
        </Cell>
        <Cell>
          <Field label="Gross weight (MT)" value={fmtMt(s.grossWeightMt)} />
        </Cell>
        <Cell>
          <Field label="Bundles" value={s.totalBundles?.toLocaleString("en-US")} />
        </Cell>
        <Cell>
          <Field label="Pieces" value={s.totalPieces?.toLocaleString("en-US")} />
        </Cell>
        <Cell>
          <Field label="Containers" value={s.containerCount?.toLocaleString("en-US")} />
        </Cell>
        <Cell>
          <Field label="HS code" value={s.hsCode} />
        </Cell>
        <Cell>
          <Field label="Country of origin" value={s.countryOfOrigin} />
        </Cell>
        <Cell>
          <Field label="Commodity" value={s.commodity} />
        </Cell>
        <Cell>
          <Field label="Size / spec" value={s.sizeSpec} />
        </Cell>
      </Section>
      <Section title="Commercial invoice">
        <Cell>
          <Field label="CI no." value={s.ciNumber} />
        </Cell>
        <Cell>
          <Field label="CI amount" value={fmtMoney(s.ciAmount, s.currency)} />
        </Cell>
        <Cell>
          <Field label="Currency" value={s.currency} />
        </Cell>
        <Cell>
          <Field label="Last updated" value={fmtDateTime(s.updatedAt)} />
        </Cell>
        <Grid2 size={12}>
          <Field label="Notes" value={s.notes} />
        </Grid2>
      </Section>
      <ShipmentFormDialog open={editOpen} onClose={() => setEditOpen(false)} shipment={s} />
    </Stack>
  );
}
