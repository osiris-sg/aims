/**
 * Dynamic Form Fields Component
 *
 * Renders form fields dynamically based on template field definitions.
 * Uses a table-like layout with labels on the left and inputs on the right.
 */

import React from 'react';
import {
  Box,
  TextField,
  Select,
  MenuItem,
  FormControl,
  Typography,
  InputAdornment,
  IconButton,
} from '@mui/material';
import { Search as SearchIcon } from '@mui/icons-material';
import { FieldDefinition } from '../types/templateFieldTypes';

// Salesman interface
interface Salesman {
  id: string;
  salesmanCode: string;
  name: string;
  email?: string;
}

// Separate component for customer/supplier field to properly use hooks
interface CustomerCodeFieldProps {
  customers: any[];
  formData: any;
  setFormData: (data: any) => void;
  onOpenDialog?: (fieldName?: string) => void;
  inputSx: any;
  fieldName?: string; // e.g., "customer" or "documentInfo.supplierCode" - defaults to "customer"
  storeMode?: 'object' | 'code'; // 'object' stores full customer object, 'code' stores just the code string
}

function CustomerCodeField({
  customers,
  formData,
  setFormData,
  onOpenDialog,
  inputSx,
  fieldName = 'customer',
  storeMode = 'object'
}: CustomerCodeFieldProps) {
  // Helper to get nested value
  const getNestedVal = (obj: any, path: string) => {
    return path.split('.').reduce((acc, part) => acc && acc[part], obj);
  };

  // Helper to set nested value
  const setNestedVal = (obj: any, path: string, value: any) => {
    const newObj = JSON.parse(JSON.stringify(obj));
    const parts = path.split('.');
    let current = newObj;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!current[parts[i]]) current[parts[i]] = {};
      current = current[parts[i]];
    }
    current[parts[parts.length - 1]] = value;
    return newObj;
  };

  // For object mode, find customer by ID; for code mode, find by code
  const currentValue = getNestedVal(formData, fieldName);
  const selectedCustomer = storeMode === 'object'
    ? customers.find((c: any) => c.id === currentValue?.id)
    : customers.find((c: any) => c.customerCode === currentValue);

  const [customerCodeInput, setCustomerCodeInput] = React.useState(
    selectedCustomer?.customerCode || (storeMode === 'code' ? currentValue : '') || ''
  );

  // Update input when selected customer changes
  React.useEffect(() => {
    if (selectedCustomer?.customerCode) {
      setCustomerCodeInput(selectedCustomer.customerCode);
    } else if (storeMode === 'code') {
      const val = getNestedVal(formData, fieldName) || '';
      setCustomerCodeInput(val);
    }
  }, [selectedCustomer?.customerCode, formData, fieldName, storeMode]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const foundCustomer = customers.find(
        (c: any) => c.customerCode?.toLowerCase() === customerCodeInput.toLowerCase()
      );
      if (foundCustomer) {
        if (storeMode === 'object') {
          setFormData({
            ...formData,
            customer: {
              id: foundCustomer.id || '',
              name: foundCustomer.name || '',
              address: foundCustomer.address || '',
              email: foundCustomer.email || '',
            },
          });
        } else {
          setFormData(setNestedVal(formData, fieldName, foundCustomer.customerCode));
        }
      }
    }
  };

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', flex: 1, gap: 1 }}>
      <TextField
        value={selectedCustomer ? (selectedCustomer.customerCode || '') : customerCodeInput}
        onChange={(e) => {
          const newVal = e.target.value.toUpperCase();
          if (storeMode === 'object') {
            if (selectedCustomer) {
              setFormData({
                ...formData,
                customer: { id: '', name: '', address: '', email: '' },
              });
            }
            setCustomerCodeInput(newVal);
          } else {
            setCustomerCodeInput(newVal);
            setFormData(setNestedVal(formData, fieldName, newVal));
          }
        }}
        onKeyDown={handleKeyDown}
        size="small"
        sx={{ ...inputSx, width: 100, minWidth: 80 }}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start" sx={{ mr: 0 }}>
              <IconButton
                size="small"
                onClick={() => onOpenDialog?.(fieldName)}
                sx={{ p: 0.25, ml: -0.5 }}
                title="Search"
              >
                <SearchIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </InputAdornment>
          ),
        }}
      />
      {selectedCustomer?.name && (
        <Typography
          sx={{
            fontSize: '0.75rem',
            fontWeight: 400,
            color: 'text.secondary',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {selectedCustomer.name}
        </Typography>
      )}
    </Box>
  );
}

// Separate component for salesman/purchaser field to properly use hooks
interface SalesmanCodeFieldProps {
  salesmen: Salesman[];
  formData: any;
  setFormData: (data: any) => void;
  onOpenDialog?: (fieldName?: string) => void;
  inputSx: any;
  fieldName: string; // e.g., "documentInfo.salesPerson" or "documentInfo.purchaserCode"
}

// Helper to get nested value from object path
const getNestedVal = (obj: any, path: string) => {
  return path.split('.').reduce((acc, part) => acc && acc[part], obj);
};

// Helper to set nested value in object
const setNestedVal = (obj: any, path: string, value: any) => {
  const newObj = JSON.parse(JSON.stringify(obj)); // Deep clone
  const parts = path.split('.');
  let current = newObj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!current[parts[i]]) current[parts[i]] = {};
    current = current[parts[i]];
  }
  current[parts[parts.length - 1]] = value;
  return newObj;
};

function SalesmanCodeField({ salesmen, formData, setFormData, onOpenDialog, inputSx, fieldName }: SalesmanCodeFieldProps) {
  // Extract salesmen array - handle both direct array and response object with data property
  const salesmenArray = React.useMemo(() => {
    if (Array.isArray(salesmen)) {
      return salesmen;
    }
    // Handle case where full API response is passed: {success, message, data: [...]}
    if (salesmen && typeof salesmen === 'object' && 'data' in salesmen && Array.isArray((salesmen as any).data)) {
      return (salesmen as any).data;
    }
    return [];
  }, [salesmen]);

  const currentValue = getNestedVal(formData, fieldName) || '';
  const selectedSalesman = salesmenArray.find((s: Salesman) => s.salesmanCode === currentValue);
  const [codeInput, setCodeInput] = React.useState(currentValue);

  // Update input when value changes
  React.useEffect(() => {
    const val = getNestedVal(formData, fieldName) || '';
    setCodeInput(val);
  }, [formData, fieldName]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const found = salesmenArray.find(
        (s: Salesman) => s.salesmanCode?.toLowerCase() === codeInput.toLowerCase()
      );
      if (found) {
        setFormData(setNestedVal(formData, fieldName, found.salesmanCode));
      }
    }
  };

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', flex: 1, gap: 1 }}>
      <TextField
        value={codeInput}
        onChange={(e) => {
          const newVal = e.target.value.toUpperCase();
          setCodeInput(newVal);
          setFormData(setNestedVal(formData, fieldName, newVal));
        }}
        onKeyDown={handleKeyDown}
        size="small"
        sx={{ ...inputSx, width: 80, minWidth: 60 }}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start" sx={{ mr: 0 }}>
              <IconButton
                size="small"
                onClick={() => onOpenDialog?.(fieldName)}
                sx={{ p: 0.25, ml: -0.5 }}
                title="Search"
              >
                <SearchIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </InputAdornment>
          ),
        }}
      />
      {selectedSalesman?.name && (
        <Typography
          sx={{
            fontSize: '0.75rem',
            fontWeight: 400,
            color: 'text.secondary',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {selectedSalesman.name}
        </Typography>
      )}
    </Box>
  );
}

interface DynamicFormFieldsProps {
  fields: FieldDefinition[];
  formData: any;
  setFormData: (data: any) => void;
  customers?: any[];
  projects?: any[];
  deliveryOrders?: any[];
  siteOffices?: any[];
  salesmen?: Salesman[];
  onOpenCustomerDialog?: (fieldName?: string) => void;
  onOpenSalesmanDialog?: (fieldName?: string) => void;
}

// Currency options
const CURRENCIES = [
  { value: 'SGD', label: 'SGD' },
  { value: 'USD', label: 'USD' },
  { value: 'EUR', label: 'EUR' },
  { value: 'GBP', label: 'GBP' },
  { value: 'MYR', label: 'MYR' },
  { value: 'RP', label: 'RP' },
  { value: 'IDR', label: 'IDR' },
];

// Yes/No options
const YES_NO = [
  { value: 'Y', label: 'Y' },
  { value: 'N', label: 'N' },
];

// Compact input styles - no borders, fields touch each other
const inputSx = {
  '& .MuiInputBase-root': {
    height: 26,
    fontSize: '0.75rem',
    backgroundColor: 'white',
    borderRadius: 0,
  },
  '& .MuiOutlinedInput-notchedOutline': {
    border: 'none',
  },
};

const selectSx = {
  height: 26,
  fontSize: '0.75rem',
  backgroundColor: 'white',
  borderRadius: 0,
  '& .MuiSelect-select': {
    py: 0.25,
  },
  '& .MuiOutlinedInput-notchedOutline': {
    border: 'none',
  },
};

export default function DynamicFormFields({
  fields,
  formData,
  setFormData,
  customers = [],
  projects = [],
  deliveryOrders = [],
  siteOffices = [],
  salesmen = [],
  onOpenCustomerDialog,
  onOpenSalesmanDialog,
}: DynamicFormFieldsProps) {

  // Helper to get nested value from object path
  const getNestedValue = (obj: any, path: string) => {
    return path.split('.').reduce((acc, part) => acc && acc[part], obj);
  };

  // Helper to set nested value in object
  const setNestedValue = (obj: any, path: string, value: any) => {
    const parts = path.split('.');
    const last = parts.pop()!;
    const target = parts.reduce((acc, part) => {
      if (!acc[part]) acc[part] = {};
      return acc[part];
    }, obj);
    target[last] = value;
    return { ...obj };
  };

  // Separate fields into left column and right column (summary fields)
  const leftFields = fields.filter(f => !f.fieldName.includes('gross') && !f.fieldName.includes('disc') &&
    !f.fieldName.includes('subTotal') && !f.fieldName.includes('nett') && !f.fieldName.includes('gst') &&
    !f.fieldName.includes('rate') && !f.fieldName.includes('absorbTax') && !f.fieldName.includes('taxApplicable'));

  const rightFields = fields.filter(f => f.fieldName.includes('gross') || f.fieldName.includes('disc') ||
    f.fieldName.includes('subTotal') || f.fieldName.includes('nett') || f.fieldName.includes('gst') ||
    f.fieldName.includes('rate') || f.fieldName.includes('absorbTax') || f.fieldName.includes('taxApplicable') ||
    f.fieldName.includes('currency'));

  // Render input based on field type
  const renderInput = (field: FieldDefinition) => {
    const value = getNestedValue(formData, field.fieldName) ?? field.defaultValue ?? '';

    switch (field.fieldType) {
      case 'customer':
        return (
          <CustomerCodeField
            customers={customers}
            formData={formData}
            setFormData={setFormData}
            onOpenDialog={onOpenCustomerDialog}
            inputSx={inputSx}
          />
        );

      case 'supplier':
        // Supplier uses the same customer data but stores just the code in a specific field
        return (
          <CustomerCodeField
            customers={customers}
            formData={formData}
            setFormData={setFormData}
            onOpenDialog={onOpenCustomerDialog}
            inputSx={inputSx}
            fieldName={field.fieldName}
            storeMode="code"
          />
        );

      case 'salesman':
        return (
          <SalesmanCodeField
            salesmen={salesmen}
            formData={formData}
            setFormData={setFormData}
            onOpenDialog={onOpenSalesmanDialog}
            inputSx={inputSx}
            fieldName={field.fieldName}
          />
        );

      case 'select':
        let options: any[] = [];
        if (field.dataSource === 'deliveryOrders') {
          options = deliveryOrders;
        } else if (field.dataSource === 'projects') {
          options = projects;
        } else if (field.dataSource === 'currencies') {
          options = CURRENCIES;
        } else if (field.dataSource === 'yesNo') {
          options = YES_NO;
        }

        return (
          <FormControl size="small" sx={{ minWidth: field.dataSource === 'yesNo' ? 50 : 150 }}>
            <Select
              value={value}
              onChange={(e) => setFormData(setNestedValue(formData, field.fieldName, e.target.value))}
              sx={selectSx}
              displayEmpty
            >
              {field.dataSource === 'currencies' || field.dataSource === 'yesNo' ? (
                options.map((opt) => (
                  <MenuItem key={opt.value} value={opt.value} sx={{ fontSize: '0.8rem' }}>
                    {opt.label}
                  </MenuItem>
                ))
              ) : field.dataSource === 'deliveryOrders' ? (
                options.map((order) => (
                  <MenuItem key={order.id} value={order.doNo} sx={{ fontSize: '0.8rem' }}>
                    {order.doNo}
                  </MenuItem>
                ))
              ) : (
                options.map((option) => (
                  <MenuItem key={option.id} value={option.id} sx={{ fontSize: '0.8rem' }}>
                    {option.name}
                  </MenuItem>
                ))
              )}
            </Select>
          </FormControl>
        );

      case 'textarea':
        return (
          <TextField
            value={value}
            onChange={(e) => setFormData(setNestedValue(formData, field.fieldName, e.target.value))}
            size="small"
            multiline
            rows={2}
            sx={{
              flex: 1,
              minWidth: 200,
              '& .MuiInputBase-root': {
                fontSize: '0.8rem',
                backgroundColor: 'white',
              },
            }}
          />
        );

      case 'date':
        return (
          <TextField
            type="date"
            value={value ? new Date(value).toISOString().split('T')[0] : ''}
            onChange={(e) => setFormData(setNestedValue(formData, field.fieldName, e.target.value))}
            size="small"
            sx={{ ...inputSx, minWidth: 130 }}
          />
        );

      case 'number':
        return (
          <TextField
            type="number"
            value={value}
            onChange={(e) => setFormData(setNestedValue(formData, field.fieldName, parseFloat(e.target.value) || 0))}
            size="small"
            sx={{ ...inputSx, minWidth: 100 }}
          />
        );

      case 'text':
      default:
        return (
          <TextField
            value={value}
            onChange={(e) => setFormData(setNestedValue(formData, field.fieldName, e.target.value))}
            size="small"
            sx={{ ...inputSx, flex: 1, minWidth: 150 }}
          />
        );
    }
  };

  // Render a single row with label on left
  const renderRow = (field: FieldDefinition) => (
    <Box
      key={field.fieldName}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        borderBottom: '1px solid',
        borderColor: 'grey.200',
      }}
    >
      <Typography
        sx={{
          width: 100,
          flexShrink: 0,
          fontSize: '0.75rem',
          fontWeight: 500,
          color: 'text.primary',
          py: 0.5,
          px: 1,
          bgcolor: 'grey.100',
          borderRight: '1px solid',
          borderColor: 'grey.200',
        }}
      >
        {field.displayLabel}
      </Typography>
      <Box sx={{ flex: 1, display: 'flex', alignItems: 'center' }}>
        {renderInput(field)}
      </Box>
    </Box>
  );

  // Common row style for right column
  const rightRowSx = {
    display: 'flex',
    alignItems: 'center',
    borderBottom: '1px solid',
    borderColor: 'grey.200',
    '&:last-child': {
      borderBottom: 'none',
    },
  };

  const rightLabelSx = {
    width: 70,
    flexShrink: 0,
    fontSize: '0.75rem',
    fontWeight: 500,
    textAlign: 'right' as const,
    py: 0.5,
    px: 1,
    bgcolor: 'grey.100',
  };

  // Render right column row (summary fields)
  const renderRightRow = (field: FieldDefinition) => {
    const value = getNestedValue(formData, field.fieldName) ?? field.defaultValue ?? '';
    const currency = getNestedValue(formData, 'documentInfo.currency') || 'USD';

    // Special handling for Tax row (Tax Y/N + Absorb Tax Y/N)
    if (field.fieldName === 'documentInfo.taxApplicable') {
      const absorbTaxValue = getNestedValue(formData, 'documentInfo.absorbTax') ?? 'N';
      return (
        <Box key={field.fieldName} sx={rightRowSx}>
          <Typography sx={rightLabelSx}>Tax</Typography>
          <FormControl size="small" sx={{ width: 40 }}>
            <Select value={value} onChange={(e) => setFormData(setNestedValue(formData, field.fieldName, e.target.value))} sx={selectSx}>
              <MenuItem value="Y" sx={{ fontSize: '0.75rem' }}>Y</MenuItem>
              <MenuItem value="N" sx={{ fontSize: '0.75rem' }}>N</MenuItem>
            </Select>
          </FormControl>
          <Typography sx={{ fontSize: '0.75rem', fontWeight: 500, px: 0.5 }}>Absorb Tax</Typography>
          <FormControl size="small" sx={{ width: 40 }}>
            <Select value={absorbTaxValue} onChange={(e) => setFormData(setNestedValue(formData, 'documentInfo.absorbTax', e.target.value))} sx={selectSx}>
              <MenuItem value="Y" sx={{ fontSize: '0.75rem' }}>Y</MenuItem>
              <MenuItem value="N" sx={{ fontSize: '0.75rem' }}>N</MenuItem>
            </Select>
          </FormControl>
        </Box>
      );
    }

    // Skip absorbTax as it's rendered with taxApplicable
    if (field.fieldName === 'documentInfo.absorbTax') return null;

    // Skip currency in right column (it's part of Rate row display)
    if (field.fieldName === 'documentInfo.currency') return null;

    // Disc % row with input and calculated amount
    if (field.fieldName === 'documentInfo.discountPercent') {
      const discAmount = getNestedValue(formData, 'documentInfo.discountAmount') ?? 0;
      return (
        <Box key={field.fieldName} sx={rightRowSx}>
          <Typography sx={rightLabelSx}>Disc %</Typography>
          <TextField
            type="number"
            value={value}
            onChange={(e) => setFormData(setNestedValue(formData, field.fieldName, parseFloat(e.target.value) || 0))}
            size="small"
            sx={{ ...inputSx, width: 50 }}
          />
          <Typography sx={{ flex: 1, textAlign: 'right', fontSize: '0.75rem', px: 1 }}>
            {Number(discAmount).toFixed(2)}
          </Typography>
          <Typography sx={{ fontSize: '0.75rem', color: 'text.secondary', pr: 1 }}>{currency}</Typography>
        </Box>
      );
    }

    // Skip discountAmount as it's rendered with discountPercent
    if (field.fieldName === 'documentInfo.discountAmount') return null;

    // GST row with percentage and amount
    if (field.fieldName === 'documentInfo.gstPercent') {
      const gstAmount = getNestedValue(formData, 'documentInfo.gstAmount') ?? 0;
      return (
        <Box key={field.fieldName} sx={rightRowSx}>
          <Typography sx={rightLabelSx}>GST</Typography>
          <TextField
            type="number"
            value={value}
            onChange={(e) => setFormData(setNestedValue(formData, field.fieldName, parseFloat(e.target.value) || 0))}
            size="small"
            sx={{ ...inputSx, width: 50 }}
          />
          <Typography sx={{ flex: 1, textAlign: 'right', fontSize: '0.75rem', px: 1 }}>
            {Number(gstAmount).toFixed(2)}
          </Typography>
          <Typography sx={{ fontSize: '0.75rem', color: 'text.secondary', pr: 1 }}>{currency}</Typography>
        </Box>
      );
    }

    // Skip gstAmount as it's rendered with gstPercent
    if (field.fieldName === 'documentInfo.gstAmount') return null;

    // Regular summary row (Rate, Gross Total, Sub-total, Nett Total)
    return (
      <Box key={field.fieldName} sx={rightRowSx}>
        <Typography sx={rightLabelSx}>{field.displayLabel}</Typography>
        {field.fieldName === 'documentInfo.rate' ? (
          <TextField
            type="number"
            value={value}
            onChange={(e) => setFormData(setNestedValue(formData, field.fieldName, parseFloat(e.target.value) || 0))}
            size="small"
            sx={{ ...inputSx, width: 80 }}
          />
        ) : (
          <Typography sx={{ flex: 1, textAlign: 'right', fontSize: '0.75rem', px: 1 }}>
            {Number(value).toFixed(2)}
          </Typography>
        )}
        <Typography sx={{ fontSize: '0.75rem', color: 'text.secondary', pr: 1 }}>{currency}</Typography>
      </Box>
    );
  };

  return (
    <Box sx={{ display: 'flex', gap: 3 }}>
      {/* Left Column - Form Fields */}
      <Box
        sx={{
          flex: 1,
          border: '1px solid',
          borderColor: 'grey.300',
          borderRadius: 0,
          overflow: 'hidden',
          '& > :last-child': {
            borderBottom: 'none',
          },
        }}
      >
        {leftFields.map((field) => renderRow(field))}
      </Box>

      {/* Right Column - Summary/Totals */}
      <Box
        sx={{
          minWidth: 260,
          border: '1px solid',
          borderColor: 'grey.300',
          borderRadius: 0,
          overflow: 'hidden',
        }}
      >
        {rightFields.map((field) => renderRightRow(field))}
      </Box>
    </Box>
  );
}
