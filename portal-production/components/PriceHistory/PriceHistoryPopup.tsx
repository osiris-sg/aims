import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Grid,
  TextField,
  CircularProgress,
  IconButton,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { useAuth } from '@clerk/nextjs';
import { request } from '@/helpers/request';

// Helper function to format dates
const formatDate = (date: string | Date) => {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
};

interface PriceHistoryItem {
  reference: string;
  date: string;
  uom: string;
  quantity: number;
  amount: number;
}

interface LastPriceData {
  documentNumber: string;
  documentDate: string;
  unitPrice: number;
  quantity: number;
  uom: string;
}

interface PriceHistoryPopupProps {
  open: boolean;
  onClose: () => void;
  itemCode: string;
  itemDescription: string;
  customerId?: string;
  onSelectPrice?: (price: number, quantity: number) => void;
}

const PriceHistoryPopup: React.FC<PriceHistoryPopupProps> = ({
  open,
  onClose,
  itemCode,
  itemDescription,
  customerId,
  onSelectPrice,
}) => {
  const { getToken } = useAuth();
  const [loading, setLoading] = useState(false);
  const [lastPrice, setLastPrice] = useState<LastPriceData | null>(null);
  const [priceHistory, setPriceHistory] = useState<PriceHistoryItem[]>([]);
  const [stockBalance, setStockBalance] = useState(0);
  const [cost, setCost] = useState(0);
  const [selectedQuantity, setSelectedQuantity] = useState(100);

  useEffect(() => {
    if (open && itemCode) {
      fetchPriceHistory();
    }
  }, [open, itemCode, customerId]);

  const fetchPriceHistory = async () => {
    setLoading(true);
    try {
      const token = await getToken();
      if (!token) {
        console.error('No auth token available');
        return;
      }

      // Fetch last sold price
      const lastPriceResponse = await request(
        {
          path: `/price-history/item/${encodeURIComponent(itemCode)}/last-price${
            customerId ? `?customerId=${customerId}` : ''
          }`,
          method: 'GET',
        },
        {},
        token
      );

      console.log('Last Price Response:', lastPriceResponse);
      if (lastPriceResponse) {
        setLastPrice(lastPriceResponse);
      }

      // Fetch price history
      const queryParams = new URLSearchParams();
      if (customerId) queryParams.append('customerId', customerId);
      queryParams.append('limit', '10');

      const historyResponse = await request(
        {
          path: `/price-history/item/${encodeURIComponent(itemCode)}?${queryParams.toString()}`,
          method: 'GET',
        },
        {},
        token
      );

      console.log('History Response:', historyResponse);
      console.log('History Response Type:', typeof historyResponse);
      console.log('History Response Keys:', historyResponse ? Object.keys(historyResponse) : 'null');

      // Check if historyResponse has the expected structure
      if (historyResponse && historyResponse.success && historyResponse.data) {
        // The actual array is at historyResponse.data.data
        const historyData = historyResponse.data.data || [];

        console.log('History Data to map:', historyData);

        setPriceHistory(
          historyData.map((item: any) => ({
            reference: item.documentNumber,
            date: item.documentDate,
            uom: item.uom || 'PC',
            quantity: item.quantity,
            amount: item.unitPrice,
          }))
        );

        // Also set the last price if we have data
        if (historyData.length > 0 && !lastPriceResponse) {
          setLastPrice({
            documentNumber: historyData[0].documentNumber,
            documentDate: historyData[0].documentDate,
            unitPrice: historyData[0].unitPrice,
            quantity: historyData[0].quantity,
            uom: historyData[0].uom || 'PC'
          });
        }
      }

      // TODO: Fetch stock balance and cost from inventory API
      setStockBalance(0);
      setCost(0);
    } catch (error) {
      console.error('Error fetching price history:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = () => {
    if (lastPrice && onSelectPrice) {
      onSelectPrice(lastPrice.unitPrice, selectedQuantity);
    }
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle
        sx={{
          bgcolor: '#1976d2',
          color: 'white',
          py: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Typography variant="h6">LAST SOLD PRICE</Typography>
        <IconButton size="small" onClick={onClose} sx={{ color: 'white' }}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers sx={{ p: 2 }}>
        {loading ? (
          <Box display="flex" justifyContent="center" p={3}>
            <CircularProgress />
          </Box>
        ) : (
          <>
            {/* Item Details */}
            <Grid container spacing={2} mb={2}>
              <Grid item xs={12}>
                <Box sx={{ bgcolor: '#8B7355', color: 'white', p: 1 }}>
                  <Grid container spacing={2}>
                    <Grid item xs={3}>
                      <Typography variant="body2">Code</Typography>
                      <Typography variant="body1" fontWeight="bold">
                        {itemCode}
                      </Typography>
                    </Grid>
                    <Grid item xs={6}>
                      <Typography variant="body2">Description</Typography>
                      <Typography variant="body1" fontWeight="bold">
                        {itemDescription}
                      </Typography>
                    </Grid>
                    <Grid item xs={3}>
                      <Typography variant="body2">Stock Balance</Typography>
                      <Typography variant="body1" fontWeight="bold">
                        {stockBalance.toFixed(3)}
                      </Typography>
                    </Grid>
                  </Grid>
                </Box>
              </Grid>

              <Grid item xs={6}>
                <Box sx={{ bgcolor: '#8B7355', color: 'white', p: 1 }}>
                  <Typography variant="body2">Part No</Typography>
                  <TextField
                    size="small"
                    fullWidth
                    variant="outlined"
                    sx={{
                      bgcolor: 'white',
                      '& .MuiOutlinedInput-root': { height: 30 },
                    }}
                  />
                </Box>
              </Grid>

              <Grid item xs={6}>
                <Box sx={{ bgcolor: '#8B7355', color: 'white', p: 1 }}>
                  <Typography variant="body2">Cost</Typography>
                  <Typography variant="body1" fontWeight="bold">
                    {cost.toFixed(4)}
                  </Typography>
                </Box>
              </Grid>
            </Grid>

            {/* Price History Table */}
            <TableContainer component={Paper} variant="outlined" sx={{ mb: 2 }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Reference</TableCell>
                    <TableCell>Date</TableCell>
                    <TableCell>Uom</TableCell>
                    <TableCell align="right">Qty</TableCell>
                    <TableCell align="right">Amount</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {priceHistory.map((item, index) => (
                    <TableRow key={index}>
                      <TableCell>{item.reference}</TableCell>
                      <TableCell>{formatDate(item.date)}</TableCell>
                      <TableCell>{item.uom}</TableCell>
                      <TableCell align="right">{item.quantity}</TableCell>
                      <TableCell align="right">
                        {item.amount.toFixed(2)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>

            {/* Last Sold Price Section */}
            <Box sx={{ bgcolor: '#8B7355', color: 'white', p: 1.5 }}>
              <Grid container spacing={2} alignItems="center">
                <Grid item xs={3}>
                  <Typography variant="body2">Document Reference</Typography>
                  <TextField
                    size="small"
                    fullWidth
                    value={lastPrice?.documentNumber || ''}
                    variant="outlined"
                    sx={{
                      bgcolor: 'white',
                      '& .MuiOutlinedInput-root': { height: 30 },
                    }}
                  />
                </Grid>
                <Grid item xs={2}>
                  <Typography variant="body2">Date</Typography>
                  <TextField
                    size="small"
                    fullWidth
                    value={
                      lastPrice?.documentDate
                        ? formatDate(lastPrice.documentDate)
                        : ''
                    }
                    variant="outlined"
                    sx={{
                      bgcolor: 'white',
                      '& .MuiOutlinedInput-root': { height: 30 },
                    }}
                  />
                </Grid>
                <Grid item xs={2}>
                  <Typography variant="body2">Last Sold Price</Typography>
                  <TextField
                    size="small"
                    fullWidth
                    value={lastPrice?.unitPrice?.toFixed(4) || '0.0000'}
                    variant="outlined"
                    sx={{
                      bgcolor: 'white',
                      '& .MuiOutlinedInput-root': { height: 30 },
                    }}
                  />
                </Grid>
                <Grid item xs={2}>
                  <Typography variant="body2">Quantity</Typography>
                  <TextField
                    size="small"
                    fullWidth
                    value={selectedQuantity}
                    onChange={(e) =>
                      setSelectedQuantity(Number(e.target.value))
                    }
                    type="number"
                    variant="outlined"
                    sx={{
                      bgcolor: 'white',
                      '& .MuiOutlinedInput-root': { height: 30 },
                    }}
                  />
                </Grid>
                <Grid item xs={1}>
                  <Typography variant="body2">UOM</Typography>
                  <Typography variant="body1">
                    {lastPrice?.uom || 'PAIR'}
                  </Typography>
                </Grid>
              </Grid>
            </Box>

            {/* Remarks Section */}
            <Box sx={{ mt: 2 }}>
              <Typography variant="body2" sx={{ mb: 0.5 }}>
                Remarks
              </Typography>
              <TextField
                fullWidth
                multiline
                rows={2}
                variant="outlined"
                placeholder="Enter remarks..."
              />
            </Box>
          </>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} variant="contained" color="inherit">
          Exit
        </Button>
        {onSelectPrice && (
          <Button onClick={handleConfirm} variant="contained" color="primary">
            Confirm
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
};

export default PriceHistoryPopup;