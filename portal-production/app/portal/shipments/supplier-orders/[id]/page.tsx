/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

// Supplier order — Vedanta's PI for one contract / grade / declaration month.
// Its own steps are 0 (check contract) and 1 (PI payment; N/A when the
// supplier profile has no PI); the customer orders bought under it are listed
// with their shipments' CI payment (step 6, supplier side). Edit the PI facts,
// link / unlink customer orders, and see its files.

import React, { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import LinkIcon from "@mui/icons-material/Link";
import EditIcon from "@mui/icons-material/EditOutlined";
import { toast } from "../../_lib/toast";
import { useContracts, useOrders, useSupplierOrder, useTradeMutation } from "../../_lib/hooks";
import type { SupplierOrder, SupplierOrderInput } from "../../_lib/api";
import { fmtDmy, fmtMoney, fmtMt, monthShort } from "../../_lib/format";
import RecordHeader from "../../_components/RecordHeader";
import StepCards from "../../_components/StepCards";
import FilesTable from "../../_components/FilesTable";
import PriceCheckPanel from "../../_components/PriceCheckPanel";
import RecordPaymentButton from "../../_components/RecordPaymentButton";
import { Field, RecordStatusChip } from "../../_components/bits";

export default function SupplierOrderPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const q = useSupplierOrder(id);
  const complete = useTradeMutation((a, x: string) => a.completeSupplierOrder(x));
  const cancel = useTradeMutation((a, x: string) => a.updateSupplierOrder(x, { status: "CANCELLED" }));
  const reopen = useTradeMutation((a, x: string) => a.reopenSupplierOrder(x));
  const unlink = useTradeMutation((a, v: { id: string; orderId: string }) => a.unlinkSupplierOrder(v.id, v.orderId));
  const [openId, setOpenId] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);

  if (q.isLoading) return <CircularProgress sx={{ m: 4 }} />;
  if (q.isError || !q.data) return <Alert severity="error" sx={{ m: 3 }}>{(q.error as Error)?.message || "Supplier order not found"}</Alert>;
  const so = q.data;
  const owner = { kind: "supplierOrder" as const, id: so.id, label: `Supplier order ${so.label}` };
  const money = (v: unknown) => fmtMoney(v as any, so.currency);
  const current = so.steps.find((s) => !s.isOngoing && !s.notApplicable && s.status !== "DONE") ?? null;
  const here = `/portal/shipments/supplier-orders/${so.id}`;

  return (
    <Box sx={{ p: { xs: 1.5, md: 3 }, maxWidth: 1100, mx: "auto" }}>
      <RecordHeader
        kind="supplierOrder"
        title={[so.label, so.supplier?.name, [so.grade, so.qtyMt != null ? `${fmtMt(so.qtyMt)} MT` : null].filter(Boolean).join(" · ")].filter(Boolean).join(" · ")}
        status={so.status}
        backHref="/portal/shipments/supplier-orders"
        progress={so.progress}
        currentStep={so.currentStep}
        steps={so.steps.filter((x) => !x.notApplicable)}
        blockers={[]}
        onComplete={() => complete.mutateAsync(so.id)}
        onCancel={() => cancel.mutateAsync(so.id)}
        onReopen={() => reopen.mutateAsync(so.id)}
        subtitle={
          <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap alignItems="center">
            {so.contract && (
              <Typography variant="body2" color="text.secondary">
                Contract <b>{so.contract.contractNo}</b>
              </Typography>
            )}
            {so.declarationMonth && (
              <Typography variant="body2" color="text.secondary">
                {monthShort(so.declarationMonth)} declaration
              </Typography>
            )}
            <Chip size="small" variant="outlined" label={so.supplierProfile.hasPI ? "PI + deposit" : "No PI — CI paid in full (supplier profile)"} />
          </Stack>
        }
      />

      <Stack spacing={3}>
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Stack direction="row" alignItems="center" sx={{ mb: 1 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, flex: 1 }}>
              PI and pricing
            </Typography>
            {so.status === "OPEN" && (
              <Button size="small" startIcon={<EditIcon />} onClick={() => setEditOpen(true)}>
                Edit
              </Button>
            )}
          </Stack>
          <Grid container spacing={2}>
            <Field label="PI no." value={so.piNo} />
            <Field label="PI date" value={so.piDate ? fmtDmy(so.piDate) : null} />
            <Field label="PI amount" value={so.piAmount != null ? money(so.piAmount) : null} />
            <Field label="Deposit" value={so.depositAmount != null ? `${so.depositPct != null ? `${Number(so.depositPct)}% · ` : ""}${money(so.depositAmount)}` : null} />
            <Field label="Deposit paid" value={so.depositPaidAt ? fmtDmy(so.depositPaidAt) : null} />
            <Field label="QP basis" value={so.qpBasis} />
            <Field label="Provisional price / MT" value={so.provisionalPricePerMt != null ? money(so.provisionalPricePerMt) : null} />
            <Field label="Supplier premium (USD/MT, fixed part + QMJP)" value={so.supplierPremium != null ? String(so.supplierPremium) : null} />
          </Grid>
        </Paper>

        <PriceCheckPanel kind="supplier-order" id={so.id} title="PI price check vs contract" />

        <Box>
          <Typography variant="overline" color="text.secondary">
            Supplier side steps
          </Typography>
          <StepCards
            steps={so.steps}
            owner={owner}
            fileLinks={so.fileLinks}
            docLinks={[]}
            generatedDocs={[]}
            recordOpen={so.status === "OPEN"}
            returnTo={here}
            openId={openId ?? current?.id ?? null}
            onOpen={setOpenId}
            context={{
              stepLine: (st) =>
                st.code === "CHECK_CONTRACT"
                  ? so.contract
                    ? `Contract ${so.contract.contractNo}${so.contract.qpBasis ? ` · QP ${so.contract.qpBasis}` : ""}`
                    : "No contract linked yet — Edit → Contract"
                  : st.code === "PI_PAYMENT"
                    ? [so.piNo && `PI ${so.piNo}`, so.piDate && `dated ${fmtDmy(so.piDate)}`, so.piAmount != null && money(so.piAmount)].filter(Boolean).join(" · ") || null
                    : null,
              docLine: (d) => (d === "DEPOSIT_PROOF" && so.depositAmount != null ? `Deposit = ${money(so.depositAmount)}` : d === "PI" && so.piNo ? `PI ${so.piNo}` : null),
            }}
            stepExtra={(st) =>
              st.code === "PI_PAYMENT" ? (
                <RecordPaymentButton stepCode="PI_PAYMENT" stepId={st.id} targetId={so.id} label={`${so.label} deposit`} amount={so.depositAmount != null ? Number(so.depositAmount) : null} currency={so.currency} disabled={so.status !== "OPEN"} />
              ) : null
            }
            customerId={null}
            fieldsTitle="Contract"
            fieldsSummary={so.contract ? `Contract ${so.contract.contractNo}` : null}
            fieldsForm={() => (
              <Button variant="outlined" startIcon={<EditIcon />} onClick={() => setEditOpen(true)}>
                Link the contract
              </Button>
            )}
          />
        </Box>

        <Box>
          <Stack direction="row" alignItems="center" sx={{ mb: 1 }}>
            <Typography variant="overline" color="text.secondary" sx={{ flex: 1 }}>
              Customer orders ({so.customerOrders.length})
            </Typography>
            {so.status === "OPEN" && (
              <Button size="small" variant="outlined" startIcon={<LinkIcon />} onClick={() => setLinkOpen(true)}>
                Link customer order
              </Button>
            )}
          </Stack>
          {!so.customerOrders.length ? (
            <Paper variant="outlined" sx={{ p: 3, textAlign: "center", borderStyle: "dashed" }}>
              <Typography variant="body2">No customer order is bought under this supplier order yet.</Typography>
            </Paper>
          ) : (
            <Paper variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Order</TableCell>
                    <TableCell>Customer</TableCell>
                    <TableCell>Ship → delivery</TableCell>
                    <TableCell align="right">Qty (MT)</TableCell>
                    <TableCell>Shipments · CI payment (step 6)</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {so.customerOrders.map((o) => (
                    <TableRow key={o.id} hover sx={{ cursor: "pointer" }} onClick={() => router.push(`/portal/shipments/orders/${o.id}`)}>
                      <TableCell sx={{ fontWeight: 700 }}>{o.label}</TableCell>
                      <TableCell>{o.customerName ?? "—"}</TableCell>
                      <TableCell>{[monthShort(o.shipMonth), monthShort(o.deliveryMonth)].filter(Boolean).join(" → ") || "—"}</TableCell>
                      <TableCell align="right">{o.qtyMt != null ? fmtMt(o.qtyMt) : "—"}</TableCell>
                      <TableCell>
                        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                          {o.shipments.length
                            ? o.shipments.map((s) => (
                                <Chip
                                  key={s.id}
                                  size="small"
                                  variant="outlined"
                                  color={s.ciPayment?.status === "DONE" ? "success" : "default"}
                                  label={`${s.ref}${s.ciAmount != null ? ` · CI ${money(s.ciAmount)}` : ""} · ${s.ciPayment?.status === "DONE" ? "paid" : "unpaid"}`}
                                />
                              ))
                            : "—"}
                        </Stack>
                      </TableCell>
                      <TableCell>
                        <RecordStatusChip status={o.status} />
                      </TableCell>
                      <TableCell align="right">
                        {so.status === "OPEN" && (
                          <Button
                            size="small"
                            color="error"
                            onClick={async (e) => {
                              e.stopPropagation();
                              try {
                                await unlink.mutateAsync({ id: so.id, orderId: o.id });
                                toast.success(`Order ${o.label} unlinked`);
                              } catch (err: any) {
                                toast.error(err?.message || "Could not unlink");
                              }
                            }}
                          >
                            Unlink
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Paper>
          )}
        </Box>

        <Box>
          <Typography variant="overline" color="text.secondary">
            Files
          </Typography>
          <FilesTable filter={{ supplierOrderId: so.id }} currentId={so.id} uploadTargets={[owner]} canUpload={so.status === "OPEN"} />
        </Box>
      </Stack>

      <EditDialog open={editOpen} so={so} onClose={() => setEditOpen(false)} />
      <LinkOrderDialog open={linkOpen} so={so} onClose={() => setLinkOpen(false)} />
    </Box>
  );
}

function EditDialog({ open, so, onClose }: { open: boolean; so: SupplierOrder; onClose: () => void }) {
  const contracts = useContracts({ pageSize: 100 });
  const save = useTradeMutation((a, body: SupplierOrderInput) => a.updateSupplierOrder(so.id, body));
  const [f, setF] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!open) return;
    const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
    setF({
      contractId: s(so.contractId),
      declarationMonth: s(so.declarationMonth),
      grade: s(so.grade),
      size: s(so.size),
      qtyMt: s(so.qtyMt),
      qpBasis: s(so.qpBasis),
      provisionalPricePerMt: s(so.provisionalPricePerMt),
      supplierPremium: s(so.supplierPremium),
      piNo: s(so.piNo),
      piDate: so.piDate ? so.piDate.slice(0, 10) : "",
      piAmount: s(so.piAmount),
      depositPct: s(so.depositPct),
      depositAmount: s(so.depositAmount),
      depositPaidAt: so.depositPaidAt ? so.depositPaidAt.slice(0, 10) : "",
      notes: s(so.notes),
    });
  }, [open, so]);
  const num = (v: string) => (v.trim() === "" ? null : Number(v.replace(/,/g, "")));
  const txt = (v: string) => (v.trim() === "" ? null : v.trim());
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const field = (k: string, label: string, extra: Record<string, unknown> = {}) => (
    <Grid item xs={12} sm={6}>
      <TextField fullWidth size="small" label={label} value={f[k] ?? ""} onChange={set(k)} {...extra} />
    </Grid>
  );
  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Edit supplier order {so.label}</DialogTitle>
      <DialogContent dividers>
        <Grid container spacing={1.5}>
          <Grid item xs={12} sm={6}>
            <TextField select fullWidth size="small" label="Contract" value={f.contractId ?? ""} onChange={set("contractId")}>
              <MenuItem value="">—</MenuItem>
              {(contracts.data?.items ?? []).map((c) => (
                <MenuItem key={c.id} value={c.id}>
                  {[c.contractNo, c.customer?.name].filter(Boolean).join(" · ")}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          {field("declarationMonth", "Declaration month", { type: "month", InputLabelProps: { shrink: true } })}
          {field("grade", "Grade")}
          {field("size", "Size")}
          {field("qtyMt", "Quantity (MT)", { type: "number" })}
          {field("qpBasis", "QP basis (e.g. Average LME of MOSS (Aug'26))")}
          {field("provisionalPricePerMt", "Provisional price / MT", { type: "number" })}
          {field("supplierPremium", "Supplier premium (USD/MT, fixed part + QMJP)", { type: "number" })}
          {field("piNo", "PI no.")}
          {field("piDate", "PI date", { type: "date", InputLabelProps: { shrink: true } })}
          {field("piAmount", "PI amount", { type: "number" })}
          {field("depositPct", "Deposit %", { type: "number" })}
          {field("depositAmount", "Deposit amount", { type: "number" })}
          {field("depositPaidAt", "Deposit paid on", { type: "date", InputLabelProps: { shrink: true } })}
          <Grid item xs={12}>
            <TextField fullWidth size="small" multiline minRows={2} label="Notes" value={f.notes ?? ""} onChange={set("notes")} />
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={save.isPending}
          onClick={async () => {
            try {
              await save.mutateAsync({
                contractId: f.contractId || null,
                declarationMonth: txt(f.declarationMonth),
                grade: txt(f.grade),
                size: txt(f.size),
                qtyMt: num(f.qtyMt),
                qpBasis: txt(f.qpBasis),
                provisionalPricePerMt: num(f.provisionalPricePerMt),
                supplierPremium: num(f.supplierPremium),
                piNo: txt(f.piNo),
                piDate: txt(f.piDate),
                piAmount: num(f.piAmount),
                depositPct: num(f.depositPct),
                depositAmount: num(f.depositAmount),
                depositPaidAt: txt(f.depositPaidAt),
                notes: txt(f.notes),
              });
              toast.success("Supplier order saved");
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

/** Link open customer orders from the same supplier (an order belongs to one supplier order — linking moves it). */
function LinkOrderDialog({ open, so, onClose }: { open: boolean; so: SupplierOrder; onClose: () => void }) {
  const orders = useOrders({ bucket: "pending", pageSize: 100 }, open);
  const link = useTradeMutation((a, ids: string[]) => a.linkSupplierOrder(so.id, ids));
  const [picked, setPicked] = useState<string>("");
  const options = (orders.data?.items ?? []).filter((o) => o.supplierId === so.supplierId && !so.customerOrders.some((c) => c.id === o.id));
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Link a customer order to {so.label}</DialogTitle>
      <DialogContent dividers>
        <TextField select fullWidth size="small" label="Customer order" value={picked} onChange={(e) => setPicked(e.target.value)}>
          {options.map((o) => (
            <MenuItem key={o.id} value={o.id}>
              {`${o.label} · ${o.customerName ?? ""} · ${o.productLabel}${o.supplierOrder ? ` (now under ${o.supplierOrder.label})` : ""}`}
            </MenuItem>
          ))}
        </TextField>
        {!options.length && !orders.isLoading && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            No other open order from this supplier.
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={!picked || link.isPending}
          onClick={async () => {
            try {
              await link.mutateAsync([picked]);
              toast.success("Customer order linked");
              setPicked("");
              onClose();
            } catch (e: any) {
              toast.error(e?.message || "Could not link");
            }
          }}
        >
          Link
        </Button>
      </DialogActions>
    </Dialog>
  );
}
