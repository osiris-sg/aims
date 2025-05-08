import { initialState } from ".";
import { RootState } from "../../../root-saga/root-state";
import { createSelector } from "@reduxjs/toolkit";

const selectSlice = (state: RootState) => state.documentTemplates || initialState;

export const selectDocumentTemplates = createSelector([selectSlice], (state) => state.documentTemplates);
export const selectDocumentTemplatesLoading = createSelector([selectSlice], (state) => state.loading);
export const selectDocumentTemplatesError = createSelector([selectSlice], (state) => state.error);

export const selectDocumentTemplate = createSelector([selectSlice], (state) => state.documentTemplate);
export const selectIsGetDocumentTemplateLoading = createSelector([selectSlice], (state) => state.isGetDocumentTemplateLoading);

export const selectDocumentTemplateCreateSuccess = createSelector([selectSlice], (state) => state.documentTemplates.docs);
export const selectIsDocumentTemplateUpdating = createSelector([selectSlice], (state) => state.isDocumentTemplateUpdating);

export const selectIsDocumentTemplateDeleteInProgress = createSelector([selectSlice], (state) => state.isDeleteInProgress);

export const selectDeleteingDocumentTemplateId = createSelector([selectSlice], (state) => state.deleteingDocumentTemplateId);

export const selectAssets = createSelector([selectSlice], (state) => state.assets);
export const selectIsGetAssetLoading = createSelector([selectSlice], (state) => state.isGetAssetLoading);

export const selectCustomers = createSelector([selectSlice], (state) => state.customers);
export const selectIsGetCustomersLoading = createSelector([selectSlice], (state) => state.isGetCustomersLoading);

export const selectInventoriesForDocument = createSelector([selectSlice], (state) => state.documentInventories);
export const selectDocumentTemplateCreationStatus = createSelector([selectSlice], (state) => state.isDocumentTemplateCreationSucceeded);
export const selectIsDocumentUpdating = createSelector([selectSlice], (state) => state.isDocumentUpdating);
export const selectDocumentCeationStatus = createSelector([selectSlice], (state) => state.isDocumentCreationSucceeded);
export const selectDocument = createSelector([selectSlice], (state) => state.document);
