import { describe, expect, it, vi } from 'vitest';
import { document } from '../helpers.js';
import { AcmanTvanAdapter, acmanLookupFromXml } from '../../src/server/tvan/adapters/acman.js';
import { TvanRegistry } from '../../src/server/tvan/registry.js';
import type { TvanAdapterContext } from '../../src/server/tvan/types.js';

const PDF = Buffer.from('%PDF-1.3\n1 0 obj\n<<>>\nendobj\n%%EOF\n');

function acmanDocument(overrides: Record<string, unknown> = {}) {
  return document({
    seller: { taxCode: '2700506860', name: 'DNTN Cơ khí Gia Long', dynamicFields: [] },
    series: 'C23TGL',
    invoiceNo: '15',
    providerCode: 'tvan_efy',
    providers: {
      solution: { taxCode: '0104908371' },
      transport: { taxCode: '0102519041', code: 'tvan_efy' },
    },
    lookup: {
      providerCode: 'tvan_efy',
      lookupCode: 'F89780321430',
      lookupCodeType: 'MA_TRA_CUU',
      confidence: 'medium',
    },
    rawSummary: { msttcgp: '0104908371', ngcnhat: 'tvan_efy', cttkhac: [{ ttruong: 'MA_TRA_CUU', dlieu: 'F89780321430' }] },
    ...overrides,
  } as any);
}
function context(fetchImpl: typeof fetch, loadInvoiceXml?: TvanAdapterContext['loadInvoiceXml']): TvanAdapterContext {
  return {
    fetchImpl,
    timeoutMs: 5_000,
    maxDownloadBytes: 2 * 1024 * 1024,
    setToken() {},
    loadInvoiceXml,
  };
}

const BOOTSTRAP = `<html><form>
<input type="hidden" name="__VIEWSTATE" value="VS1">
<input type="hidden" name="__EVENTVALIDATION" value="EV1">
</form></html>`;

const RESULT = `<html><form>
<input type="hidden" name="__VIEWSTATE" value="VS2">
<input type="hidden" name="__EVENTVALIDATION" value="EV2">
<table><tr>
<td>1</td><td>2700506860</td><td>DNTN Cơ khí Gia Long</td><td>1</td>
<td>C23TGL</td><td>00000015</td><td>12/12/2023</td>
<td>1,738,000,000</td>
<td><a href="javascript:__doPostBack('ctl00$PageContent$rptDanhSachHoaDon$ctl00$btnDownloadPDF','')">PDF</a></td>
</tr></table></form></html>`;

function response(body: BodyInit | null, init: ResponseInit = {}) {
  return new Response(body, init);
}
describe('ACMAN adapter', () => {
  it('resolves exact MSTTCGP instead of EFY transport metadata', () => {
    const registry = new TvanRegistry();
    const doc = acmanDocument();
    expect(registry.resolve(doc)?.providerCode).toBe('tvan_acman');
    expect(registry.capability(doc)).toMatchObject({
      providerCode: 'tvan_acman',
      displayName: 'ACMAN AC-Invoice',
      supported: true,
      captchaMode: 'none',
      priority: 'P1',
    });
  });

  it('does not match another solution provider on the same transport', () => {
    const other = acmanDocument({
      providers: { solution: { taxCode: '0102519041' }, transport: { code: 'tvan_efy' } },
      rawSummary: { msttcgp: '0102519041', ngcnhat: 'tvan_efy' },
    });
    expect(new TvanRegistry().resolve(other)?.providerCode).not.toBe('tvan_acman');
  });

  it('extracts MA_TRA_CUU from XML TTKhac', () => {
    const xml = Buffer.from('<HDon><DLHDon><TTKhac><TTin><TTruong>MA_TRA_CUU</TTruong><DLieu>ABC123</DLieu></TTin></TTKhac></DLHDon></HDon>');
    expect(acmanLookupFromXml(xml)).toBe('ABC123');
  });
  it('performs WebForms lookup and downloads the matching PDF', async () => {
    const calls: Array<{ url: string; method: string; body?: string; cookie?: string }> = [];
    const fetchImpl = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input);
      const method = String(init?.method || 'GET').toUpperCase();
      const headers = new Headers(init?.headers || {});
      const body = typeof init?.body === 'string' ? init.body : undefined;
      calls.push({ url, method, body, cookie: headers.get('cookie') || undefined });
      if (method === 'GET') return response(BOOTSTRAP, { status: 200, headers: { 'content-type': 'text/html', 'set-cookie': 'ASP.NET_SessionId=A1; Path=/' } });
      if (method === 'POST' && body?.includes('btnTraCuu')) return response(RESULT, { status: 200, headers: { 'content-type': 'text/html' } });
      if (method === 'POST' && body?.includes('btnDownloadPDF')) {
        return response(PDF, { status: 200, headers: { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="2700506860-1-C23TGL-00000015.PDF"' } });
      }
      throw new Error('Unexpected request ' + method + ' ' + url);
    }) as unknown as typeof fetch;

    const pdf = await new AcmanTvanAdapter().downloadPdf(acmanDocument(), context(fetchImpl));
    expect(pdf.content.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.fileName).toBe('2700506860-1-C23TGL-00000015.PDF');
    expect(calls).toHaveLength(3);
    expect(calls[1]?.body).toContain('txtMaDonViPhatHanh=2700506860');
    expect(calls[1]?.body).toContain('txtMaTraCuuHoaDon=F89780321430');
    expect(calls[2]?.body).toContain('btnDownloadPDF');
    expect(calls[2]?.cookie).toContain('ASP.NET_SessionId=A1');
  });
  it('uses the GDT XML bridge if the dataset has no lookup code', async () => {
    const loadInvoiceXml = vi.fn().mockResolvedValue(Buffer.from(
      '<HDon><DLHDon><TTKhac><TTin><TTruong>Mã tra cứu</TTruong><DLieu>XML-CODE</DLieu></TTin></TTKhac></DLHDon></HDon>',
    ));
    const adapter = new AcmanTvanAdapter();
    const result = await adapter.resolvePresentationLink(acmanDocument({ lookup: undefined, rawSummary: { msttcgp: '0104908371' } }), context(vi.fn() as any, loadInvoiceXml));
    expect(loadInvoiceXml).toHaveBeenCalledOnce();
    expect(result.lookupCode).toBe('XML-CODE');
  });

  it('rejects a lookup result that belongs to another invoice', async () => {
    const wrong = RESULT.replace('00000015', '00000999');
    const fetchImpl = vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
      const method = String(init?.method || 'GET').toUpperCase();
      const body = typeof init?.body === 'string' ? init.body : '';
      if (method === 'GET') return response(BOOTSTRAP, { status: 200, headers: { 'content-type': 'text/html' } });
      if (body.includes('btnTraCuu')) return response(wrong, { status: 200, headers: { 'content-type': 'text/html' } });
      throw new Error('Unexpected request');
    }) as unknown as typeof fetch;
    await expect(new AcmanTvanAdapter().downloadPdf(acmanDocument(), context(fetchImpl)))
      .rejects.toMatchObject({ code: 'TVAN_ACMAN_INVOICE_MISMATCH' });
  });
});
