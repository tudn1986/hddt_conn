import { parse } from 'parse5';
import { AppError } from '../../../../shared/utils/index.js';

type HtmlAttr = { name: string; value: string };
type HtmlNode = {
  nodeName?: string;
  tagName?: string;
  attrs?: HtmlAttr[];
  childNodes?: HtmlNode[];
  value?: string;
};

export interface ThaisonCaptchaBootstrap {
  actionPath: '/xem-hoa-don';
  opaqueId: string;
  imagePath: string;
}

export interface ThaisonDownloadDescriptor {
  relativePath: string;
  downloadId: string;
}

export interface ThaisonLookupResult {
  detailPath: '/Download/DetailHoaDon';
  descriptors: ThaisonDownloadDescriptor[];
}

export interface ThaisonDetailResult {
  visibleText: string;
  descriptors: ThaisonDownloadDescriptor[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DOWNLOAD_RE = /\/tai-ve-hoa-don\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/ig;

function attr(node: HtmlNode, name: string): string | undefined {
  return node.attrs?.find((item) => item.name.toLocaleLowerCase('en-US') === name.toLocaleLowerCase('en-US'))?.value;
}

function walk(node: HtmlNode, visit: (node: HtmlNode) => void): void {
  visit(node);
  for (const child of node.childNodes || []) walk(child, visit);
}

function descendants(node: HtmlNode, predicate: (node: HtmlNode) => boolean): HtmlNode[] {
  const result: HtmlNode[] = [];
  walk(node, (child) => {
    if (child !== node && predicate(child)) result.push(child);
  });
  return result;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function textOf(node: HtmlNode, includeScript = false): string {
  const parts: string[] = [];
  const visit = (current: HtmlNode, blocked: boolean): void => {
    const tag = String(current.tagName || '').toLocaleLowerCase('en-US');
    const nextBlocked = blocked || (!includeScript && (tag === 'script' || tag === 'style'));
    if (!nextBlocked && current.nodeName === '#text' && typeof current.value === 'string') parts.push(current.value);
    for (const child of current.childNodes || []) visit(child, nextBlocked);
  };
  visit(node, false);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function normalizePath(raw: string): string | undefined {
  try {
    const parsed = new URL(raw, 'https://tenant.invalid');
    if (parsed.origin !== 'https://tenant.invalid') return undefined;
    return parsed.pathname;
  } catch {
    return undefined;
  }
}

function downloadDescriptors(root: HtmlNode): ThaisonDownloadDescriptor[] {
  const candidates: string[] = [];
  walk(root, (node) => {
    for (const name of ['href', 'src', 'action', 'data-url', 'data-href']) {
      const value = attr(node, name);
      if (value) candidates.push(value);
    }
    if (String(node.tagName || '').toLocaleLowerCase('en-US') === 'script') {
      const script = textOf(node, true).replace(/\\\//g, '/');
      if (script) candidates.push(script);
    }
  });

  const byId = new Map<string, ThaisonDownloadDescriptor>();
  for (const candidate of candidates) {
    const decoded = candidate.replace(/&amp;/gi, '&');
    for (const match of decoded.matchAll(DOWNLOAD_RE)) {
      const id = match[1];
      if (!UUID_RE.test(id)) continue;
      const normalizedId = id.toLocaleLowerCase('en-US');
      byId.set(normalizedId, {
        downloadId: normalizedId,
        relativePath: `/tai-ve-hoa-don/${normalizedId}`,
      });
    }
  }
  return [...byId.values()];
}

export function parseCaptchaBootstrapHtml(html: string): ThaisonCaptchaBootstrap {
  const root = parse(html) as unknown as HtmlNode;
  const forms = descendants(root, (node) => {
    if (String(node.tagName || '').toLocaleLowerCase('en-US') !== 'form') return false;
    const method = String(attr(node, 'method') || 'get').toLocaleLowerCase('en-US');
    return method === 'post' && normalizePath(attr(node, 'action') || '')?.toLocaleLowerCase('en-US') === '/xem-hoa-don';
  });
  if (forms.length !== 1) {
    throw new AppError(
      'TVAN_THAISON_CAPTCHA_BOOTSTRAP_FAILED',
      'Trang tenant Thái Sơn không có đúng một form POST /xem-hoa-don.',
      502,
      true,
    );
  }

  const form = forms[0];
  const requiredInputs = new Set(descendants(form, (node) =>
    String(node.tagName || '').toLocaleLowerCase('en-US') === 'input',
  ).map((node) => String(attr(node, 'name') || '').toLocaleLowerCase('en-US')).filter(Boolean));
  if (!requiredInputs.has('ma_nhan_hoa_don') || !requiredInputs.has('captchadetext') || !requiredInputs.has('captchainputtext')) {
    throw new AppError(
      'TVAN_THAISON_CAPTCHA_BOOTSTRAP_FAILED',
      'Form tenant Thái Sơn thiếu field tra cứu/CAPTCHA đã được xác minh.',
      502,
      true,
    );
  }

  const opaqueIds = unique(descendants(form, (node) =>
    String(node.tagName || '').toLocaleLowerCase('en-US') === 'input'
    && String(attr(node, 'name') || '').toLocaleLowerCase('en-US') === 'captchadetext',
  ).map((node) => String(attr(node, 'value') || '').trim()).filter(Boolean));

  const imagePaths = unique(descendants(form, (node) =>
    String(node.tagName || '').toLocaleLowerCase('en-US') === 'img'
    && String(attr(node, 'id') || '').toLocaleLowerCase('en-US') === 'captchaimage',
  ).map((node) => String(attr(node, 'src') || '').trim()).filter(Boolean));

  if (opaqueIds.length !== 1 || imagePaths.length !== 1 || opaqueIds[0].length > 256) {
    throw new AppError(
      'TVAN_THAISON_CAPTCHA_BOOTSTRAP_FAILED',
      'Trang tenant Thái Sơn trả CAPTCHA state mâu thuẫn hoặc thiếu dữ liệu.',
      502,
      true,
    );
  }

  return {
    actionPath: '/xem-hoa-don',
    opaqueId: opaqueIds[0],
    imagePath: imagePaths[0],
  };
}

export function parseThaisonLookupResultHtml(html: string): ThaisonLookupResult {
  const root = parse(html) as unknown as HtmlNode;
  const detailPaths = unique(descendants(root, (node) =>
    String(node.tagName || '').toLocaleLowerCase('en-US') === 'iframe',
  ).map((node) => normalizePath(String(attr(node, 'src') || '')))
    .filter((value): value is string => Boolean(value))
    .filter((value) => value.toLocaleLowerCase('en-US') === '/download/detailhoadon'));

  if (detailPaths.length !== 1) {
    throw new AppError(
      'TVAN_THAISON_CAPTCHA_INVALID',
      'Thái Sơn chưa trả kết quả tra cứu hợp lệ; CAPTCHA hoặc Mã TC có thể không đúng/hết hạn.',
      422,
      true,
    );
  }

  return {
    detailPath: '/Download/DetailHoaDon',
    descriptors: downloadDescriptors(root),
  };
}

export function parseThaisonDetailHtml(html: string): ThaisonDetailResult {
  const root = parse(html) as unknown as HtmlNode;
  const visibleText = textOf(root);
  if (!visibleText || visibleText.length < 20) {
    throw new AppError('TVAN_THAISON_DETAIL_INVALID', 'HTML bản thể hiện Thái Sơn không hợp lệ.', 502, true);
  }
  return {
    visibleText,
    descriptors: downloadDescriptors(root),
  };
}

export function resolveDownloadDescriptor(
  ...groups: ThaisonDownloadDescriptor[][]
): ThaisonDownloadDescriptor {
  const byId = new Map<string, ThaisonDownloadDescriptor>();
  for (const item of groups.flat()) byId.set(item.downloadId, item);
  const values = [...byId.values()];
  if (!values.length) {
    throw new AppError(
      'TVAN_THAISON_DOWNLOAD_DESCRIPTOR_MISSING',
      'Không tìm thấy download descriptor Thái Sơn trong lookup/detail HTML.',
      502,
      false,
      undefined,
      { retryStage: 'prepare_artifact', preserveContext: true },
    );
  }
  if (values.length > 1) {
    throw new AppError(
      'TVAN_THAISON_DOWNLOAD_DESCRIPTOR_AMBIGUOUS',
      'Lookup/detail Thái Sơn chứa nhiều download UUID khác nhau.',
      502,
      false,
      undefined,
      { retryStage: 'prepare_artifact', preserveContext: true },
    );
  }
  return values[0];
}
