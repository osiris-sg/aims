// Pin source paper onto every doc: (a) portal-uploaded docs — pin their S3
// source scan; (b) folder-backfilled docs — upload the folder PDF to S3 and
// attach. Idempotent by fileKey.
import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import * as fs from "fs";
import * as crypto from "crypto";
const prisma = createScriptPrisma();
const DIR = "/Users/guru/Downloads/Rental PO and DO";
const s3 = new S3Client({ region: "ap-southeast-1" });
(async () => {
  const docs = await prisma.document.findMany({ where: { organizationId: ORG }, select: { id: true, name: true, attachments: true, config: true } });
  let pinnedA = 0, pinnedB = 0, missing = 0, skip = 0;
  for (const d of docs) {
    const c: any = d.config || {};
    const existing = (d.attachments as any[]) || [];
    // (a) portal-uploaded source
    const srcUrl = c.source?.fileUrl || c.sourceFileUrl;
    if (srcUrl) {
      try {
        const key = decodeURIComponent(new URL(srcUrl).pathname.slice(1));
        if (!existing.some(a => a.fileKey === key)) {
          existing.push({ fileKey: key, fileName: `Original upload — ${d.name}${key.toLowerCase().endsWith(".pdf") ? ".pdf" : ".jpg"}`, mimeType: key.toLowerCase().endsWith(".pdf") ? "application/pdf" : "image/jpeg", label: "Source document (uploaded original)", uploadedAt: new Date().toISOString(), uploadedBy: "claude scan-pin 2026-09-15" });
          await prisma.document.update({ where: { id: d.id }, data: { attachments: existing as any } });
          pinnedA++;
        } else skip++;
      } catch {}
      continue;
    }
    // (b) folder-backfilled
    const m = /folder scan "([^"]+)/.exec(String(c.remarks || ""));
    if (!m) continue;
    let fname = m[1];
    // remark may have truncated the name — resolve by prefix match
    let path = `${DIR}/${fname}`;
    if (!fs.existsSync(path)) {
      const cand = fs.readdirSync(DIR).find(f => f.startsWith(fname.slice(0, 60)));
      if (!cand) { missing++; continue; }
      path = `${DIR}/${cand}`; fname = cand;
    }
    if (existing.some(a => a.label === "Signed scan (from Rental PO and DO folder)")) { skip++; continue; }
    const key = `attachments/${ORG}/${crypto.randomBytes(6).toString("hex")}.pdf`;
    await s3.send(new PutObjectCommand({ Bucket: process.env.RESOURCE_BUCKET!, Key: key, Body: fs.readFileSync(path), ContentType: "application/pdf" }));
    existing.push({ fileKey: key, fileName: fname.slice(0, 120), mimeType: "application/pdf", label: "Signed scan (from Rental PO and DO folder)", uploadedAt: new Date().toISOString(), uploadedBy: "claude scan-pin 2026-09-15" });
    await prisma.document.update({ where: { id: d.id }, data: { attachments: existing as any } });
    pinnedB++;
    if (pinnedB % 50 === 0) console.log(`  …${pinnedB} folder scans attached`);
  }
  console.log(`✓ pinned: ${pinnedA} portal-source scans · ${pinnedB} folder PDFs uploaded+attached · ${skip} already done · ${missing} files not found`);
  process.exit(0);
})().catch(e => { console.error("FATAL", e?.message); process.exit(1); });
