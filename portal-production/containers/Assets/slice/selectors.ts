import { createSelector } from "@reduxjs/toolkit";
import { initialState } from ".";
import { RootState } from "../../../root-saga/root-state";
const selectSlice = (state: RootState) => state.assets || initialState;
export const selectAssets = createSelector([selectSlice], (state) => state.assets);
export const selectAsset = createSelector([selectSlice], (state) => state.asset);
export const selectInventoriesByAsset = createSelector([selectSlice], (state) => state.inventoriesByAsset);
export const selectStatusCounts = createSelector([selectSlice], (state) => state.statusCounts);
export const selectAssetsLoading = createSelector([selectSlice], (state) => state.loading);
export const selectDeleteingAssetId = createSelector([selectSlice], (state) => state.deleteingAssetId);
export const selectIsDeleteInProgress = createSelector([selectSlice], (state) => state.isDeleteInProgress);
export const selectAssetsError = createSelector([selectSlice], (state) => state.error);
export const selectAssetsCreateSuccess = createSelector([selectSlice], (state) => state.assets.docs);
export const selectAssetsCreateLoading = createSelector([selectSlice], (state) => state.loading);
export const selectAssetsCreateError = createSelector([selectSlice], (state) => state.error);

export const selectIsAssetCreationSucceeded = createSelector([selectSlice], (state) => state.isAssetCreationSucceeded);
export const selectIsAssetUpdateSucceeded = createSelector([selectSlice], (state) => state.isAssetUpdateSucceeded);
export const selectIsAssetUpdating = createSelector([selectSlice], (state) => state.isAssetUpdating);

export const selectCategories = createSelector([selectSlice], (state) => state.categories);
export const selectCategoriesLoading = createSelector([selectSlice], (state) => state.isCategoriesLoading);
export const selectCategoriesError = createSelector([selectSlice], (state) => state.error);
export const selectIsGetAssetLoading = createSelector([selectSlice], (state) => state.isGetAssetLoading);
export const selectIsGetInventoriesLoading = createSelector([selectSlice], (state) => state.isGetInventoriesLoading);
export const selectIsDeleteCategoryLoading = createSelector([selectSlice], (state) => state.isDeleteCategoryLoading);
export const selectFilters = createSelector([selectSlice], (state) => state.filters);

export const selectIsSkuKeyAvailable = createSelector([selectSlice], (state) => state.isSkuKeyAvailable);
export const selectIsSkuCheckInProgress = createSelector([selectSlice], (state) => state.isSkuCheckInProgress);
