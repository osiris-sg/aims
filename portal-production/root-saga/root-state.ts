// import { NotificationsState } from '../features/Notifications/slice/types';

import { AssetsState } from "@/containers/Assets/slice/types";
import { NotificationsState } from "@/containers/Notifications/slice/types";
import { InventoryState } from "@/containers/Inventory/slice/types";
import { CustomerState } from "@/containers/Customers/slice/types";
import { DocumentTemplateState } from "@/containers/Documents/slice/types";

/*
  Because the redux-injectors injects your reducers asynchronously somewhere in your code
  You have to declare them here manually
*/
declare global {
  // eslint-disable-next-line no-unused-vars, @typescript-eslint/no-empty-object-type
  interface Window {
    /* This will help for define window object that not define types */
  }
}

export interface RootState {
  notifications: NotificationsState;
  assets: AssetsState;
  inventories: InventoryState;
  customers: CustomerState;
  documentTemplates: DocumentTemplateState;
}
