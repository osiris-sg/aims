// Run: npm test (node --test). Portal-wide error toast for request() (helpers/apiErrorToast.ts), all orgs.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isReadCall,
  apiErrorToastDecision,
  apiErrorToastText,
  apiMessageText,
  createApiErrorToaster,
  failureFromAxiosError,
  isPortalPath,
  DEDUPE_MS,
  FALLBACK_TEXT,
  OFFLINE_TEXT,
  TIMED_OUT_TEXT,
} from "./apiErrorToast.ts";

const onScreen = { startPath: "/portal/invoices", currentPath: "/portal/invoices" };
const serverError = (message, status = 500) => ({ ...onScreen, status, apiMessage: message });

// ── shows for an unhandled failure ──
test("an unhandled failure on a /portal page shows the API's message", () => {
  assert.deepEqual(apiErrorToastDecision(serverError("Customer not found", 404)), { show: true, message: "Customer not found" });
  assert.deepEqual(apiErrorToastDecision({ ...serverError("Duplicate number", 400), flags: { ownError: false, quiet: false } }), {
    show: true,
    message: "Duplicate number",
  });
});

test("403: a refused write shows; a read the role may not do does not (pickers, filters); 401 is the sign-in redirect's", () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "post"]) {
    assert.deepEqual(apiErrorToastDecision({ ...serverError("User does not have sufficient permissions", 403), method }), {
      show: true,
      message: "User does not have sufficient permissions",
    });
  }
  for (const method of ["GET", "get", undefined, null]) {
    assert.deepEqual(apiErrorToastDecision({ ...serverError("User does not have sufficient permissions", 403), method }), { show: false, reason: "no-read-permission" });
  }
  assert.equal(apiErrorToastDecision({ ...serverError("Boom", 500), method: "GET" }).show, true);
  // House convention "POST / = list": a listing POST is a read too; a creating POST is a write.
  for (const path of ["/customers", "/suppliers", "/projects", "/documents/paginated", "/inventories", "/customers?x=1"]) {
    assert.equal(apiErrorToastDecision({ ...serverError("Forbidden", 403), method: "POST", path }).reason, "no-read-permission", path);
  }
  for (const path of ["/documents/basic", "/customers/create", "/job-fields", null]) {
    assert.equal(apiErrorToastDecision({ ...serverError("Forbidden", 403), method: "POST", path }).show, true, String(path));
  }
  assert.deepEqual(apiErrorToastDecision(serverError("Invalid token", 401)), { show: false, reason: "signed-out" });
});

// ── not for handled ──
test("ownError: the screen shows its own error, so no global toast (no doubling)", () => {
  assert.deepEqual(apiErrorToastDecision({ ...serverError("Could not save"), flags: { ownError: true } }), { show: false, reason: "own-error" });
});

// ── not for polling / background ──
test("quiet: background, poll and heartbeat calls never toast", () => {
  assert.deepEqual(apiErrorToastDecision({ ...serverError("Lock lost"), flags: { quiet: true } }), { show: false, reason: "quiet" });
});

// ── not for aborted / cancelled ──
test("cancelled (caller signal or page unload) never toasts; a timeout does", () => {
  assert.deepEqual(apiErrorToastDecision({ ...onScreen, cancelled: true }), { show: false, reason: "cancelled" });
  assert.deepEqual(apiErrorToastDecision({ ...onScreen, timedOut: true }), { show: true, message: TIMED_OUT_TEXT });
});

test("the user left the screen that made the call (component unmounted): no toast", () => {
  assert.deepEqual(apiErrorToastDecision({ ...serverError("Boom"), currentPath: "/portal/customers" }), { show: false, reason: "left-screen" });
  // No start path known (non-browser): judged on the current page alone.
  assert.equal(apiErrorToastDecision({ status: 500, apiMessage: "Boom", startPath: null, currentPath: "/portal/x" }).show, true);
});

test("outside /portal (field app, guest, public pages) never toasts", () => {
  for (const p of ["/scan", "/scan/delivery/1", "/guest/delivery/abc", "/pay/t", "/submit", "/sign-in", "/portalx", null]) {
    assert.deepEqual(apiErrorToastDecision({ status: 500, apiMessage: "Boom", startPath: p, currentPath: p }), { show: false, reason: "outside-portal" }, String(p));
  }
  assert.equal(isPortalPath("/portal"), true);
  assert.equal(isPortalPath("/portal/sales/quotations"), true);
});

test("the skip rules hold whatever the order: own error / quiet win over everything", () => {
  assert.equal(apiErrorToastDecision({ flags: { ownError: true }, cancelled: true, status: 401, currentPath: "/scan" }).reason, "own-error");
  assert.equal(apiErrorToastDecision({ flags: { quiet: true }, cancelled: true, currentPath: "/scan" }).reason, "quiet");
});

// ── message choice ──
test("message: API message, else plain fallback; timed out wins", () => {
  assert.equal(apiErrorToastText({ status: 400, apiMessage: "Amount must be positive" }), "Amount must be positive");
  assert.equal(apiErrorToastText({ status: 500, apiMessage: undefined }), FALLBACK_TEXT);
  assert.equal(apiErrorToastText({ status: 500, apiMessage: "   " }), FALLBACK_TEXT);
  assert.equal(apiErrorToastText({ status: 500, apiMessage: { nested: true } }), FALLBACK_TEXT);
  assert.equal(apiErrorToastText({ status: undefined, offline: true, apiMessage: undefined }), OFFLINE_TEXT);
  // No answer but not a network failure (e.g. a bad call that threw inside request()): the plain fallback.
  assert.equal(apiErrorToastText({ status: undefined, apiMessage: undefined }), FALLBACK_TEXT);
  assert.equal(apiErrorToastText({ timedOut: true, apiMessage: "ignored" }), TIMED_OUT_TEXT);
});

test("message: class-validator arrays join into one line", () => {
  assert.equal(apiMessageText(["name should not be empty", "price must be a number"]), "name should not be empty; price must be a number");
  assert.equal(apiMessageText([]), null);
});

test("UI copy: no em-dashes, no subtitles, no '…' truncation (a long message falls back instead of being cut)", () => {
  assert.equal(apiMessageText("Cannot void — journal posted"), "Cannot void - journal posted");
  assert.equal(apiMessageText("A – B"), "A - B");
  const long = "x".repeat(201);
  assert.equal(apiMessageText(long), null);
  assert.equal(apiErrorToastText({ status: 500, apiMessage: long }), FALLBACK_TEXT);
  for (const t of [TIMED_OUT_TEXT, OFFLINE_TEXT, FALLBACK_TEXT]) {
    assert.ok(!/[—–…]/.test(t), t);
    assert.ok(!t.includes("\n"), t);
  }
});

// ── axios error → failure ──
test("axios errors: server answer, network down, our timeout, caller cancel, page unload", () => {
  const ctx = { startPath: "/portal/a", currentPath: "/portal/a" };
  const server = failureFromAxiosError({ message: "Request failed with status code 400", response: { status: 400, data: { message: "Bad" } } }, ctx);
  assert.equal(server.status, 400);
  assert.equal(server.apiMessage, "Bad");
  assert.equal(server.timedOut, false);
  assert.equal(server.cancelled, false);

  const offline = failureFromAxiosError({ code: "ERR_NETWORK", message: "Network Error" }, ctx);
  assert.deepEqual(apiErrorToastDecision(offline), { show: true, message: OFFLINE_TEXT });
  const thrown = failureFromAxiosError(new TypeError("Cannot read properties of undefined (reading 'split')"), ctx);
  assert.deepEqual(apiErrorToastDecision(thrown), { show: true, message: FALLBACK_TEXT });

  // request()'s own timer aborts with ERR_CANCELED: that is a timeout, not a cancel.
  const ourTimeout = failureFromAxiosError({ code: "ERR_CANCELED", name: "CanceledError", message: "canceled" }, { ...ctx, timerFired: true });
  assert.deepEqual(apiErrorToastDecision(ourTimeout), { show: true, message: TIMED_OUT_TEXT });
  const axiosTimeout = failureFromAxiosError({ code: "ECONNABORTED", message: "timeout of 30000ms exceeded" }, ctx);
  assert.deepEqual(apiErrorToastDecision(axiosTimeout), { show: true, message: TIMED_OUT_TEXT });

  const callerCancel = failureFromAxiosError({ code: "ERR_CANCELED", name: "CanceledError", message: "canceled" }, ctx);
  assert.deepEqual(apiErrorToastDecision(callerCancel), { show: false, reason: "cancelled" });
  const unload = failureFromAxiosError({ code: "ECONNABORTED", message: "Request aborted" }, ctx);
  assert.deepEqual(apiErrorToastDecision(unload), { show: false, reason: "cancelled" });
});

test("axios errors: the call's flags are read from request()'s first argument", () => {
  const err = { response: { status: 500, data: { message: "Boom" } } };
  const ctx = { startPath: "/portal/a", currentPath: "/portal/a" };
  assert.equal(apiErrorToastDecision(failureFromAxiosError(err, { ...ctx, meta: { path: "/x", method: "GET", ownError: true } })).reason, "own-error");
  assert.equal(apiErrorToastDecision(failureFromAxiosError(err, { ...ctx, meta: { path: "/x", method: "GET", quiet: true } })).reason, "quiet");
  assert.equal(apiErrorToastDecision(failureFromAxiosError(err, { ...ctx, meta: { path: "/x", method: "GET" } })).show, true);
  assert.equal(apiErrorToastDecision(failureFromAxiosError(null, ctx)).show, true);
  const forbidden = { response: { status: 403, data: { message: "User does not have sufficient permissions" } } };
  assert.equal(apiErrorToastDecision(failureFromAxiosError(forbidden, { ...ctx, meta: { path: "/suppliers", method: "GET" } })).reason, "no-read-permission");
  assert.equal(apiErrorToastDecision(failureFromAxiosError(forbidden, { ...ctx, meta: { path: "/documents/basic", method: "POST" } })).show, true);
  assert.equal(apiErrorToastDecision(failureFromAxiosError(forbidden, { ...ctx, meta: { path: "/suppliers", method: "POST" } })).reason, "no-read-permission");
});

// ── the toaster: one toast per text within the dedupe window ──
test("toaster: shows once, de-duplicates retries and parallel failures, shows again after the window", () => {
  let now = 1000;
  const shown = [];
  const toaster = createApiErrorToaster({ show: (m) => shown.push(m), now: () => now });
  const f = serverError("Server busy");
  assert.equal(toaster(f).show, true);
  assert.deepEqual(toaster(f), { show: false, reason: "duplicate" }); // parallel call, same text
  now += DEDUPE_MS - 1;
  assert.deepEqual(toaster(f), { show: false, reason: "duplicate" }); // React Query retry
  assert.equal(toaster(serverError("Other text")).show, true); // a different failure still shows
  now += 1;
  assert.equal(toaster(f).show, true);
  assert.deepEqual(shown, ["Server busy", "Other text", "Server busy"]);
});

test("toaster: handled, quiet and cancelled failures never reach the toast", () => {
  const shown = [];
  const toaster = createApiErrorToaster({ show: (m) => shown.push(m) });
  toaster({ ...serverError("A"), flags: { ownError: true } });
  toaster({ ...serverError("B"), flags: { quiet: true } });
  toaster({ ...onScreen, cancelled: true });
  toaster({ ...serverError("C"), currentPath: "/portal/elsewhere" });
  toaster(serverError("D", 401));
  assert.deepEqual(shown, []);
});

test("isReadCall: GET, or a POST the API logs as a view (its VIEW_POST_RE)", () => {
  assert.equal(isReadCall("GET", "/anything"), true);
  assert.equal(isReadCall(undefined, undefined), true);
  assert.equal(isReadCall("DELETE", "/customers"), false);
  assert.equal(isReadCall("PATCH", "/documents/paginated"), false);
  assert.equal(isReadCall("POST", "/documentTemplates/variants/QUOTATION/design-preview"), true);
});

test("READ_POST_RE is the API's VIEW_POST_RE (kept in step)", async () => {
  const { readFileSync, existsSync } = await import("node:fs");
  const { READ_POST_RE } = await import("./apiErrorToast.ts");
  const api = new URL("../../api-server-production/src/action-log/action-log.interceptor.ts", import.meta.url);
  if (!existsSync(api)) return; // portal checked out on its own
  const src = /const VIEW_POST_RE =\s*(\/.*\/);/.exec(readFileSync(api, "utf8"))?.[1];
  assert.equal(READ_POST_RE.source, new RegExp(src.slice(1, -1)).source);
});
