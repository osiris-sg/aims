import { call, put, takeLatest } from "redux-saga/effects";
import { request } from "@/helpers/request";
import { API } from "./constants";
import { Response } from "@/containers/portal/types";
import { customerActions } from "./index";
import { CustomerAction } from "./types";

export function* getCustomersGenerator({ payload: data }: CustomerAction) {
  try {
    const token = data.token;
    delete data.token;

    const response: Response = yield call(request, API.GET_CUSTOMERS, data, token);
    if (response.success) {
      yield put(customerActions.getCustomersSuccess(response.data));
    } else {
      yield put(customerActions.getCustomersFailure(response.message));
    }
  } catch {
    yield put(customerActions.getCustomersFailure("client Error"));
  }
}

export function* getCustomerByIdGenerator({ payload: data }: CustomerAction) {
  try {
    const token = data.token;
    delete data.token;

    const response: Response = yield call(request, API.GET_CUSTOMER_BY_ID, data, token);
    if (response.success) {
      yield put(customerActions.getCustomerByIdSuccess(response.data));
    } else {
      yield put(customerActions.getCustomerByIdFailure(response.message));
    }
  } catch {
    yield put(customerActions.getCustomerByIdFailure("client Error"));
  }
}

export function* createCustomerGenerator({ payload: data }: CustomerAction) {
  try {
    const token = data.token;
    delete data.token;

    const response: Response = yield call(request, API.CREATE_CUSTOMER, data, token);
    if (response.success) {
      yield put(customerActions.createCustomerSuccess(response.data));
    } else {
      yield put(customerActions.createCustomerFailure(response.message));
    }
  } catch {
    yield put(customerActions.createCustomerFailure("client Error"));
  }
}

export function* updateCustomerGenerator({ payload: data }: CustomerAction) {
  try {
    const token = data.token;
    delete data.token;

    const response: Response = yield call(request, API.UPDATE_CUSTOMER, data, token);
    if (response.success) {
      yield put(customerActions.updateCustomerSuccess(response.data));
    } else {
      yield put(customerActions.updateCustomerFailure(response.message));
    }
  } catch {
    yield put(customerActions.updateCustomerFailure("client Error"));
  }
}

export function* deleteCustomerGenerator({ payload: data }: CustomerAction) {
  try {
    const token = data.token;
    delete data.token;

    const response: Response = yield call(request, API.DELETE_CUSTOMER, data, token);
    if (response.success) {
      yield put(customerActions.deleteCustomerSuccess(response.data));
    } else {
      yield put(customerActions.deleteCustomerFailure(response.message));
    }
  } catch {
    yield put(customerActions.deleteCustomerFailure("client Error"));
  }
}

export function* customerSaga() {
  yield takeLatest(customerActions.getCustomers.type, getCustomersGenerator);
  yield takeLatest(customerActions.createCustomer.type, createCustomerGenerator);
  yield takeLatest(customerActions.updateCustomer.type, updateCustomerGenerator);
  yield takeLatest(customerActions.deleteCustomer.type, deleteCustomerGenerator);
  yield takeLatest(customerActions.getCustomerById.type, getCustomerByIdGenerator);
}
