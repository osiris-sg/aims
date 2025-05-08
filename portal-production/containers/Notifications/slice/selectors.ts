import { createSelector } from "@reduxjs/toolkit";
import { initialState } from ".";
import { RootState } from "../../../root-saga/root-state";
const selectSlice = (state: RootState) => state.notifications || initialState;
export const selectNotification = createSelector([selectSlice], (state) => state.notification);
