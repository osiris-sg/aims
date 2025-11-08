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
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Card,
  CardContent,
  Grid,
  IconButton,
  Tooltip,
  Chip,
} from "@mui/material";
import {
  Search as SearchIcon,
  Download as DownloadIcon,
  FilterList as FilterIcon,
  Refresh as RefreshIcon,
  History as HistoryIcon,
} from "@mui/icons-material";
import { useAuth } from "@clerk/nextjs";
import { request } from "@/helpers/api/request";
import { toast } from "react-toastify";
import { DatePicker, LocalizationProvider } from "@mui/x-date-pickers";
import { AdapterDateFns } from "@mui/x-date-pickers/AdapterDateFns";
import { format } from "date-fns";

interface PriceHistoryItem {
  id: string;
  itemCode: string;
  itemDescription: string;
  unitPrice: number;
  quantity: number;
  uom: string;
  totalAmount: number;
  documentId: string;
  documentNumber: string;
  documentDate: string;
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
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    fetchCustomers();
    fetchItems();
    fetchPriceHistory();
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

      if (response?.success) {
        setCustomers(response.data || []);
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
          path: "/inventories",
          method: "GET",
        },
        {},
        token
      );

      if (response?.success) {
        setItems(response.data || []);
      }
    } catch (error) {
      console.error("Error fetching items:", error);
    }
  };

  const fetchPriceHistory = async () => {
    setLoading(true);
    try {
      const token = await getToken();
      if (!token) return;

      const params = new URLSearchParams();
      if (selectedCustomer) params.append("customerId", selectedCustomer.id);
      if (selectedItem) params.append("itemCode", selectedItem.sku);
      if (startDate) params.append("startDate", startDate.toISOString());
      if (endDate) params.append("endDate", endDate.toISOString());
      if (searchTerm) params.append("search", searchTerm);
      params.append("page", (page + 1).toString());
      params.append("limit", rowsPerPage.toString());

      const response = await request(
        {
          path: `/price-history/report?${params.toString()}`,
          method: "GET",
        },
        {},
        token
      );

      if (response?.success) {
        setPriceHistory(response.data || []);
        setTotalCount(response.totalCount || 0);
      } else {
        toast.error("Failed to fetch price history");
        setPriceHistory([]);
      }
    } catch (error) {
      console.error("Error fetching price history:", error);
      toast.error("Failed to fetch price history");
      setPriceHistory([]);
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
    setStartDate(null);
    setEndDate(null);
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
      if (startDate) params.append("startDate", startDate.toISOString());
      if (endDate) params.append("endDate", endDate.toISOString());
      if (searchTerm) params.append("search", searchTerm);
      params.append("format", "csv");

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
        const blob = new Blob([response.data], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `price-history-${format(new Date(), 'yyyy-MM-dd')}.csv`;
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

  const handleChangePage = (event: unknown, newPage: number) => {
    setPage(newPage);
    fetchPriceHistory();
  };

  const handleChangeRowsPerPage = (event: React.ChangeEvent<HTMLInputElement>) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
    fetchPriceHistory();
  };

  // Calculate summary statistics
  const getItemStatistics = () => {
    const itemStats = new Map();
    priceHistory.forEach(item => {
      const key = item.itemCode;
      if (!itemStats.has(key)) {
        itemStats.set(key, {
          itemCode: item.itemCode,
          itemDescription: item.itemDescription,
          count: 0,
          totalQuantity: 0,
          totalAmount: 0,
          avgPrice: 0,
          minPrice: item.unitPrice,
          maxPrice: item.unitPrice,
          lastPrice: item.unitPrice,
          lastDate: item.documentDate,
        });
      }
      const stats = itemStats.get(key);
      stats.count++;
      stats.totalQuantity += item.quantity;
      stats.totalAmount += item.totalAmount;
      stats.minPrice = Math.min(stats.minPrice, item.unitPrice);
      stats.maxPrice = Math.max(stats.maxPrice, item.unitPrice);
      if (new Date(item.documentDate) > new Date(stats.lastDate)) {
        stats.lastPrice = item.unitPrice;
        stats.lastDate = item.documentDate;
      }
    });

    itemStats.forEach(stats => {
      stats.avgPrice = stats.totalAmount / stats.totalQuantity;
    });

    return Array.from(itemStats.values());
  };

  return (
    <LocalizationProvider dateAdapter={AdapterDateFns}>
      <Box sx={{ p: 3 }}>
        {/* Header */}
        <Box sx={{ mb: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Box>
            <Typography variant="h4" sx={{ fontWeight: 600 }}>
              Last Price Sold Report
            </Typography>
            <Typography variant="body2" color="text.secondary">
              View and analyze historical pricing information for all items
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', gap: 2 }}>
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
          <Typography variant="h6" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
            <FilterIcon /> Filters
          </Typography>
          <Grid container spacing={2}>
            <Grid item xs={12} md={3}>
              <Autocomplete
                options={customers}
                getOptionLabel={(option) => option.name}
                value={selectedCustomer}
                onChange={(event, newValue) => setSelectedCustomer(newValue)}
                renderInput={(params) => (
                  <TextField {...params} label="Customer" fullWidth />
                )}
              />
            </Grid>
            <Grid item xs={12} md={3}>
              <Autocomplete
                options={items}
                getOptionLabel={(option) => `${option.sku} - ${option.name}`}
                value={selectedItem}
                onChange={(event, newValue) => setSelectedItem(newValue)}
                renderInput={(params) => (
                  <TextField {...params} label="Item" fullWidth />
                )}
              />
            </Grid>
            <Grid item xs={12} md={2}>
              <DatePicker
                label="Start Date"
                value={startDate}
                onChange={(newValue) => setStartDate(newValue)}
                renderInput={(params) => <TextField {...params} fullWidth />}
              />
            </Grid>
            <Grid item xs={12} md={2}>
              <DatePicker
                label="End Date"
                value={endDate}
                onChange={(newValue) => setEndDate(newValue)}
                renderInput={(params) => <TextField {...params} fullWidth />}
              />
            </Grid>
            <Grid item xs={12} md={2}>
              <TextField
                label="Search"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                fullWidth
                placeholder="Item code or description"
              />
            </Grid>
            <Grid item xs={12}>
              <Box sx={{ display: 'flex', gap: 2 }}>
                <Button
                  variant="contained"
                  startIcon={<SearchIcon />}
                  onClick={handleSearch}
                  disabled={loading}
                >
                  Search
                </Button>
                <Button
                  variant="outlined"
                  onClick={handleReset}
                  disabled={loading}
                >
                  Reset Filters
                </Button>
              </Box>
            </Grid>
          </Grid>
        </Paper>

        {/* Summary Statistics */}
        {priceHistory.length > 0 && (
          <Grid container spacing={2} sx={{ mb: 3 }}>
            {getItemStatistics().slice(0, 4).map((stats) => (
              <Grid item xs={12} sm={6} md={3} key={stats.itemCode}>
                <Card>
                  <CardContent>
                    <Typography variant="subtitle2" color="text.secondary" noWrap>
                      {stats.itemCode}
                    </Typography>
                    <Typography variant="h6" sx={{ fontWeight: 600 }}>
                      ${stats.lastPrice.toFixed(2)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Last sold on {new Date(stats.lastDate).toLocaleDateString()}
                    </Typography>
                    <Box sx={{ mt: 1 }}>
                      <Chip
                        label={`Avg: $${stats.avgPrice.toFixed(2)}`}
                        size="small"
                        sx={{ mr: 0.5 }}
                      />
                      <Chip
                        label={`${stats.count} sales`}
                        size="small"
                        variant="outlined"
                      />
                    </Box>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        )}

        {/* Price History Table */}
        <Paper sx={{ width: '100%', overflow: 'hidden' }}>
          <TableContainer sx={{ maxHeight: 600 }}>
            <Table stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>Item Code</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Description</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Document</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Date</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Customer</TableCell>
                  <TableCell align="center" sx={{ fontWeight: 600 }}>UoM</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600 }}>Qty</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600 }}>Unit Price</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600 }}>Total</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={9} align="center" sx={{ py: 4 }}>
                      <CircularProgress />
                    </TableCell>
                  </TableRow>
                ) : priceHistory.length > 0 ? (
                  priceHistory.map((history) => (
                    <TableRow key={history.id} hover>
                      <TableCell>
                        <Typography variant="body2" sx={{ fontWeight: 500 }}>
                          {history.itemCode}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Tooltip title={history.itemDescription}>
                          <Typography variant="body2" noWrap sx={{ maxWidth: 200 }}>
                            {history.itemDescription}
                          </Typography>
                        </Tooltip>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">
                          {history.documentNumber}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">
                          {new Date(history.documentDate).toLocaleDateString('en-GB', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric'
                          })}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" noWrap sx={{ maxWidth: 150 }}>
                          {history.customerName || '-'}
                        </Typography>
                      </TableCell>
                      <TableCell align="center">
                        <Typography variant="body2">
                          {history.uom || '-'}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">
                        <Typography variant="body2">
                          {history.quantity.toFixed(2)}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">
                        <Typography variant="body2" sx={{ fontWeight: 500 }}>
                          ${history.unitPrice.toFixed(2)}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">
                        <Typography variant="body2">
                          ${history.totalAmount.toFixed(2)}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={9} align="center" sx={{ py: 4 }}>
                      <Typography variant="body1" color="text.secondary">
                        No price history data available
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                        Try adjusting your filters or search criteria
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
          {priceHistory.length > 0 && (
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
    </LocalizationProvider>
  );
}