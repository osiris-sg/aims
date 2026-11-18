/**
 * READ-ONLY: render one saved document to a PDF the way DocumentsService.renderDocumentHtml does (same
 * effectiveDesign + renderer + PdfGeneratorService), from the database at DBURL. Nothing is written to the
 * database and nothing is sent. Logo: the org logo's public S3 URL (or --logo-file <png> to preview a logo
 * not uploaded yet). --features '{"k":v}' overlays org settings for a preview.
 *
 *   DBURL=<url> npx ts-node --transpile-only scripts/_rk-prod-render.ts <documentId> <out.pdf> [--logo-file <png>] [--features <json>]
 */
import * as fs from 'fs';
import { Client, types } from 'pg';
import { renderDocumentHtml, pdfOptionsFor } from '../src/common/services/document-html';
import { effectiveDesign, isImportedDoc } from '../src/common/services/document-html/wct-brand';
import { PdfGeneratorService } from '../src/common/services/pdf-generator.service';

types.setTypeParser(1114, (v) => new Date(`${v.replace(' ', 'T')}Z`));
const arg = (k: string) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : null;
};

(async () => {
  const [id, out] = process.argv.slice(2);
  const c = new Client({ connectionString: process.env.DBURL });
  await c.connect();
  const q = async (s: string, p: any[]) => (await c.query(s, p)).rows;
  const doc = (await q(`select id, type, name, config, "createdAt", "revisionNumber", "documentTemplateId", "organizationId" from "Document" where id=$1`, [id]))[0];
  if (!doc) throw new Error('document not found');
  const org = (await q(`select * from "Organization" where id=$1`, [doc.organizationId]))[0];
  const features = { ...((await q(`select features from "OrganizationUIConfig" where "organizationId"=$1`, [doc.organizationId]))[0]?.features || {}), ...JSON.parse(arg('--features') || '{}') };
  const tpl = (await q(`select "styleConfig", type from "DocumentTemplate" where id=$1`, [doc.documentTemplateId]))[0];
  await c.end();

  const config: any = doc.config || {};
  const design = effectiveDesign(tpl?.styleConfig, tpl?.type, features, { imported: isImportedDoc(config), createdAt: doc.createdAt });
  const logoFile = arg('--logo-file');
  const bucket = process.env.RESOURCE_BUCKET || 'aims-osiris';
  const region = process.env.AWS_REGION || 'ap-southeast-1';
  const logoUrl =
    design.logoPosition === 'none' ? null : logoFile ? `data:image/png;base64,${fs.readFileSync(logoFile).toString('base64')}` : org.logo ? `https://${bucket}.s3.${region}.amazonaws.com/${org.logo}` : null;
  const documentInfo = config.documentInfo || { documentNumber: doc.name };
  const data = {
    documentType: doc.type, ...config, design, logoUrl, name: doc.name, revisionNumber: doc.revisionNumber ?? null,
    organization: org, company: org, customer: config.customer || { name: config.customerName },
    documentInfo: { ...documentInfo, documentNumber: documentInfo?.documentNumber || doc.name }, items: Array.isArray(config.items) ? config.items : [], config,
  };
  const html = renderDocumentHtml(doc.type, data, org)!;
  fs.writeFileSync(out.replace(/\.pdf$/, '.html'), html);
  const pdf = await new PdfGeneratorService().generatePdfFromHtml(html, pdfOptionsFor(doc.type, data));
  fs.writeFileSync(out, pdf);
  console.log(`${doc.name}: ${out} (${pdf.length} bytes; design ${JSON.stringify(design)})`);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
