"use client";

// Official Receipts / Payment Vouchers / Journal Vouchers as LIST pages
// (guru 2026-11-11: "for OR, JV and PV do the same way, for all orgs"): the
// same idiom as the Sales document list — stat cards, a Create button, a
// row opens the voucher in its editor and comes back here. Every org gets
// it; there is no flag, the home buttons simply land here.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Box, Chip, Grid, Paper, Typography } from "@mui/material";
import { toast } from "react-toastify";
import MainCard from "@/components/MainCard";
import PageTable from "@/components/PageTable";
import { useAccountingApi } from "./api";

type Kind = "receipt" | "payment-voucher" | "journal-voucher";

type Spec = {
  kind: Kind;
  label: string; // "Official Receipt"
  plural: string; // "Official Receipts"
  apiPath: string; // "/receipts"
  listPath: string; // "/portal/accounting/receipts"
  editorBase: string; // "/portal/accounting/receipts"
  number: (r: any) => string;
  party: { header: string; of: (r: any) => string };
  amount: (r: any) => number;
};

const SPECS: Record<Kind, Spec> = {
  receipt: {
    kind: "receipt",
    label: "Official Receipt",
    plural: "Official Receipts",
    apiPath: "/receipts",
    listPath: "/portal/accounting/receipts",
    editorBase: "/portal/accounting/receipts",
    number: (r) => r.receiptNumber || "",
    party: { header: "Customer", of: (r) => r.customerName || "" },
    amount: (r) => Number(r.receiptAmount) || 0,
  },
  "payment-voucher": {
    kind: "payment-voucher",
    label: "Payment Voucher",
    plural: "Payment Vouchers",
    apiPath: "/payment-vouchers",
    listPath: "/portal/accounting/payment-vouchers",
    editorBase: "/portal/accounting/payment-vouchers",
    number: (r) => r.voucherNumber || "",
    party: { header: "Payee", of: (r) => r.payee || "" },
    amount: (r) => Number(r.total ?? r.voucherAmount) || 0,
  },
  "journal-voucher": {
    kind: "journal-voucher",
    label: "Journal Voucher",
    plural: "Journal Vouchers",
    apiPath: "/journal-vouchers",
    listPath: "/portal/accounting/journal-vouchers",
    editorBase: "/portal/accounting/journal-vouchers",
    number: (r) => r.voucherNumber || "",
    party: { header: "Prepared by", of: (r) => r.preparedBy || "" },
    amount: (r) => Number(r.totalDebit) || 0,
  },
};

const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const unwrap = (r: any) => (r && typeof r === "object" && r.success !== undefined && r.data !== undefined ? r.data : r);

// Document.status → one of three words. A voucher is 'unconfirmed' until its
// first save posts it; a deleted one is 'cancelled'.
const statusOf = (s?: string | null): "Unconfirmed" | "Confirmed" | "Void" => {
  const v = String(s || "").toLowerCase();
  if (!v || v === "draft" || v === "unconfirmed") return "Unconfirmed";
  if (v === "cancelled" || v === "void" || v === "voided") return "Void";
  return "Confirmed";
};

function StatCard({ title, value, tone }: { title: string; value: string | number; tone?: string }) {
  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
      <Typography sx={{ color: "text.secondary", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 700, fontSize: "0.9rem", lineHeight: 1.3 }}>
        {title}
      </Typography>
      <Typography sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 700, fontSize: "1.25rem", mt: 0.5, color: tone || "text.primary" }}>
        {value}
      </Typography>
    </Paper>
  );
}

export default function VoucherListPage({ kind }: { kind: Kind }) {
  const spec = SPECS[kind];
  const router = useRouter();
  const { request } = useAccountingApi();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<any>({ status: "", date: { startDate: null, endDate: null } });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = unwrap(await request(spec.apiPath));
      setRows(Array.isArray(list) ? list : []);
    } catch (e: any) {
      toast.error(e?.message || `Couldn't load ${spec.plural.toLowerCase()}`);
    } finally {
      setLoading(false);
    }
  }, [request, spec.apiPath, spec.plural]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [search, filters, limit]);

  const editorUrl = (r: any) => `${spec.editorBase}/${r.id}?from=${encodeURIComponent(spec.listPath)}`;

  const create = async () => {
    setCreating(true);
    try {
      const v = unwrap(await request(spec.apiPath, { method: "POST", body: JSON.stringify({}) }));
      if (!v?.id) throw new Error(`Couldn't create the ${spec.label.toLowerCase()}`);
      router.push(editorUrl(v));
    } catch (e: any) {
      toast.error(e?.message || `Couldn't create the ${spec.label.toLowerCase()}`);
      setCreating(false);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const st = filters?.status || "";
    const from = filters?.date?.startDate ? new Date(filters.date.startDate) : null;
    const to = filters?.date?.endDate ? new Date(filters.date.endDate) : null;
    if (to) to.setHours(23, 59, 59, 999);
    return rows.filter((r) => {
      if (st && statusOf(r.status) !== st) return false;
      if (from || to) {
        const d = r.date ? new Date(r.date) : null;
        if (!d) return false;
        if (from && d < from) return false;
        if (to && d > to) return false;
      }
      if (!q) return true;
      return [spec.number(r), spec.party.of(r), r.remarks, r.notes, r.journalNumber, r.chequeNo]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [rows, search, filters, spec]);

  const stats = useMemo(() => {
    const now = new Date();
    const m = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    return {
      total: rows.length,
      thisMonth: rows.filter((r) => String(r.date || "").slice(0, 7) === m).length,
      unconfirmed: rows.filter((r) => statusOf(r.status) === "Unconfirmed").length,
      amount: filtered.reduce((s, r) => (statusOf(r.status) === "Void" ? s : s + spec.amount(r)), 0),
    };
  }, [rows, filtered, spec]);

  const pageRows = useMemo(() => filtered.slice((page - 1) * limit, page * limit), [filtered, page, limit]);

  const columns = [
    {
      accessorKey: "number",
      header: `${spec.label} #`,
      cell: ({ row }: any) => <Box sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{spec.number(row.original) || "—"}</Box>,
    },
    {
      accessorKey: "date",
      header: "Date",
      cell: ({ row }: any) => (row.original.date ? new Date(row.original.date).toLocaleDateString("en-GB") : "—"),
    },
    {
      id: "party",
      header: spec.party.header,
      cell: ({ row }: any) => spec.party.of(row.original) || "—",
    },
    {
      id: "amount",
      header: "Amount",
      cell: ({ row }: any) => (
        <Box sx={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt(spec.amount(row.original))}</Box>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }: any) => {
        const s = statusOf(row.original.status);
        return (
          <Chip
            size="small"
            variant="outlined"
            label={s}
            color={s === "Confirmed" ? "success" : s === "Void" ? "error" : "warning"}
          />
        );
      },
    },
  ];

  return (
    <MainCard>
      <PageTable
        columns={columns}
        data={pageRows}
        onRowClick={(r: any) => router.push(editorUrl(r))}
        rowHref={editorUrl}
        tableName={`${spec.plural} List`}
        buttonName={`Create ${spec.label}`}
        onAddClick={() => void create()}
        buttonDisabled={creating}
        loading={loading || creating}
        page={page}
        limit={limit}
        search={search}
        filters={filters}
        setPage={setPage}
        setLimit={setLimit}
        setSearch={setSearch}
        setFilters={setFilters}
        filterConfig={[
          {
            type: "select",
            key: "status",
            label: "Status",
            options: [
              { label: "All", value: "" },
              { label: "Unconfirmed", value: "Unconfirmed" },
              { label: "Confirmed", value: "Confirmed" },
              { label: "Void", value: "Void" },
            ],
          },
          { type: "dateRange", key: "date", label: "Date" },
        ]}
        pageCount={Math.max(1, Math.ceil(filtered.length / limit))}
        totalDocs={filtered.length}
        headerContent={
          <Box sx={{ mb: 3 }}>
            <Grid container spacing={2}>
              <Grid item xs={12} sm={3}>
                {/* The list endpoints return the latest 500; past that the count reads "500+". */}
                <StatCard title={`Total ${spec.plural}`} value={rows.length >= 500 ? `${stats.total}+` : stats.total} />
              </Grid>
              <Grid item xs={12} sm={3}>
                <StatCard title="This month" value={stats.thisMonth} />
              </Grid>
              <Grid item xs={12} sm={3}>
                <StatCard title="Unconfirmed" value={stats.unconfirmed} tone={stats.unconfirmed ? "warning.main" : undefined} />
              </Grid>
              <Grid item xs={12} sm={3}>
                <StatCard title="Amount shown" value={fmt(stats.amount)} tone="success.main" />
              </Grid>
            </Grid>
          </Box>
        }
      />
    </MainCard>
  );
}
