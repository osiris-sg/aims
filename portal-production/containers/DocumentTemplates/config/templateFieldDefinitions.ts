/**
 * Template Field Definitions
 *
 * This file defines the required form fields for each document template variant.
 * These fields are used to dynamically generate forms in TabbedDocumentCreator.
 *
 * Note: Company data fields are NOT included here as they come from organization settings
 * and should not be editable in the document form.
 */

export interface FieldDefinition {
  fieldName: string; // Technical field name (path in data object) - how it appears in the form
  displayLabel: string; // User-facing label
  fieldType: "text" | "number" | "date" | "select" | "autocomplete" | "textarea" | "table" | "customer";
  required: boolean;
  gridSize?: 6 | 12; // Grid column size (6 = half width, 12 = full width)
  dataSource?: string; // For select/autocomplete: 'customers', 'projects', 'deliveryOrders', etc.
  placeholder?: string;
  defaultValue?: any;
  filterBy?: string; // For dependent dropdowns: filter by this field (e.g., 'customerId')
  storagePath?: string; // Where this field is stored in the database (if different from fieldName)
}

export interface TabDefinition {
  tabId: string; // Unique identifier for the tab
  tabLabel: string; // Display label for the tab
  fields: FieldDefinition[];
}

export interface TemplateFieldConfig {
  tabs: TabDefinition[];
}

export const TEMPLATE_FIELD_DEFINITIONS: Record<string, TemplateFieldConfig> = {
  // TI - Tax Invoice (Original Design)
  // Also handle INVOICE type (legacy naming)
  TI: {
    tabs: [
      {
        tabId: "general",
        tabLabel: "GENERAL",
        fields: [
          // Customer Section
          {
            fieldName: "customer",
            displayLabel: "Customer",
            fieldType: "customer",
            required: true,
            gridSize: 12,
            dataSource: "customers",
          },
          // Document Information
          {
            fieldName: "documentInfo.date",
            displayLabel: "Invoice Date",
            fieldType: "date",
            required: true,
            gridSize: 6,
          },
          {
            fieldName: "documentInfo.documentNumber",
            displayLabel: "Invoice Number",
            fieldType: "text",
            required: true,
            gridSize: 6,
          },
          {
            fieldName: "documentInfo.referenceNo",
            displayLabel: "Reference No",
            fieldType: "text",
            required: false,
            gridSize: 6,
          },
          {
            fieldName: "documentInfo.doNo",
            displayLabel: "DO No",
            fieldType: "select",
            required: false,
            gridSize: 6,
            dataSource: "deliveryOrders",
            filterBy: "customerId",
          },
        ],
      },
      {
        tabId: "details",
        tabLabel: "DETAILS",
        fields: [
          // Additional reference fields
          {
            fieldName: "documentInfo.qinRef",
            displayLabel: "Quotation Reference",
            fieldType: "text",
            required: false,
            gridSize: 6,
          },
          {
            fieldName: "documentInfo.qinDate",
            displayLabel: "Quotation Date",
            fieldType: "date",
            required: false,
            gridSize: 6,
          },
          {
            fieldName: "documentInfo.woNo",
            displayLabel: "Work Order No",
            fieldType: "text",
            required: false,
            gridSize: 6,
          },
          {
            fieldName: "documentInfo.location",
            displayLabel: "Location",
            fieldType: "text",
            required: false,
            gridSize: 6,
          },
          {
            fieldName: "documentInfo.projectDept",
            displayLabel: "Project/Department",
            fieldType: "text",
            required: false,
            gridSize: 6,
          },
          // Delivery Address
          {
            fieldName: "deliveryAddress.attention",
            displayLabel: "Attention",
            fieldType: "text",
            required: false,
            gridSize: 6,
          },
          // Payment terms
          {
            fieldName: "paymentTerms",
            displayLabel: "Payment Terms",
            fieldType: "text",
            required: false,
            gridSize: 6,
            placeholder: "e.g., 30 days",
          },
          {
            fieldName: "dueDate",
            displayLabel: "Due Date",
            fieldType: "date",
            required: false,
            gridSize: 6,
          },
        ],
      },
    ],
  },

  // TI2 - Tax Invoice (Alternate Design with more fields)
  TI2: {
    tabs: [
      {
        tabId: "general",
        tabLabel: "GENERAL",
        fields: [
          // Customer Section
          {
            fieldName: "customer",
            displayLabel: "Customer",
            fieldType: "customer",
            required: true,
            gridSize: 12,
            dataSource: "customers",
          },
          // Document Information - Right section fields
          {
            fieldName: "documentInfo.date",
            displayLabel: "Date",
            fieldType: "date",
            required: true,
            gridSize: 6,
          },
          {
            fieldName: "documentInfo.documentNumber",
            displayLabel: "Invoice No.",
            fieldType: "text",
            required: true,
            gridSize: 6,
          },
          {
            fieldName: "documentInfo.doNo",
            displayLabel: "DO No",
            fieldType: "select",
            required: false,
            gridSize: 6,
            dataSource: "deliveryOrders",
            filterBy: "customerId",
          },
          {
            fieldName: "documentInfo.poNo",
            displayLabel: "P/O No",
            fieldType: "text",
            required: false,
            gridSize: 6,
          },
          {
            fieldName: "documentInfo.soNo",
            displayLabel: "S/O No",
            fieldType: "text",
            required: false,
            gridSize: 6,
          },
          {
            fieldName: "documentInfo.salesPerson",
            displayLabel: "Salesman",
            fieldType: "text",
            required: false,
            gridSize: 6,
            defaultValue: "",
            storagePath: "salesPerson", // Stored flat in database
          },
          {
            fieldName: "documentInfo.page",
            displayLabel: "Page",
            fieldType: "text",
            required: false,
            gridSize: 6,
            defaultValue: "1",
          },
          {
            fieldName: "documentInfo.paymentTerms",
            displayLabel: "Terms",
            fieldType: "text",
            required: false,
            gridSize: 6,
            defaultValue: "0 DAYS",
          },
          {
            fieldName: "documentInfo.currency",
            displayLabel: "Currency",
            fieldType: "select",
            required: false,
            gridSize: 6,
            defaultValue: "USD",
            dataSource: "currencies",
          },
        ],
      },
      {
        tabId: "details",
        tabLabel: "DETAILS",
        fields: [
          // Additional reference fields
          {
            fieldName: "documentInfo.qinRef",
            displayLabel: "Quotation Reference",
            fieldType: "text",
            required: false,
            gridSize: 6,
          },
          {
            fieldName: "documentInfo.qinDate",
            displayLabel: "Quotation Date",
            fieldType: "date",
            required: false,
            gridSize: 6,
          },
          {
            fieldName: "documentInfo.woNo",
            displayLabel: "Work Order No",
            fieldType: "text",
            required: false,
            gridSize: 6,
          },
          {
            fieldName: "documentInfo.location",
            displayLabel: "Location",
            fieldType: "text",
            required: false,
            gridSize: 6,
          },
          {
            fieldName: "documentInfo.projectDept",
            displayLabel: "Project/Department",
            fieldType: "text",
            required: false,
            gridSize: 6,
          },
        ],
      },
      // Could add more tabs here like 'payment', 'shipping', etc.
      // {
      //   tabId: 'payment',
      //   tabLabel: 'PAYMENT INFO',
      //   fields: [...]
      // }
    ],
  },

  // Aliases for legacy document types
  INVOICE: { tabs: [] as TabDefinition[] }, // Will be mapped to TI in getTemplateFields
};

// Map INVOICE to TI fields
TEMPLATE_FIELD_DEFINITIONS.INVOICE = TEMPLATE_FIELD_DEFINITIONS.TI;

/**
 * Get field definitions for a specific template variant
 */
export function getTemplateFields(templateVariant: string): TemplateFieldConfig | null {
  // Handle legacy type names
  const variantMap: Record<string, string> = {
    INVOICE: "TI",
  };

  const mappedVariant = variantMap[templateVariant] || templateVariant;
  return TEMPLATE_FIELD_DEFINITIONS[mappedVariant] || null;
}

/**
 * Get all available template variants
 */
export function getAvailableTemplateVariants(): string[] {
  return Object.keys(TEMPLATE_FIELD_DEFINITIONS);
}
