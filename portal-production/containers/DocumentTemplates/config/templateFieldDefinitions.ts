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
  fieldType: "text" | "number" | "date" | "select" | "autocomplete" | "textarea" | "table" | "customer" | "salesman" | "supplier";
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
  // Layout: Left column = form fields (labels on left), Right column = summary/totals
  TI2: {
    tabs: [
      {
        tabId: "general",
        tabLabel: "General",
        fields: [
          // === LEFT COLUMN FIELDS (in order) ===
          {
            fieldName: "documentInfo.documentNumber",
            displayLabel: "Invoice No.",
            fieldType: "text",
            required: true,
          },
          {
            fieldName: "documentInfo.date",
            displayLabel: "Date",
            fieldType: "date",
            required: true,
          },
          {
            fieldName: "customer",
            displayLabel: "Customer code",
            fieldType: "customer",
            required: true,
            dataSource: "customers",
          },
          {
            fieldName: "documentInfo.salesPerson",
            displayLabel: "Salesman code",
            fieldType: "salesman",
            required: false,
            defaultValue: "",
            dataSource: "salesmen",
          },
          {
            fieldName: "documentInfo.poNo",
            displayLabel: "P/O Number",
            fieldType: "text",
            required: false,
          },
          {
            fieldName: "documentInfo.doNo",
            displayLabel: "D/O Number",
            fieldType: "text",
            required: false,
          },
          {
            fieldName: "deliveryTo",
            displayLabel: "Deliver to",
            fieldType: "textarea",
            required: false,
          },
          {
            fieldName: "documentInfo.contact",
            displayLabel: "Contact",
            fieldType: "text",
            required: false,
          },
          {
            fieldName: "documentInfo.paymentTerms",
            displayLabel: "Terms",
            fieldType: "text",
            required: false,
            defaultValue: "0 DAYS",
          },
          // === RIGHT COLUMN FIELDS (summary/totals - in order) ===
          {
            fieldName: "documentInfo.rate",
            displayLabel: "Rate",
            fieldType: "number",
            required: false,
            defaultValue: 1.0,
          },
          {
            fieldName: "documentInfo.currency",
            displayLabel: "Currency",
            fieldType: "select",
            required: false,
            defaultValue: "USD",
            dataSource: "currencies",
          },
          {
            fieldName: "documentInfo.grossTotal",
            displayLabel: "Gross Total",
            fieldType: "number",
            required: false,
            defaultValue: 0,
          },
          {
            fieldName: "documentInfo.discountPercent",
            displayLabel: "Disc %",
            fieldType: "number",
            required: false,
            defaultValue: 0,
          },
          {
            fieldName: "documentInfo.discountAmount",
            displayLabel: "Discount Amount",
            fieldType: "number",
            required: false,
            defaultValue: 0,
          },
          {
            fieldName: "documentInfo.subTotal",
            displayLabel: "Sub-total",
            fieldType: "number",
            required: false,
            defaultValue: 0,
          },
          {
            fieldName: "documentInfo.taxApplicable",
            displayLabel: "Tax",
            fieldType: "select",
            required: false,
            defaultValue: "Y",
            dataSource: "yesNo",
          },
          {
            fieldName: "documentInfo.absorbTax",
            displayLabel: "Absorb Tax",
            fieldType: "select",
            required: false,
            defaultValue: "N",
            dataSource: "yesNo",
          },
          {
            fieldName: "documentInfo.gstPercent",
            displayLabel: "GST",
            fieldType: "number",
            required: false,
            defaultValue: 9.0,
          },
          {
            fieldName: "documentInfo.gstAmount",
            displayLabel: "GST Amount",
            fieldType: "number",
            required: false,
            defaultValue: 0,
          },
          {
            fieldName: "documentInfo.nettTotal",
            displayLabel: "Nett Total",
            fieldType: "number",
            required: false,
            defaultValue: 0,
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

  // DO - Delivery Order
  // Layout: Left column = form fields (labels on left), Right column = summary/totals
  DO: {
    tabs: [
      {
        tabId: "general",
        tabLabel: "General",
        fields: [
          // === LEFT COLUMN FIELDS (in order) ===
          {
            fieldName: "documentInfo.documentNumber",
            displayLabel: "Delivery Order No.",
            fieldType: "text",
            required: true,
          },
          {
            fieldName: "documentInfo.date",
            displayLabel: "Date",
            fieldType: "date",
            required: true,
          },
          {
            fieldName: "customer",
            displayLabel: "Customer code",
            fieldType: "customer",
            required: true,
            dataSource: "customers",
          },
          {
            fieldName: "documentInfo.salesPerson",
            displayLabel: "Salesman code",
            fieldType: "salesman",
            required: false,
            defaultValue: "",
            dataSource: "salesmen",
          },
          {
            fieldName: "documentInfo.poNo",
            displayLabel: "P/O Number",
            fieldType: "text",
            required: false,
          },
          {
            fieldName: "documentInfo.issueBy",
            displayLabel: "Issue By",
            fieldType: "text",
            required: false,
          },
          {
            fieldName: "deliveryTo",
            displayLabel: "Deliver to",
            fieldType: "textarea",
            required: false,
          },
          {
            fieldName: "documentInfo.contact",
            displayLabel: "Contact",
            fieldType: "text",
            required: false,
          },
          {
            fieldName: "documentInfo.paymentTerms",
            displayLabel: "Terms",
            fieldType: "text",
            required: false,
            defaultValue: "CASH",
          },
          // === RIGHT COLUMN FIELDS (summary/totals - in order) ===
          {
            fieldName: "documentInfo.rate",
            displayLabel: "Rate",
            fieldType: "number",
            required: false,
            defaultValue: 1.0,
          },
          {
            fieldName: "documentInfo.currency",
            displayLabel: "Currency",
            fieldType: "select",
            required: false,
            defaultValue: "RP",
            dataSource: "currencies",
          },
          {
            fieldName: "documentInfo.grossTotal",
            displayLabel: "Gross Total",
            fieldType: "number",
            required: false,
            defaultValue: 0,
          },
          {
            fieldName: "documentInfo.discountPercent",
            displayLabel: "Disc %",
            fieldType: "number",
            required: false,
            defaultValue: 0,
          },
          {
            fieldName: "documentInfo.discountAmount",
            displayLabel: "Discount Amount",
            fieldType: "number",
            required: false,
            defaultValue: 0,
          },
          {
            fieldName: "documentInfo.subTotal",
            displayLabel: "Sub-total",
            fieldType: "number",
            required: false,
            defaultValue: 0,
          },
          {
            fieldName: "documentInfo.taxApplicable",
            displayLabel: "Tax",
            fieldType: "select",
            required: false,
            defaultValue: "Y",
            dataSource: "yesNo",
          },
          {
            fieldName: "documentInfo.absorbTax",
            displayLabel: "Absorb Tax",
            fieldType: "select",
            required: false,
            defaultValue: "N",
            dataSource: "yesNo",
          },
          {
            fieldName: "documentInfo.gstPercent",
            displayLabel: "GST",
            fieldType: "number",
            required: false,
            defaultValue: 7.0,
          },
          {
            fieldName: "documentInfo.gstAmount",
            displayLabel: "GST Amount",
            fieldType: "number",
            required: false,
            defaultValue: 0,
          },
          {
            fieldName: "documentInfo.nettTotal",
            displayLabel: "Nett Total",
            fieldType: "number",
            required: false,
            defaultValue: 0,
          },
        ],
      },
      {
        tabId: "details",
        tabLabel: "Details",
        fields: [
          {
            fieldName: "documentInfo.referenceNo",
            displayLabel: "Reference No",
            fieldType: "text",
            required: false,
          },
          {
            fieldName: "documentInfo.remarks",
            displayLabel: "Remarks",
            fieldType: "textarea",
            required: false,
          },
        ],
      },
    ],
  },

  // DELIVERY_ORDER - Alias for DO
  DELIVERY_ORDER: { tabs: [] as TabDefinition[] }, // Will be mapped to DO in getTemplateFields

  // Aliases for legacy document types
  INVOICE: { tabs: [] as TabDefinition[] }, // Will be mapped to TI in getTemplateFields

  // SO - Sales Order
  // Based on legacy accounting system layout
  // Layout: Left column = form fields (labels on left), Right column = summary/totals
  SO: {
    tabs: [
      {
        tabId: "general",
        tabLabel: "General",
        fields: [
          // === LEFT COLUMN FIELDS (in order) ===
          {
            fieldName: "documentInfo.documentNumber",
            displayLabel: "S/O Number",
            fieldType: "text",
            required: true,
          },
          {
            fieldName: "documentInfo.date",
            displayLabel: "Date",
            fieldType: "date",
            required: true,
          },
          {
            fieldName: "customer",
            displayLabel: "Customer code",
            fieldType: "customer",
            required: true,
            dataSource: "customers",
          },
          {
            fieldName: "documentInfo.salesPerson",
            displayLabel: "Salesman code",
            fieldType: "salesman",
            required: false,
            defaultValue: "",
            dataSource: "salesmen",
          },
          {
            fieldName: "documentInfo.poNo",
            displayLabel: "P/O Number",
            fieldType: "text",
            required: false,
          },
          {
            fieldName: "deliveryTo",
            displayLabel: "Deliver to",
            fieldType: "textarea",
            required: false,
          },
          {
            fieldName: "documentInfo.deliveryDate",
            displayLabel: "Delivery Date",
            fieldType: "date",
            required: false,
          },
          {
            fieldName: "documentInfo.contact",
            displayLabel: "Contact",
            fieldType: "text",
            required: false,
          },
          {
            fieldName: "documentInfo.paymentTerms",
            displayLabel: "Terms",
            fieldType: "text",
            required: false,
            defaultValue: "0 DAYS",
          },
          // === RIGHT COLUMN FIELDS (summary/totals - in order) ===
          {
            fieldName: "documentInfo.rate",
            displayLabel: "Rate",
            fieldType: "number",
            required: false,
            defaultValue: 1.0,
          },
          {
            fieldName: "documentInfo.currency",
            displayLabel: "Currency",
            fieldType: "select",
            required: false,
            defaultValue: "SGD",
            dataSource: "currencies",
          },
          {
            fieldName: "documentInfo.grossTotal",
            displayLabel: "Gross Total",
            fieldType: "number",
            required: false,
            defaultValue: 0,
          },
          {
            fieldName: "documentInfo.discountPercent",
            displayLabel: "Disc %",
            fieldType: "number",
            required: false,
            defaultValue: 0,
          },
          {
            fieldName: "documentInfo.discountAmount",
            displayLabel: "Discount Amount",
            fieldType: "number",
            required: false,
            defaultValue: 0,
          },
          {
            fieldName: "documentInfo.subTotal",
            displayLabel: "Sub-total",
            fieldType: "number",
            required: false,
            defaultValue: 0,
          },
          {
            fieldName: "documentInfo.taxApplicable",
            displayLabel: "Tax",
            fieldType: "select",
            required: false,
            defaultValue: "Y",
            dataSource: "yesNo",
          },
          {
            fieldName: "documentInfo.absorbTax",
            displayLabel: "Absorb Tax",
            fieldType: "select",
            required: false,
            defaultValue: "N",
            dataSource: "yesNo",
          },
          {
            fieldName: "documentInfo.gstPercent",
            displayLabel: "GST",
            fieldType: "number",
            required: false,
            defaultValue: 9.0,
          },
          {
            fieldName: "documentInfo.gstAmount",
            displayLabel: "GST Amount",
            fieldType: "number",
            required: false,
            defaultValue: 0,
          },
          {
            fieldName: "documentInfo.nettTotal",
            displayLabel: "Nett Total",
            fieldType: "number",
            required: false,
            defaultValue: 0,
          },
        ],
      },
      {
        tabId: "details",
        tabLabel: "Details",
        fields: [
          {
            fieldName: "documentInfo.referenceNo",
            displayLabel: "Reference No",
            fieldType: "text",
            required: false,
          },
          {
            fieldName: "documentInfo.remarks",
            displayLabel: "Remarks",
            fieldType: "textarea",
            required: false,
          },
        ],
      },
      {
        tabId: "deliveryAddress",
        tabLabel: "Delivery Address",
        fields: [
          {
            fieldName: "deliveryAddress.line1",
            displayLabel: "Address Line 1",
            fieldType: "text",
            required: false,
          },
          {
            fieldName: "deliveryAddress.line2",
            displayLabel: "Address Line 2",
            fieldType: "text",
            required: false,
          },
          {
            fieldName: "deliveryAddress.city",
            displayLabel: "City",
            fieldType: "text",
            required: false,
          },
          {
            fieldName: "deliveryAddress.postalCode",
            displayLabel: "Postal Code",
            fieldType: "text",
            required: false,
          },
          {
            fieldName: "deliveryAddress.country",
            displayLabel: "Country",
            fieldType: "text",
            required: false,
          },
          {
            fieldName: "deliveryAddress.attention",
            displayLabel: "Attention",
            fieldType: "text",
            required: false,
          },
        ],
      },
    ],
  },

  // SALES_ORDER - Alias for SO
  SALES_ORDER: { tabs: [] as TabDefinition[] }, // Will be mapped to SO in getTemplateFields

  // DN - Debit Note
  DN: {
    tabs: [
      {
        tabId: "general",
        tabLabel: "General",
        fields: [
          {
            fieldName: "documentInfo.documentNumber",
            displayLabel: "Debit Note No.",
            fieldType: "text",
            required: true,
          },
          {
            fieldName: "documentInfo.date",
            displayLabel: "Date",
            fieldType: "date",
            required: true,
          },
          {
            fieldName: "customer",
            displayLabel: "Customer code",
            fieldType: "customer",
            required: true,
            dataSource: "customers",
          },
          {
            fieldName: "documentInfo.salesPerson",
            displayLabel: "Salesman code",
            fieldType: "salesman",
            required: false,
            defaultValue: "",
            dataSource: "salesmen",
          },
          {
            fieldName: "documentInfo.invoiceNo",
            displayLabel: "Invoice No.",
            fieldType: "text",
            required: false,
          },
          {
            fieldName: "documentInfo.doNo",
            displayLabel: "Delivery Order No.",
            fieldType: "text",
            required: false,
          },
          {
            fieldName: "documentInfo.contact",
            displayLabel: "Contact",
            fieldType: "text",
            required: false,
          },
          {
            fieldName: "documentInfo.paymentTerms",
            displayLabel: "Terms",
            fieldType: "text",
            required: false,
            defaultValue: "0 DAYS",
          },
          // Right side totals
          {
            fieldName: "documentInfo.rate",
            displayLabel: "Rate",
            fieldType: "number",
            required: false,
            defaultValue: 1.0,
          },
          {
            fieldName: "documentInfo.grossTotal",
            displayLabel: "Gross Total",
            fieldType: "number",
            required: false,
            defaultValue: 0,
          },
          {
            fieldName: "documentInfo.discountPercent",
            displayLabel: "Disc %",
            fieldType: "number",
            required: false,
            defaultValue: 0,
          },
          {
            fieldName: "documentInfo.subTotal",
            displayLabel: "Sub-total",
            fieldType: "number",
            required: false,
            defaultValue: 0,
          },
          {
            fieldName: "documentInfo.taxApplicable",
            displayLabel: "Tax",
            fieldType: "select",
            required: false,
            defaultValue: "Y",
            dataSource: "yesNo",
          },
          {
            fieldName: "documentInfo.absorbTax",
            displayLabel: "Absorb Tax",
            fieldType: "select",
            required: false,
            defaultValue: "N",
            dataSource: "yesNo",
          },
          {
            fieldName: "documentInfo.gstPercent",
            displayLabel: "GST",
            fieldType: "number",
            required: false,
            defaultValue: 9.0,
          },
          {
            fieldName: "documentInfo.nettTotal",
            displayLabel: "Nett Total",
            fieldType: "number",
            required: false,
            defaultValue: 0,
          },
        ],
      },
      {
        tabId: "details",
        tabLabel: "Details",
        fields: [
          {
            fieldName: "documentInfo.remarks",
            displayLabel: "Remarks",
            fieldType: "textarea",
            required: false,
          },
        ],
      },
    ],
  },

  // DEBIT_NOTE - Alias for DN
  DEBIT_NOTE: { tabs: [] as TabDefinition[] }, // Will be mapped to DN in getTemplateFields

  // CN - Credit Note
  CN: {
    tabs: [
      {
        tabId: "general",
        tabLabel: "General",
        fields: [
          {
            fieldName: "documentInfo.documentNumber",
            displayLabel: "Credit Note No.",
            fieldType: "text",
            required: true,
          },
          {
            fieldName: "documentInfo.date",
            displayLabel: "Date",
            fieldType: "date",
            required: true,
          },
          {
            fieldName: "customer",
            displayLabel: "Customer code",
            fieldType: "customer",
            required: true,
            dataSource: "customers",
          },
          {
            fieldName: "documentInfo.salesPerson",
            displayLabel: "Salesman code",
            fieldType: "salesman",
            required: false,
            defaultValue: "",
            dataSource: "salesmen",
          },
          {
            fieldName: "documentInfo.invoiceNo",
            displayLabel: "Invoice No.",
            fieldType: "text",
            required: false,
          },
          {
            fieldName: "documentInfo.doNo",
            displayLabel: "Delivery Order No.",
            fieldType: "text",
            required: false,
          },
          {
            fieldName: "documentInfo.contact",
            displayLabel: "Contact",
            fieldType: "text",
            required: false,
          },
          {
            fieldName: "documentInfo.paymentTerms",
            displayLabel: "Terms",
            fieldType: "text",
            required: false,
            defaultValue: "0 DAYS",
          },
          // Right side totals
          {
            fieldName: "documentInfo.rate",
            displayLabel: "Rate",
            fieldType: "number",
            required: false,
            defaultValue: 1.0,
          },
          {
            fieldName: "documentInfo.grossTotal",
            displayLabel: "Gross Total",
            fieldType: "number",
            required: false,
            defaultValue: 0,
          },
          {
            fieldName: "documentInfo.discountPercent",
            displayLabel: "Disc %",
            fieldType: "number",
            required: false,
            defaultValue: 0,
          },
          {
            fieldName: "documentInfo.subTotal",
            displayLabel: "Sub-total",
            fieldType: "number",
            required: false,
            defaultValue: 0,
          },
          {
            fieldName: "documentInfo.taxApplicable",
            displayLabel: "Tax",
            fieldType: "select",
            required: false,
            defaultValue: "Y",
            dataSource: "yesNo",
          },
          {
            fieldName: "documentInfo.absorbTax",
            displayLabel: "Absorb Tax",
            fieldType: "select",
            required: false,
            defaultValue: "N",
            dataSource: "yesNo",
          },
          {
            fieldName: "documentInfo.gstPercent",
            displayLabel: "GST",
            fieldType: "number",
            required: false,
            defaultValue: 9.0,
          },
          {
            fieldName: "documentInfo.nettTotal",
            displayLabel: "Nett Total",
            fieldType: "number",
            required: false,
            defaultValue: 0,
          },
        ],
      },
      {
        tabId: "details",
        tabLabel: "Details",
        fields: [
          {
            fieldName: "documentInfo.remarks",
            displayLabel: "Remarks",
            fieldType: "textarea",
            required: false,
          },
        ],
      },
    ],
  },

  // CREDIT_NOTE - Alias for CN
  CREDIT_NOTE: { tabs: [] as TabDefinition[] }, // Will be mapped to CN in getTemplateFields

  // ========================================
  // INVENTORY / PURCHASING DOCUMENTS
  // ========================================

  // PO - Purchase Order
  // Based on legacy accounting system layout
  // Layout: Left column = form fields (labels on left), Right column = summary/totals
  PO: {
    tabs: [
      {
        tabId: "general",
        tabLabel: "General",
        fields: [
          // === LEFT COLUMN FIELDS (in order) ===
          {
            fieldName: "documentInfo.documentNumber",
            displayLabel: "Purchase Order No.",
            fieldType: "text",
            required: true,
          },
          {
            fieldName: "documentInfo.date",
            displayLabel: "Date",
            fieldType: "date",
            required: true,
          },
          {
            fieldName: "documentInfo.supplierCode",
            displayLabel: "Supplier code",
            fieldType: "supplier",
            required: false,
            dataSource: "customers", // Suppliers come from the same customer list
          },
          {
            fieldName: "documentInfo.purchaserCode",
            displayLabel: "Purchaser code",
            fieldType: "salesman", // Use salesman type since purchaser is also a user
            required: false,
            dataSource: "salesmen",
          },
          {
            fieldName: "documentInfo.referenceNo",
            displayLabel: "Reference No.",
            fieldType: "text",
            required: false,
          },
          {
            fieldName: "documentInfo.deliveryDate",
            displayLabel: "Delivery Date",
            fieldType: "date",
            required: false,
          },
          {
            fieldName: "documentInfo.contact",
            displayLabel: "Contact",
            fieldType: "text",
            required: false,
          },
          {
            fieldName: "documentInfo.paymentTerms",
            displayLabel: "Terms",
            fieldType: "text",
            required: false,
            defaultValue: "60 DAYS",
          },
          // === RIGHT COLUMN FIELDS (summary/totals - in order) ===
          {
            fieldName: "documentInfo.rate",
            displayLabel: "Rate",
            fieldType: "number",
            required: false,
            defaultValue: 1.0,
          },
          {
            fieldName: "documentInfo.currency",
            displayLabel: "Currency",
            fieldType: "select",
            required: false,
            defaultValue: "SGD",
            dataSource: "currencies",
          },
          {
            fieldName: "documentInfo.grossTotal",
            displayLabel: "Gross Total",
            fieldType: "number",
            required: false,
            defaultValue: 0,
          },
          {
            fieldName: "documentInfo.discountPercent",
            displayLabel: "Disc %",
            fieldType: "number",
            required: false,
            defaultValue: 0,
          },
          {
            fieldName: "documentInfo.discountAmount",
            displayLabel: "Discount Amount",
            fieldType: "number",
            required: false,
            defaultValue: 0,
          },
          {
            fieldName: "documentInfo.subTotal",
            displayLabel: "Sub-total",
            fieldType: "number",
            required: false,
            defaultValue: 0,
          },
          {
            fieldName: "documentInfo.taxApplicable",
            displayLabel: "Tax",
            fieldType: "select",
            required: false,
            defaultValue: "Y",
            dataSource: "yesNo",
          },
          {
            fieldName: "documentInfo.absorbTax",
            displayLabel: "Absorb Tax",
            fieldType: "select",
            required: false,
            defaultValue: "N",
            dataSource: "yesNo",
          },
          {
            fieldName: "documentInfo.gstPercent",
            displayLabel: "GST",
            fieldType: "number",
            required: false,
            defaultValue: 9.0,
          },
          {
            fieldName: "documentInfo.gstAmount",
            displayLabel: "GST Amount",
            fieldType: "number",
            required: false,
            defaultValue: 0,
          },
          {
            fieldName: "documentInfo.nettTotal",
            displayLabel: "Nett Total",
            fieldType: "number",
            required: false,
            defaultValue: 0,
          },
        ],
      },
      {
        tabId: "details",
        tabLabel: "Details",
        fields: [
          {
            fieldName: "documentInfo.remarks",
            displayLabel: "Remarks",
            fieldType: "textarea",
            required: false,
          },
        ],
      },
      {
        tabId: "deliveryAddress",
        tabLabel: "Delivery Address",
        fields: [
          {
            fieldName: "deliveryAddress.line1",
            displayLabel: "Address Line 1",
            fieldType: "text",
            required: false,
          },
          {
            fieldName: "deliveryAddress.line2",
            displayLabel: "Address Line 2",
            fieldType: "text",
            required: false,
          },
          {
            fieldName: "deliveryAddress.city",
            displayLabel: "City",
            fieldType: "text",
            required: false,
          },
          {
            fieldName: "deliveryAddress.postalCode",
            displayLabel: "Postal Code",
            fieldType: "text",
            required: false,
          },
          {
            fieldName: "deliveryAddress.country",
            displayLabel: "Country",
            fieldType: "text",
            required: false,
          },
          {
            fieldName: "deliveryAddress.attention",
            displayLabel: "Attention",
            fieldType: "text",
            required: false,
          },
        ],
      },
    ],
  },

  // PURCHASE_ORDER - Alias for PO
  PURCHASE_ORDER: { tabs: [] as TabDefinition[] }, // Will be mapped to PO in getTemplateFields

  // PR - Purchase Return
  // Based on legacy accounting system layout
  // Layout: Left column = form fields (labels on left), Right column = summary/totals
  PR: {
    tabs: [
      {
        tabId: "general",
        tabLabel: "General",
        fields: [
          // === LEFT COLUMN FIELDS (in order) ===
          {
            fieldName: "documentInfo.documentNumber",
            displayLabel: "Purchase Return No.",
            fieldType: "text",
            required: true,
          },
          {
            fieldName: "documentInfo.date",
            displayLabel: "Date",
            fieldType: "date",
            required: true,
          },
          {
            fieldName: "documentInfo.supplierCode",
            displayLabel: "Supplier code",
            fieldType: "supplier",
            required: false,
            dataSource: "customers",
          },
          {
            fieldName: "documentInfo.purchaserCode",
            displayLabel: "Purchaser code",
            fieldType: "salesman",
            required: false,
            dataSource: "salesmen",
          },
          {
            fieldName: "documentInfo.poNo",
            displayLabel: "Purchase Order No.",
            fieldType: "text",
            required: false,
          },
          {
            fieldName: "documentInfo.projectRef",
            displayLabel: "Project Reference",
            fieldType: "text",
            required: false,
          },
          {
            fieldName: "documentInfo.contact",
            displayLabel: "Contact",
            fieldType: "text",
            required: false,
          },
          {
            fieldName: "documentInfo.paymentTerms",
            displayLabel: "Terms",
            fieldType: "text",
            required: false,
            defaultValue: "60 DAYS",
          },
          // === RIGHT COLUMN FIELDS (summary/totals - in order) ===
          {
            fieldName: "documentInfo.rate",
            displayLabel: "Rate",
            fieldType: "number",
            required: false,
            defaultValue: 1.0,
          },
          {
            fieldName: "documentInfo.grossTotal",
            displayLabel: "Gross Total",
            fieldType: "number",
            required: false,
            defaultValue: 0,
          },
          {
            fieldName: "documentInfo.discountPercent",
            displayLabel: "Disc %",
            fieldType: "number",
            required: false,
            defaultValue: 0,
          },
          {
            fieldName: "documentInfo.subTotal",
            displayLabel: "Sub-total",
            fieldType: "number",
            required: false,
            defaultValue: 0,
          },
          {
            fieldName: "documentInfo.taxApplicable",
            displayLabel: "Tax",
            fieldType: "select",
            required: false,
            defaultValue: "Y",
            dataSource: "yesNo",
          },
          {
            fieldName: "documentInfo.absorbTax",
            displayLabel: "Absorb Tax",
            fieldType: "select",
            required: false,
            defaultValue: "N",
            dataSource: "yesNo",
          },
          {
            fieldName: "documentInfo.gstPercent",
            displayLabel: "GST",
            fieldType: "number",
            required: false,
            defaultValue: 9.0,
          },
          {
            fieldName: "documentInfo.nettTotal",
            displayLabel: "Nett Total",
            fieldType: "number",
            required: false,
            defaultValue: 0,
          },
        ],
      },
      {
        tabId: "details",
        tabLabel: "Details",
        fields: [
          {
            fieldName: "documentInfo.remarks",
            displayLabel: "Remarks",
            fieldType: "textarea",
            required: false,
          },
        ],
      },
    ],
  },

  // PURCHASE_RETURN - Alias for PR
  PURCHASE_RETURN: { tabs: [] as TabDefinition[] }, // Will be mapped to PR in getTemplateFields

  // SAI - Stock Adjustment In
  // Simpler form with just Rate and Total Amount
  SAI: {
    tabs: [
      {
        tabId: "general",
        tabLabel: "General",
        fields: [
          // === LEFT COLUMN FIELDS (in order) ===
          {
            fieldName: "documentInfo.documentNumber",
            displayLabel: "Reference No.",
            fieldType: "text",
            required: true,
          },
          {
            fieldName: "documentInfo.date",
            displayLabel: "Date",
            fieldType: "date",
            required: true,
          },
          {
            fieldName: "documentInfo.supplierCode",
            displayLabel: "Supplier code",
            fieldType: "supplier",
            required: false,
            dataSource: "customers",
          },
          {
            fieldName: "documentInfo.prepareBy",
            displayLabel: "Prepare By",
            fieldType: "salesman",
            required: false,
            dataSource: "salesmen",
          },
          {
            fieldName: "documentInfo.woNo",
            displayLabel: "W/O Number",
            fieldType: "text",
            required: false,
          },
          {
            fieldName: "documentInfo.contact",
            displayLabel: "Contact",
            fieldType: "text",
            required: false,
          },
          {
            fieldName: "documentInfo.paymentTerms",
            displayLabel: "Terms",
            fieldType: "text",
            required: false,
            defaultValue: "CASH",
          },
          // === RIGHT COLUMN FIELDS (summary/totals - simpler) ===
          {
            fieldName: "documentInfo.rate",
            displayLabel: "Rate",
            fieldType: "number",
            required: false,
            defaultValue: 1.0,
          },
          {
            fieldName: "documentInfo.totalAmount",
            displayLabel: "Total Amount",
            fieldType: "number",
            required: false,
            defaultValue: 0,
          },
        ],
      },
      {
        tabId: "details",
        tabLabel: "Details",
        fields: [
          {
            fieldName: "documentInfo.remarks",
            displayLabel: "Remarks",
            fieldType: "textarea",
            required: false,
          },
        ],
      },
    ],
  },

  // STOCK_ADJUSTMENT_IN - Alias for SAI
  STOCK_ADJUSTMENT_IN: { tabs: [] as TabDefinition[] }, // Will be mapped to SAI in getTemplateFields

  // SAO - Stock Adjustment Out
  // Similar to SAI but with Purchaser code instead of Prepare By
  SAO: {
    tabs: [
      {
        tabId: "general",
        tabLabel: "General",
        fields: [
          // === LEFT COLUMN FIELDS (in order) ===
          {
            fieldName: "documentInfo.documentNumber",
            displayLabel: "Reference No.",
            fieldType: "text",
            required: true,
          },
          {
            fieldName: "documentInfo.date",
            displayLabel: "Date",
            fieldType: "date",
            required: true,
          },
          {
            fieldName: "documentInfo.supplierCode",
            displayLabel: "Supplier code",
            fieldType: "supplier",
            required: false,
            dataSource: "customers",
          },
          {
            fieldName: "documentInfo.purchaserCode",
            displayLabel: "Purchaser code",
            fieldType: "salesman",
            required: false,
            dataSource: "salesmen",
          },
          {
            fieldName: "documentInfo.woNo",
            displayLabel: "W/O Number",
            fieldType: "text",
            required: false,
          },
          {
            fieldName: "documentInfo.contact",
            displayLabel: "Contact",
            fieldType: "text",
            required: false,
          },
          {
            fieldName: "documentInfo.paymentTerms",
            displayLabel: "Terms",
            fieldType: "text",
            required: false,
            defaultValue: "CASH",
          },
          // === RIGHT COLUMN FIELDS (summary/totals - simpler) ===
          {
            fieldName: "documentInfo.rate",
            displayLabel: "Rate",
            fieldType: "number",
            required: false,
            defaultValue: 1.0,
          },
          {
            fieldName: "documentInfo.totalAmount",
            displayLabel: "Total Amount",
            fieldType: "number",
            required: false,
            defaultValue: 0,
          },
        ],
      },
      {
        tabId: "details",
        tabLabel: "Details",
        fields: [
          {
            fieldName: "documentInfo.remarks",
            displayLabel: "Remarks",
            fieldType: "textarea",
            required: false,
          },
        ],
      },
    ],
  },

  // STOCK_ADJUSTMENT_OUT - Alias for SAO
  STOCK_ADJUSTMENT_OUT: { tabs: [] as TabDefinition[] }, // Will be mapped to SAO in getTemplateFields
};

// Map INVOICE to TI fields
TEMPLATE_FIELD_DEFINITIONS.INVOICE = TEMPLATE_FIELD_DEFINITIONS.TI;
// Map DELIVERY_ORDER to DO fields
TEMPLATE_FIELD_DEFINITIONS.DELIVERY_ORDER = TEMPLATE_FIELD_DEFINITIONS.DO;
// Map SALES_ORDER to SO fields
TEMPLATE_FIELD_DEFINITIONS.SALES_ORDER = TEMPLATE_FIELD_DEFINITIONS.SO;
// Map DEBIT_NOTE to DN fields
TEMPLATE_FIELD_DEFINITIONS.DEBIT_NOTE = TEMPLATE_FIELD_DEFINITIONS.DN;
// Map CREDIT_NOTE to CN fields
TEMPLATE_FIELD_DEFINITIONS.CREDIT_NOTE = TEMPLATE_FIELD_DEFINITIONS.CN;
// Map PURCHASE_ORDER to PO fields
TEMPLATE_FIELD_DEFINITIONS.PURCHASE_ORDER = TEMPLATE_FIELD_DEFINITIONS.PO;
// Map PURCHASE_RETURN to PR fields
TEMPLATE_FIELD_DEFINITIONS.PURCHASE_RETURN = TEMPLATE_FIELD_DEFINITIONS.PR;
// Map STOCK_ADJUSTMENT_IN to SAI fields
TEMPLATE_FIELD_DEFINITIONS.STOCK_ADJUSTMENT_IN = TEMPLATE_FIELD_DEFINITIONS.SAI;
// Map STOCK_ADJUSTMENT_OUT to SAO fields
TEMPLATE_FIELD_DEFINITIONS.STOCK_ADJUSTMENT_OUT = TEMPLATE_FIELD_DEFINITIONS.SAO;

/**
 * Get field definitions for a specific template variant
 */
export function getTemplateFields(templateVariant: string): TemplateFieldConfig | null {
  // Handle legacy type names
  const variantMap: Record<string, string> = {
    INVOICE: "TI",
    DELIVERY_ORDER: "DO",
    SALES_ORDER: "SO",
    DEBIT_NOTE: "DN",
    CREDIT_NOTE: "CN",
    PURCHASE_ORDER: "PO",
    PURCHASE_RETURN: "PR",
    STOCK_ADJUSTMENT_IN: "SAI",
    STOCK_ADJUSTMENT_OUT: "SAO",
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
