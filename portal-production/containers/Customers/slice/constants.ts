export const API = {
  GET_CUSTOMERS: {
    path: "/customers",
    method: "POST",
  },
  GET_CUSTOMER_BY_ID: {
    path: "/customers/:id",
    method: "GET",
  },
  CREATE_CUSTOMER: {
    path: "/customers/create",
    method: "POST",
  },
  RESET_CREATE_CUSTOMER: {
    path: "/customers/reset",
    method: "POST",
  },
  UPDATE_CUSTOMER: {
    path: "/customers/update",
    method: "POST",
  },
  DELETE_CUSTOMER: {
    path: "/customers/delete",
    method: "DELETE",
  },
};
