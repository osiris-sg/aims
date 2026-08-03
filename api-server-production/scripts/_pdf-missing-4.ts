import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import * as fs from "fs";
import ws = require("ws");
neonConfig.webSocketConstructor = ws as unknown as typeof WebSocket;
const prod = new PrismaClient({ adapter: new PrismaNeon({ connectionString: fs.readFileSync(".env.production", "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m)![1] }) } as any);
const env = fs.readFileSync(".env.production", "utf8");
const g = (k: string) => env.match(new RegExp(`^${k}="?([^"\\n]+)"?`, "m"))?.[1];
const s3 = new S3Client({ region: g("AWS_REGION") || "ap-southeast-1", credentials: { accessKeyId: g("AWS_ACCESS_KEY_ID")!, secretAccessKey: g("AWS_SECRET_ACCESS_KEY")! } });
const pdfParse = require("pdf-parse");
const ORG = "52e90ba8-bfbd-48b0-bb76-4f9667bf74f1";
(async () => {
  for (const name of ["BIPL-JPSG-INV-20260721-0036", "BIPL-JPSG-INV-20260721-0038"]) {
    const inv = await prod.document.findFirst({ where: { organizationId: ORG, type: "INVOICE", name }, select: { config: true } });
    const c: any = inv?.config || {};
    const url: string = c.sourceFileUrl || c.source?.fileUrl || "";
    const key = url.split(".amazonaws.com/")[1];
    if (!key) { console.log(`${name}: no source PDF stored`); continue; }
    const res = await s3.send(new GetObjectCommand({ Bucket: g("RESOURCE_BUCKET") || "aims-osiris", Key: decodeURIComponent(key) }));
    const { text } = await pdfParse(Buffer.from(await res.Body!.transformToByteArray()));
    const listed = [...new Set([...text.matchAll(/(JP26\d{8})/g)].map(m => m[1]))];
    const linked = await prod.document.findMany({ where: { organizationId: ORG, type: "BILL", config: { path: ["reference"], equals: name } }, select: { name: true } });
    const have = new Set(linked.map(l => l.name));
    console.log(`${name}: PDF lists ${listed.length} bills → MISSING from AIMS: ${listed.filter(x => !have.has(x)).join(", ") || "none?"}`);
  }
  await prod.$disconnect();
})();
