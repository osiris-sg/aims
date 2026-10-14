import { toast as baseToast, type ToastContent, type ToastOptions } from "react-toastify";

/**
 * Toasts for the Shipments pages, Documents hub and generated-doc editor:
 * bottom-right, so they never cover the top-right action buttons (Finalize,
 * Edit again, Save, Complete). The portal's one ToastContainer stays
 * top-right for every other page; react-toastify positions per toast.
 */
const at = (o?: ToastOptions): ToastOptions => ({ position: "bottom-right", ...o });

export const toast = {
  success: (m: ToastContent, o?: ToastOptions) => baseToast.success(m, at(o)),
  error: (m: ToastContent, o?: ToastOptions) => baseToast.error(m, at(o)),
  info: (m: ToastContent, o?: ToastOptions) => baseToast.info(m, at(o)),
  warning: (m: ToastContent, o?: ToastOptions) => baseToast.warning(m, at(o)),
  dismiss: (id?: string | number) => baseToast.dismiss(id),
};
