// Job photos from SiteClock: helpers/jobPhotos.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { photoCaption, jobHeading, urlsStale, siteclockEvidenceCaption } from "./jobPhotos.ts";

test("photoCaption: worker and the time taken (Singapore), else when it arrived", () => {
  assert.equal(photoCaption({ workerName: "Ali", takenAt: "2026-11-02T06:30:00Z", uploadedAt: "2026-11-02T07:00:00Z" }), "Ali · 2 Nov, 14:30");
  assert.equal(photoCaption({ workerName: null, takenAt: null, uploadedAt: "2026-11-02T07:00:00Z" }), "SiteClock · 2 Nov, 15:00");
});

test("jobHeading: job number, DO number and day", () => {
  assert.equal(jobHeading({ deliveryNumber: 11, doNumber: "DO202611009", scheduledFor: "2026-11-04T06:00:00Z" }), "Job #11 · DO202611009 · 4 Nov");
  assert.equal(jobHeading({ deliveryNumber: 12, doNumber: null, scheduledFor: null }), "Job #12");
});

test("urlsStale: true within a minute of expiry", () => {
  const now = Date.parse("2026-11-02T10:00:00Z");
  assert.equal(urlsStale([{ urlExpiresAt: "2026-11-02T10:10:00Z" }], now), false);
  assert.equal(urlsStale([{ urlExpiresAt: "2026-11-02T10:00:30Z" }], now), true);
  assert.equal(urlsStale([], now), false);
});

test("siteclockEvidenceCaption: only for keys that came from SiteClock", () => {
  const sc = [{ key: "job-photos/o/d/p.jpg", workerName: "Ali" }];
  assert.equal(siteclockEvidenceCaption("job-photos/o/d/p.jpg", sc), "SiteClock · Ali");
  assert.equal(siteclockEvidenceCaption("uploads/field.jpg", sc), null);
  assert.equal(siteclockEvidenceCaption("x", undefined), null);
});
