"use client";

// Round BW — an order's "Accounting" tab (ADH Admin / Manager, shipments:money): the journals the lot (order #n) would
// post in ADH Singapore's books per ADH's FRS, with the 620 / 810 / P&L checks and what is still missing. Preview
// only: nothing is posted. Amounts USD; SGD at the rate of the 1st of the delivery month.

import React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Alert, Box, Button, Chip, CircularProgress, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, Tooltip, Typography } from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircleRounded";
import CancelIcon from "@mui/icons-material/CancelRounded";
import HelpOutlineIcon from "@mui/icons-material/HelpOutlineRounded";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import { useTranslations } from "next-intl";
import { useShipmentsApi, type LotPostingStatus, type LotPreview, type LotPreviewLine } from "../_lib/api";
import { BOOKS_ROUTE } from "@/helpers/shipmentsNav";

const money = (n: number | null) => (n === null ? "" : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const STATUS_COLOR: Record<LotPostingStatus, "success" | "default" | "warning" | "error" | "info"> = {
  ready: "success",
  waiting: "default",
  "rule needed": "warning",
  "missing data": "error",
  "rate needed": "info",
};

export const LOT_PREVIEW_KEY = (orderId: string) => ["trade-books", "preview", orderId];

function Amount({ line, unit, side }: { line: LotPreviewLine; unit: "usd" | "sgd"; side: "Dr" | "Cr" }) {
  const t = useTranslations("books.preview");
  if (line.side !== side) return null;
  const v = line[unit];
  if (v !== null) return <>{money(v)}</>;
  if (unit === "sgd" && line.usd !== null) return <Typography component="span" variant="caption" color="text.secondary">—</Typography>;
  return <Chip size="small" variant="outlined" color={line.problem === "missing" ? "error" : "warning"} label={line.problem === "missing" ? t("missing") : t("ruleNeeded")} sx={{ height: 20 }} />;
}

export function AccountingPreviewView({ data }: { data: LotPreview }) {
  const t = useTranslations("books.preview");
  const acct = (code: string) => (data.accounts[code] ? `${code} ${data.accounts[code]}` : code);
  const num = { textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" } as const;
  return (
    <Stack spacing={2} data-tour="order-accounting">
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        {data.deliveryMonth ? (
          data.usdRate ? (
            <Chip color="primary" variant="outlined" label={`${t("rate", { month: data.deliveryMonth, rate: String(data.usdRate) })}${data.rateEnteredBy ? ` · ${t("rateBy", { by: data.rateEnteredBy })}` : ""}`} data-tour="order-accounting-rate" />
          ) : (
            <>
              <Chip color="info" label={t("noRate", { month: data.deliveryMonth })} data-tour="order-accounting-rate" />
              <Button size="small" component={Link} href={`${BOOKS_ROUTE}/fx-rates`}>
                {t("addRate")}
              </Button>
            </>
          )
        ) : (
          <Chip color="error" variant="outlined" label={t("noMonth")} />
        )}
        <Chip variant="outlined" label={data.pattern ? t(`pattern.${data.pattern}`) : t("pattern.none")} />
        <Tooltip title={t("info")} placement="bottom-start">
          <InfoOutlinedIcon fontSize="small" color="action" sx={{ cursor: "help" }} />
        </Tooltip>
      </Stack>

      <Paper variant="outlined" sx={{ p: 2 }} data-tour="order-accounting-checks">
        <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 1 }}>
          {t("checks")}
        </Typography>
        <Stack spacing={1}>
          {data.checks.map((c) => (
            <Stack key={c.key} direction="row" spacing={1} alignItems="flex-start">
              {c.ok === true ? <CheckCircleIcon color="success" fontSize="small" /> : c.ok === false ? <CancelIcon color="error" fontSize="small" /> : <HelpOutlineIcon color="disabled" fontSize="small" />}
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                  {c.label} · {c.ok === true ? t("ok") : c.ok === false ? t("fail") : t("notYet")}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ wordBreak: "break-word" }}>
                  {c.detail}
                  {c.ok === null && c.waitingOn.length ? ` · ${t("waitingOn", { list: c.waitingOn.join(", ") })}` : ""}
                </Typography>
              </Box>
            </Stack>
          ))}
        </Stack>
      </Paper>

      {(data.rulesNeeded.length > 0 || data.missing.length > 0) && (
        <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
          {data.rulesNeeded.length > 0 && (
            <Paper variant="outlined" sx={{ p: 2, flex: 1, borderColor: "warning.main" }} data-tour="order-accounting-rules">
              <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 0.5 }}>
                {t("rulesNeeded")} ({data.rulesNeeded.length})
              </Typography>
              <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                {data.rulesNeeded.map((r) => (
                  <Typography key={r} component="li" variant="body2">
                    {r}
                  </Typography>
                ))}
              </Box>
            </Paper>
          )}
          {data.missing.length > 0 && (
            <Paper variant="outlined" sx={{ p: 2, flex: 1, borderColor: "error.main" }} data-tour="order-accounting-missing">
              <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 0.5 }}>
                {t("missingData")} ({data.missing.length})
              </Typography>
              <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                {data.missing.map((r) => (
                  <Typography key={r} component="li" variant="body2">
                    {r}
                  </Typography>
                ))}
              </Box>
            </Paper>
          )}
        </Stack>
      )}

      {data.postings.map((p) => (
        <Paper key={p.key} variant="outlined" sx={{ p: 2 }} data-tour={`order-accounting-posting-${p.key}`}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 0.5 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
              {p.title}
            </Typography>
            <Chip size="small" variant="outlined" label={p.kind} />
            <Chip size="small" color={STATUS_COLOR[p.status]} label={t(`status.${p.status}`)} />
            <Box sx={{ flex: 1 }} />
            <Typography variant="caption" color="text.secondary">
              {p.frs}
            </Typography>
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {[p.contact ? `${t("contact")}: ${p.contact}` : null, `${t("trigger")}: ${p.trigger} (${p.triggerState === "done" ? "✓" : p.triggerState === "rule needed" ? t("ruleNeeded") : t("notYet").toLowerCase()})`, p.date ? `${t("date")}: ${p.date}` : null].filter(Boolean).join(" · ")}
          </Typography>
          <Box sx={{ overflowX: "auto" }}>
            <Table size="small" sx={{ minWidth: 640 }}>
              <TableHead>
                <TableRow>
                  <TableCell>{t("account")}</TableCell>
                  <TableCell>{t("line")}</TableCell>
                  <TableCell sx={num}>{t("dr")} {t("usd")}</TableCell>
                  <TableCell sx={num}>{t("cr")} {t("usd")}</TableCell>
                  <TableCell sx={num}>{t("dr")} {t("sgd")}</TableCell>
                  <TableCell sx={num}>{t("cr")} {t("sgd")}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {p.lines.map((l, i) => (
                  <TableRow key={i}>
                    <TableCell sx={{ whiteSpace: "nowrap", fontFamily: "monospace" }}>{acct(l.account)}</TableCell>
                    <TableCell>
                      {l.label}
                      {l.note && (
                        <Tooltip title={l.note}>
                          <InfoOutlinedIcon sx={{ fontSize: 14, ml: 0.5, verticalAlign: "middle", color: "text.secondary", cursor: "help" }} />
                        </Tooltip>
                      )}
                    </TableCell>
                    <TableCell sx={num}><Amount line={l} unit="usd" side="Dr" /></TableCell>
                    <TableCell sx={num}><Amount line={l} unit="usd" side="Cr" /></TableCell>
                    <TableCell sx={num}><Amount line={l} unit="sgd" side="Dr" /></TableCell>
                    <TableCell sx={num}><Amount line={l} unit="sgd" side="Cr" /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
          {p.notes.map((n) => (
            <Alert key={n} severity="warning" sx={{ mt: 1, py: 0 }}>
              {n}
            </Alert>
          ))}
        </Paper>
      ))}
    </Stack>
  );
}

export default function AccountingPreview({ orderId }: { orderId: string }) {
  const t = useTranslations("books.preview");
  const api = useShipmentsApi();
  const q = useQuery({ queryKey: LOT_PREVIEW_KEY(orderId), queryFn: () => api.lotPreview(orderId) });
  if (q.isLoading) return <CircularProgress size={24} />;
  if (q.isError || !q.data) return <Alert severity="error">{(q.error as Error)?.message || t("error")}</Alert>;
  return <AccountingPreviewView data={q.data} />;
}
