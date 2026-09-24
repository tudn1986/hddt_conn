import fs from 'node:fs';
import { chromium, type Browser } from 'playwright-core';
import { parseFragment, serialize } from 'parse5';
import { AppError } from '../../../../shared/utils/index.js';
import type { SoftdreamsSearchResult } from './search-parser.js';

export interface RenderedRepresentation {
  html: string;
  htmlBase64: string;
  pageCount: number;
  renderer: 'row' | 'chromium';
}

type HtmlNode = {
  nodeName?: string;
  tagName?: string;
  attrs?: Array<{ name: string; value: string }>;
  childNodes?: HtmlNode[];
  parentNode?: HtmlNode;
};

function classNames(node: HtmlNode): string[] {
  const value = node.attrs?.find((item) => item.name === 'class')?.value || '';
  return value.split(/\s+/).filter(Boolean);
}

function sanitizeTree(node: HtmlNode): void {
  if (!node.childNodes) return;
  node.childNodes = node.childNodes.filter((child) => {
    const tag = child.tagName?.toLocaleLowerCase();
    if (tag && ['script', 'iframe', 'object', 'embed', 'link'].includes(tag)) return false;
    const classes = classNames(child);
    if (classes.includes('pagination') || (classes.includes('modal-footer'))) return false;
    if (child.attrs) {
      child.attrs = child.attrs.filter((item) => !/^on/i.test(item.name));
      const src = child.attrs.find((item) => item.name === 'src');
      if (src && !/^(?:data:|blob:|about:)/i.test(src.value)) {
        child.attrs = child.attrs.filter((item) => item !== src);
      }
    }
    sanitizeTree(child);
    return true;
  });
}

function sanitizeInvoiceHtml(html: string): string {
  const fragment = parseFragment(html) as unknown as HtmlNode;
  sanitizeTree(fragment);
  return serialize(fragment as never);
}

function findFirst(node: HtmlNode, predicate: (node: HtmlNode) => boolean): HtmlNode | undefined {
  if (predicate(node)) return node;
  for (const child of node.childNodes || []) {
    const found = findFirst(child, predicate);
    if (found) return found;
  }
  return undefined;
}

function directRows(tbody: HtmlNode | undefined): HtmlNode[] {
  return (tbody?.childNodes || []).filter((node) => node.tagName?.toLocaleLowerCase() === 'tr');
}

function renderRowsDeterministically(search: SoftdreamsSearchResult): RenderedRepresentation {
  const sanitized = sanitizeInvoiceHtml(search.invoiceHtml);
  const requestedPerPage = Math.floor(search.rowPerPage || 0);
  if (requestedPerPage <= 0) {
    return {
      html: sanitized,
      htmlBase64: Buffer.from(sanitized, 'utf8').toString('base64'),
      pageCount: 1,
      renderer: 'row',
    };
  }

  const perPage = Math.max(1, requestedPerPage);
  const probe = parseFragment(sanitized) as unknown as HtmlNode;
  const tbody = findFirst(probe, (node) => node.tagName?.toLocaleLowerCase() === 'tbody');
  const rows = directRows(tbody);
  if (rows.length <= perPage) {
    return {
      html: sanitized,
      htmlBase64: Buffer.from(sanitized, 'utf8').toString('base64'),
      pageCount: 1,
      renderer: 'row',
    };
  }

  const pages: string[] = [];
  for (let offset = 0; offset < rows.length; offset += perPage) {
    const fragment = parseFragment(sanitized) as unknown as HtmlNode;
    const pageTbody = findFirst(fragment, (node) => node.tagName?.toLocaleLowerCase() === 'tbody');
    if (!pageTbody) break;
    const pageRows = directRows(pageTbody);
    const keep = new Set(pageRows.slice(offset, offset + perPage));
    pageTbody.childNodes = (pageTbody.childNodes || []).filter((node) => (
      node.tagName?.toLocaleLowerCase() !== 'tr' || keep.has(node)
    ));
    pages.push(serialize(fragment as never));
  }
  const html = pages.join("<p style='page-break-before: always'></p>");
  return {
    html,
    htmlBase64: Buffer.from(html, 'utf8').toString('base64'),
    pageCount: Math.max(1, pages.length),
    renderer: 'row',
  };
}

export function canUseRowRenderer(search: SoftdreamsSearchResult): boolean {
  return search.renderModel.IsAutoRow === false || search.renderModel.IsRowPerPage === true;
}

let browserPromise: Promise<Browser> | undefined;
let activeRendererSlots = 0;
const rendererWaiters: Array<() => void> = [];

function rendererConcurrency(): number {
  const configured = Number(process.env.HDDT_TVAN_RENDER_CONCURRENCY || 2);
  return Number.isFinite(configured) ? Math.max(1, Math.min(8, Math.floor(configured))) : 2;
}

async function withRendererSlot<T>(operation: () => Promise<T>): Promise<T> {
  const limit = rendererConcurrency();
  if (activeRendererSlots >= limit) {
    await new Promise<void>((resolve) => rendererWaiters.push(resolve));
  }
  activeRendererSlots += 1;
  try {
    return await operation();
  } finally {
    activeRendererSlots -= 1;
    rendererWaiters.shift()?.();
  }
}

function chromiumExecutable(): string {
  const configured = process.env.HDDT_CHROMIUM_EXECUTABLE?.trim();
  const candidates = [
    configured,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
  ].filter((value): value is string => Boolean(value));
  const found = candidates.find((value) => fs.existsSync(value));
  if (!found) {
    throw new AppError(
      'TVAN_SOFTDREAMS_RENDERER_UNAVAILABLE',
      'Không tìm thấy Chromium để dựng bản thể hiện SoftDreams theo layout portal.',
      503,
      true,
    );
  }
  return found;
}

async function browser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium.launch({
      executablePath: chromiumExecutable(),
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    }).catch((error: unknown) => {
      browserPromise = undefined;
      throw new AppError(
        'TVAN_SOFTDREAMS_RENDERER_UNAVAILABLE',
        error instanceof Error
          ? `Không khởi tạo được Chromium renderer SoftDreams: ${error.message}`
          : 'Không khởi tạo được Chromium renderer SoftDreams.',
        503,
        true,
      );
    });
  }
  return browserPromise;
}

async function renderWithChromium(search: SoftdreamsSearchResult): Promise<RenderedRepresentation> {
  const safeHtml = sanitizeInvoiceHtml(search.invoiceHtml);
  const instance = await browser();
  const context = await instance.newContext({
    viewport: { width: 1024, height: 1200 },
    javaScriptEnabled: true,
  });
  const page = await context.newPage();
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (/^(?:data:|blob:|about:)/i.test(url)) await route.continue();
    else await route.abort('blockedbyclient');
  });

  const timeoutMs = Math.max(1_000, Number(process.env.HDDT_TVAN_RENDER_TIMEOUT_MS || 15_000));
  page.setDefaultTimeout(timeoutMs);

  try {
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
      html,body{margin:0;padding:0;background:#fff}
      #container{width:808px;margin:0 auto}
      .pagination,.modal-footer{display:none!important}
    </style></head><body><div id="container">${safeHtml}</div></body></html>`, { waitUntil: 'domcontentloaded', timeout: timeoutMs });

    const result = await page.evaluate((input) => {
      const container = document.getElementById('container');
      if (!container) throw new Error('container missing');
      container.querySelectorAll('script,iframe,object,embed').forEach((node) => node.remove());
      container.querySelectorAll<HTMLElement>('.pagination,.modal-footer').forEach((node) => { node.style.display = 'none'; });
      const root = container.querySelector<HTMLElement>('.VATTEMP');
      if (!root) throw new Error('VATTEMP missing');

      const existingPages = Array.from(root.querySelectorAll<HTMLElement>(':scope > .page, :scope > [data-page]'));
      if (existingPages.length > 1) {
        const html = existingPages.map((item) => item.outerHTML).join("<p style='page-break-before: always'></p>");
        return { html, pageCount: existingPages.length };
      }

      const tbody = root.querySelector<HTMLTableSectionElement>('tbody');
      const rows = tbody ? Array.from(tbody.children).filter((node): node is HTMLTableRowElement => node.tagName === 'TR') : [];
      if (rows.length < 2) return { html: container.innerHTML, pageCount: 1 };

      const rootRect = root.getBoundingClientRect();
      const firstRowRect = rows[0].getBoundingClientRect();
      const footer = root.querySelector<HTMLElement>('tfoot,.footer,.invoice-footer');
      const footerHeight = footer?.getBoundingClientRect().height || 0;

      // Measure the physical page in Chromium instead of hard-coding pixel height.
      // 297mm is the portal's portrait print-page contract for the 808px VATTEMP.
      const pageMetric = document.createElement('div');
      pageMetric.setAttribute('aria-hidden', 'true');
      pageMetric.style.cssText = [
        'position:absolute',
        'visibility:hidden',
        'pointer-events:none',
        'width:808px',
        'height:297mm',
        'box-sizing:border-box',
      ].join(';');
      document.body.appendChild(pageMetric);
      const physicalPageHeight = pageMetric.getBoundingClientRect().height;
      pageMetric.remove();

      const topContentOffset = Math.max(0, firstRowRect.top - rootRect.top);
      const providerReservedHeight = Math.max(0, input.diffRowBreaking || 0)
        + Math.max(0, input.diffFooterBreaking || 0)
        + (input.isAppendEmptyRow ? Math.max(0, input.diffEmptyRowAppended || 0) : 0)
        + Math.max(0, footerHeight);
      const rowBudget = physicalPageHeight - topContentOffset - providerReservedHeight;
      if (!Number.isFinite(rowBudget) || rowBudget <= 0) {
        throw new Error('invalid layout budget');
      }

      const groups: number[][] = [];
      let group: number[] = [];
      let used = 0;
      rows.forEach((row, index) => {
        // Browser layout is the source of truth: wrapped text, fonts and merged cells
        // all contribute their measured height. No line-count approximation is used.
        const height = Math.max(1, row.getBoundingClientRect().height);
        if (group.length > 0 && used + height > rowBudget) {
          groups.push(group);
          group = [];
          used = 0;
        }
        group.push(index);
        used += height;
      });
      if (group.length) groups.push(group);
      if (groups.length <= 1) return { html: container.innerHTML, pageCount: 1 };

      const original = container.innerHTML;
      const pageHtml = groups.map((indexes) => {
        const shell = document.createElement('div');
        shell.innerHTML = original;
        const targetRoot = shell.querySelector<HTMLElement>('.VATTEMP');
        const targetBody = targetRoot?.querySelector<HTMLTableSectionElement>('tbody');
        if (!targetRoot || !targetBody) return shell.innerHTML;
        const allowed = new Set(indexes);
        Array.from(targetBody.children).forEach((row, index) => {
          if (row.tagName === 'TR' && !allowed.has(index)) row.remove();
        });
        targetRoot.querySelectorAll<HTMLElement>('.pagination,.modal-footer').forEach((node) => node.remove());
        return shell.innerHTML;
      });
      return {
        html: pageHtml.join("<p style='page-break-before: always'></p>"),
        pageCount: pageHtml.length,
      };
    }, {
      diffRowBreaking: search.renderModel.DiffRowBreaking,
      diffFooterBreaking: search.renderModel.DiffFooterBreaking,
      diffEmptyRowAppended: search.renderModel.DiffEmptyRowAppended,
      isAppendEmptyRow: search.renderModel.IsAppendEmptyRow,
    });

    if (!result.html.includes('VATTEMP')) {
      throw new AppError('TVAN_SOFTDREAMS_RENDER_FAILED', 'Chromium renderer không tạo được nội dung hóa đơn SoftDreams.', 502, true);
    }
    return {
      html: result.html,
      htmlBase64: Buffer.from(result.html, 'utf8').toString('base64'),
      pageCount: result.pageCount,
      renderer: 'chromium',
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error instanceof Error && /Timeout/i.test(error.name + error.message)) {
      throw new AppError('TVAN_SOFTDREAMS_RENDER_TIMEOUT', 'Quá thời gian dựng bản thể hiện SoftDreams.', 504, true);
    }
    throw new AppError(
      'TVAN_SOFTDREAMS_RENDER_FAILED',
      error instanceof Error ? `Không dựng được bản thể hiện SoftDreams: ${error.message}` : 'Không dựng được bản thể hiện SoftDreams.',
      502,
      true,
    );
  } finally {
    await context.close().catch(() => undefined);
  }
}

export type SoftdreamsExactRenderer = (search: SoftdreamsSearchResult) => Promise<RenderedRepresentation>;

export async function renderSoftdreamsRepresentation(
  search: SoftdreamsSearchResult,
  options: { exactRenderer?: SoftdreamsExactRenderer } = {},
): Promise<RenderedRepresentation> {
  if (canUseRowRenderer(search)) return renderRowsDeterministically(search);
  if (options.exactRenderer) return options.exactRenderer(search);
  return withRendererSlot(() => renderWithChromium(search));
}

export async function closeSoftdreamsRenderer(): Promise<void> {
  const running = browserPromise;
  browserPromise = undefined;
  if (running) {
    const instance = await running.catch(() => undefined);
    await instance?.close().catch(() => undefined);
  }
}
