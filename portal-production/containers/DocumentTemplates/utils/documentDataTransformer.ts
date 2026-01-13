/**
 * Document Data Transformer
 *
 * Handles dynamic transformation between nested form structure and flat database structure
 * based on template field definitions.
 */

import { TemplateFieldConfig, FieldDefinition } from '../config/templateFieldDefinitions';

/**
 * Get nested value from object using dot notation
 * Example: getNestedValue({a: {b: 'value'}}, 'a.b') => 'value'
 */
function getNestedValue(obj: any, path: string): any {
  return path.split('.').reduce((current, key) => current?.[key], obj);
}

/**
 * Set nested value in object using dot notation
 * Example: setNestedValue({}, 'a.b', 'value') => {a: {b: 'value'}}
 */
function setNestedValue(obj: any, path: string, value: any): void {
  const keys = path.split('.');
  const lastKey = keys.pop()!;
  const target = keys.reduce((current, key) => {
    if (current[key] === undefined) {
      current[key] = {};
    }
    return current[key];
  }, obj);
  target[lastKey] = value;
}

/**
 * Transform nested form data to flat structure for backend storage
 * Dynamically handles all fields defined in the template
 */
export function transformFormDataForBackend(
  formData: any,
  fieldConfig: TemplateFieldConfig | null,
  organization?: any
): any {
  const result: any = {};

  // Always include company data from organization
  result.company = {
    name: formData.company?.name || organization?.name || '',
    address: formData.company?.address || organization?.address || '',
    phoneNumber: formData.company?.phoneNumber || organization?.phoneNumber || '',
  };

  // Handle customer specially (store both ID and name for display purposes)
  if (formData.customer?.id) {
    result.customerId = formData.customer.id;
    result.customerName = formData.customer.name || '';
    result.customerCode = formData.customer.customerCode || '';
  }

  // Handle items array - ensure we get the items from the formData
  console.log("transformFormDataForBackend - formData.items:", formData.items);
  result.items = formData.items || [];
  console.log("transformFormDataForBackend - result.items after copy:", result.items);

  // Process all fields from field definitions
  if (fieldConfig?.tabs) {
    fieldConfig.tabs.forEach(tab => {
      tab.fields.forEach(field => {
        // Skip special fields we've already handled
        if (field.fieldName === 'customer' || field.fieldName === 'items') {
          return;
        }

        // Get value from nested structure
        const value = getNestedValue(formData, field.fieldName);

        // Determine storage key - use storagePath if specified, otherwise derive from fieldName
        let storageKey: string;
        const fieldPath = field.fieldName.split('.');

        if (field.storagePath) {
          // Use explicit storage path
          storageKey = field.storagePath;
        } else {
          // Derive from field name (last part of path)
          storageKey = fieldPath[fieldPath.length - 1];

          // Default behavior for documentInfo fields
          if (field.fieldName.startsWith('documentInfo.')) {
            storageKey = fieldPath[1];
          }
        }

        if (field.fieldName.startsWith('deliveryAddress.')) {
          // Handle delivery address fields
          if (fieldPath[1] === 'attention') {
            if (!result.attention) result.attention = {};
            result.attention.name = value || '';
          } else if (fieldPath[1] === 'phone') {
            if (!result.attention) result.attention = {};
            result.attention.phoneNumber = value || '';
          } else if (fieldPath[1] === 'address') {
            result.deliveryTo = value || '';
          }
          return;
        }

        // Store the value
        if (value !== undefined) {
          result[storageKey] = value;
        }
      });
    });
  }

  // Add any additional flat fields that might exist in form
  const flatFields = [
    'note', 'dueDate', 'collectFrom', 'startDate', 'endDate',
    'signature', 'gstRegNo', 'paymentTerms',
    // Tracking fields
    'savedBy', 'savedAt', 'confirmedBy', 'confirmedAt', 'lastUsedBy', 'lastUsedAt',
    // PO confirmation fields (supplier D/O info)
    'supplierDONo', 'supplierDODate', 'exchangeRate', 'linkToAccounts',
    // Stock Adjustment confirmation fields
    'fromReferenceNo', 'toReferenceNo', 'deleteConfirmedReference',
    // DO confirmation fields
    'fromDONo', 'toDONo'
  ];

  flatFields.forEach(field => {
    if (formData[field] !== undefined) {
      result[field] = formData[field];
    }
  });

  // Handle GST registration number
  result.gstRegNo = formData.company?.gstRegNo || organization?.registrationNumber || '';

  return result;
}

/**
 * Transform flat database data to nested structure for form display
 * All data comes from the config field
 */
export function transformBackendDataForForm(
  backendData: any,
  fieldConfig: TemplateFieldConfig | null
): any {
  console.log('=== transformBackendDataForForm START ===');
  console.log('Backend data received:', backendData);
  console.log('Field config received:', fieldConfig);

  // Start with the backend data which is already from config
  const result: any = {
    ...backendData, // Keep all flat fields from config
    documentInfo: {},
    deliveryAddress: {}
  };

  // Process all fields from field definitions
  if (fieldConfig?.tabs) {
    console.log('Processing tabs:', fieldConfig.tabs.length);
    fieldConfig.tabs.forEach(tab => {
      console.log(`Processing tab: ${tab.tabId} with ${tab.fields.length} fields`);
      tab.fields.forEach(field => {
        // Skip special fields that are handled separately
        if (field.fieldName === 'customer' || field.fieldName === 'items') {
          return;
        }

        // Determine where to read the value from in config
        // Use storagePath if specified, otherwise use the fieldName
        const storageKey = field.storagePath || field.fieldName.split('.').pop() || field.fieldName;
        const value = backendData[storageKey];

        // Debug logging for all fields
        console.log(`Field: ${field.fieldName}`, {
          storagePath: field.storagePath,
          storageKey,
          value,
          defaultValue: field.defaultValue
        });

        // Set the value in the result using the field's display path
        if (value !== undefined) {
          setNestedValue(result, field.fieldName, value);
        } else if (field.defaultValue !== undefined) {
          setNestedValue(result, field.fieldName, field.defaultValue);
        }
      });
    });
  } else {
    console.log('No field config or tabs found!');
  }

  // Handle special mappings for delivery address
  if (backendData.attention) {
    result.deliveryAddress.attention = backendData.attention.name || '';
    result.deliveryAddress.phone = backendData.attention.phoneNumber || '';
  }
  if (backendData.deliveryTo) {
    result.deliveryAddress.address = backendData.deliveryTo;
  }

  // Ensure documentInfo has documentNumber from name field
  if (backendData.name) {
    result.documentInfo.documentNumber = backendData.name;
    result.name = backendData.name;
    result.documentNumber = backendData.name;
  }

  return result;
}

/**
 * Extract only the fields that should be saved to config
 * Removes UI-only fields and metadata
 */
export function extractConfigFields(formData: any, fieldConfig: TemplateFieldConfig | null): any {
  // Use the transform function to get clean config
  const config = transformFormDataForBackend(formData, fieldConfig);

  // Remove any UI-only fields that shouldn't be persisted
  const excludeFields = ['documentId', 'organizationId', 'type', 'status'];
  excludeFields.forEach(field => {
    delete config[field];
  });

  return config;
}