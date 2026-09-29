import { describe, expect, it } from 'vitest';
import {
  parseCaptchaBootstrapHtml,
  parseThaisonDetailHtml,
  parseThaisonLookupResultHtml,
  resolveDownloadDescriptor,
} from '../../src/server/tvan/adapters/thaison/parser.js';

const UUID = '2067f654-be40-4039-a43f-70d316508774';
const UUID2 = '3067f654-be40-4039-a43f-70d316508775';

describe('Thái Sơn structural HTML parser', () => {
  it('parses one tenant CAPTCHA form without executing script', () => {
    const parsed = parseCaptchaBootstrapHtml(
      '<html><body>'
      + '<form action="/xem-hoa-don" method="post">'
      + '<input name="MA_NHAN_HOA_DON" />'
      + '<input name="CaptchaDeText" value="opaque-id" />'
      + '<input name="CaptchaInputText" />'
      + '<img id="CaptchaImage" src="/DefaultCaptcha/Generate?t=opaque-id" />'
      + '</form>'
      + '<script>throw new Error("must not execute")</script>'
      + '</body></html>',
    );
    expect(parsed).toEqual({
      actionPath: '/xem-hoa-don',
      opaqueId: 'opaque-id',
      imagePath: '/DefaultCaptcha/Generate?t=opaque-id',
    });
  });

  it('rejects conflicting CAPTCHA forms', () => {
    const html = [
      '<form action="/xem-hoa-don" method="post"><input name="CaptchaDeText" value="a" /><img id="CaptchaImage" src="/a.gif" /></form>',
      '<form action="/xem-hoa-don" method="post"><input name="CaptchaDeText" value="b" /><img id="CaptchaImage" src="/b.gif" /></form>',
    ].join('');
    expect(() => parseCaptchaBootstrapHtml(html)).toThrow(/đúng một form/i);
  });

  it('requires DetailHoaDon structural marker for a successful lookup', () => {
    const success = parseThaisonLookupResultHtml(
      '<iframe src="/Download/DetailHoaDon"></iframe>'
      + '<script>const x="/tai-ve-hoa-don/' + UUID + '?printFlag=true";</script>',
    );
    expect(success.detailPath).toBe('/Download/DetailHoaDon');
    expect(success.descriptors).toEqual([{
      relativePath: '/tai-ve-hoa-don/' + UUID,
      downloadId: UUID,
    }]);

    expect(() => parseThaisonLookupResultHtml('<div id="listresult">Captcha invalid</div>'))
      .toThrow(/CAPTCHA hoặc Mã TC/i);
  });

  it('extracts one canonical download UUID across link/query variants and rejects ambiguity', () => {
    const detail = parseThaisonDetailHtml(
      '<div>MST 0311996400-001</div>'
      + '<a href="/tai-ve-hoa-don/' + UUID + '">ZIP</a>'
      + '<a href="/tai-ve-hoa-don/' + UUID + '?printFlag=true&printFlagSignature=true">Print</a>',
    );
    expect(resolveDownloadDescriptor(detail.descriptors)).toMatchObject({
      relativePath: '/tai-ve-hoa-don/' + UUID,
      downloadId: UUID,
    });

    const ambiguous = parseThaisonDetailHtml(
      '<div>Thái Sơn EInvoice detail representation</div>'
      + '<a href="/tai-ve-hoa-don/' + UUID + '">A</a>'
      + '<a href="/tai-ve-hoa-don/' + UUID2 + '">B</a>',
    );
    expect(() => resolveDownloadDescriptor(ambiguous.descriptors)).toThrow(/nhiều download UUID/i);
  });
});
