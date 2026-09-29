import type { InvoiceDocument } from '../../../../shared/models/index.js';
import { AppError, safeString } from '../../../../shared/utils/index.js';
import { THAISON_SOLUTION_TAX_CODE } from '../../../../shared/provider-resolution.js';
import { collectDocumentFields, providerCodeOf } from '../../extract.js';

export type ThaisonPortalProfile = 'tenant_v1' | 'shared_v1';

export interface ThaisonLookup {
  sellerTaxCode: string;
  providerTaxCode?: string;
  portalOrigin: string;
  portalHost: string;
  portalProtocol: 'https:';
  lookupCode: string;
  profile: ThaisonPortalProfile;
}

const VERIFIED_TENANT_HOSTS = new Set([
  'delmarhan.einvoice.com.vn',
]);

function normalizedName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('vi-VN')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function uniqueNamedValues(document: InvoiceDocument, names: string[]): string[] {
  const wanted = new Set(names.map(normalizedName));
  const values: string[] = [];
  for (const field of collectDocumentFields(document)) {
    if (!wanted.has(normalizedName(field.name))) continue;
    const value = safeString(field.value);
    if (value && !values.includes(value)) values.push(value);
  }
  return values;
}

function singleValue(values: string[], missingCode: string, conflictCode: string, missingMessage: string, conflictMessage: string): string {
  if (!values.length) throw new AppError(missingCode, missingMessage, 422);
  if (values.length > 1) throw new AppError(conflictCode, conflictMessage, 409);
  return values[0];
}

function explicitProviderCode(document: InvoiceDocument): string {
  return String(
    document.providers?.presentation?.adapterCode
      || providerCodeOf(document)
      || '',
  ).trim().toLocaleLowerCase('vi-VN');
}

export function thaisonProviderTaxCodeOf(document: InvoiceDocument): string | undefined {
  return safeString(document.providers?.solution?.taxCode)
    || uniqueNamedValues(document, ['msttcgp', 'MSTTCGP', 'tvandnkntt'])[0];
}

export function isThaisonDocument(document: InvoiceDocument): boolean {
  const code = explicitProviderCode(document);
  if (code === 'tvan_thaison') return true;
  return thaisonProviderTaxCodeOf(document) === THAISON_SOLUTION_TAX_CODE;
}

function sellerTaxCodeOf(document: InvoiceDocument): string | undefined {
  return safeString(document.seller?.taxCode)
    || uniqueNamedValues(document, ['nbmst', 'MST người bán', 'sellerTaxCode'])[0];
}

function normalizedLookupPortal(document: InvoiceDocument): string | undefined {
  if (String(document.lookup?.providerCode || '').trim().toLocaleLowerCase('vi-VN') !== 'tvan_thaison') return undefined;
  const base = safeString(document.lookup?.lookupBaseUrl);
  if (!base) return undefined;
  const path = safeString(document.lookup?.lookupPathRaw);
  try {
    return new URL(path || '/', base).toString();
  } catch {
    return undefined;
  }
}

function normalizedLookupCode(document: InvoiceDocument): string | undefined {
  if (String(document.lookup?.providerCode || '').trim().toLocaleLowerCase('vi-VN') !== 'tvan_thaison') return undefined;
  return safeString(document.lookup?.lookupCode);
}

function parsePortal(raw: string): URL {
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new AppError('TVAN_THAISON_PORTAL_INVALID', 'Địa chỉ tra cứu Thái Sơn không phải URL hợp lệ.', 422);
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port || url.hash) {
    throw new AppError('TVAN_THAISON_PORTAL_INVALID', 'Địa chỉ tra cứu Thái Sơn không đạt policy URL an toàn.', 422);
  }
  return url;
}

function sharedLookup(sellerTaxCode: string, providerTaxCode: string | undefined, lookupCode: string): ThaisonLookup {
  return {
    sellerTaxCode,
    providerTaxCode,
    portalOrigin: 'https://einvoice.vn',
    portalHost: 'einvoice.vn',
    portalProtocol: 'https:',
    lookupCode,
    profile: 'shared_v1',
  };
}

export function resolveThaisonLookup(document: InvoiceDocument): ThaisonLookup {
  if (!isThaisonDocument(document)) {
    throw new AppError('TVAN_THAISON_PROVIDER_MISMATCH', 'Hóa đơn không thuộc provider Thái Sơn EInvoice.', 422);
  }

  const sellerTaxCode = sellerTaxCodeOf(document);
  if (!sellerTaxCode) {
    throw new AppError('TVAN_THAISON_SELLER_TAX_CODE_MISSING', 'Không tìm thấy MST người bán của hóa đơn Thái Sơn.', 422);
  }

  const codeCandidates = [
    normalizedLookupCode(document),
    ...uniqueNamedValues(document, ['Mã TC']),
  ].filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index);
  const lookupCode = singleValue(
    codeCandidates,
    'TVAN_THAISON_LOOKUP_CODE_MISSING',
    'TVAN_THAISON_LOOKUP_CODE_CONFLICT',
    'Không tìm thấy Mã TC của hóa đơn Thái Sơn.',
    'Dữ liệu chứa nhiều Mã TC Thái Sơn khác nhau; không tự chọn mã tra cứu.',
  );
  if (!/^[A-Za-z0-9_-]{6,128}$/.test(lookupCode)) {
    throw new AppError('TVAN_THAISON_LOOKUP_CODE_INVALID', 'Mã TC Thái Sơn không đúng định dạng an toàn.', 422);
  }

  const portalCandidates = [
    normalizedLookupPortal(document),
    ...uniqueNamedValues(document, ['DC TC']),
  ].filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index);
  if (!portalCandidates.length) {
    return sharedLookup(sellerTaxCode, thaisonProviderTaxCodeOf(document), lookupCode);
  }
  const parsedPortals = portalCandidates.map(parsePortal);
  const semanticPortalKeys = [...new Set(parsedPortals.map((candidate) => {
    const path = candidate.pathname.replace(/\/+$/, '') || '/';
    return candidate.hostname.toLocaleLowerCase('vi-VN') + path.toLocaleLowerCase('vi-VN');
  }))];
  if (semanticPortalKeys.length > 1) {
    throw new AppError(
      'TVAN_THAISON_PORTAL_CONFLICT',
      'Dữ liệu chứa nhiều DC TC Thái Sơn khác nhau; không tự chọn portal.',
      409,
    );
  }

  const portal = parsedPortals[0];
  const host = portal.hostname.toLocaleLowerCase('vi-VN');
  if (host === 'einvoice.vn' || host === 'www.einvoice.vn') {
    const path = portal.pathname.replace(/\/+$/, '') || '/';
    if (path.toLocaleLowerCase('vi-VN') !== '/tra-cuu') {
      throw new AppError(
        'TVAN_THAISON_PORTAL_INVALID',
        'Portal chung Thái Sơn phải dùng đúng đường dẫn /tra-cuu.',
        422,
      );
    }
    return sharedLookup(sellerTaxCode, thaisonProviderTaxCodeOf(document), lookupCode);
  }
  if (!host.endsWith('.einvoice.com.vn')) {
    throw new AppError('TVAN_THAISON_PORTAL_REJECTED', 'DC TC không thuộc domain family Thái Sơn đã review.', 422);
  }
  if (!VERIFIED_TENANT_HOSTS.has(host)) {
    return sharedLookup(sellerTaxCode, thaisonProviderTaxCodeOf(document), lookupCode);
  }

  const path = portal.pathname.replace(/\/+$/, '') || '/';
  if (path !== '/') {
    throw new AppError(
      'TVAN_THAISON_PORTAL_UNVERIFIED',
      'Tenant đã xác minh chỉ hỗ trợ bootstrap từ origin/root trong adapter v1.',
      422,
    );
  }

  return {
    sellerTaxCode,
    providerTaxCode: thaisonProviderTaxCodeOf(document),
    portalOrigin: `https://${host}`,
    portalHost: host,
    portalProtocol: 'https:',
    lookupCode,
    profile: 'tenant_v1',
  };
}

export function publicThaisonLookup(lookup: ThaisonLookup): Record<string, string> {
  return {
    portalHost: lookup.portalHost,
    sellerTaxCode: lookup.sellerTaxCode,
    providerTaxCode: lookup.providerTaxCode || '',
    profile: lookup.profile,
  };
}
