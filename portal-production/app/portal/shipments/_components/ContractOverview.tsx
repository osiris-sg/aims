"use client";

import React, { useState } from "react";
import { Box, Button, Grid2, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from "@mui/material";
import EditIcon from "@mui/icons-material/EditOutlined";
import type { Contract } from "../_lib/api";
import { depositTermLabel, fmtDateTime, fmtDay, fmtDmy, fmtMoney, fmtMonth, fmtMt } from "../_lib/format";
import { Field } from "./bits";
import ContractFormDialog from "./ContractFormDialog";

const Cell = ({ children, wide }: { children: React.ReactNode; wide?: boolean }) => <Grid2 size={wide ? { xs: 12, md: 6 } : { xs: 6, md: 3 }}>{children}</Grid2>;

const Section = ({ n, title, children }: { n: number; title: string; children: React.ReactNode }) => (
  <Paper variant="outlined" sx={{ p: 2 }}>
    <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
      {n}. {title}
    </Typography>
    {children}
  </Paper>
);

const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
const premium = (v: unknown) => {
  const n = num(v);
  return n === null ? "—" : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export default function ContractOverview({ contract: c }: { contract: Contract }) {
  const [editOpen, setEditOpen] = useState(false);
  const shippedBy = (lineId: string) => c.shipments.filter((s) => s.contractLineId === lineId).length;
  return (
    <Stack spacing={2}>
      <Stack direction="row" justifyContent="flex-end">
        <Button variant="outlined" startIcon={<EditIcon />} onClick={() => setEditOpen(true)}>
          Edit
        </Button>
      </Stack>

      <Section n={1} title="Contract & parties">
        <Grid2 container spacing={2}>
          <Cell>
            <Field label="Contract no." value={c.contractNo} />
          </Cell>
          <Cell>
            <Field label="PI no." value={c.piNumber} />
          </Cell>
          <Cell>
            <Field label="PI date" value={c.piDate ? fmtDay(c.piDate) : null} />
          </Cell>
          <Cell>
            <Field label="Currency" value={c.currency} />
          </Cell>
          <Cell>
            <Field label="Supplier" value={c.supplier?.name} />
          </Cell>
          <Cell>
            <Field label="Customer" value={c.customer?.name} />
          </Cell>
          <Cell>
            <Field label="Destination port" value={c.destinationPort} />
          </Cell>
          <Cell>
            <Field label="Destination country" value={c.destinationCountry} />
          </Cell>
          <Cell>
            <Field label="Incoterm" value={c.incoterm} />
          </Cell>
          <Cell>
            <Field label="Shipment month" value={fmtMonth(c.shipmentMonth)} />
          </Cell>
          <Cell>
            <Field label="Delivery month" value={fmtMonth(c.deliveryMonth)} />
          </Cell>
          <Cell>
            <Field label="Last updated" value={fmtDateTime(c.updatedAt)} />
          </Cell>
          <Grid2 size={12}>
            <Field label="Notes" value={c.notes} />
          </Grid2>
        </Grid2>
      </Section>

      <Section n={2} title="B/L instructions">
        <Grid2 container spacing={2}>
          <Cell wide>
            <Field label="Consignee" value={c.consignee} />
          </Cell>
          <Cell wide>
            <Field label="Notify party" value={c.notifyParty} />
          </Cell>
        </Grid2>
      </Section>

      <Section n={3} title="Product lines">
        <Box sx={{ overflowX: "auto" }}>
          <Table size="small" sx={{ "& th": { color: "text.secondary", whiteSpace: "nowrap" }, "& td.num, & th.num": { textAlign: "right", fontVariantNumeric: "tabular-nums" } }}>
            <TableHead>
              <TableRow>
                <TableCell>#</TableCell>
                <TableCell>Grade</TableCell>
                <TableCell>Size / spec</TableCell>
                <TableCell>Product</TableCell>
                <TableCell className="num">Qty (MT)</TableCell>
                <TableCell className="num">Tolerance</TableCell>
                <TableCell className="num">Vedanta premium (USD/t)</TableCell>
                <TableCell className="num">Client premium (USD/t)</TableCell>
                <TableCell className="num">Shipments</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {c.lines.map((l, i) => (
                <TableRow key={l.id}>
                  <TableCell>{i + 1}</TableCell>
                  <TableCell>{l.grade || "—"}</TableCell>
                  <TableCell>{l.sizeSpec || "—"}</TableCell>
                  <TableCell>{l.product || "—"}</TableCell>
                  <TableCell className="num">{fmtMt(l.quantityMt)}</TableCell>
                  <TableCell className="num">{num(l.tolerancePct) === null ? "—" : `±${num(l.tolerancePct)}%`}</TableCell>
                  <TableCell className="num">{premium(l.supplierPremium)}</TableCell>
                  <TableCell className="num">{premium(l.clientPremium)}</TableCell>
                  <TableCell className="num">{shippedBy(l.id)}</TableCell>
                </TableRow>
              ))}
              <TableRow sx={{ "& td": { fontWeight: 700, borderBottom: 0 } }}>
                <TableCell colSpan={4}>Total</TableCell>
                <TableCell className="num">{fmtMt(c.totalQuantityMt)}</TableCell>
                <TableCell colSpan={4} />
              </TableRow>
            </TableBody>
          </Table>
        </Box>
      </Section>

      <Section n={4} title="PI payment">
        <Grid2 container spacing={2}>
          <Cell>
            <Field label="PI amount" value={fmtMoney(c.piAmount, c.currency)} />
          </Cell>
          <Cell>
            <Field label="Deposit %" value={num(c.depositPercent) === null ? null : `${num(c.depositPercent)}%`} />
          </Cell>
          <Cell>
            <Field label="Deposit amount" value={fmtMoney(c.depositAmount, c.currency)} />
          </Cell>
          <Cell>
            <Field label="Deposit paid on" value={c.depositPaidAt ? fmtDay(c.depositPaidAt) : null} />
          </Cell>
          <Grid2 size={12}>
            <Field
              label="Deposit due"
              value={
                depositTermLabel(c.depositDueDays, c.depositDueUnit)
                  ? `${depositTermLabel(c.depositDueDays, c.depositDueUnit)} after the PI date${c.depositDueDate ? ` → ${fmtDmy(c.depositDueDate)}` : ""}`
                  : c.depositDueNote
              }
            />
          </Grid2>
        </Grid2>
      </Section>
      <ContractFormDialog open={editOpen} onClose={() => setEditOpen(false)} contract={c} />
    </Stack>
  );
}
