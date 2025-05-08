/* eslint-disable @typescript-eslint/no-unused-vars */
import { PayloadAction, createSlice } from "@reduxjs/toolkit";
import { CustomerState, GetCustomersPayload, CreateCustomerPayload, UpdateCustomerPayload, DeleteCustomerPayload, IpaginatedCustomers, Customer, Filters } from "./types";

export const initialState: CustomerState = {
  customers: {
    docs: [],
    hasNextPage: false,
    hasPrevPage: false,
    limit: 0,
    nextPage: 0,
    totalDocuments: 0,
    totalPagesCount: 0,
  },
  customer: null,
  isGetCustomerLoading: false,
  openDrawer: false,
  error: null,
  loading: false,
  deleteingCustomerId: null,
  isDeleteInProgress: false,
  isCustomerUpdating: false,
  isCustomerCreationSucceeded: false,
  filters: {
    createdOn: {
      startDate: null,
      endDate: null,
    },
  },
};

export const customersSlice = createSlice({
  name: "customers",
  initialState,
  reducers: {
    setOpenDrawer: (state, action: PayloadAction<boolean>) => {
      state.openDrawer = action.payload;
    },
    setCloseDrawer: (state) => {
      state.openDrawer = false;
    },
    getCustomers(state, action: PayloadAction<GetCustomersPayload>) {
      state.loading = true;
    },
    getCustomersSuccess(state, action: PayloadAction<IpaginatedCustomers>) {
      state.loading = false;
      state.customers = action.payload;
    },
    getCustomersFailure(state, action: PayloadAction<string>) {
      state.loading = false;
      state.error = action.payload;
    },
    createCustomer(state, action: PayloadAction<CreateCustomerPayload>) {
      state.isCustomerCreationSucceeded = false;
      state.isCustomerUpdating = true;
    },
    getCustomerById(state, action: PayloadAction<{ id: string; token: string }>) {
      state.isGetCustomerLoading = true;
    },
    getCustomerByIdSuccess(state, action: PayloadAction<Customer>) {
      state.isGetCustomerLoading = false;
      state.customer = action.payload;
    },
    getCustomerByIdFailure(state, action: PayloadAction<string>) {
      state.isGetCustomerLoading = false;
      state.error = action.payload;
    },
    createCustomerSuccess(state, action: PayloadAction<Customer>) {
      state.isCustomerCreationSucceeded = true;
      state.isCustomerUpdating = false;
      state.customers.docs.unshift(action.payload);
      state.openDrawer = false;
    },
    createCustomerFailure(state, action: PayloadAction<string>) {
      state.isCustomerCreationSucceeded = false;
      state.isCustomerUpdating = false;
      state.error = action.payload;
    },
    updateCustomer(state, action: PayloadAction<UpdateCustomerPayload>) {
      state.isCustomerUpdating = true;
    },
    updateCustomerSuccess(state, action: PayloadAction<Customer>) {
      state.isCustomerUpdating = false;
      const index = state.customers.docs.findIndex((customer) => customer.id === action.payload.id);
      if (index !== -1) {
        state.customers.docs[index] = action.payload;
      }
    },
    updateCustomerFailure(state, action: PayloadAction<string>) {
      state.isCustomerUpdating = false;
      state.error = action.payload;
    },
    setCustomerToDelete(state, action: PayloadAction<string | null>) {
      state.deleteingCustomerId = action.payload;
    },
    deleteCustomer: (state, action: PayloadAction<DeleteCustomerPayload>) => {
      state.isDeleteInProgress = true;
    },
    deleteCustomerSuccess(state, action: PayloadAction<Customer>) {
      state.isDeleteInProgress = false;
      state.deleteingCustomerId = null;
      state.customers.docs = state.customers.docs.filter((customer) => customer.id !== action.payload.id);
    },
    deleteCustomerFailure(state, action: PayloadAction<string>) {
      state.isDeleteInProgress = false;
      state.error = action.payload;
    },
    updateFilters: (state, action: PayloadAction<Filters>) => {
      const { createdOn } = action.payload;
      state.filters = { ...state.filters, createdOn };
    },
  },
});

export const { actions: customerActions } = customersSlice;
export default customersSlice.reducer;

export const useCustomerSlice = () => {
  return { actions: customersSlice.actions };
};
