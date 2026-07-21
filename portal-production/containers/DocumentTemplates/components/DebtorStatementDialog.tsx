"use client";

// Debtor Statement-Of-Account (legacy screenshots 43-47): opened from the
// Official Receipt's side rail for the selected customer.
//  - Header: company name/address, cut-off date (editable), accounts code,
//    BALANCE B/F (outstanding before the cut-off month).
//  - Grid: the cut-off month's transactions (POST /statements/soa with
//    startDate = month start) with a movement-only running balance, then
//    TOTAL and GRAND TOTAL as aligned table rows.
//  - Bottom: 12 month boxes — outstanding by DOCUMENT month; click a non-zero
//    month for the legacy "Detailed Ageing Analysis".
//  - Print: opens the Xero-style Debtor Statement REPORT (guru 2026-07-20:
//    render on screen, no options-then-print flow) deep-linked to this
//    customer + cut-off; printing happens from the report footer.

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import PrintIcon from "@mui/icons-material/Print";
import { useAuth } from "@clerk/nextjs";
import { toast } from "react-toastify";

const fmt = (n: number) =>
  (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const R = (n: number) => Math.round(n * 100) / 100;
const dmy = (d: any) => (d ? new Date(d).toLocaleDateString("en-GB") : "—");

const apiCall = async (path: string, token: string | null, init?: RequestInit) => {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (typeof window !== "undefined") {
    const activeOrgId = window.sessionStorage.getItem("aims-admin-active-org");
    if (activeOrgId) headers["X-Active-Org-Id"] = activeOrgId;
  }
  const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_API_URL}${path}`, { ...init, headers });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.message || `Request failed (${res.status})`);
  // Statements endpoints double-wrap: interceptor {success,data} around the
  // service's own {success,data}.
  let out = json;
  while (out && typeof out === "object" && out.success !== undefined && out.data !== undefined) out = out.data;
  return out;
};

// Local date-part formatting — toISOString would shift a day back in UTC+ TZs.
const monthEndISO = (iso: string) => {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = d.getMonth();
  const last = new Date(y, m + 1, 0).getDate();
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
};
const monthStartISO = (iso: string) => `${iso.slice(0, 7)}-01`;

type SoaTx = {
  date: string;
  reference: string;
  description: string;
  transactionType: string;
  debit: number;
  credit: number;
};

type AgedDoc = {
  id: string;
  number: string;
  date: string;
  reference: string | null;
  total: number; // outstanding
  currency: string | null;
};

const MONTH_LABELS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

export default function DebtorStatementDialog({
  open,
  onClose,
  customer,
}: {
  open: boolean;
  onClose: () => void;
  customer: { id: string; name?: string; customerCode?: string; address?: string; email?: string } | null;
}) {
  const { getToken } = useAuth();
  const router = useRouter();
  const [cutOff, setCutOff] = useState(() => monthEndISO(new Date().toISOString().slice(0, 10)));
  const [loading, setLoading] = useState(false);
  const [opening, setOpening] = useState(0);
  const [closing, setClosing] = useState(0);
  const [txs, setTxs] = useState<SoaTx[]>([]);
  const [agedDocs, setAgedDocs] = useState<AgedDoc[]>([]);
  const [monthDetail, setMonthDetail] = useState<{ label: string; docs: AgedDoc[] } | null>(null);

  useEffect(() => {
    if (!open || !customer?.id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const token = await getToken();
        const [soa, aged] = await Promise.all([
          apiCall(`/statements/soa`, token, {
            method: "POST",
            body: JSON.stringify({
              customerId: customer.id,
              startDate: monthStartISO(cutOff),
              endDate: cutOff,
              format: "json",
            }),
          }),
          apiCall(`/statements/aged?side=receivable&asOf=${cutOff}&level=detail&ageingBy=documentDate`, token),
        ]);
        if (cancelled) return;
        setOpening(Number(soa?.statement?.openingBalance) || 0);
        setClosing(Number(soa?.statement?.currentBalance) || 0);
        setTxs(soa?.transactions || []);
        const group = (aged?.groups || []).find((g: any) => g.contactId === customer.id);
        setAgedDocs(group?.docs || []);
      } catch (e: any) {
        if (!cancelled) toast.error(e?.message || "Couldn't load the debtor statement");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, customer?.id, cutOff, getToken]);

  // Movement-only running balance (legacy: credits run negative).
  const rows = useMemo(() => {
    let run = 0;
    return txs.map((t) => {
      const movement = R((Number(t.debit) || 0) - (Number(t.credit) || 0));
      run = R(run + movement);
      return { ...t, movement, running: run };
    });
  }, [txs]);
  const totalDebit = R(rows.reduce((s, r) => s + (Number(r.debit) || 0), 0));
  const totalCredit = R(rows.reduce((s, r) => s + (Number(r.credit) || 0), 0));

  // Month buckets: outstanding by DOCUMENT month — cut-off month back 10 more
  // named months, then "& Below" swallows everything older.
  const buckets = useMemo(() => {
    const cut = new Date(cutOff);
    const list = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(cut.getFullYear(), cut.getMonth() - i, 1);
      const label = `${MONTH_LABELS[d.getMonth()]} ${d.getFullYear()}`;
      return { label: i === 11 ? `${label} & Below` : label, amount: 0, docs: [] as AgedDoc[] };
    });
    for (const doc of agedDocs) {
      const d = new Date(doc.date);
      const diff = (cut.getFullYear() - d.getFullYear()) * 12 + (cut.getMonth() - d.getMonth());
      const idx = Math.min(Math.max(diff, 0), 11);
      list[idx].amount = R(list[idx].amount + (Number(doc.total) || 0));
      list[idx].docs.push(doc);
    }
    return list;
  }, [agedDocs, cutOff]);

  // Print = the Xero-style report, deep-linked to this customer + cut-off.
  // ?back= returns to the page hosting this dialog (the receipt) from the
  // report's Back button.
  const openPrintReport = () => {
    onClose();
    const back = encodeURIComponent(window.location.pathname + window.location.search);
    router.push(`/portal/accounting/receivables?tab=debtor-statement&contactId=${customer?.id}&asOf=${cutOff}&back=${back}`);
  };

  const headSx = { fontWeight: 700, fontSize: "0.72rem", color: "text.secondary", whiteSpace: "nowrap" as const, bgcolor: "surfaceTones.low" };
  const mono = { fontFamily: "monospace", textAlign: "right" as const, whiteSpace: "nowrap" as const };
  const fieldLabelSx = { fontSize: "0.75rem", fontWeight: 700, color: "text.secondary", whiteSpace: "nowrap" as const };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth PaperProps={{ sx: { maxHeight: "92vh" } }}>
      <DialogTitle
        sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", bgcolor: "#0a0a0a", color: "#fafafa", py: 1.5 }}
      >
        <Typography variant="h6" fontWeight={500}>
          Debtor Statement-Of-Account
        </Typography>
        <Stack direction="row" gap={1} alignItems="center">
          <Button
            size="small"
            startIcon={<PrintIcon />}
            onClick={openPrintReport}
            variant="outlined"
            // The theme paints outlined buttons with a light background — on
            // this black header that made the label white-on-white. Force a
            // transparent ghost button so it reads clearly.
            sx={{
              color: "#fafafa",
              textTransform: "none",
              bgcolor: "transparent",
              borderColor: "rgba(250,250,250,0.5)",
              "&:hover": { bgcolor: "rgba(255,255,255,0.12)", borderColor: "#fafafa" },
            }}
          >
            Print
          </Button>
          <IconButton onClick={onClose} size="small" sx={{ color: "#fafafa" }}>
            <CloseIcon />
          </IconButton>
        </Stack>
      </DialogTitle>

      <DialogContent sx={{ p: 2 }}>
        {/* ---------- header block ---------- */}
        <Box sx={{ display: "flex", justifyContent: "space-between", gap: 3, flexWrap: "wrap", mb: 1.5 }}>
          <Box sx={{ minWidth: 280 }}>
            <Stack direction="row" gap={1.5} alignItems="baseline">
              <Typography sx={fieldLabelSx}>Company Name</Typography>
              <Typography sx={{ fontWeight: 700 }}>{customer?.name || "—"}</Typography>
            </Stack>
            <Stack direction="row" gap={1.5} alignItems="baseline" sx={{ mt: 0.5 }}>
              <Typography sx={fieldLabelSx}>Address</Typography>
              <Typography sx={{ fontSize: "0.85rem", whiteSpace: "pre-line" }}>{customer?.address || "—"}</Typography>
            </Stack>
          </Box>
          <Box>
            <Stack direction="row" gap={1.5} alignItems="center" justifyContent="flex-end">
              <Typography sx={fieldLabelSx}>Cut-Off Date</Typography>
              <TextField
                size="small"
                type="date"
                value={cutOff}
                onChange={(e) => e.target.value && setCutOff(e.target.value)}
                sx={{ width: 170 }}
              />
            </Stack>
            <Stack direction="row" gap={1.5} alignItems="center" justifyContent="flex-end" sx={{ mt: 0.5 }}>
              <Typography sx={fieldLabelSx}>Accounts Code</Typography>
              <Typography sx={{ fontFamily: "monospace", fontWeight: 700 }}>{customer?.customerCode || "—"}</Typography>
            </Stack>
            <Stack direction="row" gap={1.5} alignItems="center" justifyContent="flex-end" sx={{ mt: 1 }}>
              <Typography sx={{ ...fieldLabelSx, color: "text.primary" }}>BALANCE B/F</Typography>
              <Typography sx={{ fontFamily: "monospace", fontWeight: 700, fontSize: "1.05rem" }}>{fmt(opening)}</Typography>
            </Stack>
          </Box>
        </Box>

        {/* ---------- cut-off month transactions ---------- */}
        {loading ? (
          <Box sx={{ display: "flex", justifyContent: "center", p: 5 }}>
            <CircularProgress size={26} />
          </Box>
        ) : (
          <>
            <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 360, borderRadius: 1.5 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell sx={headSx}>Reference</TableCell>
                    <TableCell sx={headSx}>Date</TableCell>
                    <TableCell sx={headSx}>Remarks</TableCell>
                    <TableCell sx={{ ...headSx, textAlign: "right" }}>Debit</TableCell>
                    <TableCell sx={{ ...headSx, textAlign: "right" }}>Credit</TableCell>
                    <TableCell sx={{ ...headSx, textAlign: "right" }}>Balance</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} sx={{ color: "text.secondary", textAlign: "center", py: 3 }}>
                        No transactions in the cut-off month.
                      </TableCell>
                    </TableRow>
                  ) : (
                    rows.map((r, i) => (
                      <TableRow key={i} hover>
                        <TableCell sx={{ fontFamily: "monospace", whiteSpace: "nowrap" }}>{r.reference}</TableCell>
                        <TableCell sx={{ whiteSpace: "nowrap" }}>{dmy(r.date)}</TableCell>
                        <TableCell>{r.description || r.transactionType}</TableCell>
                        <TableCell sx={mono}>{r.debit ? fmt(r.debit) : ""}</TableCell>
                        <TableCell sx={mono}>{r.credit ? fmt(r.credit) : ""}</TableCell>
                        <TableCell sx={mono}>{fmt(r.running)}</TableCell>
                      </TableRow>
                    ))
                  )}
                  {/* Totals as table rows so they align exactly under the
                      Debit / Credit / Balance columns. */}
                  <TableRow>
                    <TableCell colSpan={3} sx={{ textAlign: "right", fontWeight: 700, borderBottom: "none", pt: 1.5 }}>
                      TOTAL
                    </TableCell>
                    <TableCell sx={{ ...mono, fontWeight: 700, borderBottom: "none", pt: 1.5 }}>{fmt(totalDebit)}</TableCell>
                    <TableCell sx={{ ...mono, fontWeight: 700, borderBottom: "none", pt: 1.5 }}>{fmt(totalCredit)}</TableCell>
                    <TableCell sx={{ ...mono, fontWeight: 700, borderBottom: "none", pt: 1.5 }}>
                      {fmt(R(totalDebit - totalCredit))}
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell colSpan={5} sx={{ textAlign: "right", fontWeight: 700, borderBottom: "none", py: 0.5 }}>
                      GRAND TOTAL
                    </TableCell>
                    <TableCell sx={{ ...mono, fontWeight: 700, fontSize: "0.95rem", borderBottom: "none", py: 0.5 }}>
                      {fmt(closing)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </TableContainer>

            {/* ---------- money owed by month ---------- */}
            <Box
              sx={{
                mt: 2,
                display: "grid",
                gridTemplateColumns: { xs: "repeat(3, 1fr)", md: "repeat(6, 1fr)" },
                gap: 1,
              }}
            >
              {buckets.map((b) => (
                <Paper
                  key={b.label}
                  variant="outlined"
                  onClick={() => b.amount > 0 && setMonthDetail({ label: b.label, docs: b.docs })}
                  sx={{
                    p: 1,
                    borderRadius: 1.5,
                    cursor: b.amount > 0 ? "pointer" : "default",
                    opacity: b.amount > 0 ? 1 : 0.65,
                    "&:hover": b.amount > 0 ? { borderColor: "text.secondary", bgcolor: "action.hover" } : undefined,
                  }}
                  title={b.amount > 0 ? "Detailed Ageing Analysis" : undefined}
                >
                  <Typography sx={{ fontSize: "0.68rem", fontWeight: 700, color: "text.secondary", whiteSpace: "nowrap" }}>
                    {b.label}
                  </Typography>
                  <Typography sx={{ fontFamily: "monospace", fontWeight: 700, textAlign: "right", color: b.amount > 0 ? "error.main" : "text.secondary" }}>
                    {fmt(b.amount)}
                  </Typography>
                </Paper>
              ))}
            </Box>
          </>
        )}
      </DialogContent>

      {/* ---------- Detailed Ageing Analysis (click a month) ---------- */}
      <Dialog open={Boolean(monthDetail)} onClose={() => setMonthDetail(null)} maxWidth="md" fullWidth>
        <DialogTitle
          sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", bgcolor: "#0a0a0a", color: "#fafafa", py: 1.5 }}
        >
          <Typography variant="h6" fontWeight={500}>
            Debtor — Detailed Ageing Analysis · {monthDetail?.label}
          </Typography>
          <IconButton onClick={() => setMonthDetail(null)} size="small" sx={{ color: "#fafafa" }}>
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ p: 0 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={headSx}>Reference</TableCell>
                <TableCell sx={headSx}>Date</TableCell>
                <TableCell sx={headSx}>Remarks</TableCell>
                <TableCell sx={{ ...headSx, textAlign: "right" }}>Debit</TableCell>
                <TableCell sx={headSx}>Curr</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(monthDetail?.docs || []).map((d) => (
                <TableRow key={d.id} hover>
                  <TableCell sx={{ fontFamily: "monospace", whiteSpace: "nowrap" }}>{d.number}</TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>{dmy(d.date)}</TableCell>
                  <TableCell>{d.reference || "INVOICE"}</TableCell>
                  <TableCell sx={mono}>{fmt(d.total)}</TableCell>
                  <TableCell>{d.currency || "SGD"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Box sx={{ p: 1.5, px: 2, display: "flex", justifyContent: "flex-end", borderTop: "1px solid", borderColor: "divider" }}>
            <Typography sx={{ fontFamily: "monospace", fontWeight: 700 }}>
              {fmt(R((monthDetail?.docs || []).reduce((s, d) => s + (Number(d.total) || 0), 0)))}
            </Typography>
          </Box>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
