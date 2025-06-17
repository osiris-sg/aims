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

export const INVENTORY_STATUS = [
  { label: "Rental", value: "rental" },
  { label: "Reserved", value: "reserved" },
  { label: "Maintenance", value: "maintenance" },
  { label: "Sold", value: "sold" },
  { label: "Instock", value: "instock" },
];
