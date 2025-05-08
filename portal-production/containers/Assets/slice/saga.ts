/* eslint-disable react-hooks/rules-of-hooks */
import { call, put, takeLatest } from "redux-saga/effects";
import { assetsActions } from "./index";
import { AssetsAction } from "./types";
import { request } from "@/helpers/request";
import { API } from "./constants";
import { Response } from "@/containers/portal/types";
import { notificationsActions } from "@/containers/Notifications/slice";

export function* getAssetsGenerator({ payload: data }: AssetsAction) {
  try {
    const token = data.token;
    delete data.token;

    const response: Response = yield call(request, API.GET_ASSETS, data, token);
    if (response.success) {
      yield put(assetsActions.getAssetsSuccess(response.data));
    } else {
      yield put(assetsActions.getAssetsFailure(response.message));
    }
  } catch {
    yield put(assetsActions.getAssetsFailure("client Error"));
  }
}
export function* getAssetbySKUKEYGenerator({ payload: data }: AssetsAction) {
  try {
    const token = data.token;
    delete data.token;

    const response: Response = yield call(request, API.GET_ASSET_BY_SKUKEY, data, token);
    if (response.success) {
      yield put(assetsActions.getAssetbySKUKEYSuccess(response.data));
    } else {
      yield put(assetsActions.getAssetbySKUKEYFailure(response.message));
    }
  } catch {
    yield put(assetsActions.getAssetbySKUKEYFailure("client Error"));
  }
}
export function* getAssetbyIdGenerator({ payload: data }: AssetsAction) {
  try {
    const token = data.token;
    delete data.token;

    const response: Response = yield call(request, API.GET_ASSET_BY_ID, data, token);
    if (response.success) {
      yield put(assetsActions.getAssetbyIdSuccess(response.data));
    } else {
      yield put(assetsActions.getAssetbyIdFailure(response.message));
    }
  } catch {
    yield put(assetsActions.getAssetbyIdFailure("client Error"));
  }
}
export function* getInventoriesByAssetGenerator({ payload: data }: AssetsAction) {
  try {
    const token = data.token;
    delete data.token;

    const response: Response = yield call(request, API.GET_INVENTORIES_BY_ASSET, data, token);
    if (response.success) {
      yield put(assetsActions.getInventoriesByAssetSuccess(response.data));
    } else {
      yield put(assetsActions.getInventoriesByAssetFailure(response.message));
    }
  } catch {
    yield put(assetsActions.getInventoriesByAssetFailure("client Error"));
  }
}

export function* createAssetGenerator({ payload: data }: AssetsAction) {
  try {
    const token = data.token;
    delete data.token;

    const response: Response = yield call(request, API.CREATE_ASSET, data, token);
    if (response.success) {
      yield put(assetsActions.createAssetSuccess(response.data));
    } else {
      yield put(assetsActions.createAssetFailure(response.message));
    }
  } catch {
    yield put(assetsActions.createAssetFailure("client Error"));
  }
}

export function* updateAssetGenerator({ payload: data }: AssetsAction) {
  try {
    const token = data.token;
    delete data.token;

    const response: Response = yield call(request, API.UPDATE_ASSET, data, token);
    if (response.success) {
      yield put(assetsActions.updateAssetSuccess(response.data));
      yield put(notificationsActions.setNotification({ message: "Updated", type: "success" }));
    } else {
      yield put(assetsActions.updateAssetFailure(response.message));
    }
  } catch {
    yield put(assetsActions.updateAssetFailure("client Error"));
  }
}

export function* deleteAssetGenerator({ payload: data }: AssetsAction) {
  try {
    const token = data.token;
    delete data.token;

    const response: Response = yield call(request, API.DELETE_ASSET, data, token);
    if (response.success) {
      yield put(assetsActions.deleteAssetSuccess(response.data));
    } else {
      yield put(assetsActions.deleteAssetFailure(response.message));
    }
  } catch {
    yield put(assetsActions.deleteAssetFailure("client Error"));
  }
}

export function* getCategoriesGenerator({ payload: data }: AssetsAction) {
  try {
    const token = data.token;
    delete data.token;

    const response: Response = yield call(request, API.GET_CATEGORIES, data, token);
    if (response.success) {
      yield put(assetsActions.getCategoriesSuccess(response.data));
    } else {
      yield put(assetsActions.getCategoriesFailure(response.message));
    }
  } catch {
    yield put(assetsActions.getCategoriesFailure("client Error"));
  }
}

export function* createCategoryGenerator({ payload: data }: AssetsAction) {
  try {
    const token = data.token;
    delete data.token;

    const response: Response = yield call(request, API.CREATE_CATEGORY, data, token); 
    if (response.success) {
      yield put(assetsActions.createCategorySuccess(response.data));
    } else {
      yield put(assetsActions.createCategoryFailure(response.message));
    }
  } catch {
    yield put(assetsActions.createCategoryFailure("client Error"));
  }
}

export function* deleteCategoryGenerator({ payload: data }: AssetsAction) {
  try {
    const token = data.token;
    delete data.token;

    const response: Response = yield call(request, API.DELETE_CATEGORY, data, token);
    if (response.success) {
      yield put(assetsActions.deleteCategorySuccess(response.data));
    } else {
      yield put(assetsActions.deleteCategoryFailure(response.message));
    }
  } catch {
    yield put(assetsActions.deleteCategoryFailure("client Error"));
  }
}

export function* checkSkuKeyGenerator({ payload: data }: AssetsAction) {
  try {
    const token = data.token;
    delete data.token;

    const response: Response = yield call(request, API.CHECK_SKU_KEY, data, token);
    if (response.success) {
      yield put(assetsActions.checkSkuKeySuccess(response.data.isAvailable));
    } else {
      yield put(assetsActions.checkSkuKeyFailure(response.message));
    }
  } catch {
    yield put(assetsActions.checkSkuKeyFailure("Client Error"));
  }
}



export function* assetsSaga() {
  yield takeLatest(assetsActions.getAssets.type, getAssetsGenerator);
  yield takeLatest(assetsActions.getAssetbySKUKEY.type, getAssetbySKUKEYGenerator);
  yield takeLatest(assetsActions.getAssetbyId.type, getAssetbyIdGenerator);
  yield takeLatest(assetsActions.getInventoriesByAsset.type, getInventoriesByAssetGenerator);
  yield takeLatest(assetsActions.createAsset.type, createAssetGenerator);
  yield takeLatest(assetsActions.updateAsset.type, updateAssetGenerator);
  yield takeLatest(assetsActions.deleteAsset.type, deleteAssetGenerator);
  yield takeLatest(assetsActions.getCategories.type, getCategoriesGenerator);
  yield takeLatest(assetsActions.createCategory.type, createCategoryGenerator);
  yield takeLatest(assetsActions.deleteCategory.type, deleteCategoryGenerator); 
  yield takeLatest(assetsActions.checkSkuKey.type, checkSkuKeyGenerator); 
}
