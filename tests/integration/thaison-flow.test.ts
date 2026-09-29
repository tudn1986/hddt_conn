import { describe, expect, it, vi } from 'vitest';
import yazl from 'yazl';
import { document } from '../helpers.js';
import { ThaisonTvanAdapter } from '../../src/server/tvan/adapters/thaison.js';
import { TvanPdfService } from '../../src/server/tvan/pdf.service.js';
import { TvanRegistry } from '../../src/server/tvan/registry.js';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj <<>> endobj\n%%EOF\n');
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64');
const UUID = '2067f654-be40-4039-a43f-70d316508774';

function makeZip(): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile();
    const chunks: Buffer[] = [];
    zip.outputStream.on('data', (chunk: Buffer) => chunks.push(chunk));
    zip.outputStream.once('error', reject);
    zip.outputStream.once('end', () => resolve(Buffer.concat(chunks)));
    zip.addBuffer(PDF, '11139.pdf');
    zip.addBuffer(Buffer.from('<xml/>'), 'invoice.xml');
    zip.end();
  });
}

describe('Thái Sơn presentation facade integration', () => {
  it('flows through generic TvanPdfService and reuses artifact cache', async () => {
    const zip = await makeZip();
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: any, init?: RequestInit) => {
      const url = String(input);
      const method = String(init?.method || 'GET').toUpperCase();
      const path = new URL(url).pathname;
      calls.push(method + ' ' + path);

      if (path === '/' && method === 'GET') {
        return new Response(
          '<form action="/xem-hoa-don" method="post">'
          + '<input name="MA_NHAN_HOA_DON" />'
          + '<input name="CaptchaDeText" value="opaque" />'
          + '<input name="CaptchaInputText" />'
          + '<img id="CaptchaImage" src="/DefaultCaptcha/Generate?t=opaque" />'
          + '</form>',
          { status: 200, headers: { 'content-type': 'text/html', 'set-cookie': 'ASP.NET_SessionId=A; Path=/' } },
        );
      }
      if (path === '/DefaultCaptcha/Generate') {
        return new Response(GIF, { status: 200, headers: { 'content-type': 'image/gif', 'set-cookie': 'SERVERID=node; Path=/' } });
      }
      if (path === '/xem-hoa-don' && method === 'POST') {
        return new Response(
          '<iframe src="/Download/DetailHoaDon"></iframe>'
          + '<a href="/tai-ve-hoa-don/' + UUID + '">download</a>',
          { status: 200, headers: { 'content-type': 'text/html' } },
        );
      }
      if (path === '/Download/DetailHoaDon') {
        return new Response(
          '<div>Mã số thuế 0311996400-001</div>'
          + '<div>Ký hiệu 1C25TDM</div>'
          + '<div>Số hóa đơn 1139</div>'
          + '<a href="/tai-ve-hoa-don/' + UUID + '">download</a>',
          { status: 200, headers: { 'content-type': 'text/html' } },
        );
      }
      if (path === '/tai-ve-hoa-don/' + UUID) {
        return new Response(new Uint8Array(zip), {
          status: 200,
          headers: {
            'content-type': 'application/zip',
            'content-disposition': 'attachment; filename="11139.zip"',
          },
        });
      }
      throw new Error('Unexpected Thái Sơn request: ' + method + ' ' + url);
    }) as unknown as typeof fetch;

    const invoice = document({
      key: 'thaison-integration-1139',
      providerCode: 'tvan_thaison',
      seller: { taxCode: '0311996400-001', name: 'Delmar', dynamicFields: [] },
      templateNo: 1,
      series: 'C25TDM',
      invoiceNo: 1139,
      providers: {
        solution: { taxCode: '0101300842' },
        presentation: { adapterCode: 'tvan_thaison' },
      },
      lookup: { providerCode: 'tvan_thaison', confidence: 'low' },
      rawDetail: {
        msttcgp: '0101300842',
        ttkhac: [
          { ttruong: 'DC TC', dlieu: 'http://Delmarhan.einvoice.com.vn' },
          { ttruong: 'Mã TC', dlieu: '1D2DGQRRCBH' },
        ],
      },
    } as any);

    const settings = {
      getConfig: () => ({ network: { requestTimeoutMs: 5_000, maxDownloadBytes: 2 * 1024 * 1024 } }),
    } as any;
    const service = new TvanPdfService(settings, {
      registry: new TvanRegistry([new ThaisonTvanAdapter()]),
      fetchImpl,
    });

    try {
      const prepared = await service.prepareView(invoice);
      expect(prepared).toMatchObject({
        ready: false,
        capability: { supported: true, providerCode: 'tvan_thaison', priority: 'P3' },
      });
      expect(prepared.challenge?.imageMimeType).toBe('image/gif');

      const verified = await service.verifyCaptcha(prepared.challenge!.id, 'ABCD');
      expect(verified).toMatchObject({ ok: true, providerCode: 'tvan_thaison', stage: 'search_verified' });

      const viewed = await service.viewPdf(invoice);
      expect(viewed.content.equals(PDF)).toBe(true);
      expect(viewed.fileName).toBe('11139.pdf');
      expect(service.artifactStatus(invoice)).toMatchObject({
        stage: 'pdf_ready',
        canView: true,
        canDownloadOriginal: true,
      });

      const original = await service.downloadOriginal(invoice);
      expect(original.contentType).toBe('application/zip');
      expect(original.fileName).toBe('11139.zip');
      expect(original.content.equals(zip)).toBe(true);

      const callCount = calls.length;
      const viewedAgain = await service.viewPdf(invoice);
      expect(viewedAgain.content.equals(PDF)).toBe(true);
      expect(calls).toHaveLength(callCount);
      expect(calls).toEqual([
        'GET /',
        'GET /DefaultCaptcha/Generate',
        'POST /xem-hoa-don',
        'GET /Download/DetailHoaDon',
        'GET /tai-ve-hoa-don/' + UUID,
      ]);
    } finally {
      await service.dispose();
    }
  });
});
