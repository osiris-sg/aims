import { lastValueFrom, of } from 'rxjs';
import { __setPresigner, fetchableUrl, signBucketUrlsInHtml, signedFileUrlMap, SignedFileUrlsInterceptor, storedFileValues } from './storage-sign';

/** Phase 3 (2026-11-24): renderers and token pages get signed links, never the public bucket URL. */

beforeAll(() => __setPresigner(async (key, ttl) => `https://signed.example/${key}?X-Amz-Signature=abc&ttl=${ttl}`));
afterAll(() => __setPresigner(null));

const PUB = 'https://aims-osiris.s3.ap-southeast-1.amazonaws.com/';

describe('signBucketUrlsInHtml', () => {
  it('replaces every public bucket URL (attribute-escaped) and leaves the rest', async () => {
    const html = `<img src="${PUB}maintenance-reports/a.png"><img src='${PUB}logos/x%20y.png'><div style="background:url(${PUB}org/o1/do-start/u.jpg)"></div><img src="https://cdn.example/z.png"><img src="data:image/png;base64,AA">`;
    const out = await signBucketUrlsInHtml(html);
    expect(out).not.toContain(PUB);
    expect(out).toContain('https://signed.example/maintenance-reports/a.png?X-Amz-Signature=abc&amp;ttl=3600');
    expect(out).toContain('https://signed.example/logos/x y.png');
    expect(out).toContain('https://signed.example/org/o1/do-start/u.jpg');
    expect(out).toContain('https://cdn.example/z.png');
    expect(out).toContain('data:image/png;base64,AA');
  });

  it('keeps already-signed links and HTML without bucket URLs untouched', async () => {
    const signed = `<img src="${PUB}logos/a.png?X-Amz-Signature=zz">`;
    expect(await signBucketUrlsInHtml(signed)).toBe(signed);
    expect(await signBucketUrlsInHtml('<p>no files</p>')).toBe('<p>no files</p>');
  });
});

describe('token pages: fileUrls map', () => {
  const payload = { organization: { logo: 'logos/wct-logo.png' }, items: [{ photos: ['org/o1/do-start/1.jpg', 'data:x'] }], legacy: `${PUB}project-costs/o1/a.pdf`, text: 'hello' };

  it('collects stored keys and bucket URLs only', () => {
    expect(storedFileValues(payload).sort()).toEqual(['logos/wct-logo.png', 'org/o1/do-start/1.jpg', `${PUB}project-costs/o1/a.pdf`].sort());
  });

  it('maps each stored value to a signed link', async () => {
    const m = await signedFileUrlMap(payload);
    expect(m['logos/wct-logo.png']).toContain('signed.example/logos/wct-logo.png');
    expect(m[`${PUB}project-costs/o1/a.pdf`]).toContain('signed.example/project-costs/o1/a.pdf');
  });

  it('the interceptor adds fileUrls on GET without changing stored values', async () => {
    const i = new SignedFileUrlsInterceptor();
    const ctx: any = { switchToHttp: () => ({ getRequest: () => ({ method: 'GET' }) }) };
    const out: any = await lastValueFrom(i.intercept(ctx, { handle: () => of(payload) }));
    expect(out.organization.logo).toBe('logos/wct-logo.png');
    expect(out.fileUrls['org/o1/do-start/1.jpg']).toContain('signed.example');
    const post: any = { switchToHttp: () => ({ getRequest: () => ({ method: 'POST' }) }) };
    expect(await lastValueFrom(i.intercept(post, { handle: () => of(payload) }))).toBe(payload);
  });

  it('fetchableUrl signs bucket URLs only', async () => {
    expect(await fetchableUrl(`${PUB}payables/o1/x.pdf`)).toContain('signed.example/payables/o1/x.pdf');
    expect(await fetchableUrl('https://example.com/x.pdf')).toBe('https://example.com/x.pdf');
  });
});
