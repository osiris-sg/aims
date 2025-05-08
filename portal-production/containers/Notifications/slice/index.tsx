import { PayloadAction } from "@reduxjs/toolkit";
import moment from "moment";
import { createSlice } from "@reduxjs/toolkit";
import { INotification, NotificationsState } from "./types";

export const initialState: NotificationsState = {
  notification: null,
};

export const notificationSlice = createSlice({
  name: "notifications",
  initialState,
  reducers: {
    setNotification(state, action: PayloadAction<INotification>) {
      state.notification = {
        ...action.payload,
        date: moment(new Date()).toString(),
      };
    },
    clearNotification(state) {
      state.notification = null;
    },
  },
});

export const { actions: notificationsActions } = notificationSlice;

export const useNotificationsSlice = () => {
  return { actions: notificationSlice.actions };
};
