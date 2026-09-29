import { describe, expect, it, vi } from 'vitest';
import {
  canUseRowRenderer,
  renderSoftdreamsRepresentation,
} from '../../src/server/tvan/adapters/softdreams/representation-renderer.js';
import type { SoftdreamsSearchResult } from '../../src/server/tvan/adapters/softdreams/search-parser.js';

function search(overrides: Partial<SoftdreamsSearchResult> = {}): SoftdreamsSearchResult {
  return {
    invoiceHtml: '<div class="VATTEMP"><table><tbody>'
      + '<tr><td>1</td></tr><tr><td>2</td></tr><tr><td>3</td></tr>'
      + '</tbody></table><script>window.evil=true</script></div>',
    invoiceToken: 'token-token-token-token-token',
    rowPerPage: 2,
    renderModel: {
      IsAutoRow: false,
      IsRowPerPage: true,
      DiffRowBreaking: 0,
      DiffFooterBreaking: 0,
      DiffEmptyRowAppended: 0,
      IsAppendEmptyRow: false,
      Layout: 1,
      toolbarType: '',
    },
    ...overrides,
  };
}

describe('SoftDreams representation renderer selection', () => {
  it('uses deterministic row pagination when the model is row-based', async () => {
    const input = search();
    expect(canUseRowRenderer(input)).toBe(true);

    const result = await renderSoftdreamsRepresentation(input);
    expect(result.renderer).toBe('row');
    expect(result.pageCount).toBe(2);
    expect(result.html).toContain("page-break-before: always");
    expect(result.html).not.toContain('<script');
    expect(Buffer.from(result.htmlBase64, 'base64').toString('utf8')).toBe(result.html);
  });

  it('selects the exact layout renderer for IsAutoRow=true and IsRowPerPage=false', async () => {
    const input = search({
      renderModel: {
        IsAutoRow: true,
        IsRowPerPage: false,
        DiffRowBreaking: 250,
        DiffFooterBreaking: 0,
        DiffEmptyRowAppended: 50,
        IsAppendEmptyRow: true,
        Layout: 1,
        toolbarType: '',
      },
    });
    expect(canUseRowRenderer(input)).toBe(false);
    const exactRenderer = vi.fn(async () => ({
      html: '<div class="VATTEMP">exact-layout</div>',
      htmlBase64: Buffer.from('<div class="VATTEMP">exact-layout</div>').toString('base64'),
      pageCount: 2,
      renderer: 'chromium' as const,
    }));

    const result = await renderSoftdreamsRepresentation(input, { exactRenderer });
    expect(exactRenderer).toHaveBeenCalledOnce();
    expect(result.renderer).toBe('chromium');
    expect(result.pageCount).toBe(2);
  });
});
