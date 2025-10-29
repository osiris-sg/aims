/**
 * Dynamic Form Fields Component
 *
 * Renders form fields dynamically based on template field definitions.
 * Supports various field types: text, number, date, select, autocomplete, textarea, customer
 * Can render a single tab's fields or be used to render individual field arrays
 */

import React from 'react';
import {
  Grid,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Autocomplete,
} from '@mui/material';
import { FieldDefinition, TabDefinition } from '../config/templateFieldDefinitions';

interface DynamicFormFieldsProps {
  fields: FieldDefinition[];
  formData: any;
  setFormData: (data: any) => void;
  customers?: any[];
  projects?: any[];
  deliveryOrders?: any[];
  siteOffices?: any[];
}

// Currency options
const CURRENCIES = [
  { value: 'SGD', label: 'SGD - Singapore Dollar' },
  { value: 'USD', label: 'USD - US Dollar' },
  { value: 'EUR', label: 'EUR - Euro' },
  { value: 'GBP', label: 'GBP - British Pound' },
  { value: 'MYR', label: 'MYR - Malaysian Ringgit' },
];

export default function DynamicFormFields({
  fields,
  formData,
  setFormData,
  customers = [],
  projects = [],
  deliveryOrders = [],
  siteOffices = [],
}: DynamicFormFieldsProps) {

  // Helper to get nested value from object path (e.g., "documentInfo.date")
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

  // Render individual field based on type
  const renderField = (field: FieldDefinition) => {
    const value = getNestedValue(formData, field.fieldName) || field.defaultValue || '';

    switch (field.fieldType) {
      case 'customer':
        return (
          <Autocomplete
            options={customers}
            getOptionLabel={(option) => option.name}
            value={customers.find((c) => c.id === formData.customer?.id) || null}
            onChange={(_, newValue) => {
              setFormData({
                ...formData,
                customer: newValue || { id: '', name: '', address: '', phone: '', email: '' },
              });
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                label={field.displayLabel}
                required={field.required}
                size="small"
                placeholder={field.placeholder}
              />
            )}
          />
        );

      case 'select':
        // Handle different data sources
        let options: any[] = [];
        let isDisabled = false;

        if (field.dataSource === 'deliveryOrders') {
          options = deliveryOrders;
          isDisabled = !formData.customer?.id || deliveryOrders.length === 0;
        } else if (field.dataSource === 'projects') {
          options = projects.filter((p) => !formData.customer?.id || p.customerId === formData.customer.id);
          isDisabled = !formData.customer?.id;
        } else if (field.dataSource === 'currencies') {
          options = CURRENCIES;
        }

        return (
          <FormControl fullWidth size="small" disabled={isDisabled}>
            <InputLabel>{field.displayLabel}</InputLabel>
            <Select
              value={value}
              onChange={(e) => setFormData(setNestedValue(formData, field.fieldName, e.target.value))}
              label={field.displayLabel}
            >
              {options.length === 0 && field.dataSource === 'deliveryOrders' ? (
                <MenuItem value="" disabled>
                  {formData.customer?.id ? 'No delivery orders available' : 'Select customer first'}
                </MenuItem>
              ) : field.dataSource === 'deliveryOrders' ? (
                options.map((order) => (
                  <MenuItem key={order.id} value={order.doNo}>
                    {order.doNo}
                  </MenuItem>
                ))
              ) : field.dataSource === 'currencies' ? (
                options.map((curr) => (
                  <MenuItem key={curr.value} value={curr.value}>
                    {curr.label}
                  </MenuItem>
                ))
              ) : (
                options.map((option) => (
                  <MenuItem key={option.id} value={option.id}>
                    {option.name}
                  </MenuItem>
                ))
              )}
            </Select>
          </FormControl>
        );

      case 'autocomplete':
        let autoOptions: any[] = [];
        let autoDisabled = false;

        if (field.dataSource === 'projects') {
          autoOptions = projects.filter((p) => !formData.customer?.id || p.customerId === formData.customer.id);
          autoDisabled = !formData.customer?.id;
        } else if (field.dataSource === 'siteOffices') {
          autoOptions = siteOffices;
        }

        return (
          <Autocomplete
            options={autoOptions}
            getOptionLabel={(option) => option.name}
            value={autoOptions.find((o) => o.id === value) || null}
            onChange={(_, newValue) => {
              setFormData(setNestedValue(formData, field.fieldName, newValue?.id || ''));
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                label={field.displayLabel}
                required={field.required}
                size="small"
                placeholder={field.placeholder}
              />
            )}
            disabled={autoDisabled}
          />
        );

      case 'textarea':
        return (
          <TextField
            fullWidth
            label={field.displayLabel}
            value={value}
            onChange={(e) => setFormData(setNestedValue(formData, field.fieldName, e.target.value))}
            required={field.required}
            size="small"
            multiline
            rows={3}
            placeholder={field.placeholder}
          />
        );

      case 'date':
        return (
          <TextField
            fullWidth
            label={field.displayLabel}
            type="date"
            value={value ? new Date(value).toISOString().split('T')[0] : ''}
            onChange={(e) => setFormData(setNestedValue(formData, field.fieldName, e.target.value))}
            required={field.required}
            size="small"
            InputLabelProps={{ shrink: true }}
          />
        );

      case 'number':
        return (
          <TextField
            fullWidth
            label={field.displayLabel}
            type="number"
            value={value}
            onChange={(e) => setFormData(setNestedValue(formData, field.fieldName, parseFloat(e.target.value) || 0))}
            required={field.required}
            size="small"
            placeholder={field.placeholder}
          />
        );

      case 'text':
      default:
        return (
          <TextField
            fullWidth
            label={field.displayLabel}
            value={value}
            onChange={(e) => setFormData(setNestedValue(formData, field.fieldName, e.target.value))}
            required={field.required}
            size="small"
            placeholder={field.placeholder}
          />
        );
    }
  };

  return (
    <Grid container spacing={0.5}>
      {fields.map((field) => (
        <Grid item xs={12} md={field.gridSize || 6} key={field.fieldName}>
          {renderField(field)}
        </Grid>
      ))}
    </Grid>
  );
}
