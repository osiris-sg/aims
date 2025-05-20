import { useNotifications } from "../context/NotificationsContext";

export function useNotification() {
  const { setNotification, clearNotification } = useNotifications();

  const showSuccess = (message: string) => {
    setNotification({ message, type: "success" });
  };

  const showError = (message: string) => {
    setNotification({ message, type: "error" });
  };

  const showWarning = (message: string) => {
    setNotification({ message, type: "warning" });
  };

  const showInfo = (message: string) => {
    setNotification({ message, type: "info" });
  };

  return {
    showSuccess,
    showError,
    showWarning,
    showInfo,
    clearNotification,
  };
}
