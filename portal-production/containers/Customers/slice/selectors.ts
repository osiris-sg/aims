import { initialState } from ".";
import { RootState } from "../../../root-saga/root-state";
import { createSelector } from "@reduxjs/toolkit";

const selectSlice = (state: RootState) => state.customers || initialState;

export const selectOpenDrawer = createSelector([selectSlice], (state) => state.openDrawer);

export const selectCustomers = createSelector([selectSlice], (state) => state.customers);
export const selectCustomer = createSelector([selectSlice], (state) => state.customer);
export const selectIsGetCustomerLoading = createSelector([selectSlice], (state) => state.isGetCustomerLoading);
export const selectCustomersLoading = createSelector([selectSlice], (state) => state.loading);

export const selectCustomersError = createSelector([selectSlice], (state) => state.error);

export const selectCustomerCreateSuccess = createSelector([selectSlice], (state) => state.customers.docs);

export const selectCustomerCreateLoading = createSelector([selectSlice], (state) => state.loading);

export const selectCustomerCreateError = createSelector([selectSlice], (state) => state.error);

export const selectIsCustomerCreationSucceeded = createSelector([selectSlice], (state) => state.isCustomerCreationSucceeded);

export const selectIsCustomerUpdating = createSelector([selectSlice], (state) => state.isCustomerUpdating);

export const selectIsCustomerDeleteInProgress = createSelector([selectSlice], (state) => state.isDeleteInProgress);

export const selectDeleteingCustomerId = createSelector([selectSlice], (state) => state.deleteingCustomerId);
export const selectFilters = createSelector([selectSlice], (state) => state.filters);
