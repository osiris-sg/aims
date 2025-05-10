import { call, put, takeLatest } from "redux-saga/effects";
import { request } from "@/helpers/request";
import { API } from "./constants";
import { Response } from "@/containers/portal/types";
import { inventoryActions } from "./index";
import { InventoryAction } from "./types";
import { notificationsActions } from "@/containers/Notifications/slice";

export function* getInventoriesGenerator({ payload: data }: InventoryAction) {
  try {
    const token = data.token;
    delete data.token;

    const response: Response = yield call(request, API.GET_INVENTORY, data, token);
    if (response.success) {
      yield put(inventoryActions.getInventoriesSuccess(response.data));
    } else {
      yield put(inventoryActions.getInventoriesFailure(response.message));
    }
  } catch {
    yield put(inventoryActions.getInventoriesFailure("client Error"));
  }
}

export function* getInventoryBySkuGenerator({ payload: data }: InventoryAction) {
  try {
    const token = data.token;
    delete data.token;

    const response: Response = yield call(request, API.GET_INVENTORY_BY_SKU, data, token);
    if (response.success) {
      yield put(inventoryActions.getInventorybySkuSuccess(response.data));
    } else {
      yield put(inventoryActions.getInventorybySkuFailure(response.message));
    }
  } catch {
    yield put(inventoryActions.getInventorybySkuFailure("client Error"));
  }
}

export function* createInventoryGenerator({ payload: data }: InventoryAction) {
  try {
    const token = data.token;
    delete data.token;

    const response: Response = yield call(request, API.CREATE_INVENTORY, data, token);
    if (response.success) {
      yield put(inventoryActions.createInventorySuccess(response.data));
      yield put(notificationsActions.setNotification({ message: "Created", type: "success" }));
    } else {
      yield put(inventoryActions.createInventoryFailure(response.message));
    }
  } catch {
    yield put(inventoryActions.createInventoryFailure("client Error"));
  }
}

export function* updateInventoryGenerator({ payload: data }: InventoryAction) {
  try {
    const token = data.token;
    delete data.token;

    const response: Response = yield call(request, API.UPDATE_INVENTORY, data, token);
    if (response.success) {
      yield put(inventoryActions.updateInventorySuccess(response.data));
    } else {
      yield put(inventoryActions.updateInventoryFailure(response.message));
    }
  } catch {
    yield put(inventoryActions.updateInventoryFailure("client Error"));
  }
}

export function* deleteInventoryGenerator({ payload: data }: InventoryAction) {
  try {
    const token = data.token;
    delete data.token;

    const response: Response = yield call(request, API.DELETE_INVENTORY, data, token);
    if (response.success) {
      yield put(inventoryActions.deleteInventorySuccess(response.data));
    } else {
      yield put(inventoryActions.deleteInventoryFailure(response.message));
    }
  } catch {
    yield put(inventoryActions.deleteInventoryFailure("client Error"));
  }
}

export function* getAssetsGenerator({ payload: data }: InventoryAction) {
  try {
    const token = data.token;
    delete data.token;

    const response: Response = yield call(request, API.GET_ASSETS, data, token);
    if (response.success) {
      yield put(inventoryActions.getAssetsSuccess(response.data));
    } else {
      yield put(inventoryActions.getAssetsFailure(response.message));
    }
  } catch {
    yield put(inventoryActions.getAssetsFailure("client Error"));
  }
}
export function* getCategoriesGenerator({ payload: data }: InventoryAction) {
  try {
    const token = data.token;
    delete data.token;

    const response: Response = yield call(request, API.GET_CATEGORIES, data, token);
    if (response.success) {
      yield put(inventoryActions.getCategoriesSuccess(response.data));
    } else {
      yield put(inventoryActions.getCategoriesFailure(response.message));
    }
  } catch {
    yield put(inventoryActions.getCategoriesFailure("client Error"));
  }
}
export function* generateSkuRangeGenerator({ payload: { assetId, quantity, token, organizationId } }: InventoryAction) {
  try {
    const response: Response = yield call(request, API.GENERATE_SKU, { assetId, quantity, organizationId }, token);

    if (response.success) {
      yield put(inventoryActions.generateSkuRangeSuccess(response.data));
    } else {
      yield put(inventoryActions.generateSkuRangeFailure(response.message));
    }
  } catch {
    yield put(inventoryActions.generateSkuRangeFailure("Error generating SKU range"));
  }
}
export function* getQRCodeGenerator({ payload: data }: InventoryAction) {
  try {
    const token = data.token;
    delete data.token;

    const response: Response = yield call(request, API.GET_QR_CODE, data, token);
    if (response.success) {
      yield put(inventoryActions.getQRCodeSuccess(response.data));
    } else {
      yield put(inventoryActions.getQRCodeFailure(response.message));
    }
  } catch {
    yield put(inventoryActions.getQRCodeFailure("Client Error"));
  }
}

export function* getDocumentsByInventoryIdGenerator({ payload: data }: InventoryAction) {
  try {
    const token = data.token;
    delete data.token;

    const response: Response = yield call(request, API.GET_DOCUMENTS, data, token);
    if (response.success) {
      yield put(inventoryActions.getDocumentsByInventoryIdSuccess(response.data));
    } else {
      yield put(inventoryActions.getDocumentsByInventoryIdFailure(response.message));
    }
  } catch {
    yield put(inventoryActions.getDocumentsByInventoryIdFailure("client Error"));
  }
}


export function* getTimelineItemsByInventoryIdGenerator({ payload: data }: InventoryAction) {
  try {
    const token = data.token;
    delete data.token;

    const response: Response = yield call(request, API.GET_TIMELINE_ITEMS, data, token);
    if (response.success) {
      yield put(inventoryActions.getTimelineItemsByInventoryIdSuccess(response.data));
    } else {
      yield put(inventoryActions.getTimelineItemsByInventoryIdFailure(response.message));
    }
  } catch {
    yield put(inventoryActions.getTimelineItemsByInventoryIdFailure("client Error"));
  }
}

export function* inventorySaga() {
  yield takeLatest(inventoryActions.getInventories.type, getInventoriesGenerator);
  yield takeLatest(inventoryActions.getInventorybySku.type, getInventoryBySkuGenerator);
  yield takeLatest(inventoryActions.createInventory.type, createInventoryGenerator);
  yield takeLatest(inventoryActions.updateInventory.type, updateInventoryGenerator);
  yield takeLatest(inventoryActions.deleteInventory.type, deleteInventoryGenerator);
  yield takeLatest(inventoryActions.getAssets.type, getAssetsGenerator);
  yield takeLatest(inventoryActions.getCategories.type, getCategoriesGenerator);
  yield takeLatest(inventoryActions.generateSkuRange.type, generateSkuRangeGenerator);
  yield takeLatest(inventoryActions.getQRCode.type, getQRCodeGenerator);

  yield takeLatest(inventoryActions.getDocumentsByInventoryId.type, getDocumentsByInventoryIdGenerator);

  yield takeLatest(inventoryActions.getTimelineItemsByInventoryId.type, getTimelineItemsByInventoryIdGenerator);
}
