// import { portalSaga } from '@/containers/Portal/slice/saga';
import { assetsSaga } from "@/containers/Assets/slice/saga";
import { inventorySaga } from "@/containers/Inventory/slice/saga";
import { customerSaga } from "@/containers/Customers/slice/saga";
import { all, fork } from "redux-saga/effects";
import { documentTemplateSaga } from "@/containers/DocumentsTemplateView/slice/saga";

// eslint-disable-next-line import/prefer-default-export
export function* rootSaga() {
  yield all([
    // fork(portalSaga),
    fork(assetsSaga),
    fork(inventorySaga),
    fork(customerSaga),
    fork(documentTemplateSaga),
  ]);
}
