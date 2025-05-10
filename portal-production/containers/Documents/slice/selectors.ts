import { initialState } from ".";
import { RootState } from "../../../root-saga/root-state";
import { createSelector } from "@reduxjs/toolkit";

const selectSlice = (state: RootState) => state.inventories || initialState;

export const selectOpenDrawer = createSelector([selectSlice], (state) => state.openDrawer);

export const selectInventories = createSelector([selectSlice], (state) => state.inventories);

export const selectInventoriesLoading = createSelector([selectSlice], (state) => state.loading);

export const selectInventoriesError = createSelector([selectSlice], (state) => state.error);

export const selectInventory = createSelector([selectSlice], (state) => state.inventory);

export const selectInventoryCreateSuccess = createSelector([selectSlice], (state) => state.inventories.docs);

export const selectInventoryCreateLoading = createSelector([selectSlice], (state) => state.loading);

export const selectInventoryCreateError = createSelector([selectSlice], (state) => state.error);

export const selectIsInventoryCreationSucceeded = createSelector([selectSlice], (state) => state.isInventoryCreationSucceeded);

export const selectIsInventoryUpdating = createSelector([selectSlice], (state) => state.isInventoryUpdating);

export const selectIsInventoryDeleteInProgress = createSelector([selectSlice], (state) => state.isDeleteInProgress);
export const selectIsInventoryDeletionSucceeded = createSelector([selectSlice], (state) => state.isDeletionSucceeded);

export const selectDeleteingInventoryId = createSelector([selectSlice], (state) => state.deleteingInventoryId);

export const selectAssets = createSelector([selectSlice], (state) => state.assets);
export const selectCategories = createSelector([selectSlice], (state) => state.categories);

export const selectSkuRange = createSelector([selectSlice], (state) => state.skuRange);
export const selectIsSkuloading = createSelector([selectSlice], (state) => state.isSkuLoading);
export const selectIsGetInventoryLoading = createSelector([selectSlice], (state) => state.isGetInventoryLoading);
export const selectIsGetAssetLoading = createSelector([selectSlice], (state) => state.isGetAssetLoading);
export const selectIsGetCategoriesLoading = createSelector([selectSlice], (state) => state.isGetCategoriesLoading);

export const selectOpenQRDialog = createSelector([selectSlice], (state) => state.openQRDialog);
export const selectIsQRLoading = createSelector([selectSlice], (state) => state.isQRLoading);
export const selectQRCode = createSelector([selectSlice], (state) => state.qrCode);

export const selectDocuments = createSelector([selectSlice], (state) => state.documents);
export const selectIsGetDocumentsLoading = createSelector([selectSlice], (state) => state.isGetDocumentsLoading);
export const selectTimelineItems = createSelector([selectSlice], (state) => state.timelineItems);

export const selectFilters = createSelector([selectSlice], (state) => state.filters);
export const selectIsGetTimelineItemsLoading = createSelector([selectSlice], (state) => state.isGetTimelineItemsLoading);
