"use client";

// Spend Money / Receive Money lists (guru 2026-11-06). Reached as
// /portal/accounting/payables?tab=spend-money and
// /portal/accounting/receivables?tab=receive-money; ?new=1 opens the editor
// straight away (the workspace buttons and the Purchase Journal chooser).
// Row click opens the transaction; ⋮ holds Void.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from "@mui/material";
import moment from "moment";
import { toast } from "react-toastify";
import PageTable from "@/components/PageTable";
import { useClientSort } from "@/components/clientSort";
import { kebabColumn } from "@/components/RowKebab";
import { useAccountingApi } from "../_lib/api";
import BankTransactionDialog, { KIND_LABEL, type BankTransactionKind, type BankTransactionRow } from "./BankTransactionDialog";

const fmt = (n: number) => (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function BankTransactionsView({ kind }: { kind: BankTransactionKind }) {
  const { request } = useAccountingApi();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [rows, setRows] = useState<BankTransactionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<BankTransactionRow | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await request<BankTransactionRow[]>(`/bank-transactions?kind=${kind}`);
      setRows(Array.isArray(list) ? list : []);
    } catch (e: any) {
      toast.error(e?.message || `Couldn't load ${KIND_LABEL[kind]}`);
    } finally {
      setLoading(false);
    }
  }, [request, kind]);

  useEffect(() => {
    void load();
  }, [load]);

  // ?new=1 → straight into a blank editor; the flag is dropped from the URL so
  // a refresh does not reopen it.
  useEffect(() => {
    // ?open=<id> (a ledger row posted from this transaction — guru 2026-11-06):
    // open it straight away; closing returns to ?from=.
    const openId = searchParams.get("open");
    if (openId) {
      request<BankTransactionRow>(`/bank-transactions/${openId}`)
        .then((r) => { if (r?.id) { setEditing(r); setEditorOpen(true); } })
        .catch((e: any) => toast.error(e?.message || "Couldn't open that transaction"));
    }
    if (searchParams.get("new") === "1") {
      setEditing(null);
      setEditorOpen(true);
      const params = new URLSearchParams(searchParams.toString());
      params.delete("new");
      router.replace(`${window.location.pathname}?${params.toString()}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // A ledger-opened transaction goes back to ?from= when its dialog closes.
  const returnTo = (() => { const f = searchParams.get("from"); return f && f.startsWith("/portal") ? f : null; })();
  const closeEditor = () => {
    setEditorOpen(false);
    if (returnTo) router.push(returnTo);
  };

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((r) =>
      [r.number, r.payee, r.reference, r.bankAccountName, r.bankAccountCode, r.journalNumber, r.remarks]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(term),
    );
  }, [rows, search]);

  const { sorted, sortingProps } = useClientSort(visible, {
    date: (r: any) => r.date || "",
    totalAmount: (r: any) => r.totalAmount || 0,
  });
  const pageCount = Math.max(1, Math.ceil(sorted.length / limit));
  const paged = sorted.slice((page - 1) * limit, page * limit);
  useEffect(() => {
    setPage(1);
  }, [search, limit]);

  // Void asks first (in-app dialog, never a browser confirm).
  const [voiding, setVoiding] = useState<BankTransactionRow | null>(null);
  const [voidBusy, setVoidBusy] = useState(false);
  const confirmVoid = async () => {
    if (!voiding) return;
    setVoidBusy(true);
    try {
      await request(`/bank-transactions/${voiding.id}/void`, { method: "POST" });
      toast.success(`${voiding.number} voided`);
      setVoiding(null);
      void load();
    } catch (e: any) {
      toast.error(e?.message || "Void failed");
    } finally {
      setVoidBusy(false);
    }
  };

  const columns = [
    {
      accessorKey: "number",
      header: "Number",
      cell: ({ row }: any) => <Box sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{row.original.number}</Box>,
    },
    {
      accessorKey: "date",
      header: "Date",
      nowrap: true,
      pxWidth: 110,
      cell: ({ row }: any) => (row.original.date ? moment(row.original.date).format("DD/MM/YYYY") : "—"),
    },
    { accessorKey: "payee", header: kind === "SPEND" ? "Paid to" : "Received from", cell: ({ row }: any) => row.original.payee || "—" },
    { accessorKey: "reference", header: "Reference", enableSorting: false, cell: ({ row }: any) => row.original.reference || "—" },
    {
      accessorKey: "bankAccountName",
      header: kind === "SPEND" ? "Paid from" : "Received into",
      enableSorting: false,
      cell: ({ row }: any) => row.original.bankAccountName || row.original.bankAccountCode || "—",
    },
    {
      accessorKey: "totalAmount",
      header: "Amount",
      align: "right",
      nowrap: true,
      pxWidth: 130,
      cell: ({ row }: any) => <Box sx={{ fontVariantNumeric: "tabular-nums", textAlign: "right" }}>{fmt(row.original.totalAmount)}</Box>,
    },
    {
      accessorKey: "journalNumber",
      header: "Journal",
      enableSorting: false,
      nowrap: true,
      cell: ({ row }: any) => row.original.journalNumber || "—",
    },
    {
      accessorKey: "status",
      header: "Status",
      pxWidth: 110,
      cell: ({ row }: any) =>
        row.original.status === "VOID" ? (
          <Chip size="small" variant="outlined" color="error" label="Void" sx={{ fontSize: "0.7rem" }} />
        ) : (
          <Chip size="small" variant="outlined" color="success" label="Posted" sx={{ fontSize: "0.7rem" }} />
        ),
    },
    kebabColumn((r: BankTransactionRow) => [
      { label: "Open", onClick: () => { setEditing(r); setEditorOpen(true); } },
      { label: "Void", destructive: true, disabled: r.status === "VOID", onClick: () => setVoiding(r) },
    ]),
  ];

  const subtitle =
    kind === "SPEND"
      ? "Money paid straight from the bank with no supplier invoice — each one posts its own journal to the bank ledger"
      : "Money received straight into the bank with no customer invoice — each one posts its own journal to the bank ledger";

  return (
    <>
      <PageTable
        columns={columns}
        data={paged}
        {...sortingProps}
        onRowClick={(r: BankTransactionRow) => { setEditing(r); setEditorOpen(true); }}
        tableName={KIND_LABEL[kind]}
        subTitle={subtitle}
        buttonName={`New ${KIND_LABEL[kind]}`}
        onAddClick={() => { setEditing(null); setEditorOpen(true); }}
        loading={loading}
        page={page}
        limit={limit}
        search={search}
        setPage={setPage}
        setLimit={setLimit}
        setSearch={setSearch}
        pageCount={pageCount}
        totalDocs={sorted.length}
      />
      <BankTransactionDialog
        open={editorOpen}
        kind={kind}
        editing={editing}
        onClose={closeEditor}
        onSaved={() => { void load(); closeEditor(); }}
      />
      <Dialog open={!!voiding} onClose={voidBusy ? undefined : () => setVoiding(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Void {voiding?.number}?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            The journal {voiding?.journalNumber ? `${voiding.journalNumber} ` : ""}is voided in place and the bank ledger no longer counts this {KIND_LABEL[kind].toLowerCase()}. The record stays for the audit trail and cannot be edited afterwards.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setVoiding(null)} disabled={voidBusy}>Cancel</Button>
          <Button color="error" variant="contained" onClick={confirmVoid} disabled={voidBusy}>Void</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

export function SpendMoneyView() {
  return <BankTransactionsView kind="SPEND" />;
}

export function ReceiveMoneyView() {
  return <BankTransactionsView kind="RECEIVE" />;
}
