"use client";

// Round BW — an order's "Accounting" tab (ADH Admin / Manager, shipments:money): the journals the lot (order #n) would
// post in ADH Singapore's books per ADH's FRS, with the 620 / 810 / P&L checks and what is still missing. Preview
// only: nothing is posted. Amounts USD; SGD at the rate of the 1st of the delivery month.

import React, { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Tooltip, Typography } from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircleRounded";
import CancelIcon from "@mui/icons-material/CancelRounded";
import HelpOutlineIcon from "@mui/icons-material/HelpOutlineRounded";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import { useTranslations } from "next-intl";
import { useShipmentsApi, type LotInvoice1, type LotPostingStatus, type LotPreview, type LotPreviewLine } from "../_lib/api";
import { useUserPermissions } from "@/app/portal/hooks/useUserPermissions";
import { toast } from "../_lib/toast";
import { ConfirmDialog } from "./bits";
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

/** The advance invoice's source: AIMS's Invoice #1, the amounts ADH Admin typed, or "not in AIMS" (+ Type for Admin). */
function Invoice1Bar({ data, canType, onType, onClear }: { data: LotPreview; canType: boolean; onType: () => void; onClear: () => void }) {
  const t = useTranslations("books.preview.inv1");
  const inv = data.invoice1;
  return (
    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 1 }} data-tour="order-accounting-invoice1">
      {!inv ? (
        <Chip size="small" color="error" variant="outlined" label={t("notInAims")} />
      ) : inv.source === "aims" ? (
        <Chip size="small" color="success" variant="outlined" label={t("fromAims", { number: inv.number ?? "" })} />
      ) : (
        <Chip size="small" color="primary" variant="outlined" label={t("typedBy", { by: inv.by ?? "—" })} />
      )}
      {canType && !data.invoice1InAims && (
        <>
          <Button size="small" variant={inv ? "text" : "outlined"} onClick={onType} data-tour="order-accounting-invoice1-type">
            {inv ? t("edit") : t("type")}
          </Button>
          {inv && (
            <Button size="small" color="error" onClick={onClear}>
              {t("clear")}
            </Button>
          )}
        </>
      )}
    </Stack>
  );
}

function Invoice1Dialog({ open, initial, onClose, onSave }: { open: boolean; initial: LotInvoice1 | null; onClose: () => void; onSave: (v: { principal: number; tax: number; number: string | null }) => Promise<void> }) {
  const t = useTranslations("books.preview.inv1");
  const [principal, setPrincipal] = useState("");
  const [tax, setTax] = useState("");
  const [number, setNumber] = useState("");
  const [busy, setBusy] = useState(false);
  React.useEffect(() => {
    if (!open) return;
    setPrincipal(initial ? String(initial.principal) : "");
    setTax(initial ? String(initial.tax) : "");
    setNumber(initial?.number ?? "");
  }, [open, initial]);
  const p = principal.trim() === "" ? NaN : Number(principal.replace(/,/g, ""));
  const x = tax.trim() === "" ? NaN : Number(tax.replace(/,/g, ""));
  const valid = Number.isFinite(p) && p > 0 && Number.isFinite(x) && x >= 0;
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        {t("title")}
        <Tooltip title={t("info")}>
          <InfoOutlinedIcon fontSize="small" color="action" sx={{ cursor: "help" }} />
        </Tooltip>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField label={t("principal")} value={principal} onChange={(e) => setPrincipal(e.target.value)} inputMode="decimal" autoFocus fullWidth />
          <TextField label={t("tax")} value={tax} onChange={(e) => setTax(e.target.value)} inputMode="decimal" fullWidth />
          <TextField label={t("number")} value={number} onChange={(e) => setNumber(e.target.value)} fullWidth />
          {valid && (
            <Typography variant="body2" sx={{ fontWeight: 700, textAlign: "right" }}>
              {t("total", { total: money(Math.round((p + x) * 100) / 100) })}
            </Typography>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("cancel")}</Button>
        <Button
          variant="contained"
          disabled={!valid || busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onSave({ principal: p, tax: x, number: number.trim() || null });
            } finally {
              setBusy(false);
            }
          }}
        >
          {t("save")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function AccountingPreviewView({ data, canTypeInvoice1 = false, onTypeInvoice1, onClearInvoice1 }: { data: LotPreview; canTypeInvoice1?: boolean; onTypeInvoice1?: () => void; onClearInvoice1?: () => void }) {
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
          {p.key === "SUS_ADVANCE_INVOICE" && <Invoice1Bar data={data} canType={canTypeInvoice1} onType={() => onTypeInvoice1?.()} onClear={() => onClearInvoice1?.()} />}
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

/** adminOverride: the /preview fixture pages only (no signed-in user there). */
export default function AccountingPreview({ orderId, adminOverride }: { orderId: string; adminOverride?: boolean }) {
  const t = useTranslations("books.preview");
  const ti = useTranslations("books.preview.inv1");
  const api = useShipmentsApi();
  const qc = useQueryClient();
  const { hasPermission } = useUserPermissions();
  // ADH Admin = ADH Manager + organizations:update (the API checks the same pair).
  const isAdmin = adminOverride ?? (hasPermission("shipments", "money") && hasPermission("organizations", "update"));
  const [typing, setTyping] = useState(false);
  const [clearing, setClearing] = useState(false);
  const q = useQuery({ queryKey: LOT_PREVIEW_KEY(orderId), queryFn: () => api.lotPreview(orderId) });
  if (q.isLoading) return <CircularProgress size={24} />;
  if (q.isError || !q.data) return <Alert severity="error">{(q.error as Error)?.message || t("error")}</Alert>;
  const save = async (body: { principal: number | null; tax?: number; number?: string | null }, done: string) => {
    try {
      await api.saveInvoice1(orderId, body);
      await qc.invalidateQueries({ queryKey: LOT_PREVIEW_KEY(orderId) });
      toast.success(done);
      setTyping(false);
    } catch (e) {
      toast.error((e as Error)?.message || t("error"));
    }
  };
  return (
    <>
      <AccountingPreviewView data={q.data} canTypeInvoice1={isAdmin} onTypeInvoice1={() => setTyping(true)} onClearInvoice1={() => setClearing(true)} />
      <ConfirmDialog open={clearing} title={ti("clearTitle")} confirmLabel={ti("clear")} destructive onClose={() => setClearing(false)} onConfirm={() => save({ principal: null }, ti("cleared"))} />
      <Invoice1Dialog open={typing} initial={q.data.invoice1?.source === "typed" ? q.data.invoice1 : null} onClose={() => setTyping(false)} onSave={(v) => save(v, ti("saved"))} />
    </>
  );
}
