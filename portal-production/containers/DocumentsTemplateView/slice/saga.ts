import { call, put, takeLatest } from "redux-saga/effects";
import { request } from "@/helpers/request";
import { Response } from "@/containers/portal/types";
import { documentTemplateActions } from "./index";
import { DocumentTemplateAction } from "./types";
import { API } from "./constants";
import { notificationsActions } from "@/containers/Notifications/slice";

export function* getDocumentTemplatesGenerator({ payload: data }: DocumentTemplateAction) {
  try {
    const token = data.token;
    delete data.token;

    const response: Response = yield call(request, API.GET_DOCUMENT_TEMPLATES, data, token);
    if (response.success) {
      yield put(documentTemplateActions.getDocumentTemplatesSuccess(response.data));
    } else {
      yield put(documentTemplateActions.getDocumentTemplatesFailure(response.message));
    }
  } catch {
    yield put(documentTemplateActions.getDocumentTemplatesFailure("client Error"));
  }
}

export function* getDocumentTemplatebyIdGenerator({ payload: data }: DocumentTemplateAction) {
  try {
    const token = data.token;
    delete data.token;

    const response: Response = yield call(request, API.GET_DOCUMENT_TEMPLATE_BY_ID, data, token);
    if (response.success) {
      yield put(documentTemplateActions.getDocumentTemplatebyIdSuccess(response.data));
    } else {
      yield put(documentTemplateActions.getDocumentTemplatebyIdFailure(response.message));
    }
  } catch {
    yield put(documentTemplateActions.getDocumentTemplatebyIdFailure("client Error"));
  }
}

export function* getDocumentbyIdGenerator({ payload: data }: DocumentTemplateAction) {
  try {
    const token = data.token;
    delete data.token;

    const response: Response = yield call(request, API.GET_DOCUMENT_BY_ID, data, token);
    if (response.success) {
      yield put(documentTemplateActions.getDocumentbyIdSuccess(response.data));
    } else {
      yield put(documentTemplateActions.getDocumentbyIdFailure(response.message));
    }
  } catch {
    yield put(documentTemplateActions.getDocumentbyIdFailure("client Error"));
  }
}

export function* createDocumentTemplateGenerator({ payload: data }: DocumentTemplateAction) {
  try {
    const token = data.token;
    delete data.token;

    const response: Response = yield call(request, API.CREATE_DOCUMENT_TEMPLATE, data, token);
    if (response.success) {
      yield put(documentTemplateActions.createDocumentTemplateSuccess(response.data));
    } else {
      yield put(documentTemplateActions.createDocumentTemplateFailure(response.message));
    }
  } catch {
    yield put(documentTemplateActions.createDocumentTemplateFailure("client Error"));
  }
}

export function* updateDocumentTemplateGenerator({ payload: data }: DocumentTemplateAction) {
  try {
    const token = data.token;
    delete data.token;

    const response: Response = yield call(request, API.UPDATE_DOCUMENT_TEMPLATE, data, token);
    if (response.success) {
      yield put(documentTemplateActions.updateDocumentTemplateSuccess(response.data));
      yield put(notificationsActions.setNotification({ message: "Updated", type: "success" }));
    } else {
      yield put(documentTemplateActions.updateDocumentTemplateFailure(response.message));
    }
  } catch {
    yield put(documentTemplateActions.updateDocumentTemplateFailure("client Error"));
  }
}

export function* deleteDocumentTemplateGenerator({ payload: data }: DocumentTemplateAction) {
  try {
    const token = data.token;
    delete data.token;

    const response: Response = yield call(request, API.DELETE_DOCUMENT_TEMPLATE, data, token);
    if (response.success) {
      yield put(documentTemplateActions.deleteDocumentTemplateSuccess(response.data));
    } else {
      yield put(documentTemplateActions.deleteDocumentTemplateFailure(response.message));
    }
  } catch {
    yield put(documentTemplateActions.deleteDocumentTemplateFailure("client Error"));
  }
}

export function* getAssetsGenerator({ payload: data }: DocumentTemplateAction) {
  try {
    const token = data.token;
    delete data.token;

    const response: Response = yield call(request, API.GET_ASSETS, data, token);
    if (response.success) {
      yield put(documentTemplateActions.getAssetsSuccess(response.data));
    } else {
      yield put(documentTemplateActions.getAssetsFailure(response.message));
    }
  } catch {
    yield put(documentTemplateActions.getAssetsFailure("client Error"));
  }
}

export function* getCustomersGenerator({ payload: data }: DocumentTemplateAction) {
  try {
    const token = data.token;
    delete data.token;

    const response: Response = yield call(request, API.GET_CUSTOMERS, data, token);
    if (response.success) {
      yield put(documentTemplateActions.getCustomersSuccess(response.data));
    } else {
      yield put(documentTemplateActions.getCustomersFailure(response.message));
    }
  } catch {
    yield put(documentTemplateActions.getCustomersFailure("client Error"));
  }
}

export function* getDocumentInventoriesGenerator({ payload: data }: DocumentTemplateAction) {
  try {
    const token = data.token;
    delete data.token;

    const response: Response = yield call(request, API.GET_DOCUMENT_INVENTORY, data, token);
    if (response.success) {
      console.log("getDocumentInventoriesGenerator response", response);
      yield put(documentTemplateActions.getDocumentInventoriesSuccess(response.data));
    } else {
      yield put(documentTemplateActions.getDocumentInventoriesFailure(response.message));
    }
  } catch {
    yield put(documentTemplateActions.getDocumentInventoriesFailure("client Error"));
  }
}

export function* createDocumentWithTimelineGenerator({ payload: data }: DocumentTemplateAction) {
  try {
    const token = data.token;
    const organizationId = data.organizationId;
    const status = data.status;
    delete data.token;

    const response: Response = yield call(request, API.CREATE_DOCUMENT_WITH_TIMELINE, data, token);
    if (response.success) {
      yield put(documentTemplateActions.createDocumentWithTimelineSuccess(response.data));
      yield put(notificationsActions.setNotification({ message: "Document is assigned to inventories", type: "success" }));
      yield put(documentTemplateActions.getDocumentInventories({ organizationId, token, status }));
    } else {
      yield put(documentTemplateActions.createDocumentWithTimelineFailure(response.message));
      yield put(notificationsActions.setNotification({ message: response.message || "Document creation failed", type: "error" }));
    }
  } catch (error: any) {
    const errorMessage = error?.message || "client Error";
    yield put(documentTemplateActions.createDocumentWithTimelineFailure(errorMessage));
    yield put(notificationsActions.setNotification({ message: errorMessage, type: "error" }));
  }
}

export function* updateDocumentGenerator({ payload: data }: DocumentTemplateAction) {
  try {
    const token = data.token;
    delete data.token;

    const response: Response = yield call(request, API.UPDATE_DOCUMENT, data, token);
    if (response.success) {
      yield put(documentTemplateActions.updateDocumentSuccess(response.data));
      yield put(notificationsActions.setNotification({ message: "Updated", type: "success" }));
    } else {
      yield put(documentTemplateActions.updateDocumentFailure(response.message));
      yield put(notificationsActions.setNotification({ message: response.message || "Update failed", type: "error" }));
    }
  } catch (error: any) {
    const errorMessage = error?.message || "client Error";
    yield put(documentTemplateActions.updateDocumentFailure(errorMessage));
    yield put(notificationsActions.setNotification({ message: errorMessage, type: "error" }));
  }
}
export function* getInventoriesByIdsGenerator({ payload: data }: DocumentTemplateAction) {
  try {
    const token = data.token;
    delete data.token;

    const response: Response = yield call(request, API.GET_INVENTORIES_BY_IDS, data, token);
    if (response.success) {
      yield put(documentTemplateActions.getDocumentInventoriesSuccess(response.data));
    } else {
      yield put(documentTemplateActions.getDocumentInventoriesFailure(response.message));
    }
  } catch {
    yield put(documentTemplateActions.getDocumentInventoriesFailure("client Error"));
  }
}

export function* documentTemplateSaga() {
  yield takeLatest(documentTemplateActions.getDocumentTemplates.type, getDocumentTemplatesGenerator);
  yield takeLatest(documentTemplateActions.getDocumentTemplatebyId.type, getDocumentTemplatebyIdGenerator);
  yield takeLatest(documentTemplateActions.createDocumentTemplate.type, createDocumentTemplateGenerator);
  yield takeLatest(documentTemplateActions.updateDocumentTemplate.type, updateDocumentTemplateGenerator);
  yield takeLatest(documentTemplateActions.deleteDocumentTemplate.type, deleteDocumentTemplateGenerator);
  yield takeLatest(documentTemplateActions.getAssets.type, getAssetsGenerator);
  yield takeLatest(documentTemplateActions.getCustomers.type, getCustomersGenerator);

  yield takeLatest(documentTemplateActions.getDocumentInventories.type, getDocumentInventoriesGenerator);

  yield takeLatest(documentTemplateActions.createDocumentWithTimeline.type, createDocumentWithTimelineGenerator);
  yield takeLatest(documentTemplateActions.getDocumentbyId.type, getDocumentbyIdGenerator);
  yield takeLatest(documentTemplateActions.updateDocument.type, updateDocumentGenerator);
  yield takeLatest(documentTemplateActions.getInventoriesByIds.type, getInventoriesByIdsGenerator);
}
