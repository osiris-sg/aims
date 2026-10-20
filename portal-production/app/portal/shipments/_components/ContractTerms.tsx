/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Contract master (2026-10): the term, quantity, pricing basis and premium
// schedule that PIs, CIs and invoices are checked against. Fields ADH still has
// to confirm carry a "check" chip; Edit changes them (and the schedule: margin
// = client − supplier premium per row).

import React, { useEffect, useState } from "react";
import { Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Grid, IconButton, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from "@mui/material";
import EditIcon from "@mui/icons-material/EditOutlined";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/DeleteOutline";
import type { Contract, ContractInput, PremiumRow } from "../_lib/api";
import { useTradeMutation } from "../_lib/hooks";
import { fmtDmy, fmtMt, monthShort } from "../_lib/format";
import { toast } from "../_lib/toast";

const CHECKABLE: Array<[string, string]> = [
  ["periodStart", "Period start"],
  ["periodEnd", "Period end"],
  ["annualQtyMt", "Annual quantity"],
  ["qpBasis", "QP basis"],
  ["balanceTerms", "Balance terms"],
  ["premiumSchedule", "Premium schedule"],
  ["sizeSpec", "Size"],
];
const margin = (r: PremiumRow) => (r.clientPremium != null && r.supplierPremium != null ? Math.round((r.clientPremium - r.supplierPremium) * 100) / 100 : null);

export default function ContractTerms({ contract: c }: { contract: Contract }) {
  const [edit, setEdit] = useState(false);
  const check = new Set(c.checkFields ?? []);
  const Item = ({ k, label, value }: { k?: string; label: string; value: React.ReactNode }) => (
    <Grid item xs={12} sm={6} md={4}>
      <Typography variant="caption" color="text.secondary" component="div">
        {label} {k && check.has(k) && <Chip size="small" color="warning" variant="outlined" label="check" sx={{ height: 18, ml: 0.5 }} />}
      </Typography>
      <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
        {value === null || value === undefined || value === "" ? "—" : value}
      </Typography>
    </Grid>
  );
  const sched = c.premiumSchedule ?? [];
  return (
    <Paper variant="outlined" sx={{ p: 2 }} data-tour="contract-master">
      <Stack direction="row" alignItems="center" sx={{ mb: 1 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, flex: 1 }}>
          Contract terms
        </Typography>
        {check.size > 0 && <Chip size="small" color="warning" label={`${check.size} to confirm`} sx={{ mr: 1 }} />}
        {c.status === "OPEN" && (
          <Button size="small" startIcon={<EditIcon />} onClick={() => setEdit(true)}>
            Edit
          </Button>
        )}
      </Stack>
      <Grid container spacing={1.5}>
        <Item k="periodStart" label="Period" value={c.periodStart || c.periodEnd ? `${c.periodStart ? fmtDmy(c.periodStart) : "?"} → ${c.periodEnd ? fmtDmy(c.periodEnd) : "?"}` : null} />
        <Item label="Grade / size" value={[c.grade, c.sizeSpec].filter(Boolean).join(" · ")} />
        <Item
          k="annualQtyMt"
          label="Quantity"
          value={
            c.usage
              ? `${c.usage.annualQtyMt != null ? `${fmtMt(c.usage.annualQtyMt)} MT` : "?"}${c.tolerancePct != null ? ` ±${Number(c.tolerancePct)}%` : ""} · ordered ${fmtMt(c.usage.orderedMt)} MT${c.usage.remainingMt != null ? ` · ${fmtMt(c.usage.remainingMt)} MT left` : ""}`
              : null
          }
        />
        <Item label="Deposit" value={c.depositPercent != null ? `${Number(c.depositPercent)}% advance${c.depositDueDays != null ? ` within ${c.depositDueDays} ${c.depositDueUnit === "CALENDAR" ? "days" : "business days"}` : ""}` : null} />
        <Item k="balanceTerms" label="Balance" value={c.balanceTerms} />
        <Item k="qpBasis" label="QP basis" value={c.qpBasis} />
        <Item label="QMJP rule" value={c.qmjpRule} />
        <Item label="Margin this month (client − supplier)" value={c.marginNow != null ? `${c.marginNow} USD/MT` : null} />
      </Grid>
      <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 2, mb: 0.5 }}>
        Premium schedule (USD/MT{c.qmjpRule ? ", on top of the quarter's QMJP" : ""}) {check.has("premiumSchedule") && <Chip size="small" color="warning" variant="outlined" label="check" sx={{ height: 18, ml: 0.5 }} />}
      </Typography>
      {!sched.length ? (
        <Typography variant="body2" color="text.secondary">
          No schedule yet — the product line&apos;s premiums are used.
        </Typography>
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>From</TableCell>
              <TableCell>To</TableCell>
              <TableCell>Grade</TableCell>
              <TableCell align="right">Supplier</TableCell>
              <TableCell align="right">Client</TableCell>
              <TableCell align="right">Upcharge</TableCell>
              <TableCell align="right">ADH margin</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sched.map((r) => (
              <TableRow key={`${r.from}-${r.grade ?? ""}`}>
                <TableCell>{monthShort(r.from)}</TableCell>
                <TableCell>{r.to ? monthShort(r.to) : "open"}</TableCell>
                <TableCell>{r.grade || "all"}</TableCell>
                <TableCell align="right">{r.supplierPremium ?? "—"}</TableCell>
                <TableCell align="right">{r.clientPremium ?? "—"}</TableCell>
                <TableCell align="right">{r.upcharge ?? "—"}</TableCell>
                <TableCell align="right" sx={{ fontWeight: 700 }}>
                  {margin(r) ?? "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <TermsDialog open={edit} contract={c} onClose={() => setEdit(false)} />
    </Paper>
  );
}

function TermsDialog({ open, contract: c, onClose }: { open: boolean; contract: Contract; onClose: () => void }) {
  const save = useTradeMutation((a, body: ContractInput) => a.updateContract(c.id, body));
  const [f, setF] = useState<Record<string, string>>({});
  const [rows, setRows] = useState<Array<Record<string, string>>>([]);
  const [check, setCheck] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!open) return;
    const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
    setF({
      periodStart: c.periodStart ? c.periodStart.slice(0, 10) : "",
      periodEnd: c.periodEnd ? c.periodEnd.slice(0, 10) : "",
      grade: s(c.grade),
      sizeSpec: s(c.sizeSpec),
      annualQtyMt: s(c.annualQtyMt),
      tolerancePct: s(c.tolerancePct),
      balanceTerms: s(c.balanceTerms),
      qpBasis: s(c.qpBasis),
      qmjpRule: s(c.qmjpRule),
    });
    setRows((c.premiumSchedule ?? []).map((r) => ({ from: r.from, to: r.to ?? "", grade: r.grade ?? "", supplierPremium: s(r.supplierPremium), clientPremium: s(r.clientPremium), upcharge: s(r.upcharge) })));
    setCheck(new Set(c.checkFields ?? []));
  }, [open, c]);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const num = (v: string) => (v.trim() === "" ? null : Number(v));
  const txt = (v: string) => (v.trim() === "" ? null : v.trim());
  const field = (k: string, label: string, extra: Record<string, unknown> = {}, sm = 6) => (
    <Grid item xs={12} sm={sm}>
      <TextField fullWidth size="small" label={label} value={f[k] ?? ""} onChange={set(k)} {...extra} />
    </Grid>
  );
  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Contract {c.contractNo} — terms</DialogTitle>
      <DialogContent dividers>
        <Grid container spacing={1.5}>
          {field("periodStart", "Period start", { type: "date", InputLabelProps: { shrink: true } }, 3)}
          {field("periodEnd", "Period end", { type: "date", InputLabelProps: { shrink: true } }, 3)}
          {field("grade", "Grade", {}, 3)}
          {field("sizeSpec", "Size", {}, 3)}
          {field("annualQtyMt", "Quantity (MT)", { type: "number" }, 3)}
          {field("tolerancePct", "Tolerance %", { type: "number" }, 3)}
          {field("qpBasis", "QP basis")}
          {field("qmjpRule", "QMJP rule (blank = premium is fixed)", {}, 12)}
          {field("balanceTerms", "Balance terms", { multiline: true, minRows: 2 }, 12)}
        </Grid>
        <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>
          Premium schedule
        </Typography>
        {rows.map((r, i) => (
          <Stack key={i} direction="row" spacing={1} sx={{ mb: 1 }} alignItems="center">
            {(
              [
                ["from", "From (YYYY-MM)", "month"],
                ["to", "To (blank = open)", "month"],
                ["grade", "Grade (blank = all)", "text"],
                ["supplierPremium", "Supplier", "number"],
                ["clientPremium", "Client", "number"],
                ["upcharge", "Upcharge", "number"],
              ] as Array<[string, string, string]>
            ).map(([k, label, type]) => (
              <TextField
                key={k}
                size="small"
                label={label}
                type={type}
                InputLabelProps={{ shrink: true }}
                value={r[k] ?? ""}
                onChange={(e) => setRows((xs) => xs.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)))}
              />
            ))}
            <IconButton size="small" aria-label="Remove row" onClick={() => setRows((xs) => xs.filter((_, j) => j !== i))}>
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Stack>
        ))}
        <Button size="small" startIcon={<AddIcon />} onClick={() => setRows((xs) => [...xs, { from: "", to: "", grade: "", supplierPremium: "", clientPremium: "", upcharge: "" }])}>
          Add row
        </Button>
        <Typography variant="subtitle2" sx={{ mt: 2 }}>
          Still to confirm (shown as &quot;check&quot;)
        </Typography>
        <Box sx={{ display: "flex", flexWrap: "wrap" }}>
          {CHECKABLE.map(([k, label]) => (
            <FormControlLabel
              key={k}
              control={
                <Checkbox
                  size="small"
                  checked={check.has(k)}
                  onChange={(e) =>
                    setCheck((s) => {
                      const n = new Set(s);
                      if (e.target.checked) n.add(k);
                      else n.delete(k);
                      return n;
                    })
                  }
                />
              }
              label={label}
            />
          ))}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={save.isPending}
          onClick={async () => {
            try {
              await save.mutateAsync({
                periodStart: txt(f.periodStart),
                periodEnd: txt(f.periodEnd),
                grade: txt(f.grade),
                sizeSpec: txt(f.sizeSpec),
                annualQtyMt: num(f.annualQtyMt),
                tolerancePct: num(f.tolerancePct),
                qpBasis: txt(f.qpBasis),
                qmjpRule: txt(f.qmjpRule),
                balanceTerms: txt(f.balanceTerms),
                premiumSchedule: rows
                  .filter((r) => r.from)
                  .map((r) => ({ from: r.from, to: r.to || null, grade: r.grade?.trim() || null, supplierPremium: num(r.supplierPremium), clientPremium: num(r.clientPremium), upcharge: num(r.upcharge) })),
                checkFields: [...check],
              });
              toast.success("Contract terms saved");
              onClose();
            } catch (e: any) {
              toast.error(e?.message || "Could not save");
            }
          }}
        >
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}
