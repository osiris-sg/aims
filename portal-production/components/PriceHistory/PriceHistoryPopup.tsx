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
  assetId: string;
  itemCode: string;
  itemDescription: string;
  customerId?: string;
  onSelectPrice?: (price: number, quantity: number) => void;
}

const PriceHistoryPopup: React.FC<PriceHistoryPopupProps> = ({
  open,
  onClose,
  assetId,
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
    if (open && assetId) {
      fetchPriceHistory();
    }
  }, [open, assetId, customerId]);

  const fetchPriceHistory = async () => {
    setLoading(true);
    try {
      const token = await getToken();
      if (!token) {
        console.error('No auth token available');
        return;
      }

      // Fetch price history (single API call)
      const queryParams = new URLSearchParams();
      if (customerId) queryParams.append('customerId', customerId);
      queryParams.append('limit', '10');

      const historyResponse = await request(
        {
          path: `/price-history/asset/${assetId}?${queryParams.toString()}`,
          method: 'GET',
        },
        {},
        token
      );

      console.log('History Response:', historyResponse);

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

        // Set the last price from the first item (data is already sorted by date desc)
        if (historyData.length > 0) {
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
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      sx={{
        zIndex: 9999,
        '& .MuiBackdrop-root': {
          backgroundColor: 'rgba(0, 0, 0, 0.5)'
        },
        '& .MuiDialog-paper': {
          backgroundColor: '#FFFFFF',
          backgroundImage: 'none'
        }
      }}
    >
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

      <DialogContent
        dividers
        sx={{
          p: 2,
          bgcolor: '#FFFFFF',
          backgroundColor: '#FFFFFF',
          backgroundImage: 'none',
          isolation: 'isolate'
        }}
      >
        <Box
          sx={{
            bgcolor: '#FFFFFF',
            backgroundColor: '#FFFFFF',
            backgroundImage: 'none'
          }}
        >
          {loading ? (
            <Box display="flex" justifyContent="center" p={3}>
              <CircularProgress />
            </Box>
          ) : (
            <>
              {/* Item Details */}
              <Grid container spacing={2} mb={2}>
              <Grid item xs={12}>
                <Box sx={{
                  bgcolor: '#f5f5f5',
                  border: '1px solid #e0e0e0',
                  borderRadius: 1,
                  p: 1.5
                }}>
                  <Grid container spacing={2}>
                    <Grid item xs={3}>
                      <Typography variant="body2" color="text.secondary">Code</Typography>
                      <Typography variant="body1" fontWeight="bold">
                        {itemCode}
                      </Typography>
                    </Grid>
                    <Grid item xs={6}>
                      <Typography variant="body2" color="text.secondary">Description</Typography>
                      <Typography variant="body1" fontWeight="bold">
                        {itemDescription}
                      </Typography>
                    </Grid>
                    <Grid item xs={3}>
                      <Typography variant="body2" color="text.secondary">Stock Balance</Typography>
                      <Typography variant="body1" fontWeight="bold">
                        {stockBalance.toFixed(3)}
                      </Typography>
                    </Grid>
                  </Grid>
                </Box>
              </Grid>

              <Grid item xs={6}>
                <Box sx={{
                  bgcolor: '#f5f5f5',
                  border: '1px solid #e0e0e0',
                  borderRadius: 1,
                  p: 1
                }}>
                  <Typography variant="body2" color="text.secondary">Part No</Typography>
                  <TextField
                    size="small"
                    fullWidth
                    variant="outlined"
                    sx={{
                      bgcolor: 'white',
                      '& .MuiOutlinedInput-root': {
                        height: 30,
                        bgcolor: 'white'
                      }
                    }}
                  />
                </Box>
              </Grid>

              <Grid item xs={6}>
                <Box sx={{
                  bgcolor: '#f5f5f5',
                  border: '1px solid #e0e0e0',
                  borderRadius: 1,
                  p: 1
                }}>
                  <Typography variant="body2" color="text.secondary">Cost</Typography>
                  <Typography variant="body1" fontWeight="bold">
                    {cost.toFixed(4)}
                  </Typography>
                </Box>
              </Grid>
            </Grid>

            {/* Price History Table */}
            <TableContainer component={Paper} variant="outlined" sx={{ mb: 2, bgcolor: 'white' }}>
              <Table size="small" sx={{ bgcolor: 'white' }}>
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
                    <TableRow
                      key={index}
                      sx={{
                        bgcolor: 'white',
                        '&:hover': { bgcolor: 'rgba(0, 0, 0, 0.04)' }
                      }}
                    >
                      <TableCell sx={{ bgcolor: 'transparent' }}>{item.reference}</TableCell>
                      <TableCell sx={{ bgcolor: 'transparent' }}>{formatDate(item.date)}</TableCell>
                      <TableCell sx={{ bgcolor: 'transparent' }}>{item.uom}</TableCell>
                      <TableCell sx={{ bgcolor: 'transparent' }} align="right">{item.quantity}</TableCell>
                      <TableCell sx={{ bgcolor: 'transparent' }} align="right">
                        {item.amount.toFixed(2)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>

            {/* Last Sold Price Section */}
            <Box sx={{
              bgcolor: '#f5f5f5',
              border: '1px solid #e0e0e0',
              borderRadius: 1,
              p: 1.5,
              mb: 2
            }}>
              <Grid container spacing={1.5} alignItems="flex-end">
                <Grid item xs={12} sm={4}>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                    Document Reference
                  </Typography>
                  <TextField
                    size="small"
                    fullWidth
                    value={priceHistory.length > 0 ? priceHistory[0].reference : ''}
                    variant="outlined"
                    InputProps={{ readOnly: true }}
                    sx={{
                      bgcolor: 'white',
                      '& .MuiOutlinedInput-root': { height: 35 },
                    }}
                  />
                </Grid>
                <Grid item xs={12} sm={2.5}>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                    Date
                  </Typography>
                  <TextField
                    size="small"
                    fullWidth
                    value={
                      priceHistory.length > 0
                        ? formatDate(priceHistory[0].date)
                        : ''
                    }
                    variant="outlined"
                    InputProps={{ readOnly: true }}
                    sx={{
                      bgcolor: 'white',
                      '& .MuiOutlinedInput-root': { height: 35 },
                    }}
                  />
                </Grid>
                <Grid item xs={12} sm={2.5}>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5, whiteSpace: 'nowrap' }}>
                    Price
                  </Typography>
                  <TextField
                    size="small"
                    fullWidth
                    value={priceHistory.length > 0 ? priceHistory[0].amount.toFixed(4) : '0.0000'}
                    variant="outlined"
                    InputProps={{ readOnly: true }}
                    sx={{
                      bgcolor: 'white',
                      '& .MuiOutlinedInput-root': { height: 35 },
                    }}
                  />
                </Grid>
                <Grid item xs={12} sm={1.5}>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                    Qty
                  </Typography>
                  <TextField
                    size="small"
                    fullWidth
                    value={priceHistory.length > 0 ? priceHistory[0].quantity : selectedQuantity}
                    onChange={(e) =>
                      setSelectedQuantity(Number(e.target.value))
                    }
                    type="number"
                    variant="outlined"
                    sx={{
                      bgcolor: 'white',
                      '& .MuiOutlinedInput-root': { height: 35 },
                    }}
                  />
                </Grid>
                <Grid item xs={12} sm={1.5}>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                    UOM
                  </Typography>
                  <TextField
                    size="small"
                    fullWidth
                    value={priceHistory.length > 0 ? priceHistory[0].uom : 'PC'}
                    variant="outlined"
                    InputProps={{ readOnly: true }}
                    sx={{
                      bgcolor: 'white',
                      '& .MuiOutlinedInput-root': { height: 35 },
                    }}
                  />
                </Grid>
              </Grid>
            </Box>

            {/* Remarks Section */}
            <Box sx={{ mt: 1 }}>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                Remarks
              </Typography>
              <TextField
                fullWidth
                multiline
                rows={2}
                variant="outlined"
                placeholder="Enter remarks..."
                sx={{
                  bgcolor: 'white'
                }}
              />
            </Box>
          </>
        )}
        </Box>
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