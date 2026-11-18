"use client";

import React from "react";
import { useRouter } from "next/navigation";
import moment from "moment";
import { Box, IconButton, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tooltip, Typography } from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import RemoveCircleOutlineIcon from "@mui/icons-material/RemoveCircleOutline";
import MainCard from "@/components/MainCard";
import StatusPill from "../_components/StatusPill";
import { importedDocHref, importedLinkSourceLabel, importedMoney, importedStatusHue, type ImportedOrder } from "@/helpers/importedOrders";

/**
 * An order imported from the old ERP (enableImportedOrders): read-only. Tracker
 * Quotation -> Invoice done, DO and Service report not applicable (the ERP's DO
 * number as text). No actions: no DO, job, invoice, service report, cancel or edit.
 */
export default function ImportedOrderDetail({ order, onBack }: { order: ImportedOrder; onBack: () => void }) {
  const q = order.sourceQuotation;
  const qHref = importedDocHref(q, "QUOTATION");
  return (
    <MainCard>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
        <IconButton size="small" onClick={onBack} aria-label="Back to orders">
          <ArrowBackIcon fontSize="small" />
        </IconButton>
        <Typography variant="caption" color="text.secondary">
          Orders
        </Typography>
      </Stack>

      <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
        <Typography variant="h5" sx={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
          {order.orderNumber}
        </Typography>
        <StatusPill label={order.statusLabel || order.status} color="default" hue={importedStatusHue(order.status)} />
        <StatusPill label="Imported" color="default" variant="outlined" />
        <Tooltip title="Imported from the old ERP: its quotation and the invoices the ERP linked to it. Read-only.">
          <InfoOutlinedIcon fontSize="small" sx={{ color: "text.secondary" }} />
        </Tooltip>
      </Stack>

      <Stack direction="row" spacing={3} sx={{ mb: 3 }} flexWrap="wrap" useFlexGap>
        <Field label="Customer" value={order.customer?.name || ""} />
        <Field label="Order date" value={q?.date ? moment(q.date).format("DD/MM/YYYY") : moment(order.createdAt).format("DD/MM/YYYY")} />
        <Field label="Subject" value={order.subject || ""} />
        <Field label="Quotation total" value={importedMoney(order.quoteTotal ?? q?.total ?? null)} />
        <Field label="Billed" value={importedMoney(order.billed ?? order.total)} />
        {!!order.credited && <Field label="Credited" value={importedMoney(order.credited)} />}
        <Field label="Owed" value={importedMoney(order.owed)} />
      </Stack>

      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ mb: 3 }} data-tour="imported-order-tracker">
        {order.tracker.map((s) => (
          <Box key={s.key} sx={{ flex: 1, p: 1.5, border: 1, borderColor: "divider", borderRadius: 1, opacity: s.state === "na" ? 0.7 : 1 }}>
            <Stack direction="row" spacing={1} alignItems="center">
              {s.state === "done" ? <CheckCircleIcon fontSize="small" color="success" /> : <RemoveCircleOutlineIcon fontSize="small" sx={{ color: "text.disabled" }} />}
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {s.label}
              </Typography>
            </Stack>
            <Typography variant="caption" color="text.secondary">
              {s.state === "na" ? (s.note ? `Not applicable, ${s.note}` : "Not applicable") : s.note || "Done"}
            </Typography>
          </Box>
        ))}
      </Stack>

      <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
        Documents
      </Typography>
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Document</TableCell>
              <TableCell>Date</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Linked by</TableCell>
              <TableCell>ERP DO</TableCell>
              <TableCell align="right">Amount</TableCell>
              <TableCell align="right">Owed</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {q && (
              <DocRow href={qHref} name={`Quotation ${q.name ?? ""}`} date={q.date} state="" by="" doNo="" amount={q.total} owed={null} />
            )}
            {order.invoices.map((i) => (
              <DocRow key={i.id} href={importedDocHref(i, "INVOICE")} name={`Invoice ${i.name ?? ""}`} date={i.date} state={i.credit && i.state !== "CREDITED" ? `${i.stateLabel ?? ""}, credited ${importedMoney(i.credit)}` : i.stateLabel ?? ""} by={importedLinkSourceLabel(i.linkSource)} doNo={i.erpDoNumber || ""} amount={i.total} owed={i.owed} />
            ))}
            {order.creditNotes.map((c) => (
              <DocRow key={c.id} href={importedDocHref(c, "CREDIT_NOTE")} name={`Credit note ${c.name ?? ""}`} date={null} state="" by="" doNo="" amount={c.total} owed={null} />
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </MainCard>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2">{value}</Typography>
    </Box>
  );
}

function DocRow({ href, name, date, state, by, doNo, amount, owed }: { href: string | null; name: string; date?: string | null; state: string; by: string; doNo: string; amount?: number | null; owed: number | null }) {
  const router = useRouter();
  return (
    <TableRow hover sx={href ? { cursor: "pointer" } : undefined} onClick={() => href && router.push(href)}>
      <TableCell>{name}</TableCell>
      <TableCell sx={{ whiteSpace: "nowrap" }}>{date ? moment(date).format("DD/MM/YYYY") : ""}</TableCell>
      <TableCell>{state}</TableCell>
      <TableCell>{by}</TableCell>
      <TableCell>{doNo}</TableCell>
      <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>
        {importedMoney(amount)}
      </TableCell>
      <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>
        {owed == null ? "" : importedMoney(owed)}
      </TableCell>
    </TableRow>
  );
}
