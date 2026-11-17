// Run: npm test (node --test). In-app Back (features.enableWctDocNav): history back when there is an in-app
// previous page, else the parent list; setting off = the parent list, exactly as before.
import { test } from "node:test";
import assert from "node:assert/strict";
import { NAV_DEPTH_KEY, backAction, installAppNavTracker, navDepth, stampNavState } from "./appNav.ts";

// A browser-like history: entries + index, pushState truncates forward entries, back() moves the index.
function fakeBrowser(firstUrl, firstState = null) {
  const h = {
    entries: [{ url: firstUrl, state: firstState }],
    i: 0,
    get state() {
      return h.entries[h.i].state;
    },
    get url() {
      return h.entries[h.i].url;
    },
    pushState(data, _u, url) {
      h.entries = h.entries.slice(0, h.i + 1);
      h.entries.push({ url: url ?? h.url, state: data });
      h.i += 1;
    },
    replaceState(data, _u, url) {
      h.entries[h.i] = { url: url ?? h.url, state: data };
    },
    back() {
      if (h.i > 0) h.i -= 1;
    },
  };
  return h;
}

// What a Back button does, as the hook runs it: history back or push the fallback.
function pressBack(h, enabled, fallback) {
  const a = backAction({ enabled, depth: navDepth(h.state), fallback });
  if (a.kind === "history") h.back();
  else h.pushState({ __NA: true }, "", a.href);
  return a;
}

const ORDER = "/portal/orders/o1";
const DO = "/portal/documents/DELIVERY_ORDER/t1/d1";
const DO_LIST = "/portal/sales/delivery-orders";

test("Orders > order > DO > Back returns to the order (history back), then Back again to the Orders list", () => {
  const h = fakeBrowser("/portal/orders?status=DO_DRAFT", { __NA: true });
  assert.equal(installAppNavTracker(h), true);
  h.pushState({ __NA: true }, "", ORDER);
  h.pushState({ __NA: true }, "", DO);
  assert.equal(navDepth(h.state), 2);
  assert.deepEqual(pressBack(h, true, DO_LIST), { kind: "history" });
  assert.equal(h.url, ORDER);
  pressBack(h, true, "/portal/orders");
  // The list keeps its filter: it is the same history entry the browser had.
  assert.equal(h.url, "/portal/orders?status=DO_DRAFT");
});

test("DO opened directly (link, new tab, first page): Back falls back to the parent list", () => {
  const h = fakeBrowser(DO, null);
  installAppNavTracker(h);
  assert.equal(navDepth(h.state), 0);
  assert.deepEqual(pressBack(h, true, DO_LIST), { kind: "push", href: DO_LIST });
  assert.equal(h.url, DO_LIST);
});

test("setting off: Back always goes to the parent list, even after in-app navigation (unchanged behaviour)", () => {
  const h = fakeBrowser("/portal/orders", { __NA: true });
  installAppNavTracker(h);
  h.pushState({ __NA: true }, "", ORDER);
  h.pushState({ __NA: true }, "", DO);
  assert.deepEqual(pressBack(h, false, DO_LIST), { kind: "push", href: DO_LIST });
  assert.equal(h.url, DO_LIST);
  assert.deepEqual(backAction({ enabled: false, depth: 5, fallback: "/x" }), { kind: "push", href: "/x" });
});

test("replace keeps the depth (filters, Next.js state syncs); push after going back counts from there", () => {
  const h = fakeBrowser("/portal/orders", { __NA: true });
  installAppNavTracker(h);
  h.pushState({ __NA: true }, "", ORDER);
  h.replaceState({ __NA: true, tree: 1 }, "", ORDER + "?open=x");
  assert.equal(navDepth(h.state), 1);
  assert.equal(h.state.tree, 1, "the router's own state is kept");
  h.back();
  assert.equal(navDepth(h.state), 0);
  h.pushState({ __NA: true }, "", DO);
  assert.equal(navDepth(h.state), 1);
});

test("a refresh keeps history.state, so the marker still matches the entry", () => {
  const h = fakeBrowser("/portal/orders", { __NA: true });
  installAppNavTracker(h);
  h.pushState({ __NA: true }, "", ORDER);
  // Refresh: the browser keeps the entry's state; the app re-installs and the router replaces its state.
  installAppNavTracker(h);
  h.replaceState({ __NA: true }, "", ORDER);
  assert.equal(navDepth(h.state), 1);
});

test("installing twice wraps once; odd states are left alone", () => {
  const h = fakeBrowser("/a", null);
  assert.equal(installAppNavTracker(h), true);
  assert.equal(installAppNavTracker(h), false);
  h.pushState(null, "", "/b");
  assert.deepEqual(h.state, { [NAV_DEPTH_KEY]: 1 });
  assert.equal(stampNavState("push", "str", null), "str");
  assert.equal(navDepth(undefined), 0);
  assert.equal(navDepth({ [NAV_DEPTH_KEY]: -3 }), 0);
  assert.equal(navDepth({ [NAV_DEPTH_KEY]: "2" }), 0);
  assert.equal(installAppNavTracker(undefined), false);
});
