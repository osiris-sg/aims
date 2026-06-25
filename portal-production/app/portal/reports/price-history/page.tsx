"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  Box,
  Paper,
  Typography,
  TextField,
  Button,
  Autocomplete,
  Grid2,
} from "@mui/material";
import {
  Search as SearchIcon,
  Download as DownloadIcon,
  FilterList as FilterIcon,
  Refresh as RefreshIcon,
} from "@mui/icons-material";
import { useAuth } from "@clerk/nextjs";
import { request } from "@/helpers/request";
import { toast } from "react-toastify";
import PageTable from "@/components/PageTable";

interface PriceHistoryItem {
  id: string;
  itemCode: string;
  itemDescription: string;
  documentNumber: string;
  documentDate: string;
  documentType: string;
  quantity: number;
  unitPrice: number;
  uom: string;
  customerId: string;
  customerName: string;
  organizationId: string;
  createdAt: string;
}

interface Customer {
  id: string;
  name: string;
}

interface Item {
  id: string;
  sku: string;
  name: string;
}

export default function PriceHistoryReportPage() {
  const { getToken } = useAuth();
  const [loading, setLoading] = useState(false);
  const [priceHistory, setPriceHistory] = useState<PriceHistoryItem[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [items, setItems] = useState<Item[]>([]);

  // PageTable-driven state (page is 1-based to match PageTable contract)
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<any>({});
  const [totalCount, setTotalCount] = useState(0);

  // Filters (form state — only applied to fetch on Search/Reset)
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [selectedItem, setSelectedItem] = useState<Item | null>(null);
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");

  const fetchCustomers = async () => {
    try {
      const token = await getToken();
      if (!token) return;

      const response = await request(
        { path: "/customers", method: "GET" },
        {},
        token,
      );

      if (response?.data) {
        setCustomers(response.data);
      }
    } catch (error) {
      console.error("Error fetching customers:", error);
    }
  };

  const fetchItems = async () => {
    try {
      const token = await getToken();
      if (!token) return;

      const response = await request(
        { path: "/inventory", method: "GET" },
        {},
        token,
      );

      if (response?.data) {
        setItems(response.data);
      }
    } catch (error) {
      console.error("Error fetching items:", error);
    }
  };

  const fetchPriceHistory = async () => {
    setLoading(true);
    try {
      const token = await getToken();
      if (!token) {
        toast.error("Authentication required");
        return;
      }

      const params = new URLSearchParams();
      if (selectedCustomer) params.append("customerId", selectedCustomer.id);
      if (selectedItem) params.append("itemCode", selectedItem.sku);
      if (startDate) params.append("startDate", startDate);
      if (endDate) params.append("endDate", endDate);
      if (search) params.append("search", search);
      params.append("page", page.toString());
      params.append("limit", limit.toString());

      const response = await request(
        { path: `/price-history?${params.toString()}`, method: "GET" },
        {},
        token,
      );

      if (response?.success && response.data) {
        setPriceHistory(response.data.data || []);
        setTotalCount(response.data.total || 0);
      }
    } catch (error) {
      console.error("Error fetching price history:", error);
      toast.error("Failed to fetch price history");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCustomers();
    fetchItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-fetch whenever pagination or search changes (PageTable owns these).
  useEffect(() => {
    fetchPriceHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, limit, search]);

  const handleSearch = () => {
    setPage(1);
    fetchPriceHistory();
  };

  const handleReset = () => {
    setSelectedCustomer(null);
    setSelectedItem(null);
    setStartDate("");
    setEndDate("");
    setSearch("");
    setPage(1);
    fetchPriceHistory();
  };

  const handleExport = async () => {
    try {
      const token = await getToken();
      if (!token) return;

      const params = new URLSearchParams();
      if (selectedCustomer) params.append("customerId", selectedCustomer.id);
      if (selectedItem) params.append("itemCode", selectedItem.sku);
      if (startDate) params.append("startDate", startDate);
      if (endDate) params.append("endDate", endDate);
      if (search) params.append("search", search);

      const response = await request(
        { path: `/price-history/export?${params.toString()}`, method: "GET" },
        {},
        token,
      );

      if (response?.success && response.data) {
        const blob = new Blob([response.data], { type: "text/csv" });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        const today = new Date().toISOString().split("T")[0];
        a.download = `price-history-${today}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        toast.success("Report exported successfully");
      } else {
        toast.error("Failed to export report");
      }
    } catch (error) {
      console.error("Error exporting report:", error);
      toast.error("Failed to export report");
    }
  };

  const formatDate = (date: string) => {
    if (!date) return "";
    const d = new Date(date);
    return d.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  };

  const pageCount = Math.max(1, Math.ceil(totalCount / limit));

  const columns = useMemo(() => [
    { accessorKey: "itemCode", header: "Item Code", cell: ({ row }: any) => row.original.itemCode },
    { accessorKey: "itemDescription", header: "Description", cell: ({ row }: any) => row.original.itemDescription },
    { accessorKey: "documentNumber", header: "Document No.", cell: ({ row }: any) => row.original.documentNumber },
    { accessorKey: "documentDate", header: "Date", cell: ({ row }: any) => formatDate(row.original.documentDate) },
    { accessorKey: "customerName", header: "Customer", cell: ({ row }: any) => row.original.customerName },
    {
      accessorKey: "quantity",
      header: "Quantity",
      cell: ({ row }: any) => <Box sx={{ textAlign: "right" }}>{row.original.quantity}</Box>,
    },
    { accessorKey: "uom", header: "UOM", cell: ({ row }: any) => row.original.uom },
    {
      accessorKey: "unitPrice",
      header: "Unit Price",
      cell: ({ row }: any) => (
        <Box sx={{ textAlign: "right" }}>${row.original.unitPrice.toFixed(2)}</Box>
      ),
    },
    {
      accessorKey: "total",
      header: "Total",
      cell: ({ row }: any) => (
        <Box sx={{ textAlign: "right" }}>
          ${(row.original.quantity * row.original.unitPrice).toFixed(2)}
        </Box>
      ),
    },
  ], []);

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Box sx={{ mb: 3, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 600 }}>
            Price History Report
          </Typography>
          <Typography variant="body2" color="text.secondary">
            View and analyze historical pricing information for all items
          </Typography>
        </Box>
        <Box sx={{ display: "flex", gap: 2 }}>
          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={fetchPriceHistory}
            disabled={loading}
          >
            Refresh
          </Button>
          <Button
            variant="contained"
            startIcon={<DownloadIcon />}
            onClick={handleExport}
            disabled={loading || priceHistory.length === 0}
          >
            Export CSV
          </Button>
        </Box>
      </Box>

      {/* Filters */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" sx={{ mb: 2, display: "flex", alignItems: "center", gap: 1 }}>
          <FilterIcon /> Filters
        </Typography>
        <Grid2 container spacing={2}>
          <Grid2 size={{ xs: 12, md: 3 }}>
            <Autocomplete
              options={customers}
              getOptionLabel={(option) => option.name}
              value={selectedCustomer}
              onChange={(_event, newValue) => setSelectedCustomer(newValue)}
              renderInput={(params) => <TextField {...params} label="Customer" fullWidth />}
            />
          </Grid2>
          <Grid2 size={{ xs: 12, md: 3 }}>
            <Autocomplete
              options={items}
              getOptionLabel={(option) => `${option.sku} - ${option.name}`}
              value={selectedItem}
              onChange={(_event, newValue) => setSelectedItem(newValue)}
              renderInput={(params) => <TextField {...params} label="Item" fullWidth />}
            />
          </Grid2>
          <Grid2 size={{ xs: 12, md: 3 }}>
            <TextField
              label="Start Date"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              fullWidth
              InputLabelProps={{ shrink: true }}
            />
          </Grid2>
          <Grid2 size={{ xs: 12, md: 3 }}>
            <TextField
              label="End Date"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              fullWidth
              InputLabelProps={{ shrink: true }}
            />
          </Grid2>
          <Grid2 size={{ xs: 12 }}>
            <Box sx={{ display: "flex", gap: 2 }}>
              <Button
                variant="contained"
                startIcon={<SearchIcon />}
                onClick={handleSearch}
                disabled={loading}
              >
                Search
              </Button>
              <Button variant="outlined" onClick={handleReset} disabled={loading}>
                Reset Filters
              </Button>
            </Box>
          </Grid2>
        </Grid2>
      </Paper>

      {/* Price History Table */}
      <PageTable
        columns={columns}
        data={priceHistory}
        tableName="Price History"
        subTitle="Historical pricing across documents"
        loading={loading}
        page={page}
        limit={limit}
        search={search}
        filters={filters}
        setPage={setPage}
        setLimit={setLimit}
        setSearch={setSearch}
        setFilters={setFilters}
        pageCount={pageCount}
        totalDocs={totalCount}
      />
    </Box>
  );
}
