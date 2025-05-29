import { IpaginatedAssets } from "@/containers/Assets/slice/types";
/* eslint-disable @typescript-eslint/no-explicit-any */
export interface DocumentTemplateState {
  documentTemplates: IpaginatedDocumentTemplates;
  documentTemplate: DocumentTemplate | null;
  error: string | null;
  loading: boolean;
  assets: IpaginatedAssets;
  isGetAssetLoading: boolean;
  isGetDocumentTemplateLoading: boolean;
  isDocumentTemplateCreationSucceeded: boolean;
  isDocumentTemplateUpdating: boolean;
  customers: IpaginatedCustomers;
  isGetCustomersLoading: boolean;
  deleteingDocumentTemplateId: null | string;
  isDeleteInProgress: boolean;
  documentInventories: Inventory[];
  documents: IpaginatedDocuments;
  document: Doc | null;
  isDocumentCreationSucceeded: boolean;
  isDocumentUpdating: boolean;
  isGetDocumentLoading: boolean;
}

export interface DocumentItem {
  item: string;
  description: string;
  quantity: string;
}

export interface DocumentTemplateAction {
  type: string;
  payload: any;
}

export interface IpaginatedDocumentTemplates {
  docs: DocumentTemplate[];
  hasNextPage: boolean;
  hasPrevPage: boolean;
  limit: number;
  nextPage: number;
  totalDocuments: number;
  totalPagesCount: number;
}

export interface IpaginatedDocuments {
  docs: Doc[];
  hasNextPage: boolean;
  hasPrevPage: boolean;
  limit: number;
  nextPage: number;
  totalDocuments: number;
  totalPagesCount: number;
}

export interface IpaginatedTimelineItems {
  docs: TimelineItem[];
  hasNextPage: boolean;
  hasPrevPage: boolean;
  limit: number;
  nextPage: number;
  totalDocuments: number;
  totalPagesCount: number;
}
export interface GetDocumentTemplatesPayload {
  page: number;
  limit: number;
  search: string;
  filters: any;
  organizationId: string;
  token: string | null;
}

export interface GetDocumentsPayload {
  page: number;
  limit: number;
  search: string;
  filters: any;
  organizationId: string;
  token: string | null;
}

export interface GetTimelineItemsPayload {
  page: number;
  limit: number;
  search: string;
  filters: any;
  organizationId: string;
  token: string | null;
}

export interface VisibilityField {
  value: string;
  isVisible: boolean;
}

export interface DocumentTemplate {
  id: string;
  name: string;
  type: string;
  organizationId: string;
  config: object;
  createdAt: string;
  updatedAt: string;
}

export interface Doc {
  id: string;
  templateData: any;
  inventoryId: string;
  createdAt: string;
  updatedAt: string;
  config?: any;
  type: string;
}

export interface TimelineItem {
  id: string;
  message: string;
  pdfUrl: string;
  inventoryId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTimelineItemPayload {
  message: string;
  pdfUrl: string;
  inventoryId: string;
}
export interface CreateDocumentPayload {
  templateData: any;
  inventoryId: string;
}
export interface CreateDocumentTemplatePayload extends Omit<DocumentTemplate, "id" | "createdAt" | "updatedAt"> {
  token: string | null;
}

export interface UpdateDocumentTemplatePayload extends DocumentTemplate {
  token: string | null;
}

export interface DeleteDocumentTemplatePayload {
  id: string;
  token: string | null;
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

export interface Customer {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  createdAt: string;
  updatedAt: string;
}
export interface GetCustomersPayload {
  page: number;
  limit: number;
  search: string;
  filters: any;
  organizationId: string;
  token: string | null;
}

export interface Inventory {
  id: string;
  assetId: string;
  location: string;
  status: string;
  quantity: number;
  sku: string;
  category: string;
  createdAt: string;
  updatedAt: string;
}

export interface GetInventoriesPayload {
  organizationId: string;
  token: string | null;
}

export interface GetInventoriesByStatusPayload {
  token: string | null;
  status: string;
}
export interface CreateDocumentWithTimelineSuccessPayload {
  document: Doc;
  timeline: TimelineItem;
}
export interface UpdateDocumentSuccessPayload extends Doc {
  token: string | null;
}
