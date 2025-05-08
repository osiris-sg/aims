export const API = {
  GET_ASSETS: {
    path: "/assets",
    method: "POST",
  },
  GET_ASSET_BY_SKUKEY: {
    path: "/assets/skuKey/:skuKey",
    method: "GET",
  },
  GET_ASSET_BY_ID: {
    path: "/assets/:id",
    method: "GET",
  },
  GET_INVENTORIES_BY_ASSET: {
    path: "/inventories/asset/:asset",
    method: "GET",
  },
  CREATE_ASSET: {
    path: "/assets/create",
    method: "POST",
  },
  RESET_CREATE_ASSET: {
    path: "/assets/reset",
    method: "POST",
  },
  UPDATE_ASSET: {
    path: "/assets/update",
    method: "PUT",
  },
  DELETE_ASSET: {
    path: "/assets/delete",
    method: "DELETE",
  },
  GET_CATEGORIES: {
    path: "/categories",
    method: "GET",
  },
  CREATE_CATEGORY: {
    path: "/categories/create",
    method: "POST",
  },
  UPDATE_CATEGORY: {
    path: "/categories/update",
    method: "POST",
  },
  DELETE_CATEGORY: {
    path: "/categories/delete",
    method: "DELETE",
  },
  CHECK_SKU_KEY: {
    path: "/assets/check-skuKey/:skuKey",
    method: "GET",
  }
};
