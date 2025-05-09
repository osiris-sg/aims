/* eslint-disable @typescript-eslint/no-explicit-any */
/* --- STATE --- */
export interface AssetsState {
  assets: IpaginatedAssets;
  asset: Asset | null;
  categories: Category[];
  error: string | null;
  loading: boolean;
  deleteingAssetId: null | string;
  isDeleteInProgress: boolean;
  isAssetDeletionSucceeded: boolean;
  isAssetUpdating: boolean;
  isAssetCreationSucceeded: boolean;
  isAssetUpdateSucceeded: boolean;
  inventoriesByAsset: Inventory[] | null;
  statusCounts: Record<string, number>;
  isGetAssetLoading: boolean;
  isGetInventoriesLoading: boolean;
  isCategoriesLoading: boolean;
  isDeleteCategoryLoading: boolean;
  filters: Filters;
  isSkuKeyAvailable: boolean;
  isSkuCheckInProgress: boolean;
}

export interface Filters {
  status: string;
  category: string;
}
export interface Asset {
  id: string;
  name: string;
  skuKey: string;
  description: string | null;
  price: number | null;
  image: string | null;
  categoryId: string;
}
export interface Inventory {
  id: string;
  asset: Asset | string;
  location: string;
  status: string;
  quantity: number;
  sku: string;
  categoryId: string;
  createdAt: string;
  updatedAt: string;
}
export interface GetInventoriesByAssetPayload {
  asset: Asset | string;
  organizationId: string;
  token: string | null;
}
export interface AssetsAction {
  type: string;
  payload: any;
}

export interface GetAssetsPayload {
  page: number;
  limit: number;
  search: string;
  filters: any;
  organizationId: string;
  token: string | null;
}
export interface IpaginatedAssets {
  docs: Asset[];
  hasNextPage: boolean;
  hasPrevPage: boolean;
  limit: number;
  nextPage: number;
  totalDocuments: number;
  totalPagesCount: number;
}
export interface CreateAssetPayload {
  name: string;
  skuKey: string;
  description: string;
  image: string;
  categoryId: string;
  organizationId: string;
  token: string | null;
}
export interface UpdateAssetPayload {
  id: string;
  skuKey: string;
  name: string;
  description: string;
  price: number;
  image: string;
  categoryId: string;
  organizationId: string;
  token: string | null;
}
export interface DeleteAssetPayload {
  id: string;
  token: string | null;
}
export interface Category {
  id: string;
  name: string;
}
export interface GetCategoriesPayload {
  organizationId: string;
  token: string | null;
}
export interface CreateCategoryPayload {
  name: string;
  organizationId: string;
  token: string | null;
}
