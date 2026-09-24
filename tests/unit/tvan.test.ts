import { describe, expect, it } from 'vitest';
import { document } from '../helpers.js';
import type { InvoiceDocument } from '../../src/shared/models/index.js';
import { MisaTvanAdapter } from '../../src/server/tvan/adapters/misa.js';
import { ViettelTvanAdapter } from '../../src/server/tvan/adapters/viettel.js';
import { InvoiceTvanAdapter } from '../../src/server/tvan/adapters/invoice.js';
import { SoftdreamsTvanAdapter } from '../../src/server/tvan/adapters/softdreams.js';
import { TvanRegistry } from '../../src/server/tvan/registry.js';
import { TvanBackportService } from '../../src/server/tvan/backport.service.js';
import type { TvanAdapterContext, TvanTokenState } from '../../src/server/tvan/types.js';
import { fetchWithTimeout } from '../../src/server/tvan/http.js';

const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n');

function misaDocument(): InvoiceDocument {
  return document({
    providerCode: 'tvan_misa',
    lookup: {
      providerCode: 'tvan_misa',
      lookupCode: 'N6F3TW0XMV3A',
      lookupCodeType: 'TransactionID',
    },
    rawSummary: {
      ngcnhat: 'tvan_misa',
      cttkhac: [{ ttruong: 'TransactionID', kdlieu: 'string', dlieu: 'N6F3TW0XMV3A' }],
    },
  });
}

function invoiceTvanDocument(): InvoiceDocument {
  return document({
    providerCode: 'tvan_invoice',
    seller: { taxCode: '0106432955', name: 'CÔNG TY TNHH TƯ VẤN AZLAW', dynamicFields: [] },
    lookup: {
      providerCode: 'tvan_invoice',
      lookupCode: 'A349FB0BF1854FAE',
      lookupCodeType: 'Số bảo mật',
    },
    rawSummary: {
      ngcnhat: 'tvan_invoice',
      nbmst: '0106432955',
      msttcgp: '0106026495',
      tvandnkntt: '0106026495',
      cttkhac: [{ ttruong: 'Số bảo mật', kdlieu: 'string', dlieu: 'A349FB0BF1854FAE' }],
    },
  });
}


function softdreamsDocument(): InvoiceDocument {
  return document({
    key: 'softdreams-2301213781-C26TYY-17',
    providerCode: 'tvan_softdreams',
    seller: { taxCode: '2301213781', name: 'CÔNG TY TNHH TƯ VẤN ĐẦU TƯ THÁI TÂN', dynamicFields: [] },
    lookup: {
      providerCode: 'tvan_softdreams',
      lookupCode: 'MDYEKT4OZ',
      lookupCodeType: 'Fkey',
      lookupBaseUrl: 'http://2301213781hd.easyinvoice.com.vn',
      lookupPathRaw: '/',
    },
    rawSummary: {
      ngcnhat: 'tvan_softdreams',
      nbmst: '2301213781',
      msttcgp: '0105987432',
      tvandnkntt: '0105987432',
      ttkhac: [
        { ttruong: 'PortalLink', kdlieu: 'string', dlieu: 'http://2301213781hd.easyinvoice.com.vn' },
        { ttruong: 'Fkey', kdlieu: 'string', dlieu: 'MDYEKT4OZ' },
      ],
    },
  });
}

function viettelDocument(): InvoiceDocument {
  return document({
    providerCode: 'tvan_viettel',
    seller: { taxCode: '2301000920', name: 'Seller', dynamicFields: [] },
    lookup: {
      providerCode: 'tvan_viettel',
      lookupCode: '71ARPKV719EKBKE',
      lookupCodeType: 'Mã số bí mật',
    },
    rawSummary: {
      ngcnhat: 'tvan_viettel',
      nbmst: '2301000920',
      ttkhac: [{ ttruong: 'Mã số bí mật', kdlieu: 'string', dlieu: '71ARPKV719EKBKE' }],
    },
  });
}

function context(fetchImpl: typeof fetch, token?: TvanTokenState) {
  let current = token;
  const ctx: TvanAdapterContext = {
    fetchImpl,
    timeoutMs: 5_000,
    maxDownloadBytes: 5 * 1024 * 1024,
    token: current,
    setToken: (next) => { current = next; },
  };
  return { ctx, getToken: () => current };
}

describe('TVAN registry and adapters', () => {
  it('classifies MISA/tvan_invoice as P1, Viettel as P2, and SoftDreams as per-invoice P3', () => {
    const registry = new TvanRegistry();
    expect(registry.capability(misaDocument())).toMatchObject({
      providerCode: 'tvan_misa', supported: true, captchaMode: 'none', priority: 'P1',
    });
    expect(registry.capability(invoiceTvanDocument())).toMatchObject({
      providerCode: 'tvan_invoice', supported: true, captchaMode: 'none', priority: 'P1',
    });
    expect(registry.capability(viettelDocument())).toMatchObject({
      providerCode: 'tvan_viettel', supported: true, captchaMode: 'session', priority: 'P2',
    });
    expect(registry.capability(softdreamsDocument())).toMatchObject({
      providerCode: 'tvan_softdreams', supported: true, captchaMode: 'per_invoice', priority: 'P3',
    });
    expect(registry.capability(document({ providerCode: 'tvan_fpt' }))).toMatchObject({
      providerCode: 'tvan_fpt', supported: false, captchaMode: 'per_invoice', priority: 'P3',
    });
  });

  it('resolves the supervised tvan_invoice SearchInvoice PDF link from seller MST and Số bảo mật without network I/O', async () => {
    const adapter = new InvoiceTvanAdapter();
    const fetchImpl = (async () => {
      throw new Error('resolvePresentationLink must not contact M-Invoice');
    }) as typeof fetch;
    const result = await adapter.resolvePresentationLink!(invoiceTvanDocument(), context(fetchImpl).ctx);
    expect(result).toMatchObject({
      providerCode: 'tvan_invoice',
      displayName: 'M-Invoice',
      lookupCode: 'A349FB0BF1854FAE',
      sellerTaxCode: '0106432955',
      securityCode: 'A349FB0BF1854FAE',
      providerTaxCode: '0106026495',
      metadataMethod: 'GET',
      metadataUrl: 'https://tracuuhoadon.minvoice.com.vn/api/Search/SearchInvoice',
      downloadUrl: 'https://tracuuhoadon.minvoice.com.vn/api/Search/SearchInvoice?masothue=0106432955&sobaomat=A349FB0BF1854FAE&type=PDF&inchuyendoi=false',
    });
    expect(result.steps.map((step) => step.stage)).toEqual([
      'seller_tax_code',
      'security_code',
      'presentation_link',
    ]);
  });

  it('downloads tvan_invoice PDF by GET using the exact production query contract', async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method || 'GET' });
      const target = new URL(url);
      expect(target.origin).toBe('https://tracuuhoadon.minvoice.com.vn');
      expect(target.pathname).toBe('/api/Search/SearchInvoice');
      expect(target.searchParams.get('masothue')).toBe('0106432955');
      expect(target.searchParams.get('sobaomat')).toBe('A349FB0BF1854FAE');
      expect(target.searchParams.get('type')).toBe('PDF');
      expect(target.searchParams.get('inchuyendoi')).toBe('false');
      return new Response(PDF, { status: 200, headers: { 'content-type': 'application/pdf' } });
    }) as typeof fetch;
    const adapter = new InvoiceTvanAdapter();
    const result = await adapter.downloadPdf(invoiceTvanDocument(), context(fetchImpl).ctx);
    expect(calls).toEqual([{
      url: 'https://tracuuhoadon.minvoice.com.vn/api/Search/SearchInvoice?masothue=0106432955&sobaomat=A349FB0BF1854FAE&type=PDF&inchuyendoi=false',
      method: 'GET',
    }]);
    expect(result.content.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('recognizes tvan_invoice from msttcgp 0106026495 when providerCode is absent', () => {
    const registry = new TvanRegistry();
    const doc = invoiceTvanDocument();
    doc.providerCode = undefined;
    doc.lookup = undefined;
    expect(registry.capability(doc)).toMatchObject({
      providerCode: 'tvan_invoice', supported: true, captchaMode: 'none', priority: 'P1',
    });
  });

  it('returns SoftDreams Portal + Fkey without network I/O', async () => {
    const adapter = new SoftdreamsTvanAdapter();
    const fetchImpl = (async () => { throw new Error('resolvePresentationLink must not contact SoftDreams'); }) as typeof fetch;
    const result = await adapter.resolvePresentationLink!(softdreamsDocument(), context(fetchImpl).ctx);
    expect(result).toMatchObject({
      providerCode: 'tvan_softdreams',
      displayName: 'SoftDreams EasyInvoice',
      lookupCode: 'MDYEKT4OZ',
      sellerTaxCode: '2301213781',
      providerTaxCode: '0105987432',
      metadataUrl: 'http://2301213781hd.easyinvoice.com.vn/Search/Index',
      metadataMethod: 'GET',
    });
  });

  it('runs the observed SoftDreams CAPTCHA -> Search -> prepare file -> download ZIP -> PDF flow', async () => {
    const yazl = await import('yazl');
    const zip = await new Promise<Buffer>((resolve, reject) => {
      const archive = new yazl.ZipFile();
      const chunks: Buffer[] = [];
      archive.outputStream.on('data', (chunk: Buffer) => chunks.push(chunk));
      archive.outputStream.once('error', reject);
      archive.outputStream.once('end', () => resolve(Buffer.concat(chunks)));
      archive.addBuffer(PDF, 'HOADON_2301213781_1C26TYY_17.pdf');
      archive.end();
    });
    const opaque = 'OBHNpZ5SPGt2Tlm6N3C5bm8j30Qo/15wmH7hQyIldH+z5/wypUIRwtWIB5xsZ+yPlyRFHvoBCwLpSJ01iWq6yzuuXauiKSooGpvYZxcbkwwpzEe7ewBB8lveQs9uXzO0';
    const invoiceHtml = '<html><body><div>INVOICE_ONLY</div></body></html>';
    const encodedInvData = JSON.stringify({ str: invoiceHtml, cusType: 1 })
      .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const calls: Array<{ url: string; method: string; body?: string; cookie?: string }> = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers || {});
      const body = typeof init?.body === 'string' ? init.body : undefined;
      calls.push({ url, method: init?.method || 'GET', body, cookie: headers.get('cookie') || undefined });
      if (url.endsWith('/Search/Index')) {
        return new Response('<html><body>EasyInvoice search</body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8', 'set-cookie': 'ASP.NET_SessionId=boot123; Path=/; HttpOnly' },
        });
      }
      if (url.endsWith('/Captcha/Show')) {
        expect(headers.get('cookie')).toContain('ASP.NET_SessionId=boot123');
        return new Response(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,1,2,3]), {
          status: 200,
          headers: { 'content-type': 'image/png', 'set-cookie': 'ASP.NET_SessionId=abc123; Path=/; HttpOnly' },
        });
      }
      if (url.endsWith('/Search/Search')) {
        expect(body).toContain('typeSearch=');
        expect(body).toContain('FKey=MDYEKT4OZ');
        expect(body).toContain('Capcha=6348');
        expect(headers.get('cookie')).toContain('ASP.NET_SessionId=abc123');
        return new Response(`<html><head><style>${'x'.repeat(5000)}</style></head><body>PORTAL_WRAPPER<input id="InvData" value="${encodedInvData}"><input name="token" value="${opaque}"><script>var model = { toolbarType: '' };</script></body></html>`, {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
      }
      if (url.endsWith('/Invoice/DownloadPdfAndFileAttachFromAvailableHtml')) {
        expect(body).toContain(`token=${encodeURIComponent(opaque)}`);
        const params = new URLSearchParams(body);
        expect(Buffer.from(params.get('html') || '', 'base64').toString('utf8')).toBe(invoiceHtml);
        expect(Buffer.from(params.get('html') || '', 'base64').toString('utf8')).not.toContain('PORTAL_WRAPPER');
        return new Response(JSON.stringify({
          fileGuid: '7959cb20-4095-4feb-8bb5-38f623be9959',
          fileName: 'HOADON_2301213781_1C26TYY_17.zip',
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.includes('/Invoice/Download?')) {
        const target = new URL(url);
        expect(target.searchParams.get('fileGuid')).toBe('7959cb20-4095-4feb-8bb5-38f623be9959');
        expect(target.searchParams.get('fileName')).toBe('HOADON_2301213781_1C26TYY_17.zip');
        return new Response(new Uint8Array(zip), { status: 200, headers: { 'content-type': 'application/zip' } });
      }
      return new Response('not found', { status: 404 });
    }) as typeof fetch;

    const adapter = new SoftdreamsTvanAdapter();
    const session = context(fetchImpl);
    const challenge = await adapter.getCaptchaChallenge!(softdreamsDocument(), session.ctx);
    expect(challenge.challenge).toMatchObject({ providerCode: 'tvan_softdreams', kind: 'text', imageMimeType: 'image/png' });
    expect(JSON.stringify(challenge.challenge)).not.toContain('abc123');

    const verification = await adapter.verifyCaptcha!(softdreamsDocument(), challenge.challenge, challenge.privateState, '6348', session.ctx);
    expect(verification.request).toMatchObject({
      endpoint: 'http://2301213781hd.easyinvoice.com.vn/Search/Search',
      method: 'POST',
      requestBody: 'typeSearch=&FKey=MDYEKT4OZ&Capcha=%5Buser-entered-captcha%5D',
      responseStatus: 200,
    });
    const nextContext = context(fetchImpl, session.getToken()).ctx;
    const plan = adapter.describeDownloadRequest!(softdreamsDocument(), nextContext);
    expect(plan).toMatchObject({
      tokenReady: true,
      method: 'GET',
      endpoint: 'http://2301213781hd.easyinvoice.com.vn/Invoice/Download?fileGuid=7959cb20-4095-4feb-8bb5-38f623be9959&fileName=HOADON_2301213781_1C26TYY_17.zip',
      lookup: {
        portalUrl: 'http://2301213781hd.easyinvoice.com.vn',
        fkey: 'MDYEKT4OZ',
        fileGuid: '7959cb20-4095-4feb-8bb5-38f623be9959',
        fileName: 'HOADON_2301213781_1C26TYY_17.zip',
      },
    });
    expect(JSON.stringify(plan)).not.toContain(opaque);
    expect(JSON.stringify(plan)).not.toContain('abc123');

    const artifact = await adapter.downloadArtifact(softdreamsDocument(), nextContext);
    expect(artifact.originalContentType).toBe('application/zip');
    expect(artifact.original.subarray(0, 2).toString()).toBe('PK');
    expect(artifact.originalFileName).toBe('HOADON_2301213781_1C26TYY_17.zip');
    expect(artifact.pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(artifact.pdfFileName).toBe('HOADON_2301213781_1C26TYY_17.pdf');
    expect(calls.map((call) => `${call.method} ${new URL(call.url).pathname}`)).toEqual([
      'GET /Search/Index',
      'GET /Captcha/Show',
      'POST /Search/Search',
      'POST /Invoice/DownloadPdfAndFileAttachFromAvailableHtml',
      'GET /Invoice/Download',
    ]);
  });

  it('uses DownloadFileFromHtml for SoftDreams DA_LIEU and keeps the direct PDF original', async () => {
    const opaque = 'DA1LieuTokenAbc1234567890XYZ+/DA1LieuTokenAbc1234567890XYZ+/DA1LieuToken';
    const invoiceHtml = '<html><body>DA_LIEU_INVOICE</body></html>';
    const encodedInvData = JSON.stringify({ str: invoiceHtml })
      .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = typeof init?.body === 'string' ? init.body : undefined;
      calls.push({ url, method: init?.method || 'GET', body });
      if (url.endsWith('/Search/Index')) {
        return new Response('<html>search</html>', {
          status: 200,
          headers: { 'content-type': 'text/html', 'set-cookie': 'ASP.NET_SessionId=da1; Path=/; HttpOnly' },
        });
      }
      if (url.endsWith('/Captcha/Show')) {
        return new Response(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,1]), {
          status: 200,
          headers: { 'content-type': 'image/png', 'set-cookie': 'ASP.NET_SessionId=da2; Path=/; HttpOnly' },
        });
      }
      if (url.endsWith('/Search/Search')) {
        return new Response(`<html><body><input id="InvData" value="${encodedInvData}"><input name="token" value="${opaque}"><script>var model={toolbarType:'DA_LIEU'};</script></body></html>`, {
          status: 200,
          headers: { 'content-type': 'text/html' },
        });
      }
      if (url.endsWith('/Invoice/DownloadFileFromHtml')) {
        const params = new URLSearchParams(body);
        expect(params.get('token')).toBe(opaque);
        expect(params.get('isImage')).toBe('false');
        expect(Buffer.from(params.get('html') || '', 'base64').toString('utf8')).toBe(invoiceHtml);
        return new Response(JSON.stringify({
          fileGuid: '12345678-1234-4234-8234-123456789012',
          fileName: 'HOADON_DA_LIEU.pdf',
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.includes('/Invoice/Download?')) {
        return new Response(new Uint8Array(PDF), { status: 200, headers: { 'content-type': 'application/octet-stream' } });
      }
      return new Response('not found', { status: 404 });
    }) as typeof fetch;

    const adapter = new SoftdreamsTvanAdapter();
    const session = context(fetchImpl);
    const challenge = await adapter.getCaptchaChallenge!(softdreamsDocument(), session.ctx);
    await adapter.verifyCaptcha!(softdreamsDocument(), challenge.challenge, challenge.privateState, '9999', session.ctx);
    const verified = context(fetchImpl, session.getToken()).ctx;

    const original = await adapter.downloadOriginal!(softdreamsDocument(), verified);
    expect(original.contentType).toBe('application/pdf');
    expect(original.fileName).toBe('HOADON_DA_LIEU.pdf');
    expect(original.content.subarray(0, 5).toString()).toBe('%PDF-');

    const pdf = await adapter.downloadPdf(softdreamsDocument(), verified);
    expect(pdf.content).toEqual(original.content);
    expect(calls.some((call) => new URL(call.url).pathname === '/Invoice/DownloadPdfAndFileAttachFromAvailableHtml')).toBe(false);
    expect(calls.filter((call) => new URL(call.url).pathname === '/Invoice/DownloadFileFromHtml')).toHaveLength(1);
  });

  it('keeps a direct SoftDreams PDF as both original file and PDF artifact', async () => {
    const doc = softdreamsDocument();
    const state = {
      version: 1,
      documentKey: doc.key,
      sellerTaxCode: '2301213781',
      providerTaxCode: '0105987432',
      portalOrigin: 'http://2301213781hd.easyinvoice.com.vn',
      portalHost: '2301213781hd.easyinvoice.com.vn',
      portalProtocol: 'http:',
      fkey: 'MDYEKT4OZ',
      downloadUrl: 'http://2301213781hd.easyinvoice.com.vn/Invoice/Download?fileGuid=12345678-1234-1234-1234-123456789012&fileName=invoice.pdf',
      fileGuid: '12345678-1234-1234-1234-123456789012',
      fileName: 'invoice.pdf',
    };
    const fetchImpl = (async () => new Response(new Uint8Array(PDF), {
      status: 200,
      headers: { 'content-type': 'application/pdf' },
    })) as typeof fetch;
    const token = { token: JSON.stringify(state), expiresAt: Date.now() + 60_000 };
    const artifact = await new SoftdreamsTvanAdapter().downloadArtifact(doc, context(fetchImpl, token).ctx);
    expect(artifact.originalContentType).toBe('application/pdf');
    expect(artifact.original).toEqual(artifact.pdf);
    expect(artifact.originalFileName).toBe('invoice.pdf');
    expect(artifact.pdfFileName).toBe('invoice.pdf');
  });

  it('sniffs SoftDreams artifact bytes instead of trusting filename or Content-Type', async () => {
    const doc = softdreamsDocument();
    const baseState = {
      version: 1,
      documentKey: doc.key,
      sellerTaxCode: '2301213781',
      providerTaxCode: '0105987432',
      portalOrigin: 'http://2301213781hd.easyinvoice.com.vn',
      portalHost: '2301213781hd.easyinvoice.com.vn',
      portalProtocol: 'http:',
      fkey: 'MDYEKT4OZ',
      fileGuid: '12345678-1234-4234-8234-123456789012',
    };

    const pdfNamedZip = {
      ...baseState,
      fileName: 'mismatch.zip',
      downloadUrl: 'http://2301213781hd.easyinvoice.com.vn/Invoice/Download?fileGuid=12345678-1234-4234-8234-123456789012&fileName=mismatch.zip',
    };
    const pdfOriginal = await new SoftdreamsTvanAdapter().downloadOriginal!(
      doc,
      context((async () => new Response(new Uint8Array(PDF), {
        status: 200,
        headers: { 'content-type': 'application/zip' },
      })) as typeof fetch, { token: JSON.stringify(pdfNamedZip), expiresAt: Date.now() + 60_000 }).ctx,
    );
    expect(pdfOriginal.contentType).toBe('application/pdf');
    expect(pdfOriginal.fileName.toLocaleLowerCase()).toMatch(/\.pdf$/);

    const htmlNamedPdf = {
      ...baseState,
      fileName: 'fake.pdf',
      downloadUrl: 'http://2301213781hd.easyinvoice.com.vn/Invoice/Download?fileGuid=12345678-1234-4234-8234-123456789012&fileName=fake.pdf',
    };
    await expect(new SoftdreamsTvanAdapter().downloadOriginal!(
      doc,
      context((async () => new Response('<html>provider error</html>', {
        status: 200,
        headers: { 'content-type': 'application/pdf' },
      })) as typeof fetch, { token: JSON.stringify(htmlNamedPdf), expiresAt: Date.now() + 60_000 }).ctx,
    )).rejects.toMatchObject({ code: 'TVAN_SOFTDREAMS_DOWNLOAD_INVALID' });
  });

  it('uses MISA customData from the observed lookup response as the documented downloadhandler ext', async () => {
    const calls: Array<{ url: string; body?: string }> = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, body: typeof init?.body === 'string' ? init.body : init?.body instanceof URLSearchParams ? init.body.toString() : undefined });
      if (url.includes('GetInvoiceDataByTransactionID')) {
        expect(typeof init?.body === 'string' ? init.body : String(init?.body)).toContain('transactionID=N6F3TW0XMV3A');
        return new Response(JSON.stringify({
          success: true,
          data: '<HDon><DLHDon Id="N6F3TW0XMV3A"/></HDon>',
          customData: '1_73XNGR',
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('GetEinvoiceByTransactionID')) return new Response('not found', { status: 404 });
      if (url.includes('GetRequestTimeEnCode')) {
        throw new Error('GetRequestTimeEnCode must not be needed when MISA lookup already returned customData');
      }
      if (url.includes('www.meinvoice.vn/tra-cuu/tra-cuu/DownloadHandler.ashx')) {
        expect(url).toContain('Type=pdf');
        expect(url).toContain('Viewer=1');
        expect(url).toContain('ext=1_73XNGR');
        expect(url).toContain('Code=N6F3TW0XMV3A');
        return new Response(PDF, { status: 200, headers: { 'content-type': 'application/pdf' } });
      }
      return new Response('not found', { status: 404 });
    }) as typeof fetch;
    const adapter = new MisaTvanAdapter();
    const result = await adapter.downloadPdf(misaDocument(), context(fetchImpl).ctx);
    expect(result.content.subarray(0, 5).toString()).toBe('%PDF-');
    expect(calls.some((call) => call.url.includes('GetInvoiceDataByTransactionID'))).toBe(true);
    expect(calls.some((call) => call.url.includes('GetRequestTimeEnCode'))).toBe(false);
  });

  it('uses the confirmed MISA production DownloadHandler path and Code/ext mapping', async () => {
    const calls: string[] = [];
    const doc = document({
      providerCode: 'tvan_misa',
      lookup: {
        providerCode: 'tvan_misa',
        lookupCode: 'VLF4IVJPR_J7',
        lookupCodeType: 'TransactionID',
      },
      rawSummary: {
        ngcnhat: 'tvan_misa',
        cttkhac: [{ ttruong: 'TransactionID', kdlieu: 'string', dlieu: 'VLF4IVJPR_J7' }],
      },
    });
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('GetInvoiceDataByTransactionID')) {
        return new Response(JSON.stringify({ success: true, data: '<HDon />', customData: '0K7QE2QR' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('GetEinvoiceByTransactionID')) return new Response('not found', { status: 404 });
      if (url.includes('GetRequestTimeEnCode')) throw new Error('confirmed customData must be used directly as ext');
      if (url.includes('/tra-cuu/tra-cuu/DownloadHandler.ashx')) {
        const target = new URL(url);
        expect(target.searchParams.get('Type')).toBe('pdf');
        expect(target.searchParams.get('Viewer')).toBe('1');
        expect(target.searchParams.get('ext')).toBe('0K7QE2QR');
        expect(target.searchParams.get('Code')).toBe('VLF4IVJPR_J7');
        return new Response(PDF, { status: 200, headers: { 'content-type': 'application/pdf' } });
      }
      return new Response('not found', { status: 404 });
    }) as typeof fetch;
    const adapter = new MisaTvanAdapter();
    const result = await adapter.downloadPdf(doc, context(fetchImpl).ctx);
    expect(result.content.subarray(0, 5).toString()).toBe('%PDF-');
    expect(calls.some((url) => url.includes('/tra-cuu/tra-cuu/DownloadHandler.ashx'))).toBe(true);
    expect(calls.some((url) => url.includes('GetRequestTimeEnCode'))).toBe(false);
  });

  it('resolves the supervised MISA customData and exact presentation link without downloading the PDF', async () => {
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    const doc = document({
      providerCode: 'tvan_misa',
      lookup: {
        providerCode: 'tvan_misa',
        lookupCode: '50FBTGG6Q110',
        lookupCodeType: 'TransactionID',
      },
      rawSummary: {
        ngcnhat: 'tvan_misa',
        cttkhac: [{ ttruong: 'TransactionID', kdlieu: 'string', dlieu: '50FBTGG6Q110' }],
      },
    });
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method || 'GET';
      const body = init?.body instanceof URLSearchParams
        ? init.body.toString()
        : typeof init?.body === 'string' ? init.body : undefined;
      calls.push({ url, method, body });
      if (url === 'https://www.meinvoice.vn/tra-cuu/GetInvoiceDataByTransactionID') {
        return new Response(JSON.stringify({
          success: true,
          data: '<HDon />',
          customData: 'M7DR_2_K',
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`Unexpected network request: ${method} ${url}`);
    }) as typeof fetch;

    const adapter = new MisaTvanAdapter();
    const result = await adapter.resolvePresentationLink!(doc, context(fetchImpl).ctx);

    expect(calls).toEqual([{
      url: 'https://www.meinvoice.vn/tra-cuu/GetInvoiceDataByTransactionID',
      method: 'POST',
      body: 'transactionID=50FBTGG6Q110',
    }]);
    expect(result).toMatchObject({
      providerCode: 'tvan_misa',
      lookupCode: '50FBTGG6Q110',
      customData: 'M7DR_2_K',
      metadataMethod: 'POST',
      metadataUrl: 'https://www.meinvoice.vn/tra-cuu/GetInvoiceDataByTransactionID',
      metadataRequestBody: 'transactionID=50FBTGG6Q110',
      downloadUrl: 'https://www.meinvoice.vn/tra-cuu/tra-cuu/DownloadHandler.ashx?Type=pdf&Viewer=1&ext=M7DR_2_K&Code=50FBTGG6Q110',
    });
    expect(result.steps.map((step) => step.stage)).toEqual([
      'lookup_code',
      'metadata',
      'custom_data',
      'presentation_link',
    ]);
  });

  it('uses legacy GetRequestTimeEnCode only when MISA metadata has no customData', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('GetInvoiceDataByTransactionID')) {
        return new Response(JSON.stringify({ success: true, data: '<HDon />' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('GetEinvoiceByTransactionID')) return new Response('not found', { status: 404 });
      if (url.includes('GetRequestTimeEnCode')) {
        return new Response(`${'x'.repeat(55)}EXT12345`, { status: 200, headers: { 'content-type': 'text/plain' } });
      }
      if (url.includes('/tra-cuu/tra-cuu/DownloadHandler.ashx')) {
        expect(new URL(url).searchParams.get('ext')).toBe('EXT12345');
        return new Response(PDF, { status: 200, headers: { 'content-type': 'application/pdf' } });
      }
      return new Response('not found', { status: 404 });
    }) as typeof fetch;
    const adapter = new MisaTvanAdapter();
    const result = await adapter.downloadPdf(misaDocument(), context(fetchImpl).ctx);
    expect(result.content.subarray(0, 5).toString()).toBe('%PDF-');
    expect(calls.some((url) => url.includes('GetRequestTimeEnCode'))).toBe(true);
  });

  it('rejects TVAN redirects outside the provider allow-list', async () => {
    const fetchImpl = (async () => new Response('', {
      status: 302,
      headers: { location: 'https://evil.invalid/private' },
    })) as typeof fetch;
    await expect(fetchWithTimeout(
      fetchImpl,
      'https://www.meinvoice.vn/start',
      { method: 'GET' },
      5_000,
      ['www.meinvoice.vn'],
    )).rejects.toMatchObject({ code: 'TVAN_URL_REJECTED' });
  });

  it('uses GET-only Viettel challenge probing, discovers image fields, then reuses the verified token for PDF', async () => {
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1cAAAAASUVORK5CYII=';
    const piecePng = 'iVBORw0KGgoBAgMEBQYHCAk=';
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method || 'GET';
      calls.push({ url, method, body: typeof init?.body === 'string' ? init.body : undefined });
      const pathname = new URL(url).pathname;
      if (pathname.endsWith('/captcha/get')) {
        return new Response(JSON.stringify({ success: true, token: 'token-only' }), {
          status: 200,
          headers: { 'content-type': 'application/json', 'set-cookie': 'VTSESSION=abc123; Path=/; HttpOnly' },
        });
      }
      if (pathname.endsWith('/captcha/generate')) {
        return new Response(JSON.stringify({
          success: true,
          payload: {
            captchaToken: 'private-captcha-id',
            strangeBackgroundBlob: png,
            strangeJigsawBlob: piecePng,
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('/captcha/verify')) {
        expect(JSON.parse(String(init?.body))).toEqual({ token: 'private-captcha-id', offsetX: 80 });
        return new Response(JSON.stringify({ success: true, token: 'verified-session-token' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('/downloadPDF')) {
        expect(JSON.parse(String(init?.body))).toEqual({
          supplierTaxCode: '2301000920',
          reservationCode: '71ARPKV719EKBKE',
          recaptcha: 'verified-session-token',
        });
        return new Response(PDF, { status: 200, headers: { 'content-type': 'application/pdf' } });
      }
      return new Response('not found', { status: 404 });
    }) as typeof fetch;

    const adapter = new ViettelTvanAdapter();
    const session = context(fetchImpl);
    const challenge = await adapter.getCaptchaChallenge(viettelDocument(), session.ctx);
    expect(challenge.challenge).not.toHaveProperty('token');
    expect(challenge.challenge.providerCode).toBe('tvan_viettel');
    expect(challenge.challenge.imageBase64).toBe(png);
    expect(challenge.trace).toMatchObject({
      endpoint: 'https://vinvoice.viettel.vn/api/services/einvoiceuaa/api/captcha/generate',
      method: 'GET',
      responseStatus: 200,
    });
    expect(calls.filter((call) => call.url.includes('/captcha/') && !call.url.includes('/verify')).every((call) => call.method === 'GET')).toBe(true);

    const verification = await adapter.verifyCaptcha!(viettelDocument(), challenge.challenge, challenge.privateState, '80', session.ctx);
    expect(session.getToken()?.token).toBe('verified-session-token');
    expect(verification).toMatchObject({
      request: {
        endpoint: 'https://vinvoice.viettel.vn/api/services/einvoiceuaa/api/captcha/verify',
        method: 'POST',
        requestBody: JSON.stringify({ token: '[backend-private-challenge-token]', offsetX: 80 }),
        responseStatus: 200,
      },
    });

    const downloadContext = context(fetchImpl, session.getToken()).ctx;
    const plan = adapter.describeDownloadRequest(viettelDocument(), downloadContext);
    expect(plan.tokenReady).toBe(true);
    const pdf = await adapter.downloadPdf(viettelDocument(), downloadContext);
    expect(pdf.content.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('returns a supervised token-only probe with redacted raw response instead of throwing', async () => {
    const fs = await import('node:fs/promises');
    const os = await import('node:os');
    const path = await import('node:path');
    const { TvanPdfService } = await import('../../src/server/tvan/pdf.service.js');
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hddt-viettel-supervised-'));
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/captcha') && (init?.method || 'GET') === 'GET') {
        return new Response(JSON.stringify({ success: true, token: 'challenge-private-only', mode: 'slider-v2' }), {
          status: 200,
          headers: { 'content-type': 'application/json', 'set-cookie': 'VTSESSION=secret-cookie; Path=/; HttpOnly' },
        });
      }
      return new Response('not found', { status: 404 });
    }) as typeof fetch;
    const settings = {
      getAppDataDir: () => root,
      getConfig: () => ({ network: { requestTimeoutMs: 5_000, maxDownloadBytes: 5 * 1024 * 1024 } }),
    } as any;
    const service = new TvanPdfService(settings, { fetchImpl });
    const prepared = await service.prepareSupervised(viettelDocument());
    expect(prepared.challenge).toBeUndefined();
    expect(prepared.captchaProbe?.status).toBe('token_only');
    expect(prepared.captchaProbe?.attempts.some((attempt) => attempt.responseStatus === 200 && attempt.tokenPresent)).toBe(true);
    expect(JSON.stringify(prepared)).not.toContain('challenge-private-only');
    expect(JSON.stringify(prepared)).not.toContain('secret-cookie');
    expect(prepared.captchaProbe?.attempts.some((attempt) => attempt.responsePreview?.includes('[redacted]'))).toBe(true);
  });

  it('never exposes a blind Viettel offset challenge when all challenge responses are token-only', async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/captcha/')) {
        return new Response(JSON.stringify({ success: true, token: 'token-without-image' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('not found', { status: 404 });
    }) as typeof fetch;
    const adapter = new ViettelTvanAdapter();
    await expect(adapter.getCaptchaChallenge(viettelDocument(), context(fetchImpl).ctx)).rejects.toMatchObject({
      code: 'TVAN_CAPTCHA_CHALLENGE_FAILED',
    });
  });
});

describe('TVAN Backport analyzer', () => {
  it('extracts lookup fields, tax codes and endpoints without executing supplied URLs', () => {
    const fakeSettings = { getAppDataDir: () => '/tmp/hddt-tvan-test' } as any;
    const service = new TvanBackportService(fakeSettings);
    const analysis = service.analyze({
      providerCode: 'tvan_fpt',
      rawJson: JSON.stringify({
        ngcnhat: 'tvan_fpt',
        ttkhac: [{ ttruong: 'Mã tra cứu', dlieu: 'ABC123XYZ' }],
        endpoint: 'https://example.invalid/api/downloadPDF?mst=0108834240',
      }),
      rawXml: '<HDon><TTin><TTruong>TransactionID</TTruong><DLieu>TX-01</DLieu></TTin></HDon>',
    });
    expect(analysis.providerCode).toBe('tvan_fpt');
    expect(analysis.lookupCandidates).toEqual(expect.arrayContaining(['ABC123XYZ', 'TX-01']));
    expect(analysis.taxCodeCandidates).toContain('0108834240');
    expect(analysis.urls).toContain('https://example.invalid/api/downloadPDF?mst=0108834240');
  });
});

// Regression for bulk priority and CAPTCHA lifecycle. P2 must reuse one token;
// P3 must consume one token per invoice and then request a fresh CAPTCHA.
describe('TVAN per-invoice token scope', () => {
  it('keeps P3 state for the verified invoice only and reuses it within TTL', async () => {
    const fs = await import('node:fs/promises');
    const os = await import('node:os');
    const path = await import('node:path');
    const { TvanPdfService } = await import('../../src/server/tvan/pdf.service.js');
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hddt-tvan-scope-'));
    let challengeSeq = 0;
    const adapter = {
      providerCode: 'scope_p3',
      displayName: 'Scope P3',
      priority: 'P3' as const,
      captchaMode: 'per_invoice' as const,
      matches: (doc: InvoiceDocument) => doc.providerCode === 'scope_p3',
      capability: () => ({ providerCode: 'scope_p3', displayName: 'Scope P3', supported: true, priority: 'P3' as const, captchaMode: 'per_invoice' as const }),
      getCaptchaChallenge: async (doc: InvoiceDocument) => {
        challengeSeq += 1;
        return {
          challenge: {
            id: `00000000-0000-4000-8000-${String(challengeSeq).padStart(12, '0')}`,
            providerCode: 'scope_p3',
            kind: 'text' as const,
            prompt: 'captcha',
          },
          privateState: { documentKey: doc.key },
        };
      },
      verifyCaptcha: async (doc: InvoiceDocument, _challenge: any, privateState: any, answer: string, ctx: TvanAdapterContext) => {
        expect(privateState.documentKey).toBe(doc.key);
        expect(answer).toBe('ok');
        ctx.setToken({ token: `verified:${doc.key}`, expiresAt: Date.now() + 60_000 });
      },
      downloadPdf: async (doc: InvoiceDocument, ctx: TvanAdapterContext) => {
        expect(ctx.token?.token).toBe(`verified:${doc.key}`);
        return { content: PDF, contentType: 'application/pdf' as const, fileName: `${doc.key}.pdf` };
      },
    };
    const service = new TvanPdfService({
      getAppDataDir: () => root,
      getConfig: () => ({ network: { requestTimeoutMs: 5_000, maxDownloadBytes: 1024 * 1024 } }),
    } as any, { registry: new TvanRegistry([adapter]), fetchImpl: fetch });
    const invoiceA = document({ key: 'scope-a', providerCode: 'scope_p3' });
    const invoiceB = document({ key: 'scope-b', providerCode: 'scope_p3' });

    try {
      const first = await service.prepareView(invoiceA);
      expect(first.ready).toBe(false);
      expect(first.challenge).toBeTruthy();
      await service.verifyCaptcha(first.challenge!.id, 'ok');

      expect((await service.prepareView(invoiceA)).ready).toBe(true);
      const secondInvoice = await service.prepareView(invoiceB);
      expect(secondInvoice.ready).toBe(false);
      expect(secondInvoice.challenge).toBeTruthy();

      await service.viewPdf(invoiceA);
      expect((await service.prepareView(invoiceA)).ready).toBe(true);
      expect([...(service as any).tokens.keys()]).toContain('scope_p3|scope-a');
      expect([...(service as any).tokens.keys()]).not.toContain('scope_p3');
    } finally {
      await service.dispose();
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe('TVAN PDF batch state machine', () => {
  it('runs P1 -> P2 -> P3 with one P2 challenge and one P3 challenge per invoice', async () => {
    const fs = await import('node:fs/promises');
    const os = await import('node:os');
    const path = await import('node:path');
    const { TvanPdfService } = await import('../../src/server/tvan/pdf.service.js');
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hddt-tvan-batch-'));
    const downloads: string[] = [];
    const challengeCounts = new Map<string, number>();

    const makeAdapter = (providerCode: string, priority: 'P1' | 'P2' | 'P3', captchaMode: 'none' | 'session' | 'per_invoice') => ({
      providerCode,
      displayName: providerCode,
      priority,
      captchaMode,
      matches: (doc: InvoiceDocument) => doc.providerCode === providerCode,
      capability: () => ({ providerCode, displayName: providerCode, supported: true, priority, captchaMode }),
      getCaptchaChallenge: async () => {
        const count = (challengeCounts.get(providerCode) || 0) + 1;
        challengeCounts.set(providerCode, count);
        return {
          challenge: { id: `${providerCode}-${count}-0000-4000-8000-000000000000`.slice(-36), providerCode, kind: 'text' as const, prompt: 'captcha' },
          privateState: { count },
        };
      },
      verifyCaptcha: async (_doc: InvoiceDocument, _challenge: any, _privateState: any, answer: string, ctx: TvanAdapterContext) => {
        expect(answer).toBe('ok');
        ctx.setToken({ token: `${providerCode}-verified`, expiresAt: Date.now() + 60_000 });
      },
      downloadPdf: async (doc: InvoiceDocument, ctx: TvanAdapterContext) => {
        if (captchaMode !== 'none') expect(ctx.token?.token).toBe(`${providerCode}-verified`);
        downloads.push(doc.key);
        return { content: PDF, contentType: 'application/pdf' as const, fileName: `${doc.key}.pdf` };
      },
    });

    // Use valid UUID-shaped challenge ids because routes validate UUIDs; service itself only treats them as opaque ids.
    let uuidSeq = 0;
    const wrapChallenge = (adapter: any) => {
      adapter.getCaptchaChallenge = async () => {
        const count = (challengeCounts.get(adapter.providerCode) || 0) + 1;
        challengeCounts.set(adapter.providerCode, count);
        uuidSeq += 1;
        return {
          challenge: {
            id: `00000000-0000-4000-8000-${String(uuidSeq).padStart(12, '0')}`,
            providerCode: adapter.providerCode,
            kind: 'text' as const,
            prompt: 'captcha',
          },
          privateState: { count },
        };
      };
      return adapter;
    };

    const p1 = wrapChallenge(makeAdapter('p1', 'P1', 'none'));
    const p2 = wrapChallenge(makeAdapter('p2', 'P2', 'session'));
    const p3 = wrapChallenge(makeAdapter('p3', 'P3', 'per_invoice'));
    const registry = new TvanRegistry([p1, p2, p3]);
    const fakeSettings = {
      getAppDataDir: () => root,
      getConfig: () => ({ network: { requestTimeoutMs: 5_000, maxDownloadBytes: 1024 * 1024 } }),
    } as any;
    const service = new TvanPdfService(fakeSettings, { registry, fetchImpl: fetch });

    const docs = [
      document({ key: 'p3-a', providerCode: 'p3' }),
      document({ key: 'p2-a', providerCode: 'p2' }),
      document({ key: 'p1-a', providerCode: 'p1' }),
      document({ key: 'p3-b', providerCode: 'p3' }),
      document({ key: 'p2-b', providerCode: 'p2' }),
    ];

    try {
      let state = await service.startBatch(docs);
      expect(downloads).toEqual(['p1-a']);
      expect(state.status).toBe('waiting_captcha');
      expect(state.challenge?.providerCode).toBe('p2');

      state = await service.submitBatchCaptcha(state.id, state.challenge!.id, 'ok');
      expect(downloads).toEqual(['p1-a', 'p2-a', 'p2-b']);
      expect(challengeCounts.get('p2')).toBe(1);
      expect(state.status).toBe('waiting_captcha');
      expect(state.challenge?.providerCode).toBe('p3');

      state = await service.submitBatchCaptcha(state.id, state.challenge!.id, 'ok');
      expect(downloads).toEqual(['p1-a', 'p2-a', 'p2-b', 'p3-a']);
      expect(state.status).toBe('waiting_captcha');
      expect(state.challenge?.providerCode).toBe('p3');

      state = await service.submitBatchCaptcha(state.id, state.challenge!.id, 'ok');
      expect(downloads).toEqual(['p1-a', 'p2-a', 'p2-b', 'p3-a', 'p3-b']);
      expect(challengeCounts.get('p3')).toBe(2);
      expect(state.status).toBe('done');
      expect(state.archiveReady).toBe(true);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe('TVAN artifact store', () => {
  it('uses opaque ids, preserves PDF bytes, rejects unknown and expired artifacts', async () => {
    const fs = await import('node:fs/promises');
    const os = await import('node:os');
    const path = await import('node:path');
    const { TvanPdfService } = await import('../../src/server/tvan/pdf.service.js');
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hddt-tvan-artifact-'));
    const adapter = {
      providerCode: 'artifact_test',
      displayName: 'Artifact Test',
      priority: 'P1' as const,
      captchaMode: 'none' as const,
      matches: (doc: InvoiceDocument) => doc.providerCode === 'artifact_test',
      capability: () => ({ providerCode: 'artifact_test', displayName: 'Artifact Test', supported: true, priority: 'P1' as const, captchaMode: 'none' as const }),
      downloadPdf: async () => ({ content: PDF, contentType: 'application/pdf' as const, fileName: 'invoice.pdf' }),
    };
    const registry = new TvanRegistry([adapter]);
    const fakeSettings = {
      getAppDataDir: () => root,
      getConfig: () => ({ network: { requestTimeoutMs: 5_000, maxDownloadBytes: 1024 * 1024 } }),
    } as any;
    const service = new TvanPdfService(fakeSettings, { registry, fetchImpl: fetch });
    const doc = document({ key: 'artifact-doc', providerCode: 'artifact_test' });

    try {
      const prepared = await service.prepareArtifact(doc);
      expect(prepared.id).toMatch(/^[0-9a-f-]{36}$/i);
      expect(prepared.id).not.toContain('invoice');
      expect(service.getArtifactFile(prepared.id)).toMatchObject({
        contentType: 'application/pdf',
        fileName: 'invoice.pdf',
      });
      expect(service.getArtifactPdf(prepared.id).content).toEqual(PDF);
      expect(() => service.getArtifactPdf('00000000-0000-4000-8000-000000000000')).toThrowError(/Không tìm thấy file hóa đơn/);

      const stored = (service as any).artifacts.get(prepared.id);
      stored.expiresAt = Date.now() - 1;
      expect(() => service.getArtifactFile(prepared.id)).toThrowError(/hết thời gian lưu tạm/);
    } finally {
      await service.dispose();
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
