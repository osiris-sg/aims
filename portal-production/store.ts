"use client";
import { configureStore } from "@reduxjs/toolkit";
import createSagaMiddleware from "redux-saga";
import { rootSaga } from "@/root-saga";
import { notificationSlice } from "@/containers/Notifications/slice";
import { assetsSlice } from "@/containers/Assets/slice";
import { inventorySlice } from "@/containers/Inventory/slice";
import { customersSlice } from "@/containers/Customers/slice";
import { documentTemplateSlice } from "./containers/DocumentsTemplateView/slice";

export const sagaMiddleware = createSagaMiddleware();

const store = configureStore({
  reducer: {
    [notificationSlice.name]: notificationSlice.reducer,
    [assetsSlice.name]: assetsSlice.reducer,
    [inventorySlice.name]: inventorySlice.reducer,
    [customersSlice.name]: customersSlice.reducer,
    [documentTemplateSlice.name]: documentTemplateSlice.reducer,
  },
  devTools: true,
  middleware: (getDefaultMiddleware) => getDefaultMiddleware({ serializableCheck: true }).concat(sagaMiddleware),
});
sagaMiddleware.run(rootSaga);
export default store;
