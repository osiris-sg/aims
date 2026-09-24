import { request } from "@/helpers/request";
import { uploadImage } from "@/helpers/imageUploader";

/**
 * SIGNING A MAINTENANCE REPORT — the one place that knows how.
 *
 * Extracted from the single-report sign screen so that screen and the batch
 * screen cannot drift. Both upload the same way, into the same folder, and post
 * the same body to the same endpoint: POST /maintenance-reports/:id/sign, which
 * has always existed for exactly this. There is no batch endpoint and
 * deliberately so — the per-report call carries every guard (it refuses a report
 * already `completed`), every side effect (the deferred customer email, the
 * delivery transitions) and every future change to signing, for free.
 */

/** The folder the field has always uploaded signatures into. Do not change it. */
export const SIGNATURE_FOLDER = "maintenance-reports";

export interface SignaturePair {
  /** S3 key of the technician's signature, e.g. "maintenance-reports/ab12cd34.png". */
  techKey: string;
  /** S3 key of the client's signature. */
  clientKey: string;
}

const dataUrlToBlob = async (dataUrl: string): Promise<Blob> => (await fetch(dataUrl)).blob();

/**
 * Upload ONE technician + client signature pair and return their S3 keys.
 *
 * A batch uploads this pair ONCE and reuses the two keys across every report in
 * it. That is the honest record: one person signed one piece of paper covering
 * three machines, so the three reports genuinely reference the same image. It
 * also means N reports cost 2 uploads rather than 2N — the difference between a
 * batch that completes on a weak site connection and one that does not — and a
 * later fix to a mis-drawn signature corrects every report at once.
 *
 * uploadImage swallows its own errors and returns "", so an empty key is the
 * failure signal and is converted to a thrown Error here rather than being
 * allowed to reach the server as a signed report with no image.
 */
export async function uploadSignaturePair(
  techDataUrl: string,
  clientDataUrl: string,
  token: string,
): Promise<SignaturePair> {
  const [techKey, clientKey] = await Promise.all([
    uploadImage({ blob: await dataUrlToBlob(techDataUrl), folderName: SIGNATURE_FOLDER, token }),
    uploadImage({ blob: await dataUrlToBlob(clientDataUrl), folderName: SIGNATURE_FOLDER, token }),
  ]);
  if (!techKey || !clientKey) {
    throw new Error(
      "Your signatures could not be uploaded — the connection dropped. " +
        "They are still on screen: move somewhere with signal and try again.",
    );
  }
  return { techKey, clientKey };
}

/**
 * Sign ONE report with an already-uploaded pair.
 *
 * ONE call finishes the report: the gate column (`signature`), the name, and
 * both signature images that the renderers actually draw. Split across two calls
 * the second could fail alone and leave a "signed" report showing no signature.
 */
export async function signOneReport(
  reportId: string,
  pair: SignaturePair,
  clientName: string,
  token: string,
): Promise<void> {
  const res = await request(
    { path: `/maintenance-reports/${reportId}/sign`, method: "POST" },
    {
      signature: pair.clientKey,
      signedByName: clientName.trim() || undefined,
      techSignatureKey: pair.techKey,
      clientSignatureKey: pair.clientKey,
    },
    token,
  );
  if (res?.success === false) throw new Error(res?.message ?? "Could not sign the report");
}

export interface BatchSignResult {
  reportId: string;
  ok: boolean;
  error?: string;
}

/**
 * Sign several reports with one signature pair.
 *
 * NOT all-or-nothing, and that is the deliberate choice. There is no cross-report
 * transaction to roll back into — each report is its own row with its own email
 * and its own downstream effects, and an already-committed signature cannot be
 * un-sent. More importantly, partial success is the RECOVERABLE state: a report
 * that failed simply stays in Pending Sign, and the technician retries it while
 * still standing in front of the client. Rolling three good signatures back
 * because the fourth timed out would ask that client to sign again for work
 * already acknowledged.
 *
 * SEQUENTIAL, not Promise.all: a field phone on one bar of signal handles four
 * requests in a row far better than four at once, and a failure part-way leaves a
 * clean, reportable boundary rather than a scramble.
 */
export async function signReports(
  reportIds: string[],
  pair: SignaturePair,
  clientName: string,
  token: string,
): Promise<BatchSignResult[]> {
  const results: BatchSignResult[] = [];
  for (const id of reportIds) {
    try {
      await signOneReport(id, pair, clientName, token);
      results.push({ reportId: id, ok: true });
    } catch (e: any) {
      results.push({ reportId: id, ok: false, error: e?.message ?? "Could not sign this report" });
    }
  }
  return results;
}
