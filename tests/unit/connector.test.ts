import { describe, expect, it, vi } from 'vitest';
import { buildInvoiceSearch, LiveGdtConnector, SessionExpiredError } from '../../src/server/gdt/connector.js';
import { createMockInvoiceZip } from '../../src/server/gdt/zip.js';
import { locator } from '../helpers.js';

const captchaSvg = '<svg xmlns="http://www.w3.org/2000/svg"><text>AB12</text></svg>';

describe('live GDT connector', () => {
  it('uses verified auth contract, preserves CAPTCHA cookies and never exposes token', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      if (calls.length === 1) {
        return new Response(JSON.stringify({ key: 'captcha-key', content: captchaSvg }), {
          status: 200,
          headers: { 'content-type': 'application/json', 'set-cookie': 'CAPTCHA_SESSION=abc; Path=/; HttpOnly' },
        });
      }
      if (calls.length === 2) {
        expect(new Headers(init?.headers).get('cookie')).toContain('CAPTCHA_SESSION=abc');
        expect(JSON.parse(String(init?.body))).toEqual({
          username: '0101234567', password: 'not-persisted', cvalue: 'AB12', ckey: 'captcha-key',
        });
        return new Response(JSON.stringify({ token: 'jwt-secret-value' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer jwt-secret-value');
      return new Response(JSON.stringify({ datas: [], total: 0 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;
    const connector = new LiveGdtConnector({ fetchImpl: fetchMock });

    const challenge = await connector.startSession();
    expect(challenge.ckey).toBe('captcha-key');
    expect(challenge.captchaImageBase64).toMatch(/^data:image\/svg\+xml;base64,/);
    const result = await connector.login({
      username: '0101234567', password: 'not-persisted', captcha: 'AB12', ckey: challenge.ckey,
    });
    expect(result).toEqual({ success: true, message: 'Đăng nhập thành công.' });
    expect(JSON.stringify(result)).not.toContain('jwt-secret-value');
    await connector.queryInvoices({ direction: 'purchase', fromDate: '2026-09-01', toDate: '2026-09-09' });

    expect(new URL(calls[0].url).pathname).toBe('/api/captcha');
    expect(new URL(calls[1].url).pathname).toBe('/api/security-taxpayer/authenticate');
    expect(new URL(calls[2].url).pathname).toBe('/api/query/invoices/purchase');
  });

  it('uses the composite detail keys and exact Action header', async () => {
    let requestUrl = '';
    let action = '';
    const connector = new LiveGdtConnector({
      fetchImpl: (async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        if (url.pathname === '/api/captcha') {
          return new Response(JSON.stringify({ key: 'k', content: captchaSvg }), { headers: { 'content-type': 'application/json' } });
        }
        if (url.pathname.includes('authenticate')) {
          return new Response(JSON.stringify({ token: 't' }), { headers: { 'content-type': 'application/json' } });
        }
        requestUrl = url.toString();
        action = new Headers(init?.headers).get('action') || '';
        return new Response(JSON.stringify({ data: { shdon: 123 } }), { headers: { 'content-type': 'application/json' } });
      }) as typeof fetch,
    });
    const challenge = await connector.startSession();
    await connector.login({ username: '0101234567', password: 'x', captcha: 'AB12', ckey: challenge.ckey });
    await connector.getInvoiceDetail('standard', locator());
    const url = new URL(requestUrl);
    expect(url.pathname).toBe('/api/query/invoices/detail');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      nbmst: '4501622475', khhdon: '1C26TST', shdon: '123', khmshdon: '1',
    });
    expect(action).toBe(encodeURIComponent('Xem hóa đơn (hóa đơn điện tử)'));
  });

  it('extracts XML from the verified export-xml ZIP response', async () => {
    const xml = Buffer.from('<?xml version="1.0"?><HDon><SHDon>123</SHDon></HDon>');
    const zip = await createMockInvoiceZip(xml);
    const connector = new LiveGdtConnector({
      fetchImpl: (async (input: string | URL | Request) => {
        const url = new URL(String(input));
        if (url.pathname === '/api/captcha') return new Response(JSON.stringify({ key: 'k', content: captchaSvg }), { headers: { 'content-type': 'application/json' } });
        if (url.pathname.includes('authenticate')) return new Response(JSON.stringify({ token: 't' }), { headers: { 'content-type': 'application/json' } });
        expect(url.pathname).toBe('/api/query/invoices/export-xml');
        return new Response(zip as unknown as BodyInit, { headers: { 'content-type': 'application/zip' } });
      }) as typeof fetch,
    });
    const challenge = await connector.startSession();
    await connector.login({ username: '0101234567', password: 'x', captcha: 'AB12', ckey: challenge.ckey });
    const downloadedXml = await connector.downloadXml('standard', locator());
    const downloadedZip = await connector.downloadZip('standard', locator());
    expect(downloadedXml.content.equals(xml)).toBe(true);
    expect(downloadedXml.contentType).toBe('application/xml');
    expect(downloadedZip.content.subarray(0, 2).toString()).toBe('PK');
  });

  it('queries the verified sold endpoint with the observed page size and Action header', async () => {
    let queryUrl = '';
    let queryAction = '';
    const connector = new LiveGdtConnector({
      fetchImpl: (async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        if (url.pathname === '/api/captcha') {
          return new Response(JSON.stringify({ key: 'k', content: captchaSvg }), { headers: { 'content-type': 'application/json' } });
        }
        if (url.pathname.includes('authenticate')) {
          return new Response(JSON.stringify({ token: 't' }), { headers: { 'content-type': 'application/json' } });
        }
        queryUrl = url.toString();
        queryAction = new Headers(init?.headers).get('action') || '';
        return new Response(JSON.stringify({ datas: [], total: 0 }), { headers: { 'content-type': 'application/json' } });
      }) as typeof fetch,
    });
    const challenge = await connector.startSession();
    await connector.login({ username: '0101234567', password: 'x', captcha: 'AB12', ckey: challenge.ckey });
    const page = await connector.queryInvoices({ direction: 'sales', fromDate: '2026-09-01', toDate: '2026-09-09' });
    const url = new URL(queryUrl);
    expect(url.pathname).toBe('/api/query/invoices/sold');
    expect(url.searchParams.get('size')).toBe('15');
    expect(url.searchParams.get('search')).toContain('tdlap=ge=01/09/2026T00:00:00');
    expect(queryAction).toBe(encodeURIComponent('Tìm kiếm (hóa đơn bán ra)'));
    expect(page.pageSize).toBe(15);
  });


  it('routes POS purchase, detail and export through sco-query', async () => {
    const requests: Array<{ path: string; method: string; action: string | null }> = [];
    const xml = Buffer.from('<?xml version="1.0"?><HDon><DLHDon/></HDon>');
    const zip = await createMockInvoiceZip(xml);
    const connector = new LiveGdtConnector({
      fetchImpl: (async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        if (url.pathname === '/api/captcha') return new Response(JSON.stringify({ key: 'k', content: captchaSvg }), { headers: { 'content-type': 'application/json' } });
        if (url.pathname.includes('authenticate')) return new Response(JSON.stringify({ token: 't' }), { headers: { 'content-type': 'application/json' } });
        requests.push({ path: url.pathname, method: init?.method || 'GET', action: new Headers(init?.headers).get('action') });
        if (url.pathname.endsWith('/purchase')) return new Response(JSON.stringify({ datas: [], total: 0 }), { headers: { 'content-type': 'application/json' } });
        if (url.pathname.endsWith('/detail')) return new Response(JSON.stringify({ nbmst: '0110269067', khmshdon: 1, khhdon: 'C26MHA', shdon: 64929330 }), { headers: { 'content-type': 'application/json' } });
        return new Response(zip as unknown as BodyInit, { headers: { 'content-type': 'application/zip' } });
      }) as typeof fetch,
    });
    const challenge = await connector.startSession();
    await connector.login({ username: '0101234567', password: 'x', captcha: 'AB12', ckey: challenge.ckey });
    const posLocator = { sellerTaxCode: '0110269067', templateNo: 1, series: 'C26MHA', invoiceNo: 64929330 };
    await connector.queryInvoices({ direction: 'purchase', source: 'pos', fromDate: '2026-05-01', toDate: '2026-05-31', status: '8' });
    await connector.getInvoiceDetail('pos', posLocator);
    await connector.downloadXml('pos', posLocator);
    expect(requests.map(r => r.path)).toEqual([
      '/api/sco-query/invoices/purchase',
      '/api/sco-query/invoices/detail',
      '/api/sco-query/invoices/export-xml',
    ]);
    expect(requests[0].action).toBeNull();
    expect(requests[1].action).toBeNull();
    expect(requests[2].method).toBe('POST');
  });

  it('requires authentication for sales detail and downloads', async () => {
    const connector = new LiveGdtConnector();
    await expect(connector.getInvoiceDetail('standard', locator())).rejects.toBeInstanceOf(SessionExpiredError);
    await expect(connector.downloadXml('standard', locator())).rejects.toBeInstanceOf(SessionExpiredError);
    await expect(connector.downloadZip('standard', locator())).rejects.toBeInstanceOf(SessionExpiredError);
  });

  it('refuses any connector origin outside the verified GDT host', () => {
    expect(() => new LiveGdtConnector({ origin: 'https://evil.example' })).toThrow(/chỉ cho phép origin GDT/i);
  });
});

describe('GDT search expression', () => {
  it('formats date bounds and supported filters', () => {
    expect(buildInvoiceSearch({
      direction: 'purchase',
      fromDate: '2026-09-01',
      toDate: '2026-09-09',
      partnerTaxCode: '4501622475',
      invoiceNo: '123',
      series: '1C26TST',
      documentType: '1',
      status: '5',
    })).toBe('tdlap=ge=01/09/2026T00:00:00;tdlap=le=09/09/2026T23:59:59;ttxly==5;nbmst==4501622475;shdon==123;khhdon==1C26TST;khmshdon==1');
  });

  it('allows an explicit all-status query but blocks search-expression injection', () => {
    expect(buildInvoiceSearch({ direction: 'sales', fromDate: '2026-09-01', toDate: '2026-09-09', status: '*' }))
      .not.toContain('ttxly');
    expect(() => buildInvoiceSearch({
      direction: 'purchase', fromDate: '2026-09-01', toDate: '2026-09-09', series: 'x;ttxly==1',
    })).toThrow(/ký hiệu/i);
  });
});
