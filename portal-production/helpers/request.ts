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

// Default request timeout. axios.create() has NO timeout (0 = infinite), so a
// stalled connection used to pend forever — leaving callers' `await` hanging
// and their try/finally never running (e.g. the field bind button stuck on
// "Creating…"). 30s recovers from a true hang while tolerating a slow request.
const DEFAULT_TIMEOUT_MS = 30000;
// Uploads (formData) move large payloads to S3 and run much longer — give them
// a generous ceiling so a real upload isn't killed at the JSON default.
const UPLOAD_TIMEOUT_MS = 120000;

export class RequestService {
  private instance: AxiosInstance;
  constructor() {
    this.instance = axios.create({ timeout: DEFAULT_TIMEOUT_MS });
  }

  public sendRequest = async (_metadata: any, data: any, token?: string, customHeaders?: any, isClientSide: boolean = true, formData: boolean = false) => {
    // Effective timeout: explicit per-call override (_metadata.timeout) wins;
    // else uploads get the longer ceiling; else the JSON default. AbortController
    // is belt-and-suspenders alongside axios's own `timeout` so a stalled
    // connection actually aborts and the promise rejects (never pends forever).
    const effectiveTimeout =
      typeof _metadata?.timeout === "number"
        ? _metadata.timeout
        : formData
        ? UPLOAD_TIMEOUT_MS
        : DEFAULT_TIMEOUT_MS;
    const abortController = new AbortController();
    const abortTimer = setTimeout(() => abortController.abort(), effectiveTimeout);
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
        timeout: effectiveTimeout,
        signal: abortController.signal,
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
      // Distinguish a timeout/abort (our AbortController or axios's own timeout)
      // from a normal failure, so callers can show "timed out, try again".
      const timedOut =
        error?.code === "ECONNABORTED" ||
        error?.code === "ERR_CANCELED" ||
        (typeof axios.isCancel === "function" && axios.isCancel(error)) ||
        /timeout|aborted/i.test(String(error?.message || ""));
      const message = timedOut
        ? "Request timed out — please try again."
        : error?.response?.data?.message || error?.message || "Something went wrong in request";
      store.dispatch(
        notificationsActions.setNotification({ type: "error", message })
      );
      // Surface the backend's structured error body so callers can branch on a
      // code (e.g. create-and-bind's ALREADY_TAGGED / AMBIGUOUS_SERIAL). Purely
      // additive — existing callers still read `success` / `message`.
      const errorBody = error?.response?.data;
      return {
        success: false,
        message,
        ...(timedOut && { timedOut: true }),
        ...(errorBody && typeof errorBody === "object"
          ? { code: (errorBody as any).code, details: errorBody }
          : {}),
      };
    } finally {
      // Always clear the abort timer — on success, error, AND timeout — so we
      // never leak a pending timer or abort an already-settled request.
      clearTimeout(abortTimer);
    }
  };

  static instance = new RequestService();
}

export const request = RequestService.instance.sendRequest;
