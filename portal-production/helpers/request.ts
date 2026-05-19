/* eslint-disable @typescript-eslint/no-explicit-any */
// import moment from "moment";
import axios, { AxiosInstance, AxiosRequestConfig } from "axios";

import { notificationsActions } from "@/containers/Notifications/slice";
import store from "@/store";

// import { portalActions } from 'layout/MainLayout/sliice';

// import moment from 'moment';
export class ResponseError extends Error {
  public response: Response;

  constructor(response: Response) {
    super(response.statusText);
    this.response = response;
  }
}
interface CustomAxiosRequestConfig extends AxiosRequestConfig {
  isClientSide?: boolean;
}
/**
 * Parses the JSON returned by a network request
 *
 * @param  {object} response A response from a network request
 *
 * @return {object}          The parsed JSON from the request
 */
export function parseJSON(response: Response) {
  if (response.status === 204 || response.status === 205) {
    return null;
  }
  return response.json();
}

export class RequestService {
  private instance: AxiosInstance;
  constructor() {
    this.instance = axios.create();
  }

  public sendRequest = async (_metadata: any, data: any, token?: string, customHeaders?: any, isClientSide: boolean = true, formData: boolean = false) => {
    try {
      const metadata = { ..._metadata };
      const pathTokens = metadata.path.split("/:");
      if (metadata.path.indexOf("/:") !== 0) {
        pathTokens.shift();
      }
      pathTokens.forEach((token: string) => {
        metadata.path = metadata.path.replace(`/:${token}`, `/${data[token]}`);
      });

      const headers: any = {};
      headers["Content-Type"] = "application/json";

      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      // Auto-inject the admin org-switch header from sessionStorage. The
      // backend (clerk-auth.guard.ts) only honors X-Active-Org-Id when the
      // requesting user is osiris-admin; non-admins setting this client-side
      // have no server effect. Custom headers (below) can still override —
      // notably, OrganizationContext's bootstrap fetch passes
      // X-Use-Real-Org: "1" to learn the user's actual membership org.
      if (typeof window !== "undefined") {
        const activeOrgId = window.sessionStorage.getItem("aims-admin-active-org");
        if (activeOrgId) headers["X-Active-Org-Id"] = activeOrgId;
      }

      // Merge custom headers
      if (customHeaders && typeof customHeaders === 'object') {
        Object.assign(headers, customHeaders);
      }
      //TODO: This should be changed from the user subscription plan
      const url = `${process.env.NEXT_PUBLIC_BACKEND_API_URL}${metadata.path}`;
      const options: CustomAxiosRequestConfig = {
        url,
        method: metadata.method,
        withCredentials: true,
        headers: headers,
        isClientSide,
        ...(["POST", "PUT", "PATCH", "DELETE"].includes(metadata.method) && {
          data: JSON.stringify(data),
        }),
      };
      let result;
      if (formData) {
        result = await this.instance.post(url, data, {
          ...options,
          headers: {
            ...options.headers,
            "Content-Type": "multipart/form-data",
          },
        });
      } else {
        result = await this.instance.request({ ...options });
      }

      return result.data;
    } catch (error: any) {
      store.dispatch(
        notificationsActions.setNotification({
          type: "error",
          message: error?.response?.data?.message || error?.message || "Something went wrong in request",
        })
      );
      return {
        success: false,
        message: error?.response?.data?.message || error?.message || "Something went wrong in request",
      };
    }
  };

  static instance = new RequestService();
}

export const request = RequestService.instance.sendRequest;
