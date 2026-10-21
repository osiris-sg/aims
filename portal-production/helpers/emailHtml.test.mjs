// Run: npm test (node --test, Node's built-in TypeScript stripping).
// Round T: the email view's safety helpers — DOMPurify config shape, "Load images" restores https only, text → safe HTML, frame document CSP.
// Round W (Part C.1): emails render in OUR style — presentation stripped, client junk removed, signature split off, links decorated.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FRAME_SANDBOX, frameDocument, PURIFY_CONFIG, restoreRemoteImages, textToHtml, fmtSize,
  FRAME_FONT_STACK, restyleEmailHtml, stripClientJunk, stripPresentation, isTrackingPixel, splitSignature, decorateLinks, stripTags, estimateFrameHeight,
} from "../app/portal/shipments/_lib/email-html.ts";

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

// ── Round W ──

test("the sender's presentation is stripped: style / bgcolor / color / face / size / width on non-images, <font> + <center> unwrapped; images keep src + size", () => {
  const html = '<center><p style="color:#000;font-family:Arial;background:#fff" bgcolor="#ffffff" align="center"><font face="Arial" color="red" size="2">Hi <b style="color:blue">there</b></font></p></center><table width="600" border="1" cellpadding="2" cellspacing="0" style="background:url(x)"><tr><td width="50" bgcolor="#eee" valign="top" colspan="2">a</td></tr></table><img src="cid:logo" width="100" height="50" style="display:block" alt="Logo">';
  const out = stripPresentation(html);
  for (const a of ["style=", "bgcolor=", "color=", "face=", "size=", "background", "align=", "valign=", "border=", "cellpadding=", "cellspacing="]) assert.ok(!out.includes(a), `${a} must be gone: ${out}`);
  assert.ok(!/<\/?font/i.test(out) && !/<\/?center/i.test(out));
  assert.ok(out.includes("<p>Hi <b>there</b></p>"));
  assert.ok(out.includes('<td colspan="2">a</td>'));
  assert.ok(out.includes('<img src="cid:logo" width="100" height="50" alt="Logo">'));
  assert.ok(!out.includes('width="600"'));
});

test("Outlook 'You don't often get email from' banner (en + ja) and the CAUTION banner go, the message stays", () => {
  const en = '<table><tr><td style="background:#a6a6a6"><div>You don\u2019t often get email from taro@kato.co.jp. <a href="https://aka.ms/LearnAboutSenderIdentification">Learn why this is important</a></div></td></tr></table><p>Please find the B/L attached.</p>';
  const r1 = stripClientJunk(en);
  assert.ok(!/often get email|aka\.ms/.test(r1.html), r1.html);
  assert.ok(r1.html.includes("<p>Please find the B/L attached.</p>"));
  assert.ok(!/<table/.test(r1.html), "the banner's shell table is gone too");
  assert.ok(r1.removed.includes("sender banner"));
  const ja = '<div><p>このメールの送信者からメールを受け取ることはあまりありません。<a href="https://aka.ms/LearnAboutSenderIdentification">これが重要である理由</a></p></div><p>船積書類を添付いたします。</p>';
  const r2 = stripClientJunk(ja);
  assert.ok(!r2.html.includes("あまりありません"));
  assert.ok(r2.html.includes("船積書類を添付いたします。"));
  const caution = '<p>CAUTION: This email originated from outside of the organization. Do not click links.</p><p>Body.</p>';
  assert.equal(stripClientJunk(caution).html, "<p>Body.</p>");
});

test("[EXTERNAL] / 【外部】 tags are removed from the text", () => {
  const r = stripClientJunk("<p>[EXTERNAL] Re: Booking 123</p><p>【外部】ご連絡</p><p>[External] x [EXT] y</p>");
  assert.equal(r.html, "<p>Re: Booking 123</p><p>ご連絡</p><p>x y</p>");
  assert.ok(r.removed.includes("external tag"));
});

test("tracking pixels (1×1, ≤ 2px, hidden) are removed; real images stay", () => {
  assert.ok(isTrackingPixel('<img src="https://t.example/p.gif" width="1" height="1">'));
  assert.ok(isTrackingPixel('<img data-aims-src="https://t.example/p" style="width:1px;height:1px;border:0">'));
  assert.ok(isTrackingPixel('<img data-aims-src="https://t.example/p" width="2" height="2">'));
  assert.ok(isTrackingPixel('<img data-aims-src="https://t.example/p" style="display:none">'));
  assert.ok(!isTrackingPixel('<img src="cid:logo" width="200" height="60">'));
  assert.ok(!isTrackingPixel('<img src="cid:photo">'));
  const r = stripClientJunk('<p>Hi</p><img data-aims-src="https://t.example/open?id=1" width="1" height="1"><img src="cid:logo" width="200">');
  assert.equal(r.html, '<p>Hi</p><img src="cid:logo" width="200">');
  assert.ok(r.removed.includes("tracking pixel"));
});

test("spacer tables / empty rows go, &nbsp;-only paragraph runs collapse, data tables stay", () => {
  const r = stripClientJunk('<table><tr><td>&nbsp;</td></tr></table><p>&nbsp;</p><p>&nbsp;</p><div><br></div><p>Text</p><table><tr><td height="20"></td></tr><tr><td>Qty</td><td>10</td></tr></table><table><tr><td><img src="cid:logo"></td></tr></table>');
  assert.ok(!r.html.includes("<td>&nbsp;</td>"), r.html);
  assert.ok(r.html.includes("<p>Text</p>"));
  assert.ok(r.html.includes("<td>Qty</td><td>10</td>"), "the data table stays");
  assert.ok(!r.html.includes('<td height="20"></td>'), "the empty spacer row goes");
  assert.ok(r.html.includes('<img src="cid:logo">'), "an image-only table is content");
  assert.ok(!/(<br>\s*){3,}/.test(r.html), "no runs of 3+ breaks");
  assert.ok(!/^\s*<br>/.test(r.html), "no leading break");
  assert.ok(r.removed.some((x) => /spacer table/.test(x)));
});

test("the signature is split off: a -- delimiter, or the trailing contact block (en + ja), never the sign-off or the first line", () => {
  const delim = "<p>Please confirm the ETA.</p><p>Thanks</p><p>-- </p><p>Taro Yamada</p><p>TEL 03-1234-5678</p>";
  const s1 = splitSignature(delim);
  assert.equal(s1.body, "<p>Please confirm the ETA.</p><p>Thanks</p>");
  assert.ok(s1.signature.startsWith("<p>-- </p><p>Taro Yamada</p>"));

  const en = "<div>Hi Elroy,</div><div>Please see the attached PO for the November shipment.</div><div><br></div><div>Best regards,</div><div>Taro Yamada</div><div>Kato Co., Ltd.</div><div>TEL +81-3-1234-5678 / FAX +81-3-1234-5679</div><div>taro@kato.co.jp</div>";
  const s2 = splitSignature(en);
  assert.ok(s2.body.endsWith("<div>Best regards,</div>"), s2.body);
  assert.ok(s2.signature.startsWith("<div>Taro Yamada</div>"), s2.signature);
  assert.ok(s2.signature.includes("FAX"));

  const ja = "<p>加藤様</p><p>お世話になっております。11月分の船積スケジュールをご確認ください。</p><p>よろしくお願いいたします。</p><p>山田太郎</p><p>株式会社加藤商事　営業部</p><p>〒100-0001 東京都千代田区1-1-1</p><p>TEL：03-1234-5678　FAX：03-1234-5679</p><p>このメールは機密情報を含みます。誤って受信された場合は破棄してください。</p>";
  const s3 = splitSignature(ja);
  assert.ok(s3.body.endsWith("<p>よろしくお願いいたします。</p>"), s3.body);
  assert.ok(s3.signature.startsWith("<p>山田太郎</p>"), s3.signature);
  assert.ok(s3.signature.includes("機密"));

  // Gmail: the signature div, with a company line that ends in "Ltd." (not a sentence) and a logo.
  const gmail = '<div dir="ltr"><div>Hi Elroy,</div><div><br></div><div>Draft B/L attached, please check.</div><div><br></div><div>Thanks,</div><div>Sayaka</div><div class="gmail_signature"><div>Sayaka Ito | Hoei Trading Co., Ltd.</div><div>Mobile +81 90 1234 5678 · <a href="mailto:s@hoei.co.jp">s@hoei.co.jp</a></div><div><img src="cid:ii_1" width="96" height="96"></div></div></div>';
  const s4 = splitSignature(gmail);
  assert.ok(s4.body.endsWith("<div>Thanks,</div>"), s4.body);
  assert.ok(s4.signature.startsWith("<div>Sayaka</div>") && s4.signature.includes("cid:ii_1"), s4.signature);

  // A short email with no contact block: nothing is split, nothing moves.
  const plain = "<p>Hi,</p><p>Can you call me on +65 9123 4567 to discuss the booking?</p><p>Thanks</p>";
  assert.equal(splitSignature(plain).signature, null);
  // A one-liner never becomes a signature.
  assert.equal(splitSignature("<p>TEL 03-1234-5678</p>").signature, null);
});

test("links open in a new tab with the hostname printed after the text; mailto / tel links are not listed; the list is deduped", () => {
  const r = decorateLinks('<p>See <a href="https://portal.shipper.example/booking/1" style="color:red">the booking</a> or <a href="https://portal.shipper.example/booking/1">again</a>, <a href="https://www.maersk.com/">www.maersk.com</a>, mail <a href="mailto:a@b.c">a@b.c</a>, <a>no href</a></p>');
  assert.ok(r.html.includes('<a href="https://portal.shipper.example/booking/1" target="_blank" rel="noopener noreferrer">the booking</a><span class="aims-host">portal.shipper.example</span>'));
  assert.ok(r.html.includes('>www.maersk.com</a>,'), "no host badge when the text already shows it");
  assert.ok(r.html.includes('<a href="mailto:a@b.c" target="_blank" rel="noopener noreferrer">a@b.c</a>'));
  assert.ok(r.html.includes("no href") && !r.html.includes("<a>no href"));
  assert.deepEqual(r.links, [
    { href: "https://portal.shipper.example/booking/1", text: "the booking", host: "portal.shipper.example" },
    { href: "https://www.maersk.com/", text: "www.maersk.com", host: "www.maersk.com" },
  ]);
});

test("restyleEmailHtml: the whole pipeline on an Outlook-style email, with the data-aims-src markers kept for Load images", () => {
  const html = '<!--[if gte mso 9]><xml></xml><![endif]--><table><tr><td style="background:#a6a6a6"><div>You don\u2019t often get email from taro@kato.co.jp. <a href="https://aka.ms/LearnAboutSenderIdentification">Learn why this is important</a></div></td></tr></table>'
    + '<div class="WordSection1"><p class="MsoNormal" style="color:black;font-family:\'Yu Gothic\'"><span style="font-size:11pt">[EXTERNAL] Dear Elroy,</span></p><p class="MsoNormal"><o:p>&nbsp;</o:p></p>'
    + '<p class="MsoNormal">Please check the <a href="https://portal.shipper.example/booking/1">booking</a>.</p><p class="MsoNormal">&nbsp;</p>'
    + '<p>Best regards,</p><p>Taro Yamada</p><p>Kato Co., Ltd. | TEL +81-3-1234-5678</p><p><a href="https://www.kato.co.jp">www.kato.co.jp</a></p><p><img data-aims-src="https://www.kato.co.jp/logo.png" width="120" height="40"></p>'
    + '<img data-aims-src="https://track.example/o.gif" width="1" height="1"></div>';
  const r = restyleEmailHtml(html);
  assert.ok(!/style=|color=|class="(?:MsoNormal|WordSection1)"|<font|often get email|\[EXTERNAL\]|track\.example/.test(r.html), r.html);
  assert.ok(r.html.includes("Dear Elroy,"));
  assert.ok(r.html.includes('<a href="https://portal.shipper.example/booking/1" target="_blank" rel="noopener noreferrer">booking</a><span class="aims-host">portal.shipper.example</span>'));
  assert.ok(r.html.includes("Best regards,"));
  assert.ok(!r.html.includes("Taro Yamada"), "the signature is out of the body");
  assert.ok(r.signatureHtml && r.signatureHtml.includes("Taro Yamada") && r.signatureHtml.includes("TEL +81-3-1234-5678"));
  assert.ok(r.signatureHtml.includes('<img data-aims-src="https://www.kato.co.jp/logo.png" width="120" height="40">'), "the logo keeps its blocked-image marker + size");
  assert.ok(!r.signatureHtml.includes("track.example"), "the pixel is gone from the signature too");
  assert.ok(restoreRemoteImages(r.signatureHtml).includes('src="https://www.kato.co.jp/logo.png"'), "Load images still works on the restyled html");
  for (const label of ["sender banner", "external tag", "tracking pixel", "signature"]) assert.ok(r.removed.includes(label), `${label} in ${r.removed}`);
  assert.deepEqual(r.links.map((l) => l.host), ["portal.shipper.example", "www.kato.co.jp"]);
});

test("the frame carries the JP font stack at line-height 1.6 and our table style; 'show original' keeps the email's styles on a white page", () => {
  const ours = frameDocument("<p>こんにちは</p>", true);
  assert.ok(ours.includes("'Hiragino Sans','Hiragino Kaku Gothic ProN','Noto Sans JP',Meiryo,sans-serif"));
  assert.ok(ours.includes("14px/1.6"));
  assert.ok(ours.includes("table.aims-grid td"));
  assert.ok(ours.includes("background:#121212"));
  assert.ok(FRAME_FONT_STACK.startsWith("system-ui"));
  const raw = '<p style="color:#000;font-family:Comic Sans MS"><font color="red">Original</font></p>';
  const original = frameDocument(raw, true, { original: true });
  assert.ok(original.includes(raw), "the original view keeps the email's own styles");
  assert.ok(original.includes("background:#ffffff") && original.includes("color:#1a1a1a"), "…on a white page, where those styles were designed to be readable");
  assert.ok(!original.includes("aims-grid"), "no restyling CSS in the original view");
  assert.ok(original.includes("default-src 'none'") && original.includes('<base target="_blank">'), "same CSP + base as before");
});

test("stripTags decodes entities and the frame height follows the text", () => {
  assert.equal(stripTags("<p>a&nbsp;&amp;&nbsp;b</p><p>c</p>"), "a & b c");
  assert.equal(estimateFrameHeight(""), 120);
  assert.ok(estimateFrameHeight("<p>" + "x".repeat(2000) + "</p>") > 500);
  assert.equal(estimateFrameHeight("<p>" + "x".repeat(200000) + "</p>"), 1200);
});
