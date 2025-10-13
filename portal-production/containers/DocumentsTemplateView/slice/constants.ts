export const API = {
  GET_DOCUMENT_TEMPLATES: {
    path: "/documentTemplates",
    method: "POST",
  },
  GET_DOCUMENT_TEMPLATE_BY_ID: {
    path: "/documentTemplates/:id",
    method: "GET",
  },
  CREATE_DOCUMENT_TEMPLATE: {
    path: "/documentTemplates/create",
    method: "POST",
  },
  UPDATE_DOCUMENT_TEMPLATE: {
    path: "/documentTemplates/update",
    method: "POST",
  },
  DELETE_DOCUMENT_TEMPLATE: {
    path: "/documentTemplates/delete",
    method: "DELETE",
  },
  GET_ASSETS: {
    path: "/assets",
    method: "POST",
  },
  GET_CUSTOMERS: {
    path: "/customers",
    method: "POST",
  },

  GET_DOCUMENT_INVENTORY: {
    path: "/inventories/by-status",
    method: "POST",
  },

  CREATE_DOCUMENT_WITH_TIMELINE: {
    path: "/documents/with-timeline",
    method: "POST",
  },
  GET_DOCUMENT_BY_ID: {
    path: "/documents/:id",
    method: "GET",
  },
  UPDATE_DOCUMENT: {
    path: "/documents/update",
    method: "POST",
  },
  GET_INVENTORIES_BY_IDS: {
    path: "/inventories/by-ids",
    method: "POST",
  },
};

export const DOCUMENT_TYPES = [
  { label: "Return Delivery Order", value: "RDO" },
  { label: "Delivery Order", value: "DO" },
  { label: "Maintenance Service Report", value: "MSR" },
  { label: "Quotation", value: "QO1" },
  { label: "Invoice", value: "TI" },
];
