import { useCallback } from "react";
import { toast, ToastPosition } from "react-toastify";

interface NotificationOptions {
  message: string;
  type: "success" | "error" | "info" | "warning";
}

export function useNotifications() {
  const showNotification = useCallback(({ message, type }: NotificationOptions) => {
    const options = {
      position: "top-right" as ToastPosition,
      autoClose: 3000,
      hideProgressBar: false,
      closeOnClick: true,
      pauseOnHover: true,
      draggable: true,
    };

    switch (type) {
      case "success":
        toast.success(message, options);
        break;
      case "error":
        toast.error(message, options);
        break;
      case "info":
        toast.info(message, options);
        break;
      case "warning":
        toast.warning(message, options);
        break;
      default:
        toast(message, options);
    }
  }, []);

  return { showNotification };
}
