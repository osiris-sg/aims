// Run: npm test (node --test, Node's built-in TypeScript stripping).
// Round T: the email view's safety helpers — DOMPurify config shape, "Load images" restores https only, text → safe HTML, frame document CSP.
import { test } from "node:test";
import assert from "node:assert/strict";
import { FRAME_SANDBOX, frameDocument, PURIFY_CONFIG, restoreRemoteImages, textToHtml, fmtSize } from "../app/portal/shipments/_lib/email-html.ts";

test("the sanitiser allowlist has no script / form / iframe / style, no event handlers, no data attributes except the blocked-image markers", () => {
  for (const t of ["script", "iframe", "form", "input", "object", "embed", "meta", "link", "base", "style", "svg"]) {
    assert.ok(!PURIFY_CONFIG.ALLOWED_TAGS.includes(t), `${t} must not be allowed`);
    assert.ok(PURIFY_CONFIG.FORBID_TAGS.includes(t) || t === "style" || t === "input", `${t} should be forbidden`);
  }
  assert.ok(!PURIFY_CONFIG.ALLOWED_ATTR.some((a) => /^on/i.test(a)));
  assert.equal(PURIFY_CONFIG.ALLOW_DATA_ATTR, false);
  assert.ok(PURIFY_CONFIG.ALLOWED_ATTR.includes("data-aims-src"));
  assert.ok(PURIFY_CONFIG.ALLOWED_URI_REGEXP.test("https://x/y.png"));
  assert.ok(PURIFY_CONFIG.ALLOWED_URI_REGEXP.test("cid:logo"));
  assert.ok(!PURIFY_CONFIG.ALLOWED_URI_REGEXP.test("javascript:alert(1)"));
  assert.ok(!PURIFY_CONFIG.ALLOWED_URI_REGEXP.test("http://plain.example/a.png"));
});

test("Load images restores https images only; javascript: / http: / file: stay blocked", () => {
  const html = '<img data-aims-src="https://ok.example/a.png"><img data-aims-src="http://plain.example/b.png"><img data-aims-src="javascript:alert(1)"><img data-aims-src="file:///etc/passwd"><img data-aims-srcset="https://ok.example/c.png 1x">';
  const out = restoreRemoteImages(html);
  assert.ok(out.includes('src="https://ok.example/a.png"'));
  assert.ok(out.includes('srcset="https://ok.example/c.png 1x"'));
  assert.ok(out.includes('data-aims-src="http://plain.example/b.png"'));
  assert.ok(out.includes('data-aims-src="javascript:alert(1)"'));
  assert.ok(out.includes('data-aims-src="file:///etc/passwd"'));
});

test("plain text is escaped, the frame is fully sandboxed with a no-network CSP", () => {
  assert.equal(textToHtml("<b>x</b> & y"), '<pre style="white-space:pre-wrap;word-break:break-word;font:14px/1.5 system-ui,sans-serif;margin:0">&lt;b&gt;x&lt;/b&gt; &amp; y</pre>');
  assert.equal(FRAME_SANDBOX, "");
  const doc = frameDocument("<p>hi</p>", true);
  assert.ok(doc.includes("default-src 'none'"));
  assert.ok(doc.includes('<base target="_blank">'));
  assert.ok(doc.includes("<p>hi</p>"));
  assert.ok(!/script-src/.test(doc));
});

test("attachment sizes read like an email client", () => {
  assert.equal(fmtSize(512), "512 B");
  assert.equal(fmtSize(20480), "20 KB");
  assert.equal(fmtSize(3 * 1024 * 1024), "3.0 MB");
});
