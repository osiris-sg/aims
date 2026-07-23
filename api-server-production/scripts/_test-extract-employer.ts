import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import * as fs from "fs";
const env = fs.readFileSync(".env.production", "utf8");
const g = (k: string) => env.match(new RegExp(`^${k}="?([^"\\n]+)"?`, "m"))?.[1];
const s3 = new S3Client({ region: g("AWS_REGION") || "ap-southeast-1", credentials: { accessKeyId: g("AWS_ACCESS_KEY_ID")!, secretAccessKey: g("AWS_SECRET_ACCESS_KEY")! } });
const pdfParse = require("pdf-parse");
(async () => {
  const key = "jp-pass-import/52e90ba8-bfbd-48b0-bb76-4f9667bf74f1/JP2604150059_C89430BD_1776225665.pdf";
  const res = await s3.send(new GetObjectCommand({ Bucket: g("RESOURCE_BUCKET") || "aims-osiris", Key: key }));
  const buf = Buffer.from(await res.Body!.transformToByteArray());
  const { text } = await pdfParse(buf);
  console.log("----- raw text (first 900 chars) -----");
  console.log(text.slice(0, 900));
})();
