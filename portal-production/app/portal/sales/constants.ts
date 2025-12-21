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
    createPath: "/portal/documents/create?type=QUOTATION",
  },
  SALES_ORDER: {
    types: ["SALES_ORDER"],
    label: "Sales Order",
    pluralLabel: "Sales Orders",
    icon: ShoppingCartIcon,
    createPath: "/portal/documents/create?type=SALES_ORDER",
  },
  DELIVERY_ORDER: {
    types: ["DELIVERY_ORDER", "DO"],
    label: "Delivery Order",
    pluralLabel: "Delivery Orders",
    icon: LocalShippingIcon,
    createPath: "/portal/documents/create?type=DO",
  },
  INVOICE: {
    types: ["INVOICE", "TI", "TI2"],
    label: "Invoice",
    pluralLabel: "Invoices",
    icon: ReceiptIcon,
    createPath: "/portal/sales/invoices/create",
  },
  DEBIT_NOTE: {
    types: ["DEBIT_NOTE"],
    label: "Debit Note",
    pluralLabel: "Debit Notes",
    icon: RemoveCircleIcon,
    createPath: "/portal/documents/create?type=DEBIT_NOTE",
  },
  CREDIT_NOTE: {
    types: ["CREDIT_NOTE"],
    label: "Credit Note",
    pluralLabel: "Credit Notes",
    icon: AddCircleIcon,
    createPath: "/portal/documents/create?type=CREDIT_NOTE",
  },
  STOCK_CARD: {
    types: [],
    label: "Stock Card",
    pluralLabel: "Stock Card",
    icon: InventoryIcon,
    createPath: "",
  },
};

export type SalesDocumentTypeKey = keyof typeof SALES_DOCUMENT_TYPES;
