/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Round BP — Dashboard "Unpaid / 未払い・未入金" (Sayaka + Take): To pay (PI deposits, CI balances, import tax, Mitsui
// Soko) and To receive (customer invoices incl. 正誤差額 / 実費差分), sorted by due date, overdue in red, totals per
// currency, filter by counterparty. A row opens its order / shipment; the ⋮ menu → Mark paid (date, amount, account,
// optional proof — saved on the step's payment, its proof on the step's proof slot). Paid rows drop off.
// Invoice / PI amounts only (no margin / profit): shown to ADH Sales and ADH Admin alike.
// Round BQ: a done payment step = paid; one row per real invoice / bill (Mitsui Soko, the shared A3279 bill); filed
// customer invoices; each row says why it is listed; rows without a due date sit under "No due date" at the bottom.

import React, { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Menu, MenuItem, Paper, Stack, Tab, Table, TableBody, TableCell, TableHead, TableRow, Tabs, TextField, Typography } from "@mui/material";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import { ACCOUNT_LABEL, useShipmentsApi, type PaymentAccount, type UnpaidRow } from "../_lib/api";
import { fmtDay } from "../_lib/format";
import { toast } from "../_lib/toast";
import { unpaidText } from "../_lib/unpaidText";
import { useUiLang } from "@/i18n/UiLangProvider";

const KEY = ["trade", "unpaid"];
const todayJst = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const money = (v: number | null, cur: string) => (v === null ? "—" : `${cur} ${v.toLocaleString("en-US", { minimumFractionDigits: cur === "JPY" ? 0 : 2, maximumFractionDigits: cur === "JPY" ? 0 : 2 })}`);
const ACCOUNTS: PaymentAccount[] = ["DBS", "WISE", "CFSB", "SMBC_JPY", "OTHER"];

export default function UnpaidCard() {
  const t = useTranslations("shipments.unpaid");
  const api = useShipmentsApi();
  const router = useRouter();
  const { lang } = useUiLang();
  const q = useQuery({ queryKey: KEY, queryFn: () => api.unpaid() });
  const [tab, setTab] = useState<"pay" | "receive">("pay");
  const [who, setWho] = useState("");
  const [menu, setMenu] = useState<{ pos: { left: number; top: number }; row: UnpaidRow } | null>(null);
  const [paying, setPaying] = useState<UnpaidRow | null>(null);
  const all = (tab === "pay" ? q.data?.pay : q.data?.receive) ?? [];
  const parties = useMemo(() => [...new Set(all.map((r) => r.counterparty).filter((x): x is string => !!x))].sort(), [all]);
  const rows = who ? all.filter((r) => r.counterparty === who) : all;
  const totals = useMemo(() => {
    const out: Record<string, number> = {};
    for (const r of rows) if (r.amount !== null) out[r.currency] = Math.round(((out[r.currency] ?? 0) + r.amount) * 100) / 100;
    return out;
  }, [rows]);
  const open = (r: UnpaidRow) => r.orderId && router.push(`/portal/shipments/orders/${r.orderId}${r.shipmentId ? `?shipment=${r.shipmentId}` : ""}`);
  const kindLabel = (r: UnpaidRow) => t(`kinds.${r.kind}`);

  return (
    <Paper variant="outlined" sx={{ p: { xs: 1.5, md: 2 }, mt: 2 }} data-tour="dashboard-unpaid">
      <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
          {t("title")}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <TextField select size="small" label={t("counterparty")} value={who} onChange={(e) => setWho(e.target.value)} sx={{ minWidth: 200 }}>
          <MenuItem value="">{t("all")}</MenuItem>
          {parties.map((p) => (
            <MenuItem key={p} value={p}>
              {p}
            </MenuItem>
          ))}
        </TextField>
      </Stack>
      <Tabs
        value={tab}
        onChange={(_, v) => {
          setTab(v);
          setWho("");
        }}
        sx={{ minHeight: 36, "& .MuiTab-root": { minHeight: 36, textTransform: "none" } }}
      >
        <Tab value="pay" label={`${t("toPay")} (${q.data?.pay.length ?? 0})`} data-tour="dashboard-unpaid-pay" />
        <Tab value="receive" label={`${t("toReceive")} (${q.data?.receive.length ?? 0})`} data-tour="dashboard-unpaid-receive" />
      </Tabs>
      {q.isLoading ? (
        <CircularProgress size={20} sx={{ m: 2 }} />
      ) : q.isError ? (
        <Alert severity="error" sx={{ mt: 1 }}>
          {(q.error as any)?.message || t("loadFailed")}
        </Alert>
      ) : !rows.length ? (
        <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
          {tab === "pay" ? t("nothingToPay") : t("nothingToReceive")}
        </Typography>
      ) : (
        <Box sx={{ overflowX: "auto" }}>
          <Table size="small" sx={{ "& td, & th": { whiteSpace: "nowrap" } }}>
            <TableHead>
              <TableRow>
                <TableCell>{t("cols.ref")}</TableCell>
                <TableCell>{t("cols.counterparty")}</TableCell>
                <TableCell>{t("cols.document")}</TableCell>
                <TableCell align="right">{t("cols.amount")}</TableCell>
                <TableCell>{t("cols.due")}</TableCell>
                <TableCell align="right">{t("cols.days")}</TableCell>
                <TableCell>{t("cols.status")}</TableCell>
                <TableCell padding="checkbox" />
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((r, i) => (
                <React.Fragment key={r.key}>
                {!r.dueDate && (i === 0 || !!rows[i - 1].dueDate) && (
                  <TableRow>
                    <TableCell colSpan={8} sx={{ bgcolor: "action.hover", fontWeight: 700, py: 0.5 }}>
                      {t("noDueDate")}
                    </TableCell>
                  </TableRow>
                )}
                <TableRow hover sx={{ cursor: r.orderId ? "pointer" : "default" }} onClick={() => open(r)}>
                  <TableCell sx={{ fontWeight: 700 }}>{r.ref}</TableCell>
                  <TableCell>{r.counterparty ?? "—"}</TableCell>
                  <TableCell>
                    {kindLabel(r)}
                    {r.documentNo ? ` · ${r.documentNo}` : ""}
                    {r.note && (
                      <Typography variant="caption" color="text.secondary" display="block">
                        {unpaidText(r.note, lang)}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>
                    {money(r.amount, r.currency)}
                  </TableCell>
                  <TableCell>{r.dueDate ? fmtDay(r.dueDate) : "—"}</TableCell>
                  <TableCell align="right" sx={{ color: r.daysLeft !== null && r.daysLeft < 0 ? "error.main" : undefined, fontWeight: r.daysLeft !== null && r.daysLeft < 0 ? 700 : undefined }}>
                    {r.daysLeft === null ? "—" : r.daysLeft < 0 ? t("overdueDays", { n: String(-r.daysLeft) }) : t("daysLeft", { n: String(r.daysLeft) })}
                  </TableCell>
                  <TableCell>
                    <Chip size="small" variant="outlined" color={r.status === "overdue" ? "error" : r.status === "partly paid" ? "warning" : "default"} label={t(`status.${r.status.replace(" ", "_")}`)} />
                    {r.reason && (
                      <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.25, whiteSpace: "normal", maxWidth: 260 }}>
                        {unpaidText(r.reason, lang)}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell padding="checkbox" onClick={(e) => e.stopPropagation()}>
                    <IconButton size="small" aria-label={t("actions")} onClick={(e) => setMenu({ pos: { left: e.clientX, top: e.clientY }, row: r })}>
                      <MoreVertIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
                </React.Fragment>
              ))}
            </TableBody>
          </Table>
        </Box>
      )}
      {!!rows.length && (
        <Stack direction="row" spacing={2} justifyContent="flex-end" sx={{ mt: 1 }} data-tour="dashboard-unpaid-totals">
          {Object.entries(totals).map(([cur, v]) => (
            <Typography key={cur} variant="body2" sx={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
              {t("total")} {money(v, cur)}
            </Typography>
          ))}
        </Stack>
      )}
      <Menu open={!!menu} onClose={() => setMenu(null)} anchorReference="anchorPosition" anchorPosition={menu?.pos}>
        <MenuItem
          onClick={() => {
            setPaying(menu!.row);
            setMenu(null);
          }}
        >
          {tab === "pay" ? t("markPaid") : t("markReceived")}
        </MenuItem>
        {menu?.row.orderId && (
          <MenuItem
            onClick={() => {
              open(menu.row);
              setMenu(null);
            }}
          >
            {t("openRecord")}
          </MenuItem>
        )}
      </Menu>
      {paying && <MarkPaidDialog row={paying} onClose={() => setPaying(null)} />}
    </Paper>
  );
}

function MarkPaidDialog({ row, onClose }: { row: UnpaidRow; onClose: () => void }) {
  const t = useTranslations("shipments.unpaid");
  const api = useShipmentsApi();
  const qc = useQueryClient();
  const [paidAt, setPaidAt] = useState(todayJst());
  const [amount, setAmount] = useState(row.amount === null ? "" : String(row.amount));
  const [account, setAccount] = useState<PaymentAccount>(row.side === "receive" ? "CFSB" : "OTHER");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const save = async () => {
    setBusy(true);
    try {
      let proofFileId: string | null = null;
      if (file) {
        // The proof goes on the step's own proof slot (its record + step), as the step card files it.
        // A shared bill's proof goes on every shipment it covers.
        const ships = row.kind !== "INVOICE" ? (row.shipmentIds?.length ? row.shipmentIds : row.shipmentId ? [row.shipmentId] : []) : [];
        const up = await api.uploadFile({ file, docType: row.proofDocType, ...(ships.length ? { shipmentIds: ships } : row.orderId ? { orderIds: [row.orderId] } : {}), ...(row.stepId ? { stepId: row.stepId } : {}) } as any);
        proofFileId = up.id;
      }
      await api.markPaid({ key: row.key, paidAt, amount: amount === "" ? null : Number(amount), account, proofFileId });
      toast.success(t("marked", { ref: row.ref }));
      await qc.invalidateQueries({ queryKey: KEY });
      await qc.invalidateQueries({ queryKey: ["trade"] });
      onClose();
    } catch (e: any) {
      toast.error(e?.message || t("markFailed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={() => !busy && onClose()} maxWidth="xs" fullWidth>
      <DialogTitle>
        {row.side === "pay" ? t("markPaid") : t("markReceived")} · {row.ref}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            {[row.counterparty, row.documentNo].filter(Boolean).join(" · ")}
          </Typography>
          {row.ref.includes(",") && (
            <Typography variant="caption" color="text.secondary">
              {t("sharedBill", { refs: row.ref })}
            </Typography>
          )}
          <TextField size="small" type="date" label={t("paidOn")} value={paidAt} onChange={(e) => setPaidAt(e.target.value)} InputLabelProps={{ shrink: true }} />
          <TextField size="small" type="number" label={`${t("amountPaid")} (${row.currency})`} value={amount} onChange={(e) => setAmount(e.target.value)} inputProps={{ step: "any" }} />
          <TextField select size="small" label={t("account")} value={account} onChange={(e) => setAccount(e.target.value as PaymentAccount)}>
            {ACCOUNTS.map((a) => (
              <MenuItem key={a} value={a}>
                {ACCOUNT_LABEL[a]}
              </MenuItem>
            ))}
          </TextField>
          <Stack direction="row" spacing={1} alignItems="center">
            <input ref={input} type="file" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <Button size="small" startIcon={<UploadFileIcon />} onClick={() => input.current?.click()} sx={{ textTransform: "none" }}>
              {file ? file.name : t("proof")}
            </Button>
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          {t("cancel")}
        </Button>
        <Button variant="contained" onClick={() => void save()} disabled={busy || !paidAt}>
          {busy ? "…" : t("save")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
