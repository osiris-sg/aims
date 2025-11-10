"use client";

import React, { createContext, useContext, useCallback } from 'react';
import { useSnackbar, VariantType } from 'notistack';

interface NotificationContextType {
  showNotification: (message: string, type?: VariantType) => void;
  showSuccess: (message: string) => void;
  showError: (message: string) => void;
  showWarning: (message: string) => void;
  showInfo: (message: string) => void;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { enqueueSnackbar } = useSnackbar();

  const showNotification = useCallback(
    (message: string, type: VariantType = 'default') => {
      enqueueSnackbar(message, {
        variant: type,
        autoHideDuration: 3000,
        preventDuplicate: true,
      });
    },
    [enqueueSnackbar]
  );

  const showSuccess = useCallback(
    (message: string) => showNotification(message, 'success'),
    [showNotification]
  );

  const showError = useCallback(
    (message: string) => showNotification(message, 'error'),
    [showNotification]
  );

  const showWarning = useCallback(
    (message: string) => showNotification(message, 'warning'),
    [showNotification]
  );

  const showInfo = useCallback(
    (message: string) => showNotification(message, 'info'),
    [showNotification]
  );

  return (
    <NotificationContext.Provider
      value={{
        showNotification,
        showSuccess,
        showError,
        showWarning,
        showInfo,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotification() {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotification must be used within NotificationProvider');
  }
  return context;
}
