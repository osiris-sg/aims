import React from "react";
import { Control, Controller } from "react-hook-form";
import {
  TextField,
  FormControl,
  FormControlLabel,
  FormLabel,
  RadioGroup,
  Radio,
  Checkbox,
  Select,
  MenuItem,
  InputLabel,
  FormHelperText,
  Box,
  Chip,
  OutlinedInput,
  Button,
  Typography,
} from "@mui/material";
import { DatePicker } from "@mui/x-date-pickers/DatePicker";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import dayjs from "dayjs";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";

interface CustomFieldConfig {
  id: string;
  fieldName: string;
  displayLabel: string;
  fieldType: string;
  required?: boolean;
  options?: Array<{ value: string; label: string }>;
  defaultValue?: string;
  validation?: any;
  showInForm?: boolean;
  groupName?: string;
}

interface DynamicFieldProps {
  field: CustomFieldConfig;
  control: Control<any>;
  errors?: any;
}

export const DynamicField: React.FC<DynamicFieldProps> = ({ field, control, errors }) => {
  if (!field.showInForm) {
    return null;
  }

  const getValidationRules = () => {
    const rules: any = {
      required: field.required ? `${field.displayLabel} is required` : false,
    };

    if (field.validation) {
      if (field.validation.min !== undefined) {
        rules.min = {
          value: field.validation.min,
          message: `${field.displayLabel} must be at least ${field.validation.min}`,
        };
      }
      if (field.validation.max !== undefined) {
        rules.max = {
          value: field.validation.max,
          message: `${field.displayLabel} must be at most ${field.validation.max}`,
        };
      }
      if (field.validation.pattern) {
        rules.pattern = {
          value: new RegExp(field.validation.pattern),
          message: `${field.displayLabel} format is invalid`,
        };
      }
    }

    return rules;
  };

  const renderField = (fieldValue: any, onChange: (value: any) => void) => {
    switch (field.fieldType) {
      case "text":
        return (
          <TextField
            fullWidth
            label={field.displayLabel}
            value={fieldValue || ""}
            onChange={(e) => onChange(e.target.value)}
            error={!!errors?.[field.fieldName]}
            helperText={errors?.[field.fieldName]?.message}
            required={field.required}
          />
        );

      case "number":
        return (
          <TextField
            fullWidth
            type="number"
            label={field.displayLabel}
            value={fieldValue || ""}
            onChange={(e) => onChange(Number(e.target.value))}
            error={!!errors?.[field.fieldName]}
            helperText={errors?.[field.fieldName]?.message}
            required={field.required}
          />
        );

      case "email":
        return (
          <TextField
            fullWidth
            type="email"
            label={field.displayLabel}
            value={fieldValue || ""}
            onChange={(e) => onChange(e.target.value)}
            error={!!errors?.[field.fieldName]}
            helperText={errors?.[field.fieldName]?.message}
            required={field.required}
          />
        );

      case "phone":
        return (
          <TextField
            fullWidth
            type="tel"
            label={field.displayLabel}
            value={fieldValue || ""}
            onChange={(e) => onChange(e.target.value)}
            error={!!errors?.[field.fieldName]}
            helperText={errors?.[field.fieldName]?.message}
            required={field.required}
          />
        );

      case "url":
        return (
          <TextField
            fullWidth
            type="url"
            label={field.displayLabel}
            value={fieldValue || ""}
            onChange={(e) => onChange(e.target.value)}
            error={!!errors?.[field.fieldName]}
            helperText={errors?.[field.fieldName]?.message}
            required={field.required}
          />
        );

      case "date":
        return (
          <LocalizationProvider dateAdapter={AdapterDayjs}>
            <DatePicker
              label={field.displayLabel}
              value={fieldValue ? dayjs(fieldValue) : null}
              onChange={(newValue) => onChange(newValue?.toISOString())}
              slotProps={{
                textField: {
                  fullWidth: true,
                  error: !!errors?.[field.fieldName],
                  helperText: errors?.[field.fieldName]?.message,
                  required: field.required,
                },
              }}
            />
          </LocalizationProvider>
        );

      case "boolean":
        return (
          <FormControlLabel
            control={
              <Checkbox
                checked={fieldValue || false}
                onChange={(e) => onChange(e.target.checked)}
              />
            }
            label={field.displayLabel}
          />
        );

      case "select":
        return (
          <FormControl fullWidth error={!!errors?.[field.fieldName]}>
            <InputLabel required={field.required}>{field.displayLabel}</InputLabel>
            <Select
              value={fieldValue || ""}
              label={field.displayLabel}
              onChange={(e) => onChange(e.target.value)}
            >
              {field.options?.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </Select>
            {errors?.[field.fieldName] && (
              <FormHelperText>{errors[field.fieldName].message}</FormHelperText>
            )}
          </FormControl>
        );

      case "multiselect":
        return (
          <FormControl fullWidth error={!!errors?.[field.fieldName]}>
            <InputLabel required={field.required}>{field.displayLabel}</InputLabel>
            <Select
              multiple
              value={fieldValue || []}
              onChange={(e) => onChange(e.target.value)}
              input={<OutlinedInput label={field.displayLabel} />}
              renderValue={(selected: string[]) => (
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                  {selected.map((value) => {
                    const option = field.options?.find((opt) => opt.value === value);
                    return <Chip key={value} label={option?.label || value} />;
                  })}
                </Box>
              )}
            >
              {field.options?.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </Select>
            {errors?.[field.fieldName] && (
              <FormHelperText>{errors[field.fieldName].message}</FormHelperText>
            )}
          </FormControl>
        );

      case "radio":
        return (
          <FormControl error={!!errors?.[field.fieldName]}>
            <FormLabel required={field.required}>{field.displayLabel}</FormLabel>
            <RadioGroup
              value={fieldValue || ""}
              onChange={(e) => onChange(e.target.value)}
            >
              {field.options?.map((option) => (
                <FormControlLabel
                  key={option.value}
                  value={option.value}
                  control={<Radio />}
                  label={option.label}
                />
              ))}
            </RadioGroup>
            {errors?.[field.fieldName] && (
              <FormHelperText>{errors[field.fieldName].message}</FormHelperText>
            )}
          </FormControl>
        );

      case "richtext":
        return (
          <TextField
            fullWidth
            multiline
            rows={4}
            label={field.displayLabel}
            value={fieldValue || ""}
            onChange={(e) => onChange(e.target.value)}
            error={!!errors?.[field.fieldName]}
            helperText={errors?.[field.fieldName]?.message}
            required={field.required}
          />
        );

      case "file":
        return (
          <Box>
            <input
              accept="*/*"
              style={{ display: "none" }}
              id={`file-upload-${field.fieldName}`}
              type="file"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  onChange(file);
                }
              }}
            />
            <label htmlFor={`file-upload-${field.fieldName}`}>
              <Button
                variant="contained"
                component="span"
                startIcon={<CloudUploadIcon />}
              >
                Upload {field.displayLabel}
              </Button>
            </label>
            {fieldValue && (
              <Box sx={{ mt: 1 }}>
                <Typography variant="body2">
                  Selected: {fieldValue.name || fieldValue}
                </Typography>
              </Box>
            )}
            {errors?.[field.fieldName] && (
              <FormHelperText error>{errors[field.fieldName].message}</FormHelperText>
            )}
          </Box>
        );

      default:
        return (
          <TextField
            fullWidth
            label={field.displayLabel}
            value={fieldValue || ""}
            onChange={(e) => onChange(e.target.value)}
            error={!!errors?.[field.fieldName]}
            helperText={errors?.[field.fieldName]?.message}
            required={field.required}
          />
        );
    }
  };

  return (
    <Controller
      name={`customFields.${field.fieldName}`}
      control={control}
      rules={getValidationRules()}
      defaultValue={field.defaultValue || ""}
      render={({ field: { value, onChange } }) => (
        <Box sx={{ mb: 2 }}>
          {renderField(value, onChange)}
        </Box>
      )}
    />
  );
};

// Export for use outside of form context
export const DynamicFieldDisplay: React.FC<{
  field: CustomFieldConfig;
  value: any;
}> = ({ field, value }) => {
  const formatValue = () => {
    switch (field.fieldType) {
      case "boolean":
        return value ? "Yes" : "No";

      case "date":
        return value ? dayjs(value).format("MM/DD/YYYY") : "-";

      case "select":
      case "radio":
        const option = field.options?.find((opt) => opt.value === value);
        return option?.label || value || "-";

      case "multiselect":
        if (!value || !Array.isArray(value)) return "-";
        return value
          .map((v) => {
            const option = field.options?.find((opt) => opt.value === v);
            return option?.label || v;
          })
          .join(", ");

      case "file":
        return value ? "File uploaded" : "-";

      default:
        return value || "-";
    }
  };

  return (
    <Box>
      <Typography variant="caption" color="text.secondary">
        {field.displayLabel}
      </Typography>
      <Typography variant="body1">{formatValue()}</Typography>
    </Box>
  );
};