export const DOCUMENT_API = {
  CREATE_WITH_TIMELINE: {
    path: "/documents/with-timeline",
    method: "POST",
  },
  GET_ALL: {
    path: "/documents",
    method: "GET",
  },
  GET_BY_ID: {
    path: "/documents/:id",
    method: "GET",
  },
  GET_BY_INVENTORY: {
    path: "/documents/inventory/:inventoryId",
    method: "GET",
  },
  UPDATE: {
    path: "/documents/update",
    method: "POST",
  },
  DELETE: {
    path: "/documents/delete",
    method: "DELETE",
  },
};
