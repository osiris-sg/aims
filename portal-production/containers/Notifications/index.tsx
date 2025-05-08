/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable @typescript-eslint/no-unused-vars */

import React, { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { selectNotification } from "./slice/selectors";
import { useSnackbar } from "notistack";
import { useNotificationsSlice } from "./slice";

export default function Notifications() {
  const { actions } = useNotificationsSlice();
  const dispatch = useDispatch();
  const { enqueueSnackbar } = useSnackbar();
  const notification = useSelector(selectNotification);

  useEffect(() => {
    if (notification) {
      enqueueSnackbar(`${notification.message}`, {
        variant: notification.type,
        autoHideDuration: 3000,
        preventDuplicate: true,
        onClose: () => dispatch(actions.clearNotification()),
      });
    }
  }, [notification]);
  return <></>;
}
