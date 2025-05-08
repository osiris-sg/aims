/* eslint-disable @typescript-eslint/no-unused-vars */
import { PayloadAction, createSlice } from "@reduxjs/toolkit";
import {
  InventoryState,
  GetInventoriesPayload,
  CreateInventoryPayload,
  UpdateInventoryPayload,
  DeleteInventoryPayload,
  IpaginatedInventories,
  Inventory,
  GenerateSkuRangePayload,
  CreateInventoryResponse,
  GetQRPayload,
  IpaginatedTimelineItems,
  GetTimelineItemsPayload,
  GetDocumentsPayload,
  IpaginatedDocuments,
  Filters,
  TimelineItem,
} from "./types";
import { Category, GetCategoriesPayload, IpaginatedAssets } from "@/containers/Assets/slice/types";
import { GetAssetsPayload } from "@/containers/Assets/slice/types";

export const initialState: InventoryState = {
  inventories: {
    docs: [],
    hasNextPage: false,
    hasPrevPage: false,
    limit: 0,
    nextPage: 0,
    totalDocuments: 0,
    totalPagesCount: 0,
  },
  inventory: null,
  openDrawer: false,
  error: null,
  loading: false,
  categories: [],
  assets: {
    docs: [],
    hasNextPage: false,
    hasPrevPage: false,
    limit: 0,
    nextPage: 0,
    totalDocuments: 0,
    totalPagesCount: 0,
  },
  deleteingInventoryId: null,
  isDeleteInProgress: false,
  isInventoryUpdating: false,
  isInventoryCreationSucceeded: false,
  skuRange: [],
  isSkuLoading: false,
  isGetInventoryLoading: false,
  isGetAssetLoading: false,
  isGetCategoriesLoading: false,
  qrCode: null,
  isQRLoading: false,
  openQRDialog: false,

  documents: {
    docs: [],
    hasNextPage: false,
    hasPrevPage: false,
    limit: 0,
    nextPage: 0,
    totalDocuments: 0,
    totalPagesCount: 0,
  },
  document: null,
  isGetDocumentsLoading: false,

  timelineItems: [],
  timelineItem: null,
  isGetTimelineItemsLoading: false,
  filters: {
    createdOn: {
      startDate: null,
      endDate: null,
    },
    status: "",
    category: "",
  },
};

export const inventorySlice = createSlice({
  name: "inventories",
  initialState,
  reducers: {
    setOpenDrawer: (state, action: PayloadAction<boolean>) => {
      state.openDrawer = action.payload;
    },
    setCloseDrawer: (state) => {
      state.openDrawer = false;
    },
    getInventories(state, action: PayloadAction<GetInventoriesPayload>) {
      state.loading = true;
    },
    getInventoriesSuccess(state, action: PayloadAction<IpaginatedInventories>) {
      state.loading = false;
      state.inventories = action.payload;
    },
    getInventoriesFailure(state, action: PayloadAction<string>) {
      state.loading = false;
      state.error = action.payload;
    },
    getInventorybySku(state, action: PayloadAction<{ sku: string; token: string }>) {
      state.isGetInventoryLoading = true;
    },
    getInventorybySkuSuccess(state, action: PayloadAction<Inventory>) {
      state.isGetInventoryLoading = false;
      state.inventory = action.payload;
    },
    getInventorybySkuFailure(state, action: PayloadAction<string>) {
      state.isGetInventoryLoading = false;
      state.error = action.payload;
    },
    createInventory(state, action: PayloadAction<CreateInventoryPayload>) {
      state.isInventoryCreationSucceeded = false;
      state.isInventoryUpdating = true;
    },
    createInventorySuccess(state, action: PayloadAction<CreateInventoryResponse>) {
      state.isInventoryCreationSucceeded = true;
      state.isInventoryUpdating = false;
      if (Array.isArray(action.payload.inventoryItems)) {
        state.inventories.docs.unshift(...action.payload.inventoryItems);
      } else {
        state.inventories.docs.unshift(action.payload.inventoryItems); // If it's a single item
      }
      state.openDrawer = false;
    },
    createInventoryFailure(state, action: PayloadAction<string>) {
      state.isInventoryCreationSucceeded = false;
      state.isInventoryUpdating = false;
      state.error = action.payload;
    },
    updateInventory(state, action: PayloadAction<UpdateInventoryPayload>) {
      state.isInventoryUpdating = true;
    },
    updateInventorySuccess(state, action: PayloadAction<Inventory>) {
      state.isInventoryUpdating = false;
      const index = state.inventories.docs.findIndex((inventory) => inventory.id === action.payload.id);
      if (index !== -1) {
        state.inventories.docs[index] = action.payload;
      }
    },
    updateInventoryFailure(state, action: PayloadAction<string>) {
      state.isInventoryUpdating = false;
      state.error = action.payload;
    },
    setInventoryToDelete(state, action: PayloadAction<string | null>) {
      state.deleteingInventoryId = action.payload;
    },
    deleteInventory: (state, action: PayloadAction<DeleteInventoryPayload>) => {
      state.isDeleteInProgress = true;
    },
    deleteInventorySuccess(state, action: PayloadAction<Inventory>) {
      state.isDeleteInProgress = false;
      state.deleteingInventoryId = null;
      state.inventories.docs = state.inventories.docs.filter((inventory) => inventory.id !== action.payload.id);
    },
    deleteInventoryFailure(state, action: PayloadAction<string>) {
      state.isDeleteInProgress = false;
      state.error = action.payload;
    },
    getAssets(state, action: PayloadAction<GetAssetsPayload>) {
      state.isGetAssetLoading = true;
    },
    getAssetsSuccess(state, action: PayloadAction<IpaginatedAssets>) {
      state.isGetAssetLoading = false;
      state.assets = action.payload;
    },
    getAssetsFailure(state, action: PayloadAction<string>) {
      state.isGetAssetLoading = false;
      state.error = action.payload;
    },
    getCategories(state, action: PayloadAction<GetCategoriesPayload>) {
      state.isGetCategoriesLoading = true;
    },
    getCategoriesSuccess(state, action: PayloadAction<Category[]>) {
      state.isGetCategoriesLoading = false;
      state.categories = action.payload;
    },
    getCategoriesFailure(state, action: PayloadAction<string>) {
      state.isGetCategoriesLoading = false;
      state.error = action.payload;
    },
    // Action to request SKU range generation
    generateSkuRange(state, action: PayloadAction<GenerateSkuRangePayload>) {
      state.isSkuLoading = true;
    },

    // Action on success of SKU generation
    generateSkuRangeSuccess(state, action: PayloadAction<string[]>) {
      state.isSkuLoading = false;
      state.skuRange = action.payload; // No need for an object
    },

    // Action on failure of SKU generation
    generateSkuRangeFailure(state, action: PayloadAction<string>) {
      state.isSkuLoading = false;
      state.error = action.payload;
    },
    getQRCode: (state, action: PayloadAction<GetQRPayload>) => {
      state.isQRLoading = true;
    },
    getQRCodeSuccess: (state, action: PayloadAction<{ qrCode: string }>) => {
      state.isQRLoading = false;
      state.qrCode = action.payload.qrCode;
    },
    getQRCodeFailure: (state, action: PayloadAction<string>) => {
      state.isQRLoading = false;
      state.error = action.payload;
    },
    openQRDialog: (state) => {
      state.openQRDialog = true;
    },
    closeQRDialog: (state) => {
      state.openQRDialog = false;
      state.qrCode = null;
    },

    getDocumentsByInventoryId(state, action: PayloadAction<GetDocumentsPayload>) {
      state.isGetDocumentsLoading = true;
    },
    getDocumentsByInventoryIdSuccess(state, action: PayloadAction<IpaginatedDocuments>) {
      state.isGetDocumentsLoading = false;
      state.documents = action.payload;
    },
    getDocumentsByInventoryIdFailure(state, action: PayloadAction<string>) {
      state.isGetDocumentsLoading = false;
      state.error = action.payload;
    },

    getTimelineItemsByInventoryId(state, action: PayloadAction<GetTimelineItemsPayload>) {
      state.isGetTimelineItemsLoading = true;
    },
    getTimelineItemsByInventoryIdSuccess(state, action: PayloadAction<TimelineItem[]>) {
      state.isGetTimelineItemsLoading = false;
      state.timelineItems = action.payload;
    },
    getTimelineItemsByInventoryIdFailure(state, action: PayloadAction<string>) {
      state.isGetTimelineItemsLoading = false;
      state.error = action.payload;
    },

    updateFilters: (state, action: PayloadAction<Filters>) => {
      const { status, category, createdOn } = action.payload;
      state.filters = { ...state.filters, status, category, createdOn };
    },
  },
});

export const { actions: inventoryActions } = inventorySlice;
export default inventorySlice.reducer;

export const useInventorySlice = () => {
  return { actions: inventorySlice.actions };
};
