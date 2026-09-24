import type { InvoiceDocument, TvanProviderCapability } from '../models/index.js';
import { isRecord, safeString } from '../utils/index.js';

export type TvanObservationSource = 'dataset_import' | 'gdt_query' | 'gdt_query_auto';
export type TvanAliasType = 'provider_code' | 'tax_code' | 'host';
export type TvanEndpointKind = 'provider_portal' | 'lookup_portal';

export interface TvanObservationAlias { type: TvanAliasType; value: string; }
export interface TvanObservationEndpoint { kind: TvanEndpointKind; origin: string; host: string; pathPattern: string; }
export interface TvanObservationMapping {
  semanticRole: 'provider_code' | 'provider_tax_code' | 'provider_name' | 'lookup_portal' | 'lookup_url' | 'lookup_code' | 'lookup_code_type' | 'unknown_tvan_candidate';
  fieldName: string;
  fieldPath: string;
}
export interface TvanObservation {
  providerCode?: string;
  providerTaxCode?: string;
  displayName: string;
  adapterSupported: boolean;
  pdfSupported: boolean;
  captchaMode?: string;
  aliases: TvanObservationAlias[];
  endpoints: TvanObservationEndpoint[];
  mappings: TvanObservationMapping[];
}

type FieldValue = { name: string; value: string; path: string };

const KNOWN_PROVIDER_METADATA: Record<string, { displayName: string; providerTaxCode?: string; providerPortal?: string }> = {
  tvan_misa: { displayName: 'MISA meInvoice', providerPortal: 'https://www.meinvoice.vn' },
  tvan_viettel: { displayName: 'Viettel SInvoice', providerPortal: 'https://vinvoice.viettel.vn' },
  tvan_invoice: { displayName: 'M-Invoice', providerTaxCode: '0106026495', providerPortal: 'https://tracuuhoadon.minvoice.com.vn' },
  tvan_softdreams: { displayName: 'SoftDreams EasyInvoice', providerTaxCode: '0105987432' },
};
const PROVIDER_TAX_CODE_NAMES = new Set(['msttcgp', 'tvandnkntt', 'mst tvan', 'ma so thue tvan', 'tax code tvan', 'provider tax code']);
const PROVIDER_NAME_NAMES = new Set(['tentvandnkntt', 'ten tvan', 'provider name']);
const PORTAL_NAMES = new Set(['portallink', 'portal link', 'link tra cuu nguoi ban', 'lookupurl', 'lookup url', 'path']);
const LOOKUP_CODE_NAMES = new Set(['fkey', 'hilo searchkey', 'ma tra cuu', 'ma so bi mat', 'so bao mat', 'sobaomat', 'transactionid', 'lookupcode']);

function normalizedName(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('vi-VN').replace(/[^a-z0-9]+/g, ' ').trim();
}
function normalizedProviderCode(value: unknown): string | undefined {
  const text = safeString(value)?.trim().toLocaleLowerCase('vi-VN');
  return text || undefined;
}
function normalizedTaxCode(value: unknown): string | undefined {
  const text = safeString(value)?.replace(/\s+/g, '');
  return text && /^\d{10}(?:-\d{3})?$/.test(text) ? text : undefined;
}
function normalizeFieldPath(value: string): string { return value.replace(/\[\d+\]/g, '[]').slice(0, 500); }
function collectUnknown(value: unknown, path: string, depth: number, out: FieldValue[]): void {
  if (depth > 7 || value == null) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectUnknown(item, `${path}[${index}]`, depth + 1, out));
    return;
  }
  if (!isRecord(value)) return;
  const namedField = safeString(value.ttruong ?? value.name ?? value.key ?? value.ten);
  const namedValue = safeString(value.dlieu ?? value.value ?? value.giatri ?? value.rawValue);
  if (namedField && namedValue) out.push({ name: namedField, value: namedValue, path });
  for (const [name, child] of Object.entries(value)) {
    const direct = safeString(child);
    if (direct) out.push({ name, value: direct, path: `${path}.${name}` });
    if (Array.isArray(child) || isRecord(child)) collectUnknown(child, `${path}.${name}`, depth + 1, out);
  }
}
function collectDocumentFields(document: InvoiceDocument): FieldValue[] {
  const fields: FieldValue[] = [];
  for (const field of document.dynamicFields || []) {
    const value = safeString(field.rawValue);
    if (value) fields.push({ name: field.name, value, path: `dynamicFields.${field.section}.${field.name}` });
  }
  for (const [partyName, party] of [['seller', document.seller], ['buyer', document.buyer]] as const) {
    for (const field of party?.dynamicFields || []) {
      const value = safeString(field.rawValue);
      if (value) fields.push({ name: field.name, value, path: `${partyName}.dynamicFields.${field.section}.${field.name}` });
    }
  }
  collectUnknown(document.rawSummary, 'rawSummary', 0, fields);
  collectUnknown(document.rawDetail, 'rawDetail', 0, fields);
  return fields;
}
function dedupe<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => { const id = key(item); if (seen.has(id)) return false; seen.add(id); return true; });
}
function safeHttpUrl(value: string): URL | undefined {
  try { const url = new URL(value); return url.protocol === 'http:' || url.protocol === 'https:' ? url : undefined; } catch { return undefined; }
}
function sanitizeEndpoint(raw: string, kind: TvanEndpointKind, lookupCode?: string, sellerTaxCode?: string): TvanObservationEndpoint | undefined {
  const url = safeHttpUrl(raw); if (!url) return undefined;
  let host = url.hostname.toLocaleLowerCase();
  const seller = sellerTaxCode?.toLocaleLowerCase();
  if (seller && host.startsWith(seller)) host = `<sellerTaxCode>${host.slice(seller.length)}`;
  let path = url.pathname || '/';
  if (lookupCode) {
    path = path.split(lookupCode).join(':lookupCode');
    try { path = path.split(encodeURIComponent(lookupCode)).join(':lookupCode'); } catch { /* no-op */ }
  }
  if (sellerTaxCode) {
    path = path.split(sellerTaxCode).join(':sellerTaxCode');
    try { path = path.split(encodeURIComponent(sellerTaxCode)).join(':sellerTaxCode'); } catch { /* no-op */ }
  }
  path = path.split('/').map((segment) => {
    if (!segment || segment.startsWith(':')) return segment;
    let decoded = segment;
    try { decoded = decodeURIComponent(segment); } catch { /* keep encoded segment */ }
    if (/^\d+$/.test(decoded) || (decoded.length >= 5 && /\d/.test(decoded) && /^[A-Za-z0-9._~-]+$/.test(decoded))) return ':value';
    return segment;
  }).join('/');
  const searchKeys = [...new Set(Array.from(url.searchParams.keys()))].sort();
  if (searchKeys.length) path += `?${searchKeys.map((name) => `${encodeURIComponent(name)}=:value`).join('&')}`;
  if (url.hash) path += '#:fragment';
  return { kind, origin: `${url.protocol}//${host}${url.port ? `:${url.port}` : ''}`, host, pathPattern: path.slice(0, 800) };
}
function endpointFromLookup(document: InvoiceDocument): TvanObservationEndpoint | undefined {
  const base = safeString(document.lookup?.lookupBaseUrl); if (!base) return undefined;
  const rawPath = safeString(document.lookup?.lookupPathRaw) || '/';
  let raw = base; try { raw = new URL(rawPath, base).toString(); } catch { /* use base */ }
  return sanitizeEndpoint(raw, 'lookup_portal', safeString(document.lookup?.lookupCode), safeString(document.seller?.taxCode));
}
function mapping(role: TvanObservationMapping['semanticRole'], fieldName: string, fieldPath: string): TvanObservationMapping {
  return { semanticRole: role, fieldName: fieldName.slice(0, 200), fieldPath: normalizeFieldPath(fieldPath) };
}

export function extractTvanObservation(document: InvoiceDocument, capability: TvanProviderCapability): TvanObservation | undefined {
  const fields = collectDocumentFields(document);
  const explicitProviderCode = normalizedProviderCode(document.providerCode ?? document.lookup?.providerCode);
  const capabilityCode = normalizedProviderCode(capability.providerCode);
  const providerCode = explicitProviderCode || (capabilityCode && capabilityCode !== 'unknown' ? capabilityCode : undefined);
  const known = providerCode ? KNOWN_PROVIDER_METADATA[providerCode] : undefined;
  let observedTaxCode: string | undefined;
  let observedName: string | undefined;
  const mappings: TvanObservationMapping[] = [];
  const endpoints: TvanObservationEndpoint[] = [];

  if (explicitProviderCode) mappings.push(mapping('provider_code', document.providerCode ? 'providerCode' : 'lookup.providerCode', document.providerCode ? 'document.providerCode' : 'document.lookup.providerCode'));
  if (document.lookup?.lookupCodeType) mappings.push(mapping('lookup_code_type', document.lookup.lookupCodeType, document.lookup.sourceSection || 'document.lookup'));
  if (document.lookup?.lookupCode) mappings.push(mapping('lookup_code', document.lookup.sourceField || document.lookup.lookupCodeType || 'lookupCode', document.lookup.sourceSection || 'document.lookup'));
  if (document.lookup?.lookupBaseUrl) mappings.push(mapping('lookup_portal', document.lookup.sourceField || 'lookupBaseUrl', document.lookup.sourceSection || 'document.lookup'));

  for (const field of fields) {
    const name = normalizedName(field.name);
    if (!observedTaxCode && PROVIDER_TAX_CODE_NAMES.has(name)) {
      const value = normalizedTaxCode(field.value); if (value) { observedTaxCode = value; mappings.push(mapping('provider_tax_code', field.name, field.path)); }
    }
    if (!observedName && PROVIDER_NAME_NAMES.has(name)) {
      const value = safeString(field.value)?.trim(); if (value) { observedName = value.slice(0, 300); mappings.push(mapping('provider_name', field.name, field.path)); }
    }
    if (PORTAL_NAMES.has(name)) {
      const endpoint = sanitizeEndpoint(field.value, 'lookup_portal', safeString(document.lookup?.lookupCode), safeString(document.seller?.taxCode));
      if (endpoint) { endpoints.push(endpoint); mappings.push(mapping('lookup_url', field.name, field.path)); }
    }
    if (LOOKUP_CODE_NAMES.has(name)) mappings.push(mapping('lookup_code', field.name, field.path));
  }

  const providerTaxCode = observedTaxCode || known?.providerTaxCode;
  const lookupEndpoint = endpointFromLookup(document); if (lookupEndpoint) endpoints.push(lookupEndpoint);
  if (known?.providerPortal) { const endpoint = sanitizeEndpoint(known.providerPortal, 'provider_portal'); if (endpoint) endpoints.push(endpoint); }
  const displayName = ((capability.displayName && capability.displayName !== 'unknown' && capability.displayName !== capability.providerCode ? capability.displayName : undefined)
    || known?.displayName || observedName || providerCode || providerTaxCode || endpoints[0]?.host || 'TVAN chưa xác định').slice(0, 300);

  const aliases: TvanObservationAlias[] = [];
  if (providerCode) aliases.push({ type: 'provider_code', value: providerCode });
  if (providerTaxCode) aliases.push({ type: 'tax_code', value: providerTaxCode });
  endpoints.forEach((endpoint) => { if (!endpoint.host.includes('<sellerTaxCode>')) aliases.push({ type: 'host', value: endpoint.host }); });
  const uniqueAliases = dedupe(aliases, (item) => `${item.type}|${item.value}`);
  const uniqueEndpoints = dedupe(endpoints, (item) => `${item.kind}|${item.origin}|${item.pathPattern}`);
  const uniqueMappings = dedupe(mappings, (item) => `${item.semanticRole}|${item.fieldName}|${item.fieldPath}`);
  if (!providerCode && !providerTaxCode && !uniqueEndpoints.length && !uniqueMappings.length) return undefined;
  return { providerCode, providerTaxCode, displayName, adapterSupported: capability.supported, pdfSupported: capability.supported, captchaMode: capability.captchaMode, aliases: uniqueAliases, endpoints: uniqueEndpoints, mappings: uniqueMappings };
}

export function tvanObservationIdentity(observation: TvanObservation): string {
  if (observation.providerCode) return `provider_code:${observation.providerCode}`;
  if (observation.providerTaxCode) return `tax_code:${observation.providerTaxCode}`;
  const host = observation.aliases.find((item) => item.type === 'host')?.value || observation.endpoints[0]?.host;
  return host ? `host:${host}` : `name:${observation.displayName.toLocaleLowerCase('vi-VN')}`;
}
