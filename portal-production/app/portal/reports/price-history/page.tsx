"use client";

import React, { useState, useEffect } from "react";
import {
  Box,
  Paper,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
  TextField,
  Button,
  CircularProgress,
  Autocomplete,
  Card,
  CardContent,
  Tooltip,
  Chip,
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
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [totalCount, setTotalCount] = useState(0);

  // Filters
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [selectedItem, setSelectedItem] = useState<Item | null>(null);
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    fetchCustomers();
    fetchItems();
    fetchPriceHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchCustomers = async () => {
    try {
      const token = await getToken();
      if (!token) return;

      const response = await request(
        {
          path: "/customers",
          method: "GET",
        },
        {},
        token
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
        {
          path: "/inventory",
          method: "GET",
        },
        {},
        token
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
      if (searchTerm) params.append("search", searchTerm);
      params.append("page", (page + 1).toString());
      params.append("limit", rowsPerPage.toString());

      const response = await request(
        {
          path: `/price-history?${params.toString()}`,
          method: "GET",
        },
        {},
        token
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

  const handleSearch = () => {
    setPage(0);
    fetchPriceHistory();
  };

  const handleReset = () => {
    setSelectedCustomer(null);
    setSelectedItem(null);
    setStartDate("");
    setEndDate("");
    setSearchTerm("");
    setPage(0);
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
      if (searchTerm) params.append("search", searchTerm);

      const response = await request(
        {
          path: `/price-history/export?${params.toString()}`,
          method: "GET",
        },
        {},
        token
      );

      if (response?.success && response.data) {
        // Create a blob and download
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

  const handleChangePage = (_event: unknown, newPage: number) => {
    setPage(newPage);
  };

  const handleChangeRowsPerPage = (event: React.ChangeEvent<HTMLInputElement>) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
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
          <Grid2 size={{ xs: 12, md: 2 }}>
            <TextField
              label="Start Date"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              fullWidth
              InputLabelProps={{ shrink: true }}
            />
          </Grid2>
          <Grid2 size={{ xs: 12, md: 2 }}>
            <TextField
              label="End Date"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              fullWidth
              InputLabelProps={{ shrink: true }}
            />
          </Grid2>
          <Grid2 size={{ xs: 12, md: 2 }}>
            <TextField
              label="Search"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              fullWidth
              placeholder="Search items..."
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
      <Paper sx={{ width: "100%", overflow: "hidden" }}>
        <TableContainer sx={{ maxHeight: 600 }}>
          <Table stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell>Item Code</TableCell>
                <TableCell>Description</TableCell>
                <TableCell>Document No.</TableCell>
                <TableCell>Date</TableCell>
                <TableCell>Customer</TableCell>
                <TableCell align="right">Quantity</TableCell>
                <TableCell>UOM</TableCell>
                <TableCell align="right">Unit Price</TableCell>
                <TableCell align="right">Total</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={9} align="center">
                    <CircularProgress />
                  </TableCell>
                </TableRow>
              ) : priceHistory.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} align="center">
                    <Typography variant="body2" color="text.secondary">
                      No price history found
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                priceHistory.map((history) => (
                  <TableRow key={history.id} hover>
                    <TableCell>{history.itemCode}</TableCell>
                    <TableCell>{history.itemDescription}</TableCell>
                    <TableCell>{history.documentNumber}</TableCell>
                    <TableCell>{formatDate(history.documentDate)}</TableCell>
                    <TableCell>{history.customerName}</TableCell>
                    <TableCell align="right">{history.quantity}</TableCell>
                    <TableCell>{history.uom}</TableCell>
                    <TableCell align="right">${history.unitPrice.toFixed(2)}</TableCell>
                    <TableCell align="right">
                      ${(history.quantity * history.unitPrice).toFixed(2)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
        {!loading && priceHistory.length > 0 && (
          <TablePagination
            rowsPerPageOptions={[10, 25, 50, 100]}
            component="div"
            count={totalCount}
            rowsPerPage={rowsPerPage}
            page={page}
            onPageChange={handleChangePage}
            onRowsPerPageChange={handleChangeRowsPerPage}
          />
        )}
      </Paper>
    </Box>
  );
}
