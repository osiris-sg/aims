import { test } from "node:test";
import assert from "node:assert/strict";
import { newTabHref, newTabProps } from "./newTab.ts";

const ORG = "5c700000-0000-4000-8000-5c7000000004";
test("job links open in a new tab in the right company", () => {
  assert.equal(newTabHref("/portal/orders/abc", ORG), `/portal/open-in-org?org=${encodeURIComponent(ORG)}&to=${encodeURIComponent("/portal/orders/abc")}`);
  // The tab's current company when the link has none of its own.
  assert.equal(newTabHref("/portal/documents/open/x1", null, ORG), `/portal/open-in-org?org=${encodeURIComponent(ORG)}&to=${encodeURIComponent("/portal/documents/open/x1")}`);
  // No company known (single-company user, no window): the plain link.
  assert.equal(newTabHref("/portal/orders/abc", null, null), "/portal/orders/abc");
  // A link with a query string or outside the portal is never wrapped.
  assert.equal(newTabHref("/portal/orders/abc?x=1", ORG), "/portal/orders/abc?x=1");
  assert.equal(newTabHref("https://evil.example/x", ORG), "https://evil.example/x");
  assert.deepEqual(newTabProps, { target: "_blank", rel: "noopener noreferrer" });
});
