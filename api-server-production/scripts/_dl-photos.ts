import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import * as fs from "fs";
const KEYS = ["do-start/13d661f0.jpg","do-start/7379b878.jpg","do-start/03dca29b.jpg","do-start/e634e565.jpg","do-start/b7002206.jpg","do-start/e50781fa.jpg"];
const OUT = "/private/tmp/claude-501/-Users-guru-Documents-GitHub-aims/6e733d78-df86-4e60-8e0d-938d4a93fe47/scratchpad";
(async () => {
  const s3 = new S3Client({ region: process.env.AWS_REGION || "ap-southeast-1" });
  const bucket = process.env.RESOURCE_BUCKET || "";
  console.log("bucket:", bucket);
  for (const k of KEYS) {
    const r = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: k }));
    const buf = Buffer.from(await r.Body!.transformToByteArray());
    const f = OUT + "/" + k.split("/")[1];
    fs.writeFileSync(f, buf);
    console.log("↓", f, buf.length, "bytes");
  }
  process.exit(0);
})().catch(e => { console.error("FATAL", e?.message); process.exit(1); });
