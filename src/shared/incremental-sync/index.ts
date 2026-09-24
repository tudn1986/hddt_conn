import type {
  ExistingInvoiceRef,
  InvoiceDocument,
  InvoiceSource,
  OriginalInvoiceLocator,
  Party,
} from '../models/index.js';
import { normalizeInvoice } from '../normalizer/index.js';
import { isNoVatDocumentType } from '../normalizer/financial-amounts.js';
import { isRecord } from '../utils/index.js';

function part(value: unknown): string {
  return value === undefined || value === null ? '' : String(value).trim();
}

/** Business locator without direction; relation payloads identify originals this way. */
export function buildBusinessLocatorKey(
  source: InvoiceSource,
  locator: OriginalInvoiceLocator
): string {
  return [
    source,
    part(locator.sellerTaxCode),
    part(locator.templateNo),
    part(locator.series),
    part(locator.invoiceNo),
  ].join('|');
}

export function documentBusinessLocatorKey(document: InvoiceDocument): string {
  return buildBusinessLocatorKey(document.invoiceSource, {
    sellerTaxCode: document.seller.taxCode ?? '',
    templateNo: document.templateNo ?? '',
    series: document.series ?? '',
    invoiceNo: document.invoiceNo ?? '',
  });
}

export function existingBusinessLocatorKey(existing: ExistingInvoiceRef): string {
  return buildBusinessLocatorKey(existing.invoiceSource, {
    sellerTaxCode: existing.sellerTaxCode,
    templateNo: existing.templateNo,
    series: existing.series,
    invoiceNo: existing.invoiceNo,
  });
}

export function hasInvoiceDetail(document: InvoiceDocument): boolean {
  const hasPayload = isRecord(document.rawDetail) || document.lines.length > 0;
  if (!hasPayload) return false;
  // GDT/provider summaries for type 02 and 06 frequently omit financial totals.
  // If an older cached detail still cannot resolve the HHDV amount, hydrate it again.
  if (isNoVatDocumentType(document.documentTypeCode) && document.subtotal === undefined) return false;
  return true;
}

export function toExistingInvoiceRef(document: InvoiceDocument): ExistingInvoiceRef {
  return {
    key: document.key,
    invoiceSource: document.invoiceSource,
    portalInvoiceId: document.portalInvoiceId,
    sellerTaxCode: document.seller.taxCode ?? '',
    buyerTaxCode: document.buyer.taxCode,
    templateNo: document.templateNo ?? '',
    series: document.series ?? '',
    invoiceNo: document.invoiceNo ?? '',
    hasDetail: hasInvoiceDetail(document),
    invoiceStatus: document.invoiceStatus,
    processingStatus: document.processingStatus,
    updatedTime: document.updatedTime,
  };
}

function mergeParty(existing: Party, refreshed: Party): Party {
  return {
    taxCode: refreshed.taxCode ?? existing.taxCode,
    name: refreshed.name ?? existing.name,
    address: refreshed.address ?? existing.address,
    bankAccount: refreshed.bankAccount ?? existing.bankAccount,
    bankName: refreshed.bankName ?? existing.bankName,
    phone: refreshed.phone ?? existing.phone,
    email: refreshed.email ?? existing.email,
    fax: refreshed.fax ?? existing.fax,
    website: refreshed.website ?? existing.website,
    identityNo: refreshed.identityNo ?? existing.identityNo,
    dynamicFields: existing.dynamicFields.length
      ? existing.dynamicFields
      : refreshed.dynamicFields,
  };
}

/**
 * Merge a fresh LIST summary into an existing hydrated invoice without dropping cached detail.
 * Status, relation and list timestamps from the refreshed summary always win over stale values
 * that may also exist inside the cached detail payload.
 */
export function mergeRefreshedSummary(
  existing: InvoiceDocument,
  refreshed: InvoiceDocument
): InvoiceDocument {
  if (isRecord(existing.rawDetail) && isRecord(refreshed.rawSummary)) {
    const merged = normalizeInvoice(
      existing.direction,
      existing.invoiceSource,
      refreshed.rawSummary,
      existing.rawDetail
    );
    return {
      ...merged,
      portalInvoiceId: refreshed.portalInvoiceId ?? merged.portalInvoiceId,
      invoiceStatus: refreshed.invoiceStatus ?? merged.invoiceStatus,
      processingStatus: refreshed.processingStatus ?? merged.processingStatus,
      nature: refreshed.nature ?? merged.nature,
      relation: refreshed.relation ?? merged.relation,
      receivedTime: refreshed.receivedTime ?? merged.receivedTime,
      codedTime: refreshed.codedTime ?? merged.codedTime,
      updatedTime: refreshed.updatedTime ?? merged.updatedTime,
      rawSummary: refreshed.rawSummary,
      rawDetail: existing.rawDetail,
    };
  }

  return {
    ...existing,
    ...refreshed,
    seller: mergeParty(existing.seller, refreshed.seller),
    buyer: mergeParty(existing.buyer, refreshed.buyer),
    taxSummaries: existing.taxSummaries.length
      ? existing.taxSummaries
      : refreshed.taxSummaries,
    lines: existing.lines,
    dynamicFields: existing.dynamicFields.length
      ? existing.dynamicFields
      : refreshed.dynamicFields,
    relation: refreshed.relation ?? existing.relation,
    rawSummary: refreshed.rawSummary,
    rawDetail: existing.rawDetail,
  };
}

function applyRelationDrivenStatuses(
  byKey: Map<string, InvoiceDocument>,
  incoming: InvoiceDocument[]
): void {
  const originals = new Map<string, InvoiceDocument[]>();
  for (const document of byKey.values()) {
    const key = documentBusinessLocatorKey(document);
    const matches = originals.get(key) ?? [];
    matches.push(document);
    originals.set(key, matches);
  }

  for (const child of incoming) {
    if (!child.relation) continue;
    const relationKey = buildBusinessLocatorKey(child.invoiceSource, child.relation.original);
    const matches = originals.get(relationKey) ?? [];
    // Ambiguous/missing originals are intentionally not guessed here. Backend reports warnings.
    if (matches.length !== 1) continue;

    const original = matches[0];
    const nextStatus = child.relation.kind === 'replacement' ? 4 : 5;
    const updated: InvoiceDocument = {
      ...original,
      // GDT payloads show the original keeps tchat=1. Never rewrite nature based on the child.
      invoiceStatus: nextStatus,
    };
    byKey.set(original.key, updated);
    originals.set(relationKey, [updated]);
  }
}

/**
 * Merge refreshed incremental results into the currently opened dataset.
 * - documents outside the incremental windows stay untouched;
 * - existing complete invoices keep cached detail;
 * - new/missing-detail invoices replace their matching summary after hydration;
 * - replacement/adjustment children update the matched original status locally (2→4, 3→5).
 */
export function mergeIncrementalDocuments(
  current: InvoiceDocument[],
  refreshed: InvoiceDocument[]
): InvoiceDocument[] {
  const byKey = new Map(current.map((document) => [document.key, document]));
  const order = current.map((document) => document.key);

  for (const incoming of refreshed) {
    const existing = byKey.get(incoming.key);
    if (!existing) {
      byKey.set(incoming.key, incoming);
      order.push(incoming.key);
      continue;
    }
    byKey.set(
      incoming.key,
      hasInvoiceDetail(incoming)
        ? incoming
        : mergeRefreshedSummary(existing, incoming)
    );
  }

  applyRelationDrivenStatuses(byKey, refreshed);

  return order.map((key) => byKey.get(key)).filter((value): value is InvoiceDocument => !!value);
}
