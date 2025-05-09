/* eslint-disable @typescript-eslint/no-unused-vars */
import { PayloadAction } from "@reduxjs/toolkit";
import { createSlice } from "@reduxjs/toolkit";
import { Asset, AssetsState, CreateAssetPayload, GetAssetsPayload, IpaginatedAssets, UpdateAssetPayload, GetCategoriesPayload, Category, CreateCategoryPayload, DeleteAssetPayload, GetInventoriesByAssetPayload, Inventory, Filters } from "./types";

export const initialState: AssetsState = {
  assets: {
    docs: [],
    hasNextPage: false,
    hasPrevPage: false,
    limit: 0,
    nextPage: 0,
    totalDocuments: 0,
    totalPagesCount: 0,
  },
  asset: null,
  categories: [],
  error: null,
  loading: false,
  deleteingAssetId: null,
  isDeleteInProgress: false,
  isAssetUpdating: false,
  isAssetCreationSucceeded: false,
  isAssetUpdateSucceeded: false,
  inventoriesByAsset: null,
  statusCounts: { INSTOCK: 0, RENTAL: 0, RESERVED: 0, MAINTAINANCE: 0, SOLD: 0 },
  isGetAssetLoading: false,
  isGetInventoriesLoading: false,
  isCategoriesLoading: false,
  isDeleteCategoryLoading: false,
  filters: {
    status: "",
    category: "",
  },
  isSkuKeyAvailable: true,
  isSkuCheckInProgress: false,
};

export const assetsSlice = createSlice({
  name: "assets",
  initialState,
  reducers: {
    getAssets(state, action: PayloadAction<GetAssetsPayload>) {
      state.loading = true;
      state.isAssetCreationSucceeded = false;
      state.isAssetUpdateSucceeded = false;
      state.asset = null;
    },
    getAssetsSuccess(state, action: PayloadAction<IpaginatedAssets>) {
      state.loading = false;
      state.assets = action.payload;
    },
    getAssetsFailure(state, action: PayloadAction<string>) {
      state.loading = false;
      state.error = action.payload;
    },
    getAssetbySKUKEY(state, action: PayloadAction<{ skuKey: string; token: string }>) {
      state.isGetAssetLoading = true;
    },
    getAssetbySKUKEYSuccess(state, action: PayloadAction<Asset>) {
      state.isGetAssetLoading = false;
      state.asset = action.payload;
    },
    getAssetbySKUKEYFailure(state, action: PayloadAction<string>) {
      state.isGetAssetLoading = false;
      state.error = action.payload;
    },
    getInventoriesByAsset(state, action: PayloadAction<GetInventoriesByAssetPayload>) {
      state.isGetInventoriesLoading = true;
    },
    getInventoriesByAssetSuccess(state, action: PayloadAction<{ inventories: Inventory[]; statusCounts: Record<string, number> }>) {
      state.isGetInventoriesLoading = false;
      state.inventoriesByAsset = action.payload.inventories;
      state.statusCounts = action.payload.statusCounts; // Store status counts
    },
    getInventoriesByAssetFailure(state, action: PayloadAction<string>) {
      state.isGetInventoriesLoading = false;
      state.error = action.payload;
    },
    getAssetbyId(state, action: PayloadAction<{ id: string; token: string }>) {
      state.isGetAssetLoading = true;
    },
    getAssetbyIdSuccess(state, action: PayloadAction<Asset>) {
      state.isGetAssetLoading = false;
      state.asset = action.payload;
    },
    getAssetbyIdFailure(state, action: PayloadAction<string>) {
      state.isGetAssetLoading = false;
      state.error = action.payload;
    },
    createAsset(state, action: PayloadAction<CreateAssetPayload>) {
      state.isAssetUpdating = true;
    },
    createAssetSuccess(state, action: PayloadAction<Asset>) {
      state.isAssetUpdating = false;
      state.isAssetCreationSucceeded = true;
    },
    createAssetFailure(state, action: PayloadAction<string>) {
      state.isAssetUpdating = false;
      state.error = action.payload;
    },
    resetCreateAsset(state) {
      state.isAssetUpdating = false;
      state.error = null;
    },
    uploadImageStart(state) {
      state.isAssetUpdating = true;
    },
    uploadImageEnd(state) {
      state.isAssetUpdating = false;
    },
    updateAsset(state, action: PayloadAction<UpdateAssetPayload>) {
      state.isAssetUpdating = true;
    },
    updateAssetSuccess(state, action: PayloadAction<Asset>) {
      state.isAssetUpdating = false;
      state.isAssetUpdateSucceeded = true;
      state.assets.docs = state.assets.docs.map((asset) => (asset.id === action.payload.id ? action.payload : asset));
    },
    updateAssetFailure(state, action: PayloadAction<string>) {
      state.isAssetUpdating = false;
      state.error = action.payload;
    },
    setAssetToDelete(state, action: PayloadAction<string | null>) {
      state.deleteingAssetId = action.payload;
    },
    deleteAsset: (state, action: PayloadAction<DeleteAssetPayload>) => {
      state.isDeleteInProgress = true;
    },
    deleteAssetSuccess(state, action: PayloadAction<Asset>) {
      state.isDeleteInProgress = false;
      state.deleteingAssetId = null;
      state.isAssetDeletionSucceeded = true;
      state.assets.docs = state.assets.docs.filter((asset) => asset.id !== action.payload.id);
    },
    deleteAssetFailure(state, action: PayloadAction<string>) {
      state.isDeleteInProgress = false;
      state.error = action.payload;
    },
    resetDeleteError(state) {
      state.error = null;
    },

    getCategories(state, action: PayloadAction<GetCategoriesPayload>) {
      state.isCategoriesLoading = true;
    },
    getCategoriesSuccess(state, action: PayloadAction<Category[]>) {
      state.isCategoriesLoading = false;
      state.categories = action.payload;
    },
    getCategoriesFailure(state, action: PayloadAction<string>) {
      state.isCategoriesLoading = false;
      state.error = action.payload;
    },

    createCategory(state, action: PayloadAction<CreateCategoryPayload>) {
      state.isCategoriesLoading = true;
    },
    createCategorySuccess(state, action: PayloadAction<Category>) {
      state.isCategoriesLoading = false;
      state.categories.push(action.payload);
    },
    createCategoryFailure(state, action: PayloadAction<string>) {
      state.isCategoriesLoading = false;
      state.error = action.payload;
    },
    deleteCategory: (state, action: PayloadAction<{ id: string; token: string | null }>) => {
      state.isDeleteCategoryLoading = true;
    },
    deleteCategorySuccess(state, action: PayloadAction<Category>) {
      state.isDeleteCategoryLoading = false;
      state.categories = state.categories.filter((category) => category.id !== action.payload.id);
    },
    deleteCategoryFailure(state, action: PayloadAction<string>) {
      state.isDeleteCategoryLoading = false;
      state.error = action.payload;
    },
    updateFilters: (state, action: PayloadAction<Filters>) => {
      const { status, category } = action.payload;
      state.filters = { ...state.filters, status, category };
    },
    setIsSkuCheckInProgress(state, action: PayloadAction<boolean>) {
      state.isSkuCheckInProgress = action.payload;
    },
    checkSkuKey(state, action: PayloadAction<{ skuKey: string; token: string }>) {
      state.isSkuCheckInProgress = true;
    },
    checkSkuKeySuccess(state, action: PayloadAction<boolean>) {
      state.isSkuKeyAvailable = action.payload;
      state.isSkuCheckInProgress = false;
    },
    checkSkuKeyFailure(state, action: PayloadAction<string>) {
      state.isGetAssetLoading = false;
      state.isSkuCheckInProgress = false;
    },
  },
});

export const { actions: assetsActions } = assetsSlice;

export const useAssetsSlice = () => {
  return { actions: assetsSlice.actions };
};
