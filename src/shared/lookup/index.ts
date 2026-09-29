import type { InvoiceLookup } from '../models/index.js';
import { isRecord, safeString } from '../utils/index.js';

type FoundField = { name: string; value: unknown; section: string };
const CODE_NAMES = [
  'KeySearch', 'keySearch', 'KEYSEARCH',
  'Fkey', 'Hilo-SearchKey', 'Mã tra cứu', 'Ma tra cuu', 'MA_TRA_CUU',
  'Mã số bí mật', 'Ma so bi mat', 'Số bảo mật', 'So bao mat', 'sobaomat',
  'TransactionID', 'transactionID', 'lookupCode',
];
const URL_NAMES = [
  'PortalLink', 'Link tra cứu người bán', 'Link tra cuu nguoi ban',
  'PATH', 'lookupUrl',
];

function collect(raw: Record<string, unknown>, section = 'invoice', depth = 0): FoundField[] {
  const fields: FoundField[] = [];
  for (const [name, value] of Object.entries(raw)) {
    if (['ttkhac', 'cttkhac', 'nbttkhac', 'nmttkhac', 'ttttkhac'].includes(name)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          if (!isRecord(item)) continue;
          const fieldName = safeString(item.ttruong) || safeString(item.ten) || safeString(item.name) || safeString(item.key);
          if (fieldName) {
            fields.push({
              name: fieldName,
              value: item.dlieu ?? item.value ?? item.giatri,
              section: `${section}.${name}`,
            });
          }
        }
      } else if (isRecord(value)) {
        for (const [fieldName, fieldValue] of Object.entries(value)) {
          fields.push({ name: fieldName, value: fieldValue, section: `${section}.${name}` });
        }
      }
      continue;
    }
    fields.push({ name, value, section });
    if (depth < 2 && isRecord(value) && ['nguoiban', 'nguoimua', 'seller', 'buyer'].includes(name)) {
      fields.push(...collect(value, `${section}.${name}`, depth + 1));
    }
  }
  return fields;
}

function first(fields: FoundField[], names: string[]): FoundField | undefined {
  for (const name of names) {
    const found = fields.find((field) => field.name === name && safeString(field.value));
    if (found) return found;
  }
  return undefined;
}

export function extractLookup(
  raw: Record<string, unknown>,
  providerCode?: string
): InvoiceLookup | undefined {
  const fields = collect(raw);
  const codeField = first(fields, CODE_NAMES);
  const urlField = first(fields, URL_NAMES);
  const lookupCode = codeField ? safeString(codeField.value) : undefined;
  const rawUrl = urlField ? safeString(urlField.value) : undefined;
  let lookupBaseUrl: string | undefined;
  let lookupPathRaw: string | undefined;

  if (rawUrl) {
    try {
      const url = new URL(rawUrl);
      if (url.protocol === 'https:' || url.protocol === 'http:') {
        lookupBaseUrl = url.origin;
        lookupPathRaw = `${url.pathname}${url.search}${url.hash}`;
      } else {
        lookupPathRaw = rawUrl;
      }
    } catch {
      lookupPathRaw = rawUrl;
    }
  }

  if (!lookupCode && !rawUrl && !providerCode) return undefined;
  return {
    providerCode,
    lookupCode,
    lookupCodeType: codeField?.name,
    lookupBaseUrl,
    lookupPathRaw,
    sourceSection: codeField?.section || urlField?.section,
    sourceField: codeField?.name || urlField?.name,
    confidence: lookupCode && rawUrl ? 'high' : lookupCode || rawUrl ? 'medium' : 'low',
  };
}
