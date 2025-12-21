import {
  RequestQuote as RequestQuoteIcon,
  ShoppingCart as ShoppingCartIcon,
  LocalShipping as LocalShippingIcon,
  Receipt as ReceiptIcon,
  RemoveCircle as RemoveCircleIcon,
  AddCircle as AddCircleIcon,
  Inventory as InventoryIcon,
} from "@mui/icons-material";

export const SALES_DOCUMENT_TYPES = {
  QUOTATION: {
    types: ["QUOTATION", "QO1"],
    label: "Quotation",
    pluralLabel: "Quotations",
    icon: RequestQuoteIcon,
    createDocumentType: "QUOTATION", // type field in DocumentTemplate table
  },
  SALES_ORDER: {
    types: ["SO", "SALES_ORDER"],
    label: "Sales Order",
    pluralLabel: "Sales Orders",
    icon: ShoppingCartIcon,
    createDocumentType: "SALES_ORDER", // type field in DocumentTemplate table
  },
  DELIVERY_ORDER: {
    types: ["DELIVERY_ORDER", "DO"],
    label: "Delivery Order",
    pluralLabel: "Delivery Orders",
    icon: LocalShippingIcon,
    createDocumentType: "DELIVERY_ORDER", // type field in DocumentTemplate table
  },
  INVOICE: {
    types: ["INVOICE", "TI", "TI2"],
    label: "Invoice",
    pluralLabel: "Invoices",
    icon: ReceiptIcon,
    createDocumentType: "INVOICE", // type field in DocumentTemplate table
  },
  DEBIT_NOTE: {
    types: ["DEBIT_NOTE", "DN"],
    label: "Debit Note",
    pluralLabel: "Debit Notes",
    icon: RemoveCircleIcon,
    createDocumentType: "DEBIT_NOTE", // type field in DocumentTemplate table
  },
  CREDIT_NOTE: {
    types: ["CREDIT_NOTE", "CN"],
    label: "Credit Note",
    pluralLabel: "Credit Notes",
    icon: AddCircleIcon,
    createDocumentType: "CREDIT_NOTE", // type field in DocumentTemplate table
  },
  STOCK_CARD: {
    types: [],
    label: "Stock Card",
    pluralLabel: "Stock Card",
    icon: InventoryIcon,
    createDocumentType: "", // No document creation for stock card
  },
};

export type SalesDocumentTypeKey = keyof typeof SALES_DOCUMENT_TYPES;
