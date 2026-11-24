import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';
import { allowedMime, buildOrgKey, contentDispositionFor, folderFromHint, isOrgFolderKey, orgOfKey } from '../common/storage-keys';

/**
 * Phase 0 (2026-11-24): the server builds every upload key. A client can no
 * longer pick the key, write into another org, traverse paths or host HTML.
 */

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n');
const HTML = Buffer.from('<html><script>alert(1)</script></html>');
const file = (buffer: Buffer, mimetype: string, originalname = 'f') => ({ buffer, mimetype, originalname, size: buffer.length }) as Express.Multer.File;

function makeService() {
  const sent: any[] = [];
  const config = { get: (k: string) => ({ 'AWS.RESOURCE_BUCKET': 'test-bucket', 'AWS.REGION': 'ap-southeast-1' })[k] ?? 'x' } as any;
  const svc = new UploadsService(config);
  (svc as any).s3Client = {
    send: async (cmd: any) => {
      sent.push(cmd.input);
      if (cmd.constructor.name === 'CreateMultipartUploadCommand') return { UploadId: 'u1' };
      if (cmd.constructor.name === 'UploadPartCommand') return { ETag: 'e' };
      return {};
    },
  };
  return { svc, sent };
}

const UUID_RE = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

describe('POST /uploads/image: server-built keys', () => {
  it('ignores a key aimed at another org and stores under the caller org', async () => {
    const { svc, sent } = makeService();
    const ctl = new UploadsController(svc);
    const { Key } = await ctl.uploadImage(file(PNG, 'image/png'), { key: 'org/OTHER_ORG/logos/theirlogo.png' }, { id: 'orgA' });
    expect(Key).toMatch(new RegExp(`^org/orgA/logos/${UUID_RE}\\.png$`));
    expect(sent.every((c) => c.Key === Key)).toBe(true);
    expect(sent.some((c) => String(c.Key).includes('OTHER_ORG'))).toBe(false);
  });

  it('cannot overwrite a legacy key of another org (vehicles/<org>/..., maintenance-reports/<org>/...)', async () => {
    const { svc } = makeService();
    const ctl = new UploadsController(svc);
    for (const key of ['vehicles/orgB/log/abc.pdf', 'maintenance-reports/orgB/uploads/x.pdf', 'shipments/orgB/2026/f.pdf', 'logos/wct-logo.png']) {
      const { Key } = await ctl.uploadImage(file(PDF, 'application/pdf'), { key }, { id: 'orgA' });
      expect(Key.startsWith('org/orgA/')).toBe(true);
      expect(Key).not.toContain('orgB');
      expect(Key).not.toBe(key);
    }
  });

  it('neutralises path traversal', async () => {
    const { svc } = makeService();
    const ctl = new UploadsController(svc);
    const { Key } = await ctl.uploadImage(file(PNG, 'image/png'), { key: '../../org/orgB/logos/../x.png' }, { id: 'orgA' });
    expect(Key).toMatch(new RegExp(`^org/orgA/misc/${UUID_RE}\\.png$`));
    const r2 = await ctl.uploadImage(file(PNG, 'image/png'), { folder: '../../etc' } as any, { id: 'orgA' });
    expect(r2.Key).toMatch(/^org\/orgA\/misc\//);
  });

  it('refuses HTML (declared or disguised as an image)', async () => {
    const { svc, sent } = makeService();
    const ctl = new UploadsController(svc);
    await expect(ctl.uploadImage(file(HTML, 'text/html', 'x.html'), { key: 'logos/x.html' }, { id: 'orgA' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(ctl.uploadImage(file(HTML, 'image/png', 'x.png'), { key: 'logos/x.png' }, { id: 'orgA' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(ctl.uploadImage(file(HTML, 'application/octet-stream', 'x.html'), {}, { id: 'orgA' })).rejects.toBeInstanceOf(BadRequestException);
    expect(sent).toHaveLength(0);
  });

  it('refuses an upload without an org', async () => {
    const { svc } = makeService();
    const ctl = new UploadsController(svc);
    await expect(ctl.uploadImage(file(PNG, 'image/png'), {}, null)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('keeps today\'s folders (mapped onto the allow-list) and forces download for non image/PDF', async () => {
    const { svc, sent } = makeService();
    const ctl = new UploadsController(svc);
    const xlsx = Buffer.from('PK\u0003\u0004');
    const r = await ctl.uploadImage(file(xlsx, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'a.xlsx'), { key: 'documents/doc123/attachments/abc-1.xlsx' }, { id: 'orgA' });
    expect(r.Key).toMatch(/^org\/orgA\/documents\/attachments\/.+\.xlsx$/);
    expect(sent[0].ContentDisposition).toBe('attachment');
    sent.length = 0;
    const p = await ctl.uploadImage(file(PDF, 'application/pdf', 'a.pdf'), { key: 'maintenance-reports/orgA/uploads/z.pdf' }, { id: 'orgA' });
    expect(p.Key).toMatch(/^org\/orgA\/maintenance-reports\/uploads\/.+\.pdf$/);
    expect(sent[0].ContentDisposition).toBeUndefined();
    expect(sent[0].ContentType).toBe('application/pdf');
  });
});

describe('storage-keys helpers', () => {
  it('maps client folder hints onto the allow-list', () => {
    expect(folderFromHint('logos')).toBe('logos');
    expect(folderFromHint('vehicles/org1/log')).toBe('vehicles/log');
    expect(folderFromHint('documents/d1/signed-do')).toBe('documents/signed-do');
    expect(folderFromHint('deliveries/x/signed-do')).toBe('deliveries/signed-do');
    expect(folderFromHint('bills/new/source')).toBe('bills/source');
    expect(folderFromHint('custom-fields/Some Field')).toBe('custom-fields');
    expect(folderFromHint('payments/invoice-1')).toBe('payments');
    expect(folderFromHint('something-else/x')).toBe('misc');
    expect(folderFromHint('logos/abc.png', { isKey: true })).toBe('logos');
    expect(folderFromHint(undefined)).toBe('misc');
  });

  it('allows only listed types; generic types fall back to the file name', () => {
    expect(allowedMime('image/jpg')).toBe('image/jpeg');
    expect(allowedMime('text/html')).toBeNull();
    expect(allowedMime('application/octet-stream', 'a.pdf')).toBe('application/pdf');
    expect(allowedMime('application/octet-stream', 'a.html')).toBeNull();
    expect(allowedMime('application/x-msdownload', 'a.exe')).toBeNull();
  });

  it('builds keys only under a valid org and folder', () => {
    expect(() => buildOrgKey('../x', 'logos', 'image/png')).toThrow();
    expect(() => buildOrgKey('orgA', 'nope', 'image/png')).toThrow();
    expect(buildOrgKey('orgA', 'logos', 'image/png')).toMatch(/^org\/orgA\/logos\/.+\.png$/);
  });

  it('disposition: inline only for images/PDF', () => {
    expect(contentDispositionFor('image/png')).toBeUndefined();
    expect(contentDispositionFor('application/pdf')).toBeUndefined();
    expect(contentDispositionFor('text/html')).toBe('attachment');
    expect(contentDispositionFor('image/svg+xml')).toBe('attachment');
    expect(contentDispositionFor('message/rfc822')).toBe('attachment');
  });

  it('isOrgFolderKey accepts new + legacy shapes of the SAME org only', () => {
    expect(isOrgFolderKey('org/orgA/vehicles/log/x.pdf', 'orgA', 'vehicles')).toBe(true);
    expect(isOrgFolderKey('vehicles/orgA/log/x.pdf', 'orgA', 'vehicles')).toBe(true);
    expect(isOrgFolderKey('org/orgB/vehicles/log/x.pdf', 'orgA', 'vehicles')).toBe(false);
    expect(isOrgFolderKey('vehicles/orgB/log/x.pdf', 'orgA', 'vehicles')).toBe(false);
    expect(isOrgFolderKey('org/orgA/vehicles/../../orgB/x', 'orgA', 'vehicles')).toBe(false);
  });

  it('orgOfKey reads the owner org from a key shape', () => {
    expect(orgOfKey('org/orgA/logos/x.png')).toBe('orgA');
    expect(orgOfKey('vehicles/orgB/log/x.pdf')).toBe('orgB');
    expect(orgOfKey('logos/x.png')).toBeNull();
  });
});
