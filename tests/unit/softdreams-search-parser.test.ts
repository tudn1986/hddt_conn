import { describe, expect, it } from 'vitest';
import { parseSoftdreamsSearchResponse } from '../../src/server/tvan/adapters/softdreams/search-parser.js';

function encodeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

describe('SoftDreams production-contract search parser', () => {
  it('parses #InvData + showInv token and never mistakes embedded image base64 for the token', () => {
    const firstImageBase64 = 'A'.repeat(160) + '0123456789';
    const secondImageBase64 = 'B'.repeat(160) + '9876543210';
    const expectedToken = 'SHOWINV_TOKEN_Abc1234567890+/SHOWINV_TOKEN_Abc1234567890+/XYZ';
    const invoiceHtml = `
      <div class="VATTEMP">
        <img src="data:image/jpeg;base64,${firstImageBase64}">
        <img src="data:image/png;base64,${secondImageBase64}">
        <table><tbody><tr><td>Hóa đơn</td></tr></tbody></table>
      </div>`;
    const invData = encodeAttr(JSON.stringify({
      str: invoiceHtml,
      idInvoice: 17,
      pattern: '1C26TYY',
      cusType: '1',
    }));
    const pageHtml = `<!doctype html><html><body>
      <form><input id="InvData" value="${invData}"></form>
      <script>
        var data = JSON.parse(document.getElementById('InvData').value);
        var model = {
          IsAutoRow: true,
          IsRowPerPage: false,
          DiffRowBreaking: 250,
          DiffFooterBreaking: 0,
          DiffEmptyRowAppended: 50,
          IsAppendEmptyRow: true,
          Layout: 1,
          toolbarType: ''
        };
        showInv(data.str, 5, 20, model, '${expectedToken}');
      </script>
    </body></html>`;

    const result = parseSoftdreamsSearchResponse(pageHtml);
    expect(result.invoiceToken).toBe(expectedToken);
    expect(result.invoiceToken).not.toBe(firstImageBase64);
    expect(result.invoiceHtml).toContain('VATTEMP');
    expect(result.invoiceHtml).not.toContain('id="InvData"');
    expect(result.invoiceHtml).not.toContain('<form');
    expect(result.renderModel.IsAutoRow).toBe(true);
    expect(result.renderModel.IsRowPerPage).toBe(false);
    expect(result.renderModel.DiffRowBreaking).toBe(250);
    expect(result.renderModel.toolbarType).toBe('');
  });

  it('fails closed when showInv(data.str, ...) is absent even if long base64-looking text exists', () => {
    const invoiceHtml = `<div class="VATTEMP"><img src="data:image/png;base64,${'C'.repeat(200)}"></div>`;
    const invData = encodeAttr(JSON.stringify({ str: invoiceHtml }));
    const pageHtml = `<html><body>
      <input id="InvData" value="${invData}">
      <script>var model={IsAutoRow:false,IsRowPerPage:true,Layout:1,toolbarType:''};</script>
    </body></html>`;

    expect(() => parseSoftdreamsSearchResponse(pageHtml)).toThrowError(
      expect.objectContaining({ code: 'TVAN_SOFTDREAMS_TOKEN_NOT_FOUND' }),
    );
  });
});
