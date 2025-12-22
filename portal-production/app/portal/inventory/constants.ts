import CategoryIcon from "@mui/icons-material/Category";
import ShoppingCartIcon from "@mui/icons-material/ShoppingCart";
import AssignmentReturnIcon from "@mui/icons-material/AssignmentReturn";
import AddBoxIcon from "@mui/icons-material/AddBox";
import IndeterminateCheckBoxIcon from "@mui/icons-material/IndeterminateCheckBox";
import AssessmentIcon from "@mui/icons-material/Assessment";
import ViewListIcon from "@mui/icons-material/ViewList";

// Inventory menu items for sidebar navigation
export const INVENTORY_MENU_ITEMS = {
  PRODUCTS: {
    key: "products",
    label: "Products",
    pluralLabel: "Products",
    icon: CategoryIcon,
    path: "/portal/inventory/products",
    description: "Manage your products and assets",
  },
  PURCHASES: {
    key: "purchases",
    label: "Purchases",
    pluralLabel: "Purchases",
    icon: ShoppingCartIcon,
    path: "/portal/inventory/purchases",
    description: "Record purchase orders and incoming stock",
  },
  PURCHASES_RETURN: {
    key: "purchases-return",
    label: "Purchases Return",
    pluralLabel: "Purchases Returns",
    icon: AssignmentReturnIcon,
    path: "/portal/inventory/purchases-return",
    description: "Manage returns to suppliers",
  },
  ADJUSTMENT_IN: {
    key: "adjustment-in",
    label: "Stock Adjustment In",
    pluralLabel: "Stock Adjustments In",
    icon: AddBoxIcon,
    path: "/portal/inventory/adjustment-in",
    description: "Record stock additions and corrections",
  },
  ADJUSTMENT_OUT: {
    key: "adjustment-out",
    label: "Stock Adjustment Out",
    pluralLabel: "Stock Adjustments Out",
    icon: IndeterminateCheckBoxIcon,
    path: "/portal/inventory/adjustment-out",
    description: "Record stock removals and corrections",
  },
  REPORTS: {
    key: "reports",
    label: "Reports",
    pluralLabel: "Reports",
    icon: AssessmentIcon,
    path: "/portal/inventory/reports",
    description: "View inventory reports and analytics",
  },
  STOCK_CARD: {
    key: "stock-card",
    label: "Stock Card",
    pluralLabel: "Stock Cards",
    icon: ViewListIcon,
    path: "/portal/inventory/stock-card",
    description: "View detailed stock transaction history",
  },
};

export type InventoryMenuKey = keyof typeof INVENTORY_MENU_ITEMS;

// Inventory document types for document filtering (similar to SALES_DOCUMENT_TYPES)
export const INVENTORY_DOCUMENT_TYPES = {
  PURCHASE_ORDER: {
    types: ["PO", "PURCHASE_ORDER"],
    label: "Purchase Order",
    pluralLabel: "Purchase Orders",
    icon: ShoppingCartIcon,
    createDocumentType: "PO", // type field in DocumentTemplate table
  },
  PURCHASE_RETURN: {
    types: ["PR", "PURCHASE_RETURN"],
    label: "Purchase Return",
    pluralLabel: "Purchase Returns",
    icon: AssignmentReturnIcon,
    createDocumentType: "PR",
  },
  STOCK_ADJUSTMENT_IN: {
    types: ["SAI", "STOCK_ADJUSTMENT_IN"],
    label: "Stock Adjustment In",
    pluralLabel: "Stock Adjustments In",
    icon: AddBoxIcon,
    createDocumentType: "SAI",
  },
  STOCK_ADJUSTMENT_OUT: {
    types: ["SAO", "STOCK_ADJUSTMENT_OUT"],
    label: "Stock Adjustment Out",
    pluralLabel: "Stock Adjustments Out",
    icon: IndeterminateCheckBoxIcon,
    createDocumentType: "SAO",
  },
};

export type InventoryDocumentTypeKey = keyof typeof INVENTORY_DOCUMENT_TYPES;

export const INVENTORY_STATUS = [
  { label: "Rental", value: "rental" },
  { label: "Reserved", value: "reserved" },
  { label: "Maintenance", value: "maintenance" },
  { label: "Sold", value: "sold" },
  { label: "Instock", value: "instock" },
];

export const API = {
  GET_INVENTORY: {
    path: "/inventories",
    method: "POST",
  },
  GET_INVENTORY_BY_SKU: {
    path: "/inventories/sku/:sku",
    method: "GET",
  },
  CREATE_INVENTORY: {
    path: "/inventories/create",
    method: "POST",
  },
  RESET_CREATE_INVENTORY: {
    path: "/inventories/reset",
    method: "POST",
  },
  UPDATE_INVENTORY: {
    path: "/inventories/update",
    method: "POST",
  },
  DELETE_INVENTORY: {
    path: "/inventories/delete",
    method: "DELETE",
  },
  GET_ASSETS: {
    path: "/assets",
    method: "POST",
  },
  GET_CATEGORIES: {
    path: "/categories",
    method: "GET",
  },
  GENERATE_SKU: {
    path: "/inventories/generate-sku",
    method: "POST",
  },
  GET_QR_CODE: {
    path: "/inventories/qrcode/:sku",
    method: "GET",
  },

  GET_DOCUMENTS: {
    path: "/documents/inventory/:inventoryId",
    method: "GET",
  },

  GET_TIMELINE_ITEMS: {
    path: "/timeline-items/inventory/:inventoryId",
    method: "GET",
  },
};
