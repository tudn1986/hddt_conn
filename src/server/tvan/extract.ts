import type { InvoiceDocument } from '../../shared/models/index.js';
import { isRecord, safeString } from '../../shared/utils/index.js';

export type NamedValue = { name: string; value: string; path: string };

function collectFromUnknown(value: unknown, path = 'root', depth = 0, out: NamedValue[] = []): NamedValue[] {
  if (depth > 7 || value === null || value === undefined) return out;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      collectFromUnknown(value[index], `${path}[${index}]`, depth + 1, out);
    }
    return out;
  }
  if (!isRecord(value)) return out;

  const fieldName = safeString(value.ttruong ?? value.name ?? value.key ?? value.ten);
  const fieldValue = safeString(value.dlieu ?? value.value ?? value.giatri ?? value.rawValue);
  if (fieldName && fieldValue) out.push({ name: fieldName, value: fieldValue, path });

  for (const [key, child] of Object.entries(value)) {
    const direct = safeString(child);
    if (direct) out.push({ name: key, value: direct, path: `${path}.${key}` });
    if (Array.isArray(child) || isRecord(child)) collectFromUnknown(child, `${path}.${key}`, depth + 1, out);
  }
  return out;
}

export function collectDocumentFields(document: InvoiceDocument): NamedValue[] {
  const out: NamedValue[] = [];
  for (const field of document.dynamicFields || []) {
    const value = safeString(field.rawValue);
    if (value) out.push({ name: field.name, value, path: field.section });
  }
  for (const party of [document.seller, document.buyer]) {
    for (const field of party?.dynamicFields || []) {
      const value = safeString(field.rawValue);
      if (value) out.push({ name: field.name, value, path: field.section });
    }
  }
  collectFromUnknown(document.rawSummary, 'rawSummary', 0, out);
  collectFromUnknown(document.rawDetail, 'rawDetail', 0, out);
  return out;
}

function normalizedName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('vi-VN')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function findNamedValue(document: InvoiceDocument, names: string[]): string | undefined {
  const normalized = names.map(normalizedName);
  for (const field of collectDocumentFields(document)) {
    const key = normalizedName(field.name);
    if (normalized.includes(key)) return field.value;
  }
  return undefined;
}

export function providerCodeOf(document: InvoiceDocument): string {
  return String(document.providerCode || document.lookup?.providerCode || '').trim().toLocaleLowerCase('vi-VN');
}

export function lookupCodeOf(document: InvoiceDocument): string | undefined {
  return safeString(document.lookup?.lookupCode);
}
