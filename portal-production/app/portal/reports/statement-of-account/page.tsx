'use client';

import React, { useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Grid,
  MenuItem,
  Select,
  FormControl,
  InputLabel,
  Card,
  CardContent,
  Divider,
  Alert,
  CircularProgress,
} from '@mui/material';
import { Download as DownloadIcon, Print as PrintIcon } from '@mui/icons-material';
import { useGetCustomers } from '@/app/portal/hooks/api';
import { useGenerateSOA } from '@/app/portal/hooks/api';
import { useOrganization } from '@hooks/useOrganization';

interface Customer {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
}

interface Transaction {
  id: string;
  date: string;
  reference: string;
  description: string;
  transactionType: string;
  debit: number;
  credit: number;
  balance: number;
  documentType?: string;
  paymentMethod?: string;
}

interface MonthlyBalance {
  month: string;
  debit: number;
  credit: number;
  balance: number;
}

interface AgingBucket {
  current: number;
  days30: number;
  days60: number;
  days90: number;
  days120Plus: number;
}

interface StatementData {
  customer: Customer;
  statement: {
    openingBalance: number;
    currentBalance: number;
    totalDebit: number;
    totalCredit: number;
    transactionCount: number;
  };
  transactions: Transaction[];
  monthlyBalances: MonthlyBalance[];
  agingAnalysis: AgingBucket | null;
  generatedAt: string;
}

export default function StatementOfAccountPage() {
  const [selectedCustomer, setSelectedCustomer] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [statementData, setStatementData] = useState<StatementData | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Check organization context
  const { organization } = useOrganization();
  console.log('=== Organization Context ===');
  console.log('organization:', organization);
  console.log('organization.id:', organization?.id);
  console.log('===========================');

  // Fetch customers with new hook
  const { customers = [], isLoading: loadingCustomers } = useGetCustomers({ limit: 1000 });

  // Debug logging
  console.log('=== useGetCustomers Debug ===');
  console.log('customers:', customers);
  console.log('customers type:', typeof customers);
  console.log('customers isArray:', Array.isArray(customers));
  console.log('customers length:', customers?.length);
  console.log('loadingCustomers:', loadingCustomers);
  console.log('============================');

  // Generate SOA mutation
  const generateSOAMutation = useGenerateSOA();

  const generateStatement = async () => {
    if (!selectedCustomer) {
      setError('Please select a customer');
      return;
    }

    try {
      setError(null);
      const params = {
        customerId: selectedCustomer,
        includeAging: true,
        format: 'json' as const,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      };

      const result = await generateSOAMutation.mutateAsync(params);
      setStatementData(result);
    } catch (err: unknown) {
      const error = err as Error;
      console.error('Failed to generate statement:', error);
      setError(error.message || 'Failed to generate statement');
    }
  };

  const downloadCSV = async () => {
    if (!selectedCustomer) return;

    try {
      const params = new URLSearchParams({
        customerId: selectedCustomer,
        format: 'csv',
      });

      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);

      // Direct download approach
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
      window.open(`${apiUrl}/statements/soa?${params.toString()}`, '_blank');
    } catch (error) {
      console.error('Failed to download CSV:', error);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('en-US');
  };

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" sx={{ mb: 3 }}>
        Statement of Account
      </Typography>

      {/* Filter Section */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} md={4}>
            <FormControl fullWidth>
              <InputLabel>Customer</InputLabel>
              <Select
                value={selectedCustomer}
                onChange={(e) => setSelectedCustomer(e.target.value)}
                label="Customer"
                disabled={loadingCustomers}
              >
                {loadingCustomers ? (
                  <MenuItem disabled>
                    <CircularProgress size={20} /> Loading customers...
                  </MenuItem>
                ) : customers.length === 0 ? (
                  <MenuItem disabled>No customers found</MenuItem>
                ) : (
                  customers.map((customer: Customer) => (
                    <MenuItem key={customer.id} value={customer.id}>
                      {customer.name}
                    </MenuItem>
                  ))
                )}
              </Select>
            </FormControl>
          </Grid>

          <Grid item xs={12} md={3}>
            <TextField
              fullWidth
              label="Start Date"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
            />
          </Grid>

          <Grid item xs={12} md={3}>
            <TextField
              fullWidth
              label="End Date"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
            />
          </Grid>

          <Grid item xs={12} md={2}>
            <Button
              fullWidth
              variant="contained"
              color="primary"
              onClick={generateStatement}
              disabled={generateSOAMutation.isPending || !selectedCustomer}
            >
              {generateSOAMutation.isPending ? 'Generating...' : 'Generate'}
            </Button>
          </Grid>
        </Grid>

        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </Paper>

      {/* Statement Display */}
      {statementData && (
        <Paper sx={{ p: 3 }} className="print-area">
          {/* Header Section */}
          <Box sx={{ mb: 4 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', mb: 2 }}>
              <Box>
                <Typography variant="h5" gutterBottom>
                  STATEMENT OF ACCOUNT
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Generated: {formatDate(statementData.generatedAt)}
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', gap: 1, '@media print': { display: 'none' } }}>
                <Button
                  variant="outlined"
                  startIcon={<DownloadIcon />}
                  onClick={downloadCSV}
                  size="small"
                >
                  Export CSV
                </Button>
                <Button
                  variant="outlined"
                  startIcon={<PrintIcon />}
                  onClick={handlePrint}
                  size="small"
                >
                  Print
                </Button>
              </Box>
            </Box>

            {/* Customer Information */}
            <Card variant="outlined">
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  {statementData.customer.name}
                </Typography>
                {statementData.customer.email && (
                  <Typography variant="body2">Email: {statementData.customer.email}</Typography>
                )}
                {statementData.customer.phone && (
                  <Typography variant="body2">Phone: {statementData.customer.phone}</Typography>
                )}
                {statementData.customer.address && (
                  <Typography variant="body2">Address: {statementData.customer.address}</Typography>
                )}
              </CardContent>
            </Card>
          </Box>

          {/* Summary Cards */}
          <Grid container spacing={2} sx={{ mb: 3 }}>
            <Grid item xs={6} md={3}>
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="body2" color="text.secondary">
                    Opening Balance
                  </Typography>
                  <Typography variant="h6">
                    {formatCurrency(statementData.statement.openingBalance)}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={6} md={3}>
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="body2" color="text.secondary">
                    Total Invoiced
                  </Typography>
                  <Typography variant="h6" color="error">
                    {formatCurrency(statementData.statement.totalDebit)}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={6} md={3}>
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="body2" color="text.secondary">
                    Total Paid
                  </Typography>
                  <Typography variant="h6" color="success.main">
                    {formatCurrency(statementData.statement.totalCredit)}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={6} md={3}>
              <Card variant="outlined" sx={{ bgcolor: 'primary.main', color: 'white' }}>
                <CardContent>
                  <Typography variant="body2" sx={{ color: 'white', opacity: 0.9 }}>
                    Current Balance
                  </Typography>
                  <Typography variant="h6" sx={{ color: 'white' }}>
                    {formatCurrency(statementData.statement.currentBalance)}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          </Grid>

          {/* Transactions Table */}
          <TableContainer sx={{ mb: 3 }}>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: 'grey.100' }}>
                  <TableCell>Date</TableCell>
                  <TableCell>Reference</TableCell>
                  <TableCell>Description</TableCell>
                  <TableCell align="right">Debit</TableCell>
                  <TableCell align="right">Credit</TableCell>
                  <TableCell align="right">Balance</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {statementData.transactions.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} align="center">
                      No transactions found
                    </TableCell>
                  </TableRow>
                ) : (
                  statementData.transactions.map((transaction) => (
                    <TableRow key={transaction.id}>
                      <TableCell>{formatDate(transaction.date)}</TableCell>
                      <TableCell>{transaction.reference}</TableCell>
                      <TableCell>{transaction.description}</TableCell>
                      <TableCell align="right">
                        {transaction.debit > 0 ? formatCurrency(transaction.debit) : '-'}
                      </TableCell>
                      <TableCell align="right">
                        {transaction.credit > 0 ? formatCurrency(transaction.credit) : '-'}
                      </TableCell>
                      <TableCell align="right">{formatCurrency(transaction.balance)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>

          {/* Monthly Summary */}
          {statementData.monthlyBalances && statementData.monthlyBalances.length > 0 && (
            <Box sx={{ mb: 3 }}>
              <Typography variant="h6" gutterBottom>
                Monthly Summary
              </Typography>
              <Grid container spacing={2}>
                {statementData.monthlyBalances.map((month) => (
                  <Grid item xs={6} sm={4} md={3} key={month.month}>
                    <Card variant="outlined">
                      <CardContent>
                        <Typography variant="body2" color="text.secondary">
                          {month.month}
                        </Typography>
                        <Typography variant="body2">
                          Debit: {formatCurrency(month.debit)}
                        </Typography>
                        <Typography variant="body2">
                          Credit: {formatCurrency(month.credit)}
                        </Typography>
                        <Typography variant="body2" fontWeight="bold">
                          Balance: {formatCurrency(month.balance)}
                        </Typography>
                      </CardContent>
                    </Card>
                  </Grid>
                ))}
              </Grid>
            </Box>
          )}

          {/* Aging Analysis */}
          {statementData.agingAnalysis && (
            <Box>
              <Typography variant="h6" gutterBottom>
                Aging Analysis
              </Typography>
              <Grid container spacing={2}>
                <Grid item xs={6} sm={2.4}>
                  <Card variant="outlined">
                    <CardContent>
                      <Typography variant="body2" color="text.secondary">
                        Current (0-30)
                      </Typography>
                      <Typography variant="h6">
                        {formatCurrency(statementData.agingAnalysis.current)}
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>
                <Grid item xs={6} sm={2.4}>
                  <Card variant="outlined">
                    <CardContent>
                      <Typography variant="body2" color="text.secondary">
                        31-60 Days
                      </Typography>
                      <Typography variant="h6">
                        {formatCurrency(statementData.agingAnalysis.days30)}
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>
                <Grid item xs={6} sm={2.4}>
                  <Card variant="outlined">
                    <CardContent>
                      <Typography variant="body2" color="text.secondary">
                        61-90 Days
                      </Typography>
                      <Typography variant="h6">
                        {formatCurrency(statementData.agingAnalysis.days60)}
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>
                <Grid item xs={6} sm={2.4}>
                  <Card variant="outlined">
                    <CardContent>
                      <Typography variant="body2" color="text.secondary">
                        91-120 Days
                      </Typography>
                      <Typography variant="h6">
                        {formatCurrency(statementData.agingAnalysis.days90)}
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>
                <Grid item xs={6} sm={2.4}>
                  <Card variant="outlined" sx={{ bgcolor: 'error.light' }}>
                    <CardContent>
                      <Typography variant="body2" color="white">
                        121+ Days
                      </Typography>
                      <Typography variant="h6" color="white">
                        {formatCurrency(statementData.agingAnalysis.days120Plus)}
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>
              </Grid>
            </Box>
          )}
        </Paper>
      )}

      {/* Print Styles */}
      <style jsx global>{`
        @media print {
          body * {
            visibility: hidden;
          }
          .print-area, .print-area * {
            visibility: visible;
          }
          .print-area {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
          }
        }
      `}</style>
    </Box>
  );
}
