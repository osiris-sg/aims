"use client";

import React, { createContext, useContext, useState, useCallback } from "react";
import { useSnackbar } from "notistack";
import moment from "moment";

interface Notification {
  message: string;
  type: "success" | "error" | "warning" | "info";
  date?: string;
}

interface NotificationsContextType {
  setNotification: (notification: Notification) => void;
  clearNotification: () => void;
}

const NotificationsContext = createContext<NotificationsContextType | undefined>(undefined);

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const { enqueueSnackbar } = useSnackbar();
  const [notification, setNotificationState] = useState<Notification | null>(null);

  const setNotification = useCallback(
    (notification: Notification) => {
      const newNotification = {
        ...notification,
        date: moment(new Date()).toString(),
      };
      setNotificationState(newNotification);
      enqueueSnackbar(notification.message, {
        variant: notification.type,
        autoHideDuration: 3000,
        preventDuplicate: true,
        onClose: () => clearNotification(),
      });
    },
    [enqueueSnackbar]
  );

  const clearNotification = useCallback(() => {
    setNotificationState(null);
  }, []);

  return <NotificationsContext.Provider value={{ setNotification, clearNotification }}>{children}</NotificationsContext.Provider>;
}

export function useNotifications() {
  const context = useContext(NotificationsContext);
  if (context === undefined) {
    throw new Error("useNotifications must be used within a NotificationsProvider");
  }
  return context;
}
