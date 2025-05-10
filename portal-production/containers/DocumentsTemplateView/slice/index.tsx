/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { PayloadAction, createSlice } from "@reduxjs/toolkit";
import { IpaginatedAssets } from "@/containers/Assets/slice/types";
import { GetAssetsPayload } from "@/containers/Assets/slice/types";
import {
  CreateDocumentTemplatePayload,
  CreateDocumentWithTimelineSuccessPayload,
  DeleteDocumentTemplatePayload,
  Doc,
  DocumentTemplate,
  DocumentTemplateState,
  GetCustomersPayload,
  GetDocumentTemplatesPayload,
  GetInventoriesByStatusPayload,
  GetInventoriesPayload,
  Inventory,
  IpaginatedCustomers,
  IpaginatedDocumentTemplates,
  UpdateDocumentSuccessPayload,
  UpdateDocumentTemplatePayload,
} from "./types";
import { IpaginatedInventories } from "@/containers/Inventory/slice/types";

export const initialState: DocumentTemplateState = {
  documentTemplates: {
    docs: [],
    hasNextPage: false,
    hasPrevPage: false,
    limit: 0,
    nextPage: 0,
    totalDocuments: 0,
    totalPagesCount: 0,
  },
  documentTemplate: null,
  error: null,
  loading: false,
  assets: {
    docs: [],
    hasNextPage: false,
    hasPrevPage: false,
    limit: 0,
    nextPage: 0,
    totalDocuments: 0,
    totalPagesCount: 0,
  },
  isGetAssetLoading: false,
  isGetDocumentTemplateLoading: false,
  isDocumentTemplateCreationSucceeded: false,
  isDocumentTemplateUpdating: false,
  customers: {
    docs: [],
    hasNextPage: false,
    hasPrevPage: false,
    limit: 0,
    nextPage: 0,
    totalDocuments: 0,
    totalPagesCount: 0,
  },
  isGetCustomersLoading: false,
  deleteingDocumentTemplateId: null,
  isDeleteInProgress: false,
  documentInventories: [],

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
  isDocumentCreationSucceeded: false,
  isDocumentUpdating: false,
  isGetDocumentLoading: false,
};

export const documentTemplateSlice = createSlice({
  name: "documentTemplates",
  initialState,
  reducers: {
    getDocumentTemplates(state, action: PayloadAction<GetDocumentTemplatesPayload>) {
      state.loading = true;
      state.isDocumentCreationSucceeded = false;
    },
    getDocumentTemplatesSuccess(state, action: PayloadAction<IpaginatedDocumentTemplates>) {
      state.loading = false;
      state.documentTemplates = action.payload;
    },
    getDocumentTemplatesFailure(state, action: PayloadAction<string>) {
      state.loading = false;
      state.error = action.payload;
    },
    getDocumentTemplatebyId(state, action: PayloadAction<{ id: string; token: string }>) {
      state.isGetDocumentTemplateLoading = true;
    },
    getDocumentTemplatebyIdSuccess(state, action: PayloadAction<DocumentTemplate>) {
      state.isGetDocumentTemplateLoading = false;
      state.documentTemplate = action.payload;
    },
    getDocumentTemplatebyIdFailure(state, action: PayloadAction<string>) {
      state.isGetDocumentTemplateLoading = false;
      state.error = action.payload;
    },
    createDocumentTemplate(state, action: PayloadAction<CreateDocumentTemplatePayload>) {
      state.isDocumentTemplateUpdating = true;
      state.isDocumentTemplateCreationSucceeded = false;
    },
    createDocumentTemplateSuccess(state, action: PayloadAction<DocumentTemplate>) {
      state.isDocumentTemplateUpdating = false;
      state.isDocumentTemplateCreationSucceeded = true;
    },
    createDocumentTemplateFailure(state, action: PayloadAction<string>) {
      state.isDocumentTemplateUpdating = false;
      state.error = action.payload;
    },
    updateDocumentTemplate(state, action: PayloadAction<UpdateDocumentTemplatePayload>) {
      state.isDocumentTemplateUpdating = true;
    },
    updateDocumentTemplateSuccess(state, action: PayloadAction<DocumentTemplate>) {
      state.isDocumentTemplateUpdating = false;
      state.documentTemplate = action.payload;
    },
    updateDocumentTemplateFailure(state, action: PayloadAction<string>) {
      state.isDocumentTemplateUpdating = false;
      state.error = action.payload;
    },
    setDocumentTemplateToDelete(state, action: PayloadAction<string | null>) {
      state.deleteingDocumentTemplateId = action.payload;
    },
    deleteDocumentTemplate: (state, action: PayloadAction<DeleteDocumentTemplatePayload>) => {
      state.isDeleteInProgress = true;
    },
    deleteDocumentTemplateSuccess(state, action: PayloadAction<DocumentTemplate>) {
      state.isDeleteInProgress = false;
      state.deleteingDocumentTemplateId = null;
      state.documentTemplates.docs = state.documentTemplates.docs.filter((documentTemplate) => documentTemplate.id !== action.payload.id);
    },
    deleteDocumentTemplateFailure(state, action: PayloadAction<string>) {
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
    getCustomers(state, action: PayloadAction<GetCustomersPayload>) {
      state.isGetCustomersLoading = true;
    },
    getCustomersSuccess(state, action: PayloadAction<IpaginatedCustomers>) {
      state.isGetCustomersLoading = false;
      state.customers = action.payload;
    },
    getCustomersFailure(state, action: PayloadAction<string>) {
      state.isGetCustomersLoading = false;
      state.error = action.payload;
    },

    getDocumentInventories(state, action: PayloadAction<GetInventoriesByStatusPayload>) {
      state.loading = true;
    },
    getDocumentInventoriesSuccess(state, action: PayloadAction<Inventory[]>) {
      state.loading = false;
      state.documentInventories = action.payload;
    },
    getDocumentInventoriesFailure(state, action: PayloadAction<string>) {
      state.loading = false;
      state.error = action.payload;
    },

    uploadImageStart(state) {
      state.isDocumentUpdating = true;
    },
    uploadImageEnd(state) {
      state.isDocumentUpdating = false;
    },

    createDocumentWithTimeline(state, action: PayloadAction<any>) {
      state.isDocumentCreationSucceeded = false;
      state.isDocumentUpdating = true;
    },
    createDocumentWithTimelineSuccess(state, action: PayloadAction<CreateDocumentWithTimelineSuccessPayload>) {
      state.isDocumentCreationSucceeded = true;
      state.isDocumentUpdating = false;
    },
    createDocumentWithTimelineFailure(state, action: PayloadAction<string>) {
      state.isDocumentUpdating = false;
      state.error = action.payload;
    },
    getDocumentbyId(state, action: PayloadAction<{ id: string; token: string }>) {
      state.isGetDocumentLoading = true;
    },
    getDocumentbyIdSuccess(state, action: PayloadAction<Doc>) {
      state.isGetDocumentLoading = false;
      state.document = action.payload;
    },
    getDocumentbyIdFailure(state, action: PayloadAction<string>) {
      state.isGetDocumentLoading = false;
      state.error = action.payload;
    },
    updateDocument(state, action: PayloadAction<any>) {
      state.isDocumentUpdating = true;
    },
    updateDocumentSuccess(state, action: PayloadAction<UpdateDocumentSuccessPayload>) {
      state.isDocumentUpdating = false;
      state.document = action.payload;
    },
    updateDocumentFailure(state, action: PayloadAction<string>) {
      state.isDocumentUpdating = false;
      state.error = action.payload;
    },
    getInventoriesByIds(state, action: PayloadAction<{ inventoryIds: string[]; token: string }>) {
      state.loading = true;
    },
  },
});

export const { actions: documentTemplateActions } = documentTemplateSlice;
export default documentTemplateSlice.reducer;

export const useDocumentTemplateSlice = () => {
  return { actions: documentTemplateSlice.actions };
};
