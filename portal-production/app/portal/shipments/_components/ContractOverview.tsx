"use client";

import React, { useState } from "react";
import { Box, Button, Grid2, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from "@mui/material";
import EditIcon from "@mui/icons-material/EditOutlined";
import { useTranslations } from "next-intl";
import type { Contract } from "../_lib/api";
import { fmtDateTime, fmtDay, fmtDmy, fmtMoney, fmtMonth, fmtMt } from "../_lib/format";
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
  const t = useTranslations("contracts.fields");
  const term = c.depositDueDays === null || c.depositDueDays === undefined ? null : t(c.depositDueUnit === "CALENDAR" ? "calendarDaysN" : "businessDaysN", { n: c.depositDueDays });
  const shippedBy = (lineId: string) => c.shipments.filter((s) => s.contractLineId === lineId).length;
  return (
    <Stack spacing={2}>
      <Stack direction="row" justifyContent="flex-end">
        <Button variant="outlined" startIcon={<EditIcon />} onClick={() => setEditOpen(true)}>
          {t("edit")}
        </Button>
      </Stack>

      <Section n={1} title={t("sec1")}>
        <Grid2 container spacing={2}>
          <Cell>
            <Field label={t("contractNo")} value={c.contractNo} />
          </Cell>
          <Cell>
            <Field label={t("piNo")} value={c.piNumber} />
          </Cell>
          <Cell>
            <Field label={t("piDate")} value={c.piDate ? fmtDay(c.piDate) : null} />
          </Cell>
          <Cell>
            <Field label={t("currency")} value={c.currency} />
          </Cell>
          <Cell>
            <Field label={t("supplier")} value={c.supplier?.name} />
          </Cell>
          <Cell>
            <Field label={t("customer")} value={c.customer?.name} />
          </Cell>
          <Cell>
            <Field label={t("destPort")} value={c.destinationPort} />
          </Cell>
          <Cell>
            <Field label={t("destCountry")} value={c.destinationCountry} />
          </Cell>
          <Cell>
            <Field label={t("incoterm")} value={c.incoterm} />
          </Cell>
          <Cell>
            <Field label={t("shipmentMonth")} value={fmtMonth(c.shipmentMonth)} />
          </Cell>
          <Cell>
            <Field label={t("deliveryMonth")} value={fmtMonth(c.deliveryMonth)} />
          </Cell>
          <Cell>
            <Field label={t("lastUpdated")} value={fmtDateTime(c.updatedAt)} />
          </Cell>
          <Grid2 size={12}>
            <Field label={t("notes")} value={c.notes} />
          </Grid2>
        </Grid2>
      </Section>

      <Section n={2} title={t("sec2")}>
        <Grid2 container spacing={2}>
          <Cell wide>
            <Field label={t("consignee")} value={c.consignee} />
          </Cell>
          <Cell wide>
            <Field label={t("notifyParty")} value={c.notifyParty} />
          </Cell>
        </Grid2>
      </Section>

      <Section n={3} title={t("sec3")}>
        <Box sx={{ overflowX: "auto" }}>
          <Table size="small" sx={{ "& th": { color: "text.secondary", whiteSpace: "nowrap" }, "& td.num, & th.num": { textAlign: "right", fontVariantNumeric: "tabular-nums" } }}>
            <TableHead>
              <TableRow>
                <TableCell>#</TableCell>
                <TableCell>{t("grade")}</TableCell>
                <TableCell>{t("sizeSpec")}</TableCell>
                <TableCell>{t("product")}</TableCell>
                <TableCell className="num">{t("qtyMt")}</TableCell>
                <TableCell className="num">{t("tolerance")}</TableCell>
                <TableCell className="num">{t("vedantaPremium")}</TableCell>
                <TableCell className="num">{t("clientPremium")}</TableCell>
                <TableCell className="num">{t("shipments")}</TableCell>
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
                <TableCell colSpan={4}>{t("total")}</TableCell>
                <TableCell className="num">{fmtMt(c.totalQuantityMt)}</TableCell>
                <TableCell colSpan={4} />
              </TableRow>
            </TableBody>
          </Table>
        </Box>
      </Section>

      <Section n={4} title={t("sec4")}>
        <Grid2 container spacing={2}>
          <Cell>
            <Field label={t("piAmount")} value={fmtMoney(c.piAmount, c.currency)} />
          </Cell>
          <Cell>
            <Field label={t("depositPct")} value={num(c.depositPercent) === null ? null : `${num(c.depositPercent)}%`} />
          </Cell>
          <Cell>
            <Field label={t("depositAmount")} value={fmtMoney(c.depositAmount, c.currency)} />
          </Cell>
          <Cell>
            <Field label={t("depositPaidOn")} value={c.depositPaidAt ? fmtDay(c.depositPaidAt) : null} />
          </Cell>
          <Grid2 size={12}>
            <Field
              label={t("depositDue")}
              value={
                term
                  ? `${t("afterPi", { term })}${c.depositDueDate ? ` → ${fmtDmy(c.depositDueDate)}` : ""}`
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
