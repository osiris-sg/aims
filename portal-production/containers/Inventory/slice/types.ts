import { IpaginatedAssets, Asset, Category } from "@/containers/Assets/slice/types";

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface InventoryState {
  inventories: IpaginatedInventories;
  inventory: Inventory | null;
  openDrawer: boolean;
  error: string | null;
  loading: boolean;
  assets: IpaginatedAssets;
  categories: Category[];
  deleteingInventoryId: null | string;
  isDeleteInProgress: boolean;
  isDeletionSucceeded: boolean;
  isInventoryUpdating: boolean;
  isInventoryCreationSucceeded: boolean;
  skuRange: string[];
  isSkuLoading: boolean;
  isGetInventoryLoading: boolean;
  isGetAssetLoading: boolean;
  isGetCategoriesLoading: boolean;
  qrCode: string | null;
  isQRLoading: boolean;
  openQRDialog: boolean;

  documents: IpaginatedDocuments;
  document: Doc | null;
  isGetDocumentsLoading: boolean;

  timelineItems: TimelineItem[];
  timelineItem: TimelineItem | null;
  isGetTimelineItemsLoading: boolean;
  filters: Filters;
}

export interface Filters {
  createdOn: {
    startDate: Date | null;
    endDate: Date | null;
  };
  status: string;
  category: string;
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

export interface InventoryAction {
  type: string;
  payload: any;
}

export interface IpaginatedInventories {
  docs: Inventory[];
  hasNextPage: boolean;
  hasPrevPage: boolean;
  limit: number;
  nextPage: number;
  totalDocuments: number;
  totalPagesCount: number;
}

export interface GetInventoriesPayload {
  page: number;
  limit: number;
  search: string;
  filters: any;
  organizationId: string;
  token: string | null;
}

export interface CreateInventoryPayload {
  assetId: string;
  location: string;
  status: string;
  quantity: number;
  organizationId: string;
  token: string | null;
  sku: string;
  category: string;
}

export interface CreateInventoryResponse {
  inventoryItems: Inventory;
  message: string;
}

export interface UpdateInventoryPayload {
  id: string;
  assetId: Asset | string;
  location: string;
  status: string;
  quantity: number;
  organizationId: string;
  token: string | null;
}

export interface DeleteInventoryPayload {
  id: string;
  token: string | null;
}

export interface GenerateSkuRangePayload {
  assetId: string;
  quantity: number;
  token: string | null;
}

export interface GetQRPayload {
  sku: string;
  token: string | null;
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

export interface Doc {
  id: string;
  organization?: any;

  templateData: any;
  inventoryId: string;
  createdAt: string;
  updatedAt: string;
}

export interface TimelineItem {
  id: string;
  message: string;
  pdfUrl: string;
  inventoryId: string;
  createdAt: string;
  updatedAt: string;
}
export interface GetDocumentsPayload {
  inventoryId: string;
  token: string | null;
}

export interface GetTimelineItemsPayload {
  inventoryId: string;
  token: string | null;
}
