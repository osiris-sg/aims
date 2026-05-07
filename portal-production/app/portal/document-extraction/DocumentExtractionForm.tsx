import React, { useState, useEffect } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  Stack,
  Grid,
  TextField,
  IconButton,
  Divider,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Alert,
} from '@mui/material';
import { Add, Delete, Save, Cancel } from '@mui/icons-material';

interface ExtractedItem {
  description: string;
  quantity: number;
  unitPrice: number;
  tax: number;
  amount: number;
  serialNumbers?: string[];
  unit?: string;
}

interface ExtractedData {
  documentType: string;
  customer: {
    name: string;
    address: string;
    attention?: string;
  };
  document: {
    number: string;
    date: string;
    dueDate?: string;
    reference?: string;
    type: string;
  };
  references?: {
    doNumber?: string;
    doDate?: string;
    quotationRef?: string;
    quotationDate?: string;
    workOrderNo?: string;
    workOrderDate?: string;
  };
  project?: {
    location?: string;
    projectDept?: string;
  };
  items: ExtractedItem[];
  totals: {
    subtotal: number;
    tax: number;
    total: number;
  };
  company?: {
    name: string;
    address: string;
    gstRegNo?: string;
  };
}

interface DocumentExtractionFormProps {
  data: ExtractedData;
  onSave: (data: ExtractedData) => void;
  onCancel: () => void;
}

export default function DocumentExtractionForm({
  data,
  onSave,
  onCancel,
}: DocumentExtractionFormProps) {
  // Initialize with proper defaults to avoid undefined issues
  const initializeFormData = (rawData: any): ExtractedData => {
    console.log('Initializing form data with:', rawData);

    // Check if rawData is null or undefined
    if (!rawData) {
      console.log('No data provided, using empty defaults');
      return {
        documentType: 'invoice',
        customer: { name: '', address: '', attention: '' },
        document: { number: '', date: '', dueDate: '', reference: '', type: '' },
        references: {
          doNumber: '', doDate: '', quotationRef: '',
          quotationDate: '', workOrderNo: '', workOrderDate: ''
        },
        project: { location: '', projectDept: '' },
        items: [{
          description: '', quantity: 1, unitPrice: 0,
          tax: 0, amount: 0, serialNumbers: [], unit: 'pcs'
        }],
        totals: { subtotal: 0, tax: 0, total: 0 },
        company: { name: '', address: '', gstRegNo: '' }
      };
    }

    console.log('Raw data structure:', {
      hasCustomer: !!rawData.customer,
      hasDocument: !!rawData.document,
      hasItems: !!rawData.items,
      itemsLength: rawData.items?.length
    });

    return {
      documentType: rawData.documentType || 'invoice',
      customer: {
        name: rawData.customer?.name || '',
        address: rawData.customer?.address || '',
        attention: rawData.customer?.attention || '',
      },
      document: {
        number: rawData.document?.number || '',
        date: rawData.document?.date || '',
        dueDate: rawData.document?.dueDate || '',
        reference: rawData.document?.reference || '',
        type: rawData.document?.type || '',
      },
      references: {
        doNumber: rawData.references?.doNumber || '',
        doDate: rawData.references?.doDate || '',
        quotationRef: rawData.references?.quotationRef || '',
        quotationDate: rawData.references?.quotationDate || '',
        workOrderNo: rawData.references?.workOrderNo || '',
        workOrderDate: rawData.references?.workOrderDate || '',
      },
      project: {
        location: rawData.project?.location || '',
        projectDept: rawData.project?.projectDept || '',
      },
      items: Array.isArray(rawData.items) && rawData.items.length > 0
        ? rawData.items.map((item: any) => ({
            description: item.description || '',
            quantity: item.quantity || 0,
            unitPrice: item.unitPrice || 0,
            tax: item.tax || 0,
            amount: item.amount || 0,
            serialNumbers: item.serialNumbers || [],
            unit: item.unit || 'pcs',
          }))
        : [{
            description: '',
            quantity: 1,
            unitPrice: 0,
            tax: 0,
            amount: 0,
            serialNumbers: [],
            unit: 'pcs',
          }],
      totals: {
        subtotal: rawData.totals?.subtotal || 0,
        tax: rawData.totals?.tax || 0,
        total: rawData.totals?.total || 0,
      },
      company: {
        name: rawData.company?.name || '',
        address: rawData.company?.address || '',
        gstRegNo: rawData.company?.gstRegNo || '',
      },
    };
  };

  const [formData, setFormData] = useState<ExtractedData>(() => initializeFormData(data));
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    console.log('DocumentExtractionForm received data:', data);
    const initialized = initializeFormData(data);
    console.log('Initialized form data:', initialized);
    setFormData(initialized);
  }, [data]);

  const handleCustomerChange = (field: string, value: string) => {
    setFormData((prev) => ({
      ...prev,
      customer: { ...prev.customer, [field]: value },
    }));
    setHasChanges(true);
  };

  const handleDocumentChange = (field: string, value: string) => {
    setFormData((prev) => ({
      ...prev,
      document: { ...prev.document, [field]: value },
    }));
    setHasChanges(true);
  };

  const handleReferenceChange = (field: string, value: string) => {
    setFormData((prev) => ({
      ...prev,
      references: { ...prev.references, [field]: value },
    }));
    setHasChanges(true);
  };

  const handleProjectChange = (field: string, value: string) => {
    setFormData((prev) => ({
      ...prev,
      project: { ...prev.project, [field]: value },
    }));
    setHasChanges(true);
  };

  const handleItemChange = (index: number, field: string, value: any) => {
    const updatedItems = [...formData.items];
    updatedItems[index] = { ...updatedItems[index], [field]: value };

    // Recalculate amount if quantity or unit price changes
    if (field === 'quantity' || field === 'unitPrice') {
      const item = updatedItems[index];
      item.amount = item.quantity * item.unitPrice;
    }

    setFormData((prev) => ({ ...prev, items: updatedItems }));
    recalculateTotals(updatedItems);
    setHasChanges(true);
  };

  const addItem = () => {
    const newItem: ExtractedItem = {
      description: '',
      quantity: 1,
      unitPrice: 0,
      tax: formData.items[0]?.tax || 0,
      amount: 0,
      unit: 'pcs',
    };
    const updatedItems = [...formData.items, newItem];
    setFormData((prev) => ({ ...prev, items: updatedItems }));
    setHasChanges(true);
  };

  const removeItem = (index: number) => {
    const updatedItems = formData.items.filter((_, i) => i !== index);
    setFormData((prev) => ({ ...prev, items: updatedItems }));
    recalculateTotals(updatedItems);
    setHasChanges(true);
  };

  const recalculateTotals = (items: ExtractedItem[]) => {
    const subtotal = items.reduce((sum, item) => sum + item.amount, 0);
    const tax = items.reduce(
      (sum, item) => sum + (item.amount * item.tax) / 100,
      0
    );
    const total = subtotal + tax;

    setFormData((prev) => ({
      ...prev,
      totals: { subtotal, tax, total },
    }));
  };

  const handleSave = () => {
    onSave(formData);
    setHasChanges(false);
  };

  return (
    <Box sx={{ mt: 3 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h5">
          Review & Edit Extracted Data
        </Typography>
        <Stack direction="row" spacing={2}>
          <Button
            variant="outlined"
            startIcon={<Cancel />}
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            startIcon={<Save />}
            onClick={handleSave}
            disabled={!hasChanges}
          >
            Save & Create Records
          </Button>
        </Stack>
      </Stack>

      {hasChanges && (
        <Alert severity="info" sx={{ mb: 2 }}>
          You have unsaved changes. Click "Save & Create Records" to proceed.
        </Alert>
      )}

      <Grid container spacing={3}>
        {/* Customer Information */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom color="primary">
                Customer Information
              </Typography>
              <Stack spacing={2}>
                <TextField
                  label="Customer Name"
                  value={formData.customer?.name || ''}
                  onChange={(e) => handleCustomerChange('name', e.target.value)}
                  fullWidth
                  required
                />
                <TextField
                  label="Address"
                  value={formData.customer?.address || ''}
                  onChange={(e) => handleCustomerChange('address', e.target.value)}
                  fullWidth
                  multiline
                  rows={2}
                />
                <TextField
                  label="Attention To"
                  value={formData.customer?.attention || ''}
                  onChange={(e) => handleCustomerChange('attention', e.target.value)}
                  fullWidth
                />
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        {/* Document Details */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom color="primary">
                Document Details
              </Typography>
              <Stack spacing={2}>
                <TextField
                  label="Document Number"
                  value={formData.document?.number || ''}
                  onChange={(e) => handleDocumentChange('number', e.target.value)}
                  fullWidth
                  required
                />
                <TextField
                  label="Document Date"
                  type="date"
                  value={formData.document?.date || ''}
                  onChange={(e) => handleDocumentChange('date', e.target.value)}
                  fullWidth
                  InputLabelProps={{ shrink: true }}
                  required
                />
                <TextField
                  label="Due Date"
                  type="date"
                  value={formData.document?.dueDate || ''}
                  onChange={(e) => handleDocumentChange('dueDate', e.target.value)}
                  fullWidth
                  InputLabelProps={{ shrink: true }}
                />
                <TextField
                  label="Reference"
                  value={formData.document?.reference || ''}
                  onChange={(e) => handleDocumentChange('reference', e.target.value)}
                  fullWidth
                  multiline
                  rows={2}
                />
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        {/* References */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom color="primary">
                References
              </Typography>
              <Stack spacing={2}>
                <TextField
                  label="DO Number"
                  value={formData.references?.doNumber || ''}
                  onChange={(e) => handleReferenceChange('doNumber', e.target.value)}
                  fullWidth
                />
                <TextField
                  label="DO Date"
                  type="date"
                  value={formData.references?.doDate || ''}
                  onChange={(e) => handleReferenceChange('doDate', e.target.value)}
                  fullWidth
                  InputLabelProps={{ shrink: true }}
                />
                <TextField
                  label="Quotation Reference"
                  value={formData.references?.quotationRef || ''}
                  onChange={(e) => handleReferenceChange('quotationRef', e.target.value)}
                  fullWidth
                />
                <TextField
                  label="Work Order Number"
                  value={formData.references?.workOrderNo || ''}
                  onChange={(e) => handleReferenceChange('workOrderNo', e.target.value)}
                  fullWidth
                />
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        {/* Project Information */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom color="primary">
                Project Information
              </Typography>
              <Stack spacing={2}>
                <TextField
                  label="Project Location"
                  value={formData.project?.location || ''}
                  onChange={(e) => handleProjectChange('location', e.target.value)}
                  fullWidth
                  multiline
                  rows={2}
                />
                <TextField
                  label="Project Department"
                  value={formData.project?.projectDept || ''}
                  onChange={(e) => handleProjectChange('projectDept', e.target.value)}
                  fullWidth
                />
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        {/* Items Table */}
        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
                <Typography variant="h6" color="primary">
                  Items
                </Typography>
                <Button
                  variant="outlined"
                  startIcon={<Add />}
                  onClick={addItem}
                  size="small"
                >
                  Add Item
                </Button>
              </Stack>

              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell width="40%"><strong>Description</strong></TableCell>
                      <TableCell width="10%" align="center"><strong>Qty</strong></TableCell>
                      <TableCell width="10%" align="center"><strong>Unit</strong></TableCell>
                      <TableCell width="15%" align="right"><strong>Unit Price</strong></TableCell>
                      <TableCell width="10%" align="right"><strong>Tax %</strong></TableCell>
                      <TableCell width="15%" align="right"><strong>Amount</strong></TableCell>
                      <TableCell width="5%" align="center"><strong>Action</strong></TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {formData.items?.map((item, index) => (
                      <TableRow key={index}>
                        <TableCell>
                          <TextField
                            value={item.description}
                            onChange={(e) =>
                              handleItemChange(index, 'description', e.target.value)
                            }
                            fullWidth
                            size="small"
                            multiline
                          />
                        </TableCell>
                        <TableCell>
                          <TextField
                            type="number"
                            value={item.quantity}
                            onChange={(e) =>
                              handleItemChange(index, 'quantity', parseFloat(e.target.value) || 0)
                            }
                            size="small"
                            inputProps={{ min: 0, step: 1 }}
                          />
                        </TableCell>
                        <TableCell>
                          <TextField
                            value={item.unit || 'pcs'}
                            onChange={(e) => handleItemChange(index, 'unit', e.target.value)}
                            size="small"
                          />
                        </TableCell>
                        <TableCell>
                          <TextField
                            type="number"
                            value={item.unitPrice}
                            onChange={(e) =>
                              handleItemChange(index, 'unitPrice', parseFloat(e.target.value) || 0)
                            }
                            size="small"
                            inputProps={{ min: 0, step: 0.01 }}
                          />
                        </TableCell>
                        <TableCell>
                          <TextField
                            type="number"
                            value={item.tax}
                            onChange={(e) =>
                              handleItemChange(index, 'tax', parseFloat(e.target.value) || 0)
                            }
                            size="small"
                            inputProps={{ min: 0, step: 0.01 }}
                          />
                        </TableCell>
                        <TableCell align="right">
                          <Typography variant="body2" fontWeight="bold">
                            ${item.amount.toFixed(2)}
                          </Typography>
                        </TableCell>
                        <TableCell align="center">
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => removeItem(index)}
                            disabled={formData.items.length === 1}
                          >
                            <Delete fontSize="small" />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>

              {/* Totals */}
              <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end' }}>
                <Box sx={{ width: { xs: '100%', sm: '400px' } }}>
                  <Stack spacing={1}>
                    <Stack direction="row" justifyContent="space-between">
                      <Typography>Subtotal:</Typography>
                      <Typography fontWeight="bold">
                        ${formData.totals?.subtotal.toFixed(2)}
                      </Typography>
                    </Stack>
                    <Stack direction="row" justifyContent="space-between">
                      <Typography>Tax:</Typography>
                      <Typography fontWeight="bold">
                        ${formData.totals?.tax.toFixed(2)}
                      </Typography>
                    </Stack>
                    <Divider />
                    <Stack direction="row" justifyContent="space-between">
                      <Typography variant="h6" color="primary">
                        Total:
                      </Typography>
                      <Typography variant="h6" color="primary" fontWeight="bold">
                        ${formData.totals?.total.toFixed(2)}
                      </Typography>
                    </Stack>
                  </Stack>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Action Buttons (Bottom) */}
      <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end', gap: 2 }}>
        <Button
          variant="outlined"
          startIcon={<Cancel />}
          onClick={onCancel}
          size="large"
        >
          Cancel
        </Button>
        <Button
          variant="contained"
          startIcon={<Save />}
          onClick={handleSave}
          disabled={!hasChanges}
          size="large"
        >
          Save & Create Records
        </Button>
      </Box>
    </Box>
  );
}
