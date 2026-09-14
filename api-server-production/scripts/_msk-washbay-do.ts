// DO for MSK Star Engineering — 2x Washing Bay, delivered 14/09/2026 (guru),
// with the 8 WhatsApp site photos uploaded to S3 and attached to the line.
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { createScriptPrisma, BIOFUEL_ORG_ID as ORG } from "./xero-migration/_common";
import * as fs from "fs";
import * as crypto from "crypto";
const prisma = createScriptPrisma();
const TPL = "b4898f54-fec8-46dd-a3be-52fc47e34c05";
const DIR = "/Users/guru/Downloads";
(async () => {
  const files = fs.readdirSync(DIR).filter(f => f.startsWith("WhatsApp Image 2026-09-14 at 15.02")).sort();
  if (files.length !== 8) console.log(`note: found ${files.length} photos`);
  const s3 = new S3Client({ region: process.env.AWS_REGION || "ap-southeast-1" });
  const keys: string[] = [];
  for (const f of files) {
    const key = `do-start/${crypto.randomBytes(4).toString("hex")}.jpg`;
    await s3.send(new PutObjectCommand({ Bucket: process.env.RESOURCE_BUCKET!, Key: key, Body: fs.readFileSync(`${DIR}/${f}`), ContentType: "image/jpeg" }));
    keys.push(key);
    console.log("↑", f.slice(-12), "→", key);
  }
  const cust = await prisma.customer.findUnique({ where: { id: "4a1e64bd".length === 8 ? undefined as any : "" } }).catch(() => null);
  const msk = await prisma.customer.findFirst({ where: { organizationId: ORG, name: { contains: "MSK Star" } }, select: { id: true, name: true, address: true } });
  // next portal-series DO number
  const dos = await prisma.document.findMany({ where: { organizationId: ORG, name: { startsWith: "DO202609-0" } }, select: { name: true } });
  const max = Math.max(0, ...dos.map(d => parseInt(d.name!.slice(-4), 10)).filter(n => isFinite(n)));
  const name = `DO202609-${String(max + 1).padStart(4, "0")}`;
  await prisma.document.create({ data: {
    organizationId: ORG, type: "DELIVERY_ORDER", name, status: "delivered_installed" as any, documentTemplateId: TPL,
    config: {
      date: "2026-09-14",
      customerId: msk!.id, customerName: msk!.name,
      billTo: `${msk!.name}\n${String(msk!.address || "").split(/, */).join("\n")}\nAttn: Accounts Dept.`,
      deliveryTo: "Jurong Port (site per delivery photos — confirm exact address)",
      items: [
        { quantity: 2, deploymentType: "RENTAL", description: "2 units Washing Bay (wheel wash system) c/w ramps", proofPhotos: keys },
      ],
      referenceNo: `${name} · 2x Washing Bay · delivered 14/09/2026`,
      documentInfo: { referenceNo: "2x Washing Bay · 14/09/2026" },
      remarks: "Created 14/09 per guru from 8 site photos (WhatsApp 15:02). Site looks like Jurong Port wharf (DSV shed in frame) — confirm exact address, PO/quote and rental-vs-sale for billing.",
      createdBy: "guru via Claude 2026-09-14",
    },
  } });
  console.log(`✓ ${name} created · MSK Star Engineering · 2x Washing Bay · 8 photos attached`);
  process.exit(0);
})().catch(e => { console.error("FATAL", e?.message); process.exit(1); });
