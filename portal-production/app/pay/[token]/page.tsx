"use client";

// Public "Click to pay" page (guru 2026-08-06, Aspire concept): reached from
// the invoice email button — no login. Left: the invoice PDF. Right: payment
// panel — amount, dates, status, then Bank Transfer details and a PayNow QR
// when the org has them configured in Accounting Setup → Payment Details.

import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  Accordion, AccordionDetails, AccordionSummary, Box, Chip, CircularProgress, Paper, Stack, Typography,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";

const fmt = (n: number) =>
  (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dmy = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";

type Payload = {
  invoiceNumber: string;
  amount: number;
  currency: string;
  invoiceDate: string | null;
  dueDate: string | null;
  status: "PAID" | "DUE" | "OVERDUE";
  organization: { name: string; logo: string | null };
  bank: {
    accountName?: string; accountNumber?: string; bankName?: string;
    swiftCode?: string; branchCode?: string; bankCode?: string; currencyCode?: string;
  } | null;
  paynowQrUrl: string | null;
  pdfUrl: string | null;
};

export default function PublicPayPage() {
  const params = useParams();
  const token = String(params?.token || "");
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const base = process.env.NEXT_PUBLIC_BACKEND_API_URL || "http://localhost:4040";
        const res = await fetch(`${base}/public-pay/${token}`);
        const json = await res.json();
        if (!res.ok) throw new Error("This payment link is invalid or has expired.");
        setData(json?.data ?? json);
      } catch (e: any) {
        setError(e?.message || "Failed to load");
      }
    })();
  }, [token]);

  if (error) {
    return (
      <Box sx={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", bgcolor: "#f4f5f7" }}>
        <Paper variant="outlined" sx={{ p: 4, borderRadius: 2 }}>
          <Typography>{error}</Typography>
        </Paper>
      </Box>
    );
  }
  if (!data) {
    return (
      <Box sx={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", bgcolor: "#f4f5f7" }}>
        <CircularProgress />
      </Box>
    );
  }

  const statusColor = data.status === "PAID" ? "success" : data.status === "OVERDUE" ? "error" : "warning";
  const detail = (label: string, value?: string) =>
    value ? (
      <Stack direction="row" sx={{ py: 0.4 }}>
        <Typography variant="body2" sx={{ width: 150, color: "text.secondary" }}>{label}</Typography>
        <Typography variant="body2" sx={{ mr: 0.5 }}>:</Typography>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>{value}</Typography>
      </Stack>
    ) : null;

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "#f4f5f7", p: { xs: 1.5, md: 4 } }}>
      {/* Full-width layout: the invoice gets every pixel the payment panel
          doesn't need (guru 2026-08-19 — the preview was too small to read). */}
      <Box sx={{ width: "100%", display: "grid", gridTemplateColumns: { xs: "1fr", md: "minmax(0, 1fr) minmax(420px, 520px)" }, gap: 3 }}>
        {/* Invoice PDF */}
        <Paper variant="outlined" sx={{ borderRadius: 2, overflow: "hidden", minHeight: { xs: 420, md: "88vh" }, bgcolor: "#2b2b2b" }}>
          {data.pdfUrl ? (
            <iframe title="Invoice" src={`${data.pdfUrl}#toolbar=0&view=FitH`} style={{ width: "100%", height: "100%", minHeight: 420, border: 0 }} />
          ) : (
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#fff" }}>
              <Typography variant="body2">Invoice preview unavailable</Typography>
            </Box>
          )}
        </Paper>

        {/* Payment panel */}
        <Box>
          <Stack direction="row" alignItems="flex-start" justifyContent="space-between" sx={{ mb: 1.5 }}>
            <Box>
              <Typography variant="caption" sx={{ color: "text.secondary" }}>Payment to</Typography>
              <Typography variant="h5" sx={{ fontWeight: 700, textTransform: "uppercase" }}>{data.organization.name}</Typography>
            </Box>
            {data.organization.logo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={data.organization.logo} alt="" style={{ maxHeight: 42, maxWidth: 140, objectFit: "contain" }} />
            )}
          </Stack>

          <Paper variant="outlined" sx={{ borderRadius: 2, overflow: "hidden", mb: 2 }}>
            <Box sx={{ p: 2, bgcolor: "#eef0f2", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <Box>
                <Typography variant="caption" sx={{ color: "text.secondary" }}>Payment amount</Typography>
                <Stack direction="row" alignItems="center" gap={1}>
                  <Chip size="small" label={data.currency} sx={{ bgcolor: "#0b7a3e", color: "#fff", fontWeight: 700 }} />
                  <Typography variant="h4" sx={{ fontWeight: 700 }}>{fmt(data.amount)}</Typography>
                </Stack>
              </Box>
              <Typography variant="body2" sx={{ color: "text.secondary" }}>#{data.invoiceNumber}</Typography>
            </Box>
            <Stack direction="row" gap={6} sx={{ p: 2 }}>
              <Box>
                <Typography variant="caption" sx={{ color: "text.secondary" }}>Invoice date</Typography>
                <Typography variant="body1" sx={{ fontWeight: 600 }}>{dmy(data.invoiceDate)}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" sx={{ color: "text.secondary" }}>Due date</Typography>
                <Typography variant="body1" sx={{ fontWeight: 600 }}>{dmy(data.dueDate)}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" sx={{ color: "text.secondary" }}>Status</Typography>
                <Box><Chip size="small" color={statusColor as any} label={data.status === "PAID" ? "Paid" : data.status === "OVERDUE" ? "Overdue" : "Due"} /></Box>
              </Box>
            </Stack>
          </Paper>

          <Typography variant="body2" sx={{ textAlign: "center", color: "text.secondary", mb: 1.5 }}>
            Select a payment option below:
          </Typography>

          {data.paynowQrUrl && (
            <Accordion defaultExpanded variant="outlined" sx={{ borderRadius: 2, mb: 1.5, "&:before": { display: "none" } }}>
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography sx={{ fontWeight: 700 }}>PayNow</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Stack alignItems="center" gap={1}>
                  <Typography variant="body2" sx={{ color: "text.secondary" }}>
                    Scan with your banking app, pay <b>{data.currency} {fmt(data.amount)}</b> and enter{" "}
                    <b>{data.invoiceNumber}</b> as the reference.
                  </Typography>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={data.paynowQrUrl} alt="PayNow QR" style={{ maxWidth: 260, width: "100%" }} />
                </Stack>
              </AccordionDetails>
            </Accordion>
          )}

          {data.bank && (
            <Accordion defaultExpanded={!data.paynowQrUrl} variant="outlined" sx={{ borderRadius: 2, "&:before": { display: "none" } }}>
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography sx={{ fontWeight: 700 }}>Bank Transfer</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Typography variant="body2" sx={{ mb: 1 }}>
                  1. Use the account details below to transfer the above amount.<br />
                  2. Enter the invoice number <b>{data.invoiceNumber}</b> in the Reference field while paying.
                </Typography>
                <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, bgcolor: "#f6f7f8" }}>
                  <Typography variant="body2" sx={{ fontWeight: 700, mb: 1 }}>🇸🇬 For bank transfers from Singapore</Typography>
                  {detail("Account Name", data.bank.accountName)}
                  {detail("Account number", data.bank.accountNumber)}
                  {detail("Name", data.bank.bankName)}
                  {detail("SWIFT/BIC", data.bank.swiftCode)}
                  {detail("Branch code", data.bank.branchCode)}
                  {detail("Bank", data.bank.bankCode)}
                  {detail("Currency code", data.bank.currencyCode)}
                </Paper>
              </AccordionDetails>
            </Accordion>
          )}

          {!data.bank && !data.paynowQrUrl && (
            <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
              <Typography variant="body2" sx={{ color: "text.secondary" }}>
                Payment details have not been configured yet — please contact {data.organization.name} for payment instructions.
              </Typography>
            </Paper>
          )}
        </Box>
      </Box>
    </Box>
  );
}
