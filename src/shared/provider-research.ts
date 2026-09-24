import type { InvoiceDocument } from './models/index.js';
import { presentationForSolutionTaxCode } from './provider-resolution.js';
import { solutionProviderFriendlyName, solutionProviderTaxCodeOf } from './solution-provider.js';

export type ProviderInfoSource = 'dataset' | 'adapter' | 'official' | 'community';
export type ProviderPortalCandidate = {
  url: string;
  label: string;
  source: ProviderInfoSource;
  confidence: 'high' | 'medium' | 'low';
  note?: string;
};

type KnownProviderResearch = {
  name: string;
  portalUrl?: string;
  lookupUrl?: string;
  source: Exclude<ProviderInfoSource, 'dataset'>;
  confidence: 'high' | 'medium' | 'low';
  note?: string;
};

const KNOWN_PROVIDER_RESEARCH: Record<string, KnownProviderResearch> = {
  '0101243150': { name: 'MISA', portalUrl: 'https://www.meinvoice.vn', lookupUrl: 'https://www.meinvoice.vn/tra-cuu/', source: 'adapter', confidence: 'high' },
  '0100109106': { name: 'VIETTEL', portalUrl: 'https://vinvoice.viettel.vn', lookupUrl: 'https://vinvoice.viettel.vn/utilities/invoice-search', source: 'adapter', confidence: 'high' },
  '0106026495': { name: 'M-INVOICE', portalUrl: 'https://tracuuhoadon.minvoice.com.vn', lookupUrl: 'https://tracuuhoadon.minvoice.com.vn', source: 'adapter', confidence: 'high' },
  '0106026495-001': { name: 'M-INVOICE', portalUrl: 'https://tracuuhoadon.minvoice.com.vn', lookupUrl: 'https://tracuuhoadon.minvoice.com.vn', source: 'adapter', confidence: 'high' },
  '0105987432': { name: 'SOFTDREAMS', source: 'adapter', confidence: 'high', note: 'PortalLink ưu tiên lấy trực tiếp từ hóa đơn/dataset vì có thể khác theo đơn vị phát hành.' },
  '0314743623': { name: 'EHOADONDIENTU', portalUrl: 'https://ehoadondientu.com', lookupUrl: 'https://ehoadondientu.com/Tracuu.aspx', source: 'adapter', confidence: 'high' },
  '0100684378': { name: 'VNPT', portalUrl: 'https://portaltool-miennam.vnpt-invoice.com.vn', lookupUrl: 'https://portaltool-miennam.vnpt-invoice.com.vn/Portal/Index', source: 'adapter', confidence: 'high', note: 'Một số đơn vị phát hành dùng portal VNPT riêng; ưu tiên PortalLink/Fkey trong dataset.' },
  '0104908371': { name: 'ACMAN', portalUrl: 'https://hoadondientu.acman.vn', lookupUrl: 'https://hoadondientu.acman.vn/tra-cuu/hoa-don.html', source: 'adapter', confidence: 'high' },
  '0305795054': { name: 'PVOIL', portalUrl: 'https://hoadon.pvoil.vn', lookupUrl: 'https://hoadon.pvoil.vn/Invoice/Search', source: 'adapter', confidence: 'high' },

  '0401486901': { name: 'VISNAM', portalUrl: 'https://vin-hoadon.com', source: 'community', confidence: 'low', note: 'Discovery candidate; cần XML/PDF/capture thực tế để xác minh contract tra cứu.' },
  '0102519041': { name: 'EFY', portalUrl: 'https://ihoadon.vn', source: 'community', confidence: 'medium', note: 'Website dịch vụ được cộng đồng/tài liệu công khai nhắc tới; cần capture hóa đơn thực tế.' },
  '0101360697': { name: 'BKAV', portalUrl: 'https://www.bkav.com/ehoadon/', source: 'official', confidence: 'medium', note: 'Trang dịch vụ chính thức; URL tra cứu cụ thể cần lấy từ hóa đơn/XML.' },
  '0108971656': { name: 'MY SOFTWARE', source: 'community', confidence: 'low', note: 'Đã xác định doanh nghiệp theo MST nhưng chưa có portal tra cứu đáng tin cậy.' },
  '0105958921': { name: 'ITT', source: 'community', confidence: 'low', note: 'Đã xác định doanh nghiệp theo MST nhưng chưa có portal tra cứu đáng tin cậy.' },
  '0101300842': { name: 'THÁI SƠN', portalUrl: 'https://einvoice.vn', source: 'community', confidence: 'medium', note: 'Portal sản phẩm; cần capture lookup/download của hóa đơn thực tế.' },
  '0104128565': { name: 'FPT IS', portalUrl: 'https://einvoice.fpt.com.vn', source: 'official', confidence: 'medium', note: 'Website FPT.eInvoice chính thức; cần URL/capture tra cứu cụ thể theo hóa đơn.' },
  '0106870211': { name: 'ICORP / VIET-INVOICE', portalUrl: 'https://tracuu.vietinvoice.vn', source: 'community', confidence: 'medium', note: 'Discovery candidate; cần xác minh bằng dataset/XML và network capture.' },
  '0100727825': { name: 'FAST', portalUrl: 'https://einvoice.fast.com.vn', lookupUrl: 'https://einvoice.fast.com.vn', source: 'official', confidence: 'high', note: 'Có bản thể hiện công khai chứa mã tra cứu và portal FAST.' },
  '0100686209': { name: 'MOBIFONE', portalUrl: 'https://tracuuhoadon.mobifone.vn', lookupUrl: 'https://tracuuhoadon.mobifone.vn', source: 'official', confidence: 'high', note: 'MobiFone công khai URL tra cứu hóa đơn.' },
  '0105232093': { name: 'CYBERLOTUS', portalUrl: 'https://cyberbill.vn', source: 'community', confidence: 'medium', note: 'Portal sản phẩm; cần capture lookup/download từ hóa đơn thực tế.' },
  '0103930279': { name: 'NACENCOMM', portalUrl: 'https://hoadon78.nacencomm.vn', source: 'official', confidence: 'high', note: 'Có bản thể hiện công khai trên portal hoadon78.nacencomm.vn.' },
};

function safeHttpUrl(value: unknown): string | undefined {
  const text = String(value ?? '').trim();
  if (!text) return undefined;
  try {
    const url = new URL(text);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function collectUrls(value: unknown, result: Array<{ url: string; path: string }>, path = 'raw', depth = 0): void {
  if (depth > 5 || value === null || value === undefined) return;
  const direct = safeHttpUrl(value);
  if (direct) {
    result.push({ url: direct, path });
    return;
  }
  if (Array.isArray(value)) {
    value.slice(0, 100).forEach((item, index) => collectUrls(item, result, `${path}[${index}]`, depth + 1));
    return;
  }
  if (typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (/cookie|authorization|password|passwd|access.?token|refresh.?token/i.test(key)) continue;
    collectUrls(child, result, `${path}.${key}`, depth + 1);
  }
}

function uniquePortals(items: ProviderPortalCandidate[]): ProviderPortalCandidate[] {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = item.url.replace(/\/$/, '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function providerResearchFor(document: InvoiceDocument): {
  solutionTaxCode?: string;
  providerName?: string;
  adapterCode?: string;
  lookupCode?: string;
  lookupCodeType?: string;
  lookupSource?: string;
  lookupConfidence?: string;
  portals: ProviderPortalCandidate[];
  known?: KnownProviderResearch;
  supportedByKnownAdapter: boolean;
} {
  const solutionTaxCode = solutionProviderTaxCodeOf(document);
  const known = solutionTaxCode ? KNOWN_PROVIDER_RESEARCH[solutionTaxCode] : undefined;
  const presentation = presentationForSolutionTaxCode(solutionTaxCode);
  const portals: ProviderPortalCandidate[] = [];

  if (document.lookup?.lookupBaseUrl) {
    const path = document.lookup.lookupPathRaw || '';
    const observed = safeHttpUrl(path ? new URL(path, document.lookup.lookupBaseUrl).toString() : document.lookup.lookupBaseUrl);
    if (observed) portals.push({
      url: observed,
      label: 'Link tra cứu trong dataset',
      source: 'dataset',
      confidence: document.lookup.confidence || 'medium',
      note: [document.lookup.sourceSection, document.lookup.sourceField].filter(Boolean).join(' · ') || undefined,
    });
  }

  const rawUrls: Array<{ url: string; path: string }> = [];
  collectUrls(document.rawSummary, rawUrls, 'rawSummary');
  collectUrls(document.rawDetail, rawUrls, 'rawDetail');
  for (const item of rawUrls) {
    portals.push({ url: item.url, label: 'URL quan sát trong Raw JSON', source: 'dataset', confidence: 'medium', note: item.path });
  }

  if (known?.lookupUrl) portals.push({ url: known.lookupUrl, label: 'URL tra cứu tham khảo', source: known.source, confidence: known.confidence, note: known.note });
  if (known?.portalUrl) portals.push({ url: known.portalUrl, label: 'Portal nhà cung cấp', source: known.source, confidence: known.confidence, note: known.note });

  return {
    solutionTaxCode,
    providerName: known?.name || solutionProviderFriendlyName(solutionTaxCode),
    adapterCode: presentation?.adapterCode,
    lookupCode: document.lookup?.lookupCode,
    lookupCodeType: document.lookup?.lookupCodeType,
    lookupSource: [document.lookup?.sourceSection, document.lookup?.sourceField].filter(Boolean).join(' · ') || undefined,
    lookupConfidence: document.lookup?.confidence,
    portals: uniquePortals(portals),
    known,
    supportedByKnownAdapter: Boolean(presentation?.adapterCode),
  };
}

export function sanitizeRawForDisplay(value: unknown, depth = 0): unknown {
  if (depth > 20) return '[max-depth]';
  if (Array.isArray(value)) return value.map(item => sanitizeRawForDisplay(item, depth + 1));
  if (!value || typeof value !== 'object') return value;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (/^(password|passwd|pwd|cookie|authorization|access_?token|refresh_?token|csrf|captcha)$/i.test(key)) {
      result[key] = '[REDACTED]';
    } else {
      result[key] = sanitizeRawForDisplay(child, depth + 1);
    }
  }
  return result;
}
