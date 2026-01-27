/**
 * Template Field Definitions
 *
 * This file defines the default form fields for each document template variant.
 * These are used as fallback when a template doesn't have custom field definitions
 * stored in the database.
 */

export interface FieldDefinition {
  fieldName: string;
  displayLabel: string;
  fieldType: "text" | "number" | "date" | "select" | "autocomplete" | "textarea" | "table" | "customer" | "salesman" | "supplier";
  required: boolean;
  gridSize?: 6 | 12;
  dataSource?: string;
  placeholder?: string;
  defaultValue?: any;
  filterBy?: string;
  storagePath?: string;
}

export interface TabDefinition {
  tabId: string;
  tabLabel: string;
  fields: FieldDefinition[];
}

export interface TemplateFieldConfig {
  tabs: TabDefinition[];
}

export const TEMPLATE_FIELD_DEFINITIONS: Record<string, TemplateFieldConfig> = {
  // TI - Tax Invoice (Original Design)
  TI: {
    tabs: [
      {
        tabId: "general",
        tabLabel: "GENERAL",
        fields: [
          {
            fieldName: "customer",
            displayLabel: "Customer",
            fieldType: "customer",
            required: true,
            gridSize: 12,
            dataSource: "customers",
          },
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
          {
            fieldName: "deliveryAddress.attention",
            displayLabel: "Attention",
            fieldType: "text",
            required: false,
            gridSize: 6,
          },
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
        tabLabel: "General",
        fields: [
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
    ],
  },

  // DO - Delivery Order
  DO: {
    tabs: [
      {
        tabId: "general",
        tabLabel: "General",
        fields: [
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

  // SO - Sales Order
  SO: {
    tabs: [
      {
        tabId: "general",
        tabLabel: "General",
        fields: [
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

  // PO - Purchase Order
  PO: {
    tabs: [
      {
        tabId: "general",
        tabLabel: "General",
        fields: [
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

  // PR - Purchase Return
  PR: {
    tabs: [
      {
        tabId: "general",
        tabLabel: "General",
        fields: [
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

  // SAI - Stock Adjustment In
  SAI: {
    tabs: [
      {
        tabId: "general",
        tabLabel: "General",
        fields: [
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

  // SAO - Stock Adjustment Out
  SAO: {
    tabs: [
      {
        tabId: "general",
        tabLabel: "General",
        fields: [
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

  // QT - Quotation
  QT: {
    tabs: [
      {
        tabId: "general",
        tabLabel: "General",
        fields: [
          {
            fieldName: "documentInfo.documentNumber",
            displayLabel: "Quotation No.",
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
            fieldName: "documentInfo.referenceNo",
            displayLabel: "Your Reference",
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
            defaultValue: "N",
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
            defaultValue: 0,
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
          {
            fieldName: "documentInfo.validityPeriod",
            displayLabel: "Validity Period",
            fieldType: "text",
            required: false,
            defaultValue: "30 days",
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
};

// Alias mappings for legacy document types
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
  QUOTATION: "QT",
  QO: "QT",
};

/**
 * Get field definitions for a specific template variant
 */
export function getTemplateFields(templateVariant: string): TemplateFieldConfig | null {
  const mappedVariant = variantMap[templateVariant] || templateVariant;
  return TEMPLATE_FIELD_DEFINITIONS[mappedVariant] || null;
}

/**
 * Get all available template variants
 */
export function getAvailableTemplateVariants(): string[] {
  return Object.keys(TEMPLATE_FIELD_DEFINITIONS);
}
