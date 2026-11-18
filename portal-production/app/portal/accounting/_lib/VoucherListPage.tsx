"use client";

// Official Receipts / Payment Vouchers / Journal Vouchers as LIST pages
// (guru 2026-11-11: "for OR, JV and PV do the same way, for all orgs"): the
// same idiom as the Sales document list — stat cards, a Create button, a
// row opens the voucher in its editor and comes back here.
//
// The AR / AP home buttons (Official Receipt, Payment Voucher, Journal
// Voucher) follow the org's enableDocumentListView flag like every other
// document module (guru 2026-11-16: the flag is OFF for Chong Aik, so keying
// a PV must open a voucher, not this list): ON → this list; OFF → a fresh
// voucher is created and its editor opens straight away (`useOpenVoucher`).

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Box, Chip, Grid, Paper, Typography } from "@mui/material";
import { toast } from "react-toastify";
import MainCard from "@/components/MainCard";
import PageTable from "@/components/PageTable";
import { useAccountingApi } from "./api";
import { useOrganizationFeatures } from "@/app/portal/hooks/useOrganizationFeatures";
import { DEFAULT_PAGE_SIZE } from "@/components/PageTable";

export type Kind = "receipt" | "payment-voucher" | "journal-voucher";

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

/** Home-button opener: list when enableDocumentListView is ON, else create + open the editor. */
export function useOpenVoucher() {
  const router = useRouter();
  const { request } = useAccountingApi();
  const { isDocumentListViewEnabled } = useOrganizationFeatures();
  return useCallback(
    async (kind: Kind) => {
      const spec = SPECS[kind];
      if (isDocumentListViewEnabled) {
        router.push(spec.listPath);
        return;
      }
      try {
        const v = unwrap(await request(spec.apiPath, { method: "POST", body: JSON.stringify({}) }));
        if (!v?.id) throw new Error(`Couldn't create the ${spec.label.toLowerCase()}`);
        router.push(`${spec.editorBase}/${v.id}?from=${encodeURIComponent(spec.listPath)}`);
      } catch (e: any) {
        toast.error(e?.message || `Couldn't create the ${spec.label.toLowerCase()}`);
      }
    },
    [router, request, isDocumentListViewEnabled],
  );
}

export default function VoucherListPage({ kind }: { kind: Kind }) {
  const spec = SPECS[kind];
  const router = useRouter();
  const { request } = useAccountingApi();
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState({ total: 0, thisMonth: 0, unconfirmed: 0, amount: 0 });
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(DEFAULT_PAGE_SIZE);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<any>({ status: "", date: { startDate: null, endDate: null } });

  // SERVER-SIDE list (guru 2026-11-18). It used to fetch the endpoint's newest
  // 500 by created date and search, filter, total and page them in the browser.
  // Once 2,950 receipts and vouchers arrived from Xero in one import, those
  // 2,950 WERE the newest 500: the page showed only ORX-/PVX- rows ending in
  // September, "This month 0", and the search box could not find an October
  // receipt it had never downloaded. Now the search, the Filter, the pager and
  // the four cards are all answered by SQL, ordered by the voucher's own date.
  const dateFilter = useMemo(
    () => ({
      from: filters?.date?.startDate ? String(filters.date.startDate).slice(0, 10) : "",
      to: filters?.date?.endDate ? String(filters.date.endDate).slice(0, 10) : "",
    }),
    [filters?.date?.startDate, filters?.date?.endDate],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (search.trim()) qs.set("search", search.trim());
      if (filters?.status) qs.set("status", String(filters.status));
      if (dateFilter.from) qs.set("from", dateFilter.from);
      if (dateFilter.to) qs.set("to", dateFilter.to);
      const res = unwrap(await request(`${spec.apiPath}/paged?${qs.toString()}`));
      setRows(Array.isArray(res?.rows) ? res.rows : []);
      setTotal(Number(res?.total) || 0);
      setStats(res?.stats || { total: 0, thisMonth: 0, unconfirmed: 0, amount: 0 });
    } catch (e: any) {
      toast.error(e?.message || `Couldn't load ${spec.plural.toLowerCase()}`);
    } finally {
      setLoading(false);
    }
  }, [request, spec.apiPath, spec.plural, page, limit, search, filters?.status, dateFilter]);

  // A new search or filter starts at page 1 — asking for page 7 of a narrower
  // result set shows an empty table. Declared BEFORE the fetch below so the
  // reset lands in the same pass, instead of fetching the old page first.
  useEffect(() => {
    setPage(1);
  }, [search, filters?.status, dateFilter, limit]);

  useEffect(() => {
    void load();
  }, [load]);

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

  // The server already returned exactly this page, in order.
  const pageRows = rows;

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
        pageCount={Math.max(1, Math.ceil(total / limit))}
        totalDocs={total}
        headerContent={
          <Box sx={{ mb: 3 }}>
            <Grid container spacing={2}>
              <Grid item xs={12} sm={3}>
                {/* Counted in SQL over the filtered set — a real number, however many there are. */}
                <StatCard title={`Total ${spec.plural}`} value={stats.total} />
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
