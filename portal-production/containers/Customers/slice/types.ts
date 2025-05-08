/* eslint-disable @typescript-eslint/no-explicit-any */
export interface CustomerState {
  customers: IpaginatedCustomers;
  customer: Customer | null;
  isGetCustomerLoading: boolean;
  openDrawer: boolean;
  error: string | null;
  loading: boolean;
  deleteingCustomerId: null | string;
  isDeleteInProgress: boolean;
  isCustomerUpdating: boolean;
  isCustomerCreationSucceeded: boolean;
  filters: Filters;
}

export interface Filters {
  createdOn: {
    startDate: Date | null;
    endDate: Date | null;
  };
}

export interface Customer {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerAction {
  type: string;
  payload: any;
}

export interface IpaginatedCustomers {
  docs: Customer[];
  hasNextPage: boolean;
  hasPrevPage: boolean;
  limit: number;
  nextPage: number;
  totalDocuments: number;
  totalPagesCount: number;
}

export interface GetCustomersPayload {
  page: number;
  limit: number;
  search: string;
  filters: any;
  organizationId: string;
  token: string | null;
}

export interface CreateCustomerPayload {
  name: string;
  email: string;
  phone: string;
  address: string;
  organizationId: string;
  token: string | null;
}

export interface UpdateCustomerPayload {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  organizationId: string;
  token: string | null;
}

export interface DeleteCustomerPayload {
  id: string;
  token: string | null;
}
