"use client";

// Read-only journal entry view (guru 2026-11-06): the double entry behind a
// ledger line. Reached from the account / debtor / creditor ledgers by
// clicking a manual J/V row (document-posted rows open their document
// instead). Back returns to ?from= — the exact ledger the user was on.

import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import moment from "moment";
import { toast } from "react-toastify";
import { useAccountingApi } from "../../_lib/api";

type Line = {
  id: string;
  description?: string | null;
  debit: number;
  credit: number;
  foreignAmount?: number | null;
  exchangeRate?: number | null;
  account?: { code: string; name: string } | null;
};
type Entry = {
  id: string;
  journalNumber: string;
  entryDate: string;
  type: string;
  status: string;
  isUnconfirmed?: boolean;
  reference?: string | null;
  description?: string | null;
  currency?: string | null;
  sourceDocumentId?: string | null;
  totalDebit: number;
  totalCredit: number;
  createdBy?: string | null;
  postedAt?: string | null;
  voidedAt?: string | null;
  voidedBy?: string | null;
  lines: Line[];
};

const fmt = (n: number) => (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function JournalEntryPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { request } = useAccountingApi();
  const id = String(params.id || "");
  const from = searchParams.get("from") || "";
  const backTo = from.startsWith("/portal") ? from : "/portal/accounting/ledger?tab=gl-home";

  const [entry, setEntry] = useState<Entry | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const e = await request<Entry>(`/journal/entries/${id}`);
        if (!cancelled) setEntry(e);
      } catch (err: any) {
        if (!cancelled) toast.error(err?.message || "Couldn't load the journal");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [request, id]);

  const statusChip = !entry ? null : entry.status === "VOID" ? (
    <Chip size="small" color="error" variant="outlined" label="Void" />
  ) : entry.status === "DRAFT" || entry.isUnconfirmed ? (
    <Chip size="small" color="warning" variant="outlined" label="Unconfirmed" />
  ) : (
    <Chip size="small" color="success" variant="outlined" label="Confirmed" />
  );
  const kind = !entry ? "" : entry.type === "MANUAL" ? "Manual journal voucher" : `Posted from a document (${entry.type.toLowerCase().replace(/_/g, " ")})`;

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1100, mx: "auto" }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
        <Button startIcon={<ArrowBackIcon />} variant="outlined" size="small" onClick={() => router.push(backTo)}>
          Back
        </Button>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>
          {entry ? `Journal ${entry.journalNumber}` : "Journal"}
        </Typography>
        {statusChip}
      </Stack>

      {loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
          <CircularProgress />
        </Box>
      ) : !entry ? (
        <Typography color="text.secondary">Journal not found.</Typography>
      ) : (
        <>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, mb: 2 }}>
            <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr 1fr", md: "repeat(4, 1fr)" } }}>
              {[
                ["Date", moment(entry.entryDate).format("DD/MM/YYYY")],
                ["Reference", entry.reference || "—"],
                ["Kind", kind],
                ["Currency", entry.currency || "SGD"],
                ["Description", entry.description || "—"],
                ["Created by", entry.createdBy || "—"],
                ["Posted", entry.postedAt ? moment(entry.postedAt).format("DD/MM/YYYY HH:mm") : "—"],
                ["Voided", entry.voidedAt ? `${moment(entry.voidedAt).format("DD/MM/YYYY HH:mm")}${entry.voidedBy ? ` by ${entry.voidedBy}` : ""}` : "—"],
              ].map(([k, v]) => (
                <Box key={k as string} sx={{ gridColumn: k === "Description" ? { xs: "1 / -1", md: "span 2" } : undefined }}>
                  <Typography variant="caption" sx={{ color: "text.secondary", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>
                    {k}
                  </Typography>
                  <Typography variant="body2">{v as string}</Typography>
                </Box>
              ))}
            </Box>
          </Paper>

          <Paper variant="outlined" sx={{ borderRadius: 2, overflowX: "auto" }}>
            <Table size="small" sx={{ minWidth: 640 }}>
              <TableHead>
                <TableRow>
                  <TableCell>Account</TableCell>
                  <TableCell>Description</TableCell>
                  <TableCell align="right" sx={{ width: 140 }}>Debit</TableCell>
                  <TableCell align="right" sx={{ width: 140 }}>Credit</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {entry.lines.map((l) => (
                  <TableRow key={l.id} hover>
                    <TableCell sx={{ whiteSpace: "nowrap" }}>
                      <Box component="span" sx={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{l.account?.code || ""}</Box>
                      {l.account?.name ? ` — ${l.account.name}` : ""}
                    </TableCell>
                    <TableCell>
                      {l.description || ""}
                      {l.foreignAmount ? (
                        <Typography component="span" variant="caption" sx={{ color: "text.secondary", ml: 1 }}>
                          ({fmt(l.foreignAmount)} @ {l.exchangeRate})
                        </Typography>
                      ) : null}
                    </TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>{l.debit ? fmt(l.debit) : ""}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>{l.credit ? fmt(l.credit) : ""}</TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell colSpan={2} sx={{ fontWeight: 700 }}>Total</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700, fontVariantNumeric: "tabular-nums", borderTop: 2, borderColor: "divider" }}>{fmt(entry.totalDebit)}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700, fontVariantNumeric: "tabular-nums", borderTop: 2, borderColor: "divider" }}>{fmt(entry.totalCredit)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </Paper>

        </>
      )}
    </Box>
  );
}
