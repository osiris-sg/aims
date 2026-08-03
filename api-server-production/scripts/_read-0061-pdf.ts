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
  const b = await prod.document.findFirst({
    where: { organizationId: ORG, type: "BILL", name: "JP2604300061" },
    select: { attachments: true },
  });
  const key = (b?.attachments as any[])?.[0]?.fileKey;
  const res = await s3.send(new GetObjectCommand({ Bucket: g("RESOURCE_BUCKET") || "aims-osiris", Key: key }));
  const { text } = await pdfParse(Buffer.from(await res.Body!.transformToByteArray()));
  console.log(text.slice(0, 1100));
  await prod.$disconnect();
})();
