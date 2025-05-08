/* --- STATE --- */
export interface NotificationsState {
  notification: INotification | null;
}
export interface INotification {
  date?: string;
  message: string;
  type: "default" | "error" | "success" | "warning" | "info";
}
